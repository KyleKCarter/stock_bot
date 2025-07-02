#!/bin/bash

# ORB Bot Startup Script for Paper Trading
# Run this script to start the ORB bot for live paper trading

echo "🎯 Starting ORB Bot for Paper Trading"
echo "===================================="

# 1. Pre-flight validation
echo "🔍 Running pre-flight validation..."
node validate-bot.js

echo ""
read -p "✅ Validation complete. Start ORB bot? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Starting ORB Bot Worker..."
    echo "📊 Monitoring symbols: SPY, QQQ, TSLA, NVDA, AMD"
    echo "⏰ ORB Period: 9:30-9:45 AM ET (15 minutes)"
    echo "📈 Position Sizing: 3-5% per position (day trader standards)"
    echo "🛡️  Max Daily Loss: $500"
    echo "📝 Logs: trade_events.log"
    echo ""
    echo "🔴 Press Ctrl+C to stop the bot"
    echo ""
    
    # Start the worker
    node orbWorkerAlpaca.js
else
    echo "❌ Bot startup cancelled"
    echo "💡 Run 'node validate-bot.js' to check configuration"
fi
