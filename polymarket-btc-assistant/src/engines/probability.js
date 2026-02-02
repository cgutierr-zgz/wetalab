import { clamp } from "../utils.js";

/**
 * Calculate 5-minute price momentum from candles
 * @param {Array} closes - Array of close prices (1m candles)
 * @param {number} lookbackMinutes - Lookback period (default 5 minutes)
 * @returns {{ priceMomentum5m: number | null, pricePctChange: number | null }}
 */
export function calculatePriceMomentum(closes, lookbackMinutes = 5) {
  if (!closes || closes.length < lookbackMinutes + 1) {
    return { priceMomentum5m: null, pricePctChange: null };
  }
  
  const currentPrice = closes[closes.length - 1];
  const priceNMinutesAgo = closes[closes.length - 1 - lookbackMinutes];
  
  if (!currentPrice || !priceNMinutesAgo || priceNMinutesAgo === 0) {
    return { priceMomentum5m: null, pricePctChange: null };
  }
  
  const pricePctChange = ((currentPrice - priceNMinutesAgo) / priceNMinutesAgo) * 100;
  
  return { priceMomentum5m: pricePctChange, pricePctChange };
}

/**
 * Calculate volume ratio (recent volume vs average volume)
 * @param {number} volumeRecent - Recent volume (e.g., last 20 candles)
 * @param {number} volumeAvg - Average volume (e.g., last 120 candles / 6)
 * @returns {{ volumeRatio: number | null }}
 */
export function calculateVolumeRatio(volumeRecent, volumeAvg) {
  if (volumeRecent === null || volumeRecent === undefined || 
      volumeAvg === null || volumeAvg === undefined || volumeAvg === 0) {
    return { volumeRatio: null };
  }
  
  const volumeRatio = volumeRecent / volumeAvg;
  return { volumeRatio };
}

/**
 * Calculate VWAP distance for mean reversion signal
 * Returns the percentage distance from VWAP (positive = above, negative = below)
 * @param {number} price - Current price
 * @param {number} vwap - Current VWAP value
 * @returns {{ vwapDistancePct: number | null }}
 */
export function calculateVwapDistance(price, vwap) {
  if (price === null || price === undefined || 
      vwap === null || vwap === undefined || vwap === 0) {
    return { vwapDistancePct: null };
  }
  
  // Calculate percentage distance from VWAP
  // Positive = price above VWAP, Negative = price below VWAP
  const vwapDistancePct = ((price - vwap) / vwap) * 100;
  return { vwapDistancePct };
}

/**
 * Calculate bid/ask imbalance from Polymarket order book
 * 
 * Imbalance formula: (bidLiquidity - askLiquidity) / (bidLiquidity + askLiquidity)
 * - Positive imbalance: More buyers than sellers (bullish pressure)
 * - Negative imbalance: More sellers than buyers (bearish pressure)
 * - Imbalance > 0.3: Strong smart money signal
 * 
 * @param {Object} upBook - Order book summary for UP outcome
 * @param {number} upBook.bidLiquidity - Total bid liquidity for UP
 * @param {number} upBook.askLiquidity - Total ask liquidity for UP
 * @param {Object} downBook - Order book summary for DOWN outcome
 * @param {number} downBook.bidLiquidity - Total bid liquidity for DOWN
 * @param {number} downBook.askLiquidity - Total ask liquidity for DOWN
 * @returns {{ upImbalance: number | null, downImbalance: number | null, netImbalance: number | null, smartMoneySignal: string | null }}
 */
export function calculateBidAskImbalance(upBook, downBook) {
  const result = {
    upImbalance: null,
    downImbalance: null,
    netImbalance: null,
    smartMoneySignal: null
  };

  // Calculate UP outcome imbalance
  const upBid = upBook?.bidLiquidity ?? null;
  const upAsk = upBook?.askLiquidity ?? null;
  if (upBid !== null && upAsk !== null && (upBid + upAsk) > 0) {
    result.upImbalance = (upBid - upAsk) / (upBid + upAsk);
  }

  // Calculate DOWN outcome imbalance
  const downBid = downBook?.bidLiquidity ?? null;
  const downAsk = downBook?.askLiquidity ?? null;
  if (downBid !== null && downAsk !== null && (downBid + downAsk) > 0) {
    result.downImbalance = (downBid - downAsk) / (downBid + downAsk);
  }

  // Calculate net imbalance (UP - DOWN)
  // Positive net: Smart money favoring UP (more buyers for UP, more sellers for DOWN)
  // Negative net: Smart money favoring DOWN (more buyers for DOWN, more sellers for UP)
  if (result.upImbalance !== null && result.downImbalance !== null) {
    result.netImbalance = result.upImbalance - result.downImbalance;
    
    // Detect smart money signal when imbalance > 0.3 (significant directional bias)
    if (result.netImbalance > 0.3) {
      result.smartMoneySignal = 'UP';
    } else if (result.netImbalance < -0.3) {
      result.smartMoneySignal = 'DOWN';
    } else {
      result.smartMoneySignal = null; // Neutral / no strong signal
    }
  }

  return result;
}

