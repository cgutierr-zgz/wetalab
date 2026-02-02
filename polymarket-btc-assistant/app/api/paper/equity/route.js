/**
 * Paper Trading Equity Curve API
 * 
 * Returns equity curve data points for charting portfolio balance over time.
 * Builds the equity curve from resolved trades history.
 * 
 * GET /api/paper/equity
 * Query params:
 *   - limit: max number of data points (default: 100)
 *   - interval: time interval grouping ("trade" | "hour" | "day") (default: "trade")
 *   - from: start timestamp (optional, unix ms)
 *   - to: end timestamp (optional, unix ms)
 * 
 * Response:
 * {
 *   "ok": true,
 *   "curve": [
 *     { "timestamp": 1234567890000, "balance": 10000, "pnl": 0, "tradeId": null },
 *     { "timestamp": 1234567899000, "balance": 10095, "pnl": 95, "tradeId": "trade_xxx" }
 *   ],
 *   "summary": {
 *     "startBalance": 10000,
 *     "endBalance": 10500,
 *     "totalPnl": 500,
 *     "totalPnlPct": 5.0,
 *     "peakBalance": 10600,
 *     "maxDrawdown": 0.02,
 *     "maxDrawdownPct": 2.0,
 *     "totalTrades": 50,
 *     "winningTrades": 30,
 *     "losingTrades": 20,
 *     "winRate": 0.6
 *   },
 *   "meta": {
 *     "interval": "trade",
 *     "from": null,
 *     "to": null,
 *     "dataPoints": 51
 *   },
 *   "timestamp": 1234567890000
 * }
 */

import { loadTrades, loadPortfolio } from "../../../../src/paper/store.js";
import { PAPER_CONFIG } from "../../../../src/paper/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function jsonError(message, status = 400, details) {
  return jsonResponse(
    { error: message, ...(details ? { details } : {}) },
    status
  );
}

/**
 * Parse and validate query parameters
 */
function parseQueryParams(url) {
  const { searchParams } = new URL(url);
  
  // Parse limit
  let limit = parseInt(searchParams.get("limit") || DEFAULT_LIMIT, 10);
  if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  
  // Parse interval
  const intervalParam = searchParams.get("interval");
  const interval = intervalParam && ["trade", "hour", "day"].includes(intervalParam.toLowerCase())
    ? intervalParam.toLowerCase()
    : "trade";
  
  // Parse from/to timestamps
  let from = parseInt(searchParams.get("from") || "0", 10);
  if (isNaN(from) || from < 0) from = null;
  
  let to = parseInt(searchParams.get("to") || "0", 10);
  if (isNaN(to) || to <= 0) to = null;
  
  return { limit, interval, from, to };
}

/**
 * Get initial balance from config/portfolio
 */
function getInitialBalance() {
  const envBalance = process.env.PAPER_INITIAL_BALANCE;
  if (envBalance) {
    const parsed = parseFloat(envBalance);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return PAPER_CONFIG.initialBalance || 10000;
}

/**
 * Build equity curve from resolved trades
 * Each data point represents the portfolio balance after a trade resolution
 */
function buildEquityCurve(trades, initialBalance, options = {}) {
  const { from, to } = options;
  
  // Filter to resolved trades only and sort by resolution timestamp
  const resolvedTrades = trades
    .filter(t => t.result && t.result !== "PENDING" && t.resolvedTimestamp)
    .filter(t => !from || t.resolvedTimestamp >= from)
    .filter(t => !to || t.resolvedTimestamp <= to)
    .sort((a, b) => a.resolvedTimestamp - b.resolvedTimestamp);
  
  // Start with initial balance point
  const curve = [];
  let runningBalance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  
  // Add initial point (before any trades)
  if (resolvedTrades.length > 0) {
    const firstTradeTime = resolvedTrades[0].entryTimestamp || resolvedTrades[0].resolvedTimestamp;
    curve.push({
      timestamp: firstTradeTime - 1, // Just before first trade
      balance: initialBalance,
      pnl: 0,
      cumulativePnl: 0,
      tradeId: null,
      result: null,
      drawdown: 0
    });
  }
  
  // Build curve from trades
  let cumulativePnl = 0;
  
  for (const trade of resolvedTrades) {
    const pnl = trade.pnl || 0;
    runningBalance += pnl;
    cumulativePnl += pnl;
    
    // Track peak and drawdown
    if (runningBalance > peakBalance) {
      peakBalance = runningBalance;
    }
    const currentDrawdown = peakBalance > 0 
      ? (peakBalance - runningBalance) / peakBalance 
      : 0;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }
    
    curve.push({
      timestamp: trade.resolvedTimestamp,
      balance: runningBalance,
      pnl: pnl,
      cumulativePnl: cumulativePnl,
      tradeId: trade.id,
      result: trade.result,
      side: trade.side,
      drawdown: currentDrawdown
    });
  }
  
  return {
    curve,
    stats: {
      peakBalance,
      maxDrawdown,
      finalBalance: runningBalance,
      totalPnl: cumulativePnl
    }
  };
}

