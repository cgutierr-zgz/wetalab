"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { createChart, ColorType, CandlestickSeries, LineSeries } from "lightweight-charts";
import { seedKlines, connectBinanceWs, normalizeBinanceSymbol } from "../_ws/binance";
import { computeVwapSeries } from "../lib/ta";

// ─────────────────────────────────────────────────────────────
// BTC Price Chart with VWAP Overlay
// ─────────────────────────────────────────────────────────────

function fmtUsd(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return `$${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

export default function BtcPriceChart({ height = 320 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const vwapSeriesRef = useRef(null);
  const wsRef = useRef(null);
  const lastLenRef = useRef(0);

  const [candles, setCandles] = useState([]);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [lastPrice, setLastPrice] = useState(null);

  const symbol = normalizeBinanceSymbol("btc");

  // Prepare candlestick data for chart
  const candleData = useMemo(() => {
    if (!Array.isArray(candles) || candles.length === 0) return [];
    return candles
      .slice(-240)
      .filter((c) => [c.open, c.high, c.low, c.close].every((v) => typeof v === "number" && Number.isFinite(v)))
      .map((c) => ({
        time: Math.floor(c.openTime / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
  }, [candles]);

  // Compute VWAP series for chart
  const vwapData = useMemo(() => {
    if (!Array.isArray(candles) || candles.length === 0) return [];
    const vwapValues = computeVwapSeries(candles.slice(-240));
    return candles.slice(-240).map((c, i) => ({
      time: Math.floor(c.openTime / 1000),
      value: vwapValues[i]
    })).filter((d) => d.value !== null && Number.isFinite(d.value));
  }, [candles]);

  // Initialize chart
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const styles = getComputedStyle(document.documentElement);
    const green = styles.getPropertyValue("--green").trim() || "#45ffb2";
    const red = styles.getPropertyValue("--red").trim() || "#ff5c7a";
    const text = styles.getPropertyValue("--text").trim() || "#e9eef9";
    const border = styles.getPropertyValue("--border").trim() || "#1b2a44";
    const muted = styles.getPropertyValue("--muted").trim() || "#a5b4d0";
    const cyan = styles.getPropertyValue("--cyan").trim() || "#59d7ff";

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
      rightPriceScale: { borderColor: border },
      timeScale: {
        borderColor: border,
        rightOffset: 2,
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        horzLine: { color: muted },
        vertLine: { color: muted }
      }
    });

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: green,
      downColor: red,
      wickUpColor: muted,
      wickDownColor: muted,
      borderVisible: true,
      borderUpColor: green,
      borderDownColor: red,
      wickVisible: true,
      priceLineVisible: false,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01
      }
    });

    // VWAP line series
    const vwapSeries = chart.addSeries(LineSeries, {
      color: cyan,
      lineWidth: 2,
      lineStyle: 0, // Solid
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    vwapSeriesRef.current = vwapSeries;

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
      candleSeriesRef.current = null;
      vwapSeriesRef.current = null;
    };
  }, [height]);

  // Seed klines and connect WebSocket
  useEffect(() => {
    let isMounted = true;

    const initData = async () => {
      try {
        // Seed initial klines from REST API
        const initialCandles = await seedKlines({ symbol, interval: "1m", limit: 240 });
        if (isMounted && Array.isArray(initialCandles)) {
          setCandles(initialCandles);
          if (initialCandles.length > 0) {
            setLastPrice(initialCandles[initialCandles.length - 1].close);
          }
        }
      } catch (err) {
        console.error("Failed to seed klines:", err);
      }

      // Connect WebSocket for live updates
      wsRef.current = connectBinanceWs({
        symbol,
        interval: "1m",
        onKline: (kline) => {
          if (!isMounted) return;
          setCandles((prev) => {
            const newCandles = [...prev];
            const idx = newCandles.findIndex((c) => c.openTime === kline.openTime);
            if (idx >= 0) {
              // Update existing candle
              newCandles[idx] = {
                ...newCandles[idx],
                high: Math.max(newCandles[idx].high, kline.high),
                low: Math.min(newCandles[idx].low, kline.low),
                close: kline.close,
                volume: kline.volume
              };
            } else {
              // Add new candle
              newCandles.push(kline);
              // Keep last 300 candles max
              if (newCandles.length > 300) {
                newCandles.shift();
              }
            }
            return newCandles;
          });
          setLastPrice(kline.close);
        },
        onTrade: (trade) => {
          if (!isMounted) return;
          setLastPrice(trade.price);
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

  // Update chart data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !vwapSeriesRef.current) return;
    
    if (candleData.length === 0) {
      candleSeriesRef.current.setData([]);
      vwapSeriesRef.current.setData([]);
      lastLenRef.current = 0;
      return;
    }

    candleSeriesRef.current.setData(candleData);
    vwapSeriesRef.current.setData(vwapData);

    // Auto-scroll to show last 60 candles on first load
    if (lastLenRef.current === 0 && candleData.length > 0) {
      const targetBars = 60;
      const lastIndex = candleData.length - 1;
      const from = Math.max(0, lastIndex - targetBars + 1);
      chartRef.current?.timeScale().setVisibleLogicalRange({ from, to: lastIndex });
    }
    lastLenRef.current = candleData.length;
  }, [candleData, vwapData]);

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const statusColor = wsStatus === "open" ? "green" : wsStatus === "connecting" ? "amber" : "red";

  return (
    <div className="chartContainer">
      <div className="chartHeader">
        <div className="chartHeaderLeft">
          <span className="chartTitle">BTC/USDT · 1m</span>
          <span className={`wsStatus ${statusColor}`}>
            <span className="statusDot" />
            {wsStatus === "open" ? "Live" : wsStatus === "connecting" ? "Connecting..." : "Reconnecting..."}
          </span>
        </div>
        <div className="chartHeaderRight">
          <span className="chartPrice mono">{fmtUsd(lastPrice, 2)}</span>
          {lastCandle && (
            <span className="chartOhlc mono">
              O {fmtUsd(lastCandle.open, 0)} · H {fmtUsd(lastCandle.high, 0)} · L {fmtUsd(lastCandle.low, 0)}
            </span>
          )}
        </div>
      </div>
      <div className="chartLegend">
        <span className="legendItem">
          <span className="legendColor candle" />
          Price
        </span>
        <span className="legendItem">
          <span className="legendColor vwap" />
          VWAP
        </span>
      </div>
      <div className="chartArea" ref={containerRef} style={{ height }} />
      
      <style jsx>{`
        .chartContainer {
          width: 100%;
        }

        .chartHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px 12px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .chartHeaderLeft {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .chartHeaderRight {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .chartTitle {
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
          letter-spacing: 0.02em;
        }

        .wsStatus {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .wsStatus.green {
          color: var(--green);
        }

        .wsStatus.amber {
          color: var(--amber);
        }

        .wsStatus.red {
          color: var(--red);
        }

        .statusDot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .chartPrice {
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
        }

        .chartOhlc {
          font-size: 11px;
          color: var(--muted);
        }

        .chartLegend {
          display: flex;
          gap: 16px;
          padding: 0 4px 8px;
        }

        .legendItem {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .legendColor {
          width: 12px;
          height: 3px;
          border-radius: 2px;
        }

        .legendColor.candle {
          background: linear-gradient(90deg, var(--green), var(--red));
        }

        .legendColor.vwap {
          background: var(--cyan);
        }

        .chartArea {
          width: 100%;
          border-radius: 8px;
          overflow: hidden;
        }

        .mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }

        @media (max-width: 600px) {
          .chartHeader {
            flex-direction: column;
            align-items: flex-start;
          }

          .chartOhlc {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
