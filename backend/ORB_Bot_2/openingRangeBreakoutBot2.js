const Alpaca = require('@alpacahq/alpaca-trade-api');
// const moment = require('moment');
const moment = require('moment-timezone');

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

// --- Breakout Monitoring ---

async function monitorBreakout(symbol) {
  if (!symbolState[symbol] || symbolState[symbol].orbHigh == null || symbolState[symbol].orbLow == null) {
    console.log(`[${symbol}] ORB range not set. Skipping breakout monitoring.`);
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

  const now = moment().tz('America/New_York')
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
  
  // Only use bars after the ORB window for volume filter
  const postORB = candles.filter(c => new Date(c.Timestamp) > orbEnd.toDate());

  console.log('All candles:', candles.map(c => c.Timestamp));
  console.log('ORB End:', orbEnd.toISOString());
  console.log('Post-ORB:', postORB.map(c => c.Timestamp));
  console.log('Post-ORB count:', postORB.length);

  if (postORB.length < 2) {
    console.log(`[${symbol}] Not enough post-ORB bars for breakout monitoring.`);
    return;
  }

  // Use the last 10 post-ORB bars for volume filter
  const recent = postORB.slice(-10, -1); // up to 9 bars before the latest
  const latest = postORB[postORB.length - 1];

  if (!latest || recent.length < 1) {
    console.log(`[${symbol}] Not enough recent post-ORB bars for volume filter.`);
    return;
  }

  console.log(`[${symbol}] Recent post-ORB volumes:`, recent.map(c => c.Volume));
  console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.Volume);

  // Calculate average volume
  const avgVol = recent.reduce((sum, c) => sum + c.Volume, 0) / recent.length;

  // Calculate median volume
  const sortedVols = recent.map(c => c.Volume).sort((a, b) => a - b);
  const medianVol = sortedVols.length % 2 === 0
  ? (sortedVols[sortedVols.length / 2 - 1] + sortedVols[sortedVols.length / 2]) / 2
  : sortedVols[Math.floor(sortedVols.length / 2)];

  // Require latest volume to be greater than both average and median
  const volConfirmed = latest.Volume > avgVol && latest.Volume > medianVol;

  console.log(`[${symbol}] Avg vol: ${avgVol.toFixed(2)}, Median vol: ${medianVol.toFixed(2)}`);

  let breakout = null;
  if (latest.ClosePrice > symbolState[symbol].orbHigh && volConfirmed) {
    breakout = { direction: 'long', close: latest.ClosePrice };
  } else if (latest.ClosePrice < symbolState[symbol].orbLow && volConfirmed) {
    breakout = { direction: 'short', close: latest.ClosePrice };
  }

  console.log(`[${symbol}] DEBUG: ORB High=${symbolState[symbol].orbHigh}, ORB Low=${symbolState[symbol].orbLow}, Latest Close=${latest.ClosePrice}`);

  if (breakout) {
    console.log(`[${symbol}] Confirmed breakout (${breakout.direction}) on volume: ${latest.Volume} > ${avgVol.toFixed(2)}`);
    symbolState[symbol].pendingRetest = {
        direction: breakout.direction,
        breakoutLevel: breakout.direction === 'long' ? symbolState[symbol].orbHigh : symbolState[symbol].orbLow
    };
    // await confirmRetestAndTrade(symbol, breakout);
  } else {
    console.log(`[${symbol}] No confirmed breakout. Latest vol: ${latest.Volume}, Avg vol: ${avgVol.toFixed(2)}`);  }
}

// async function checkRetestAndTrade(symbol, { direction, breakoutLevel }) {
//   // Fetch last 3 one-minute bars
//   const bars = await alpaca.getBarsV2(symbol, {
//     timeframe: '1Min',
//     limit: 3
//   }, alpaca.configuration);

//   const candles = [];
//   for await (let c of bars) candles.push(c);

//   // Sort by timestamp to ensure correct order
//   candles.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
//   if (candles.length < 2) return;

//   // Look for a retest: previous candle touches or crosses the breakout level, and latest candle closes back in breakout direction
//   const prev = candles[candles.length - 2];
//   const latest = candles[candles.length - 1];

//   // Console logs for mock testing
//   console.log(`[${symbol}] Retest check: direction=${direction}, breakoutLevel=${breakoutLevel}`);
//   console.log(`[${symbol}] Prev 1-min bar:`, prev);
//   console.log(`[${symbol}] Latest 1-min bar:`, latest);

//   let retest = false;
//   if (direction === 'long') {
//     // Retest if previous candle low <= breakoutLevel and latest closes above breakoutLevel
//     retest = prev.LowPrice <= breakoutLevel && latest.ClosePrice > breakoutLevel;
//     console.log(`[${symbol}] Long retest logic: prev.LowPrice (${prev.LowPrice}) <= breakoutLevel (${breakoutLevel}) && latest.ClosePrice (${latest.ClosePrice}) > breakoutLevel (${breakoutLevel}) => ${retest}`);
//   } else {
//     // Retest if previous candle high >= breakoutLevel and latest closes below breakoutLevel
//     retest = prev.HighPrice >= breakoutLevel && latest.ClosePrice < breakoutLevel;
//     console.log(`[${symbol}] Short retest logic: prev.HighPrice (${prev.HighPrice}) >= breakoutLevel (${breakoutLevel}) && latest.ClosePrice (${latest.ClosePrice}) < breakoutLevel (${breakoutLevel}) => ${retest}`);
//   }

