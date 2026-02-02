#!/usr/bin/env python3
"""
BTC 15m Signal Trader - Dry Run Mode
Reads signals from the assistant logic and simulates trades
"""

import json
import time
import requests
from datetime import datetime, timezone
from pathlib import Path

# Config
DRY_RUN = True
MAX_CAPITAL = 100.0
TRADE_SIZE = 12.0
MIN_EDGE = 0.12  # 12% edge minimum
MAX_DAILY_LOSS = 20.0
LOG_FILE = Path(__file__).parent / "trades_log.json"
STATE_FILE = Path(__file__).parent / "trader_state.json"

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

def compute_btc_15m_slug():
    """Compute the slug for the current BTC 15m market"""
    now = int(datetime.now(timezone.utc).timestamp())
    # Round to 15 minute boundaries
    window_start = (now // 900) * 900
    return f"btc-updown-15m-{window_start}"

def get_current_market():
    """Get current BTC 15m market from Polymarket"""
    import re
    import httpx
    
    try:
        slug = compute_btc_15m_slug()
        url = f"https://polymarket.com/event/{slug}"
        
        resp = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10, follow_redirects=True)
        
        # Extract __NEXT_DATA__ JSON payload
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if not m:
            return None
            
        payload = json.loads(m.group(1))
        queries = payload.get("props", {}).get("pageProps", {}).get("dehydratedState", {}).get("queries", [])
        
        market = None
        for q in queries:
            data = q.get("state", {}).get("data")
            if isinstance(data, dict) and "markets" in data:
                for mk in data["markets"]:
                    if mk.get("slug") == slug:
                        market = mk
                        break
            if market:
                break
        
        if not market:
            # Try next window
            next_window = int(datetime.now(timezone.utc).timestamp() // 900 + 1) * 900
            slug = f"btc-updown-15m-{next_window}"
            return get_market_by_slug(slug)
        
        # Parse outcomes and prices
        outcomes = market.get('outcomes', [])
        if isinstance(outcomes, str):
            outcomes = json.loads(outcomes)
        
        prices = market.get('outcomePrices', [])
        if isinstance(prices, str):
            prices = json.loads(prices)
        
        up_price = None
        down_price = None
        for i, outcome in enumerate(outcomes):
            if str(outcome).lower() == 'up':
                up_price = float(prices[i]) if i < len(prices) else None
            elif str(outcome).lower() == 'down':
                down_price = float(prices[i]) if i < len(prices) else None
        
        end_date = market.get('endDate')
        if end_date:
            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            time_left = (end_dt - datetime.now(timezone.utc)).total_seconds() / 60
        else:
            time_left = 0
        
        return {
            "slug": slug,
            "question": market.get('question', ''),
            "end_time": end_date,
            "time_left_min": time_left,
            "up_price": up_price,
            "down_price": down_price,
            "condition_id": market.get('conditionId')
        }
        
    except Exception as e:
        print(f"Error fetching market: {e}")
        return None

def get_market_by_slug(slug):
    """Get market by specific slug"""
    import re
    import httpx
    try:
        url = f"https://polymarket.com/event/{slug}"
        resp = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10, follow_redirects=True)
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if not m:
            return None
        payload = json.loads(m.group(1))
        queries = payload.get("props", {}).get("pageProps", {}).get("dehydratedState", {}).get("queries", [])
        
        for q in queries:
            data = q.get("state", {}).get("data")
            if isinstance(data, dict) and "markets" in data:
                for mk in data["markets"]:
                    if mk.get("slug") == slug:
                        outcomes = mk.get('outcomes', [])
                        if isinstance(outcomes, str):
                            outcomes = json.loads(outcomes)
                        prices = mk.get('outcomePrices', [])
                        if isinstance(prices, str):
                            prices = json.loads(prices)
                        
                        up_price = down_price = None
                        for i, o in enumerate(outcomes):
                            if str(o).lower() == 'up':
                                up_price = float(prices[i]) if i < len(prices) else None
                            elif str(o).lower() == 'down':
                                down_price = float(prices[i]) if i < len(prices) else None
                        
                        end_date = mk.get('endDate')
                        time_left = 0
                        if end_date:
                            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                            time_left = (end_dt - datetime.now(timezone.utc)).total_seconds() / 60
                        
                        return {
                            "slug": slug, "question": mk.get('question', ''),
                            "end_time": end_date, "time_left_min": time_left,
                            "up_price": up_price, "down_price": down_price,
                            "condition_id": mk.get('conditionId')
                        }
        return None
    except:
        return None

