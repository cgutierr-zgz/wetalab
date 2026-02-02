/**
 * Paper Trading Orchestrator
 * 
 * Main orchestrator for the paper trading system. Coordinates signal processing,
 * position management, entry filters, and trade resolution.
 * 
 * Uses existing signal engine from src/engines/probability.js and src/engines/edge.js.
 */

import { CONFIG } from "../config.js";
import { getCandleWindowTiming, clamp } from "../utils.js";
import {
  createPaperTrade,
  createIndicatorsSnapshot,
  generateTradeId,
  validatePaperTrade,
  createPaperPortfolio,
  updatePortfolioAfterTrade,
  validatePaperPortfolio,
  serializePaperPortfolio,
  deserializePaperPortfolio,
  getPortfolioStats
} from "./types.js";
import {
  getPositionSize as getHalfKellySize,
  calculatePositionSize as calcPositionSizeDetails
} from "./sizing.js";

// Paper trading configuration from environment
export const PAPER_CONFIG = {
  enabled: (process.env.PAPER_TRADING_ENABLED || "true").toLowerCase() === "true",
  initialBalance: Number(process.env.PAPER_INITIAL_BALANCE) || 10000,
  maxPositionPct: Number(process.env.PAPER_MAX_POSITION_PCT) || 0.05,
  minPosition: Number(process.env.PAPER_MIN_POSITION) || 10,
  maxPosition: Number(process.env.PAPER_MAX_POSITION) || 500,
  maxConsecutiveLosses: 4,
  minIndicatorsAligned: 3
};

/**
 * Type imports from src/paper/types.js:
 * @typedef {import('./types.js').PaperTrade} PaperTrade
 * @typedef {import('./types.js').PaperPortfolio} PaperPortfolio
 * @typedef {import('./types.js').IndicatorsSnapshot} IndicatorsSnapshot
 * @typedef {import('./types.js').TradeSide} TradeSide
 * @typedef {import('./types.js').TradeResult} TradeResult
 * @typedef {import('./types.js').TradePhase} TradePhase
 * @typedef {import('./types.js').SignalStrength} SignalStrength
 */

/**
 * @typedef {Object} SignalData
 * @property {Object} decision - Output from decide()
 * @property {Object} indicators - Current indicator values
 * @property {Object} market - Polymarket market data
 * @property {number} currentPrice - Current BTC price (Chainlink)
 * @property {number | null} priceToBeat - Price to beat for this window
 * @property {number} timeLeftMin - Time left in window
 */

/**
 * PaperTradingEngine class - Main orchestrator
 */
export class PaperTradingEngine {
  constructor(options = {}) {
    this.config = { ...PAPER_CONFIG, ...options };
    
    // State
    this.portfolio = this._createInitialPortfolio();
    this.activePosition = null;
    this.currentWindowId = null;
    this.trades = [];
    this.autoTradeEnabled = true;
    this.lastSignalData = null; // Last signal for status API
    this.lastSignalTimestamp = null;
    
    // Callbacks for persistence (will be set by store.js)
    this.onTradeEntered = null;
    this.onTradeResolved = null;
    this.onPortfolioUpdated = null;
    
    // Logger callback (will be set by logger.js)
    this.logger = null;
  }

  /**
   * Create initial portfolio state
   * @returns {PaperPortfolio}
   */
  _createInitialPortfolio() {
    return createPaperPortfolio({}, this.config.initialBalance);
  }

  /**
   * Get portfolio statistics summary
   * @returns {Object}
   */
  getPortfolioStats() {
    return getPortfolioStats(this.portfolio);
  }

