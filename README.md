# 🧪 WetaLab

Monorepo for trading experiments, bots, and financial tools.

## 📁 Projects

| Project | Description | Status |
|---------|-------------|--------|
| `polymarket-btc-assistant/` | BTC 15min directional signals bot for Polymarket | 🚧 In development |
| `gabagool/` | Pure Polymarket arbitrage bot (UP+DOWN < $1) | 📋 Pending |

---

## 🎯 Polymarket BTC 15m Assistant

Bot that predicts BTC direction in 15-minute windows using:
- **Technical Analysis scoring** (VWAP, RSI, MACD, Heiken Ashi)
- **Time-aware adjustments** (more conservative when less time remains)
- **Edge calculation** (model vs market price)

### Differences vs Gabagool

| Aspect | Gabagool | BTC Assistant |
|--------|----------|---------------|
| Strategy | Pure arbitrage | Directional trading |
| Risk | ~0 (guaranteed profit) | High (betting on direction) |
| Action | Automatic | Signals → you decide |

---

## 🚀 Quick Start

```bash
# Clone and setup BTC Assistant
cd polymarket-btc-assistant
cp .env.example .env
# Configure API keys
npm install
npm run dry-run  # Simulation mode
```

---

## 📋 Roadmap

- [x] Initial BTC Assistant research
- [ ] Implement BTC 15m bot
- [ ] Dry run tonight
- [ ] Evaluate results and adjust
- [ ] Integrate Gabagool

---

## ⚠️ Disclaimer

These are experimental projects. Trading involves risks. Do not use money you can't afford to lose.