def get_btc_price():
    """Get current BTC price from Binance"""
    try:
        resp = requests.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", timeout=5)
        return float(resp.json()['price'])
    except:
        return None

def simple_ta_signal(market, btc_price):
    """
    Simple TA-based signal generation
    Returns: {"direction": "UP"|"DOWN"|None, "confidence": 0-1, "edge": float}
    """
    if not market or not btc_price:
        return {"direction": None, "confidence": 0, "edge": 0, "reason": "no_data"}
    
    up_price = market.get('up_price')
    down_price = market.get('down_price')
    time_left = market.get('time_left_min', 0)
    
    if not up_price or not down_price:
        return {"direction": None, "confidence": 0, "edge": 0, "reason": "no_prices"}
    
    # Don't trade in last 2 minutes (too risky) or first 2 minutes (prices unstable)
    if time_left < 2 or time_left > 13:
        return {"direction": None, "confidence": 0, "edge": 0, "reason": f"bad_timing_{time_left:.1f}min"}
    
    # Normalize prices
    total = up_price + down_price
    market_up = up_price / total if total > 0 else 0.5
    market_down = down_price / total if total > 0 else 0.5
    
    # Simple model: assume 50/50 base, look for mispricing
    # If UP is cheap (< 0.45) and DOWN is expensive (> 0.55), buy UP
    # Vice versa for DOWN
    
    model_up = 0.5  # Base assumption
    model_down = 0.5
    
    # Adjust based on momentum (would need price history for real TA)
    # For now, just look for obvious mispricing
    
    edge_up = model_up - market_up
    edge_down = model_down - market_down
    
    # Time decay - less confident as time runs out
    time_factor = min(1.0, time_left / 10)
    
    if edge_up > MIN_EDGE and edge_up > edge_down:
        return {
            "direction": "UP",
            "confidence": min(0.65, 0.5 + edge_up) * time_factor,
            "edge": edge_up,
            "market_price": market_up,
            "reason": f"UP underpriced by {edge_up*100:.1f}%"
        }
    elif edge_down > MIN_EDGE and edge_down > edge_up:
        return {
            "direction": "DOWN",
            "confidence": min(0.65, 0.5 + edge_down) * time_factor,
            "edge": edge_down,
            "market_price": market_down,
            "reason": f"DOWN underpriced by {edge_down*100:.1f}%"
        }
    
    return {
        "direction": None,
        "confidence": 0,
        "edge": max(edge_up, edge_down),
        "reason": f"no_edge (UP:{edge_up*100:.1f}%, DOWN:{edge_down*100:.1f}%)"
    }

def simulate_trade(state, market, signal, btc_price):
    """Simulate a trade (dry run)"""
    trade = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "market_slug": market.get('slug'),
        "direction": signal['direction'],
        "entry_price": signal['market_price'],
        "edge": signal['edge'],
        "confidence": signal['confidence'],
        "size_usd": TRADE_SIZE,
        "btc_price_at_entry": btc_price,
        "time_left_min": market.get('time_left_min'),
        "status": "pending",
        "dry_run": DRY_RUN
    }
    
    state['trades'].append(trade)
    state['total_trades'] += 1
    
    print(f"\n{'🎮 [DRY RUN]' if DRY_RUN else '🔴 [LIVE]'} NEW TRADE")
    print(f"  Direction: {signal['direction']}")
    print(f"  Entry price: {signal['market_price']*100:.1f}¢")
    print(f"  Edge: {signal['edge']*100:.1f}%")
    print(f"  Size: ${TRADE_SIZE}")
    print(f"  Time left: {market.get('time_left_min', 0):.1f}min")
    print(f"  Reason: {signal['reason']}")
    
    log_trade(trade)
    return trade

