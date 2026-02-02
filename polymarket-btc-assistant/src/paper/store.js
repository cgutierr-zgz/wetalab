/**
 * Paper Trading Store
 * 
 * JSON persistence for trades and portfolio state.
 * Handles loading, saving, and managing paper trading data.
 * 
 * Storage locations:
 * - data/paper-trading/trades.json    - All trades history
 * - data/paper-trading/portfolio.json - Current portfolio state
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { 
  deserializePaperTrade, 
  serializePaperTrade,
  deserializePaperPortfolio,
  serializePaperPortfolio,
  validatePaperPortfolio
} from "./types.js";

/**
 * Type imports from src/paper/types.js:
 * @typedef {import('./types.js').PaperTrade} PaperTrade
 * @typedef {import('./types.js').PaperPortfolio} PaperPortfolio
 */

// Get project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

// Storage paths
export const STORAGE_CONFIG = {
  baseDir: join(PROJECT_ROOT, "data/paper-trading"),
  tradesFile: "trades.json",
  portfolioFile: "portfolio.json",
  configFile: "config.json"
};

/**
 * Ensure the storage directory exists
 */
async function ensureStorageDir() {
  if (!existsSync(STORAGE_CONFIG.baseDir)) {
    await mkdir(STORAGE_CONFIG.baseDir, { recursive: true });
  }
}

/**
 * Get full path for a storage file
 */
function getStoragePath(filename) {
  return join(STORAGE_CONFIG.baseDir, filename);
}

/**
 * Read JSON file safely
 * @returns {Promise<any | null>} Parsed JSON or null if file doesn't exist
 */
