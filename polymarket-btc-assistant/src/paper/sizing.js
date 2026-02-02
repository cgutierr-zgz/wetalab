/**
 * Position Sizing Module
 * 
 * Implements Half-Kelly criterion and edge-based position sizing
 * for the paper trading system.
 * 
 * Kelly Criterion: f* = (bp - q) / b
 * where:
 *   f* = fraction of bankroll to bet
 *   b  = net odds (payout / stake - 1)
 *   p  = probability of winning
 *   q  = probability of losing (1 - p)
 * 
 * Half-Kelly: f* / 2 for more conservative sizing
 */

// Default position sizing constraints (from env or sensible defaults)
const DEFAULT_CONSTRAINTS = {
  minPosition: Number(process.env.PAPER_MIN_POSITION) || 10,
  maxPosition: Number(process.env.PAPER_MAX_POSITION) || 500,
  maxPositionPct: Number(process.env.PAPER_MAX_POSITION_PCT) || 0.05
};

// Sizing strategy configuration
export const SIZING_CONFIG = {
  // Kelly-related settings
  kellyFraction: 0.5, // Half-Kelly
  minKellyFraction: 0.1, // Minimum Kelly fraction to use
  maxKellyFraction: 0.25, // Cap Kelly at 25% of bankroll
  
  // Edge-based settings  
  edgeMultiplier: 10, // Multiplier for edge-based sizing
  
  // Constraints (defaults from DEFAULT_CONSTRAINTS, can be overridden in applyConstraints)
  minPosition: null, // Will use DEFAULT_CONSTRAINTS.minPosition
  maxPosition: null, // Will use DEFAULT_CONSTRAINTS.maxPosition
  maxPositionPct: null, // Will use DEFAULT_CONSTRAINTS.maxPositionPct
  
  // Risk adjustment
  volatilityAdjustment: true, // Reduce size during high volatility
  drawdownAdjustment: true, // Reduce size during drawdowns
  drawdownThreshold: 0.1, // Start reducing at 10% drawdown
  maxDrawdownReduction: 0.5 // Reduce position size by up to 50%
};

/**
 * Calculate Kelly Criterion fraction
 * 
 * @param {number} winProbability - Estimated probability of winning (0-1)
 * @param {number} odds - Net odds (e.g., 1.0 for even money, 2.0 for 2:1)
 * @returns {number} Kelly fraction (0-1)
 */
export function calculateKelly(winProbability, odds = 1.0) {
  if (winProbability <= 0 || winProbability >= 1) {
    return 0;
  }
  
  if (odds <= 0) {
    return 0;
  }
  
  const p = winProbability;
  const q = 1 - p;
  const b = odds;
  
  // Kelly formula: f* = (bp - q) / b
  const kelly = (b * p - q) / b;
  
  // Kelly can be negative if edge is negative, cap at 0
  return Math.max(0, kelly);
}

/**
 * Calculate Half-Kelly fraction
 * More conservative sizing, reduces volatility and risk of ruin
 * 
 * @param {number} winProbability - Estimated probability of winning (0-1)
 * @param {number} odds - Net odds (default 1.0 for even money)
 * @returns {number} Half-Kelly fraction (0-1)
 */
export function calculateHalfKelly(winProbability, odds = 1.0) {
  const fullKelly = calculateKelly(winProbability, odds);
  return fullKelly * SIZING_CONFIG.kellyFraction;
}

/**
 * Calculate edge-based position size
 * Simple linear scaling based on edge magnitude
 * 
 * @param {number} edge - Edge value (0-1, typically 0.05 to 0.3)
 * @param {number} balance - Current portfolio balance
 * @param {number} [multiplier] - Edge multiplier (default from config)
 * @returns {number} Position size in USD
 */
export function calculateEdgeBased(edge, balance, multiplier = SIZING_CONFIG.edgeMultiplier) {
  if (edge <= 0 || balance <= 0) {
    return 0;
  }
  
  // edge * multiplier gives the fraction of balance
  // e.g., 0.15 edge * 10 multiplier = 1.5% of balance
  const fraction = edge * multiplier / 100;
  return balance * fraction;
}

/**
 * Convert edge to estimated win probability
 * Uses a simple model: base 50% + edge adjustment
 * 
 * @param {number} edge - Edge value (0-1)
 * @returns {number} Estimated win probability (0.5-1)
 */
export function edgeToWinProbability(edge) {
  // Assume edge represents the advantage over 50/50
  // A 10% edge means roughly 60% win probability
  // This is a simplification; in practice, calibrate against historical data
  const baseProb = 0.5;
  const adjustedProb = baseProb + edge * 0.75; // Scale edge to probability
  
  // Clamp to reasonable range
  return Math.min(0.95, Math.max(0.5, adjustedProb));
}

/**
 * Calculate drawdown adjustment factor
 * Reduces position size when in drawdown to preserve capital
 * 
 * @param {number} currentBalance - Current balance
 * @param {number} peakBalance - Peak balance (high water mark)
 * @returns {number} Adjustment factor (0.5-1.0)
 */
export function calculateDrawdownAdjustment(currentBalance, peakBalance) {
  if (!SIZING_CONFIG.drawdownAdjustment || peakBalance <= 0) {
    return 1.0;
  }
  
  const drawdown = (peakBalance - currentBalance) / peakBalance;
  
  if (drawdown <= SIZING_CONFIG.drawdownThreshold) {
    return 1.0;
  }
  
  // Linear reduction from threshold to max reduction
  // At 10% drawdown: 1.0, at 20% drawdown: 0.5
  const excessDrawdown = drawdown - SIZING_CONFIG.drawdownThreshold;
  const maxExcess = 0.20; // Max 20% additional drawdown before full reduction
  const reductionFactor = Math.min(1, excessDrawdown / maxExcess);
  
  return 1.0 - (reductionFactor * SIZING_CONFIG.maxDrawdownReduction);
}

