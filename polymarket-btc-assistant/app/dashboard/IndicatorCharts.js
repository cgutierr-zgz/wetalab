"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createChart, ColorType, LineSeries, HistogramSeries } from "lightweight-charts";
import { seedKlines, connectBinanceWs, normalizeBinanceSymbol } from "../_ws/binance";
import { computeRsi, computeMacd } from "../lib/ta";

// ─────────────────────────────────────────────────────────────
// RSI Mini-Indicator Chart
// ─────────────────────────────────────────────────────────────

export function RsiChart({ height = 120 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const overboughtRef = useRef(null);
  const oversoldRef = useRef(null);
  const wsRef = useRef(null);

  const [candles, setCandles] = useState([]);
  const [wsStatus, setWsStatus] = useState("connecting");

  const symbol = normalizeBinanceSymbol("btc");
  const RSI_PERIOD = 14;
  const OVERBOUGHT = 70;
  const OVERSOLD = 30;

  // Compute RSI series for chart
  const rsiData = useMemo(() => {
    if (!Array.isArray(candles) || candles.length < RSI_PERIOD + 1) return [];
    
    const closes = candles.map(c => c.close);
    const result = [];
    
    // Compute RSI for each point in the series
    for (let i = RSI_PERIOD; i < closes.length; i++) {
      const sliceCloses = closes.slice(0, i + 1);
      const rsi = computeRsi(sliceCloses, RSI_PERIOD);
      if (rsi !== null && Number.isFinite(rsi)) {
        result.push({
          time: Math.floor(candles[i].openTime / 1000),
          value: rsi
        });
      }
    }
    return result;
  }, [candles]);

  // Current RSI value
  const currentRsi = rsiData.length > 0 ? rsiData[rsiData.length - 1].value : null;

  // Initialize chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const styles = getComputedStyle(document.documentElement);
    const cyan = styles.getPropertyValue("--cyan").trim() || "#59d7ff";
    const text = styles.getPropertyValue("--text").trim() || "#e9eef9";
    const border = styles.getPropertyValue("--border").trim() || "#1b2a44";
    const muted = styles.getPropertyValue("--muted").trim() || "#a5b4d0";
    const green = styles.getPropertyValue("--green").trim() || "#45ffb2";
    const red = styles.getPropertyValue("--red").trim() || "#ff5c7a";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
        textColor: text,
        attributionLogo: false
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border }
      },
      rightPriceScale: { 
        borderColor: border,
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: {
        borderColor: border,
        visible: false
      },
      crosshair: {
        horzLine: { color: muted },
        vertLine: { color: muted }
      }
    });

    // RSI line series
    const rsiSeries = chart.addSeries(LineSeries, {
      color: cyan,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: {
        type: "price",
        precision: 1,
        minMove: 0.1
      }
    });

    // Overbought reference line (70)
    const overboughtSeries = chart.addSeries(LineSeries, {
      color: red,
      lineWidth: 1,
      lineStyle: 2, // Dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });

    // Oversold reference line (30)
    const oversoldSeries = chart.addSeries(LineSeries, {
      color: green,
      lineWidth: 1,
      lineStyle: 2, // Dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });

    chartRef.current = chart;
    rsiSeriesRef.current = rsiSeries;
    overboughtRef.current = overboughtSeries;
    oversoldRef.current = oversoldSeries;

    // Handle resize
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: height
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      rsiSeriesRef.current = null;
      overboughtRef.current = null;
      oversoldRef.current = null;
    };
  }, [height]);

  // Seed klines and connect WebSocket
  useEffect(() => {
    let isMounted = true;

    const initData = async () => {
      try {
        const initialCandles = await seedKlines({ symbol, interval: "1m", limit: 240 });
        if (isMounted && Array.isArray(initialCandles)) {
          setCandles(initialCandles);
        }
      } catch (err) {
        console.error("Failed to seed klines for RSI:", err);
      }

      wsRef.current = connectBinanceWs({
        symbol,
        interval: "1m",
        onKline: (kline) => {
          if (!isMounted) return;
          setCandles((prev) => {
            const newCandles = [...prev];
            const idx = newCandles.findIndex((c) => c.openTime === kline.openTime);
            if (idx >= 0) {
              newCandles[idx] = {
                ...newCandles[idx],
                high: Math.max(newCandles[idx].high, kline.high),
                low: Math.min(newCandles[idx].low, kline.low),
                close: kline.close,
                volume: kline.volume
              };
            } else {
              newCandles.push(kline);
              if (newCandles.length > 300) {
                newCandles.shift();
              }
            }
            return newCandles;
          });
        },
        onStatus: ({ status }) => {
          if (!isMounted) return;
          setWsStatus(status);
        }
      });
    };

    initData();

    return () => {
      isMounted = false;
      wsRef.current?.close();
    };
  }, [symbol]);

  // Update chart data when RSI changes
  useEffect(() => {
    if (!rsiSeriesRef.current || !overboughtRef.current || !oversoldRef.current) return;
    
    if (rsiData.length === 0) {
      rsiSeriesRef.current.setData([]);
      overboughtRef.current.setData([]);
      oversoldRef.current.setData([]);
      return;
    }

    rsiSeriesRef.current.setData(rsiData);

    // Create reference lines across the chart
    const firstTime = rsiData[0].time;
    const lastTime = rsiData[rsiData.length - 1].time;
    overboughtRef.current.setData([
      { time: firstTime, value: OVERBOUGHT },
      { time: lastTime, value: OVERBOUGHT }
    ]);
    oversoldRef.current.setData([
      { time: firstTime, value: OVERSOLD },
      { time: lastTime, value: OVERSOLD }
    ]);
  }, [rsiData]);

  // RSI status color
  const rsiColor = currentRsi === null 
    ? "neutral" 
    : currentRsi >= OVERBOUGHT 
      ? "overbought" 
      : currentRsi <= OVERSOLD 
        ? "oversold" 
        : "neutral";

  return (
    <div className="indicatorContainer">
      <div className="indicatorHeader">
        <div className="indicatorInfo">
          <span className="indicatorTitle">RSI (14)</span>
          <span className={`indicatorValue ${rsiColor}`}>
            {currentRsi !== null ? currentRsi.toFixed(1) : "-"}
          </span>
        </div>
        <div className="indicatorLegend">
          <span className="legendZone overbought">70</span>
          <span className="legendZone oversold">30</span>
        </div>
      </div>
      <div className="indicatorArea" ref={containerRef} style={{ height }} />
      
      <style jsx>{`
        .indicatorContainer {
          width: 100%;
        }

        .indicatorHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px 8px;
        }

        .indicatorInfo {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }

        .indicatorTitle {
          font-size: 12px;
          font-weight: 600;
          color: var(--muted);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .indicatorValue {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 16px;
          font-weight: 600;
          color: var(--cyan);
        }

        .indicatorValue.overbought {
          color: var(--red);
        }

        .indicatorValue.oversold {
          color: var(--green);
        }

        .indicatorLegend {
          display: flex;
          gap: 10px;
        }

        .legendZone {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          letter-spacing: 0.02em;
        }

        .legendZone.overbought {
          background: rgba(255,92,122,.12);
          color: var(--red);
        }

        .legendZone.oversold {
          background: rgba(69,255,178,.12);
          color: var(--green);
        }

        .indicatorArea {
          width: 100%;
          border-radius: 6px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MACD Mini-Indicator Chart
// ─────────────────────────────────────────────────────────────

export function MacdChart({ height = 120 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const macdSeriesRef = useRef(null);
  const signalSeriesRef = useRef(null);
  const histSeriesRef = useRef(null);
  const wsRef = useRef(null);

  const [candles, setCandles] = useState([]);
  const [wsStatus, setWsStatus] = useState("connecting");

  const symbol = normalizeBinanceSymbol("btc");
  const FAST = 12;
  const SLOW = 26;
  const SIGNAL = 9;

  // Helper: EMA calculation for series
  function ema(values, period) {
    if (!Array.isArray(values) || values.length < period) return null;
    const k = 2 / (period + 1);
    let prev = values[0];
    for (let i = 1; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
    }
    return prev;
  }

  // Compute MACD series for chart
  const { macdData, signalData, histData, currentMacd, currentSignal, currentHist } = useMemo(() => {
    if (!Array.isArray(candles) || candles.length < SLOW + SIGNAL) {
      return { macdData: [], signalData: [], histData: [], currentMacd: null, currentSignal: null, currentHist: null };
    }

    const closes = candles.map(c => c.close);
    const macdLines = [];
    
    // Compute MACD line for each point
    for (let i = SLOW - 1; i < closes.length; i++) {
      const sliceCloses = closes.slice(0, i + 1);
      const fastEma = ema(sliceCloses, FAST);
      const slowEma = ema(sliceCloses, SLOW);
      if (fastEma !== null && slowEma !== null) {
        macdLines.push({
          time: Math.floor(candles[i].openTime / 1000),
          value: fastEma - slowEma
        });
      }
    }

    if (macdLines.length < SIGNAL) {
      return { macdData: [], signalData: [], histData: [], currentMacd: null, currentSignal: null, currentHist: null };
    }

    // Compute signal line for each point
    const macdArr = [];
    const signalArr = [];
    const histArr = [];

    for (let i = SIGNAL - 1; i < macdLines.length; i++) {
      const macdSlice = macdLines.slice(0, i + 1).map(m => m.value);
      const signalValue = ema(macdSlice, SIGNAL);
      const macdValue = macdLines[i].value;
      const time = macdLines[i].time;
      
      if (signalValue !== null) {
        const hist = macdValue - signalValue;
        macdArr.push({ time, value: macdValue });
        signalArr.push({ time, value: signalValue });
        histArr.push({ 
          time, 
          value: hist,
          color: hist >= 0 ? "rgba(69,255,178,0.7)" : "rgba(255,92,122,0.7)"
        });
      }
    }

    const lastMacd = macdArr.length > 0 ? macdArr[macdArr.length - 1].value : null;
    const lastSignal = signalArr.length > 0 ? signalArr[signalArr.length - 1].value : null;
    const lastHist = histArr.length > 0 ? histArr[histArr.length - 1].value : null;

    return { 
      macdData: macdArr, 
      signalData: signalArr, 
      histData: histArr,
      currentMacd: lastMacd,
      currentSignal: lastSignal,
      currentHist: lastHist
    };
  }, [candles]);

  // Initialize chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const styles = getComputedStyle(document.documentElement);
    const cyan = styles.getPropertyValue("--cyan").trim() || "#59d7ff";
    const amber = styles.getPropertyValue("--amber").trim() || "#ffcc66";
    const text = styles.getPropertyValue("--text").trim() || "#e9eef9";
    const border = styles.getPropertyValue("--border").trim() || "#1b2a44";
    const muted = styles.getPropertyValue("--muted").trim() || "#a5b4d0";

    const chart = createChart(container, {
      width: container.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
        textColor: text,
        attributionLogo: false
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border }
      },
      rightPriceScale: { 
        borderColor: border,
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: {
        borderColor: border,
        visible: false
      },
      crosshair: {
        horzLine: { color: muted },
        vertLine: { color: muted }
      }
    });

    // Histogram series (draw first, behind lines)
    const histSeries = chart.addSeries(HistogramSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01
      }
    });

    // MACD line series
    const macdSeries = chart.addSeries(LineSeries, {
      color: cyan,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01
      }
    });

    // Signal line series
    const signalSeries = chart.addSeries(LineSeries, {
      color: amber,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01
      }
    });

    chartRef.current = chart;
    histSeriesRef.current = histSeries;
    macdSeriesRef.current = macdSeries;
    signalSeriesRef.current = signalSeries;

    // Handle resize
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: height
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      macdSeriesRef.current = null;
      signalSeriesRef.current = null;
      histSeriesRef.current = null;
    };
  }, [height]);

  // Seed klines and connect WebSocket
  useEffect(() => {
    let isMounted = true;

    const initData = async () => {
      try {
        const initialCandles = await seedKlines({ symbol, interval: "1m", limit: 240 });
        if (isMounted && Array.isArray(initialCandles)) {
          setCandles(initialCandles);
        }
      } catch (err) {
        console.error("Failed to seed klines for MACD:", err);
      }

      wsRef.current = connectBinanceWs({
        symbol,
        interval: "1m",
        onKline: (kline) => {
          if (!isMounted) return;
          setCandles((prev) => {
            const newCandles = [...prev];
            const idx = newCandles.findIndex((c) => c.openTime === kline.openTime);
            if (idx >= 0) {
              newCandles[idx] = {
                ...newCandles[idx],
                high: Math.max(newCandles[idx].high, kline.high),
                low: Math.min(newCandles[idx].low, kline.low),
                close: kline.close,
                volume: kline.volume
              };
            } else {
              newCandles.push(kline);
              if (newCandles.length > 300) {
                newCandles.shift();
              }
            }
            return newCandles;
          });
        },
        onStatus: ({ status }) => {
          if (!isMounted) return;
          setWsStatus(status);
        }
      });
    };

    initData();

    return () => {
      isMounted = false;
      wsRef.current?.close();
    };
  }, [symbol]);

  // Update chart data when MACD changes
  useEffect(() => {
    if (!macdSeriesRef.current || !signalSeriesRef.current || !histSeriesRef.current) return;
    
    if (macdData.length === 0) {
      macdSeriesRef.current.setData([]);
      signalSeriesRef.current.setData([]);
      histSeriesRef.current.setData([]);
      return;
    }

    histSeriesRef.current.setData(histData);
    macdSeriesRef.current.setData(macdData);
    signalSeriesRef.current.setData(signalData);
  }, [macdData, signalData, histData]);

  // Histogram direction
  const histDirection = currentHist === null 
    ? "neutral" 
    : currentHist >= 0 
      ? "bullish" 
      : "bearish";

  return (
    <div className="indicatorContainer">
      <div className="indicatorHeader">
        <div className="indicatorInfo">
          <span className="indicatorTitle">MACD (12,26,9)</span>
          <span className={`indicatorValue ${histDirection}`}>
            {currentHist !== null ? (currentHist >= 0 ? "+" : "") + currentHist.toFixed(2) : "-"}
          </span>
        </div>
        <div className="indicatorLegend">
          <span className="legendItem macd">
            <span className="legendDot macdLine" />
            MACD
          </span>
          <span className="legendItem signal">
            <span className="legendDot signalLine" />
            Signal
          </span>
        </div>
      </div>
      <div className="indicatorArea" ref={containerRef} style={{ height }} />
      
      <style jsx>{`
        .indicatorContainer {
          width: 100%;
        }

        .indicatorHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px 8px;
        }

        .indicatorInfo {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }

        .indicatorTitle {
          font-size: 12px;
          font-weight: 600;
          color: var(--muted);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .indicatorValue {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 16px;
          font-weight: 600;
        }

        .indicatorValue.bullish {
          color: var(--green);
        }

        .indicatorValue.bearish {
          color: var(--red);
        }

        .indicatorValue.neutral {
          color: var(--muted);
        }

        .indicatorLegend {
          display: flex;
          gap: 12px;
        }

        .legendItem {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .legendDot {
          width: 8px;
          height: 3px;
          border-radius: 2px;
        }

        .legendDot.macdLine {
          background: var(--cyan);
        }

        .legendDot.signalLine {
          background: var(--amber);
        }

        .indicatorArea {
          width: 100%;
          border-radius: 6px;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
