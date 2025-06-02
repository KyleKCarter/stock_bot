# Opening Range Breakout (ORB) Trading Bot

This bot implements an **Opening Range Breakout** strategy using Alpaca for trading, NewsAPI for news headlines, and OpenAI for sentiment analysis. It is designed to run automatically during US market hours and can handle both long and short trades.

---

## Features

- **Opening Range Calculation:** Uses the first 15 minutes (9:30–9:45 AM ET) to set the high and low for each symbol.
- **Breakout Detection:** Enters a long position if price breaks above the range high, or a short position if price breaks below the range low.
- **Sentiment Filter:** Uses OpenAI to analyze the latest news headline for each symbol and only trades if sentiment matches (positive for long, negative for short).
- **Position Management:** Avoids stacking positions; only one long or short per symbol at a time.
- **Stop Loss & Take Profit:** Automatically manages exits based on configurable risk/reward.
- **End-of-Opening-Range Exit:** Closes all positions at 10:00 AM ET to avoid holding past the opening range.
- **Rate Limiting:** Adds a delay between API calls to avoid hitting rate limits.
- **Robust Logging:** Logs all trade actions and reasons for skipped trades.

---

## Requirements

- Node.js (v16+ recommended)
- [Alpaca](https://alpaca.markets/) account and API keys
- [NewsAPI](https://newsapi.org/) API key
- [OpenAI](https://platform.openai.com/) API key

---

## Environment Variables

Create a `.env` file in the root of your project with the following:

```env
APCA_API_KEY_ID=your_alpaca_key
APCA_API_SECRET_KEY=your_alpaca_secret
APCA_API_BASE_URL=https://paper-api.alpaca.markets
NEWS_API_KEY=your_newsapi_key
OPENAI_API_KEY=your_openai_key
ORDER_QTY=2
STOP_LOSS=0.01
RISK_REWARD=3
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
    node orbWorker.js
    ```

4. **Logs:**  
   The bot will log all actions, trades, and reasons for skipped trades to the console.

---

## How It Works

- **9:30–9:45 AM ET:**  
  The bot calculates the opening range (high/low) for each symbol.
- **9:45–10:00 AM ET:**  
  Monitors for breakouts/breakdowns. If price breaks above the high (and sentiment is positive), it buys. If price breaks below the low (and sentiment is negative), it shorts.
- **Stop Loss/Take Profit:**  
  Exits positions automatically based on your configured risk/reward.
- **10:00 AM ET:**  
  Closes all open positions to avoid holding past the opening range.

---

## Customization

- **Symbols:**  
  Edit the `symbols` array in `orbWorker.js` to trade your preferred tickers.
- **Opening Range Duration:**  
  Adjust the `start` and `end` times in `getOpeningRange` if you want a different range.
- **Order Size, Stop Loss, Risk/Reward:**  
  Set via environment variables.

---

## File Structure

- `openingRangeBreakout.js` — Main strategy logic.
- `orbWorker.js` — Schedules and runs the bot.
- `alpacaClient.js` — Alpaca API client (not shown here).
- `.env` — Your environment variables.

---

## Notes

- This bot is for educational purposes. Use with a paper trading account before going live.
- Make sure your API keys are kept secure and never committed to version control.

---

## License

MIT
