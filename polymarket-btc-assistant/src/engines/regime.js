/**
 * Regime Detection Module
 * 
 * Detects market regime (TRENDING vs RANGING) using multiple signals:
 * 1. ADX-based: ADX >= 25 = TRENDING, ADX < 25 = RANGING
 * 2. VWAP-based: Price position relative to VWAP with slope analysis
 * 3. Volume-based: Low volume = choppy/ranging conditions
 * 
 * Recommended strategies:
 * - TRENDING: Use TREND_FOLLOW strategy (ride momentum)
 * - RANGING: Use MEAN_REVERT strategy (fade extremes)
 */

/** @typedef {'TRENDING' | 'RANGING' | 'UNKNOWN'} RegimeType */
/** @typedef {'TREND_FOLLOW' | 'MEAN_REVERT'} StrategyType */

/**
 * ADX-based regime detection - the primary TRENDING vs RANGING detector
 * 
 * @param {number | null} adx - ADX value (0-100)
 * @param {number | null} plusDI - +DI value
 * @param {number | null} minusDI - -DI value
 * @param {number} threshold - ADX threshold for trending (default 25)
 * @returns {{ regime: RegimeType, strength: string, direction: string, confidence: number, strategy: StrategyType }}
 */
export function detectAdxRegime(adx, plusDI = null, minusDI = null, threshold = 25) {
  if (adx === null || adx === undefined) {
    return {
      regime: "UNKNOWN",
      strength: "UNKNOWN",
      direction: "NEUTRAL",
      confidence: 0,
      strategy: "MEAN_REVERT"
    };
  }

  const isTrending = adx >= threshold;
  const regime = isTrending ? "TRENDING" : "RANGING";
  
  // Determine trend strength
  let strength;
  if (adx < 15) strength = "ABSENT";
  else if (adx < 25) strength = "WEAK";
  else if (adx < 40) strength = "MODERATE";
  else if (adx < 55) strength = "STRONG";
  else strength = "VERY_STRONG";

  // Determine direction from +DI/-DI
  let direction = "NEUTRAL";
  if (plusDI !== null && minusDI !== null) {
    if (plusDI > minusDI + 5) direction = "BULLISH";      // Clear bullish
    else if (minusDI > plusDI + 5) direction = "BEARISH"; // Clear bearish
    else direction = "NEUTRAL";                            // Indecisive
  }

  // Confidence based on ADX distance from threshold and DI spread
  const distanceFromThreshold = Math.abs(adx - threshold);
  const diSpread = plusDI !== null && minusDI !== null ? Math.abs(plusDI - minusDI) : 0;
  const confidence = Math.min(100, distanceFromThreshold * 2 + diSpread);

  // Strategy recommendation
  const strategy = isTrending ? "TREND_FOLLOW" : "MEAN_REVERT";

  return { regime, strength, direction, confidence, strategy };
}

/**
 * VWAP-based regime detection (legacy/complementary)
 * 
 * @param {Object} params
 * @param {number | null} params.price - Current price
 * @param {number | null} params.vwap - VWAP value
 * @param {number | null} params.vwapSlope - VWAP slope
 * @param {number | null} params.vwapCrossCount - Number of VWAP crosses
 * @param {number | null} params.volumeRecent - Recent volume
 * @param {number | null} params.volumeAvg - Average volume
 * @returns {{ regime: string, reason: string }}
 */
export function detectVwapRegime({ price, vwap, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg }) {
  if (price === null || vwap === null || vwapSlope === null) {
    return { regime: "CHOP", reason: "missing_inputs" };
  }

  const above = price > vwap;

  const lowVolume = volumeRecent !== null && volumeAvg !== null ? volumeRecent < 0.6 * volumeAvg : false;
  if (lowVolume && Math.abs((price - vwap) / vwap) < 0.001) {
    return { regime: "CHOP", reason: "low_volume_flat" };
  }

  if (above && vwapSlope > 0) {
    return { regime: "TREND_UP", reason: "price_above_vwap_slope_up" };
  }

  if (!above && vwapSlope < 0) {
    return { regime: "TREND_DOWN", reason: "price_below_vwap_slope_down" };
  }

  if (vwapCrossCount !== null && vwapCrossCount >= 3) {
    return { regime: "RANGE", reason: "frequent_vwap_cross" };
  }

  return { regime: "RANGE", reason: "default" };
}

