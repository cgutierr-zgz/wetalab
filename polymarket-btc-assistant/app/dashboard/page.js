"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";

// Dynamic import for BTC Price Chart (uses lightweight-charts which requires client-side only)
const BtcPriceChart = dynamic(() => import("./BtcPriceChart"), {
  ssr: false,
  loading: () => (
    <div className="chartLoading">
      <div className="chartLoadingSpinner" />
      <span>Loading chart...</span>
    </div>
  )
});

// Dynamic import for Equity Curve Chart (uses Recharts which requires client-side only)
const EquityCurveChart = dynamic(() => import("./EquityCurveChart"), {
  ssr: false,
  loading: () => (
    <div className="chartLoading">
      <div className="chartLoadingSpinner" />
      <span>Loading equity curve...</span>
    </div>
  )
});

// Dynamic import for RSI Chart (uses lightweight-charts which requires client-side only)
const RsiChart = dynamic(
  () => import("./IndicatorCharts").then((mod) => mod.RsiChart),
  {
    ssr: false,
    loading: () => (
      <div className="indicatorLoading">
        <div className="chartLoadingSpinner" />
        <span>Loading RSI...</span>
      </div>
    )
  }
);

// Dynamic import for MACD Chart (uses lightweight-charts which requires client-side only)
const MacdChart = dynamic(
  () => import("./IndicatorCharts").then((mod) => mod.MacdChart),
  {
    ssr: false,
    loading: () => (
      <div className="indicatorLoading">
        <div className="chartLoadingSpinner" />
        <span>Loading MACD...</span>
      </div>
    )
  }
);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function fmtUsd(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  return `$${fmtNum(n, digits)}`;
}

function fmtPct(p, digits = 1) {
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return "-";
  return `${(Number(p) * 100).toFixed(digits)}%`;
}

function fmtPnl(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  const prefix = n >= 0 ? "+" : "";
  return `${prefix}${fmtUsd(n, digits)}`;
}

