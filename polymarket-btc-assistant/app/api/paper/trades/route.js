/**
 * Paper Trading Trades API
 * 
 * Returns recent paper trades with pagination and filtering.
 * 
 * GET /api/paper/trades
 * Query params:
 *   - limit: number of trades to return (default: 20, max: 100)
 *   - offset: pagination offset (default: 0)
 *   - result: filter by result ("WIN", "LOSS", "PENDING")
 *   - side: filter by side ("UP", "DOWN")
 * 
 * Response:
 * {
 *   "ok": true,
 *   "trades": [...],
 *   "pagination": { limit, offset, total, hasMore },
 *   "summary": { wins, losses, pending, totalPnl }
 * }
 */

import { loadTrades } from "../../../../src/paper/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

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
  
  // Parse offset
  let offset = parseInt(searchParams.get("offset") || "0", 10);
  if (isNaN(offset) || offset < 0) offset = 0;
  
  // Parse result filter
  const resultParam = searchParams.get("result");
  const result = resultParam && ["WIN", "LOSS", "PENDING"].includes(resultParam.toUpperCase())
    ? resultParam.toUpperCase()
    : null;
  
  // Parse side filter
  const sideParam = searchParams.get("side");
  const side = sideParam && ["UP", "DOWN"].includes(sideParam.toUpperCase())
    ? sideParam.toUpperCase()
    : null;
  
  return { limit, offset, result, side };
}

/**
 * Format a trade for API response
 * Includes all relevant fields for the dashboard
 */
function formatTrade(trade) {
  if (!trade) return null;
  
  return {
    id: trade.id,
    marketId: trade.marketId,
    side: trade.side,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    priceToBeat: trade.priceToBeat,
    positionSize: trade.positionSize,
    result: trade.result || "PENDING",
    pnl: trade.pnl || 0,
    edge: trade.edge,
    phase: trade.phase,
    strength: trade.strength,
    entryTimestamp: trade.entryTimestamp,
    resolvedTimestamp: trade.resolvedTimestamp,
    windowEndMs: trade.windowEndMs,
    timeLeftAtEntry: trade.timeLeftAtEntry,
    indicators: trade.indicators ? {
      rsi: trade.indicators.rsi,
      macdHistogram: trade.indicators.macdHistogram,
      vwapSlope: trade.indicators.vwapSlope,
      heikenAshiColor: trade.indicators.heikenAshiColor
    } : null
  };
}

/**
 * Calculate summary statistics from trades
 */
function calculateSummary(trades) {
  let wins = 0;
  let losses = 0;
  let pending = 0;
  let totalPnl = 0;
  
  for (const trade of trades) {
    if (trade.result === "WIN") {
      wins++;
      totalPnl += trade.pnl || 0;
    } else if (trade.result === "LOSS") {
      losses++;
      totalPnl += trade.pnl || 0;
    } else {
      pending++;
    }
  }
  
  const totalResolved = wins + losses;
  const winRate = totalResolved > 0 ? (wins / totalResolved) * 100 : 0;
  
  return {
    wins,
    losses,
    pending,
    totalResolved,
    winRate: Math.round(winRate * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100
  };
}

/**
 * GET /api/paper/trades
 * 
 * Returns a paginated list of recent paper trades
 */
export async function GET(request) {
  try {
    // Parse query params
    const { limit, offset, result, side } = parseQueryParams(request.url);
    
    // Load trades from storage
    const storedData = await loadTrades();
    
    if (!storedData || !storedData.trades) {
      return jsonResponse({
        ok: true,
        trades: [],
        pagination: {
          limit,
          offset,
          total: 0,
          hasMore: false
        },
        summary: {
          wins: 0,
          losses: 0,
          pending: 0,
          totalResolved: 0,
          winRate: 0,
          totalPnl: 0
        },
        timestamp: Date.now()
      });
    }
    
    let { trades, activePosition } = storedData;
    
    // Include active position in the list if it exists
    if (activePosition && !trades.find(t => t.id === activePosition.id)) {
      trades = [activePosition, ...trades];
    }
    
    // Apply filters
    let filteredTrades = trades;
    
    if (result) {
      filteredTrades = filteredTrades.filter(t => {
        const tradeResult = t.result || "PENDING";
        return tradeResult === result;
      });
    }
    
    if (side) {
      filteredTrades = filteredTrades.filter(t => t.side === side);
    }
    
    // Sort by entry timestamp (most recent first)
    filteredTrades.sort((a, b) => {
      const timeA = a.entryTimestamp || 0;
      const timeB = b.entryTimestamp || 0;
      return timeB - timeA;
    });
    
    // Calculate summary for all filtered trades (before pagination)
    const summary = calculateSummary(filteredTrades);
    
    // Apply pagination
    const total = filteredTrades.length;
    const paginatedTrades = filteredTrades.slice(offset, offset + limit);
    const hasMore = offset + paginatedTrades.length < total;
    
    // Format trades for response
    const formattedTrades = paginatedTrades.map(formatTrade);
    
    return jsonResponse({
      ok: true,
      trades: formattedTrades,
      pagination: {
        limit,
        offset,
        total,
        hasMore
      },
      summary,
      activePosition: activePosition ? formatTrade(activePosition) : null,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error("[API] /api/paper/trades error:", error);
    return jsonError(
      "Failed to fetch trades",
      500,
      process.env.NODE_ENV === "development" ? error.message : undefined
    );
  }
}
