/**
 * Paper Trading Type Definitions
 * 
 * Central type definitions for the paper trading system.
 * Uses JSDoc for type documentation and validation.
 */

// ============================================================
// Core Trade Types
// ============================================================

/**
 * @typedef {'UP' | 'DOWN'} TradeSide
 * Direction of the trade
 */

/**
 * @typedef {'PENDING' | 'WIN' | 'LOSS'} TradeResult
 * Result of the trade
 */

/**
 * @typedef {'EARLY' | 'MID' | 'LATE'} TradePhase
 * Phase within the 15-minute window when trade was entered
 */

/**
 * @typedef {'STRONG' | 'GOOD' | 'OPTIONAL'} SignalStrength
 * Strength classification of the trading signal
 */

// ============================================================
// PaperPortfolio Interface
// ============================================================

/**
 * @typedef {Object} PaperPortfolio
 * Complete portfolio state with tracking metrics
 * 
 * @property {number} balance - Current portfolio balance in USD
 * @property {number} totalPnl - Total profit/loss since inception
 * @property {number} wins - Total number of winning trades
 * @property {number} losses - Total number of losing trades
 * @property {number} winRate - Win rate as decimal (0-1), e.g., 0.58 = 58%
 * @property {number} maxDrawdown - Maximum drawdown experienced as decimal (0-1)
 * @property {number} peakBalance - Peak balance for drawdown calculation
 * @property {number} consecutiveLosses - Current consecutive losing streak
 */

// ============================================================
// Indicators Snapshot
// ============================================================

/**
 * @typedef {Object} IndicatorsSnapshot
 * Snapshot of technical indicators at trade entry
 * 
 * @property {number | null} rsi - RSI value (0-100)
 * @property {number | null} rsiSlope - RSI slope/momentum
 * @property {number | null} vwap - Volume Weighted Average Price
 * @property {number | null} vwapSlope - VWAP slope/direction
 * @property {Object | null} macd - MACD indicator values
 * @property {number | null} macd.line - MACD line
 * @property {number | null} macd.signal - Signal line
 * @property {number | null} macd.hist - Histogram value
 * @property {string | null} heikenColor - Heiken Ashi candle color ('green' | 'red')
 * @property {number | null} heikenCount - Consecutive Heiken Ashi candles of same color
 * @property {number | null} priceMomentum5m - 5-minute price change percentage
 * @property {number | null} volumeRatio - Volume ratio (recent vs average, e.g., 1.5 = 150% of avg)
 * @property {number | null} vwapDistancePct - VWAP distance percentage (positive = above, negative = below)
 * @property {number | null} adx - ADX value (0-100), trend strength indicator
 * @property {number | null} plusDI - +DI directional indicator (0-100)
 * @property {number | null} minusDI - -DI directional indicator (0-100)
 * @property {string | null} adxTrend - ADX trend classification ('TRENDING' | 'RANGING')
 * @property {string | null} detectedRegime - Combined regime: 'TRENDING' | 'RANGING'
 * @property {string | null} recommendedStrategy - Strategy for regime: 'TREND_FOLLOW' | 'MEAN_REVERT'
 * @property {number | null} regimeConfidence - Regime detection confidence (0-100)
 * @property {number | null} upImbalance - Bid/ask imbalance for UP outcome (-1 to 1)
 * @property {number | null} downImbalance - Bid/ask imbalance for DOWN outcome (-1 to 1)
 * @property {number | null} netImbalance - Net imbalance (UP - DOWN), positive favors UP
 * @property {string | null} smartMoneySignal - Smart money signal when |netImbalance| > 0.3 ('UP' | 'DOWN' | null)
 */

// ============================================================
// PaperTrade Interface
// ============================================================