//   if (retest && !symbolState[symbol].inPosition) {
//     console.log(`[${symbol}] Retest confirmed (${direction}) at ${breakoutLevel}. Entering trade.`);
//     const entry = latest.ClosePrice;
//     const stop = direction === 'long' ? latest.LowPrice : latest.HighPrice;
//     const target = direction === 'long'
//       ? entry + (entry - stop) * MIN_RRR
//       : entry - (stop - entry) * MIN_RRR;
//     try {
//         await placeBracketOrder(symbol, direction, entry, stop, target);
//         symbolState[symbol].inPosition = true;
//         symbolState[symbol].pendingRetest = null; // Clear pending retest
//     } catch (error) {
//         console.error(`[${symbol}] Error placing order:`, error.message);
//     }
//   } else if (!retest) {
//     console.log(`[${symbol}] No retest confirmation for ${direction} at ${breakoutLevel}.`);
//   }
// }

async function checkRetestAndTrade(symbol, retestObj) {
    // Accepts either (symbol, breakoutLevel) or (symbol, {direction, breakoutLevel, barsSinceBreakout})
    let direction, breakoutLevel;
    if (typeof retestObj === 'object' && retestObj !== null && 'breakoutLevel' in retestObj) {
        direction = retestObj.direction;
        breakoutLevel = retestObj.breakoutLevel;
        // Track bars since breakout for timeout logic
        symbolState[symbol].pendingRetest = symbolState[symbol].pendingRetest || {};
        symbolState[symbol].pendingRetest.barsSinceBreakout = (symbolState[symbol].pendingRetest.barsSinceBreakout || 0) + 1;
    } else {
        direction = 'long'; // fallback for legacy calls
        breakoutLevel = retestObj;
        symbolState[symbol].pendingRetest = symbolState[symbol].pendingRetest || {};
        symbolState[symbol].pendingRetest.barsSinceBreakout = (symbolState[symbol].pendingRetest.barsSinceBreakout || 0) + 1;
    }

    const now = moment().tz('America/New_York');
    const from = now.clone().subtract(4, 'minutes').toISOString();
    const to = now.clone().subtract(1, 'minutes').toISOString();

    try {
        const barIterator = await alpaca.getBarsV2(
            symbol,
            {
                start: from,
                end: to,
                timeframe: '1Min',
                adjustment: 'raw'
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

        // --- NEW: Timeout logic for "no retest" after N bars ---
        const MAX_BARS_WITHOUT_RETEST = 5;
        const barsSinceBreakout = symbolState[symbol].pendingRetest.barsSinceBreakout || 0;

        if (!retest && barsSinceBreakout >= MAX_BARS_WITHOUT_RETEST && !symbolState[symbol].inPosition) {
            console.log(`[${symbol}] No retest after ${MAX_BARS_WITHOUT_RETEST} bars. Entering trade at market.`);
            const entry = latestCandle.ClosePrice;
            const stop = direction === 'long' ? latestCandle.LowPrice : latestCandle.HighPrice;
            const target = direction === 'long'
                ? entry + (entry - stop) * MIN_RRR
                : entry - (stop - entry) * MIN_RRR;
            try {
                await placeBracketOrder(symbol, direction, entry, stop, target);
                symbolState[symbol].inPosition = true;
                symbolState[symbol].pendingRetest = null;
            } catch (error) {
                console.error(`[${symbol}] Error placing order:`, error.message);
            }
            return;
        }

        if (retest && !symbolState[symbol].inPosition) {
            console.log(`[${symbol}] Retest confirmed (${direction}) at ${breakoutLevel}. Entering trade.`);
            const entry = latestCandle.ClosePrice;
            const stop = direction === 'long' ? latestCandle.LowPrice : latestCandle.HighPrice;
            const target = direction === 'long'
                ? entry + (entry - stop) * MIN_RRR
                : entry - (stop - entry) * MIN_RRR;
            try {
                await placeBracketOrder(symbol, direction, entry, stop, target);
                symbolState[symbol].inPosition = true;
                symbolState[symbol].pendingRetest = null; // Clear pending retest
            } catch (error) {
                console.error(`[${symbol}] Error placing order:`, error.message);
            }
        } else if (!retest) {
            console.log(`[${symbol}] No retest confirmation for ${direction} at ${breakoutLevel}.`);
        }

    } catch (fetchError) {
        console.error(`[${symbol}] Error fetching bars with getBarsV2:`, fetchError?.response?.data || fetchError.message);
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
  symbolState,
  alpaca
};