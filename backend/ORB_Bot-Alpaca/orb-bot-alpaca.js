// Load environment configurations
require('dotenv').config({ path: '../.env' });           // Main backend config
require('dotenv').config({ path: './.env.enhanced' });   // ORB-specific enhanced config

const Alpaca = require('@alpacahq/alpaca-trade-api');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true
});

const logFile = path.join(__dirname, 'trade_events.log');

function logTradeEvent(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

// Configuration from enhanced environment
const ORB_DURATION_MINUTES = process.env.OPENING_RANGE_MINUTES 
  ? Number(process.env.OPENING_RANGE_MINUTES) 
  : 15;
const MIN_RRR = process.env.MIN_RRR ? Number(process.env.MIN_RRR) : 2;
const MIN_STOP_DIST = process.env.MIN_STOP_DIST ? Number(process.env.MIN_STOP_DIST) : 0.15;
const MAX_STOP_DIST = process.env.MAX_STOP_DIST ? Number(process.env.MAX_STOP_DIST) : 2.0;
const ATR_MULTIPLIER = process.env.ATR_MULTIPLIER ? Number(process.env.ATR_MULTIPLIER) : 0.5;
const BRACKET_ORDER_DELAY_MS = process.env.BRACKET_ORDER_DELAY_MS
  ? Number(process.env.BRACKET_ORDER_DELAY_MS)
  : 1500;
const STOP_LIMIT_OFFSET = process.env.STOP_LIMIT_OFFSET
  ? Number(process.env.STOP_LIMIT_OFFSET)
  : 0.20; // Default 20 cents above stop price
const MIN_TP_DIST = process.env.MIN_TP_DIST ? Number(process.env.MIN_TP_DIST) : 0.25;   // $0.25 minimum TP distance
const MAX_TP_DIST = process.env.MAX_TP_DIST ? Number(process.env.MAX_TP_DIST) : 3.0;   // $3.00 maximum TP distance

const symbolState = {}; // { [symbol]: { orbHigh, orbLow, inPosition } }

// --- Utility Functions ---

// Professional Position Sizing - Dollar-Based with Price Tiers
function calculatePositionSize(accountEquity, riskPercent, entry, stop, atr = null, stockPrice = null) {
  // Use stock price if provided, otherwise use entry price
  const currentPrice = stockPrice || entry;
  
  // Professional dollar-based position sizing
  const TARGET_POSITION_VALUE = getTargetPositionValue(accountEquity, currentPrice);
  const baseShares = Math.floor(TARGET_POSITION_VALUE / currentPrice);
  
  // Risk-based validation (traditional approach as backup)
  const riskAmount = accountEquity * riskPercent;
  const perShareRisk = Math.abs(entry - stop);
  if (perShareRisk < 0.01) return Math.min(baseShares, 1);
  
  const maxSharesByRisk = Math.floor(riskAmount / perShareRisk);
  
  // Take the smaller of dollar-based or risk-based sizing
  let size = Math.min(baseShares, maxSharesByRisk);
  
  // Dynamic sizing based on volatility (ATR)
  if (atr && atr > 0) {
    const volatilityAdjustment = Math.min(1.5, Math.max(0.5, 1.0 / atr)); // Scale by inverse ATR
    size = Math.floor(size * volatilityAdjustment);
    console.log(`Position size adjusted for volatility: ATR=${atr.toFixed(3)}, Adjustment=${volatilityAdjustment.toFixed(2)}`);
  }
  
  // Apply maximum position limits based on stock price
  const maxSize = getMaxPositionSize(currentPrice, accountEquity);
  if (size > maxSize) size = maxSize;
  
  console.log(`[POSITION SIZING] Price: $${currentPrice.toFixed(2)}, Target Value: $${TARGET_POSITION_VALUE}, Base Shares: ${baseShares}, Risk-Limited: ${maxSharesByRisk}, Final: ${size}`);
  
  return size > 0 ? size : 1;
}

// DAY TRADER PROFESSIONAL Position Sizing (NOT Institutional Standards)
function getTargetPositionValue(accountEquity, stockPrice) {
  const accountValue = Number(accountEquity);
  
  // DAY TRADER BEST PRACTICES (used by successful retail day traders):
  // - Single position: 3-5% of account (more aggressive than institutions)
  // - High-probability setups: up to 7-8% (ORB breakouts with confirmation)
  // - Total exposure: 15-25% max (day traders hold shorter, can be more aggressive)
  
  // Day trader position sizing based on setup quality and stock characteristics
  let positionPercent;
  
  if (stockPrice >= 200) {
    // Large-cap, highly liquid (SPY, AAPL, TSLA, GOOGL)
    positionPercent = 0.05; // 5% - very liquid, predictable, lower gap risk
  } else if (stockPrice >= 100) {
    // Mid-large cap (AMD, NVDA, META, etc.)
    positionPercent = 0.045; // 4.5% - good liquidity, moderate predictability
  } else if (stockPrice >= 50) {
    // Mid-cap stocks
    positionPercent = 0.04; // 4% - moderate liquidity
  } else if (stockPrice >= 20) {
    // Small-mid cap (higher volatility, good for day trading)
    positionPercent = 0.035; // 3.5% - more volatile but good intraday moves
  } else if (stockPrice >= 10) {
    // Small cap (high volatility, gap risk)
    positionPercent = 0.03; // 3% - higher risk due to volatility and gaps
  } else {
    // Penny stocks / very small cap (highest risk)
    positionPercent = 0.02; // 2% - very high risk, unpredictable
  }
  
  const targetValue = accountValue * positionPercent;
  
  // Day trader account size-based adjustments
  if (accountValue <= 25000) {
    // PDT rule constraint - need to be more conservative
    return Math.min(targetValue, 1000); // Max $1000 per position (PDT accounts)
  } else if (accountValue <= 50000) {
    // Small day trading accounts
    return Math.min(targetValue, 2500); // Max $2500 per position
  } else if (accountValue <= 100000) {
    // Medium day trading accounts
    return Math.min(targetValue, 5000); // Max $5000 per position
  } else if (accountValue <= 250000) {
    // Large day trading accounts
    return Math.min(targetValue, 12500); // Max $12.5k per position
  } else {
    // Very large day trading accounts
    return Math.min(targetValue, 25000); // Max $25k per position
  }
}

// Day trader maximum position size limits (optimized for active trading)
function getMaxPositionSize(stockPrice, accountEquity) {
  const accountValue = Number(accountEquity);
  
  // Calculate maximum shares based on day trader risk limits
  const maxDollarPosition = getTargetPositionValue(accountEquity, stockPrice);
  const maxSharesByDollar = Math.floor(maxDollarPosition / stockPrice);
  
  // Day trader liquidity limits (can be more aggressive due to active management)
  let liquidityLimit;
  
  if (stockPrice >= 200) {
    liquidityLimit = 200; // Large-cap: up to 200 shares (very liquid)
  } else if (stockPrice >= 100) {
    liquidityLimit = 150; // Mid-large cap: up to 150 shares
  } else if (stockPrice >= 50) {
    liquidityLimit = 100; // Mid-cap: up to 100 shares
  } else if (stockPrice >= 20) {
    liquidityLimit = 75;  // Small-mid cap: up to 75 shares
  } else if (stockPrice >= 10) {
    liquidityLimit = 50;  // Small cap: up to 50 shares
  } else {
    liquidityLimit = 25;  // Penny stocks: up to 25 shares (high risk)
  }
  
  // Additional PDT rule consideration
  if (accountValue < 25000) {
    // PDT accounts need smaller positions to preserve day trades
    liquidityLimit = Math.min(liquidityLimit, Math.floor(liquidityLimit * 0.6));
  }
  
  return Math.min(maxSharesByDollar, liquidityLimit);
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

// --- Retry Wrapper ---
async function withRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (err) {
    if (
      retries > 0 &&
      (!err.response || err.response.status >= 500 || err.code === 'ECONNABORTED' || err.response?.status === 504)
    ) {
      await sleep(1000);
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

// --- ATR Calculation ---
async function getATR(symbol, period = 5) {
  const now = moment().tz('America/New_York');
  const start = now.clone().subtract(period * 5, 'minutes').toISOString();
  const bars = await withRetry(() => alpaca.getBarsV2(symbol, {
    timeframe: '5Min',
    start,
    end: now.toISOString(),
    feed: 'iex'
  }, alpaca.configuration));

  const candles = [];
  for await (let c of bars) candles.push(c);
  if (candles.length < period + 1) return 0.5;

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

  const orbStart = moment.tz(start, 'America/New_York');
  const orbEnd = moment.tz(end, 'America/New_York');

  console.log(`[${symbol}] Fetching bars from ${start} to ${end}`);

  const bars = await withRetry(() => alpaca.getBarsV2(
    symbol,
    {
      timeframe: '5Min',
      start,
      end,
      feed: 'iex'
    },
    alpaca.configuration
  ));

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

// --- State Sync Helpers ---
async function syncInPositionWithAlpaca(symbol, retries = 2) {
  try {
    const position = await withRetry(() => alpaca.getPosition(symbol));
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = !!position && Number(position.qty) > 0;
    console.log(`[${symbol}] Synced inPosition with Alpaca:`, symbolState[symbol].inPosition);
  } catch (err) {
    if ((err.response && err.response.status === 504) && retries > 0) {
      console.warn(`[${symbol}] Timeout syncing inPosition. Retrying... (${retries} left)`);
      await sleep(2000);
      return syncInPositionWithAlpaca(symbol, retries - 1);
    }
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = false;
    if (err.statusCode === 404 || (err.response && err.response.status === 404)) {
      console.log(`[${symbol}] No open position on Alpaca. inPosition set to false.`);
    } else {
      console.error(`[${symbol}] Error syncing inPosition:`, err, err?.response?.data);
    }
  }
}

async function syncAllPositionsWithAlpaca(symbols, symbolState) {
  for (const symbol of symbols) {
    await syncInPositionWithAlpaca(symbol);
  }
}

async function hasOpenOrder(symbol) {
  try {
    const orders = await withRetry(() => alpaca.getOrders({
      status: 'open',
      symbols: [symbol],
      direction: 'desc',
      limit: 10
    }));
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
async function placeBracketOrder(symbol, direction, entry, stop, target, atr = null) {
  if (BRACKET_ORDER_DELAY_MS > 0) {
    await sleep(BRACKET_ORDER_DELAY_MS);
  }
  try {
    const account = await withRetry(() => alpaca.getAccount());
    const qty = calculatePositionSize(Number(account.equity), 0.01, entry, stop, atr, entry);
    const side = direction === 'long' ? 'buy' : 'sell';
    const round2 = x => Math.round(x * 100) / 100;

    // Professional-style stop-limit entry
    const stopPrice = round2(entry);
    const limitPrice = direction === 'long'
      ? round2(entry + STOP_LIMIT_OFFSET)
      : round2(entry - STOP_LIMIT_OFFSET);

    const order = await withRetry(() => alpaca.createOrder({
      symbol,
      qty,
      side,
      type: 'stop_limit',
      time_in_force: 'gtc',
      stop_price: stopPrice,
      limit_price: limitPrice,
      order_class: 'bracket',
      stop_loss: { stop_price: round2(stop) },
      take_profit: { limit_price: round2(target) }
    }));

    console.log(`[${symbol}] Calculated position size: ${qty} (entry: ${entry}, stop: ${stop}${atr ? `, ATR: ${atr.toFixed(3)}` : ''})`);
    console.log(`[${symbol}] Stop-limit bracket order placed: stop=${stopPrice}, limit=${limitPrice}, stop_loss=${round2(stop)}, take_profit=${round2(target)}`);
  } catch (error) {
    console.error(`[${symbol}] Error placing bracket order:`, error, error?.response?.data);
  }
}

// --- Breakout Monitoring ---
async function monitorBreakout(symbol) {
  await syncInPositionWithAlpaca(symbol);
  symbolState[symbol] = symbolState[symbol] || {};

  if (!symbolState[symbol] || symbolState[symbol].orbHigh == null || symbolState[symbol].orbLow == null) {
    console.log(`[${symbol}] Skipping breakout monitoring: ORB range not set.`);
    return;
  }

  const today = moment().tz('America/New_York').format('YYYY-MM-DD');
  const now = moment().tz('America/New_York');
  const cutoff = moment().tz('America/New_York').hour(14).minute(0).second(0); // 2:00 PM ET to match extended window
  
  // Time-based volume filtering - calculate once for the function
  const currentHour = now.hour();
  const isLowVolumePeriod = currentHour >= 11 && currentHour <= 13; // 11 AM - 1 PM ET
  const volumeMultiplier = isLowVolumePeriod ? 1.1 : 1.2; // Lower threshold during lunch period
  const breakoutVolumeMultiplier = isLowVolumePeriod ? 1.25 : 1.4; // Reduced from 1.5x

  if (now.isAfter(cutoff)) {
    console.log(`[${symbol}] Skipping breakout monitoring: Past trading cutoff time.`);
    return;
  }
  if (symbolState[symbol].hasTradedToday && symbolState[symbol].lastTradeDate === today) {
    console.log(`[${symbol}] Skipping breakout monitoring: Already traded today.`);
    return;
  }
  if (symbolState[symbol].tradeType) {
    console.log(`[${symbol}] Skipping breakout monitoring: Trade already taken (${symbolState[symbol].tradeType}).`);
    return;
  }
  if (
    typeof symbolState[symbol].orbHigh !== 'number' ||
    typeof symbolState[symbol].orbLow !== 'number' ||
    isNaN(symbolState[symbol].orbHigh) ||
    isNaN(symbolState[symbol].orbLow)
  ) {
    console.log(`[${symbol}] Skipping breakout monitoring: ORB values are not valid numbers!`);
    return;
  }

  const sessionStart = moment().tz('America/New_York').hour(9).minute(30).second(0).millisecond(0);
  const orbEnd = moment().tz('America/New_York').hour(9).minute(45).second(0).millisecond(0);
  const bars = await withRetry(() => alpaca.getBarsV2(symbol, {
    timeframe: '5Min',
    start: sessionStart.toISOString(),
    end: now.toISOString(),
    feed: 'iex'
  }, alpaca.configuration));

  const candles = [];
  for await (let c of bars) candles.push(c);

  candles.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));
  const orbBars = candles.filter(c =>
    new Date(c.Timestamp) >= sessionStart.toDate() &&
    new Date(c.Timestamp) <= orbEnd.toDate()
  );
  const orbEndTime = Math.max(...orbBars.map(c => new Date(c.Timestamp).getTime()));
  const postORB = candles.filter(c => new Date(c.Timestamp).getTime() > orbEndTime);

  if (postORB.length < 1) {
    console.log(`[${symbol}] Skipping breakout monitoring: Not enough post-ORB bars.`);
    return;
  }

  const recent = postORB.length > 4
    ? postORB.slice(1, -1).slice(-3)
    : postORB.slice(-4, -1);
  const latest = postORB[postORB.length - 1];
  if (!latest) {
    console.log(`[${symbol}] Skipping breakout monitoring: No latest post-ORB bar.`);
    return;
  }

  // Time-based volume filtering - more lenient during low-volume periods
  
  let volConfirmed = true;
  if (recent.length >= 1) {
    const avgVol = recent.reduce((sum, c) => sum + c.Volume, 0) / recent.length;
    volConfirmed = latest.Volume > avgVol * volumeMultiplier;
    console.log(`[${symbol}] Recent post-ORB volumes:`, recent.map(c => c.Volume));
    console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.Volume);
    console.log(`[${symbol}] Time: ${now.format('HH:mm')}, Low Volume Period: ${isLowVolumePeriod}, Multiplier: ${volumeMultiplier}x, Avg vol: ${avgVol.toFixed(2)}, Confirmed: ${volConfirmed}`);
  } else {
    console.log(`[${symbol}] Only one post-ORB bar, skipping volume filter.`);
    console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.Volume);
  }

  const ATR = await getATR(symbol, 5); // Use your ATR calculation

  // --- Breakout Candle Filters ---
  const breakoutCandle = latest;
  const candleBody = Math.abs(breakoutCandle.ClosePrice - breakoutCandle.OpenPrice);

  // Calculate average volume of last 5 post-ORB bars (excluding latest)
  const avgVol = recent.length > 0
    ? recent.reduce((sum, c) => sum + c.Volume, 0) / recent.length
    : breakoutCandle.Volume;

  // Time-based volume filtering - professional approach
  
  // Filter: require volume based on time period and body less than 1.5x ATR
  if (
    breakoutCandle.Volume < avgVol * breakoutVolumeMultiplier ||
    candleBody > ATR * 1.5
  ) {
    console.log(`[${symbol}] Breakout filtered out: volume/body criteria not met.`);
    console.log(`[${symbol}] - Time: ${now.format('HH:mm')}, Low Volume Period: ${isLowVolumePeriod}`);
    console.log(`[${symbol}] - Volume: ${breakoutCandle.Volume}, AvgVol: ${avgVol}, Required: ${(avgVol * breakoutVolumeMultiplier).toFixed(0)} (${breakoutVolumeMultiplier}x)`);
    console.log(`[${symbol}] - Body: ${candleBody.toFixed(3)}, ATR: ${ATR.toFixed(3)}, Max Body: ${(ATR * 1.5).toFixed(3)}`);
    trackFilteredTrade(symbol, 'volume');
    return; // Skip this breakout
  }

  let breakout = null;
  if (latest.ClosePrice > symbolState[symbol].orbHigh && volConfirmed) {
    breakout = { direction: 'long', close: latest.ClosePrice };
    console.log(`[${symbol}] Breakout detected: LONG at ${latest.ClosePrice} (ORB High: ${symbolState[symbol].orbHigh})`);
  } else if (latest.ClosePrice < symbolState[symbol].orbLow && volConfirmed) {
    breakout = { direction: 'short', close: latest.ClosePrice };
    console.log(`[${symbol}] Breakout detected: SHORT at ${latest.ClosePrice} (ORB Low: ${symbolState[symbol].orbLow})`);
  } else {
    console.log(`[${symbol}] No breakout detected. Latest close: ${latest.ClosePrice}, ORB High: ${symbolState[symbol].orbHigh}, ORB Low: ${symbolState[symbol].orbLow}, Vol Confirmed: ${volConfirmed}`);
  }

  if (breakout) {
    const round2 = x => Math.round(x * 100) / 100;
    const entry = round2(latest.ClosePrice);
    const atr = await getATR(symbol, 5);
    let rawStop = breakout.direction === 'long'
      ? latest.LowPrice - atr * ATR_MULTIPLIER
      : latest.HighPrice + atr * ATR_MULTIPLIER;
    let stop = round2(
      breakout.direction === 'long'
        ? Math.min(latest.LowPrice - MIN_STOP_DIST, Math.max(rawStop, latest.LowPrice - MAX_STOP_DIST))
        : Math.max(latest.HighPrice + MIN_STOP_DIST, Math.min(rawStop, latest.HighPrice + MAX_STOP_DIST))
    );
    let rawTarget = breakout.direction === 'long'
      ? entry + (entry - stop) * MIN_RRR
      : entry - (stop - entry) * MIN_RRR;

    const target = round2(
      breakout.direction === 'long'
        ? Math.max(entry + MIN_TP_DIST, Math.min(rawTarget, entry + MAX_TP_DIST))
        : Math.min(entry - MIN_TP_DIST, Math.max(rawTarget, entry - MAX_TP_DIST))
    );

    if (!symbolState[symbol].inPosition && !(await hasOpenOrder(symbol))) {
      // Check trade cooldown
      if (!canPlaceNewTrade(symbol)) {
        console.log(`[${symbol}] Skipping breakout: trade cooldown active`);
        trackFilteredTrade(symbol, 'cooldown');
        return;
      }
      
      // Check trend confirmation
      const trendConfirmed = await getTrendConfirmation(symbol, breakout.direction);
      if (!trendConfirmed) {
        console.log(`[${symbol}] Skipping breakout: against trend direction`);
        trackFilteredTrade(symbol, 'trend');
        return;
      }
      
      // Check market structure
      const marketStructure = await getMarketStructure(symbol);
      const structureAligned = (
        (breakout.direction === 'long' && marketStructure.strength === 'bullish') ||
        (breakout.direction === 'short' && marketStructure.strength === 'bearish') ||
        (marketStructure.strength === 'neutral' && marketStructure.confidence < 0.7)
      );
      
      if (!structureAligned) {
        console.log(`[${symbol}] Skipping breakout: market structure not aligned (${marketStructure.strength})`);
        trackFilteredTrade(symbol, 'structure');
        return;
      }
      
      console.log(`[${symbol}] ✅ BREAKOUT TRADE SETUP:`);
      console.log(`[${symbol}] - Direction: ${breakout.direction.toUpperCase()}`);
      console.log(`[${symbol}] - Entry: $${entry}, Stop: $${stop}, Target: $${target}`);
      console.log(`[${symbol}] - Risk/Reward: ${((target - entry) / (entry - stop)).toFixed(2)}:1`);
      console.log(`[${symbol}] - Time: ${now.format('YYYY-MM-DD HH:mm:ss')} ET`);
      console.log(`[${symbol}] - ORB High: $${symbolState[symbol].orbHigh}, ORB Low: $${symbolState[symbol].orbLow}`);
      
      await placeBracketOrder(symbol, breakout.direction, entry, stop, target, atr);
      symbolState[symbol].inPosition = true;
      symbolState[symbol].pendingRetest = null;
      symbolState[symbol].barsSinceBreakout = 0;
      symbolState[symbol].hasTradedToday = true;
      symbolState[symbol].lastTradeDate = today;
      symbolState[symbol].tradeType = 'breakout';
      symbolState[symbol].lastTradeTime = now.toISOString(); // Use consistent time format
      await syncInPositionWithAlpaca(symbol);
      
      // Log trade event
      logTradeEvent(`${symbol} BREAKOUT ${breakout.direction.toUpperCase()} - Entry: ${entry}, Stop: ${stop}, Target: ${target}, RR: ${((target - entry) / (entry - stop)).toFixed(2)}:1`);
      trackSuccessfulTrade(symbol, 'breakout');
      console.log(`[${symbol}] ✅ Breakout trade order placed and state updated.`);
    } else {
      console.log(`[${symbol}] Skipping breakout entry: already in position or open order.`);
    }
    symbolState[symbol].pendingRetest = {
      direction: breakout.direction,
      breakoutLevel: breakout.direction === 'long' ? symbolState[symbol].orbHigh : symbolState[symbol].orbLow
    };
  }
}

// --- Retest Monitoring ---
async function checkRetestAndTrade(symbol, retestObj) {
  await syncInPositionWithAlpaca(symbol);
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
    console.log(`[${symbol}] Retest check skipped: invalid breakoutLevel (${breakoutLevel})`);
    return;
  }

  const today = moment().tz('America/New_York').format('YYYY-MM-DD');
  const now = moment().tz('America/New_York');
  const cutoff = moment().tz('America/New_York').hour(14).minute(0).second(0); // 2:00 PM ET to match extended window
  const from = now.clone().subtract(4, 'minutes').toISOString();
  const to = now.clone().subtract(1, 'minutes').toISOString();

  // Time-based volume filtering for retest
  const currentHour = now.hour();
  const isLowVolumePeriod = currentHour >= 11 && currentHour <= 13; // 11 AM - 1 PM ET
  const retestVolumeMultiplier = isLowVolumePeriod ? 1.1 : 1.2; // Same as breakout initial filter

  if (now.isAfter(cutoff)) {
    console.log(`[${symbol}] Retest check skipped: past trading cutoff time.`);
    return;
  }
  if (symbolState[symbol].hasTradedToday && symbolState[symbol].lastTradeDate === today) {
    console.log(`[${symbol}] Retest check skipped: already traded today.`);
    return;
  }
  if (symbolState[symbol].tradeType) {
    console.log(`[${symbol}] Retest check skipped: trade already taken (${symbolState[symbol].tradeType}).`);
    return;
  }

  try {
    const barIterator = await withRetry(() => alpaca.getBarsV2(
      symbol,
      {
        start: from,
        end: to,
        timeframe: '1Min',
        adjustment: 'raw',
        feed: 'iex'
      },
      alpaca.configuration
    ));

    const bars = [];
    for await (let bar of barIterator) bars.push(bar);

    if (bars.length < 2) {
      console.log(`[${symbol}] Retest check skipped: not enough candles.`);
      return;
    }

    const previousCandle = bars[bars.length - 2];
    const latestCandle = bars[bars.length - 1];

    // Volume filter for retest - similar to breakout logic with time-based adjustment
    let volConfirmed = true;
    if (bars.length >= 3) {
      const recentBars = bars.slice(0, -1).slice(-3); // Get last 3 bars excluding latest
      const avgVol = recentBars.reduce((sum, c) => sum + c.Volume, 0) / recentBars.length;
      volConfirmed = latestCandle.Volume > avgVol * retestVolumeMultiplier; // Time-based threshold
      console.log(`[${symbol}] Retest volume check - Recent volumes:`, recentBars.map(c => c.Volume));
      console.log(`[${symbol}] Latest retest bar volume: ${latestCandle.Volume}, Avg vol: ${avgVol.toFixed(2)}, Multiplier: ${retestVolumeMultiplier}x, Confirmed: ${volConfirmed}`);
    } else {
      console.log(`[${symbol}] Not enough bars for retest volume filter, allowing trade.`);
    }

    let retest = false;
    if (direction === 'long') {
      retest = previousCandle.LowPrice <= breakoutLevel && latestCandle.ClosePrice > breakoutLevel && volConfirmed;
      console.log(`[${symbol}] Retest logic (LONG): prev.low (${previousCandle.LowPrice}) <= breakoutLevel (${breakoutLevel}) && latest.close (${latestCandle.ClosePrice}) > breakoutLevel (${breakoutLevel}) && volConfirmed (${volConfirmed}) => ${retest}`);
    } else {
      retest = previousCandle.HighPrice >= breakoutLevel && latestCandle.ClosePrice < breakoutLevel && volConfirmed;
      console.log(`[${symbol}] Retest logic (SHORT): prev.high (${previousCandle.HighPrice}) >= breakoutLevel (${breakoutLevel}) && latest.close (${latestCandle.ClosePrice}) < breakoutLevel (${breakoutLevel}) && volConfirmed (${volConfirmed}) => ${retest}`);
    }

    const MAX_BARS_WITHOUT_RETEST = 5;
    const barsSinceBreakout = symbolState[symbol].pendingRetest.barsSinceBreakout || 0;
    const round2 = x => Math.round(x * 100) / 100;

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

      let rawTarget = direction === 'long'
        ? entry + (entry - stop) * MIN_RRR
        : entry - (stop - entry) * MIN_RRR;

      const target = round2(
        direction === 'long'
          ? Math.max(entry + MIN_TP_DIST, Math.min(rawTarget, entry + MAX_TP_DIST))
          : Math.min(entry - MIN_TP_DIST, Math.max(rawTarget, entry - MAX_TP_DIST))
      );

      if (await hasOpenOrder(symbol)) {
        console.log(`[${symbol}] Retest timeout entry skipped: open order detected.`);
        return;
      }

      try {
        console.log(`[${symbol}] Placing market order after retest timeout: direction=${direction}, entry=${entry}, stop=${stop}, target=${target}`);
        await placeBracketOrder(symbol, direction, entry, stop, target);
        symbolState[symbol].inPosition = true;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        symbolState[symbol].hasTradedToday = true;
        symbolState[symbol].lastTradeDate = today;
        await syncInPositionWithAlpaca(symbol);
        console.log(`[${symbol}] Market order placed after retest timeout and state updated.`);
      } catch (error) {
        symbolState[symbol].inPosition = false;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        await syncInPositionWithAlpaca(symbol);
        console.error(`[${symbol}] Error placing order (retest timeout):`, error, error?.response?.data);
      }
      return;
    }

    if (retest) {
      if (symbolState[symbol].inPosition) {
        console.log(`[${symbol}] Retest entry skipped: already in position.`);
        return;
      }
      console.log(`[${symbol}] ✅ RETEST TRADE SETUP:`);
      console.log(`[${symbol}] - Direction: ${direction.toUpperCase()}`);
      
      const entry = round2(latestCandle.ClosePrice);
      const atr = await getATR(symbol, 5);
      
      console.log(`[${symbol}] - Entry: $${entry}, Time: ${moment().tz('America/New_York').format('YYYY-MM-DD HH:mm:ss')} ET`);
      console.log(`[${symbol}] - Breakout Level: $${breakoutLevel}`);
      const rawStop = direction === 'long'
        ? latestCandle.LowPrice - atr * ATR_MULTIPLIER
        : latestCandle.HighPrice + atr * ATR_MULTIPLIER;

      const stop = round2(
        direction === 'long'
          ? Math.min(latestCandle.LowPrice - MIN_STOP_DIST, Math.max(rawStop, latestCandle.LowPrice - MAX_STOP_DIST))
          : Math.max(latestCandle.HighPrice + MIN_STOP_DIST, Math.min(rawStop, latestCandle.HighPrice + MAX_STOP_DIST))
      );

      let rawTarget = direction === 'long'
        ? entry + (entry - stop) * MIN_RRR
        : entry - (stop - entry) * MIN_RRR;

      const target = round2(
        direction === 'long'
          ? Math.max(entry + MIN_TP_DIST, Math.min(rawTarget, entry + MAX_TP_DIST))
          : Math.min(entry - MIN_TP_DIST, Math.max(rawTarget, entry - MAX_TP_DIST))
      );

      console.log(`[${symbol}] - Stop: $${stop}, Target: $${target}`);
      console.log(`[${symbol}] - Risk/Reward: ${((Math.abs(target - entry)) / (Math.abs(entry - stop))).toFixed(2)}:1`);

      if (await hasOpenOrder(symbol)) {
        console.log(`[${symbol}] Retest entry skipped: open order detected.`);
        return;
      }

      try {
        console.log(`[${symbol}] Placing retest order...`);
        await placeBracketOrder(symbol, direction, entry, stop, target);
        symbolState[symbol].inPosition = true;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        symbolState[symbol].hasTradedToday = true;
        symbolState[symbol].lastTradeDate = today;
        symbolState[symbol].tradeType = 'retest';
        symbolState[symbol].lastTradeTime = new Date().toISOString();
        await syncInPositionWithAlpaca(symbol);
        
        // Log trade event
        logTradeEvent(`${symbol} RETEST ${direction.toUpperCase()} - Entry: ${entry}, Stop: ${stop}, Target: ${target}, RR: ${((target - entry) / (entry - stop)).toFixed(2)}:1`);
        console.log(`[${symbol}] ✅ Retest trade order placed and state updated.`);
      } catch (error) {
        symbolState[symbol].inPosition = false;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        await syncInPositionWithAlpaca(symbol);
        console.error(`[${symbol}] Error placing order after successful retest:`, error, error?.response?.data);
      }
    }
  } catch (fetchError) {
    // Silent fail for optimization
  }
}

// --- Close Position Helper ---
async function closePosition(symbol, retries = 2) {
  try {
    await withRetry(() => alpaca.closePosition(symbol));
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = false;
    await syncInPositionWithAlpaca(symbol);
  } catch (error) {
    if ((error.response && error.response.status === 504) && retries > 0) {
      await sleep(2000);
      return closePosition(symbol, retries - 1);
    }
    if (error.response && error.response.status === 404) {
      // No open position to close
    } else {
      console.error(`[${symbol}] Error closing position:`, error, error?.response?.data);
    }
  }
}

// --- Volume Filter Statistics ---
function getVolumeFilterStats(symbol) {
  const state = symbolState[symbol];
  if (!state) return null;
  
  return {
    symbol,
    orbHigh: state.orbHigh,
    orbLow: state.orbLow,
    hasTradedToday: state.hasTradedToday || false,
    tradeType: state.tradeType || 'none',
    inPosition: state.inPosition || false,
    pendingRetest: !!state.pendingRetest,
    lastTradeDate: state.lastTradeDate
  };
}

// --- Trade spacing and cooldown management ---
const TRADE_COOLDOWN_MINUTES = process.env.TRADE_COOLDOWN_MINUTES 
  ? Number(process.env.TRADE_COOLDOWN_MINUTES) 
  : 5; // 5-minute cooldown between trades

function canPlaceNewTrade(symbol) {
  const state = symbolState[symbol];
  if (!state || !state.lastTradeTime) return true;
  
  const now = moment().tz('America/New_York');
  const lastTrade = moment(state.lastTradeTime);
  const minutesSinceLastTrade = now.diff(lastTrade, 'minutes');
  
  if (minutesSinceLastTrade < TRADE_COOLDOWN_MINUTES) {
    console.log(`[${symbol}] Trade cooldown active: ${minutesSinceLastTrade}/${TRADE_COOLDOWN_MINUTES} minutes`);
    return false;
  }
  
  return true;
}

// --- Trend Analysis ---
async function getTrendConfirmation(symbol, direction) {
  try {
    const now = moment().tz('America/New_York');
    const start = now.clone().subtract(30, 'minutes').toISOString();
    
    const bars = await withRetry(() => alpaca.getBarsV2(symbol, {
      timeframe: '5Min',
      start,
      end: now.toISOString(),
      feed: 'iex'
    }, alpaca.configuration));

    const candles = [];
    for await (let c of bars) candles.push(c);
    
    if (candles.length < 4) return true; // Not enough data, allow trade
    
    // Calculate simple moving average trend
    const recent4 = candles.slice(-4);
    const prices = recent4.map(c => c.ClosePrice);
    const avgEarly = (prices[0] + prices[1]) / 2;
    const avgRecent = (prices[2] + prices[3]) / 2;
    
    const trendUp = avgRecent > avgEarly;
    const trendConfirmed = (direction === 'long' && trendUp) || (direction === 'short' && !trendUp);
    
    console.log(`[${symbol}] Trend analysis: ${direction} trade ${trendConfirmed ? 'CONFIRMED' : 'AGAINST'} trend (Recent: ${avgRecent.toFixed(2)}, Earlier: ${avgEarly.toFixed(2)})`);
    
    return trendConfirmed;
  } catch (error) {
    console.error(`[${symbol}] Error in trend analysis:`, error.message);
    return true; // Default to allowing trade if analysis fails
  }
}

// --- Market Structure Analysis ---
async function getMarketStructure(symbol) {
  try {
    const now = moment().tz('America/New_York');
    const start = now.clone().subtract(60, 'minutes').toISOString();
    
    const bars = await withRetry(() => alpaca.getBarsV2(symbol, {
      timeframe: '5Min',
      start,
      end: now.toISOString(),
      feed: 'iex'
    }, alpaca.configuration));

    const candles = [];
    for await (let c of bars) candles.push(c);
    
    if (candles.length < 8) return { strength: 'neutral', confidence: 0 };
    
    // Higher highs/Higher lows for uptrend, Lower highs/Lower lows for downtrend
    const recent = candles.slice(-6);
    let upCount = 0;
    let downCount = 0;
    
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].HighPrice > recent[i-1].HighPrice && recent[i].LowPrice > recent[i-1].LowPrice) {
        upCount++;
      } else if (recent[i].HighPrice < recent[i-1].HighPrice && recent[i].LowPrice < recent[i-1].LowPrice) {
        downCount++;
      }
    }
    
    const totalBars = recent.length - 1;
    const upPercentage = upCount / totalBars;
    const downPercentage = downCount / totalBars;
    
    let structure = 'neutral';
    let confidence = 0;
    
    if (upPercentage >= 0.6) {
      structure = 'bullish';
      confidence = upPercentage;
    } else if (downPercentage >= 0.6) {
      structure = 'bearish';
      confidence = downPercentage;
    }
    
    console.log(`[${symbol}] Market structure: ${structure} (confidence: ${(confidence * 100).toFixed(1)}%)`);
    
    return { strength: structure, confidence };
  } catch (error) {
    console.error(`[${symbol}] Error in market structure analysis:`, error.message);
    return { strength: 'neutral', confidence: 0 };
  }
}

