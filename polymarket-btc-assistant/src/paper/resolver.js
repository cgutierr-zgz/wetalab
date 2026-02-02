/**
 * Trade Resolution Module
 * 
 * Handles trade resolution when the 15min window ends.
 * Determines win/loss outcomes, calculates P&L, and manages
 * the resolution lifecycle.
 * 
 * Resolution flow:
 * 1. Check if active position should be resolved (window ended)
 * 2. Get final BTC price from Chainlink/Binance
 * 3. Compare price vs priceToBeat to determine outcome
 * 4. Calculate P&L (binary: ~95% return on win, -100% on loss)
 * 5. Update trade record and portfolio
 * 6. Trigger persistence callbacks
 */

import { CONFIG } from "../config.js";
import { getCandleWindowTiming } from "../utils.js";

/**
 * Type imports from src/paper/types.js:
 * @typedef {import('./types.js').PaperTrade} PaperTrade
 * @typedef {import('./types.js').TradeResult} TradeResult
 */

// Resolution configuration
export const RESOLUTION_CONFIG = {
  // Polymarket vig (typically ~5%)
  winMultiplier: 0.95,
  lossMultiplier: -1.0,
  
  // Grace period after window ends before resolution (ms)
  // Allows for price settlement
  gracePeriodMs: 2000,
  
  // Retry configuration for price fetching
  maxRetries: 3,
  retryDelayMs: 1000,
  
  // Resolution check interval (ms)
  checkIntervalMs: 1000
};

/**
 * @typedef {Object} ResolutionResult
 * @property {boolean} resolved - Whether trade was resolved
 * @property {'WIN' | 'LOSS' | null} result - Trade outcome
 * @property {number | null} pnl - Profit/loss amount
 * @property {number | null} finalPrice - Final BTC price at resolution
 * @property {string | null} error - Error message if resolution failed
 */

/**
 * @typedef {Object} PriceSource
 * @property {() => Promise<number | null>} getPrice - Function to fetch current price
 * @property {string} name - Name of the price source
 */

/**
 * TradeResolver class - Handles trade resolution logic
 */
export class TradeResolver {
  /**
   * @param {Object} options - Configuration options
   * @param {PriceSource} options.priceSource - Primary price source
   * @param {PriceSource} [options.fallbackPriceSource] - Fallback price source
   */
  constructor(options = {}) {
    this.config = { ...RESOLUTION_CONFIG, ...options.config };
    this.priceSource = options.priceSource || null;
    this.fallbackPriceSource = options.fallbackPriceSource || null;
    
    // Resolution timer state
    this.pendingResolution = null;
    this.resolutionTimer = null;
    
    // Callbacks
    this.onResolutionScheduled = null;
    this.onResolutionComplete = null;
    this.onResolutionError = null;
  }

  /**
   * Check if a trade should be resolved based on window timing
   * 
   * @param {Object} trade - The active trade
   * @returns {boolean} Whether the trade should be resolved
   */
  shouldResolve(trade) {
    if (!trade) return false;
    
    const now = Date.now();
    const windowEndMs = trade.windowEndMs;
    
    // Check if window has ended (with grace period)
    return now >= windowEndMs + this.config.gracePeriodMs;
  }

  /**
   * Check if a trade is near resolution (within grace period)
   * 
   * @param {Object} trade - The active trade
   * @returns {boolean} Whether the trade is in grace period
   */
  isInGracePeriod(trade) {
    if (!trade) return false;
    
    const now = Date.now();
    const windowEndMs = trade.windowEndMs;
    
    return now >= windowEndMs && now < windowEndMs + this.config.gracePeriodMs;
  }

  /**
   * Get time remaining until resolution
   * 
   * @param {Object} trade - The active trade
   * @returns {number} Milliseconds until resolution (negative if past)
   */
  getTimeToResolution(trade) {
    if (!trade) return Infinity;
    
    const now = Date.now();
    const resolutionTime = trade.windowEndMs + this.config.gracePeriodMs;
    
    return resolutionTime - now;
  }