/**
 * Combined regime detection using both ADX and VWAP signals
 * ADX is the primary signal for TRENDING vs RANGING classification
 * 
 * @param {Object} params
 * @param {number | null} params.adx - ADX value
 * @param {number | null} params.plusDI - +DI value
 * @param {number | null} params.minusDI - -DI value
 * @param {number | null} params.price - Current price
 * @param {number | null} params.vwap - VWAP value
 * @param {number | null} params.vwapSlope - VWAP slope
 * @param {number | null} params.vwapCrossCount - Number of VWAP crosses
 * @param {number | null} params.volumeRecent - Recent volume
 * @param {number | null} params.volumeAvg - Average volume
 * @returns {{ 
 *   regime: RegimeType, 
 *   strategy: StrategyType, 
 *   adxRegime: Object, 
 *   vwapRegime: Object, 
 *   confidence: number,
 *   reason: string 
 * }}
 */
export function detectCombinedRegime({
  adx,
  plusDI,
  minusDI,
  price,
  vwap,
  vwapSlope,
  vwapCrossCount,
  volumeRecent,
  volumeAvg
}) {
  // Get ADX-based regime (primary)
  const adxRegime = detectAdxRegime(adx, plusDI, minusDI);
  
  // Get VWAP-based regime (secondary)
  const vwapRegime = detectVwapRegime({ price, vwap, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg });

  // ADX is the primary determinant of TRENDING vs RANGING
  let regime = adxRegime.regime;
  let strategy = adxRegime.strategy;
  let confidence = adxRegime.confidence;
  let reason = `adx_${adxRegime.strength.toLowerCase()}`;

  // Boost confidence if VWAP confirms ADX
  const vwapTrending = vwapRegime.regime === "TREND_UP" || vwapRegime.regime === "TREND_DOWN";
  const vwapRanging = vwapRegime.regime === "RANGE" || vwapRegime.regime === "CHOP";

  if (regime === "TRENDING" && vwapTrending) {
    confidence = Math.min(100, confidence + 15);
    reason = "adx_vwap_trending_confirmed";
  } else if (regime === "RANGING" && vwapRanging) {
    confidence = Math.min(100, confidence + 10);
    reason = "adx_vwap_ranging_confirmed";
  } else if (regime === "TRENDING" && vwapRanging) {
    // ADX says trending but VWAP says ranging - reduce confidence
    confidence = Math.max(0, confidence - 10);
    reason = "adx_trending_vwap_ranging_conflict";
  } else if (regime === "RANGING" && vwapTrending) {
    // ADX says ranging but VWAP says trending - weak trend starting?
    confidence = Math.max(0, confidence - 5);
    reason = "adx_ranging_vwap_trending_possible_breakout";
  }

  // Handle unknown ADX
  if (regime === "UNKNOWN") {
    // Fall back to VWAP-based detection
    if (vwapTrending) {
      regime = "TRENDING";
      strategy = "TREND_FOLLOW";
      confidence = 30;
      reason = "vwap_trending_fallback";
    } else {
      regime = "RANGING";
      strategy = "MEAN_REVERT";
      confidence = 30;
      reason = "vwap_ranging_fallback";
    }
  }

  return {
    regime,
    strategy,
    adxRegime,
    vwapRegime,
    confidence,
    reason
  };
}

/**
 * Legacy detectRegime function - maintained for backward compatibility
 * Now internally uses VWAP-based detection
 */
export function detectRegime({ price, vwap, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg }) {
  return detectVwapRegime({ price, vwap, vwapSlope, vwapCrossCount, volumeRecent, volumeAvg });
}

/**
 * Check if current regime is TRENDING
 * @param {RegimeType} regime 
 * @returns {boolean}
 */
export function isTrendingRegime(regime) {
  return regime === "TRENDING";
}

/**
 * Check if current regime is RANGING
 * @param {RegimeType} regime 
 * @returns {boolean}
 */
export function isRangingRegime(regime) {
  return regime === "RANGING";
}

/**
 * Get recommended strategy for a regime
 * @param {RegimeType} regime 
 * @returns {StrategyType}
 */
export function getRegimeStrategy(regime) {
  return regime === "TRENDING" ? "TREND_FOLLOW" : "MEAN_REVERT";
}
