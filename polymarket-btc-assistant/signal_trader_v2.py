#!/usr/bin/env python3
"""
BTC 15m Signal Trader v2 - Improved Strategy
- Uses BTC momentum (price change during the period)
- Follows market consensus when confident
- Only goes contrarian at extreme mispricing
- Better timing (last 3-5 minutes only)
"""

import json
import time
import requests
from datetime import datetime, timezone
from pathlib import Path
from collections import deque

# Config
DRY_RUN = True
MAX_CAPITAL = 100.0
TRADE_SIZE = 10.0  # Smaller size, more conservative
MIN_EDGE = 0.15  # 15% edge minimum
MAX_DAILY_LOSS = 25.0
STATE_FILE = Path(__file__).parent / "trader_v2_state.json"
LOG_FILE = Path(__file__).parent / "trades_v2_log.json"

# Price history for momentum calculation
btc_price_history = deque(maxlen=60)  # Last 60 samples (~30 min at 30s intervals)

def load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "capital": MAX_CAPITAL,
        "trades": [],
        "daily_pnl": 0,
        "last_reset": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "total_trades": 0,
        "wins": 0,
        "losses": 0
    }

def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def log_trade(trade):
    trades = []
    if LOG_FILE.exists():
        with open(LOG_FILE) as f:
            trades = json.load(f)
    trades.append(trade)
    with open(LOG_FILE, 'w') as f:
        json.dump(trades, f, indent=2)

def get_btc_price():
    """Get current BTC price from Binance"""
    try:
        resp = requests.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", timeout=5)
        return float(resp.json()['price'])
    except:
        return None

def get_btc_klines(interval='1m', limit=15):
    """Get BTC klines for technical analysis"""
    try:
        resp = requests.get(
            f"https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval={interval}&limit={limit}",
            timeout=5
        )
        return resp.json()
    except:
        return []

def calculate_rsi(prices, period=14):
    """Calculate RSI"""
    if len(prices) < period + 1:
        return 50  # neutral
    
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]
    
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_momentum(prices, period=5):
    """Calculate price momentum (% change over period)"""
    if len(prices) < period:
        return 0
    return (prices[-1] - prices[-period]) / prices[-period] * 100