  /**
   * Fetch current price with retry logic
   * 
   * @returns {Promise<{ price: number | null, source: string, error: string | null }>}
   */
  async fetchPrice() {
    let lastError = null;
    
    // Try primary source
    if (this.priceSource) {
      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          const price = await this.priceSource.getPrice();
          if (price !== null && price > 0) {
            return { price, source: this.priceSource.name, error: null };
          }
        } catch (err) {
          lastError = err;
          if (attempt < this.config.maxRetries - 1) {
            await this._sleep(this.config.retryDelayMs);
          }
        }
      }
    }
    
    // Try fallback source
    if (this.fallbackPriceSource) {
      try {
        const price = await this.fallbackPriceSource.getPrice();
        if (price !== null && price > 0) {
          return { price, source: this.fallbackPriceSource.name, error: null };
        }
      } catch (err) {
        lastError = err;
      }
    }
    
    return { 
      price: null, 
      source: null, 
      error: lastError?.message || "Failed to fetch price from all sources" 
    };
  }

  /**
   * Determine trade outcome based on price vs priceToBeat
   * 
   * @param {Object} trade - The trade to evaluate
   * @param {number} finalPrice - Final BTC price
   * @returns {'WIN' | 'LOSS'} Trade outcome
   */
  determineOutcome(trade, finalPrice) {
    const { side, priceToBeat } = trade;
    
    if (side === "UP") {
      // UP wins if price went above priceToBeat
      return finalPrice > priceToBeat ? "WIN" : "LOSS";
    } else {
      // DOWN wins if price went below priceToBeat
      return finalPrice < priceToBeat ? "WIN" : "LOSS";
    }
  }

  /**
   * Calculate P&L for a trade
   * 
   * @param {Object} trade - The trade
   * @param {'WIN' | 'LOSS'} result - Trade outcome
   * @returns {number} Profit/loss amount
   */
  calculatePnl(trade, result) {
    const { positionSize } = trade;
    
    if (result === "WIN") {
      // Win returns ~95% of position (minus Polymarket vig)
      return positionSize * this.config.winMultiplier;
    } else {
      // Loss loses entire position
      return positionSize * this.config.lossMultiplier;
    }
  }

  /**
   * Resolve a trade with the given final price
   * 
   * @param {Object} trade - The trade to resolve
   * @param {number} finalPrice - Final BTC price
   * @returns {ResolutionResult} Resolution result
   */
  resolveTrade(trade, finalPrice) {
    if (!trade) {
      return {
        resolved: false,
        result: null,
        pnl: null,
        finalPrice: null,
        error: "No trade to resolve"
      };
    }

    // Determine outcome
    const result = this.determineOutcome(trade, finalPrice);
    
    // Calculate P&L
    const pnl = this.calculatePnl(trade, result);
    
    // Build resolution result
    const resolution = {
      resolved: true,
      result,
      pnl,
      finalPrice,
      error: null,
      priceChange: finalPrice - trade.priceToBeat,
      priceChangePercent: ((finalPrice - trade.priceToBeat) / trade.priceToBeat) * 100,
      holdDurationMs: Date.now() - trade.entryTimestamp
    };
    
    return resolution;
  }

  /**
   * Full resolution flow - fetch price and resolve
   * 
   * @param {Object} trade - The trade to resolve
   * @returns {Promise<ResolutionResult>} Resolution result
   */
  async resolveWithPriceFetch(trade) {
    if (!trade) {
      return {
        resolved: false,
        result: null,
        pnl: null,
        finalPrice: null,
        error: "No trade to resolve"
      };
    }

    // Fetch current price
    const priceResult = await this.fetchPrice();
    
    if (priceResult.error || priceResult.price === null) {
      const errorResult = {
        resolved: false,
        result: null,
        pnl: null,
        finalPrice: null,
        error: priceResult.error || "Failed to fetch price"
      };
      
      if (this.onResolutionError) {
        this.onResolutionError(trade, errorResult);
      }
      
      return errorResult;
    }

    // Resolve with fetched price
    const resolution = this.resolveTrade(trade, priceResult.price);
    resolution.priceSource = priceResult.source;
    
    if (this.onResolutionComplete) {
      this.onResolutionComplete(trade, resolution);
    }
    
    return resolution;
  }

  /**
   * Schedule automatic resolution for a trade
   * 
   * @param {Object} trade - The trade to schedule resolution for
   * @param {Function} resolveCallback - Callback to execute resolution
   */
  scheduleResolution(trade, resolveCallback) {
    // Clear any existing timer
    this.cancelScheduledResolution();
    
    if (!trade) return;
    
    const timeToResolution = this.getTimeToResolution(trade);
    
    if (timeToResolution <= 0) {
      // Already past resolution time, resolve immediately
      resolveCallback();
      return;
    }
    
    this.pendingResolution = {
      tradeId: trade.id,
      scheduledAt: Date.now(),
      resolveAt: Date.now() + timeToResolution
    };
    
    this.resolutionTimer = setTimeout(async () => {
      this.pendingResolution = null;
      this.resolutionTimer = null;
      await resolveCallback();
    }, timeToResolution);
    
    if (this.onResolutionScheduled) {
      this.onResolutionScheduled(trade, this.pendingResolution);
    }
  }

  /**
   * Cancel any scheduled resolution
   */
  cancelScheduledResolution() {
    if (this.resolutionTimer) {
      clearTimeout(this.resolutionTimer);
      this.resolutionTimer = null;
    }
    this.pendingResolution = null;
  }

  /**
   * Get pending resolution info
   */
  getPendingResolution() {
    return this.pendingResolution ? { ...this.pendingResolution } : null;
  }

  /**
   * Utility: sleep for specified milliseconds
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.cancelScheduledResolution();
  }
}

// ============================================================
// Resolution Helper Functions
// ============================================================

/**
 * Check if current window has ended
 * 
 * @returns {boolean} Whether the current 15min window has ended
 */