// --- Performance Tracking ---
const performanceStats = {
  totalTrades: 0,
  breakoutTrades: 0,
  retestTrades: 0,
  filteredTrades: {
    volume: 0,
    trend: 0,
    structure: 0,
    cooldown: 0
  },
  dailyReset: moment().tz('America/New_York').format('YYYY-MM-DD')
};

function trackFilteredTrade(symbol, reason) {
  if (performanceStats.dailyReset !== moment().tz('America/New_York').format('YYYY-MM-DD')) {
    // Reset daily stats
    Object.keys(performanceStats.filteredTrades).forEach(key => {
      performanceStats.filteredTrades[key] = 0;
    });
    performanceStats.totalTrades = 0;
    performanceStats.breakoutTrades = 0;
    performanceStats.retestTrades = 0;
    performanceStats.dailyReset = moment().tz('America/New_York').format('YYYY-MM-DD');
  }
  
  if (performanceStats.filteredTrades[reason] !== undefined) {
    performanceStats.filteredTrades[reason]++;
  }
  
  console.log(`[${symbol}] Trade filtered: ${reason}. Daily filter stats:`, performanceStats.filteredTrades);
}

function trackSuccessfulTrade(symbol, type) {
  performanceStats.totalTrades++;
  if (type === 'breakout') {
    performanceStats.breakoutTrades++;
  } else if (type === 'retest') {
    performanceStats.retestTrades++;
  }
  
  console.log(`[${symbol}] Trade executed: ${type}. Daily stats: Total=${performanceStats.totalTrades}, Breakouts=${performanceStats.breakoutTrades}, Retests=${performanceStats.retestTrades}`);
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
  syncAllPositionsWithAlpaca,
  resetDailyTradeFlags,
  getVolumeFilterStats,
  getTrendConfirmation,
  getMarketStructure,
  performanceStats,
  trackFilteredTrade,
  trackSuccessfulTrade
};