/**
 * Aggregate curve points by time interval
 * Groups data points by hour or day, taking the last value in each period
 */
function aggregateCurveByInterval(curve, interval) {
  if (interval === "trade" || curve.length === 0) {
    return curve;
  }
  
  const intervalMs = interval === "hour" 
    ? 60 * 60 * 1000 
    : 24 * 60 * 60 * 1000;
  
  const aggregated = [];
  let currentBucket = null;
  let currentBucketStart = null;
  
  for (const point of curve) {
    const bucketStart = Math.floor(point.timestamp / intervalMs) * intervalMs;
    
    if (bucketStart !== currentBucketStart) {
      // Save previous bucket
      if (currentBucket) {
        aggregated.push(currentBucket);
      }
      currentBucketStart = bucketStart;
    }
    
    // Update current bucket with latest point in this interval
    currentBucket = {
      ...point,
      timestamp: bucketStart,
      intervalEnd: bucketStart + intervalMs
    };
  }
  
  // Don't forget last bucket
  if (currentBucket) {
    aggregated.push(currentBucket);
  }
  
  return aggregated;
}

/**
 * Apply limit to curve data (take most recent if over limit)
 */
function applyCurveLimit(curve, limit) {
  if (curve.length <= limit) {
    return curve;
  }
  
  // Keep first point (initial balance) and last N-1 points
  const firstPoint = curve[0];
  const recentPoints = curve.slice(-(limit - 1));
  
  return [firstPoint, ...recentPoints];
}

/**
 * Calculate summary statistics from trades
 */
function calculateSummary(trades, initialBalance, curve) {
  const resolvedTrades = trades.filter(t => t.result && t.result !== "PENDING");
  const winningTrades = resolvedTrades.filter(t => t.result === "WIN");
  const losingTrades = resolvedTrades.filter(t => t.result === "LOSS");
  
  // Get final balance from curve or calculate from trades
  const finalBalance = curve.length > 0 
    ? curve[curve.length - 1].balance 
    : initialBalance;
  
  const totalPnl = finalBalance - initialBalance;
  const totalPnlPct = initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0;
  
  // Calculate max drawdown from curve
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  
  for (const point of curve) {
    if (point.balance > peakBalance) {
      peakBalance = point.balance;
    }
    const dd = peakBalance > 0 ? (peakBalance - point.balance) / peakBalance : 0;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }
  
  return {
    startBalance: initialBalance,
    endBalance: finalBalance,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPct: Math.round(totalPnlPct * 100) / 100,
    peakBalance: Math.round(peakBalance * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    maxDrawdownPct: Math.round(maxDrawdown * 100 * 100) / 100,
    totalTrades: resolvedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: resolvedTrades.length > 0 
      ? Math.round((winningTrades.length / resolvedTrades.length) * 100) / 100 
      : 0
  };
}

/**
 * Format curve point for API response
 */
function formatCurvePoint(point) {
  return {
    timestamp: point.timestamp,
    balance: Math.round(point.balance * 100) / 100,
    pnl: Math.round((point.pnl || 0) * 100) / 100,
    cumulativePnl: Math.round((point.cumulativePnl || 0) * 100) / 100,
    tradeId: point.tradeId || null,
    result: point.result || null,
    side: point.side || null,
    drawdown: Math.round((point.drawdown || 0) * 10000) / 10000
  };
}

/**
 * GET /api/paper/equity
 * 
 * Returns equity curve data points for charting
 */
export async function GET(request) {
  try {
    // Check if paper trading is enabled
    if (!PAPER_CONFIG.enabled) {
      return jsonResponse({
        ok: false,
        enabled: false,
        curve: [],
        error: "Paper trading is disabled (set PAPER_TRADING_ENABLED=true)"
      });
    }

    // Parse query params
    const { limit, interval, from, to } = parseQueryParams(request.url);
    
    // Load trades from store
    const tradesData = await loadTrades();
    const trades = tradesData?.trades || [];
    
    // Get initial balance
    const initialBalance = getInitialBalance();
    
    // Build the equity curve from resolved trades
    const { curve: rawCurve, stats } = buildEquityCurve(trades, initialBalance, { from, to });
    
    // Aggregate by interval if needed
    const aggregatedCurve = aggregateCurveByInterval(rawCurve, interval);
    
    // Apply limit
    const limitedCurve = applyCurveLimit(aggregatedCurve, limit);
    
    // Format curve points
    const formattedCurve = limitedCurve.map(formatCurvePoint);
    
    // Calculate summary statistics
    const summary = calculateSummary(trades, initialBalance, rawCurve);
    
    return jsonResponse({
      ok: true,
      curve: formattedCurve,
      summary,
      meta: {
        interval,
        from: from || null,
        to: to || null,
        dataPoints: formattedCurve.length,
        totalResolvedTrades: trades.filter(t => t.result !== "PENDING").length
      },
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error("[API] /api/paper/equity error:", error);
    return jsonError(
      "Failed to fetch equity curve",
      500,
      process.env.NODE_ENV === "development" ? error.message : undefined
    );
  }
}
