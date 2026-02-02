#!/bin/bash
export PAPER_TRADING_ENABLED=true
export PAPER_INITIAL_BALANCE=100
export PAPER_MAX_POSITION=15
export PAPER_MIN_POSITION=5
cd /home/weta/wetalab/polymarket-btc-assistant
exec node src/index.js