def compute_btc_15m_slug():
    """Compute the slug for the current BTC 15m market"""
    now = int(datetime.now(timezone.utc).timestamp())
    window_start = (now // 900) * 900
    return f"btc-updown-15m-{window_start}", window_start

def get_current_market():
    """Get current BTC 15m market from gamma API"""
    try:
        slug, window_start = compute_btc_15m_slug()
        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        data = resp.json()
        
        if not data:
            return None
        
        event = data[0]
        markets = event.get('markets', [])
        if not markets:
            return None
        
        market = markets[0]
        
        outcomes = market.get('outcomes', [])
        if isinstance(outcomes, str):
            outcomes = json.loads(outcomes)
        prices = market.get('outcomePrices', [])
        if isinstance(prices, str):
            prices = json.loads(prices)
        
        up_price = down_price = None
        for i, o in enumerate(outcomes):
            if str(o).lower() == 'up':
                up_price = float(prices[i]) if i < len(prices) else None
            elif str(o).lower() == 'down':
                down_price = float(prices[i]) if i < len(prices) else None
        
        end_date = market.get('endDate')
        if end_date:
            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            time_left = (end_dt - datetime.now(timezone.utc)).total_seconds() / 60
        else:
            time_left = 0
        
        return {
            "slug": slug,
            "window_start": window_start,
            "end_time": end_date,
            "time_left_min": time_left,
            "up_price": up_price,
            "down_price": down_price,
            "closed": market.get('closed', False)
        }
    except Exception as e:
        print(f"Error fetching market: {e}")
        return None

def get_market_resolution(slug):
    """Check if a market has resolved"""
    try:
        url = f"https://gamma-api.polymarket.com/events?slug={slug}"
        resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        data = resp.json()
        
        if not data:
            return None
        
        market = data[0].get('markets', [{}])[0]
        closed = market.get('closed', False)
        
        if not closed:
            return {"resolved": False}
        
        outcomes = market.get('outcomes', [])
        if isinstance(outcomes, str):
            outcomes = json.loads(outcomes)
        prices = market.get('outcomePrices', [])
        if isinstance(prices, str):
            prices = json.loads(prices)
        
        winner = None
        for i, o in enumerate(outcomes):
            if i < len(prices) and float(prices[i]) >= 0.99:
                winner = str(o).upper()
                break
        
        if winner:
            return {"resolved": True, "winner": winner}
        return {"resolved": False}
    except:
        return None

def smart_signal(market, btc_price, klines):
    """
    Improved signal generation:
    1. Check BTC momentum during this 15m period
    2. Check RSI for overbought/oversold
    3. Consider market consensus
    4. Only trade in optimal timing window
    """
    if not market or not btc_price:
        return {"direction": None, "reason": "no_data"}
    
    up_price = market.get('up_price')
    down_price = market.get('down_price')
    time_left = market.get('time_left_min', 0)
    
    if not up_price or not down_price:
        return {"direction": None, "reason": "no_prices"}
    
    # TIMING: Only trade between 2-5 minutes before close
    if time_left < 2:
        return {"direction": None, "reason": f"too_late_{time_left:.1f}min"}
    if time_left > 5:
        return {"direction": None, "reason": f"too_early_{time_left:.1f}min"}
    
    # Calculate momentum from klines
    if klines and len(klines) >= 5:
        closes = [float(k[4]) for k in klines]
        momentum_5m = calculate_momentum(closes, 5)
        rsi = calculate_rsi(closes)
    else:
        momentum_5m = 0
        rsi = 50
    
    # Market consensus
    market_up_pct = up_price * 100
    market_down_pct = down_price * 100
    
    # Strategy decision
    signal = {"direction": None, "confidence": 0, "edge": 0}
    reasons = []
    
    # STRATEGY 1: Follow strong momentum
    if abs(momentum_5m) > 0.1:  # >0.1% move in 5 min is significant
        if momentum_5m > 0:
            reasons.append(f"momentum_up_{momentum_5m:.2f}%")
            signal["direction"] = "UP"
            signal["momentum_score"] = min(momentum_5m * 10, 30)  # Cap at 30
        else:
            reasons.append(f"momentum_down_{momentum_5m:.2f}%")
            signal["direction"] = "DOWN"
            signal["momentum_score"] = min(abs(momentum_5m) * 10, 30)
    
    # STRATEGY 2: RSI extremes (contrarian)
    if rsi > 75:
        reasons.append(f"rsi_overbought_{rsi:.0f}")
        if signal["direction"] != "DOWN":
            signal["direction"] = "DOWN"
            signal["rsi_score"] = (rsi - 70) / 30 * 20
    elif rsi < 25:
        reasons.append(f"rsi_oversold_{rsi:.0f}")
        if signal["direction"] != "UP":
            signal["direction"] = "UP"
            signal["rsi_score"] = (30 - rsi) / 30 * 20
    
    # STRATEGY 3: Follow market consensus when very confident
    if market_up_pct > 70 and signal["direction"] != "UP":
        reasons.append(f"market_consensus_up_{market_up_pct:.0f}%")
        signal["direction"] = "UP"
        signal["consensus_score"] = (market_up_pct - 60) / 40 * 25
    elif market_down_pct > 70 and signal["direction"] != "DOWN":
        reasons.append(f"market_consensus_down_{market_down_pct:.0f}%")
        signal["direction"] = "DOWN"
        signal["consensus_score"] = (market_down_pct - 60) / 40 * 25
    
    # STRATEGY 4: Contrarian at EXTREME mispricing (>85%)
    if market_up_pct > 85:
        edge = (market_up_pct - 50) / 100
        if edge > 0.30:  # Only if edge > 30%
            reasons.append(f"contrarian_down_edge_{edge*100:.0f}%")
            signal["direction"] = "DOWN"
            signal["contrarian_score"] = edge * 50
    elif market_down_pct > 85:
        edge = (market_down_pct - 50) / 100
        if edge > 0.30:
            reasons.append(f"contrarian_up_edge_{edge*100:.0f}%")
            signal["direction"] = "UP"
            signal["contrarian_score"] = edge * 50
    
    if not signal["direction"]:
        return {"direction": None, "reason": "no_signal"}
    
    # Calculate total confidence
    total_score = sum([
        signal.get("momentum_score", 0),
        signal.get("rsi_score", 0),
        signal.get("consensus_score", 0),
        signal.get("contrarian_score", 0)
    ])
    
    signal["confidence"] = min(total_score / 100, 0.8)
    signal["edge"] = total_score / 100
    signal["market_price"] = up_price if signal["direction"] == "UP" else down_price
    signal["reason"] = " + ".join(reasons) if reasons else "combined"
    signal["rsi"] = rsi
    signal["momentum"] = momentum_5m
    
    # Only trade if edge meets minimum
    if signal["edge"] < MIN_EDGE:
        return {"direction": None, "reason": f"edge_too_low_{signal['edge']*100:.1f}%"}
    
    return signal

def check_resolved_trades(state):
    """Check pending trades for resolution"""
    for trade in state['trades']:
        if trade.get('status') != 'pending':
            continue
        
        result = get_market_resolution(trade.get('market_slug'))
        if not result or not result.get('resolved'):
            continue
        
        winner = result.get('winner')
        direction = trade.get('direction')
        entry_price = trade.get('entry_price', 0.5)
        size = trade.get('size_usd', TRADE_SIZE)
        
        shares = size / entry_price if entry_price > 0 else 0
        
        if winner == direction:
            pnl = shares * 1.0 - size
            trade['status'] = 'win'
            state['wins'] += 1
        else:
            pnl = -size
            trade['status'] = 'loss'
            state['losses'] += 1
        
        trade['pnl'] = round(pnl, 2)
        trade['winner'] = winner
        trade['resolved_at'] = datetime.now(timezone.utc).isoformat()
        
        state['capital'] += pnl
        state['daily_pnl'] += pnl
        
        emoji = "✅" if trade['status'] == 'win' else "❌"
        print(f"\n{emoji} RESOLVED: {trade['market_slug'][-20:]}")
        print(f"   {direction} @ {entry_price*100:.0f}¢ → {winner} | P&L: ${pnl:+.2f}")
        print(f"   Capital: ${state['capital']:.2f} | W/L: {state['wins']}/{state['losses']}")
        
        log_trade(trade)

def execute_trade(state, market, signal, btc_price):
    """Execute a trade"""
    trade = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "market_slug": market.get('slug'),
        "direction": signal['direction'],
        "entry_price": signal['market_price'],
        "edge": signal['edge'],
        "confidence": signal['confidence'],
        "size_usd": TRADE_SIZE,
        "btc_price": btc_price,
        "time_left_min": market.get('time_left_min'),
        "rsi": signal.get('rsi'),
        "momentum": signal.get('momentum'),
        "reason": signal.get('reason'),
        "status": "pending",
        "dry_run": DRY_RUN
    }
    
    state['trades'].append(trade)
    state['total_trades'] += 1
    
    mode = "🎮 DRY" if DRY_RUN else "🔴 LIVE"
    print(f"\n{mode} TRADE: {signal['direction']} @ {signal['market_price']*100:.0f}¢")
    print(f"   Edge: {signal['edge']*100:.0f}% | RSI: {signal.get('rsi', 0):.0f} | Mom: {signal.get('momentum', 0):.2f}%")
    print(f"   Reason: {signal.get('reason', '?')}")
    
    log_trade(trade)
    save_state(state)