/**
 * Apply position sizing constraints
 * Enforces min/max limits and portfolio percentage cap
 * 
 * @param {number} size - Calculated position size
 * @param {number} balance - Current portfolio balance
 * @param {Object} [config] - Override configuration
 * @returns {number} Constrained position size
 */
export function applyConstraints(size, balance, config = {}) {
  const minPosition = config.minPosition ?? DEFAULT_CONSTRAINTS.minPosition;
  const maxPosition = config.maxPosition ?? DEFAULT_CONSTRAINTS.maxPosition;
  const maxPositionPct = config.maxPositionPct ?? DEFAULT_CONSTRAINTS.maxPositionPct;
  
  let constrained = size;
  
  // Apply min/max absolute constraints
  constrained = Math.max(minPosition, constrained);
  constrained = Math.min(maxPosition, constrained);
  
  // Apply percentage of portfolio cap
  const maxByPct = balance * maxPositionPct;
  constrained = Math.min(maxByPct, constrained);
  
  // Can't bet more than we have
  constrained = Math.min(balance, constrained);
  
  // Round to 2 decimal places
  return Math.floor(constrained * 100) / 100;
}

/**
 * Main position sizing function
 * Combines Half-Kelly with edge-based sizing and applies all constraints
 * 
 * @param {Object} params - Sizing parameters
 * @param {number} params.edge - Signal edge (0-1)
 * @param {number} params.balance - Current portfolio balance
 * @param {number} [params.peakBalance] - Peak balance for drawdown calc
 * @param {number} [params.odds] - Payout odds (default 1.0)
 * @param {'kelly' | 'edge' | 'hybrid'} [params.strategy] - Sizing strategy
 * @returns {{ size: number, method: string, details: Object }}
 */
export function calculatePositionSize({
  edge,
  balance,
  peakBalance = balance,
  odds = 1.0,
  strategy = "hybrid"
}) {
  if (edge <= 0 || balance <= 0) {
    return {
      size: 0,
      method: "none",
      details: { reason: edge <= 0 ? "no_edge" : "no_balance" }
    };
  }

  const details = {
    edge,
    balance,
    peakBalance,
    odds,
    strategy
  };

  let rawSize = 0;
  let method = strategy;

  // Calculate based on strategy
  switch (strategy) {
    case "kelly": {
      const winProb = edgeToWinProbability(edge);
      const kellyFraction = calculateHalfKelly(winProb, odds);
      
      // Cap Kelly fraction
      const cappedFraction = Math.min(
        SIZING_CONFIG.maxKellyFraction,
        Math.max(SIZING_CONFIG.minKellyFraction, kellyFraction)
      );
      
      rawSize = balance * cappedFraction;
      details.winProb = winProb;
      details.kellyFraction = kellyFraction;
      details.cappedFraction = cappedFraction;
      break;
    }
    
    case "edge": {
      rawSize = calculateEdgeBased(edge, balance);
      details.edgeMultiplier = SIZING_CONFIG.edgeMultiplier;
      break;
    }
    
    case "hybrid":
    default: {
      // Use the smaller of Kelly and edge-based for extra safety
      const winProb = edgeToWinProbability(edge);
      const kellyFraction = calculateHalfKelly(winProb, odds);
      const cappedFraction = Math.min(
        SIZING_CONFIG.maxKellyFraction,
        Math.max(SIZING_CONFIG.minKellyFraction, kellyFraction)
      );
      const kellySize = balance * cappedFraction;
      const edgeSize = calculateEdgeBased(edge, balance);
      
      // Take the more conservative (smaller) size
      rawSize = Math.min(kellySize, edgeSize);
      method = kellySize < edgeSize ? "kelly" : "edge";
      
      details.winProb = winProb;
      details.kellyFraction = kellyFraction;
      details.kellySize = kellySize;
      details.edgeSize = edgeSize;
      details.selectedMethod = method;
      break;
    }
  }

  // Apply drawdown adjustment
  const drawdownFactor = calculateDrawdownAdjustment(balance, peakBalance);
  const adjustedSize = rawSize * drawdownFactor;
  details.drawdownFactor = drawdownFactor;
  details.rawSize = rawSize;
  details.adjustedSize = adjustedSize;

  // Apply constraints
  const finalSize = applyConstraints(adjustedSize, balance);
  details.finalSize = finalSize;

  return {
    size: finalSize,
    method,
    details
  };
}

/**
 * Quick position sizing for paper trading engine integration
 * Simple interface that returns just the size
 * 
 * @param {number} edge - Signal edge
 * @param {number} balance - Current balance
 * @param {number} [peakBalance] - Peak balance (optional)
 * @returns {number} Position size in USD
 */
export function getPositionSize(edge, balance, peakBalance = balance) {
  const result = calculatePositionSize({
    edge,
    balance,
    peakBalance,
    strategy: "hybrid"
  });
  
  return result.size;
}

// Default export for convenience
export default {
  calculateKelly,
  calculateHalfKelly,
  calculateEdgeBased,
  calculatePositionSize,
  getPositionSize,
  applyConstraints,
  edgeToWinProbability,
  calculateDrawdownAdjustment,
  SIZING_CONFIG
};
