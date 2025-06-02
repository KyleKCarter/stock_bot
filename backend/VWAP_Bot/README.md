# VWAP Bot

This project implements a **VWAP (Volume Weighted Average Price) trading bot** using Node.js, Alpaca for trading, NewsAPI for news headlines, and OpenAI for sentiment analysis.

---

## Features

- **VWAP Pullback & Reversal Strategy:**  
  Trades both bullish pullbacks (long) and bearish reversals (short) near the VWAP.

- **News Sentiment Analysis:**  
  Fetches the latest news headline for each symbol and analyzes sentiment using OpenAI's GPT model.

- **Trade Execution:**  
  Places buy or sell (short) orders based on price action and sentiment confirmation.

- **Position Management:**  
  Prevents stacking positions by checking for existing open positions before trading.

- **Order Fill Accuracy:**  
  Polls for the actual entry price (`avg_entry_price`) after order placement to ensure accurate stop loss and take profit calculations.

- **Risk Management:**  
  Automatically manages each trade with configurable stop loss and take profit levels, supporting risk-reward ratios (e.g., 1:3).

- **End-of-Day (EOD) Closing:**  
  Automatically closes all open positions before market close to avoid overnight risk.

- **Rate Limiting:**  
  Adds a delay between processing each symbol to avoid hitting API rate limits.

- **Robust Logging:**  
  Logs all trade actions, skipped trades (with reasons), and errors for transparency and debugging.

- **Configurable Parameters:**  
  Stop loss and risk-reward ratio can be set via environment variables.

---

## How It Works

1. **Fetch Recent Bars:**  
   For each symbol, fetches the last 15 one-minute bars.

2. **Calculate VWAP:**  
   Computes the VWAP from these bars.

3. **Check for Pullback or Reversal:**  
   - **Bullish Pullback:** If price is near VWAP, the candle is bullish, market trend is bullish, and (optionally) sentiment is positive, the bot buys.
   - **Bearish Reversal:** If price is near VWAP, the candle is bearish, market trend is bearish, and (optionally) sentiment is negative, the bot sells (shorts).
   - **Skipped Trades:** If any condition is not met (e.g., already in position, not near VWAP, wrong sentiment, etc.), the bot logs the reason for skipping.

4. **Order Execution:**  
   Places a market order and waits for the order to fill, then fetches the actual entry price from Alpaca.

5. **Exit Management:**  
   Monitors the position and exits when either the stop loss or take profit is hit, based on the configured risk-reward ratio.

6. **End-of-Day Closing:**  
   All open positions are closed automatically a few minutes before market close (e.g., 3:58 PM ET).

7. **Logging:**  
   All trades, exits, and skipped trades (with reasons) are logged with timestamps.

---

## Environment Variables

Set these in your `.env` file:

```env
ALPACA_API_KEY_ID=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
ALPACA_API_BASE_URL=https://paper-api.alpaca.markets
NEWS_API_KEY=your_newsapi_key
OPENAI_API_KEY=your_openai_key

STOP_LOSS_VWAP=0.005         # 0.5% stop loss (as a decimal)
RISK_REWARD_VWAP=3           # 1:3 risk-reward ratio
ORDER_QTY=2                  # Number of shares/contracts per trade
```

---

## Usage

1. **Install dependencies:**
    ```bash
    npm install
    ```

2. **Configure your `.env` file** with your API keys and desired settings.

3. **Start the worker:**
    ```bash
    node vwapWorker.js
    ```

4. **Logs:**  
   The bot will log all actions, trades, and reasons for skipped trades to the console.

---

## Customization

- **Symbols:**  
  Edit the `symbols` array in `vwapWorker.js` to trade your preferred tickers.

- **Order Size, Stop Loss, Risk/Reward:**  
  Set via environment variables.

- **Market Hours:**  
  The bot is scheduled to run only during regular US market hours.

---

## File Structure

- `vwapBot.js` — Main VWAP strategy logic.
- `vwapWorker.js` — Schedules and runs the bot.
- `.env` — Your environment variables.

---

## Notes

- This bot is for educational purposes. Use with a paper trading account before going live.
- Make sure your API keys are kept secure and never committed to version control.
- All positions are closed before market close by default.

---

## License

MIT

This project implements a **VWAP (Volume Weighted Average Price) trading bot** using Node.js, Alpaca for trading, NewsAPI for news headlines, and OpenAI for sentiment analysis.

---

## Features

- **VWAP Pullback & Reversal Strategy:**  
  Trades both bullish pullbacks (long) and bearish reversals (short) near the VWAP.

- **News Sentiment Analysis:**  
  Fetches the latest news headline for each symbol and analyzes sentiment using OpenAI's GPT model.

- **Trade Execution:**  
  Places buy or sell (short) orders based on price action and sentiment confirmation.

- **Risk Management:**  
  Automatically manages each trade with configurable stop loss and take profit levels, supporting risk-reward ratios (e.g., 1:3).

- **Configurable Parameters:**  
  Stop loss and risk-reward ratio can be set via environment variables.

---

## How It Works

1. **Fetch Recent Bars:**  
   For each symbol, fetches the last 15 one-minute bars.

2. **Calculate VWAP:**  
   Computes the VWAP from these bars.

3. **Check for Pullback or Reversal:**  
   - **Bullish Pullback:** If price is near VWAP, the candle is bullish, and sentiment is positive, the bot buys.
   - **Bearish Reversal:** If price is near VWAP, the candle is bearish, and sentiment is negative, the bot sells (shorts).

4. **Order Execution:**  
   Places a market order and waits for the order to fill, then fetches the actual entry price.

5. **Exit Management:**  
   Monitors the position and exits when either the stop loss or take profit is hit, based on the configured risk-reward ratio.

6. **Logging:**  
   All trades and exits are logged with timestamps.

---

## Environment Variables

Set these in your `.env` file:

```env
ALPACA_API_KEY_ID=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
NEWS_API_KEY=your_newsapi_key
OPENAI_API_KEY=your_openai_key

STOP_LOSS_VWAP=0.005         # 0.5% stop loss (as a decimal)
RISK_REWARD_VWAP=3           # 1:3 risk-reward ratio