export function hasWindowEnded() {
  const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
  return timing.remainingMs <= 0;
}

/**
 * Get window end timestamp for current window
 * 
 * @returns {number} Unix timestamp (ms) when current window ends
 */
export function getCurrentWindowEndMs() {
  const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
  return timing.endMs;
}

/**
 * Get time remaining in current window
 * 
 * @returns {{ ms: number, seconds: number, minutes: number }} Time remaining
 */
export function getTimeRemainingInWindow() {
  const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
  return {
    ms: timing.remainingMs,
    seconds: Math.floor(timing.remainingMs / 1000),
    minutes: timing.remainingMinutes
  };
}

/**
 * Calculate resolution statistics from trade history
 * 
 * @param {Array<Object>} trades - Array of resolved trades
 * @returns {Object} Resolution statistics
 */
export function calculateResolutionStats(trades) {
  const resolvedTrades = trades.filter(t => t.result !== "PENDING");
  
  if (resolvedTrades.length === 0) {
    return {
      totalResolved: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnl: 0,
      avgWinPnl: 0,
      avgLossPnl: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0
    };
  }
  
  const wins = resolvedTrades.filter(t => t.result === "WIN");
  const losses = resolvedTrades.filter(t => t.result === "LOSS");
  
  const totalPnl = resolvedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalWinPnl = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalLossPnl = Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0));
  
  return {
    totalResolved: resolvedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / resolvedTrades.length,
    totalPnl,
    avgPnl: totalPnl / resolvedTrades.length,
    avgWinPnl: wins.length > 0 ? totalWinPnl / wins.length : 0,
    avgLossPnl: losses.length > 0 ? totalLossPnl / losses.length : 0,
    largestWin: Math.max(0, ...wins.map(t => t.pnl || 0)),
    largestLoss: Math.min(0, ...losses.map(t => t.pnl || 0)),
    profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0
  };
}

/**
 * Format resolution result for logging/display
 * 
 * @param {Object} trade - The resolved trade
 * @param {ResolutionResult} resolution - Resolution result
 * @returns {Object} Formatted resolution info
 */
export function formatResolution(trade, resolution) {
  return {
    tradeId: trade.id,
    side: trade.side,
    entryPrice: trade.entryPrice,
    priceToBeat: trade.priceToBeat,
    finalPrice: resolution.finalPrice,
    result: resolution.result,
    pnl: resolution.pnl,
    pnlPercent: (resolution.pnl / trade.positionSize) * 100,
    positionSize: trade.positionSize,
    priceChange: resolution.priceChange,
    priceChangePercent: resolution.priceChangePercent,
    holdDurationMs: resolution.holdDurationMs,
    holdDurationMin: (resolution.holdDurationMs / 60000).toFixed(2),
    edge: trade.edge,
    phase: trade.phase,
    strength: trade.strength
  };
}

// ============================================================
// Singleton and Factory
// ============================================================

let resolverInstance = null;

/**
 * Get or create the trade resolver instance
 * 
 * @param {Object} options - Configuration options
 * @returns {TradeResolver} Trade resolver instance
 */
export function getTradeResolver(options = {}) {
  if (!resolverInstance) {
    resolverInstance = new TradeResolver(options);
  }
  return resolverInstance;
}

/**
 * Create a new trade resolver instance
 * 
 * @param {Object} options - Configuration options
 * @returns {TradeResolver} New trade resolver instance
 */
export function createTradeResolver(options = {}) {
  return new TradeResolver(options);
}

/**
 * Set the global resolver instance (for testing/replacement)
 * 
 * @param {TradeResolver} resolver - Resolver instance to use
 */
export function setTradeResolver(resolver) {
  if (resolverInstance) {
    resolverInstance.destroy();
  }
  resolverInstance = resolver;
}

export default TradeResolver;
