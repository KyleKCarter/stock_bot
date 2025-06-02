# Opening Range Breakout (ORB) Bot

This project implements an **Opening Range Breakout (ORB) trading bot** using Node.js, Alpaca for trading, NewsAPI for news headlines, and OpenAI for sentiment analysis.

## Features

- **Opening Range Calculation:**  
  Calculates the high and low of the first 15 minutes of the trading day for each symbol.

- **Breakout Detection:**  
  Monitors for price breakouts above or below the opening range.

- **News Sentiment Analysis:**  
  Fetches the latest news headline for each symbol and analyzes sentiment using OpenAI's GPT model.

- **Trade Execution:**  
  Places buy or sell orders based on breakout direction and positive/negative sentiment confirmation.

- **Risk Management:**  
  Automatically manages each trade with configurable stop loss and take profit levels, supporting risk-reward ratios (e.g., 1:2, 1:3).

- **Configurable Parameters:**  
  Order size, stop loss, and risk-reward ratio can be set via environment variables.

## How It Works

1. **Calculate Opening Range:**  
   For each symbol, fetches 1-minute bars from 9:30–9:45 AM and determines the high and low.

2. **Monitor for Breakouts:**  
   After the opening range, checks if the price breaks above the high (potential buy) or below the low (potential sell).

3. **Confirm with Sentiment:**  
   Fetches the latest news headline and uses OpenAI to analyze sentiment. Only trades if sentiment matches the breakout direction.

4. **Place Order:**  
   Executes a market order (buy or sell) via Alpaca.

5. **Manage Exit:**  
   Monitors the position and exits when either the stop loss or take profit is hit, based on the configured risk-reward ratio.

## Environment Variables

Set these in your `.env` file:

```env
ALPACA_API_KEY_ID=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
NEWS_API_KEY=your_newsapi_key
OPENAI_API_KEY=your_openai_key

ORDER_QTY=5
STOP_LOSS=0.01
RISK_REWARD=3