def get_market_resolution(slug):
    """Check if a market has resolved and get the outcome"""
    import re
    import httpx
    try:
        url = f"https://polymarket.com/event/{slug}"
        resp = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10, follow_redirects=True)
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if not m:
            return None
        payload = json.loads(m.group(1))
        queries = payload.get("props", {}).get("pageProps", {}).get("dehydratedState", {}).get("queries", [])
        
        for q in queries:
            data = q.get("state", {}).get("data")
            if isinstance(data, dict) and "markets" in data:
                for mk in data["markets"]:
                    if mk.get("slug") == slug:
                        # Check if resolved
                        resolved = mk.get("resolved", False)
                        if not resolved:
                            return {"resolved": False}
                        
                        # Get winning outcome
                        outcomes = mk.get('outcomes', [])
                        if isinstance(outcomes, str):
                            outcomes = json.loads(outcomes)
                        prices = mk.get('outcomePrices', [])
                        if isinstance(prices, str):
                            prices = json.loads(prices)
                        
                        # Winner has price = 1.0
                        winner = None
                        for i, o in enumerate(outcomes):
                            if i < len(prices) and float(prices[i]) >= 0.99:
                                winner = str(o).upper()
                                break
                        
                        return {"resolved": True, "winner": winner}
        return None
    except Exception as e:
        print(f"Error checking resolution: {e}")
        return None

def check_resolved_trades(state):
    """Check if any pending trades have resolved and calculate P&L"""
    updated = False
    for trade in state['trades']:
        if trade.get('status') == 'pending':
            slug = trade.get('market_slug')
            if not slug:
                continue
            
            result = get_market_resolution(slug)
            if not result:
                continue
            
            if not result.get('resolved'):
                continue
            
            # Market resolved! Calculate P&L
            winner = result.get('winner')
            direction = trade.get('direction')
            entry_price = trade.get('entry_price', 0.5)
            size = trade.get('size_usd', TRADE_SIZE)
            
            # Shares bought = size / entry_price
            shares = size / entry_price if entry_price > 0 else 0
            
            if winner == direction:
                # WIN: shares pay out at $1 each
                payout = shares * 1.0
                pnl = payout - size
                trade['status'] = 'win'
                state['wins'] += 1
            else:
                # LOSS: shares worth $0
                pnl = -size
                trade['status'] = 'loss'
                state['losses'] += 1
            
            trade['pnl'] = round(pnl, 2)
            trade['winner'] = winner
            trade['resolved_at'] = datetime.now(timezone.utc).isoformat()
            
            state['capital'] += pnl
            state['daily_pnl'] += pnl
            
            win_emoji = "✅" if trade['status'] == 'win' else "❌"
            print(f"\n{win_emoji} TRADE RESOLVED: {slug}")
            print(f"   Direction: {direction} | Winner: {winner}")
            print(f"   Entry: {entry_price*100:.1f}¢ | Size: ${size:.2f}")
            print(f"   P&L: ${pnl:+.2f}")
            print(f"   Capital: ${state['capital']:.2f} | W/L: {state['wins']}/{state['losses']}")
            
            updated = True
            log_trade(trade)
    
    return updated

