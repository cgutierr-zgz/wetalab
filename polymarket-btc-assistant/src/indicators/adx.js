/**
 * Simplified ADX (Average Directional Index) implementation
 * 
 * ADX measures trend strength on a scale of 0-100:
 * - ADX > 25: Strong trending market (use TREND_FOLLOW strategy)
 * - ADX < 25: Ranging/consolidating market (use MEAN_REVERT strategy)
 * 
 * Simplified calculation uses Wilder's smoothing method:
 * 1. Calculate +DM (positive directional movement) and -DM (negative directional movement)
 * 2. Calculate TR (True Range)
 * 3. Smooth +DM, -DM, TR using Wilder's smoothing
 * 4. Calculate +DI and -DI (directional indicators)
 * 5. Calculate DX = |+DI - -DI| / (+DI + -DI) * 100
 * 6. ADX = Wilder's smoothed average of DX
 */

import { clamp } from "../utils.js";

/**
 * Calculate True Range for a single candle
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 * @param {Object} candle - Current candle { high, low, close }
 * @param {number} prevClose - Previous candle's close price
 * @returns {number} True Range value
 */
function calculateTrueRange(candle, prevClose) {
  const highLow = candle.high - candle.low;
  const highPrevClose = Math.abs(candle.high - prevClose);
  const lowPrevClose = Math.abs(candle.low - prevClose);
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Calculate Directional Movement (+DM and -DM)
 * +DM = high - prevHigh (if positive and > |low - prevLow|, else 0)
 * -DM = prevLow - low (if positive and > high - prevHigh, else 0)
 * @param {Object} candle - Current candle { high, low }
 * @param {Object} prevCandle - Previous candle { high, low }
 * @returns {{ plusDM: number, minusDM: number }}
 */
function calculateDirectionalMovement(candle, prevCandle) {
  const upMove = candle.high - prevCandle.high;
  const downMove = prevCandle.low - candle.low;

  let plusDM = 0;
  let minusDM = 0;

  if (upMove > downMove && upMove > 0) {
    plusDM = upMove;
  }
  if (downMove > upMove && downMove > 0) {
    minusDM = downMove;
  }

  return { plusDM, minusDM };
}

/**
 * Apply Wilder's smoothing (exponential-like smoothing)
 * smoothed = prevSmoothed - (prevSmoothed / period) + currentValue
 * @param {number} prevSmoothed - Previous smoothed value
 * @param {number} currentValue - Current value to add
 * @param {number} period - Smoothing period
 * @returns {number} New smoothed value
 */
function wilderSmooth(prevSmoothed, currentValue, period) {
  return prevSmoothed - (prevSmoothed / period) + currentValue;
}

/**
 * Compute simplified ADX from candle data
 * 
 * @param {Array<{open: number, high: number, low: number, close: number}>} candles - OHLC candle array
 * @param {number} period - ADX period (default 14)
 * @returns {{ adx: number | null, plusDI: number | null, minusDI: number | null, trend: string }}
 * 
 * @example
 * const result = computeAdx(candles, 14);
 * // result: { adx: 28.5, plusDI: 25.3, minusDI: 18.7, trend: 'TRENDING' }
 */
export function computeAdx(candles, period = 14) {
  // Need at least 2*period + 1 candles for a meaningful ADX
  const minCandles = period * 2 + 1;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { adx: null, plusDI: null, minusDI: null, trend: "UNKNOWN" };
  }

  // Calculate initial sums for the first period
  let sumTR = 0;
  let sumPlusDM = 0;
  let sumMinusDM = 0;

  // Start from index 1 since we need previous candle
  for (let i = 1; i <= period; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    
    sumTR += calculateTrueRange(candle, prevCandle.close);
    const { plusDM, minusDM } = calculateDirectionalMovement(candle, prevCandle);
    sumPlusDM += plusDM;
    sumMinusDM += minusDM;
  }

  // Apply Wilder's smoothing for remaining candles
  let smoothedTR = sumTR;
  let smoothedPlusDM = sumPlusDM;
  let smoothedMinusDM = sumMinusDM;

  // Calculate DX series for ADX smoothing
  const dxSeries = [];

  for (let i = period + 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];

    const tr = calculateTrueRange(candle, prevCandle.close);
    const { plusDM, minusDM } = calculateDirectionalMovement(candle, prevCandle);

    // Wilder's smoothing
    smoothedTR = wilderSmooth(smoothedTR, tr, period);
    smoothedPlusDM = wilderSmooth(smoothedPlusDM, plusDM, period);
    smoothedMinusDM = wilderSmooth(smoothedMinusDM, minusDM, period);

    // Calculate +DI and -DI
    const plusDI = smoothedTR > 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    const minusDI = smoothedTR > 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

    // Calculate DX
    const diSum = plusDI + minusDI;
    const diDiff = Math.abs(plusDI - minusDI);
    const dx = diSum > 0 ? (diDiff / diSum) * 100 : 0;

    dxSeries.push({ dx, plusDI, minusDI });
  }

  // Need at least 'period' DX values to calculate ADX
  if (dxSeries.length < period) {
    return { adx: null, plusDI: null, minusDI: null, trend: "UNKNOWN" };
  }

  // Calculate initial ADX (simple average of first 'period' DX values)
  let adx = 0;
  for (let i = 0; i < period; i++) {
    adx += dxSeries[i].dx;
  }
  adx = adx / period;

  // Apply Wilder's smoothing to get final ADX
  for (let i = period; i < dxSeries.length; i++) {
    adx = wilderSmooth(adx, dxSeries[i].dx, period);
  }

  // Get latest +DI and -DI
  const latest = dxSeries[dxSeries.length - 1];
  const plusDI = clamp(latest.plusDI, 0, 100);
  const minusDI = clamp(latest.minusDI, 0, 100);
  const finalAdx = clamp(adx, 0, 100);

  // Determine trend based on ADX threshold
  const trend = finalAdx >= 25 ? "TRENDING" : "RANGING";

  return {
    adx: finalAdx,
    plusDI,
    minusDI,
    trend
  };
}

