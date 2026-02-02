/**
 * Paper Trading Status API
 * 
 * Returns current paper trading status including:
 * - Portfolio (balance, P&L, wins/losses, win rate, max drawdown)
 * - Active position (if any)
 * - Current signal (side, edge, phase, strength, indicators)
 * 
 * GET /api/paper/status
 */

import { getPaperTradingEngine, PAPER_CONFIG } from "../../../../src/paper/index.js";
import { getPaperStore } from "../../../../src/paper/store.js";
import { getTimeRemainingInWindow, getCurrentWindowEndMs } from "../../../../src/paper/resolver.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0"
};

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
 * GET /api/paper/status
 * 
 * Returns the current paper trading status
 * 
 * Response:
 * {
 *   "ok": true,
 *   "enabled": true,
 *   "autoTradeEnabled": true,
 *   "portfolio": {
 *     "balance": 10000,
 *     "totalPnl": 0,
 *     "wins": 0,
 *     "losses": 0,
 *     "winRate": 0,
 *     "maxDrawdown": 0,
 *     "peakBalance": 10000,
 *     "consecutiveLosses": 0
 *   },
 *   "activePosition": null | { ... },
 *   "currentSignal": null | {
 *     "side": "UP" | "DOWN",
 *     "action": "ENTER" | "HOLD" | "SKIP",
 *     "edge": 0.15,
 *     "phase": "EARLY" | "MID" | "LATE",
 *     "strength": "STRONG" | "GOOD" | "OPTIONAL",
 *     "reason": "...",
 *     "indicators": { ... },
 *     "market": { upPrice, downPrice },
 *     "currentPrice": 100000,
 *     "priceToBeat": 99500,
 *     "timeLeftMin": 12.5
 *   },
 *   "tradesCount": 0,
 *   "window": {
 *     "endMs": 1234567890000,
 *     "remainingMs": 300000,
 *     "remainingMin": 5
 *   },
 *   "timestamp": 1234567890000
 * }
 */
export async function GET() {
  try {
    // Check if paper trading is enabled
    if (!PAPER_CONFIG.enabled) {
      return jsonResponse({
        ok: false,
        enabled: false,
        error: "Paper trading is disabled (set PAPER_TRADING_ENABLED=true)"
      });
    }

    // Get the engine instance
    const engine = getPaperTradingEngine();
    
    // Get status from engine
    const status = engine.getStatus();
    
    // Get window timing
    let window = null;
    try {
      const windowEndMs = getCurrentWindowEndMs();
      const remainingMs = getTimeRemainingInWindow();
      window = {
        endMs: windowEndMs,
        remainingMs,
        remainingMin: Math.round((remainingMs / 60000) * 10) / 10 // 1 decimal
      };
    } catch {
      // Window timing not available
    }
    
    // Build response
    const response = {
      ok: true,
      enabled: status.enabled,
      autoTradeEnabled: status.autoTradeEnabled,
      portfolio: status.portfolio,
      activePosition: status.activePosition,
      currentSignal: status.currentSignal,
      currentWindowId: status.currentWindowId,
      tradesCount: status.tradesCount,
      window,
      timestamp: status.timestamp || Date.now()
    };
    
    return jsonResponse(response);
    
  } catch (err) {
    console.error("[API] Paper status error:", err);
    return jsonError(
      "Failed to get paper trading status",
      500,
      { message: err.message }
    );
  }
}