async function readJsonFile(filepath) {
  try {
    const content = await readFile(filepath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    console.error(`[Store] Error reading ${filepath}:`, err.message);
    throw err;
  }
}

/**
 * Write JSON file atomically (write to temp, then rename)
 */
async function writeJsonFile(filepath, data) {
  await ensureStorageDir();
  const tempPath = `${filepath}.tmp`;
  const content = JSON.stringify(data, null, 2);
  
  await writeFile(tempPath, content, "utf-8");
  await writeFile(filepath, content, "utf-8");
  
  // Clean up temp file (best effort)
  try {
    const { unlink } = await import("fs/promises");
    await unlink(tempPath);
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================
// Portfolio Persistence
// ============================================================

/**
 * @typedef {Object} StoredPortfolio
 * Portfolio state as stored in JSON (extends PaperPortfolio with metadata)
 * @property {number} balance
 * @property {number} totalPnl
 * @property {number} wins
 * @property {number} losses
 * @property {number} winRate
 * @property {number} maxDrawdown
 * @property {number} peakBalance
 * @property {number} consecutiveLosses
 * @property {number} lastUpdated - Unix timestamp
 */

/**
 * Load portfolio from storage
 * Deserializes to ensure PaperPortfolio interface compliance
 * @param {number} [initialBalance=10000] - Default initial balance for new portfolio
 * @returns {Promise<PaperPortfolio | null>}
 */
export async function loadPortfolio(initialBalance = 10000) {
  const path = getStoragePath(STORAGE_CONFIG.portfolioFile);
  const data = await readJsonFile(path);
  
  if (!data) return null;
  
  // Validate and deserialize
  const validation = validatePaperPortfolio(data);
  if (!validation.valid) {
    console.warn('[Store] Portfolio validation warnings:', validation.errors);
  }
  
  return deserializePaperPortfolio(data, initialBalance);
}

/**
 * Save portfolio to storage
 * Serializes PaperPortfolio for JSON persistence
 * @param {PaperPortfolio} portfolio - Portfolio state
 */
export async function savePortfolio(portfolio) {
  const path = getStoragePath(STORAGE_CONFIG.portfolioFile);
  const serialized = serializePaperPortfolio(portfolio);
  const data = {
    ...serialized,
    lastUpdated: Date.now()
  };
  await writeJsonFile(path, data);
}

// ============================================================
// Trades Persistence
// ============================================================

/**
 * @typedef {Object} StoredTrades
 * @property {Array<PaperTrade>} trades - All trades (PaperTrade interface)
 * @property {PaperTrade | null} activePosition - Current active position
 * @property {string | null} currentWindowId - Current window ID
 * @property {number} lastUpdated - Unix timestamp
 */

/**
 * Load trades from storage
 * Deserializes all trades to ensure they conform to PaperTrade interface
 * @returns {Promise<StoredTrades | null>}
 */
export async function loadTrades() {
  const path = getStoragePath(STORAGE_CONFIG.tradesFile);
  const data = await readJsonFile(path);
  
  if (!data) return null;
  
  // Deserialize trades to ensure PaperTrade interface compliance
  return {
    ...data,
    trades: (data.trades || []).map(t => deserializePaperTrade(t)),
    activePosition: data.activePosition ? deserializePaperTrade(data.activePosition) : null
  };
}

/**
 * Save trades to storage
 * Serializes all trades for JSON persistence
 * @param {Array<PaperTrade>} trades - All trades
 * @param {PaperTrade | null} activePosition - Current active position
 * @param {string | null} currentWindowId - Current window ID
 */
export async function saveTrades(trades, activePosition = null, currentWindowId = null) {
  const path = getStoragePath(STORAGE_CONFIG.tradesFile);
  const data = {
    trades: trades.map(t => serializePaperTrade(t)),
    activePosition: activePosition ? serializePaperTrade(activePosition) : null,
    currentWindowId,
    lastUpdated: Date.now()
  };
  await writeJsonFile(path, data);
}

/**
 * Append a single trade to storage (optimized for frequent updates)
 * @param {PaperTrade} trade - Trade to append (must conform to PaperTrade interface)
 */
export async function appendTrade(trade) {
  const stored = await loadTrades();
  const trades = stored?.trades || [];
  
  // Check if trade already exists (by ID)
  const existingIndex = trades.findIndex(t => t.id === trade.id);
  if (existingIndex >= 0) {
    trades[existingIndex] = trade;
  } else {
    trades.push(trade);
  }
  
  await saveTrades(trades, stored?.activePosition, stored?.currentWindowId);
}

/**
 * Update an existing trade in storage
 * @param {string} tradeId - Trade ID
 * @param {Object} updates - Fields to update
 */
export async function updateTrade(tradeId, updates) {
  const stored = await loadTrades();
  if (!stored?.trades) return;
  
  const tradeIndex = stored.trades.findIndex(t => t.id === tradeId);
  if (tradeIndex >= 0) {
    stored.trades[tradeIndex] = { ...stored.trades[tradeIndex], ...updates };
    await saveTrades(stored.trades, stored.activePosition, stored.currentWindowId);
  }
}

// ============================================================
// Config Persistence (auto-trade settings)
// ============================================================

/**
 * @typedef {Object} StoredConfig
 * @property {boolean} autoTradeEnabled
 * @property {number} lastUpdated
 */

/**
 * Load config from storage
 * @returns {Promise<StoredConfig | null>}
 */
export async function loadConfig() {
  const path = getStoragePath(STORAGE_CONFIG.configFile);
  return readJsonFile(path);
}

/**
 * Save config to storage
 * @param {Object} config - Config state
 */
export async function saveConfig(config) {
  const path = getStoragePath(STORAGE_CONFIG.configFile);
  const data = {
    ...config,
    lastUpdated: Date.now()
  };
  await writeJsonFile(path, data);
}

// ============================================================
// PaperStore Class - High-level store interface
// ============================================================

/**
 * PaperStore class - manages all paper trading persistence
 */
export class PaperStore {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize storage (ensure directories exist)
   */
  async initialize() {
    await ensureStorageDir();
    this.initialized = true;
  }

  /**
   * Load all state from storage
   * @returns {Promise<{ portfolio: Object | null, trades: Array, activePosition: Object | null, config: Object | null }>}
   */
  async loadAll() {
    await this.initialize();
    
    const [portfolio, tradesData, config] = await Promise.all([
      loadPortfolio(),
      loadTrades(),
      loadConfig()
    ]);

    return {
      portfolio,
      trades: tradesData?.trades || [],
      activePosition: tradesData?.activePosition || null,
      currentWindowId: tradesData?.currentWindowId || null,
      config
    };
  }

  /**
   * Save all state to storage
   */
  async saveAll(engine) {
    await this.initialize();
    
    await Promise.all([
      savePortfolio(engine.portfolio),
      saveTrades(engine.trades, engine.activePosition, engine.currentWindowId),
      saveConfig({ autoTradeEnabled: engine.autoTradeEnabled })
    ]);
  }

  /**
   * Wire up persistence callbacks to a PaperTradingEngine
   * Ensures data is persisted after EVERY trade entry and resolution
   * @param {import('./index.js').PaperTradingEngine} engine
   */
  wireEngine(engine) {
    // On trade entered: persist trades, active position, and portfolio for consistency
    engine.onTradeEntered = async (trade) => {
      try {
        // Save trades (includes activePosition and currentWindowId)
        await saveTrades(engine.trades, engine.activePosition, engine.currentWindowId);
        // Also save portfolio snapshot for complete state consistency
        await savePortfolio(engine.portfolio);
        console.log(`[Store] ✅ Persisted trade entry: ${trade.id} (${trade.side})`);
      } catch (err) {
        console.error(`[Store] ❌ Failed to persist trade entry: ${err.message}`);
        throw err; // Re-throw to allow caller to handle
      }
    };

    // On trade resolved: persist trades and portfolio atomically
    engine.onTradeResolved = async (trade) => {
      try {
        // Save trades (activePosition is now null after resolution)
        await saveTrades(engine.trades, engine.activePosition, engine.currentWindowId);
        // Save updated portfolio with new P&L
        await savePortfolio(engine.portfolio);
        console.log(`[Store] ✅ Persisted trade resolution: ${trade.id} → ${trade.result} (P&L: $${trade.pnl?.toFixed(2)})`);
      } catch (err) {
        console.error(`[Store] ❌ Failed to persist trade resolution: ${err.message}`);
        throw err;
      }
    };

    // On portfolio updated: save portfolio (still called for other portfolio changes)
    engine.onPortfolioUpdated = async (portfolio) => {
      try {
        await savePortfolio(portfolio);
      } catch (err) {
        console.error(`[Store] ❌ Failed to persist portfolio update: ${err.message}`);
        throw err;
      }
    };
  }

  /**
   * Initialize engine from stored state
   * @param {import('./index.js').PaperTradingEngine} engine
   */
  async initializeEngine(engine) {
    const stored = await this.loadAll();
    
    engine.loadState({
      portfolio: stored.portfolio,
      trades: stored.trades,
      activePosition: stored.activePosition,
      autoTradeEnabled: stored.config?.autoTradeEnabled
    });

    // Wire up persistence callbacks
    this.wireEngine(engine);

    return stored;
  }

  /**
   * Clear all stored data (reset)
   */
  async clear() {
    await ensureStorageDir();
    
    await Promise.all([
      writeJsonFile(getStoragePath(STORAGE_CONFIG.portfolioFile), null),
      writeJsonFile(getStoragePath(STORAGE_CONFIG.tradesFile), { trades: [], activePosition: null, currentWindowId: null }),
      writeJsonFile(getStoragePath(STORAGE_CONFIG.configFile), { autoTradeEnabled: true })
    ]);
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    const stored = await this.loadAll();
    
    return {
      tradesCount: stored.trades.length,
      hasActivePosition: stored.activePosition !== null,
      portfolioExists: stored.portfolio !== null,
      lastUpdated: stored.portfolio?.lastUpdated || null
    };
  }
}

// ============================================================
// Singleton instance
// ============================================================

let storeInstance = null;

/**
 * Get or create the paper store instance
 */
export function getPaperStore() {
  if (!storeInstance) {
    storeInstance = new PaperStore();
  }
  return storeInstance;
}

/**
 * Create a fresh store instance (for testing)
 */
export function createPaperStore() {
  return new PaperStore();
}

// ============================================================
// Convenience: Setup persistence for engine
// ============================================================

/**
 * Setup persistence for a paper trading engine
 * Loads stored state and wires up callbacks
 * 
 * @param {import('./index.js').PaperTradingEngine} engine
 * @returns {Promise<Object>} Loaded state
 * 
 * @example
 * ```js
 * import { getPaperTradingEngine } from './index.js';
 * import { setupPersistence } from './store.js';
 * 
 * const engine = getPaperTradingEngine();
 * await setupPersistence(engine);
 * // Engine now persists automatically
 * ```
 */
export async function setupPersistence(engine) {
  const store = getPaperStore();
  return store.initializeEngine(engine);
}

export default PaperStore;