  /**
   * Generate unique trade ID
   */
  _generateTradeId() {
    return `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Get current window identifier
   */
  _getWindowId() {
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
    return `window_${timing.startMs}`;
  }

  /**
   * Check if we already have a position in this window
   */
  hasPositionInCurrentWindow() {
    const windowId = this._getWindowId();
    return this.activePosition !== null && this.currentWindowId === windowId;
  }

  /**
   * Entry Filter: RSI extreme filter
   * Skip UP if RSI > 80, skip DOWN if RSI < 20
   */
  _passesRsiFilter(side, rsi) {
    if (rsi === null || rsi === undefined) return true;
    if (side === "UP" && rsi > 80) return false;
    if (side === "DOWN" && rsi < 20) return false;
    return true;
  }

  /**
   * Entry Filter: Trend alignment
   * Require 3+ indicators aligned with trade direction
   */
  _passesTrendAlignment(side, indicators) {
    const { vwapSlope, rsi, rsiSlope, macd, heikenColor } = indicators;
    let aligned = 0;

    // VWAP slope alignment
    if (side === "UP" && vwapSlope > 0) aligned++;
    if (side === "DOWN" && vwapSlope < 0) aligned++;

    // RSI alignment
    if (side === "UP" && rsi > 50 && rsiSlope > 0) aligned++;
    if (side === "DOWN" && rsi < 50 && rsiSlope < 0) aligned++;

    // MACD alignment
    if (macd?.hist !== null) {
      if (side === "UP" && macd.hist > 0) aligned++;
      if (side === "DOWN" && macd.hist < 0) aligned++;
    }

    // Heiken Ashi alignment
    if (heikenColor) {
      if (side === "UP" && heikenColor.toLowerCase() === "green") aligned++;
      if (side === "DOWN" && heikenColor.toLowerCase() === "red") aligned++;
    }

    return aligned >= this.config.minIndicatorsAligned;
  }

  /**
   * Entry Filter: Losing streak pause
   * Pause after 4 consecutive losses
   */
  _passesLosingStreakFilter() {
    return this.portfolio.consecutiveLosses < this.config.maxConsecutiveLosses;
  }

  /**
   * Check all entry filters
   * @returns {{ pass: boolean, reason: string | null }}
   */
  checkEntryFilters(signalData) {
    const { decision, indicators } = signalData;
    const { side } = decision;

    // One position per window
    if (this.hasPositionInCurrentWindow()) {
      return { pass: false, reason: "position_exists_in_window" };
    }

    // Active position check
    if (this.activePosition !== null) {
      return { pass: false, reason: "active_position_exists" };
    }

    // Losing streak pause
    if (!this._passesLosingStreakFilter()) {
      return { pass: false, reason: "losing_streak_pause" };
    }

    // RSI extreme filter
    if (!this._passesRsiFilter(side, indicators.rsi)) {
      return { pass: false, reason: "rsi_extreme" };
    }

    // Trend alignment
    if (!this._passesTrendAlignment(side, indicators)) {
      return { pass: false, reason: "insufficient_trend_alignment" };
    }

    return { pass: true, reason: null };
  }

  /**
   * Calculate position size using Half-Kelly criterion
   * Uses conservative Half-Kelly sizing with drawdown adjustment and constraints
   * Implementation in sizing.js
   * 
   * @param {number} edge - Signal edge (0-1)
   * @param {number} balance - Current portfolio balance
   * @returns {number} Position size in USD
   */
  calculatePositionSize(edge, balance) {
    // Use Half-Kelly sizing with hybrid strategy (picks more conservative of Kelly/edge-based)
    // Includes drawdown adjustment based on peak balance
    const peakBalance = this.portfolio?.peakBalance || balance;
    
    // Get detailed sizing result for logging
    const sizingResult = calcPositionSizeDetails({
      edge,
      balance,
      peakBalance,
      strategy: "kelly" // Use Half-Kelly directly for conservative sizing
    });
    
    // Log sizing details for transparency
    this._log("POSITION_SIZING", {
      edge,
      balance,
      peakBalance,
      method: sizingResult.method,
      size: sizingResult.size,
      details: {
        winProb: sizingResult.details.winProb,
        kellyFraction: sizingResult.details.kellyFraction,
        cappedFraction: sizingResult.details.cappedFraction,
        drawdownFactor: sizingResult.details.drawdownFactor
      }
    });
    
    return sizingResult.size;
  }

  /**
   * Enter a paper trade
   * @param {Object} signalData - Signal data from probability engine
   * @returns {Promise<{success: boolean, trade?: PaperTrade, reason?: string}>}
   */
  async enterTrade(signalData) {
    const { decision, indicators, market, currentPrice, priceToBeat, timeLeftMin } = signalData;
    const { side, phase, strength, edge } = decision;

    // Check filters
    const filterResult = this.checkEntryFilters(signalData);
    if (!filterResult.pass) {
      this._log("TRADE_FILTERED", { reason: filterResult.reason, side, edge });
      return { success: false, reason: filterResult.reason };
    }

    // Calculate position size
    const positionSize = this.calculatePositionSize(edge, this.portfolio.balance);
    if (positionSize < this.config.minPosition) {
      this._log("TRADE_FILTERED", { reason: "position_too_small", positionSize });
      return { success: false, reason: "position_too_small" };
    }

    // Get market info
    const marketId = market?.slug || market?.id || "unknown";
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

    // Create trade using PaperTrade factory for validated interface
    const trade = createPaperTrade({
      id: generateTradeId(),
      marketId,
      side,
      entryPrice: currentPrice,
      priceToBeat,
      positionSize,
      entryTimestamp: Date.now(),
      windowEndMs: timing.endMs,
      indicators: createIndicatorsSnapshot({
        rsi: indicators.rsi,
        rsiSlope: indicators.rsiSlope,
        vwap: indicators.vwap,
        vwapSlope: indicators.vwapSlope,
        macd: indicators.macd,
        heikenColor: indicators.heikenColor,
        heikenCount: indicators.heikenCount
      }),
      phase,
      strength,
      edge,
      timeLeftAtEntry: timeLeftMin
    });

    // Update state
    this.activePosition = trade;
    this.currentWindowId = this._getWindowId();
    this.trades.push(trade);

    // Log and persist
    this._log("TRADE_ENTERED", trade);
    if (this.onTradeEntered) {
      await this.onTradeEntered(trade, this.portfolio);
    }

    return { success: true, trade };
  }

  /**
   * Resolve an active trade when window ends
   * Compares final BTC price vs priceToBeat to determine WIN/LOSS
   * 
   * Resolution logic:
   * - UP trade: WIN if finalPrice > priceToBeat, LOSS otherwise
   * - DOWN trade: WIN if finalPrice < priceToBeat, LOSS otherwise
   * 
   * @param {number} finalPrice - Final BTC price at window end
   * @returns {Promise<{success: boolean, trade?: PaperTrade, result?: string, pnl?: number}>}
   */
  async resolveTrade(finalPrice) {
    if (!this.activePosition) {
      return { success: false, reason: "no_active_position" };
    }

    const trade = this.activePosition;
    const { side, priceToBeat, positionSize, entryPrice } = trade;

    // ============================================================
    // Determine win/loss by comparing BTC price vs priceToBeat
    // UP bet wins if BTC price ended ABOVE priceToBeat
    // DOWN bet wins if BTC price ended BELOW priceToBeat
    // ============================================================
    const priceVsPriceToBeat = finalPrice - priceToBeat;
    const priceVsPctChange = ((finalPrice - priceToBeat) / priceToBeat) * 100;
    
    let result;
    if (side === "UP") {
      result = finalPrice > priceToBeat ? "WIN" : "LOSS";
    } else {
      result = finalPrice < priceToBeat ? "WIN" : "LOSS";
    }

    // Calculate P&L (binary market: win = ~95% return, loss = -100%)
    // Polymarket typically has ~5% vig
    const winMultiplier = 0.95;
    let pnl;
    if (result === "WIN") {
      pnl = positionSize * winMultiplier;
    } else {
      pnl = -positionSize;
    }

    // Update trade
    trade.result = result;
    trade.exitPrice = finalPrice;
    trade.pnl = pnl;
    trade.resolvedTimestamp = Date.now();

    // Update portfolio using the typed function
    this.portfolio = updatePortfolioAfterTrade(this.portfolio, { result, pnl });

    // Clear active position
    this.activePosition = null;

    // Log resolution with complete BTC price vs priceToBeat details
    this._log("TRADE_RESOLVED", {
      tradeId: trade.id,
      side: trade.side,
      result,
      pnl,
      btcPriceComparison: {
        finalPrice,
        priceToBeat,
        difference: priceVsPriceToBeat,
        percentChange: priceVsPctChange.toFixed(3) + "%",
        direction: finalPrice > priceToBeat ? "ABOVE" : finalPrice < priceToBeat ? "BELOW" : "EQUAL"
      },
      trade: {
        entryPrice: trade.entryPrice,
        positionSize: trade.positionSize,
        edge: trade.edge,
        phase: trade.phase
      },
      portfolio: serializePaperPortfolio(this.portfolio)
    });

    if (this.onTradeResolved) {
      await this.onTradeResolved(trade, this.portfolio, finalPrice);
    }
    if (this.onPortfolioUpdated) {
      await this.onPortfolioUpdated(this.portfolio);
    }

    return { success: true, trade, result, pnl };
  }

  /**
   * Process a signal tick - main loop integration point
   * Called from src/index.js on each poll
   */
  async processTick(signalData) {
    if (!this.config.enabled) {
      return { action: "DISABLED" };
    }

    // Store latest signal data for status API
    this.lastSignalData = signalData;
    this.lastSignalTimestamp = Date.now();

    const { decision, currentPrice, priceToBeat } = signalData;
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);
    const windowId = this._getWindowId();

    // ============================================================
    // AUTO-RESOLVE: Check if we need to resolve an active trade
    // Resolution triggers when window ends (windowEndMs has passed)
    // ============================================================
    if (this.activePosition) {
      const now = Date.now();
      const windowEnded = now >= this.activePosition.windowEndMs;
      const windowChanged = this.currentWindowId !== windowId;
      
      if (windowEnded || windowChanged) {
        // Window ended, auto-resolve the trade by comparing BTC price vs priceToBeat
        const finalPrice = currentPrice;
        const tradePriceToBeat = this.activePosition.priceToBeat;
        const tradeSide = this.activePosition.side;
        
        this._log("AUTO_RESOLVE_TRIGGERED", {
          tradeId: this.activePosition.id,
          side: tradeSide,
          finalPrice,
          priceToBeat: tradePriceToBeat,
          priceVsPriceToBeat: finalPrice > tradePriceToBeat ? "ABOVE" : finalPrice < tradePriceToBeat ? "BELOW" : "EQUAL",
          expectedOutcome: tradeSide === "UP" 
            ? (finalPrice > tradePriceToBeat ? "WIN" : "LOSS")
            : (finalPrice < tradePriceToBeat ? "WIN" : "LOSS"),
          windowEnded,
          windowChanged,
          windowEndMs: this.activePosition.windowEndMs,
          now
        });
        
        const resolveResult = await this.resolveTrade(finalPrice);
        
        if (resolveResult.success) {
          return { 
            action: "TRADE_RESOLVED", 
            trade: resolveResult.trade, 
            result: resolveResult.result, 
            pnl: resolveResult.pnl,
            finalPrice,
            priceToBeat: tradePriceToBeat
          };
        }
      }
    }

    // Log signal
    this._log("SIGNAL_GENERATED", {
      decision,
      timeLeft: timing.remainingMinutes,
      hasActivePosition: this.activePosition !== null
    });

    // Check if we should enter a trade
    if (this.autoTradeEnabled && decision.action === "ENTER" && !this.activePosition) {
      const result = await this.enterTrade(signalData);
      return { action: "TRADE_ENTERED", ...result };
    }

    if (this.activePosition) {
      return { action: "POSITION_ACTIVE", trade: this.activePosition };
    }

    return { action: "NO_TRADE", reason: decision.reason };
  }

  /**
   * Check if active position should be resolved
   * Called to manually check for resolution
   */
  shouldResolve() {
    if (!this.activePosition) return false;
    const now = Date.now();
    return now >= this.activePosition.windowEndMs;
  }

  /**
   * Toggle auto-trading
   */
  setAutoTradeEnabled(enabled) {
    this.autoTradeEnabled = enabled;
    this._log("CONFIG_CHANGED", { autoTradeEnabled: enabled });
  }

  /**
   * Get current status
   */
  getStatus() {
    // Extract current signal info safely
    const currentSignal = this.lastSignalData ? {
      side: this.lastSignalData.decision?.side ?? null,
      action: this.lastSignalData.decision?.action ?? null,
      edge: this.lastSignalData.decision?.edge ?? null,
      phase: this.lastSignalData.decision?.phase ?? null,
      strength: this.lastSignalData.decision?.strength ?? null,
      reason: this.lastSignalData.decision?.reason ?? null,
      indicators: this.lastSignalData.indicators ?? null,
      market: {
        upPrice: this.lastSignalData.market?.upPrice ?? this.lastSignalData.market?.prices?.up ?? null,
        downPrice: this.lastSignalData.market?.downPrice ?? this.lastSignalData.market?.prices?.down ?? null
      },
      currentPrice: this.lastSignalData.currentPrice ?? null,
      priceToBeat: this.lastSignalData.priceToBeat ?? null,
      timeLeftMin: this.lastSignalData.timeLeftMin ?? null,
      timestamp: this.lastSignalTimestamp
    } : null;

    return {
      enabled: this.config.enabled,
      autoTradeEnabled: this.autoTradeEnabled,
      portfolio: { ...this.portfolio },
      activePosition: this.activePosition ? { ...this.activePosition } : null,
      currentSignal,
      currentWindowId: this.currentWindowId,
      tradesCount: this.trades.length,
      timestamp: Date.now()
    };
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit = 20) {
    return this.trades.slice(-limit).map(t => ({ ...t }));
  }

  /**
   * Generate session summary with total trades, wins, losses, P&L
   * @returns {Object} Session summary data
   */
  generateSessionSummary() {
    const resolvedTrades = this.trades.filter(t => t.result !== "PENDING" && t.result !== null);
    const wins = resolvedTrades.filter(t => t.result === "WIN");
    const losses = resolvedTrades.filter(t => t.result === "LOSS");
    
    const totalTrades = resolvedTrades.length;
    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = totalTrades > 0 ? winCount / totalTrades : 0;
    const totalPnl = resolvedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    // Calculate session duration
    const sessionStartMs = this.trades.length > 0 
      ? Math.min(...this.trades.map(t => t.entryTimestamp)) 
      : Date.now();
    const sessionEndMs = Date.now();
    const sessionDurationMs = sessionEndMs - sessionStartMs;
    const sessionDurationMin = Math.floor(sessionDurationMs / 60_000);
    
    // Calculate average trade metrics
    const avgPositionSize = totalTrades > 0 
      ? resolvedTrades.reduce((sum, t) => sum + t.positionSize, 0) / totalTrades 
      : 0;
    const avgEdge = totalTrades > 0 
      ? resolvedTrades.reduce((sum, t) => sum + (t.edge || 0), 0) / totalTrades 
      : 0;
    const avgPnlPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
    
    // Calculate Sharpe ratio (simplified: mean return / std dev of returns)
    // Returns are calculated as P&L percentage of position size
    let sharpeRatio = 0;
    if (totalTrades >= 2) {
      const returns = resolvedTrades.map(t => {
        // Return as percentage of position size
        const ret = t.positionSize > 0 ? (t.pnl || 0) / t.positionSize : 0;
        return ret;
      });
      
      const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      
      // Sharpe = mean / stdDev (with protection against division by zero)
      // Annualized by multiplying by sqrt(trades per year) - simplified to sqrt(252) for daily equivalent
      // But for paper trading we'll use a simpler per-trade Sharpe
      sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;
    }
    
    // Win/Loss streaks
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentStreak = 0;
    let lastResult = null;
    
    for (const trade of resolvedTrades) {
      if (trade.result === lastResult) {
        currentStreak++;
      } else {
        currentStreak = 1;
        lastResult = trade.result;
      }
      
      if (trade.result === "WIN") {
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else if (trade.result === "LOSS") {
        maxLossStreak = Math.max(maxLossStreak, currentStreak);
      }
    }
    
    // Best and worst trades
    const bestTrade = totalTrades > 0 
      ? resolvedTrades.reduce((best, t) => (t.pnl || 0) > (best.pnl || 0) ? t : best, resolvedTrades[0])
      : null;
    const worstTrade = totalTrades > 0 
      ? resolvedTrades.reduce((worst, t) => (t.pnl || 0) < (worst.pnl || 0) ? t : worst, resolvedTrades[0])
      : null;
    
    // Breakdown by phase (EARLY/MID/LATE)
    const byPhase = { EARLY: { wins: 0, losses: 0, pnl: 0, trades: 0 }, MID: { wins: 0, losses: 0, pnl: 0, trades: 0 }, LATE: { wins: 0, losses: 0, pnl: 0, trades: 0 } };
    for (const trade of resolvedTrades) {
      const phase = trade.phase || 'MID';
      if (byPhase[phase]) {
        byPhase[phase].trades++;
        byPhase[phase].pnl += trade.pnl || 0;
        if (trade.result === 'WIN') {
          byPhase[phase].wins++;
        } else if (trade.result === 'LOSS') {
          byPhase[phase].losses++;
        }
      }
    }
    // Calculate win rate per phase
    for (const phase of ['EARLY', 'MID', 'LATE']) {
      const p = byPhase[phase];
      p.winRate = p.trades > 0 ? p.wins / p.trades : 0;
    }
    
    // Breakdown by strength (STRONG/GOOD/OPTIONAL)
    const byStrength = { STRONG: { wins: 0, losses: 0, pnl: 0, trades: 0 }, GOOD: { wins: 0, losses: 0, pnl: 0, trades: 0 }, OPTIONAL: { wins: 0, losses: 0, pnl: 0, trades: 0 } };
    for (const trade of resolvedTrades) {
      const strength = trade.strength || 'GOOD';
      if (byStrength[strength]) {
        byStrength[strength].trades++;
        byStrength[strength].pnl += trade.pnl || 0;
        if (trade.result === 'WIN') {
          byStrength[strength].wins++;
        } else if (trade.result === 'LOSS') {
          byStrength[strength].losses++;
        }
      }
    }
    // Calculate win rate per strength
    for (const strength of ['STRONG', 'GOOD', 'OPTIONAL']) {
      const s = byStrength[strength];
      s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
    }
    
    return {
      // Core stats
      totalTrades,
      wins: winCount,
      losses: lossCount,
      winRate,
      totalPnl,
      finalBalance: this.portfolio.balance,
      initialBalance: this.config.initialBalance,
      returnPct: ((this.portfolio.balance - this.config.initialBalance) / this.config.initialBalance) * 100,
      sharpeRatio,
      
      // Portfolio state
      maxDrawdown: this.portfolio.maxDrawdown,
      peakBalance: this.portfolio.peakBalance,
      
      // Session timing
      sessionStartMs,
      sessionEndMs,
      sessionDurationMin,
      
      // Averages
      avgPositionSize,
      avgEdge,
      avgPnlPerTrade,
      
      // Streaks
      maxWinStreak,
      maxLossStreak,
      currentLosingStreak: this.portfolio.consecutiveLosses,
      
      // Best/worst trades
      bestTrade: bestTrade ? {
        id: bestTrade.id,
        side: bestTrade.side,
        pnl: bestTrade.pnl,
        edge: bestTrade.edge
      } : null,
      worstTrade: worstTrade ? {
        id: worstTrade.id,
        side: worstTrade.side,
        pnl: worstTrade.pnl,
        edge: worstTrade.edge
      } : null,
      
      // Phase breakdown
      byPhase,
      
      // Strength breakdown
      byStrength,
      
      // Pending trades
      pendingTrades: this.trades.filter(t => t.result === "PENDING" || t.result === null).length,
      activePosition: this.activePosition ? {
        id: this.activePosition.id,
        side: this.activePosition.side,
        positionSize: this.activePosition.positionSize
      } : null
    };
  }

  /**
   * Get equity curve data points
   */
  getEquityCurve() {
    const points = [{ timestamp: 0, balance: this.config.initialBalance }];
    let runningBalance = this.config.initialBalance;

    for (const trade of this.trades) {
      if (trade.result !== "PENDING" && trade.pnl !== null) {
        runningBalance += trade.pnl;
        points.push({
          timestamp: trade.resolvedTimestamp || trade.entryTimestamp,
          balance: runningBalance,
          tradeId: trade.id,
          result: trade.result
        });
      }
    }

    return points;
  }

  /**
   * Load state from persistence
   */
  loadState({ portfolio, trades, activePosition, autoTradeEnabled }) {
    if (portfolio) {
      this.portfolio = deserializePaperPortfolio(portfolio, this.config.initialBalance);
    }
    if (trades) {
      this.trades = trades;
    }
    if (activePosition) {
      this.activePosition = activePosition;
      // Restore window ID from active position
      if (activePosition.windowEndMs) {
        const windowMs = CONFIG.candleWindowMinutes * 60_000;
        const startMs = activePosition.windowEndMs - windowMs;
        this.currentWindowId = `window_${startMs}`;
      }
    }
    if (autoTradeEnabled !== undefined) {
      this.autoTradeEnabled = autoTradeEnabled;
    }
  }

  /**
   * Internal logging helper
   */
  _log(event, data) {
    // The logger uses specific methods, not a generic log method
    // This is used for internal debugging, not critical logging
    if (this.logger && typeof this.logger[event?.toLowerCase?.()?.replace(/_/g, '')] === 'function') {
      // Skip - specific logging is handled elsewhere
    }
    // Internal events are logged via the direct log functions in logger.js
  }

  /**
   * Reset portfolio (for testing/restart)
   */
  reset() {
    this.portfolio = this._createInitialPortfolio();
    this.activePosition = null;
    this.currentWindowId = null;
    this.trades = [];
    this._log("PORTFOLIO_RESET", { initialBalance: this.config.initialBalance });
  }
}

// Singleton instance for global access
let engineInstance = null;

/**
 * Get or create the paper trading engine instance
 */
export function getPaperTradingEngine(options = {}) {
  if (!engineInstance) {
    engineInstance = new PaperTradingEngine(options);
  }
  return engineInstance;
}

/**
 * Create a fresh engine instance (for testing)
 */
export function createPaperTradingEngine(options = {}) {
  return new PaperTradingEngine(options);
}

export default PaperTradingEngine;
