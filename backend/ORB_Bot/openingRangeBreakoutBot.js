const Alpaca = require('@alpacahq/alpaca-trade-api');
// const moment = require('moment');
const moment = require('moment-timezone');

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true
});

const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, 'trade_events.log');

function logTradeEvent(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

const ORB_DURATION_MINUTES = 15;
const MIN_RRR = 2; // Risk-Reward Ratio
const MIN_STOP_DIST = 0.5;   // Minimum stop distance in dollars
const MAX_STOP_DIST = 3.0;   // Maximum stop distance in dollars
const ATR_MULTIPLIER = 0.5;  // Your current multiplier

// State per symbol
const symbolState = {}; // { [symbol]: { orbHigh, orbLow, inPosition } }

// --- Utility Functions ---

function calculatePositionSize(accountEquity, riskPercent, entry, stop) {
  const riskAmount = accountEquity * riskPercent;
  const perShareRisk = Math.abs(entry - stop);
  if (perShareRisk < 0.01) return 1; // Prevent division by near-zero
  let size = Math.floor(riskAmount / perShareRisk);
  const MAX_SIZE = 20; // <-- Set your max position size here
  if (size > MAX_SIZE) size = MAX_SIZE;
  return size > 0 ? size : 1;
}

function resetDailyTradeFlags() {
  const today = moment().tz('America/New_York').format('YYYY-MM-DD');
  for (const symbol in symbolState) {
    if (symbolState[symbol].lastTradeDate !== today) {
      symbolState[symbol].hasTradedToday = false;
      symbolState[symbol].lastTradeDate = today;
      symbolState[symbol].tradeType = null;
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getATR(symbol, period = 5) {
  const now = moment().tz('America/New_York');
  const start = now.clone().subtract(period * 5, 'minutes').toISOString();
  const bars = await alpaca.getBarsV2(symbol, {
    timeframe: '5Min',
    start,
    end: now.toISOString(),
    feed: 'iex'
  }, alpaca.configuration);

  const candles = [];
  for await (let c of bars) candles.push(c);
  if (candles.length < period + 1) return 0.5; // fallback

  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const high = candles[candles.length - i].HighPrice;
    const low = candles[candles.length - i].LowPrice;
    const prevClose = candles[candles.length - i - 1].ClosePrice;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atr += tr;
  }
  return atr / period;
}

// --- ORB Range Calculation ---

async function getORBRange(symbol, startHour = 9, startMinute = 30, endHour = 9, endMinute = 45) {
    const start = moment().tz('America/New_York').hour(startHour).minute(startMinute).second(0).startOf('second').toISOString();
    const end = moment().tz('America/New_York').hour(endHour).minute(endMinute).second(59).endOf('second').toISOString();

    // Define orbStart and orbEnd as moment objects for filtering
    const orbStart = moment.tz(start, 'America/New_York');
    const orbEnd = moment.tz(end, 'America/New_York');

    console.log(`[${symbol}] Fetching bars from ${start} to ${end}`);

    const bars = await alpaca.getBarsV2(
        symbol, 
        {
            timeframe: '5Min',
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

    const orbWindow = candles.filter(c =>
        new Date(c.Timestamp) >= orbStart.toDate() &&
        new Date(c.Timestamp) <= orbEnd.toDate()
    );

    const orbHigh = Math.max(...orbWindow.map(c => c.HighPrice));
    const orbLow = Math.min(...orbWindow.map(c => c.LowPrice));

    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].orbHigh = orbHigh;
    symbolState[symbol].orbLow = orbLow;
    symbolState[symbol].inPosition = false;
    symbolState[symbol].pendingRetest = null;

    console.log(`[${symbol}] ORB High: ${symbolState[symbol].orbHigh}, ORB Low: ${symbolState[symbol].orbLow}`);
}

// --- State Sync Helper ---
async function syncInPositionWithAlpaca(symbol, retries = 2) {
  try {
    const position = await alpaca.getPosition(symbol);
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = !!position && Number(position.qty) > 0;
    console.log(`[${symbol}] Synced inPosition with Alpaca:`, symbolState[symbol].inPosition);
  } catch (err) {
    // Retry on timeout (504)
    if ((err.response && err.response.status === 504) && retries > 0) {
      console.warn(`[${symbol}] Timeout syncing inPosition. Retrying... (${retries} left)`);
      await sleep(2000); // wait 2 seconds
      return syncInPositionWithAlpaca(symbol, retries - 1);
    }
    // If no position exists, Alpaca throws 404
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = false;
    if (err.statusCode === 404 || (err.response && err.response.status === 404)) {
      console.log(`[${symbol}] No open position on Alpaca. inPosition set to false.`);
    } else {
      console.error(`[${symbol}] Error syncing inPosition:`, err, err?.response?.data);
    }
  }
}

async function hasOpenOrder(symbol) {
  try {
    const orders = await alpaca.getOrders({
      status: 'open',
      symbols: [symbol],
      direction: 'desc',
      limit: 10
    });
    console.log(`[${symbol}] Open orders:`, orders.map(o => ({id: o.id, status: o.status, side: o.side, type: o.type, class: o.order_class})));
    return orders.some(order =>
      (order.status === 'new' || order.status === 'partially_filled') &&
      (!order.order_class || order.order_class === 'bracket') &&
      (!order.position_side || order.position_side === 'long' || order.position_side === 'short')
    );
  } catch (error) {
    console.error(`[${symbol}] Error checking open orders:`, error, error?.response?.data);
    return false;
  }
}

// --- Order Placement ---

async function placeBracketOrder(symbol, direction, entry, stop, target) {
  await sleep(1500); // 1.5 seconds
  try {
    const account = await alpaca.getAccount();
    const qty = calculatePositionSize(Number(account.equity), 0.01, entry, stop);
    const side = direction === 'long' ? 'buy' : 'sell';

    // Round prices to 2 decimals for stocks
    const round2 = x => Math.round(x * 100) / 100;

    const order = await alpaca.createOrder({
      symbol,
      qty,
      side,
      type: 'limit',
      time_in_force: 'gtc',
      limit_price: round2(entry),
      order_class: 'bracket',
      stop_loss: { stop_price: round2(stop) },
      take_profit: { limit_price: round2(target) }
    });

    console.log(`[${symbol}] Calculated position size: ${qty} (entry: ${entry}, stop: ${stop})`);
    console.log(`[${symbol}] Order placed:`, order.id || order);
  } catch (error) {
    console.error(`[${symbol}] Error placing bracket order:`, error, error?.response?.data);
  }
}

// --- Breakout Monitoring ---

async function monitorBreakout(symbol) {
  await syncInPositionWithAlpaca(symbol);
  symbolState[symbol] = symbolState[symbol] || {};

  if (!symbolState[symbol] || symbolState[symbol].orbHigh == null || symbolState[symbol].orbLow == null) {
    console.log(`[${symbol}] ORB range not set. Skipping breakout monitoring.`);
    return;
  }

  const today = moment().tz('America/New_York').format('YYYY-MM-DD');
  const now = moment().tz('America/New_York');
  const cutoff = moment().tz('America/New_York').hour(14).minute(0).second(0); // set to 11:30 AM ET cutoff when ready to go live

  if (now.isAfter(cutoff)) {
    console.log(`[${symbol}] Past trading cutoff time. Skipping.`);
    return;
  }
  if (symbolState[symbol].hasTradedToday && symbolState[symbol].lastTradeDate === today) {
    console.log(`[${symbol}] Already traded today. Skipping.`);
    return;
  }
    
  if (symbolState[symbol].tradeType) {
    console.log(`[${symbol}] Trade already taken (${symbolState[symbol].tradeType}). Skipping further entries.`);
    return;
  }
  
  if (
    typeof symbolState[symbol].orbHigh !== 'number' ||
    typeof symbolState[symbol].orbLow !== 'number' ||
    isNaN(symbolState[symbol].orbHigh) ||
    isNaN(symbolState[symbol].orbLow)
  ) {
    console.error(`[${symbol}] ERROR: ORB values are not valid numbers!`, symbolState[symbol]);
    return;
  }

  const sessionStart = moment().tz('America/New_York').hour(9).minute(30).second(0).millisecond(0);
  const orbEnd = moment().tz('America/New_York').hour(9).minute(45).second(0).millisecond(0);
  const bars = await alpaca.getBarsV2(symbol, {
    timeframe: '5Min',
    start: sessionStart.toISOString(),
    end: now.toISOString(),
    feed: 'iex'
  }, alpaca.configuration);

  const candles = [];
  for await (let c of bars) candles.push(c);

  candles.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

  const orbBars = candles.filter(c =>
    new Date(c.Timestamp) >= sessionStart.toDate() &&
    new Date(c.Timestamp) <= orbEnd.toDate()
  );
  
  // Only use bars after the ORB window for volume filter
  // Find the max timestamp in the ORB window
  const orbEndTime = Math.max(...orbBars.map(c => new Date(c.Timestamp).getTime()));
  const postORB = candles.filter(c => new Date(c.Timestamp).getTime() > orbEndTime);

  console.log('ORB End:', orbEnd.toISOString());
  console.log('Post-ORB count:', postORB.length);

  if (postORB.length < 1) {
    console.log(`[${symbol}] Not enough post-ORB bars for breakout monitoring.`);
    return;
  }

  // Use the last 10 post-ORB bars for volume filter
  const recent = postORB.length > 4
    ? postORB.slice(1, -1).slice(-3)
    : postORB.slice(-4, -1); // fallback if not enough bars yet
  const latest = postORB[postORB.length - 1];

  if (!latest) {
    console.log(`[${symbol}] No latest post-ORB bar.`);
    return;
  }

  let volConfirmed = true;
  let avgVol = 0;
  let medianVol = 0;

  if (recent.length >= 1) {
    avgVol = recent.reduce((sum, c) => sum + c.Volume, 0) / recent.length;
    const sortedVols = recent.map(c => c.Volume).sort((a, b) => a - b);
    medianVol = sortedVols.length % 2 === 0
    ? (sortedVols[sortedVols.length / 2 - 1] + sortedVols[sortedVols.length / 2]) / 2
    : sortedVols[Math.floor(sortedVols.length / 2)];
    // volConfirmed = latest.Volume > avgVol && latest.Volume > medianVol;
    volConfirmed = latest.Volume > avgVol * 1.2;
    // volConfirmed = latest.Volume > medianVol * 1.2;
    console.log(`[${symbol}] Recent post-ORB volumes:`, recent.map(c => c.Volume));
    console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.Volume);
    console.log(`[${symbol}] Avg vol: ${avgVol.toFixed(2)}, Median vol: ${medianVol.toFixed(2)}`);
  } else {
    // First post-ORB bar, allow breakout (or optionally check against a static threshold)
    console.log(`[${symbol}] Only one post-ORB bar, skipping volume filter.`);
    console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.Volume);
  }

  console.log(`[${symbol}] DEBUG: ORB High=${symbolState[symbol].orbHigh}, ORB Low=${symbolState[symbol].orbLow}, Latest Close=${latest.ClosePrice}`);

  let breakout = null;
  if (latest.ClosePrice > symbolState[symbol].orbHigh && volConfirmed) {
    breakout = { direction: 'long', close: latest.ClosePrice };
  } else if (latest.ClosePrice < symbolState[symbol].orbLow && volConfirmed) {
    breakout = { direction: 'short', close: latest.ClosePrice };
  }

  console.log(`[${symbol}] DEBUG: ORB High=${symbolState[symbol].orbHigh}, ORB Low=${symbolState[symbol].orbLow}, Latest Close=${latest.ClosePrice}`);

  if (breakout) {
    const round2 = x => Math.round(x * 100) / 100;
    const entry = round2(latest.ClosePrice);

    // --- ATR-based stop calculation ---
    const atr = await getATR(symbol, 5);
    let rawStop = breakout.direction === 'long'
    ? latest.LowPrice - atr * ATR_MULTIPLIER
    : latest.HighPrice + atr * ATR_MULTIPLIER;
    let stop = round2(
      breakout.direction === 'long'
      ? Math.min(latest.LowPrice - MIN_STOP_DIST, Math.max(rawStop, latest.LowPrice - MAX_STOP_DIST))
      : Math.max(latest.HighPrice + MIN_STOP_DIST, Math.min(rawStop, latest.HighPrice + MAX_STOP_DIST))
    );
    const target = round2(
        breakout.direction === 'long'
            ? entry + (entry - stop) * MIN_RRR
            : entry - (stop - entry) * MIN_RRR
    );

    // --- Logging ---
    console.log(`[${symbol}] ATR(5): ${atr.toFixed(2)} | Using stop: ${stop} | Entry: ${entry} | Target: ${target}`);
    logTradeEvent(`${symbol} breakout detected at ${latest.ClosePrice} (${breakout.direction}), ATR(5): ${atr.toFixed(2)}, stop: ${stop}, target: ${target}`);

    // Pro-style: Enter immediately on breakout if not in position and no open order
    if (!symbolState[symbol].inPosition && !(await hasOpenOrder(symbol))) {
        await placeBracketOrder(symbol, breakout.direction, entry, stop, target);
        logTradeEvent(`${symbol} bracket order placed: entry=${entry}, stop=${stop}, target=${target}`);
        symbolState[symbol].inPosition = true;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        symbolState[symbol].hasTradedToday = true;
        symbolState[symbol].lastTradeDate = today;
        symbolState[symbol].tradeType = 'breakout';
        await module.exports.syncInPositionWithAlpaca(symbol);
        console.log(`[${symbol}] Entered trade on breakout bar.`);
    } else {
        // If already in position or open order, skip
        console.log(`[${symbol}] Skipping breakout entry: already in position or open order.`);
    }
    // Optionally, still track for retest if you want to scale in or re-enter
    symbolState[symbol].pendingRetest = {
        direction: breakout.direction,
        breakoutLevel: breakout.direction === 'long' ? symbolState[symbol].orbHigh : symbolState[symbol].orbLow
    };
  }
}

async function checkRetestAndTrade(symbol, retestObj) {
  await syncInPositionWithAlpaca(symbol);
  // Defensive debug log
  console.log(`[${symbol}] DEBUG checkRetestAndTrade input:`, JSON.stringify(retestObj));

  // Always resync inPosition before making a trade decision
  await module.exports.syncInPositionWithAlpaca(symbol);

  symbolState[symbol] = symbolState[symbol] || {};

  let direction, breakoutLevel;
  if (typeof retestObj === 'object' && retestObj !== null && 'breakoutLevel' in retestObj) {
      direction = retestObj.direction;
      breakoutLevel = Number(retestObj.breakoutLevel);
      symbolState[symbol].pendingRetest = symbolState[symbol].pendingRetest || {};
      symbolState[symbol].pendingRetest.barsSinceBreakout = (symbolState[symbol].pendingRetest.barsSinceBreakout || 0) + 1;
  } else {
      direction = 'long';
      breakoutLevel = Number(retestObj);
      symbolState[symbol].pendingRetest = symbolState[symbol].pendingRetest || {};
      symbolState[symbol].pendingRetest.barsSinceBreakout = (symbolState[symbol].pendingRetest.barsSinceBreakout || 0) + 1;
  }

  if (isNaN(breakoutLevel)) {
      console.error(`[${symbol}] Invalid breakoutLevel:`, breakoutLevel, retestObj);
      return;
  }

  const today = moment().tz('America/New_York').format('YYYY-MM-DD');
  const now = moment().tz('America/New_York');
  const cutoff = moment().tz('America/New_York').hour(14).minute(0).second(0); // set to 11:30 AM ET cutoff when ready to go live
  const from = now.clone().subtract(4, 'minutes').toISOString();
  const to = now.clone().subtract(1, 'minutes').toISOString();

  if (now.isAfter(cutoff)) {
    console.log(`[${symbol}] Past trading cutoff time. Skipping retest.`);
    return;
  }

  if (
    symbolState[symbol].hasTradedToday &&
    symbolState[symbol].lastTradeDate === today
  ) {
    console.log(`[${symbol}] Already traded today. Skipping retest.`);
    return;
  }

  if (symbolState[symbol].tradeType) {
    console.log(`[${symbol}] Trade already taken (${symbolState[symbol].tradeType}). Skipping retest.`);
    return;
  }

  try {
      const barIterator = await alpaca.getBarsV2(
          symbol,
          {
              start: from,
              end: to,
              timeframe: '1Min',
              adjustment: 'raw',
              feed: 'iex'
          },
          alpaca.configuration
      );

      const bars = [];
      for await (let bar of barIterator) {
          bars.push(bar);
      }

      if (bars.length < 2) {
          console.log(`[${symbol}] Not enough candles to evaluate retest.`);
          return;
      }

      const previousCandle = bars[bars.length - 2];
      const latestCandle = bars[bars.length - 1];

      console.log(`[${symbol}] Retest Check`);
      console.log(`Breakout Level: ${breakoutLevel}`);
      console.log(`Previous Candle:`, previousCandle);
      console.log(`Latest Candle:`, latestCandle);

      let retest = false;
      if (direction === 'long') {
          retest = previousCandle.LowPrice <= breakoutLevel && latestCandle.ClosePrice > breakoutLevel;
          console.log(`[${symbol}] Long retest logic: prev.LowPrice (${previousCandle.LowPrice}) <= breakoutLevel (${breakoutLevel}) && latest.ClosePrice (${latestCandle.ClosePrice}) > breakoutLevel (${breakoutLevel}) => ${retest}`);
      } else {
          retest = previousCandle.HighPrice >= breakoutLevel && latestCandle.ClosePrice < breakoutLevel;
          console.log(`[${symbol}] Short retest logic: prev.HighPrice (${previousCandle.HighPrice}) >= breakoutLevel (${breakoutLevel}) && latest.ClosePrice (${latestCandle.ClosePrice}) < breakoutLevel (${breakoutLevel}) => ${retest}`);
      }

      const MAX_BARS_WITHOUT_RETEST = 5;
      const barsSinceBreakout = symbolState[symbol].pendingRetest.barsSinceBreakout || 0;
      const round2 = x => Math.round(x * 100) / 100;

      // --- Timeout entry logic ---
      if (!retest && barsSinceBreakout >= MAX_BARS_WITHOUT_RETEST && !symbolState[symbol].inPosition) {
          console.log(`[${symbol}] No retest after ${MAX_BARS_WITHOUT_RETEST} bars. Entering trade at market.`);
          const entry = round2(latestCandle.ClosePrice);
          const atr = await getATR(symbol, 5);
          const rawStop = direction === 'long'
          ? latestCandle.LowPrice - atr * ATR_MULTIPLIER
          : latestCandle.HighPrice + atr * ATR_MULTIPLIER;

          const stop = round2(
            direction === 'long'
            ? Math.min(latestCandle.LowPrice - MIN_STOP_DIST, Math.max(rawStop, latestCandle.LowPrice - MAX_STOP_DIST))
            : Math.max(latestCandle.HighPrice + MIN_STOP_DIST, Math.min(rawStop, latestCandle.HighPrice + MAX_STOP_DIST))
          );

          const target = round2(
            direction === 'long'
            ? entry + (entry - stop) * MIN_RRR
            : entry - (stop - entry) * MIN_RRR
          );

          console.log(`[${symbol}] ATR(5): ${atr.toFixed(2)} | Using stop: ${stop} | Entry: ${entry} | Target: ${target}`);
          logTradeEvent(`${symbol} retest entry at ${entry} (${direction}), ATR(5): ${atr.toFixed(2)}, stop: ${stop}, target: ${target}`);

          if (await hasOpenOrder(symbol)) {
            logTradeEvent(`${symbol} breakout skipped: open order detected`);
            console.log(`[${symbol}] Skipping order: open order already exists.`);
            return;
          }

          try {
              await placeBracketOrder(symbol, direction, entry, stop, target);
              symbolState[symbol].inPosition = true;
              symbolState[symbol].pendingRetest = null;
              symbolState[symbol].barsSinceBreakout = 0;
              symbolState[symbol].hasTradedToday = true;
              symbolState[symbol].lastTradeDate = today;
              console.log(`[${symbol}] Timeout entry: Bracket order submitted and state updated.`);
              await module.exports.syncInPositionWithAlpaca(symbol);
          } catch (error) {
              symbolState[symbol].inPosition = false;
              symbolState[symbol].pendingRetest = null;
              symbolState[symbol].barsSinceBreakout = 0;
              console.error(`[${symbol}] Error placing order (retest):`, error, error?.response?.data);
              await module.exports.syncInPositionWithAlpaca(symbol);
          }
          return;
      }

      // --- Retest confirmed logic ---
      if (retest) {
        logTradeEvent(`${symbol} successful retest at ${latestCandle.ClosePrice} (${direction})`);
          if (symbolState[symbol].inPosition) {
              console.log(`[${symbol}] Skipping order: already in position.`);
          } else {
              console.log(`[${symbol}] Retest confirmed (${direction}) at ${breakoutLevel}. Entering trade.`);
              const entry = round2(latestCandle.ClosePrice);
              const atr = await getATR(symbol, 5);
              const rawStop = direction === 'long'
              ? latestCandle.LowPrice - atr * ATR_MULTIPLIER
              : latestCandle.HighPrice + atr * ATR_MULTIPLIER;

              const stop = round2(
                direction === 'long'
                ? Math.min(latestCandle.LowPrice - MIN_STOP_DIST, Math.max(rawStop, latestCandle.LowPrice - MAX_STOP_DIST))
                : Math.max(latestCandle.HighPrice + MIN_STOP_DIST, Math.min(rawStop, latestCandle.HighPrice + MAX_STOP_DIST))
              );

              const target = round2(
                direction === 'long'
                ? entry + (entry - stop) * MIN_RRR
                : entry - (stop - entry) * MIN_RRR
              );
              console.log(`[${symbol}] ATR(5): ${atr.toFixed(2)} | Using stop: ${stop} | Entry: ${entry} | Target: ${target}`);
              logTradeEvent(`${symbol} retest entry at ${entry} (${direction}), ATR(5): ${atr.toFixed(2)}, stop: ${stop}, target: ${target}`);

              if (await hasOpenOrder(symbol)) {
                logTradeEvent(`${symbol} breakout skipped: open order detected`);
                console.log(`[${symbol}] Skipping order: open order already exists.`);
                return;
              }

              try {
                  console.log(`[${symbol}] Placing bracket order...`);
                  await placeBracketOrder(symbol, direction, entry, stop, target);
                  logTradeEvent(`${symbol} bracket order placed: entry=${entry}, stop=${stop}, target=${target}`);
                  symbolState[symbol].inPosition = true;
                  symbolState[symbol].pendingRetest = null;
                  symbolState[symbol].barsSinceBreakout = 0;
                  symbolState[symbol].hasTradedToday = true;
                  symbolState[symbol].lastTradeDate = today;
                  symbolState[symbol].tradeType = 'retest';
                  console.log(`[${symbol}] Bracket order submitted and state updated.`);
                  await module.exports.syncInPositionWithAlpaca(symbol);
              } catch (error) {
                  symbolState[symbol].inPosition = false;
                  symbolState[symbol].pendingRetest = null;
                  symbolState[symbol].barsSinceBreakout = 0;
                  console.error(`[${symbol}] Error placing order (retest):`, error, error?.response?.data);
                  await module.exports.syncInPositionWithAlpaca(symbol);
              }
          }
      } else {
          console.log(`[${symbol}] No retest confirmation for ${direction} at ${breakoutLevel}.`);
      }
  } catch (fetchError) {
      console.error(`[${symbol}] Error fetching bars with getBarsV2:`, fetchError?.response?.data || fetchError.message);
  }
}



// --- Optional: Close Position Helper ---

async function closePosition(symbol, retries = 2) {
  try {
    await alpaca.closePosition(symbol);
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = false;
    console.log(`[${symbol}] Position closed.`);
    await module.exports.syncInPositionWithAlpaca(symbol);
  } catch (error) {
    // Retry on timeout (504)
    if ((error.response && error.response.status === 504) && retries > 0) {
      console.warn(`[${symbol}] Timeout closing position. Retrying... (${retries} left)`);
      await sleep(2000); // wait 2 seconds
      return closePosition(symbol, retries - 1);
    }
    if (error.response && error.response.status === 404) {
      console.log(`[${symbol}] No open position to close.`);
    } else {
      console.error(`[${symbol}] Error closing position:`, error, error?.response?.data);
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
  symbolState,
  alpaca,
  syncInPositionWithAlpaca,
  resetDailyTradeFlags
};