import { CONFIG } from "./config.js";
import { fetchKlines, fetchLastPrice } from "./data/binance.js";
import { fetchChainlinkBtcUsd } from "./data/chainlink.js";
import { startChainlinkPriceStream } from "./data/chainlinkWs.js";
import { startPolymarketChainlinkPriceStream } from "./data/polymarketLiveWs.js";
import {
  fetchMarketBySlug,
  fetchLiveEventsBySeriesId,
  flattenEventMarkets,
  pickLatestLiveMarket,
  fetchClobPrice,
  fetchOrderBook,
  summarizeOrderBook
} from "./data/polymarket.js";
import { computeSessionVwap, computeVwapSeries } from "./indicators/vwap.js";
import { computeRsi, sma, slopeLast } from "./indicators/rsi.js";
import { computeMacd } from "./indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.js";
import { computeAdx, getTrendStrength, getRecommendedStrategy } from "./indicators/adx.js";
import { detectRegime, detectCombinedRegime, detectAdxRegime, isTrendingRegime, isRangingRegime, getRegimeStrategy } from "./engines/regime.js";
import { scoreDirection, applyTimeAwareness, calculatePriceMomentum, calculateVolumeRatio, calculateVwapDistance, calculateBidAskImbalance } from "./engines/probability.js";
import { computeEdge, decide } from "./engines/edge.js";
import { appendCsvRow, formatNumber, formatPct, getCandleWindowTiming, sleep } from "./utils.js";
import { startBinanceTradeStream } from "./data/binanceWs.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { applyGlobalProxyFromEnv } from "./net/proxy.js";
// Paper trading integration
import { getPaperTradingEngine, PAPER_CONFIG } from "./paper/index.js";
import { setupPersistence } from "./paper/store.js";
import { setupLogging, logSignalGenerated, logError } from "./paper/logger.js";
import { setupDiscordNotifications, notifySessionSummary, isDiscordEnabled } from "./notifications/discord.js";

function countVwapCrosses(closes, vwapSeries, lookback) {
  if (closes.length < lookback || vwapSeries.length < lookback) return null;
  let crosses = 0;
  for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] - vwapSeries[i - 1];
    const cur = closes[i] - vwapSeries[i];
    if (prev === 0) continue;
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
  }
  return crosses;
}

applyGlobalProxyFromEnv();