/**
 * @typedef {Object} PaperTrade
 * Complete paper trade record with all required fields
 * 
 * @property {string} id - Unique trade identifier (format: trade_{timestamp}_{random})
 * @property {string} marketId - Polymarket market ID/slug
 * @property {TradeSide} side - Trade direction ('UP' | 'DOWN')
 * @property {number} entryPrice - BTC price at entry (from Chainlink/Binance)
 * @property {number} positionSize - Position size in USD
 * @property {IndicatorsSnapshot} indicators - Snapshot of indicators at entry
 * @property {TradeResult} result - Trade result ('PENDING' | 'WIN' | 'LOSS')
 * @property {number} priceToBeat - BTC price that determines win/loss
 * @property {number} entryTimestamp - Unix timestamp (ms) of trade entry
 * @property {number} windowEndMs - Unix timestamp (ms) when 15min window ends
 * @property {number | null} exitPrice - BTC price at resolution (null if pending)
 * @property {number | null} pnl - Profit/Loss in USD (null if pending)
 * @property {number | null} resolvedTimestamp - Unix timestamp (ms) of resolution (null if pending)
 * @property {TradePhase} phase - Entry phase within window
 * @property {SignalStrength} strength - Signal strength at entry
 * @property {number} edge - Edge value at entry (0-1)
 * @property {number} timeLeftAtEntry - Minutes remaining in window at entry
 */

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create a new PaperTrade object with validated fields
 * 
 * @param {Object} params - Trade parameters
 * @param {string} params.id - Unique trade identifier
 * @param {string} params.marketId - Polymarket market ID
 * @param {TradeSide} params.side - Trade direction
 * @param {number} params.entryPrice - Entry price
 * @param {number} params.priceToBeat - Price to beat
 * @param {number} params.positionSize - Position size in USD
 * @param {number} params.entryTimestamp - Entry timestamp
 * @param {number} params.windowEndMs - Window end timestamp
 * @param {IndicatorsSnapshot} params.indicators - Indicators snapshot
 * @param {TradePhase} params.phase - Entry phase
 * @param {SignalStrength} params.strength - Signal strength
 * @param {number} params.edge - Edge value
 * @param {number} params.timeLeftAtEntry - Time left at entry
 * @returns {PaperTrade}
 */
export function createPaperTrade(params) {
  const {
    id,
    marketId,
    side,
    entryPrice,
    priceToBeat,
    positionSize,
    entryTimestamp,
    windowEndMs,
    indicators,
    phase,
    strength,
    edge,
    timeLeftAtEntry
  } = params;

  // Validate required fields
  if (!id || typeof id !== 'string') {
    throw new Error('PaperTrade: id is required and must be a string');
  }
  if (!marketId || typeof marketId !== 'string') {
    throw new Error('PaperTrade: marketId is required and must be a string');
  }
  if (!['UP', 'DOWN'].includes(side)) {
    throw new Error('PaperTrade: side must be "UP" or "DOWN"');
  }
  if (typeof entryPrice !== 'number' || isNaN(entryPrice)) {
    throw new Error('PaperTrade: entryPrice must be a valid number');
  }
  if (typeof positionSize !== 'number' || positionSize <= 0) {
    throw new Error('PaperTrade: positionSize must be a positive number');
  }
  if (!indicators || typeof indicators !== 'object') {
    throw new Error('PaperTrade: indicators snapshot is required');
  }

  return {
    id,
    marketId,
    side,
    entryPrice,
    priceToBeat,
    positionSize,
    entryTimestamp: entryTimestamp || Date.now(),
    windowEndMs,
    indicators: createIndicatorsSnapshot(indicators),
    result: 'PENDING',
    exitPrice: null,
    pnl: null,
    resolvedTimestamp: null,
    phase: phase || 'MID',
    strength: strength || 'GOOD',
    edge: edge || 0,
    timeLeftAtEntry: timeLeftAtEntry || 0
  };
}

/**
 * Create a normalized indicators snapshot
 * 
 * @param {Object} raw - Raw indicators data
 * @returns {IndicatorsSnapshot}
 */
