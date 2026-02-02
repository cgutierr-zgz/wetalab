"use client";

import { useEffect, useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid
} from "recharts";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatUsd(value) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatPnl(value) {
  if (value === null || value === undefined) return "-";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatUsd(value)}`;
}

function formatPct(value) {
  if (value === null || value === undefined) return "-";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(2)}%`;
}

function formatTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ─────────────────────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0]?.payload;
  if (!data) return null;

  const isWin = data.result === "WIN";
  const isLoss = data.result === "LOSS";

  return (
    <div className="equityTooltip">
      <div className="tooltipTime">{formatDateTime(data.timestamp)}</div>
      <div className="tooltipRow">
        <span className="tooltipLabel">Balance</span>
        <span className="tooltipValue">{formatUsd(data.balance)}</span>
      </div>
      <div className="tooltipRow">
        <span className="tooltipLabel">P&L</span>
        <span className={`tooltipValue ${data.cumulativePnl >= 0 ? "positive" : "negative"}`}>
          {formatPnl(data.cumulativePnl)}
        </span>
      </div>
      {data.tradeId && (
        <>
          <div className="tooltipDivider" />
          <div className="tooltipRow">
            <span className="tooltipLabel">Trade</span>
            <span className={`tooltipResult ${isWin ? "win" : isLoss ? "loss" : ""}`}>
              {data.side} {data.result}
            </span>
          </div>
          {data.pnl !== 0 && (
            <div className="tooltipRow">
              <span className="tooltipLabel">Trade P&L</span>
              <span className={`tooltipValue ${data.pnl >= 0 ? "positive" : "negative"}`}>
                {formatPnl(data.pnl)}
              </span>
            </div>
          )}
          {data.drawdown > 0 && (
            <div className="tooltipRow">
              <span className="tooltipLabel">Drawdown</span>
              <span className="tooltipValue negative">
                {formatPct(-data.drawdown)}
              </span>
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .equityTooltip {
          background: rgba(10,16,28,.95);
          border: 1px solid rgba(27,42,68,.9);
          border-radius: 10px;
          padding: 12px 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,.5);
          font-size: 12px;
          min-width: 160px;
        }
        .tooltipTime {
          color: var(--muted);
          font-size: 11px;
          margin-bottom: 10px;
          letter-spacing: 0.02em;
        }
        .tooltipRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 4px;
        }
        .tooltipLabel {
          color: var(--muted);
        }
        .tooltipValue {
          color: var(--text);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .tooltipValue.positive {
          color: var(--green);
        }
        .tooltipValue.negative {
          color: var(--red);
        }
        .tooltipDivider {
          height: 1px;
          background: rgba(27,42,68,.7);
          margin: 8px 0;
        }
        .tooltipResult {
          font-weight: 600;
          letter-spacing: 0.04em;
        }
        .tooltipResult.win {
          color: var(--green);
        }
        .tooltipResult.loss {
          color: var(--red);
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Summary Stats Component
// ─────────────────────────────────────────────────────────────

function SummaryStats({ summary }) {
  if (!summary) return null;

  const pnlClass = summary.totalPnl >= 0 ? "positive" : "negative";

  return (
    <div className="equitySummary">
      <div className="summaryItem">
        <span className="summaryLabel">Start</span>
        <span className="summaryValue">{formatUsd(summary.startBalance)}</span>
      </div>
      <div className="summaryItem">
        <span className="summaryLabel">Current</span>
        <span className="summaryValue">{formatUsd(summary.endBalance)}</span>
      </div>
      <div className="summaryItem">
        <span className="summaryLabel">Total P&L</span>
        <span className={`summaryValue ${pnlClass}`}>
          {formatPnl(summary.totalPnl)} ({formatPct(summary.totalPnlPct / 100)})
        </span>
      </div>
      <div className="summaryItem">
        <span className="summaryLabel">Peak</span>
        <span className="summaryValue">{formatUsd(summary.peakBalance)}</span>
      </div>
      <div className="summaryItem">
        <span className="summaryLabel">Max DD</span>
        <span className="summaryValue negative">
          {formatPct(-summary.maxDrawdownPct / 100)}
        </span>
      </div>
      <div className="summaryItem">
        <span className="summaryLabel">Win Rate</span>
        <span className="summaryValue">
          {(summary.winRate * 100).toFixed(1)}% ({summary.winningTrades}W/{summary.losingTrades}L)
        </span>
      </div>

      <style jsx>{`
        .equitySummary {
          display: flex;
          flex-wrap: wrap;
          gap: 16px 24px;
          padding: 12px 0;
          border-bottom: 1px solid rgba(27,42,68,.5);
          margin-bottom: 16px;
        }
        .summaryItem {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .summaryLabel {
          color: var(--muted);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .summaryValue {
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }
        .summaryValue.positive {
          color: var(--green);
        }
        .summaryValue.negative {
          color: var(--red);
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Equity Curve Chart Component
// ─────────────────────────────────────────────────────────────

export default function EquityCurveChart({ height = 280 }) {
  const [equityData, setEquityData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch equity data
  useEffect(() => {
    let mounted = true;

    async function fetchEquity() {
      try {
        const res = await fetch("/api/paper/equity?limit=200&interval=trade", {
          cache: "no-store"
        });
        
        if (!res.ok) {
          throw new Error(`Failed to fetch equity data: ${res.status}`);
        }

        const data = await res.json();
        
        if (mounted) {
          if (data.ok === false) {
            setError(data.error || "Failed to load equity data");
          } else {
            setEquityData(data);
            setError(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error("Equity fetch error:", err);
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    fetchEquity();

    // Refresh every 5 seconds (equity changes less frequently than other data)
    const interval = setInterval(fetchEquity, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Process chart data
  const chartData = useMemo(() => {
    if (!equityData?.curve) return [];
    return equityData.curve.map(point => ({
      ...point,
      // Ensure all values are numbers for charting
      balance: Number(point.balance) || 0,
      pnl: Number(point.pnl) || 0,
      cumulativePnl: Number(point.cumulativePnl) || 0,
      drawdown: Number(point.drawdown) || 0
    }));
  }, [equityData]);

  // Calculate chart domain with padding
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 10000];
    
    const balances = chartData.map(d => d.balance);
    const min = Math.min(...balances);
    const max = Math.max(...balances);
    const padding = (max - min) * 0.1 || max * 0.05;
    
    return [
      Math.floor((min - padding) / 100) * 100,
      Math.ceil((max + padding) / 100) * 100
    ];
  }, [chartData]);

  // Get initial balance for reference line
  const initialBalance = equityData?.summary?.startBalance || 10000;

  // Determine gradient colors based on current P&L
  const isPositive = (equityData?.summary?.totalPnl || 0) >= 0;
  const gradientId = "equityGradient";
  const strokeColor = isPositive ? "var(--green)" : "var(--red)";
  const fillColor = isPositive ? "rgba(69,255,178,0.15)" : "rgba(255,92,122,0.15)";

  // Loading state
  if (loading) {
    return (
      <div className="equityLoading" style={{ height }}>
        <div className="equitySpinner" />
        <span>Loading equity curve...</span>

        <style jsx>{`
          .equityLoading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: var(--muted);
            font-size: 13px;
          }
          .equitySpinner {
            width: 24px;
            height: 24px;
            border: 2px solid rgba(27,42,68,.8);
            border-top-color: var(--cyan);
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="equityError" style={{ height }}>
        <span>⚠️ {error}</span>

        <style jsx>{`
          .equityError {
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--muted);
            font-size: 13px;
          }
        `}</style>
      </div>
    );
  }

  // No data state
  if (chartData.length === 0) {
    return (
      <div className="equityEmpty" style={{ height }}>
        <div className="emptyIcon">📊</div>
        <span>No trades yet</span>
        <span className="emptyHint">Equity curve will appear after trades are resolved</span>

        <style jsx>{`
          .equityEmpty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: var(--muted);
            font-size: 14px;
          }
          .emptyIcon {
            font-size: 36px;
            opacity: 0.6;
          }
          .emptyHint {
            font-size: 12px;
            color: var(--faint);
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="equityChart">
      <SummaryStats summary={equityData?.summary} />
      
      <div className="chartContainer" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            {/* Gradient definition */}
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop 
                  offset="0%" 
                  stopColor={isPositive ? "#45ffb2" : "#ff5c7a"} 
                  stopOpacity={0.3} 
                />
                <stop 
                  offset="100%" 
                  stopColor={isPositive ? "#45ffb2" : "#ff5c7a"} 
                  stopOpacity={0.02} 
                />
              </linearGradient>
            </defs>

            {/* Grid */}
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="rgba(27,42,68,.5)" 
              vertical={false}
            />

            {/* Axes */}
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatTime}
              stroke="rgba(112,131,168,.5)"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={{ stroke: "rgba(27,42,68,.5)" }}
              axisLine={{ stroke: "rgba(27,42,68,.7)" }}
              minTickGap={60}
            />
            <YAxis
              domain={yDomain}
              tickFormatter={formatUsd}
              stroke="rgba(112,131,168,.5)"
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={{ stroke: "rgba(27,42,68,.5)" }}
              axisLine={{ stroke: "rgba(27,42,68,.7)" }}
              width={70}
            />

            {/* Reference line at initial balance */}
            <ReferenceLine
              y={initialBalance}
              stroke="rgba(89,215,255,.4)"
              strokeDasharray="4 4"
              label={{
                value: "Start",
                position: "right",
                fill: "var(--muted)",
                fontSize: 10
              }}
            />

            {/* Tooltip */}
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: "rgba(89,215,255,.3)",
                strokeWidth: 1,
                strokeDasharray: "3 3"
              }}
            />

            {/* Area */}
            <Area
              type="monotone"
              dataKey="balance"
              stroke={isPositive ? "#45ffb2" : "#ff5c7a"}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{
                r: 5,
                fill: isPositive ? "#45ffb2" : "#ff5c7a",
                stroke: "rgba(10,16,28,.8)",
                strokeWidth: 2
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <style jsx>{`
        .equityChart {
          width: 100%;
        }
        .chartContainer {
          width: 100%;
        }
      `}</style>
    </div>
  );
}