function fmtTimeLeft(mins) {
  if (mins === null || mins === undefined || !Number.isFinite(Number(mins))) return "-";
  const totalSeconds = Math.max(0, Math.floor(Number(mins) * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

// ─────────────────────────────────────────────────────────────
// Stats Card Component
// ─────────────────────────────────────────────────────────────

function StatsCard({ label, value, subValue, variant }) {
  const valueClass = classNames(
    "statsValue",
    variant === "positive" && "positive",
    variant === "negative" && "negative"
  );

  return (
    <div className="statsCard">
      <div className="statsLabel">{label}</div>
      <div className={valueClass}>{value}</div>
      {subValue && <div className="statsSubValue">{subValue}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Toggle Switch Component
// ─────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled, label }) {
  return (
    <label className={classNames("toggleWrap", disabled && "disabled")}>
      <span className="toggleLabel">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={classNames("toggle", checked && "on")}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggleKnob" />
      </button>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// Signal Panel Component
// ─────────────────────────────────────────────────────────────

function SignalPanel({ signal, window, activePosition }) {
  if (!signal && !activePosition) {
    return (
      <div className="signalPanel empty">
        <div className="signalEmpty">
          <span className="signalEmptyIcon">📊</span>
          <span>No active signal or position</span>
        </div>
      </div>
    );
  }

  // Show active position if exists
  if (activePosition) {
    const { side, entryPrice, priceToBeat, positionSize, edge, phase, strength } = activePosition;
    const sideColor = side === "UP" ? "green" : "red";
    
    return (
      <div className={classNames("signalPanel", "hasPosition", sideColor)}>
        <div className="signalHeader">
          <div className="signalBadge position">
            <span className={classNames("dot", sideColor)} />
            ACTIVE POSITION
          </div>
          <div className="signalTimeLeft">
            {window?.remainingMin != null ? fmtTimeLeft(window.remainingMin) : "-"}
          </div>
        </div>
        
        <div className="signalMain">
          <div className="signalSide">{side}</div>
          <div className="signalMeta">
            <span className="signalPhase">{phase}</span>
            <span className="signalStrength">{strength}</span>
          </div>
        </div>

        <div className="signalDetails">
          <div className="signalKv">
            <span className="signalK">Entry Price</span>
            <span className="signalV mono">{fmtUsd(entryPrice, 2)}</span>
          </div>
          <div className="signalKv">
            <span className="signalK">Price to Beat</span>
            <span className="signalV mono">{fmtUsd(priceToBeat, 2)}</span>
          </div>
          <div className="signalKv">
            <span className="signalK">Position Size</span>
            <span className="signalV mono">{fmtUsd(positionSize, 2)}</span>
          </div>
          <div className="signalKv">
            <span className="signalK">Edge</span>
            <span className="signalV">{fmtPct(edge)}</span>
          </div>
        </div>
      </div>
    );
  }

  // Show current signal
  const { side, action, edge, phase, strength, reason, market, currentPrice, priceToBeat, timeLeftMin } = signal;
  const sideColor = side === "UP" ? "green" : side === "DOWN" ? "red" : "";
  const actionBadge = action === "ENTER" ? "enter" : action === "HOLD" ? "hold" : "skip";

  return (
    <div className={classNames("signalPanel", sideColor)}>
      <div className="signalHeader">
        <div className={classNames("signalBadge", actionBadge)}>
          <span className={classNames("dot", sideColor)} />
          {action} {side}
        </div>
        <div className="signalTimeLeft">
          {timeLeftMin != null ? fmtTimeLeft(timeLeftMin) : window?.remainingMin != null ? fmtTimeLeft(window.remainingMin) : "-"}
        </div>
      </div>

      <div className="signalMain">
        <div className="signalEdge">
          <span className="signalEdgeLabel">Edge</span>
          <span className="signalEdgeValue">{fmtPct(edge)}</span>
        </div>
        <div className="signalMeta">
          <span className="signalPhase">{phase || "-"}</span>
          <span className="signalStrength">{strength || "-"}</span>
        </div>
      </div>

      {reason && <div className="signalReason">{reason}</div>}

      <div className="signalDetails">
        <div className="signalKv">
          <span className="signalK">BTC Price</span>
          <span className="signalV mono">{fmtUsd(currentPrice, 2)}</span>
        </div>
        <div className="signalKv">
          <span className="signalK">Price to Beat</span>
          <span className="signalV mono">{fmtUsd(priceToBeat, 2)}</span>
        </div>
        {market && (
          <>
            <div className="signalKv">
              <span className="signalK">UP Price</span>
              <span className="signalV mono">{fmtPct(market.upPrice / 100, 1)}</span>
            </div>
            <div className="signalKv">
              <span className="signalK">DOWN Price</span>
              <span className="signalV mono">{fmtPct(market.downPrice / 100, 1)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Recent Trades Table Component
// ─────────────────────────────────────────────────────────────

function RecentTradesTable({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="tradesEmpty">
        <span>No trades yet</span>
      </div>
    );
  }

  return (
    <div className="tradesTableWrap">
      <table className="tradesTable">
        <thead>
          <tr>
            <th>Time</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>P&L</th>
            <th>Edge</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const resultClass = classNames(
              "tradeResult",
              trade.result === "WIN" && "win",
              trade.result === "LOSS" && "loss",
              trade.result === "PENDING" && "pending"
            );
            const sideClass = trade.side === "UP" ? "up" : "down";
            const pnlClass = trade.pnl > 0 ? "positive" : trade.pnl < 0 ? "negative" : "";
            
            return (
              <tr key={trade.id}>
                <td className="mono">
                  {trade.entryTimestamp 
                    ? new Date(trade.entryTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "-"}
                </td>
                <td className={classNames("tradeSide", sideClass)}>{trade.side}</td>
                <td className="mono">{fmtUsd(trade.entryPrice, 0)}</td>
                <td className="mono">{trade.exitPrice ? fmtUsd(trade.exitPrice, 0) : "-"}</td>
                <td className={classNames("mono", pnlClass)}>{trade.pnl != null ? fmtPnl(trade.pnl, 2) : "-"}</td>
                <td>{fmtPct(trade.edge)}</td>
                <td><span className={resultClass}>{trade.result || "PENDING"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Dashboard Page
// ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [status, setStatus] = useState(null);
  const [trades, setTrades] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [configUpdating, setConfigUpdating] = useState(false);

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, tradesRes, configRes] = await Promise.all([
        fetch("/api/paper/status"),
        fetch("/api/paper/trades?limit=10"),
        fetch("/api/paper/config")
      ]);

      const [statusData, tradesData, configData] = await Promise.all([
        statusRes.json(),
        tradesRes.json(),
        configRes.json()
      ]);

      if (statusData.ok !== false) {
        setStatus(statusData);
      } else if (statusData.error) {
        setError(statusData.error);
      }

      if (tradesData.trades) {
        setTrades(tradesData.trades);
      }

      if (configData.ok) {
        setConfig(configData.config);
      }

      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
      setError("Failed to connect to paper trading engine");
      setLoading(false);
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    fetchData();

    // Poll every 1 second for real-time updates
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Toggle auto-trade
  const handleAutoTradeToggle = async (enabled) => {
    setConfigUpdating(true);
    try {
      const res = await fetch("/api/paper/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoTradeEnabled: enabled })
      });
      const data = await res.json();
      if (data.ok && data.config) {
        setConfig(data.config);
      }
    } catch (err) {
      console.error("Failed to update config:", err);
    }
    setConfigUpdating(false);
  };

  // Calculate trades today
  const tradesToday = trades.filter((t) => {
    if (!t.entryTimestamp) return false;
    const tradeDate = new Date(t.entryTimestamp);
    const today = new Date();
    return (
      tradeDate.getDate() === today.getDate() &&
      tradeDate.getMonth() === today.getMonth() &&
      tradeDate.getFullYear() === today.getFullYear()
    );
  }).length;

  // Loading state
  if (loading) {
    return (
      <div className="container">
        <div className="dashboardLoading">
          <div className="spinner" />
          <span>Loading dashboard...</span>
        </div>
      </div>
    );
  }

  // Error state (paper trading disabled)
  if (error || !status?.enabled) {
    return (
      <div className="container">
        <header className="header">
          <div className="brand">
            <h1 className="h1">Paper Trading Dashboard</h1>
            <p className="sub">BTC 15-Minute Market Simulation</p>
          </div>
        </header>
        <div className="error">
          <strong>⚠️ Paper Trading Disabled</strong>
          <p>{error || "Set PAPER_TRADING_ENABLED=true in .env to enable"}</p>
        </div>
      </div>
    );
  }

  const { portfolio, activePosition, currentSignal, window: windowInfo } = status;

  // Determine P&L variant
  const pnlVariant = portfolio?.totalPnl > 0 ? "positive" : portfolio?.totalPnl < 0 ? "negative" : undefined;

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          <h1 className="h1">Paper Trading Dashboard</h1>
          <p className="sub">BTC 15-Minute Market Simulation</p>
        </div>
        <div className="headerControls">
          <ToggleSwitch
            checked={config?.autoTradeEnabled ?? false}
            onChange={handleAutoTradeToggle}
            disabled={configUpdating}
            label="Auto-Trade"
          />
        </div>
      </header>

      {/* Stats Cards */}
      <section className="statsGrid">
        <StatsCard
          label="Balance"
          value={fmtUsd(portfolio?.balance, 2)}
          subValue={portfolio?.peakBalance ? `Peak: ${fmtUsd(portfolio.peakBalance, 2)}` : undefined}
        />
        <StatsCard
          label="Total P&L"
          value={fmtPnl(portfolio?.totalPnl, 2)}
          variant={pnlVariant}
          subValue={portfolio?.maxDrawdown ? `Max DD: ${fmtPct(portfolio.maxDrawdown)}` : undefined}
        />
        <StatsCard
          label="Win Rate"
          value={fmtPct(portfolio?.winRate)}
          subValue={`${portfolio?.wins ?? 0}W / ${portfolio?.losses ?? 0}L`}
        />
        <StatsCard
          label="Trades Today"
          value={tradesToday}
          subValue={`${status?.tradesCount ?? 0} total`}
        />
      </section>

      {/* BTC Price Chart with VWAP */}
      <section className="dashboardSection chartSection">
        <div className="sectionHeader">
          <h2 className="sectionTitle">BTC Price Chart</h2>
          <span className="sectionMeta">VWAP Overlay</span>
        </div>
        <div className="chartWrapper">
          <BtcPriceChart height={320} />
        </div>
      </section>

      {/* Equity Curve Chart */}
      <section className="dashboardSection chartSection">
        <div className="sectionHeader">
          <h2 className="sectionTitle">Equity Curve</h2>
          <span className="sectionMeta">Portfolio Performance</span>
        </div>
        <div className="chartWrapper">
          <EquityCurveChart height={280} />
        </div>
      </section>

      {/* RSI and MACD Mini-Indicators */}
      <section className="dashboardSection chartSection">
        <div className="sectionHeader">
          <h2 className="sectionTitle">Technical Indicators</h2>
          <span className="sectionMeta">RSI & MACD</span>
        </div>
        <div className="indicatorsWrapper">
          <div className="indicatorPanel">
            <RsiChart height={120} />
          </div>
          <div className="indicatorPanel">
            <MacdChart height={120} />
          </div>
        </div>
      </section>

      {/* Main Grid */}
      <div className="dashboardGrid">
        {/* Current Signal Panel */}
        <section className="dashboardSection">
          <div className="sectionHeader">
            <h2 className="sectionTitle">Current Signal</h2>
            {activePosition && (
              <span className="badge">
                <span className={classNames("dot", activePosition.side === "UP" ? "green" : "red")} />
                Position Active
              </span>
            )}
          </div>
          <SignalPanel
            signal={currentSignal}
            window={windowInfo}
            activePosition={activePosition}
          />
        </section>

        {/* Recent Trades */}
        <section className="dashboardSection">
          <div className="sectionHeader">
            <h2 className="sectionTitle">Recent Trades</h2>
            <span className="sectionMeta">{trades.length} shown</span>
          </div>
          <RecentTradesTable trades={trades} />
        </section>
      </div>

      {/* Footer */}
      <footer className="footer">
        <span>Paper Trading · Simulation Only</span>
        <span className="mono">
          Last updated: {status?.timestamp ? new Date(status.timestamp).toLocaleTimeString() : "-"}
        </span>
      </footer>

      {/* Dashboard Styles */}
      <style jsx>{`
        /* Stats Grid */
        .statsGrid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        @media (max-width: 940px) {
          .statsGrid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 520px) {
          .statsGrid {
            grid-template-columns: 1fr;
          }
        }

        .statsCard {
          background: linear-gradient(180deg, rgba(12,18,32,.72), rgba(12,16,24,.42));
          border: 1px solid rgba(27,42,68,.9);
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,.25);
        }

        .statsLabel {
          color: var(--muted);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .statsValue {
          font-family: var(--font-display);
          font-size: 28px;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
        }

        .statsValue.positive {
          color: var(--green);
        }

        .statsValue.negative {
          color: var(--red);
        }

        .statsSubValue {
          color: var(--faint);
          font-size: 12px;
          margin-top: 6px;
        }

        /* Header Controls */
        .headerControls {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        /* Toggle Switch */
        .toggleWrap {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
        }

        .toggleWrap.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .toggleLabel {
          color: var(--muted);
          font-size: 13px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .toggle {
          position: relative;
          width: 48px;
          height: 26px;
          border-radius: 999px;
          border: 1px solid rgba(27,42,68,.9);
          background: rgba(10,16,28,.7);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .toggle:hover {
          border-color: rgba(89,215,255,.5);
        }

        .toggle.on {
          background: rgba(69,255,178,.15);
          border-color: rgba(69,255,178,.5);
        }

        .toggleKnob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          background: var(--muted);
          transition: all 0.2s ease;
        }

        .toggle.on .toggleKnob {
          left: 25px;
          background: var(--green);
        }

        /* Dashboard Grid */
        .dashboardGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        @media (max-width: 940px) {
          .dashboardGrid {
            grid-template-columns: 1fr;
          }
        }

        /* Sections */
        .dashboardSection {
          background: linear-gradient(180deg, rgba(12,18,32,.72), rgba(12,16,24,.42));
          border: 1px solid rgba(27,42,68,.9);
          border-radius: 18px;
          box-shadow: 0 20px 60px rgba(0,0,0,.25);
          overflow: hidden;
        }

        .sectionHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid rgba(27,42,68,.65);
        }

        .sectionTitle {
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--faint);
          font-weight: 500;
        }

        .sectionMeta {
          font-size: 12px;
          color: var(--muted);
        }

        /* Signal Panel */
        .signalPanel {
          padding: 18px;
        }

        .signalPanel.empty {
          min-height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .signalEmpty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          color: var(--muted);
          font-size: 14px;
        }

        .signalEmptyIcon {
          font-size: 32px;
          opacity: 0.6;
        }

        .signalHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .signalBadge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .signalBadge.enter {
          background: rgba(69,255,178,.12);
          border: 1px solid rgba(69,255,178,.3);
          color: var(--green);
        }

        .signalBadge.hold {
          background: rgba(255,204,102,.1);
          border: 1px solid rgba(255,204,102,.3);
          color: var(--amber);
        }

        .signalBadge.skip {
          background: rgba(112,131,168,.1);
          border: 1px solid rgba(112,131,168,.3);
          color: var(--muted);
        }

        .signalBadge.position {
          background: rgba(89,215,255,.1);
          border: 1px solid rgba(89,215,255,.3);
          color: var(--cyan);
        }

        .signalTimeLeft {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 18px;
          color: var(--text);
          letter-spacing: 0.05em;
        }

        .signalMain {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .signalSide {
          font-family: var(--font-display);
          font-size: 42px;
          letter-spacing: 0.02em;
        }

        .signalPanel.green .signalSide {
          color: var(--green);
        }

        .signalPanel.red .signalSide {
          color: var(--red);
        }

        .signalEdge {
          display: flex;
          flex-direction: column;
        }

        .signalEdgeLabel {
          color: var(--muted);
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .signalEdgeValue {
          font-family: var(--font-display);
          font-size: 36px;
        }

        .signalMeta {
          display: flex;
          gap: 10px;
        }

        .signalPhase,
        .signalStrength {
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          background: rgba(27,42,68,.5);
          color: var(--muted);
        }

        .signalReason {
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(27,42,68,.35);
          color: var(--muted);
          font-size: 13px;
          margin-bottom: 14px;
        }

        .signalDetails {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .signalKv {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 8px 0;
          border-bottom: 1px dashed rgba(27,42,68,.5);
        }

        .signalK {
          color: var(--muted);
          font-size: 12px;
        }

        .signalV {
          font-size: 13px;
        }

        /* Trades Table */
        .tradesTableWrap {
          overflow-x: auto;
        }

        .tradesEmpty {
          padding: 48px 18px;
          text-align: center;
          color: var(--muted);
          font-size: 14px;
        }

        .tradesTable {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .tradesTable th,
        .tradesTable td {
          padding: 12px 14px;
          text-align: left;
          border-bottom: 1px solid rgba(27,42,68,.5);
        }

        .tradesTable th {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          font-weight: 500;
        }

        .tradesTable tbody tr:last-child td {
          border-bottom: none;
        }

        .tradesTable tbody tr:hover {
          background: rgba(27,42,68,.2);
        }

        .tradeSide {
          font-weight: 600;
        }

        .tradeSide.up {
          color: var(--green);
        }

        .tradeSide.down {
          color: var(--red);
        }

        .tradeResult {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
        }

        .tradeResult.win {
          background: rgba(69,255,178,.12);
          color: var(--green);
        }

        .tradeResult.loss {
          background: rgba(255,92,122,.12);
          color: var(--red);
        }

        .tradeResult.pending {
          background: rgba(255,204,102,.1);
          color: var(--amber);
        }

        .positive {
          color: var(--green);
        }

        .negative {
          color: var(--red);
        }

        /* Chart Section */
        .chartSection {
          margin-bottom: 24px;
        }

        .chartWrapper {
          padding: 18px;
        }

        .chartLoading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 320px;
          gap: 12px;
          color: var(--muted);
          font-size: 13px;
        }

        .chartLoadingSpinner {
          width: 24px;
          height: 24px;
          border: 2px solid rgba(27,42,68,.8);
          border-top-color: var(--cyan);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        /* Indicators Section */
        .indicatorsWrapper {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          padding: 18px;
        }

        @media (max-width: 940px) {
          .indicatorsWrapper {
            grid-template-columns: 1fr;
          }
        }

        .indicatorPanel {
          background: rgba(10,16,28,.4);
          border: 1px solid rgba(27,42,68,.6);
          border-radius: 12px;
          padding: 12px 14px;
        }

        .indicatorLoading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 140px;
          gap: 10px;
          color: var(--muted);
          font-size: 12px;
        }

        /* Loading */
        .dashboardLoading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 400px;
          gap: 16px;
          color: var(--muted);
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(27,42,68,.8);
          border-top-color: var(--cyan);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