export function createIndicatorsSnapshot(raw = {}) {
  return {
    rsi: raw.rsi ?? null,
    rsiSlope: raw.rsiSlope ?? null,
    vwap: raw.vwap ?? null,
    vwapSlope: raw.vwapSlope ?? null,
    macd: raw.macd ? {
      line: raw.macd.line ?? null,
      signal: raw.macd.signal ?? null,
      hist: raw.macd.hist ?? null
    } : null,
    heikenColor: raw.heikenColor ?? null,
    heikenCount: raw.heikenCount ?? null,
    priceMomentum5m: raw.priceMomentum5m ?? null,  // 5-minute price momentum
    volumeRatio: raw.volumeRatio ?? null,          // Volume confirmation ratio
    vwapDistancePct: raw.vwapDistancePct ?? null,  // VWAP distance for mean reversion
    adx: raw.adx ?? null,                          // ADX value (0-100)
    plusDI: raw.plusDI ?? null,                    // +DI directional indicator
    minusDI: raw.minusDI ?? null,                  // -DI directional indicator
    adxTrend: raw.adxTrend ?? null,                // ADX trend classification
    detectedRegime: raw.detectedRegime ?? null,    // Combined regime: 'TRENDING' | 'RANGING'
    recommendedStrategy: raw.recommendedStrategy ?? null, // 'TREND_FOLLOW' | 'MEAN_REVERT'
    regimeConfidence: raw.regimeConfidence ?? null, // Regime detection confidence (0-100)
    upImbalance: raw.upImbalance ?? null,           // Bid/ask imbalance for UP outcome (-1 to 1)
    downImbalance: raw.downImbalance ?? null,       // Bid/ask imbalance for DOWN outcome (-1 to 1)
    netImbalance: raw.netImbalance ?? null,         // Net imbalance (UP - DOWN)
    smartMoneySignal: raw.smartMoneySignal ?? null  // Smart money signal ('UP' | 'DOWN' | null)
  };
}

/**
 * Generate a unique trade ID
 * @returns {string}
 */
