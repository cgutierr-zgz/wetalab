# Copilot Instructions - WetaLab

## 🎯 Workspace Context

This is a monorepo for trading projects and financial bots. Each project lives in its own folder.

## 📁 Structure

```
wetalab/
├── README.md                    # Overview of all projects
├── .github/
│   └── copilot-instructions.md  # This file
├── polymarket-btc-assistant/    # BTC 15min Bot
├── gabagool/                    # Arbitrage bot (future)
└── docs/                        # Shared documentation
```

## 🛠️ How to Work Efficiently

### 1. Before Implementing
- Read the specific project's README.md
- Check if there's a `.env.example` and configure variables
- Verify dependencies in `package.json` or `requirements.txt`

### 2. Code Conventions

**TypeScript/JavaScript:**
- Use TypeScript whenever possible
- ESLint + Prettier configured
- Async/await over callbacks
- Structured logging with levels (debug, info, warn, error)

**Python:**
- Python 3.10+
- Type hints required
- Black + isort for formatting
- Logging with `structlog` or `loguru`

### 3. Trading Bots - Best Practices

```typescript
// ALWAYS include dry-run mode
const DRY_RUN = process.env.DRY_RUN === 'true';

// ALWAYS log decisions
logger.info('Signal detected', { 
  direction: 'UP', 
  edge: 0.15, 
  dryRun: DRY_RUN 
});

// NEVER execute trades without confirmation in production
if (!DRY_RUN) {
  await confirmTrade(signal);
}
```

### 4. Security

- **NEVER** commit API keys or secrets
- Use local `.env` + `.env.example` in repo
- Validate all inputs from external APIs
- Rate limiting on exchange calls

### 5. Testing

- Tests for signal logic
- Mock external APIs
- Backtesting with historical data when possible

## 🚨 Useful Commands

```bash
# Dry run (simulation without real money)
npm run dry-run

# Production (with confirmations)
npm run start

# Tests
npm test

# Real-time logs
npm run logs
```

## 📊 Active Projects

### Polymarket BTC 15m Assistant
- **Stack:** TypeScript, Node.js
- **APIs:** Polymarket, BTC data exchange
- **Indicators:** VWAP, RSI, MACD, Heiken Ashi
- **Documentation:** See `interesting.md` for initial research

## ❓ Frequently Asked Questions

**How to add a new project?**
1. Create folder in root
2. Add entry in main README.md
3. Include its own README.md with setup

**How to run in dry-run mode?**
```bash
DRY_RUN=true npm start
# or
npm run dry-run
```