def run_once():
    """Single iteration of the trading loop"""
    state = load_state()
    
    # Reset daily P&L if new day
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.get('last_reset') != today:
        print(f"📅 New day - resetting daily P&L")
        state['daily_pnl'] = 0
        state['last_reset'] = today
    
    # Check for resolved trades FIRST
    check_resolved_trades(state)
    
    # Print stats every iteration
    pending = len([t for t in state['trades'] if t.get('status') == 'pending'])
    if state['total_trades'] > 0 or pending > 0:
        win_rate = (state['wins'] / (state['wins'] + state['losses']) * 100) if (state['wins'] + state['losses']) > 0 else 0
        total_pnl = state['capital'] - MAX_CAPITAL
        print(f"📈 Stats: ${state['capital']:.2f} | P&L: ${total_pnl:+.2f} | W/L: {state['wins']}/{state['losses']} ({win_rate:.0f}%) | Pending: {pending}")
    
    # Check daily loss limit
    if state['daily_pnl'] <= -MAX_DAILY_LOSS:
        print(f"🛑 Daily loss limit reached (${state['daily_pnl']:.2f})")
        save_state(state)
        return
    
    # Get market data
    market = get_current_market()
    btc_price = get_btc_price()
    
    if not market:
        print(f"⏳ No active market found")
        save_state(state)
        return
    
    print(f"\n{'='*50}")
    print(f"⏰ {datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC")
    print(f"📊 Market: {market.get('slug', 'unknown')}")
    print(f"⏱️  Time left: {market.get('time_left_min', 0):.1f} min")
    print(f"💰 UP: {market.get('up_price', 0)*100:.1f}¢ | DOWN: {market.get('down_price', 0)*100:.1f}¢")
    print(f"₿ BTC: ${btc_price:,.2f}" if btc_price else "₿ BTC: unavailable")
    
    # Get signal
    signal = simple_ta_signal(market, btc_price)
    print(f"📡 Signal: {signal.get('direction') or 'NONE'} | Edge: {signal.get('edge', 0)*100:.1f}% | {signal.get('reason', '')}")
    
    # Check if we should trade
    if signal['direction'] and signal['edge'] >= MIN_EDGE:
        # Check if we already have a pending trade for this market
        pending = [t for t in state['trades'] if t.get('status') == 'pending' and t.get('market_slug') == market.get('slug')]
        if not pending:
            simulate_trade(state, market, signal, btc_price)
        else:
            print(f"⏸️  Already have pending trade for this market")
    
    save_state(state)

def run_daemon(interval_seconds=30):
    """Run continuously"""
    print(f"🤖 BTC 15m Signal Trader Started")
    print(f"   Mode: {'DRY RUN' if DRY_RUN else 'LIVE'}")
    print(f"   Capital: ${MAX_CAPITAL}")
    print(f"   Trade size: ${TRADE_SIZE}")
    print(f"   Min edge: {MIN_EDGE*100:.0f}%")
    print(f"   Max daily loss: ${MAX_DAILY_LOSS}")
    print(f"   Interval: {interval_seconds}s")
    print()
    
    while True:
        try:
            run_once()
        except Exception as e:
            print(f"❌ Error: {e}")
        time.sleep(interval_seconds)

def show_stats():
    """Show current trading stats"""
    state = load_state()
    total_pnl = state['capital'] - MAX_CAPITAL
    win_rate = (state['wins'] / (state['wins'] + state['losses']) * 100) if (state['wins'] + state['losses']) > 0 else 0
    pending = [t for t in state['trades'] if t.get('status') == 'pending']
    resolved = [t for t in state['trades'] if t.get('status') in ('win', 'loss')]
    
    print(f"\n{'='*50}")
    print(f"📊 BTC 15m Signal Trader - Stats")
    print(f"{'='*50}")
    print(f"💰 Capital: ${state['capital']:.2f} (started: ${MAX_CAPITAL:.2f})")
    print(f"📈 Total P&L: ${total_pnl:+.2f}")
    print(f"📅 Daily P&L: ${state['daily_pnl']:+.2f}")
    print(f"🎯 Win/Loss: {state['wins']}/{state['losses']} ({win_rate:.1f}%)")
    print(f"📝 Total trades: {state['total_trades']}")
    print(f"⏳ Pending: {len(pending)}")
    print()
    
    if resolved:
        print(f"Recent resolved trades:")
        for t in resolved[-10:]:
            emoji = "✅" if t['status'] == 'win' else "❌"
            print(f"  {emoji} {t.get('market_slug', '?')[-20:]} | {t['direction']} @ {t['entry_price']*100:.0f}¢ | ${t.get('pnl', 0):+.2f}")
    
    if pending:
        print(f"\nPending trades:")
        for t in pending[-5:]:
            print(f"  ⏳ {t.get('market_slug', '?')[-20:]} | {t['direction']} @ {t['entry_price']*100:.0f}¢ | ${t['size_usd']:.0f}")

if __name__ == "__main__":
    import sys
    if "--daemon" in sys.argv:
        run_daemon()
    elif "--stats" in sys.argv:
        show_stats()
    else:
        run_once()