export function scoreDirection(inputs) {
  const {
    price,
    vwap,
    vwapSlope,
    rsi,
    rsiSlope,
    macd,
    heikenColor,
    heikenCount,
    failedVwapReclaim,
    priceMomentum5m,  // 5-minute price momentum (% change)
    volumeRatio,      // Volume confirmation (recent vs avg)
    vwapDistancePct,  // VWAP distance for mean reversion (% from VWAP)
    strategy,         // 'TREND_FOLLOW' | 'MEAN_REVERT' based on ADX regime
    smartMoneySignal  // Smart money signal when |netImbalance| > 0.3 ('UP' | 'DOWN' | null)
  } = inputs;

  // Strategy selection based on ADX regime
  const useTrendFollow = strategy === "TREND_FOLLOW";
  const useMeanRevert = strategy === "MEAN_REVERT";

  let up = 1;
  let down = 1;

  if (price !== null && vwap !== null) {
    if (price > vwap) up += 2;
    if (price < vwap) down += 2;
  }

  if (vwapSlope !== null) {
    if (vwapSlope > 0) up += 2;
    if (vwapSlope < 0) down += 2;
  }

  if (rsi !== null && rsiSlope !== null) {
    if (rsi > 55 && rsiSlope > 0) up += 2;
    if (rsi < 45 && rsiSlope < 0) down += 2;
  }

  if (macd?.hist !== null && macd?.histDelta !== null) {
    const expandingGreen = macd.hist > 0 && macd.histDelta > 0;
    const expandingRed = macd.hist < 0 && macd.histDelta < 0;
    if (expandingGreen) up += 2;
    if (expandingRed) down += 2;

    if (macd.macd > 0) up += 1;
    if (macd.macd < 0) down += 1;
  }

  if (heikenColor) {
    if (heikenColor === "green" && heikenCount >= 2) up += 1;
    if (heikenColor === "red" && heikenCount >= 2) down += 1;
  }

  if (failedVwapReclaim === true) down += 3;

  // ============================================================
  // TREND_FOLLOW Strategy Boost (ADX > 25)
  // When market is trending, boost trend-following signals
  // ============================================================
  if (useTrendFollow) {
    // Heiken Ashi continuation: extra +2 in trend mode for strong trends (3+ consecutive candles)
    if (heikenColor === "green" && heikenCount >= 3) up += 2;
    if (heikenColor === "red" && heikenCount >= 3) down += 2;
    
    // MACD trend confirmation: extra +1 for strong MACD alignment in trend mode
    if (macd?.hist !== null && macd?.macd !== null) {
      // Strong bullish: MACD > 0, histogram > 0, and MACD above signal
      if (macd.macd > 0 && macd.hist > 0) up += 1;
      // Strong bearish: MACD < 0, histogram < 0, and MACD below signal
      if (macd.macd < 0 && macd.hist < 0) down += 1;
    }
    
    // VWAP trend alignment: extra +1 when price and slope agree (trend confirmation)
    if (price !== null && vwap !== null && vwapSlope !== null) {
      // Price above VWAP with positive slope = bullish trend confirmation
      if (price > vwap && vwapSlope > 0) up += 1;
      // Price below VWAP with negative slope = bearish trend confirmation
      if (price < vwap && vwapSlope < 0) down += 1;
    }
  }

  // ============================================================
  // MEAN_REVERT Strategy Boost (ADX < 25)
  // When market is ranging, boost mean reversion signals
  // ============================================================
  if (useMeanRevert) {
    // RSI Extremes: extra +2 for overbought/oversold reversals in ranging markets
    // In ranging conditions, RSI extremes are more likely to revert
    if (rsi !== null) {
      // Overbought reversal: RSI > 70 suggests price likely to fall
      if (rsi > 70) down += 2;
      // Oversold reversal: RSI < 30 suggests price likely to rise
      if (rsi < 30) up += 2;
      
      // Moderate overbought/oversold: +1 for RSI extremes (65-70 or 30-35)
      if (rsi >= 65 && rsi <= 70) down += 1;
      if (rsi >= 30 && rsi <= 35) up += 1;
    }
    
    // VWAP Distance Mean Reversion: extra +2 in ranging mode (vs +1 in default)
    // Price extended from VWAP in ranging markets strongly favors reversion
    if (vwapDistancePct !== null && vwapDistancePct !== undefined) {
      const VWAP_DISTANCE_THRESHOLD = 0.5; // 0.5% threshold
      const VWAP_STRONG_THRESHOLD = 1.0;   // 1.0% for extra boost
      
      if (vwapDistancePct > VWAP_STRONG_THRESHOLD) {
        // Price extended significantly ABOVE VWAP, strong reversion down expected
        down += 3;
      } else if (vwapDistancePct > VWAP_DISTANCE_THRESHOLD) {
        // Price moderately ABOVE VWAP, moderate reversion down expected
        down += 2;
      } else if (vwapDistancePct < -VWAP_STRONG_THRESHOLD) {
        // Price extended significantly BELOW VWAP, strong reversion up expected
        up += 3;
      } else if (vwapDistancePct < -VWAP_DISTANCE_THRESHOLD) {
        // Price moderately BELOW VWAP, moderate reversion up expected
        up += 2;
      }
    }
    
    // Heiken Ashi exhaustion: +1 for potential reversals after extended runs
    // Long runs in ranging markets often precede reversals
    if (heikenColor === "green" && heikenCount >= 4) down += 1;  // Exhausted bulls
    if (heikenColor === "red" && heikenCount >= 4) up += 1;      // Exhausted bears
    
    // MACD divergence/convergence: favor moves toward zero in ranging markets
    // In ranging markets, MACD tends to oscillate around zero
    if (macd?.hist !== null) {
      // Large histogram values suggest reversion toward zero
      const absHist = Math.abs(macd.hist);
      if (absHist > 50) {  // Arbitrary threshold for "large" histogram
        if (macd.hist > 0) down += 1;  // Large positive hist, expect pullback
        if (macd.hist < 0) up += 1;    // Large negative hist, expect bounce
      }
    }
  }

  // Price Momentum: +1 score if 5-minute price change > 0.2%
  // Positive momentum favors UP, negative momentum favors DOWN
  // TREND_FOLLOW: +2 for momentum (double weight)
  // MEAN_REVERT: skip momentum (counter-trend in ranging markets)
  if (!useMeanRevert && priceMomentum5m !== null && priceMomentum5m !== undefined) {
    const MOMENTUM_THRESHOLD = 0.2; // 0.2% threshold
    const momentumBoost = useTrendFollow ? 2 : 1; // Double momentum weight in trend mode
    if (priceMomentum5m > MOMENTUM_THRESHOLD) up += momentumBoost;
    if (priceMomentum5m < -MOMENTUM_THRESHOLD) down += momentumBoost;
  }

  // Volume Confirmation: +2 score to leading direction if volume ratio > 1.5x
  // High volume confirms the current directional bias
  if (volumeRatio !== null && volumeRatio !== undefined) {
    const VOLUME_RATIO_THRESHOLD = 1.5; // 1.5x average volume
    if (volumeRatio > VOLUME_RATIO_THRESHOLD) {
      // Add +2 to whichever direction is currently leading
      if (up > down) {
        up += 2;
      } else if (down > up) {
        down += 2;
      }
      // If tied, volume doesn't break the tie (no action)
    }
  }

  // ============================================================
  // Smart Money Signal (Order Book Imbalance > 0.3)
  // When smart money is detected, add significant boost to that direction
  // +3 for smart money alignment (strong signal from order book)
  // ============================================================
  if (smartMoneySignal === 'UP') {
    up += 3;
  } else if (smartMoneySignal === 'DOWN') {
    down += 3;
  }

  // VWAP Distance Mean Reversion (DEFAULT mode only)
  // +1 score when price is extended from VWAP
  // NOTE: Skip in TREND_FOLLOW mode (let trends run)
  // NOTE: Skip in MEAN_REVERT mode (already handled with stronger boosts above)
  if (!useTrendFollow && !useMeanRevert && vwapDistancePct !== null && vwapDistancePct !== undefined) {
    const VWAP_DISTANCE_THRESHOLD = 0.5; // 0.5% threshold for mean reversion signal
    if (vwapDistancePct > VWAP_DISTANCE_THRESHOLD) {
      // Price is extended ABOVE VWAP, expect reversion DOWN
      down += 1;
    } else if (vwapDistancePct < -VWAP_DISTANCE_THRESHOLD) {
      // Price is extended BELOW VWAP, expect reversion UP
      up += 1;
    }
  }

  const rawUp = up / (up + down);
  
  // Determine strategy used for logging
  let strategyUsed = "DEFAULT";
  if (useTrendFollow) strategyUsed = "TREND_FOLLOW";
  else if (useMeanRevert) strategyUsed = "MEAN_REVERT";
  
  return { 
    upScore: up, 
    downScore: down, 
    rawUp, 
    priceMomentum5m, 
    volumeRatio, 
    vwapDistancePct, 
    strategyUsed,
    smartMoneySignal 
  };
}

export function applyTimeAwareness(rawUp, remainingMinutes, windowMinutes) {
  const timeDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
  const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
  return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}
