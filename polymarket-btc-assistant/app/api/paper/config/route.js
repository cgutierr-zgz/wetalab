/**
 * Paper Trading Config API
 * 
 * GET/PUT endpoints for auto-trade settings:
 * - autoTradeEnabled: boolean - Enable/disable automatic trade execution
 * - paperTradingEnabled: boolean - Read-only, from environment
 * - positionLimits: object - Read-only position sizing constraints
 * 
 * GET  /api/paper/config - Get current configuration
 * PUT  /api/paper/config - Update auto-trade settings
 */

import { getPaperTradingEngine, PAPER_CONFIG } from "../../../../src/paper/index.js";
import { loadConfig, saveConfig } from "../../../../src/paper/store.js";

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
 * GET /api/paper/config
 * 
 * Returns current paper trading configuration
 * 
 * Response:
 * {
 *   "ok": true,
 *   "config": {
 *     "autoTradeEnabled": true,
 *     "paperTradingEnabled": true,
 *     "positionLimits": {
 *       "minPosition": 10,
 *       "maxPosition": 500,
 *       "maxPositionPct": 0.05
 *     },
 *     "entryFilters": {
 *       "maxConsecutiveLosses": 4,
 *       "minIndicatorsAligned": 3
 *     },
 *     "initialBalance": 10000
 *   },
 *   "lastUpdated": "2026-02-02T00:00:00.000Z" | null,
 *   "timestamp": "2026-02-02T00:00:00.000Z"
 * }
 */
export async function GET() {
  try {
    // Load persisted config to get lastUpdated timestamp
    const persistedConfig = await loadConfig();
    
    // Get engine instance for live state
    const engine = getPaperTradingEngine();
    
    // Build config response
    const config = {
      // Editable settings
      autoTradeEnabled: engine.autoTradeEnabled,
      
      // Read-only from environment
      paperTradingEnabled: PAPER_CONFIG.enabled,
      
      // Position sizing limits (read-only)
      positionLimits: {
        minPosition: PAPER_CONFIG.minPosition,
        maxPosition: PAPER_CONFIG.maxPosition,
        maxPositionPct: PAPER_CONFIG.maxPositionPct
      },
      
      // Entry filter settings (read-only from config)
      entryFilters: {
        maxConsecutiveLosses: PAPER_CONFIG.maxConsecutiveLosses,
        minIndicatorsAligned: PAPER_CONFIG.minIndicatorsAligned
      },
      
      // Initial balance (read-only)
      initialBalance: PAPER_CONFIG.initialBalance
    };

    return jsonResponse({
      ok: true,
      config,
      lastUpdated: persistedConfig?.lastUpdated 
        ? new Date(persistedConfig.lastUpdated).toISOString() 
        : null,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("[API] Error in GET /api/paper/config:", error);
    return jsonError("Failed to load configuration", 500, error.message);
  }
}

/**
 * PUT /api/paper/config
 * 
 * Update auto-trade settings
 * 
 * Request body:
 * {
 *   "autoTradeEnabled": boolean
 * }
 * 
 * Response:
 * {
 *   "ok": true,
 *   "config": { ... updated config ... },
 *   "changes": { "autoTradeEnabled": { "from": true, "to": false } },
 *   "timestamp": "2026-02-02T00:00:00.000Z"
 * }
 */
export async function PUT(request) {
  try {
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return jsonError("Invalid JSON body", 400);
    }
    
    // Validate request - at least one setting must be provided
    if (typeof body !== "object" || body === null) {
      return jsonError("Request body must be an object", 400);
    }
    
    // Track changes
    const changes = {};
    const engine = getPaperTradingEngine();
    
    // Handle autoTradeEnabled update
    if ("autoTradeEnabled" in body) {
      const newValue = body.autoTradeEnabled;
      
      // Validate type
      if (typeof newValue !== "boolean") {
        return jsonError("autoTradeEnabled must be a boolean", 400, {
          field: "autoTradeEnabled",
          received: typeof newValue,
          expected: "boolean"
        });
      }
      
      // Record change
      const oldValue = engine.autoTradeEnabled;
      if (oldValue !== newValue) {
        changes.autoTradeEnabled = {
          from: oldValue,
          to: newValue
        };
        
        // Apply change to engine
        engine.setAutoTradeEnabled(newValue);
      }
    }
    
    // Check if any valid settings were provided
    const validSettings = ["autoTradeEnabled"];
    const providedSettings = Object.keys(body);
    const invalidSettings = providedSettings.filter(k => !validSettings.includes(k));
    
    if (invalidSettings.length > 0) {
      return jsonError(
        `Invalid settings: ${invalidSettings.join(", ")}. Valid settings: ${validSettings.join(", ")}`,
        400,
        { invalidSettings, validSettings }
      );
    }
    
    // Persist config if changes were made
    if (Object.keys(changes).length > 0) {
      await saveConfig({
        autoTradeEnabled: engine.autoTradeEnabled
      });
    }
    
    // Build updated config response
    const config = {
      autoTradeEnabled: engine.autoTradeEnabled,
      paperTradingEnabled: PAPER_CONFIG.enabled,
      positionLimits: {
        minPosition: PAPER_CONFIG.minPosition,
        maxPosition: PAPER_CONFIG.maxPosition,
        maxPositionPct: PAPER_CONFIG.maxPositionPct
      },
      entryFilters: {
        maxConsecutiveLosses: PAPER_CONFIG.maxConsecutiveLosses,
        minIndicatorsAligned: PAPER_CONFIG.minIndicatorsAligned
      },
      initialBalance: PAPER_CONFIG.initialBalance
    };

    return jsonResponse({
      ok: true,
      config,
      changes: Object.keys(changes).length > 0 ? changes : null,
      message: Object.keys(changes).length > 0 
        ? "Configuration updated successfully" 
        : "No changes applied",
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("[API] Error in PUT /api/paper/config:", error);
    return jsonError("Failed to update configuration", 500, error.message);
  }
}