def run_once():
    """Single iteration"""
    state = load_state()
    
    # Reset daily
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.get('last_reset') != today:
        print(f"📅 New day - resetting")
        state['daily_pnl'] = 0
        state['last_reset'] = today
    
    # Check resolutions
    check_resolved_trades(state)
    
    # Stats
    pending = len([t for t in state['trades'] if t.get('status') == 'pending'])
    win_rate = (state['wins'] / (state['wins'] + state['losses']) * 100) if (state['wins'] + state['losses']) > 0 else 0
    total_pnl = state['capital'] - MAX_CAPITAL
    print(f"📈 ${state['capital']:.2f} | P&L: ${total_pnl:+.2f} | W/L: {state['wins']}/{state['losses']} ({win_rate:.0f}%) | Pend: {pending}")
    
    # Daily loss limit
    if state['daily_pnl'] <= -MAX_DAILY_LOSS:
        print(f"🛑 Daily loss limit (${state['daily_pnl']:.2f})")
        save_state(state)
        return
    
    # Get data
    market = get_current_market()
    btc_price = get_btc_price()
    klines = get_btc_klines('1m', 15)
    
    if not market or market.get('closed'):
        save_state(state)
        return
    
    print(f"⏰ {datetime.now(timezone.utc).strftime('%H:%M:%S')} | {market['slug'][-15:]} | {market['time_left_min']:.1f}min")
    print(f"💰 UP: {market['up_price']*100:.0f}¢ | DOWN: {market['down_price']*100:.0f}¢ | BTC: ${btc_price:,.0f}")
    
    # Get signal
    signal = smart_signal(market, btc_price, klines)
    
    if signal.get('direction'):
        # Check if already traded this market
        pending_slugs = [t['market_slug'] for t in state['trades'] if t.get('status') == 'pending']
        if market['slug'] not in pending_slugs:
            execute_trade(state, market, signal, btc_price)
        else:
            print(f"⏸️  Already trading this market")
    else:
        print(f"📡 No signal: {signal.get('reason', '?')}")
    
    save_state(state)

def run_daemon(interval=30):
    """Run continuously"""
    print(f"🤖 BTC Signal Trader v2")
    print(f"   Mode: {'DRY RUN' if DRY_RUN else 'LIVE'}")
    print(f"   Capital: ${MAX_CAPITAL} | Size: ${TRADE_SIZE}")
    print(f"   Min edge: {MIN_EDGE*100:.0f}% | Max daily loss: ${MAX_DAILY_LOSS}")
    print(f"   Strategy: Momentum + RSI + Consensus + Contrarian")
    print()
    
    while True:
        try:
            run_once()
        except Exception as e:
            print(f"❌ Error: {e}")
        time.sleep(interval)

def show_stats():
    """Show stats"""
    state = load_state()
    total_pnl = state['capital'] - MAX_CAPITAL
    win_rate = (state['wins'] / (state['wins'] + state['losses']) * 100) if (state['wins'] + state['losses']) > 0 else 0
    pending = [t for t in state['trades'] if t.get('status') == 'pending']
    
    print(f"\n{'='*50}")
    print(f"📊 BTC Signal Trader v2 - Stats")
    print(f"{'='*50}")
    print(f"💰 Capital: ${state['capital']:.2f}")
    print(f"📈 P&L: ${total_pnl:+.2f}")
    print(f"🎯 W/L: {state['wins']}/{state['losses']} ({win_rate:.1f}%)")
    print(f"⏳ Pending: {len(pending)}")

if __name__ == "__main__":
    import sys
    if "--daemon" in sys.argv:
        run_daemon()
    elif "--stats" in sys.argv:
        show_stats()
    else:
        run_once()