function fmtTimeLeft(mins) {
  const totalSeconds = Math.max(0, Math.floor(mins * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  lightRed: "\x1b[91m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  dim: "\x1b[2m"
};

function screenWidth() {
  const w = Number(process.stdout?.columns);
  return Number.isFinite(w) && w >= 40 ? w : 80;
}

function sepLine(ch = "─") {
  const w = screenWidth();
  return `${ANSI.white}${ch.repeat(w)}${ANSI.reset}`;
}

function renderScreen(text) {
  try {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  } catch {
    // ignore
  }
  process.stdout.write(text);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function padLabel(label, width) {
  const visible = stripAnsi(label).length;
  if (visible >= width) return label;
  return label + " ".repeat(width - visible);
}

function centerText(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  const left = Math.floor((width - visible) / 2);
  const right = width - visible - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

const LABEL_W = 16;
function kv(label, value) {
  const l = padLabel(String(label), LABEL_W);
  return `${l}${value}`;
}

function section(title) {
  return `${ANSI.white}${title}${ANSI.reset}`;
}

function colorPriceLine({ label, price, prevPrice, decimals = 0, prefix = "" }) {
  if (price === null || price === undefined) {
    return `${label}: ${ANSI.gray}-${ANSI.reset}`;
  }

  const p = Number(price);
  const prev = prevPrice === null || prevPrice === undefined ? null : Number(prevPrice);

  let color = ANSI.reset;
  let arrow = "";
  if (prev !== null && Number.isFinite(prev) && Number.isFinite(p) && p !== prev) {
    if (p > prev) {
      color = ANSI.green;
      arrow = " ↑";
    } else {
      color = ANSI.red;
      arrow = " ↓";
    }
  }

  const formatted = `${prefix}${formatNumber(p, decimals)}`;
  return `${label}: ${color}${formatted}${arrow}${ANSI.reset}`;
}

function formatSignedDelta(delta, base) {
  if (delta === null || base === null || base === 0) return `${ANSI.gray}-${ANSI.reset}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const pct = (Math.abs(delta) / Math.abs(base)) * 100;
  return `${sign}$${Math.abs(delta).toFixed(2)}, ${sign}${pct.toFixed(2)}%`;
}

function colorByNarrative(text, narrative) {
  if (narrative === "LONG") return `${ANSI.green}${text}${ANSI.reset}`;
  if (narrative === "SHORT") return `${ANSI.red}${text}${ANSI.reset}`;
  return `${ANSI.gray}${text}${ANSI.reset}`;
}

function formatNarrativeValue(label, value, narrative) {
  return `${label}: ${colorByNarrative(value, narrative)}`;
}

function narrativeFromSign(x) {
  if (x === null || x === undefined || !Number.isFinite(Number(x)) || Number(x) === 0) return "NEUTRAL";
  return Number(x) > 0 ? "LONG" : "SHORT";
}

function narrativeFromRsi(rsi) {
  if (rsi === null || rsi === undefined || !Number.isFinite(Number(rsi))) return "NEUTRAL";
  const v = Number(rsi);
  if (v >= 55) return "LONG";
  if (v <= 45) return "SHORT";
  return "NEUTRAL";
}

function narrativeFromSlope(slope) {
  if (slope === null || slope === undefined || !Number.isFinite(Number(slope)) || Number(slope) === 0) return "NEUTRAL";
  return Number(slope) > 0 ? "LONG" : "SHORT";
}

function formatProbPct(p, digits = 0) {
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return "-";
  return `${(Number(p) * 100).toFixed(digits)}%`;
}

function fmtEtTime(now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return "-";
  }
}

function getBtcSession(now = new Date()) {
  const h = now.getUTCHours();
  const inAsia = h >= 0 && h < 8;
  const inEurope = h >= 7 && h < 16;
  const inUs = h >= 13 && h < 22;

  if (inEurope && inUs) return "Europe/US overlap";
  if (inAsia && inEurope) return "Asia/Europe overlap";
  if (inAsia) return "Asia";
  if (inEurope) return "Europe";
  if (inUs) return "US";
  return "Off-hours";
}

function parsePriceToBeat(market) {
  const text = String(market?.question ?? market?.title ?? "");
  if (!text) return null;
  const m = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const raw = m[1].replace(/,/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const dumpedMarkets = new Set();

function safeFileSlug(x) {
  return String(x ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

function extractNumericFromMarket(market) {
  const directKeys = [
    "priceToBeat",
    "price_to_beat",
    "strikePrice",
    "strike_price",
    "strike",
    "threshold",
    "thresholdPrice",
    "threshold_price",
    "targetPrice",
    "target_price",
    "referencePrice",
    "reference_price"
  ];

  for (const k of directKeys) {
    const v = market?.[k];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }

  const seen = new Set();
  const stack = [{ obj: market, depth: 0 }];

  while (stack.length) {
    const { obj, depth } = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    if (seen.has(obj) || depth > 6) continue;
    seen.add(obj);

    const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
    for (const [key, value] of entries) {
      const k = String(key).toLowerCase();
      if (value && typeof value === "object") {
        stack.push({ obj: value, depth: depth + 1 });
        continue;
      }

      if (!/(price|strike|threshold|target|beat)/i.test(k)) continue;

      const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
      if (!Number.isFinite(n)) continue;

      if (n > 1000 && n < 2_000_000) return n;
    }
  }

  return null;
}

function priceToBeatFromPolymarketMarket(market) {
  const n = extractNumericFromMarket(market);
  if (n !== null) return n;
  return parsePriceToBeat(market);
}

const marketCache = {
  market: null,
  fetchedAtMs: 0
};

async function resolveCurrentBtc15mMarket() {
  if (CONFIG.polymarket.marketSlug) {
    return await fetchMarketBySlug(CONFIG.polymarket.marketSlug);
  }

  if (!CONFIG.polymarket.autoSelectLatest) return null;

  const now = Date.now();
  if (marketCache.market && now - marketCache.fetchedAtMs < CONFIG.pollIntervalMs) {
    return marketCache.market;
  }

  const events = await fetchLiveEventsBySeriesId({ seriesId: CONFIG.polymarket.seriesId, limit: 25 });
  const markets = flattenEventMarkets(events);
  const picked = pickLatestLiveMarket(markets);

  marketCache.market = picked;
  marketCache.fetchedAtMs = now;
  return picked;
}

async function fetchPolymarketSnapshot() {
  const market = await resolveCurrentBtc15mMarket();

  if (!market) return { ok: false, reason: "market_not_found" };

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : (typeof market.outcomes === "string" ? JSON.parse(market.outcomes) : []);
  const outcomePrices = Array.isArray(market.outcomePrices)
    ? market.outcomePrices
    : (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : []);

  const clobTokenIds = Array.isArray(market.clobTokenIds)
    ? market.clobTokenIds
    : (typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : []);

  let upTokenId = null;
  let downTokenId = null;
  for (let i = 0; i < outcomes.length; i += 1) {
    const label = String(outcomes[i]);
    const tokenId = clobTokenIds[i] ? String(clobTokenIds[i]) : null;
    if (!tokenId) continue;

    if (label.toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase()) upTokenId = tokenId;
    if (label.toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase()) downTokenId = tokenId;
  }

  const upIndex = outcomes.findIndex((x) => String(x).toLowerCase() === CONFIG.polymarket.upOutcomeLabel.toLowerCase());
  const downIndex = outcomes.findIndex((x) => String(x).toLowerCase() === CONFIG.polymarket.downOutcomeLabel.toLowerCase());

  const gammaYes = upIndex >= 0 ? Number(outcomePrices[upIndex]) : null;
  const gammaNo = downIndex >= 0 ? Number(outcomePrices[downIndex]) : null;

  if (!upTokenId || !downTokenId) {
    return {
      ok: false,
      reason: "missing_token_ids",
      market,
      outcomes,
      clobTokenIds,
      outcomePrices
    };
  }

  let upBuy = null;
  let downBuy = null;
  let upBookSummary = { bestBid: null, bestAsk: null, spread: null, bidLiquidity: null, askLiquidity: null };
  let downBookSummary = { bestBid: null, bestAsk: null, spread: null, bidLiquidity: null, askLiquidity: null };

  try {
    const [yesBuy, noBuy, upBook, downBook] = await Promise.all([
      fetchClobPrice({ tokenId: upTokenId, side: "buy" }),
      fetchClobPrice({ tokenId: downTokenId, side: "buy" }),
      fetchOrderBook({ tokenId: upTokenId }),
      fetchOrderBook({ tokenId: downTokenId })
    ]);

    upBuy = yesBuy;
    downBuy = noBuy;
    upBookSummary = summarizeOrderBook(upBook);
    downBookSummary = summarizeOrderBook(downBook);
  } catch {
    upBuy = null;
    downBuy = null;
    upBookSummary = {
      bestBid: Number(market.bestBid) || null,
      bestAsk: Number(market.bestAsk) || null,
      spread: Number(market.spread) || null,
      bidLiquidity: null,
      askLiquidity: null
    };
    downBookSummary = {
      bestBid: null,
      bestAsk: null,
      spread: Number(market.spread) || null,
      bidLiquidity: null,
      askLiquidity: null
    };
  }

  return {
    ok: true,
    market,
    tokens: { upTokenId, downTokenId },
    prices: {
      up: upBuy ?? gammaYes,
      down: downBuy ?? gammaNo
    },
    orderbook: {
      up: upBookSummary,
      down: downBookSummary
    }
  };
}

async function main() {
  const binanceStream = startBinanceTradeStream({ symbol: CONFIG.symbol });
  const polymarketLiveStream = startPolymarketChainlinkPriceStream({});
  const chainlinkStream = startChainlinkPriceStream({});

  // Initialize paper trading engine with persistence and logging
  const paperEngine = getPaperTradingEngine();
  if (PAPER_CONFIG.enabled) {
    try {
      const storedState = await setupPersistence(paperEngine);
      console.log(`[Paper] Loaded ${storedState.trades?.length || 0} trades, balance: $${paperEngine.portfolio.balance.toFixed(2)}`);
      
      // Wire structured JSONL logging for TRADE_ENTERED and TRADE_RESOLVED events
      setupLogging(paperEngine);
      
      // Wire Discord webhook notifications for trade entries and resolutions
      setupDiscordNotifications(paperEngine);
    } catch (err) {
      console.error("[Paper] Failed to initialize persistence:", err.message);
      await logError({ context: "paper_init", error: err, metadata: { phase: "initialization" } });
    }
  }

  let prevSpotPrice = null;
  let prevCurrentPrice = null;
  let priceToBeatState = { slug: null, value: null, setAtMs: null };

  const header = [
    "timestamp",
    "entry_minute",
    "time_left_min",
    "regime",
    "signal",
    "model_up",
    "model_down",
    "mkt_up",
    "mkt_down",
    "edge_up",
    "edge_down",
    "recommendation"
  ];

  while (true) {
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

    const wsTick = binanceStream.getLast();
    const wsPrice = wsTick?.price ?? null;

    const polymarketWsTick = polymarketLiveStream.getLast();
    const polymarketWsPrice = polymarketWsTick?.price ?? null;

    const chainlinkWsTick = chainlinkStream.getLast();
    const chainlinkWsPrice = chainlinkWsTick?.price ?? null;

    try {
      const chainlinkPromise = polymarketWsPrice !== null
        ? Promise.resolve({ price: polymarketWsPrice, updatedAt: polymarketWsTick?.updatedAt ?? null, source: "polymarket_ws" })
        : chainlinkWsPrice !== null
          ? Promise.resolve({ price: chainlinkWsPrice, updatedAt: chainlinkWsTick?.updatedAt ?? null, source: "chainlink_ws" })
          : fetchChainlinkBtcUsd();

      const [klines1m, klines5m, lastPrice, chainlink, poly] = await Promise.all([
        fetchKlines({ interval: "1m", limit: 240 }),
        fetchKlines({ interval: "5m", limit: 200 }),
        fetchLastPrice(),
        chainlinkPromise,
        fetchPolymarketSnapshot()
      ]);

      const settlementMs = poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
      const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;

      const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;

      const candles = klines1m;
      const closes = candles.map((c) => c.close);

      const vwap = computeSessionVwap(candles);
      const vwapSeries = computeVwapSeries(candles);
      const vwapNow = vwapSeries[vwapSeries.length - 1];

      const lookback = CONFIG.vwapSlopeLookbackMinutes;
      const vwapSlope = vwapSeries.length >= lookback ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback : null;
      const vwapDist = vwapNow ? (lastPrice - vwapNow) / vwapNow : null;

      const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
      const rsiSeries = [];
      for (let i = 0; i < closes.length; i += 1) {
        const sub = closes.slice(0, i + 1);
        const r = computeRsi(sub, CONFIG.rsiPeriod);
        if (r !== null) rsiSeries.push(r);
      }
      const rsiMa = sma(rsiSeries, CONFIG.rsiMaPeriod);
      const rsiSlope = slopeLast(rsiSeries, 3);

      const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

      const ha = computeHeikenAshi(candles);
      const consec = countConsecutive(ha);

      const vwapCrossCount = countVwapCrosses(closes, vwapSeries, 20);
      const volumeRecent = candles.slice(-20).reduce((a, c) => a + c.volume, 0);
      const volumeAvg = candles.slice(-120).reduce((a, c) => a + c.volume, 0) / 6;

      const failedVwapReclaim = vwapNow !== null && vwapSeries.length >= 3
        ? closes[closes.length - 1] < vwapNow && closes[closes.length - 2] > vwapSeries[vwapSeries.length - 2]
        : false;

      // Calculate 5-minute price momentum
      const { priceMomentum5m } = calculatePriceMomentum(closes, 5);

      // Calculate volume ratio for confirmation
      const { volumeRatio } = calculateVolumeRatio(volumeRecent, volumeAvg);

      // Calculate VWAP distance for mean reversion signal
      const { vwapDistancePct } = calculateVwapDistance(lastPrice, vwapNow);

      // ============================================================
      // Price to Beat - Calculate early for paper trading
      // ============================================================
      const spotPrice = wsPrice ?? lastPrice;
      const currentPrice = chainlink?.price ?? null;
      const marketSlug = poly.ok ? String(poly.market?.slug ?? "") : "";
      const marketStartMs = poly.ok && poly.market?.eventStartTime ? new Date(poly.market.eventStartTime).getTime() : null;

      if (marketSlug && priceToBeatState.slug !== marketSlug) {
        priceToBeatState = { slug: marketSlug, value: null, setAtMs: null };
      }

      if (priceToBeatState.slug && priceToBeatState.value === null && currentPrice !== null) {
        const nowMs = Date.now();
        const okToLatch = marketStartMs === null ? true : nowMs >= marketStartMs;
        if (okToLatch) {
          priceToBeatState = { slug: priceToBeatState.slug, value: Number(currentPrice), setAtMs: nowMs };
        }
      }

      const priceToBeat = priceToBeatState.slug === marketSlug ? priceToBeatState.value : null;

      // Calculate bid/ask imbalance from Polymarket order book
      // Positive imbalance = more buyers, Negative = more sellers
      // Smart money signal detected when |netImbalance| > 0.3
      const orderBookImbalance = poly.ok 
        ? calculateBidAskImbalance(poly.orderbook?.up, poly.orderbook?.down)
        : { upImbalance: null, downImbalance: null, netImbalance: null, smartMoneySignal: null };
      
      const { upImbalance, downImbalance, netImbalance, smartMoneySignal } = orderBookImbalance;

      // Calculate ADX (Average Directional Index) for trend strength detection
      // ADX >= 25: TRENDING market (use TREND_FOLLOW strategy)
      // ADX < 25: RANGING market (use MEAN_REVERT strategy)
      const adxResult = computeAdx(candles, 14);
      const { adx, plusDI, minusDI, trend: adxTrend } = adxResult;

      // Combined regime detection using ADX (primary) + VWAP (secondary)
      // This determines TRENDING vs RANGING for strategy selection
      const combinedRegime = detectCombinedRegime({
        adx,
        plusDI,
        minusDI,
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        vwapCrossCount,
        volumeRecent,
        volumeAvg
      });

      // Extract regime for logging and strategy adaptation
      const detectedRegime = combinedRegime.regime;           // 'TRENDING' | 'RANGING'
      const recommendedStrategy = combinedRegime.strategy;    // 'TREND_FOLLOW' | 'MEAN_REVERT'
      const regimeConfidence = combinedRegime.confidence;     // 0-100

      // Legacy regime info for backward compatibility
      const regimeInfo = detectRegime({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        vwapCrossCount,
        volumeRecent,
        volumeAvg
      });

      const scored = scoreDirection({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        rsi: rsiNow,
        rsiSlope,
        macd,
        heikenColor: consec.color,
        heikenCount: consec.count,
        failedVwapReclaim,
        priceMomentum5m,  // 5-minute price momentum
        volumeRatio,      // Volume confirmation ratio
        vwapDistancePct,  // VWAP distance for mean reversion
        strategy: recommendedStrategy,  // TREND_FOLLOW when ADX > 25, MEAN_REVERT otherwise
        smartMoneySignal  // Smart money signal when |netImbalance| > 0.3
      });

      const timeAware = applyTimeAwareness(scored.rawUp, timeLeftMin, CONFIG.candleWindowMinutes);

      const marketUp = poly.ok ? poly.prices.up : null;
      const marketDown = poly.ok ? poly.prices.down : null;
      const edge = computeEdge({ modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown, marketYes: marketUp, marketNo: marketDown });

      const rec = decide({ remainingMinutes: timeLeftMin, edgeUp: edge.edgeUp, edgeDown: edge.edgeDown, modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown });

      // ============================================================
      // Paper Trading Integration
      // ============================================================
      let paperResult = null;
      if (PAPER_CONFIG.enabled && poly.ok && currentPrice !== null && priceToBeat !== null) {
        // Build signal data for paper trading engine
        const signalData = {
          decision: rec,
          indicators: {
            rsi: rsiNow,
            rsiSlope,
            vwap: vwapNow,
            vwapSlope,
            macd,
            heikenColor: consec.color,
            heikenCount: consec.count,
            priceMomentum5m,  // 5-minute price momentum
            volumeRatio,      // Volume confirmation ratio
            vwapDistancePct,  // VWAP distance for mean reversion
            adx,              // ADX value for trend strength
            plusDI,           // +DI directional indicator
            minusDI,          // -DI directional indicator
            adxTrend,         // ADX trend classification (TRENDING/RANGING)
            detectedRegime,   // Combined regime: 'TRENDING' | 'RANGING'
            recommendedStrategy, // 'TREND_FOLLOW' | 'MEAN_REVERT'
            regimeConfidence,  // 0-100 confidence in regime detection
            upImbalance,      // Bid/ask imbalance for UP outcome (-1 to 1)
            downImbalance,    // Bid/ask imbalance for DOWN outcome (-1 to 1)
            netImbalance,     // Net imbalance (UP - DOWN), positive favors UP
            smartMoneySignal  // Smart money signal when |netImbalance| > 0.3
          },
          market: poly.market,
          currentPrice,
          priceToBeat,
          timeLeftMin
        };

        try {
          // Log SIGNAL_GENERATED event to activity.jsonl
          await logSignalGenerated({
            side: rec.side,
            action: rec.action,
            edge: rec.edge,
            phase: rec.phase,
            strength: rec.strength,
            indicators: signalData.indicators,
            market: {
              upPrice: poly.prices?.up,
              downPrice: poly.prices?.down,
              priceToBeat
            },
            currentPrice,
            priceToBeat,
            timeLeftMin,
            reason: rec.reason
          });
          
          paperResult = await paperEngine.processTick(signalData);
        } catch (err) {
          console.error("[Paper] Error processing tick:", err.message);
          await logError({ context: "paper_processTick", error: err, metadata: { signalData } });
        }
      }

      // Get paper trading status for display
      const paperStatus = PAPER_CONFIG.enabled ? paperEngine.getStatus() : null;
      const paperPortfolio = paperStatus?.portfolio || null;
      const paperActivePos = paperStatus?.activePosition || null;

      const vwapSlopeLabel = vwapSlope === null ? "-" : vwapSlope > 0 ? "UP" : vwapSlope < 0 ? "DOWN" : "FLAT";

      const macdLabel = macd === null
        ? "-"
        : macd.hist < 0
          ? (macd.histDelta !== null && macd.histDelta < 0 ? "bearish (expanding)" : "bearish")
          : (macd.histDelta !== null && macd.histDelta > 0 ? "bullish (expanding)" : "bullish");

      const lastCandle = klines1m.length ? klines1m[klines1m.length - 1] : null;
      const lastClose = lastCandle?.close ?? null;
      const close1mAgo = klines1m.length >= 2 ? klines1m[klines1m.length - 2]?.close ?? null : null;
      const close3mAgo = klines1m.length >= 4 ? klines1m[klines1m.length - 4]?.close ?? null : null;
      const delta1m = lastClose !== null && close1mAgo !== null ? lastClose - close1mAgo : null;
      const delta3m = lastClose !== null && close3mAgo !== null ? lastClose - close3mAgo : null;

      const haNarrative = (consec.color ?? "").toLowerCase() === "green" ? "LONG" : (consec.color ?? "").toLowerCase() === "red" ? "SHORT" : "NEUTRAL";
      const rsiNarrative = narrativeFromSlope(rsiSlope);
      const macdNarrative = narrativeFromSign(macd?.hist ?? null);
      const vwapNarrative = narrativeFromSign(vwapDist);

      const pLong = timeAware?.adjustedUp ?? null;
      const pShort = timeAware?.adjustedDown ?? null;
      const predictNarrative = (pLong !== null && pShort !== null && Number.isFinite(pLong) && Number.isFinite(pShort))
        ? (pLong > pShort ? "LONG" : pShort > pLong ? "SHORT" : "NEUTRAL")
        : "NEUTRAL";
      const predictValue = `${ANSI.green}LONG${ANSI.reset} ${ANSI.green}${formatProbPct(pLong, 0)}${ANSI.reset} / ${ANSI.red}SHORT${ANSI.reset} ${ANSI.red}${formatProbPct(pShort, 0)}${ANSI.reset}`;
      const predictLine = `Predict: ${predictValue}`;

      const marketUpStr = `${marketUp ?? "-"}${marketUp === null || marketUp === undefined ? "" : "¢"}`;
      const marketDownStr = `${marketDown ?? "-"}${marketDown === null || marketDown === undefined ? "" : "¢"}`;
      const polyHeaderValue = `${ANSI.green}↑ UP${ANSI.reset} ${marketUpStr}  |  ${ANSI.red}↓ DOWN${ANSI.reset} ${marketDownStr}`;

      const heikenValue = `${consec.color ?? "-"} x${consec.count}`;
      const heikenLine = formatNarrativeValue("Heiken Ashi", heikenValue, haNarrative);

      const rsiArrow = rsiSlope !== null && rsiSlope < 0 ? "↓" : rsiSlope !== null && rsiSlope > 0 ? "↑" : "-";
      const rsiValue = `${formatNumber(rsiNow, 1)} ${rsiArrow}`;
      const rsiLine = formatNarrativeValue("RSI", rsiValue, rsiNarrative);

      const macdLine = formatNarrativeValue("MACD", macdLabel, macdNarrative);

      const delta1Narrative = narrativeFromSign(delta1m);
      const delta3Narrative = narrativeFromSign(delta3m);
      const deltaValue = `${colorByNarrative(formatSignedDelta(delta1m, lastClose), delta1Narrative)} | ${colorByNarrative(formatSignedDelta(delta3m, lastClose), delta3Narrative)}`;
      const deltaLine = `Delta 1/3Min: ${deltaValue}`;

      const vwapValue = `${formatNumber(vwapNow, 0)} (${formatPct(vwapDist, 2)}) | slope: ${vwapSlopeLabel}`;
      const vwapLine = formatNarrativeValue("VWAP", vwapValue, vwapNarrative);

      // ADX display line - trend strength indicator
      const adxNarrative = adxTrend === "TRENDING" ? (plusDI > minusDI ? "LONG" : "SHORT") : "NEUTRAL";
      const adxTrendLabel = adxTrend === "TRENDING" 
        ? `${ANSI.green}TRENDING${ANSI.reset}` 
        : `${ANSI.yellow}RANGING${ANSI.reset}`;
      const adxValue = adx !== null 
        ? `${formatNumber(adx, 1)} | +DI: ${formatNumber(plusDI, 1)} | -DI: ${formatNumber(minusDI, 1)} | ${adxTrendLabel}`
        : "-";
      const adxLine = formatNarrativeValue("ADX", adxValue, adxNarrative);

      // Regime display line - TRENDING vs RANGING with strategy recommendation
      const regimeLabel = detectedRegime === "TRENDING"
        ? `${ANSI.green}TRENDING${ANSI.reset}`
        : detectedRegime === "RANGING"
          ? `${ANSI.yellow}RANGING${ANSI.reset}`
          : `${ANSI.dim}UNKNOWN${ANSI.reset}`;
      const strategyLabel = recommendedStrategy === "TREND_FOLLOW"
        ? `${ANSI.cyan}TREND_FOLLOW${ANSI.reset}`
        : `${ANSI.magenta}MEAN_REVERT${ANSI.reset}`;
      const regimeValue = `${regimeLabel} | Strategy: ${strategyLabel} | Conf: ${regimeConfidence}%`;
      const regimeNarrative = detectedRegime === "TRENDING" ? (plusDI > minusDI ? "LONG" : "SHORT") : "NEUTRAL";
      const regimeLine = formatNarrativeValue("Regime", regimeValue, regimeNarrative);

      // Order book imbalance display line - bid/ask imbalance from Polymarket
      const imbalanceNarrative = smartMoneySignal === "UP" ? "LONG" : smartMoneySignal === "DOWN" ? "SHORT" : "NEUTRAL";
      const smartMoneyLabel = smartMoneySignal 
        ? (smartMoneySignal === "UP" ? `${ANSI.green}SMART $ UP${ANSI.reset}` : `${ANSI.red}SMART $ DOWN${ANSI.reset}`)
        : `${ANSI.dim}Neutral${ANSI.reset}`;
      const imbalanceValue = netImbalance !== null
        ? `Net: ${netImbalance > 0 ? '+' : ''}${(netImbalance * 100).toFixed(0)}% | UP: ${(upImbalance * 100).toFixed(0)}% | DOWN: ${(downImbalance * 100).toFixed(0)}% | ${smartMoneyLabel}`
        : `${ANSI.dim}-${ANSI.reset}`;
      const orderBookImbalanceLine = colorByNarrative(imbalanceValue, imbalanceNarrative);

      const signal = rec.action === "ENTER" ? (rec.side === "UP" ? "BUY UP" : "BUY DOWN") : "NO TRADE";

      const actionLine = rec.action === "ENTER"
        ? `${rec.action} NOW (${rec.phase} ENTRY)`
        : `NO TRADE (${rec.phase})`;

      const spreadUp = poly.ok ? poly.orderbook.up.spread : null;
      const spreadDown = poly.ok ? poly.orderbook.down.spread : null;

      const spread = spreadUp !== null && spreadDown !== null ? Math.max(spreadUp, spreadDown) : (spreadUp ?? spreadDown);
      const liquidity = poly.ok
        ? (Number(poly.market?.liquidityNum) || Number(poly.market?.liquidity) || null)
        : null;

      const currentPriceBaseLine = colorPriceLine({
        label: "CURRENT PRICE",
        price: currentPrice,
        prevPrice: prevCurrentPrice,
        decimals: 2,
        prefix: "$"
      });

      const ptbDelta = (currentPrice !== null && priceToBeat !== null && Number.isFinite(currentPrice) && Number.isFinite(priceToBeat))
        ? currentPrice - priceToBeat
        : null;
      const ptbDeltaColor = ptbDelta === null
        ? ANSI.gray
        : ptbDelta > 0
          ? ANSI.green
          : ptbDelta < 0
            ? ANSI.red
            : ANSI.gray;
      const ptbDeltaText = ptbDelta === null
        ? `${ANSI.gray}-${ANSI.reset}`
        : `${ptbDeltaColor}${ptbDelta > 0 ? "+" : ptbDelta < 0 ? "-" : ""}$${Math.abs(ptbDelta).toFixed(2)}${ANSI.reset}`;
      const currentPriceValue = currentPriceBaseLine.split(": ")[1] ?? currentPriceBaseLine;
      const currentPriceLine = kv("CURRENT PRICE:", `${currentPriceValue} (${ptbDeltaText})`);

      if (poly.ok && poly.market && priceToBeatState.value === null) {
        const slug = safeFileSlug(poly.market.slug || poly.market.id || "market");
        if (slug && !dumpedMarkets.has(slug)) {
          dumpedMarkets.add(slug);
          try {
            fs.mkdirSync("./logs", { recursive: true });
            fs.writeFileSync(path.join("./logs", `polymarket_market_${slug}.json`), JSON.stringify(poly.market, null, 2), "utf8");
          } catch {
            // ignore
          }
        }
      }

      const binanceSpotBaseLine = colorPriceLine({ label: "BTC (Binance)", price: spotPrice, prevPrice: prevSpotPrice, decimals: 0, prefix: "$" });
      const diffLine = (spotPrice !== null && currentPrice !== null && Number.isFinite(spotPrice) && Number.isFinite(currentPrice) && currentPrice !== 0)
        ? (() => {
          const diffUsd = spotPrice - currentPrice;
          const diffPct = (diffUsd / currentPrice) * 100;
          const sign = diffUsd > 0 ? "+" : diffUsd < 0 ? "-" : "";
          return ` (${sign}$${Math.abs(diffUsd).toFixed(2)}, ${sign}${Math.abs(diffPct).toFixed(2)}%)`;
        })()
        : "";
      const binanceSpotLine = `${binanceSpotBaseLine}${diffLine}`;
      const binanceSpotValue = binanceSpotLine.split(": ")[1] ?? binanceSpotLine;
      const binanceSpotKvLine = kv("BTC (Binance):", binanceSpotValue);

      const titleLine = poly.ok ? `${poly.market?.question ?? "-"}` : "-";
      const marketLine = kv("Market:", poly.ok ? (poly.market?.slug ?? "-") : "-");

      const timeColor = timeLeftMin >= 10 && timeLeftMin <= 15
        ? ANSI.green
        : timeLeftMin >= 5 && timeLeftMin < 10
          ? ANSI.yellow
          : timeLeftMin >= 0 && timeLeftMin < 5
            ? ANSI.red
            : ANSI.reset;
      const timeLeftLine = `⏱ Time left: ${timeColor}${fmtTimeLeft(timeLeftMin)}${ANSI.reset}`;

      const polyTimeLeftColor = settlementLeftMin !== null
        ? (settlementLeftMin >= 10 && settlementLeftMin <= 15
          ? ANSI.green
          : settlementLeftMin >= 5 && settlementLeftMin < 10
            ? ANSI.yellow
            : settlementLeftMin >= 0 && settlementLeftMin < 5
              ? ANSI.red
              : ANSI.reset)
        : ANSI.reset;

      const lines = [
        titleLine,
        marketLine,
        kv("Time left:", `${timeColor}${fmtTimeLeft(timeLeftMin)}${ANSI.reset}`),
        "",
        sepLine(),
        "",
        kv("TA Predict:", predictValue),
        kv("Heiken Ashi:", heikenLine.split(": ")[1] ?? heikenLine),
        kv("RSI:", rsiLine.split(": ")[1] ?? rsiLine),
        kv("MACD:", macdLine.split(": ")[1] ?? macdLine),
        kv("ADX:", adxLine.split(": ")[1] ?? adxLine),
        kv("Regime:", regimeLine.split(": ")[1] ?? regimeLine),
        kv("OrderBook:", orderBookImbalanceLine),
        kv("Delta 1/3:", deltaLine.split(": ")[1] ?? deltaLine),
        kv("VWAP:", vwapLine.split(": ")[1] ?? vwapLine),
        "",
        sepLine(),
        "",
        kv("POLYMARKET:", polyHeaderValue),
        liquidity !== null ? kv("Liquidity:", formatNumber(liquidity, 0)) : null,
        settlementLeftMin !== null ? kv("Time left:", `${polyTimeLeftColor}${fmtTimeLeft(settlementLeftMin)}${ANSI.reset}`) : null,
        priceToBeat !== null ? kv("PRICE TO BEAT: ", `$${formatNumber(priceToBeat, 0)}`) : kv("PRICE TO BEAT: ", `${ANSI.gray}-${ANSI.reset}`),
        currentPriceLine,
        "",
        sepLine(),
        // Paper Trading Section
        ...(PAPER_CONFIG.enabled && paperPortfolio ? [
          "",
          section("📊 PAPER TRADING"),
          kv("Balance:", `${ANSI.white}$${paperPortfolio.balance.toFixed(2)}${ANSI.reset}`),
          kv("P&L:", paperPortfolio.totalPnl >= 0
            ? `${ANSI.green}+$${paperPortfolio.totalPnl.toFixed(2)}${ANSI.reset}`
            : `${ANSI.red}-$${Math.abs(paperPortfolio.totalPnl).toFixed(2)}${ANSI.reset}`),
          kv("Win Rate:", `${ANSI.white}${(paperPortfolio.winRate * 100).toFixed(1)}%${ANSI.reset} (${paperPortfolio.wins}W/${paperPortfolio.losses}L)`),
          kv("Max Drawdown:", `${ANSI.yellow}${(paperPortfolio.maxDrawdown * 100).toFixed(1)}%${ANSI.reset}`),
          kv("Auto-Trade:", paperStatus?.autoTradeEnabled ? `${ANSI.green}ON${ANSI.reset}` : `${ANSI.red}OFF${ANSI.reset}`),
          paperActivePos ? kv("Position:", `${paperActivePos.side === "UP" ? ANSI.green : ANSI.red}${paperActivePos.side}${ANSI.reset} $${paperActivePos.positionSize.toFixed(0)} @ ${paperActivePos.edge.toFixed(1)}% edge`)
            : kv("Position:", `${ANSI.gray}None${ANSI.reset}`),
          paperResult && paperResult.action === "TRADE_ENTERED" ? `${ANSI.green}🎯 TRADE ENTERED: ${paperResult.trade?.side} $${paperResult.trade?.positionSize.toFixed(0)}${ANSI.reset}` : null,
          paperResult && paperResult.action === "TRADE_RESOLVED" ? `${paperResult.result === "WIN" ? ANSI.green : ANSI.red}🏁 TRADE RESOLVED: ${paperResult.result} ${paperResult.pnl >= 0 ? '+' : ''}$${paperResult.pnl.toFixed(2)} (BTC $${paperResult.finalPrice?.toFixed(0)} vs $${paperResult.priceToBeat?.toFixed(0)})${ANSI.reset}` : null,
          ""
        ] : []),
        sepLine(),
        "",
        binanceSpotKvLine,
        "",
        sepLine(),
        "",
        kv("ET | Session:", `${ANSI.white}${fmtEtTime(new Date())}${ANSI.reset} | ${ANSI.white}${getBtcSession(new Date())}${ANSI.reset}`),
        "",
        sepLine(),
        centerText(`${ANSI.dim}${ANSI.gray}created by @krajekis${ANSI.reset}`, screenWidth())
      ].filter((x) => x !== null);

      renderScreen(lines.join("\n") + "\n");

      prevSpotPrice = spotPrice ?? prevSpotPrice;
      prevCurrentPrice = currentPrice ?? prevCurrentPrice;

      appendCsvRow("./logs/signals.csv", header, [
        new Date().toISOString(),
        timing.elapsedMinutes.toFixed(3),
        timeLeftMin.toFixed(3),
        regimeInfo.regime,
        signal,
        timeAware.adjustedUp,
        timeAware.adjustedDown,
        marketUp,
        marketDown,
        edge.edgeUp,
        edge.edgeDown,
        rec.action === "ENTER" ? `${rec.side}:${rec.phase}:${rec.strength}` : "NO_TRADE"
      ]);
    } catch (err) {
      console.log("────────────────────────────");
      console.log(`Error: ${err?.message ?? String(err)}`);
      console.log("────────────────────────────");
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

/**
 * Display session summary to console
 * @param {Object} summary - Session summary from generateSessionSummary()
 */
function displaySessionSummary(summary) {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    📊 SESSION SUMMARY                          ");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log(`  Total Trades:     ${summary.totalTrades}`);
  console.log(`  Wins:             ${ANSI.green}${summary.wins}${ANSI.reset}`);
  console.log(`  Losses:           ${ANSI.red}${summary.losses}${ANSI.reset}`);
  console.log(`  Win Rate:         ${(summary.winRate * 100).toFixed(1)}%`);
  console.log("");
  console.log(`  Total P&L:        ${summary.totalPnl >= 0 ? ANSI.green + '+' : ANSI.red}$${summary.totalPnl.toFixed(2)}${ANSI.reset}`);
  console.log(`  Final Balance:    $${summary.finalBalance.toFixed(2)}`);
  console.log(`  Return:           ${summary.returnPct >= 0 ? ANSI.green + '+' : ANSI.red}${summary.returnPct.toFixed(2)}%${ANSI.reset}`);
  console.log("");
  console.log(`  Max Drawdown:     ${ANSI.yellow}${(summary.maxDrawdown * 100).toFixed(2)}%${ANSI.reset}`);
  console.log(`  Peak Balance:     $${summary.peakBalance.toFixed(2)}`);
  
  // Sharpe ratio with color coding (>1 is good, >2 is great, <0 is poor)
  const sharpeColor = summary.sharpeRatio >= 1 ? ANSI.green : summary.sharpeRatio >= 0 ? ANSI.yellow : ANSI.red;
  console.log(`  Sharpe Ratio:     ${sharpeColor}${summary.sharpeRatio.toFixed(2)}${ANSI.reset}`);
  console.log("");
  console.log(`  Session Duration: ${summary.sessionDurationMin} minutes`);
  console.log(`  Avg Position:     $${summary.avgPositionSize.toFixed(2)}`);
  console.log(`  Avg Edge:         ${(summary.avgEdge * 100).toFixed(2)}%`);
  console.log(`  Avg P&L/Trade:    ${summary.avgPnlPerTrade >= 0 ? '+' : ''}$${summary.avgPnlPerTrade.toFixed(2)}`);
  console.log("");
  console.log(`  Max Win Streak:   ${ANSI.green}${summary.maxWinStreak}${ANSI.reset}`);
  console.log(`  Max Loss Streak:  ${ANSI.red}${summary.maxLossStreak}${ANSI.reset}`);
  
  if (summary.bestTrade) {
    console.log(`  Best Trade:       ${ANSI.green}+$${summary.bestTrade.pnl?.toFixed(2)}${ANSI.reset} (${summary.bestTrade.side})`);
  }
  if (summary.worstTrade) {
    console.log(`  Worst Trade:      ${ANSI.red}$${summary.worstTrade.pnl?.toFixed(2)}${ANSI.reset} (${summary.worstTrade.side})`);
  }
  
  // Phase breakdown (EARLY/MID/LATE)
  if (summary.byPhase) {
    console.log("");
    console.log("  ─── By Phase ───────────────────────────────────────────────");
    for (const phase of ['EARLY', 'MID', 'LATE']) {
      const p = summary.byPhase[phase];
      if (p.trades > 0) {
        const winRatePct = (p.winRate * 100).toFixed(0);
        const pnlColor = p.pnl >= 0 ? ANSI.green : ANSI.red;
        const pnlSign = p.pnl >= 0 ? '+' : '';
        console.log(`  ${phase.padEnd(6)} ${p.wins}W/${p.losses}L (${winRatePct}% WR)  ${pnlColor}${pnlSign}$${p.pnl.toFixed(2)}${ANSI.reset}`);
      } else {
        console.log(`  ${phase.padEnd(6)} No trades`);
      }
    }
  }
  
  // Strength breakdown (STRONG/GOOD/OPTIONAL)
  if (summary.byStrength) {
    console.log("");
    console.log("  ─── By Strength ────────────────────────────────────────────");
    for (const strength of ['STRONG', 'GOOD', 'OPTIONAL']) {
      const s = summary.byStrength[strength];
      if (s.trades > 0) {
        const winRatePct = (s.winRate * 100).toFixed(0);
        const pnlColor = s.pnl >= 0 ? ANSI.green : ANSI.red;
        const pnlSign = s.pnl >= 0 ? '+' : '';
        console.log(`  ${strength.padEnd(9)} ${s.wins}W/${s.losses}L (${winRatePct}% WR)  ${pnlColor}${pnlSign}$${s.pnl.toFixed(2)}${ANSI.reset}`);
      } else {
        console.log(`  ${strength.padEnd(9)} No trades`);
      }
    }
  }
  
  if (summary.pendingTrades > 0) {
    console.log("");
    console.log(`  ${ANSI.yellow}⚠ ${summary.pendingTrades} pending trade(s) not included in stats${ANSI.reset}`);
  }
  if (summary.activePosition) {
    console.log(`  ${ANSI.yellow}⚠ Active position: ${summary.activePosition.side} $${summary.activePosition.positionSize.toFixed(0)}${ANSI.reset}`);
  }
  
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
}

/**
 * Handle graceful shutdown with session summary
 */
async function handleShutdown(signal) {
  console.log(`\n\n${ANSI.yellow}Received ${signal}, shutting down gracefully...${ANSI.reset}`);
  
  if (PAPER_CONFIG.enabled) {
    try {
      const paperEngine = getPaperTradingEngine();
      const summary = paperEngine.generateSessionSummary();
      
      // Display summary to console
      displaySessionSummary(summary);
      
      // Send summary to Discord if enabled
      if (isDiscordEnabled()) {
        console.log(`${ANSI.gray}Sending session summary to Discord...${ANSI.reset}`);
        await notifySessionSummary(summary);
        console.log(`${ANSI.green}✓ Session summary sent to Discord${ANSI.reset}`);
      }
      
    } catch (err) {
      console.error(`${ANSI.red}Error generating session summary:${ANSI.reset}`, err.message);
    }
  }
  
  console.log(`${ANSI.gray}Goodbye!${ANSI.reset}\n`);
  process.exit(0);
}

// Setup graceful shutdown handlers
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

main();