export function generateTradeId() {
  return `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// PaperPortfolio Factory Functions
// ============================================================

/**
 * Default values for a new portfolio
 */
export const DEFAULT_PORTFOLIO = {
  balance: 10000,
  totalPnl: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  maxDrawdown: 0,
  peakBalance: 10000,
  consecutiveLosses: 0
};

/**
 * Create a new PaperPortfolio object with validated fields
 * 
 * @param {Partial<PaperPortfolio>} params - Portfolio parameters (optional overrides)
 * @param {number} [initialBalance=10000] - Initial balance if not provided in params
 * @returns {PaperPortfolio}
 */
export function createPaperPortfolio(params = {}, initialBalance = 10000) {
  const balance = params.balance ?? initialBalance;
  const peakBalance = params.peakBalance ?? Math.max(balance, initialBalance);
  const wins = params.wins ?? 0;
  const losses = params.losses ?? 0;
  const totalTrades = wins + losses;
  
  return {
    balance,
    totalPnl: params.totalPnl ?? 0,
    wins,
    losses,
    winRate: params.winRate ?? (totalTrades > 0 ? wins / totalTrades : 0),
    maxDrawdown: params.maxDrawdown ?? 0,
    peakBalance,
    consecutiveLosses: params.consecutiveLosses ?? 0
  };
}

/**
 * Update portfolio after a trade resolution
 * 
 * @param {PaperPortfolio} portfolio - Current portfolio state
 * @param {Object} tradeResult - Trade result info
 * @param {'WIN' | 'LOSS'} tradeResult.result - Trade outcome
 * @param {number} tradeResult.pnl - Profit/Loss amount
 * @returns {PaperPortfolio} - Updated portfolio
 */
export function updatePortfolioAfterTrade(portfolio, tradeResult) {
  const { result, pnl } = tradeResult;
  
  const newBalance = portfolio.balance + pnl;
  const newTotalPnl = portfolio.totalPnl + pnl;
  const newWins = result === 'WIN' ? portfolio.wins + 1 : portfolio.wins;
  const newLosses = result === 'LOSS' ? portfolio.losses + 1 : portfolio.losses;
  const totalTrades = newWins + newLosses;
  const newWinRate = totalTrades > 0 ? newWins / totalTrades : 0;
  
  // Update peak and drawdown
  const newPeakBalance = Math.max(newBalance, portfolio.peakBalance);
  const currentDrawdown = newPeakBalance > 0 
    ? (newPeakBalance - newBalance) / newPeakBalance 
    : 0;
  const newMaxDrawdown = Math.max(currentDrawdown, portfolio.maxDrawdown);
  
  // Update consecutive losses
  const newConsecutiveLosses = result === 'LOSS' 
    ? portfolio.consecutiveLosses + 1 
    : 0;
  
  return {
    balance: newBalance,
    totalPnl: newTotalPnl,
    wins: newWins,
    losses: newLosses,
    winRate: newWinRate,
    maxDrawdown: newMaxDrawdown,
    peakBalance: newPeakBalance,
    consecutiveLosses: newConsecutiveLosses
  };
}

// ============================================================
// Validation Functions
// ============================================================

/**
 * Validate that an object conforms to the PaperTrade interface
 * 
 * @param {any} obj - Object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePaperTrade(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Object is null or not an object'] };
  }

  // Required string fields
  if (!obj.id || typeof obj.id !== 'string') {
    errors.push('id: required string field');
  }
  if (!obj.marketId || typeof obj.marketId !== 'string') {
    errors.push('marketId: required string field');
  }
  if (!['UP', 'DOWN'].includes(obj.side)) {
    errors.push('side: must be "UP" or "DOWN"');
  }
  if (!['PENDING', 'WIN', 'LOSS'].includes(obj.result)) {
    errors.push('result: must be "PENDING", "WIN", or "LOSS"');
  }

  // Required number fields
  if (typeof obj.entryPrice !== 'number') {
    errors.push('entryPrice: required number field');
  }
  if (typeof obj.positionSize !== 'number' || obj.positionSize <= 0) {
    errors.push('positionSize: required positive number');
  }

  // Indicators snapshot
  if (!obj.indicators || typeof obj.indicators !== 'object') {
    errors.push('indicators: required object (snapshot)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate that an object conforms to the PaperPortfolio interface
 * 
 * @param {any} obj - Object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePaperPortfolio(obj) {
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Object is null or not an object'] };
  }

  // Required number fields
  if (typeof obj.balance !== 'number' || isNaN(obj.balance)) {
    errors.push('balance: required number field');
  }
  if (typeof obj.totalPnl !== 'number' || isNaN(obj.totalPnl)) {
    errors.push('totalPnl: required number field');
  }
  if (typeof obj.wins !== 'number' || obj.wins < 0 || !Number.isInteger(obj.wins)) {
    errors.push('wins: required non-negative integer');
  }
  if (typeof obj.losses !== 'number' || obj.losses < 0 || !Number.isInteger(obj.losses)) {
    errors.push('losses: required non-negative integer');
  }
  if (typeof obj.winRate !== 'number' || obj.winRate < 0 || obj.winRate > 1) {
    errors.push('winRate: required number between 0 and 1');
  }
  if (typeof obj.maxDrawdown !== 'number' || obj.maxDrawdown < 0 || obj.maxDrawdown > 1) {
    errors.push('maxDrawdown: required number between 0 and 1');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if trade is pending
 * @param {PaperTrade} trade
 * @returns {boolean}
 */
export function isTradePending(trade) {
  return trade.result === 'PENDING';
}

/**
 * Check if trade is resolved (WIN or LOSS)
 * @param {PaperTrade} trade
 * @returns {boolean}
 */
export function isTradeResolved(trade) {
  return trade.result === 'WIN' || trade.result === 'LOSS';
}

/**
 * Check if trade was a win
 * @param {PaperTrade} trade
 * @returns {boolean}
 */
export function isTradeWin(trade) {
  return trade.result === 'WIN';
}

/**
 * Check if trade was a loss
 * @param {PaperTrade} trade
 * @returns {boolean}
 */
export function isTradeLoss(trade) {
  return trade.result === 'LOSS';
}

// ============================================================
// Serialization
// ============================================================

/**
 * Serialize a PaperTrade for JSON storage
 * @param {PaperTrade} trade
 * @returns {Object}
 */
export function serializePaperTrade(trade) {
  return { ...trade };
}

/**
 * Deserialize a PaperTrade from JSON storage
 * @param {Object} data
 * @returns {PaperTrade}
 */
export function deserializePaperTrade(data) {
  return {
    id: data.id,
    marketId: data.marketId,
    side: data.side,
    entryPrice: data.entryPrice,
    priceToBeat: data.priceToBeat,
    positionSize: data.positionSize,
    entryTimestamp: data.entryTimestamp,
    windowEndMs: data.windowEndMs,
    indicators: data.indicators || {},
    result: data.result || 'PENDING',
    exitPrice: data.exitPrice ?? null,
    pnl: data.pnl ?? null,
    resolvedTimestamp: data.resolvedTimestamp ?? null,
    phase: data.phase || 'MID',
    strength: data.strength || 'GOOD',
    edge: data.edge || 0,
    timeLeftAtEntry: data.timeLeftAtEntry || 0
  };
}

/**
 * Serialize a PaperPortfolio for JSON storage
 * @param {PaperPortfolio} portfolio
 * @returns {Object}
 */
export function serializePaperPortfolio(portfolio) {
  return {
    balance: portfolio.balance,
    totalPnl: portfolio.totalPnl,
    wins: portfolio.wins,
    losses: portfolio.losses,
    winRate: portfolio.winRate,
    maxDrawdown: portfolio.maxDrawdown,
    peakBalance: portfolio.peakBalance,
    consecutiveLosses: portfolio.consecutiveLosses
  };
}

/**
 * Deserialize a PaperPortfolio from JSON storage
 * @param {Object} data
 * @param {number} [initialBalance=10000] - Default initial balance
 * @returns {PaperPortfolio}
 */
export function deserializePaperPortfolio(data, initialBalance = 10000) {
  if (!data) {
    return createPaperPortfolio({}, initialBalance);
  }
  
  return createPaperPortfolio({
    balance: data.balance,
    totalPnl: data.totalPnl,
    wins: data.wins,
    losses: data.losses,
    winRate: data.winRate,
    maxDrawdown: data.maxDrawdown,
    peakBalance: data.peakBalance,
    consecutiveLosses: data.consecutiveLosses
  }, initialBalance);
}

/**
 * Calculate portfolio statistics summary
 * @param {PaperPortfolio} portfolio
 * @returns {Object} Summary statistics
 */
export function getPortfolioStats(portfolio) {
  const totalTrades = portfolio.wins + portfolio.losses;
  const avgPnlPerTrade = totalTrades > 0 ? portfolio.totalPnl / totalTrades : 0;
  const returnPct = portfolio.peakBalance > 0 
    ? ((portfolio.balance / (portfolio.peakBalance - portfolio.totalPnl + portfolio.balance)) - 1) * 100
    : 0;
  
  return {
    totalTrades,
    winRatePct: (portfolio.winRate * 100).toFixed(1) + '%',
    maxDrawdownPct: (portfolio.maxDrawdown * 100).toFixed(1) + '%',
    avgPnlPerTrade: avgPnlPerTrade.toFixed(2),
    returnPct: returnPct.toFixed(2) + '%',
    isInDrawdown: portfolio.balance < portfolio.peakBalance,
    drawdownFromPeak: portfolio.peakBalance - portfolio.balance
  };
}

// ============================================================
// Export Types (for JSDoc @typedef imports)
// ============================================================

/**
 * @exports TradeSide
 * @exports TradeResult
 * @exports TradePhase
 * @exports SignalStrength
 * @exports IndicatorsSnapshot
 * @exports PaperTrade
 * @exports PaperPortfolio
 */

export default {
  // Trade functions
  createPaperTrade,
  createIndicatorsSnapshot,
  generateTradeId,
  validatePaperTrade,
  isTradePending,
  isTradeResolved,
  isTradeWin,
  isTradeLoss,
  serializePaperTrade,
  deserializePaperTrade,
  // Portfolio functions
  DEFAULT_PORTFOLIO,
  createPaperPortfolio,
  updatePortfolioAfterTrade,
  validatePaperPortfolio,
  serializePaperPortfolio,
  deserializePaperPortfolio,
  getPortfolioStats
};