/**
 * Compute ADX series for charting/analysis
 * Returns an array of ADX values aligned with candle timestamps
 * 
 * @param {Array<{open: number, high: number, low: number, close: number, openTime?: number}>} candles 
 * @param {number} period - ADX period (default 14)
 * @returns {Array<{ time: number, adx: number, plusDI: number, minusDI: number, trend: string }>}
 */
export function computeAdxSeries(candles, period = 14) {
  const minCandles = period * 2 + 1;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    return [];
  }

  const series = [];

  // We need a rolling window approach for series
  for (let endIdx = minCandles; endIdx <= candles.length; endIdx++) {
    const subset = candles.slice(0, endIdx);
    const result = computeAdx(subset, period);
    
    if (result.adx !== null) {
      const candle = candles[endIdx - 1];
      series.push({
        time: candle.openTime || endIdx,
        adx: result.adx,
        plusDI: result.plusDI,
        minusDI: result.minusDI,
        trend: result.trend
      });
    }
  }

  return series;
}

/**
 * Get the latest ADX value from candles
 * Convenience function for real-time usage
 * 
 * @param {Array<{open: number, high: number, low: number, close: number}>} candles
 * @param {number} period - ADX period (default 14)
 * @returns {{ adx: number | null, plusDI: number | null, minusDI: number | null, trend: string }}
 */
export function getAdx(candles, period = 14) {
  return computeAdx(candles, period);
}

/**
 * Determine if market is trending strongly
 * @param {number} adx - ADX value
 * @returns {boolean} True if ADX >= 25 (trending market)
 */
export function isTrending(adx) {
  if (adx === null || adx === undefined) return false;
  return adx >= 25;
}

/**
 * Determine if market is ranging
 * @param {number} adx - ADX value
 * @returns {boolean} True if ADX < 25 (ranging market)
 */
export function isRanging(adx) {
  if (adx === null || adx === undefined) return false;
  return adx < 25;
}

/**
 * Get trend strength description
 * @param {number} adx - ADX value
 * @returns {string} Trend strength: "ABSENT", "WEAK", "MODERATE", "STRONG", "VERY_STRONG"
 */
export function getTrendStrength(adx) {
  if (adx === null || adx === undefined) return "UNKNOWN";
  if (adx < 15) return "ABSENT";      // No trend
  if (adx < 25) return "WEAK";        // Weak trend
  if (adx < 50) return "MODERATE";    // Moderate trend
  if (adx < 75) return "STRONG";      // Strong trend
  return "VERY_STRONG";               // Very strong trend
}

/**
 * Get recommended strategy based on ADX
 * @param {number} adx - ADX value
 * @returns {string} "TREND_FOLLOW" or "MEAN_REVERT"
 */
export function getRecommendedStrategy(adx) {
  if (adx === null || adx === undefined) return "MEAN_REVERT";
  return adx >= 25 ? "TREND_FOLLOW" : "MEAN_REVERT";
}
