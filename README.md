# 🧪 WetaLab

Monorepo de experimentos y proyectos de trading, bots, y herramientas financieras.

## 📁 Proyectos

| Proyecto | Descripción | Estado |
|----------|-------------|--------|
| `polymarket-btc-assistant/` | Bot de señales direccionales BTC 15min para Polymarket | 🚧 En desarrollo |
| `gabagool/` | Bot de arbitraje puro Polymarket (UP+DOWN < $1) | 📋 Pendiente |

---

## 🎯 Polymarket BTC 15m Assistant

Bot que predice dirección de BTC en ventanas de 15 minutos usando:
- **Technical Analysis scoring** (VWAP, RSI, MACD, Heiken Ashi)
- **Time-aware adjustments** (más conservador cuando queda menos tiempo)
- **Edge calculation** (modelo vs precio de mercado)

### Diferencias vs Gabagool

| Aspecto | Gabagool | BTC Assistant |
|---------|----------|---------------|
| Estrategia | Arbitraje puro | Trading direccional |
| Riesgo | ~0 (profit garantizado) | Alto (apuestas a dirección) |
| Acción | Automático | Señales → tú decides |

---

## 🚀 Quick Start

```bash
# Clonar y setup del BTC Assistant
cd polymarket-btc-assistant
cp .env.example .env
# Configurar API keys
npm install
npm run dry-run  # Modo simulación
```

---

## 📋 Roadmap

- [x] Investigación inicial BTC Assistant
- [ ] Implementar bot BTC 15m
- [ ] Dry run esta noche
- [ ] Evaluar resultados y ajustar
- [ ] Integrar Gabagool

---

## ⚠️ Disclaimer

Estos son proyectos experimentales. Trading conlleva riesgos. No usar con dinero que no puedas perder.
