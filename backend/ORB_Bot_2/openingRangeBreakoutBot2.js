const Alpaca = require('@alpacahq/alpaca-trade-api');
const moment = require('moment');

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true
});

const ORB_DURATION_MINUTES = 15;
const MIN_RRR = 2; // Risk-Reward Ratio

// State per symbol
const symbolState = {}; // { [symbol]: { orbHigh, orbLow, inPosition } }

// --- Utility Functions ---

function calculatePositionSize(accountEquity, riskPercent, entry, stop) {
  const riskAmount = accountEquity * riskPercent;
  const perShareRisk = Math.abs(entry - stop);
  const size = Math.floor(riskAmount / perShareRisk);
  return size > 0 ? size : 1;
}

// --- ORB Range Calculation ---

async function getORBRange(symbol, startHour = 9, startMinute = 30, endHour = 9, endMinute = 45) {
    const start = moment().tz('America/New_York').hour(startHour).minute(startMinute).second(0).startOf('second').toISOString();
    const end = moment().tz('America/New_York').hour(endHour).minute(endMinute).second(59).endOf('second').toISOString();

    console.log(`[${symbol}] Fetching bars from ${start} to ${end}`);

    const bars = await alpaca.getBarsV2(
        symbol, 
        {
            timeframe: '1Min',
            start,
            end,
            feed: 'iex'
        },
        alpaca.configuration
    );

    const candles = [];
    for await (let b of bars) candles.push(b);

    if (!candles.length) {
        console.error(`[${symbol}] No bars found for ORB range. ORB not set.`);
        return;
    }

    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].orbHigh = Math.max(...candles.map(c => c.HighPrice));
    symbolState[symbol].orbLow = Math.min(...candles.map(c => c.LowPrice));
    symbolState[symbol].inPosition = false;
    symbolState[symbol].pendingRetest = null;

    console.log(`[${symbol}] ORB High: ${symbolState[symbol].orbHigh}, ORB Low: ${symbolState[symbol].orbLow}`);
}

// --- Order Placement ---

async function placeBracketOrder(symbol, direction, entry, stop, target) {
  try {
    const account = await alpaca.getAccount();
    const qty = calculatePositionSize(Number(account.equity), 0.01, entry, stop);
    const side = direction === 'long' ? 'buy' : 'sell';

    const order = await alpaca.createOrder({
      symbol,
      qty,
      side,
      type: 'limit',
      time_in_force: 'gtc',
      limit_price: entry,
      order_class: 'bracket',
      stop_loss: { stop_price: stop },
      take_profit: { limit_price: target }
    });

    console.log(`[${symbol}] Order placed:`, order.id || order);
  } catch (error) {
    console.error(`[${symbol}] Error placing bracket order:`, error.message);
  }
}

// --- Retest Confirmation and Trade ---

async function confirmRetestAndTrade(symbol, { direction, close }) {
  const oneMinBars = await alpaca.getBarsV2(
    symbol, 
    {
        timeframe: '1Min',
        limit: 5
    },
    alpaca.configuration
    );

  const candles = [];
  for await (let c of oneMinBars) candles.push(c);

  if (!candles.length) {
    console.log(`[${symbol}] No 1-min bars for retest confirmation.`);
    return;
  }

  const lastCandle = candles[candles.length - 1];
  const entry = lastCandle.ClosePrice;
  const stop = direction === 'long' ? lastCandle.LowPrice : lastCandle.HighPrice;
  const target = direction === 'long'
    ? entry + (entry - stop) * MIN_RRR
    : entry - (stop - entry) * MIN_RRR;

  console.log(`[${symbol}] Entry: ${entry}, Stop: ${stop}, Target: ${target}`);

  symbolState[symbol] = symbolState[symbol] || {};
  if (!symbolState[symbol].inPosition) {
    await placeBracketOrder(symbol, direction, entry, stop, target);
    symbolState[symbol].inPosition = true;
  }
}

// --- Breakout Monitoring ---

