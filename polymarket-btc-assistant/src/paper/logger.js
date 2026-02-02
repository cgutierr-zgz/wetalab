/**
 * Paper Trading Logger
 * 
 * Structured JSONL logging for paper trading activity.
 * Writes to data/paper-trading/activity.jsonl
 * 
 * Event Types:
 * - SIGNAL_GENERATED: Trading signal was generated
 * - TRADE_ENTERED: Paper trade was entered
 * - TRADE_RESOLVED: Trade was resolved (WIN/LOSS)
 * - ERROR: Error occurred during paper trading
 */

import { appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Get project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

// Logger configuration
export const LOGGER_CONFIG = {
  baseDir: join(PROJECT_ROOT, "data/paper-trading"),
  logFile: "activity.jsonl",
  enabled: (process.env.PAPER_LOGGING_ENABLED || "true").toLowerCase() === "true",
  consoleOutput: (process.env.PAPER_LOGGING_CONSOLE || "false").toLowerCase() === "true"
};

// ============================================================
// Event Types
// ============================================================

/**
 * @typedef {'SIGNAL_GENERATED' | 'TRADE_ENTERED' | 'TRADE_RESOLVED' | 'ERROR'} LogEventType
 */

/**
 * @typedef {Object} LogEvent
 * @property {string} timestamp - ISO timestamp
 * @property {number} timestampMs - Unix timestamp in milliseconds
 * @property {LogEventType} event - Event type
 * @property {Object} data - Event-specific data
 * @property {string} [sessionId] - Session identifier
 */

// Session ID for this run
const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ============================================================
// File Operations
// ============================================================

/**
 * Ensure the log directory exists
 */
async function ensureLogDir() {
  if (!existsSync(LOGGER_CONFIG.baseDir)) {
    await mkdir(LOGGER_CONFIG.baseDir, { recursive: true });
  }
}

/**
 * Get full path to the log file
 */
function getLogPath() {
  return join(LOGGER_CONFIG.baseDir, LOGGER_CONFIG.logFile);
}

/**
 * Append a JSON line to the log file
 * @param {LogEvent} event - Event to log
 */
async function appendLogLine(event) {
  if (!LOGGER_CONFIG.enabled) return;
  
  try {
    await ensureLogDir();
    const logPath = getLogPath();
    const line = JSON.stringify(event) + "\n";
    await appendFile(logPath, line, "utf-8");
  } catch (err) {
    console.error("[PaperLogger] Failed to write log:", err.message);
  }
}

// ============================================================
// Core Logging Functions
// ============================================================

/**
 * Create a base log event
 * @param {LogEventType} eventType
 * @param {Object} data
 * @returns {LogEvent}
 */
function createLogEvent(eventType, data) {
  const now = new Date();
  return {
    timestamp: now.toISOString(),
    timestampMs: now.getTime(),
    event: eventType,
    sessionId: SESSION_ID,
    data
  };
}

/**
 * Log an event
 * @param {LogEventType} eventType
 * @param {Object} data
 */
async function logEvent(eventType, data) {
  const event = createLogEvent(eventType, data);
  
  // Console output if enabled
  if (LOGGER_CONFIG.consoleOutput) {
    console.log(`[PaperLogger] ${eventType}:`, JSON.stringify(data, null, 2));
  }
  
  await appendLogLine(event);
  return event;
}

// ============================================================
// Event-Specific Loggers
// ============================================================

/**
 * Log a generated trading signal
 * @param {Object} params
 * @param {string} params.side - Trade direction (UP/DOWN)
 * @param {string} params.action - Decision action (ENTER/WAIT/SKIP)
 * @param {number} params.edge - Edge percentage
 * @param {string} params.phase - Trading phase (EARLY/MID/LATE)
 * @param {string} params.strength - Signal strength (STRONG/GOOD/OPTIONAL)
 * @param {Object} params.indicators - Indicator values
 * @param {Object} params.market - Market data
 * @param {number} params.currentPrice - Current BTC price
 * @param {number | null} params.priceToBeat - Price to beat
 * @param {number} params.timeLeftMin - Time left in window
 * @param {string} [params.reason] - Reason for decision
 */
export async function logSignalGenerated({
  side,
  action,
  edge,
  phase,
  strength,
  indicators,
  market,
  currentPrice,
  priceToBeat,
  timeLeftMin,
  reason
}) {
  return logEvent("SIGNAL_GENERATED", {
    side,
    action,
    edge: Number(edge?.toFixed(4)),
    phase,
    strength,
    indicators: sanitizeIndicators(indicators),
    market: sanitizeMarket(market),
    currentPrice,
    priceToBeat,
    timeLeftMin: Number(timeLeftMin?.toFixed(2)),
    reason
  });
}

/**
 * Log a trade entry
 * @param {Object} params
 * @param {Object} params.trade - The PaperTrade object
 * @param {Object} params.portfolio - Current portfolio state
 * @param {Object} [params.sizingDetails] - Position sizing details
 */
export async function logTradeEntered({
  trade,
  portfolio,
  sizingDetails
}) {
  return logEvent("TRADE_ENTERED", {
    tradeId: trade.id,
    side: trade.side,
    entryPrice: trade.entryPrice,
    positionSize: Number(trade.positionSize?.toFixed(2)),
    priceToBeat: trade.priceToBeat,
    phase: trade.phase,
    strength: trade.strength,
    edge: Number(trade.edge?.toFixed(4)),
    timeLeftAtEntry: trade.timeLeftAtEntry,
    windowEndMs: trade.windowEndMs,
    indicators: sanitizeIndicators(trade.indicators),
    portfolio: {
      balance: Number(portfolio.balance?.toFixed(2)),
      totalPnl: Number(portfolio.totalPnl?.toFixed(2)),
      wins: portfolio.wins,
      losses: portfolio.losses,
      winRate: Number(portfolio.winRate?.toFixed(4))
    },
    sizingDetails: sizingDetails ? {
      strategy: sizingDetails.strategy,
      winProbability: sizingDetails.winProbability,
      kellyFraction: sizingDetails.kellyFraction,
      halfKellyFraction: sizingDetails.halfKellyFraction,
      drawdownAdjustment: sizingDetails.drawdownAdjustment,
      rawSize: sizingDetails.rawSize,
      finalSize: sizingDetails.finalSize
    } : null
  });
}

/**
 * Log a trade resolution
 * @param {Object} params
 * @param {Object} params.trade - The resolved PaperTrade object
 * @param {Object} params.portfolio - Updated portfolio state
 * @param {number} params.finalPrice - Final BTC price at resolution
 */
export async function logTradeResolved({
  trade,
  portfolio,
  finalPrice
}) {
  const priceDiff = finalPrice - trade.priceToBeat;
  const priceDiffPct = (priceDiff / trade.priceToBeat) * 100;
  
  return logEvent("TRADE_RESOLVED", {
    tradeId: trade.id,
    side: trade.side,
    result: trade.result,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    priceToBeat: trade.priceToBeat,
    finalPrice,
    priceDiff: Number(priceDiff?.toFixed(2)),
    priceDiffPct: Number(priceDiffPct?.toFixed(4)),
    positionSize: Number(trade.positionSize?.toFixed(2)),
    pnl: Number(trade.pnl?.toFixed(2)),
    phase: trade.phase,
    strength: trade.strength,
    edge: Number(trade.edge?.toFixed(4)),
    entryTimestamp: trade.entryTimestamp,
    resolvedTimestamp: trade.resolvedTimestamp,
    holdDurationMs: trade.resolvedTimestamp - trade.entryTimestamp,
    portfolio: {
      balance: Number(portfolio.balance?.toFixed(2)),
      totalPnl: Number(portfolio.totalPnl?.toFixed(2)),
      wins: portfolio.wins,
      losses: portfolio.losses,
      winRate: Number(portfolio.winRate?.toFixed(4)),
      maxDrawdown: Number(portfolio.maxDrawdown?.toFixed(4)),
      consecutiveLosses: portfolio.consecutiveLosses
    }
  });
}

/**
 * Log an error
 * @param {Object} params
 * @param {string} params.context - Where the error occurred
 * @param {Error | string} params.error - The error
 * @param {Object} [params.metadata] - Additional context
 */
export async function logError({
  context,
  error,
  metadata
}) {
  const errorData = {
    context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    metadata
  };
  
  // Always log errors to console
  console.error(`[PaperLogger] ERROR in ${context}:`, errorData.message);
  
  return logEvent("ERROR", errorData);
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Sanitize indicator values for logging
 * @param {Object} indicators
 * @returns {Object}
 */
function sanitizeIndicators(indicators) {
  if (!indicators) return null;
  
  // Handle MACD which can be an object {macd, signal, hist} or individual values
  const macdValue = typeof indicators.macd === 'object' && indicators.macd !== null
    ? indicators.macd.macd
    : indicators.macd;
  const macdSignal = typeof indicators.macd === 'object' && indicators.macd !== null
    ? indicators.macd.signal
    : indicators.macdSignal;
  const macdHist = typeof indicators.macd === 'object' && indicators.macd !== null
    ? indicators.macd.hist
    : indicators.macdHist;
  
  return {
    rsi: indicators.rsi != null ? Number(Number(indicators.rsi).toFixed(2)) : null,
    rsiSlope: indicators.rsiSlope != null ? Number(Number(indicators.rsiSlope).toFixed(4)) : null,
    vwap: indicators.vwap != null ? Number(Number(indicators.vwap).toFixed(2)) : null,
    vwapSlope: indicators.vwapSlope != null ? Number(Number(indicators.vwapSlope).toFixed(4)) : null,
    macd: macdValue != null ? Number(Number(macdValue).toFixed(4)) : null,
    macdSignal: macdSignal != null ? Number(Number(macdSignal).toFixed(4)) : null,
    macdHist: macdHist != null ? Number(Number(macdHist).toFixed(4)) : null,
    heikenColor: indicators.heikenColor
  };
}

/**
 * Sanitize market data for logging
 * @param {Object} market
 * @returns {Object}
 */
function sanitizeMarket(market) {
  if (!market) return null;
  
  return {
    upPrice: market.upPrice,
    downPrice: market.downPrice,
    priceToBeat: market.priceToBeat,
    upMidpoint: market.upMidpoint,
    downMidpoint: market.downMidpoint
  };
}

// ============================================================
// PaperLogger Class (for engine integration)
// ============================================================

/**
 * PaperLogger class - Wrapper for engine integration
 */
export class PaperLogger {
  constructor(options = {}) {
    this.enabled = options.enabled ?? LOGGER_CONFIG.enabled;
    this.consoleOutput = options.consoleOutput ?? LOGGER_CONFIG.consoleOutput;
  }

  async signalGenerated(params) {
    if (!this.enabled) return;
    return logSignalGenerated(params);
  }

  async tradeEntered(params) {
    if (!this.enabled) return;
    return logTradeEntered(params);
  }

  async tradeResolved(params) {
    if (!this.enabled) return;
    return logTradeResolved(params);
  }

  async error(params) {
    // Always log errors
    return logError(params);
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let loggerInstance = null;

/**
 * Get the singleton PaperLogger instance
 * @param {Object} [options] - Logger options
 * @returns {PaperLogger}
 */
export function getPaperLogger(options) {
  if (!loggerInstance) {
    loggerInstance = new PaperLogger(options);
  }
  return loggerInstance;
}

// ============================================================
// Engine Integration
// ============================================================

/**
 * Wire logger to paper trading engine
 * Sets up automatic logging for trade events
 * @param {Object} engine - PaperTradingEngine instance
 * @param {PaperLogger} [logger] - Logger instance (uses singleton if not provided)
 */
export function setupLogging(engine, logger) {
  const log = logger || getPaperLogger();
  
  // Store original callbacks
  const originalOnTradeEntered = engine.onTradeEntered;
  const originalOnTradeResolved = engine.onTradeResolved;
  
  // Wrap onTradeEntered to add logging
  engine.onTradeEntered = async (trade, portfolio) => {
    try {
      await log.tradeEntered({ trade, portfolio });
    } catch (err) {
      console.error("[PaperLogger] Failed to log trade entry:", err.message);
    }
    
    // Call original callback if exists
    if (originalOnTradeEntered) {
      await originalOnTradeEntered(trade, portfolio);
    }
  };
  
  // Wrap onTradeResolved to add logging
  engine.onTradeResolved = async (trade, portfolio, finalPrice) => {
    try {
      await log.tradeResolved({ trade, portfolio, finalPrice });
    } catch (err) {
      console.error("[PaperLogger] Failed to log trade resolution:", err.message);
    }
    
    // Call original callback if exists
    if (originalOnTradeResolved) {
      await originalOnTradeResolved(trade, portfolio, finalPrice);
    }
  };
  
  // Set logger instance on engine
  engine.logger = log;
  
  console.log("[PaperLogger] ✅ Logging configured");
  console.log(`[PaperLogger] Log file: ${getLogPath()}`);
  
  return log;
}

// ============================================================
// Exports
// ============================================================

export {
  SESSION_ID,
  getLogPath,
  logEvent
};

export default {
  logSignalGenerated,
  logTradeEntered,
  logTradeResolved,
  logError,
  getPaperLogger,
  setupLogging,
  PaperLogger,
  LOGGER_CONFIG
};