async function monitorBreakout(symbol) {
  if (!symbolState[symbol] || symbolState[symbol].orbHigh == null || symbolState[symbol].orbLow == null) {
    console.log(`[${symbol}] ORB range not set. Skipping breakout monitoring.`);
    return;
  }

  const bars = await alpaca.getBarsV2(symbol, {
    timeframe: '5Min',
    limit: 5
  }, alpaca.configuration);

  const candles = [];
  for await (let c of bars) candles.push(c);

  if (candles.length < 3) {
    console.log(`[${symbol}] Not enough 5-min bars for breakout monitoring.`);
    return;
  }

  const recent = candles.slice(0, -1);
  const latest = candles[candles.length - 1];

  const avgVol = recent.reduce((sum, c) => sum + c.Volume, 0) / recent.length;
  const volConfirmed = latest.Volume > avgVol;

  let breakout = null;
  if (latest.ClosePrice > symbolState[symbol].orbHigh && volConfirmed) breakout = { direction: 'long', close: latest.ClosePrice };
  if (latest.ClosePrice < symbolState[symbol].orbLow && volConfirmed) breakout = { direction: 'short', close: latest.ClosePrice };

  if (breakout) {
    console.log(`[${symbol}] Confirmed breakout (${breakout.direction}) on volume: ${latest.Volume} > ${avgVol.toFixed(2)}`);
    symbolState[symbol].pendingRetest = {
        direction: breakout.direction,
        breakoutLevel: breakout.direction === 'long' ? symbolState[symbol].orbHigh : symbolState[symbol].orbLow
    };
    // await confirmRetestAndTrade(symbol, breakout);
  } else {
    console.log(`[${symbol}] No confirmed breakout. Latest vol: ${latest.Volume}, Avg vol: ${avgVol.toFixed(2)}`);
  }
}

async function checkRetestAndTrade(symbol, { direction, breakoutLevel }) {
  // Fetch last 3 one-minute bars
  const bars = await alpaca.getBarsV2(symbol, {
    timeframe: '1Min',
    limit: 3
  }, alpaca.configuration);

  const candles = [];
  for await (let c of bars) candles.push(c);
  if (candles.length < 2) return;

  // Look for a retest: previous candle touches or crosses the breakout level, and latest candle closes back in breakout direction
  const prev = candles[candles.length - 2];
  const latest = candles[candles.length - 1];

  let retest = false;
  if (direction === 'long') {
    // Retest if previous candle low <= breakoutLevel and latest closes above breakoutLevel
    retest = prev.LowPrice <= breakoutLevel && latest.ClosePrice > breakoutLevel;
  } else {
    // Retest if previous candle high >= breakoutLevel and latest closes below breakoutLevel
    retest = prev.HighPrice >= breakoutLevel && latest.ClosePrice < breakoutLevel;
  }

  if (retest && !symbolState[symbol].inPosition) {
    console.log(`[${symbol}] Retest confirmed (${direction}) at ${breakoutLevel}. Entering trade.`);
    const entry = latest.ClosePrice;
    const stop = direction === 'long' ? latest.LowPrice : latest.HighPrice;
    const target = direction === 'long'
      ? entry + (entry - stop) * MIN_RRR
      : entry - (stop - entry) * MIN_RRR;
    await placeBracketOrder(symbol, direction, entry, stop, target);
    symbolState[symbol].inPosition = true;
    symbolState[symbol].pendingRetest = null; // Clear pending retest
  }
}

// --- Optional: Close Position Helper ---

async function closePosition(symbol) {
  try {
    await alpaca.closePosition(symbol);
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = false;
    console.log(`[${symbol}] Position closed.`);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`[${symbol}] No open position to close.`);
    } else {
      console.error(`[${symbol}] Error closing position:`, error.message);
    }
  }
}

// --- Exports ---

module.exports = {
  getORBRange,
  monitorBreakout,
  placeBracketOrder,
  calculatePositionSize,
  checkRetestAndTrade,
  closePosition,
  symbolState
};