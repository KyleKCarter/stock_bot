// const Alpaca = require('@alpacahq/alpaca-trade-api'); // REMOVE Alpaca SDK
const axios = require('axios');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const ibkrAuth = require('../controllers/ibkrAuth');

const IBKR_GATEWAY = process.env.IBKR_GATEWAY || 'https://localhost:5000/v1/api';

const logFile = path.join(__dirname, 'trade_events.log');

function logTradeEvent(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

const ORB_DURATION_MINUTES = 15;
const MIN_RRR = 2;
const MIN_STOP_DIST = 0.5;
const MAX_STOP_DIST = 3.0;
const ATR_MULTIPLIER = 0.5;

const symbolState = {}; // { [symbol]: { orbHigh, orbLow, inPosition, ... } }

// --- Caching ---
let cachedAccountId = null;
const conidCache = {};

// --- Utility Functions ---

function calculatePositionSize(accountEquity, riskPercent, entry, stop) {
  const riskAmount = accountEquity * riskPercent;
  const perShareRisk = Math.abs(entry - stop);
  if (perShareRisk < 0.01) return 1;
  let size = Math.floor(riskAmount / perShareRisk);
  const MAX_SIZE = 20;
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

// --- Retry Wrapper ---
async function withRetry(fn, retries = 2) {
  try {
    return await fn();
  } catch (err) {
    if (
      retries > 0 &&
      (!err.response || err.response.status >= 500 || err.code === 'ECONNABORTED')
    ) {
      await sleep(1000);
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

// --- IBKR Helper: Get Account ID (cached) ---
async function getAccountId() {
  if (cachedAccountId) return cachedAccountId;
  try {
    const accessToken = ibkrAuth.getAccessToken();
    const res = await axios.get(
      `${IBKR_GATEWAY}/iserver/accounts`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    cachedAccountId = Array.isArray(res.data) ? res.data[0] : res.data.accounts[0];
    return cachedAccountId;
  } catch (err) {
    console.error('Error fetching IBKR accountId:', err?.response?.data || err.message);
    throw err;
  }
}

// --- IBKR Helper: Resolve conid (cached) ---
async function resolveConid(symbol) {
  if (conidCache[symbol]) return conidCache[symbol];
  try {
    const accessToken = ibkrAuth.getAccessToken();
    const res = await axios.get(
      `${IBKR_GATEWAY}/iserver/secdef/search?symbol=${symbol}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const conid = res.data[0]?.conid;
    if (conid) {
      conidCache[symbol] = conid;
      return conid;
    }
    throw new Error(`No conid found for symbol ${symbol}`);
  } catch (err) {
    console.error(`Error resolving conid for ${symbol}:`, err?.response?.data || err.message);
    return null;
  }
}

// --- IBKR Helper: Get Account Info ---
async function getAccountInfo() {
  return withRetry(async () => {
    const accessToken = ibkrAuth.getAccessToken();
    const accountId = await getAccountId();
    const summary = await axios.get(
      `${IBKR_GATEWAY}/portfolio/${accountId}/summary`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return {
      equity: summary.data.totalEquity || summary.data.NetLiquidation || 100000
    };
  });
}

// --- IBKR Helper: Get Positions ---
async function getPositions() {
  return withRetry(async () => {
    const accessToken = ibkrAuth.getAccessToken();
    const accountId = await getAccountId();
    const posRes = await axios.get(
      `${IBKR_GATEWAY}/portfolio/${accountId}/positions/0`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return posRes.data.map(p => ({
      symbol: p.ticker,
      qty: p.position,
      conid: p.conid
    }));
  });
}

// --- IBKR Helper: Get Bars (historical candles) ---
async function getBars(symbol, timeframe, start, end) {
  return withRetry(async () => {
    const accessToken = ibkrAuth.getAccessToken();
    const conid = await resolveConid(symbol);
    if (!conid) return [];
    // IBKR supports 1min, 5min, 15min, 1d, etc.
    const barSize = timeframe.toLowerCase();
    // Calculate period string for IBKR (e.g., '1d', '2w', etc.)
    // For now, use '1d' for daily, '1w' for weekly, etc.
    const period = '1d';
    const res = await axios.get(
      `${IBKR_GATEWAY}/iserver/marketdata/history`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          conid,
          period,
          bar: barSize,
          exchange: 'SMART'
        }
      }
    );
    if (!res.data || !res.data.data) return [];
    return res.data.data.map(b => ({
      timestamp: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
      volume: b.v
    }));
  });
}

// --- IBKR Helper: Place Order ---
async function placeOrder(orderPayload) {
  return withRetry(async () => {
    const accessToken = ibkrAuth.getAccessToken();
    const accountId = await getAccountId();
    const orderRes = await axios.post(
      `${IBKR_GATEWAY}/iserver/account/${accountId}/orders`,
      [orderPayload], // IBKR expects an array of orders
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return orderRes.data[0];
  });
}

// --- IBKR Helper: Get Open Orders ---
async function getOpenOrders(symbol) {
  return withRetry(async () => {
    const accessToken = ibkrAuth.getAccessToken();
    const accountId = await getAccountId();
    const ordersRes = await axios.get(
      `${IBKR_GATEWAY}/iserver/account/${accountId}/orders`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    // Filter by symbol if needed
    return ordersRes.data.filter(o => o.ticker === symbol);
  });
}

// --- IBKR Helper: Close Position ---
async function closePositionIBKR(symbol) {
  return withRetry(async () => {
    const accessToken = ibkrAuth.getAccessToken();
    const accountId = await getAccountId();
    const conid = await resolveConid(symbol);
    if (!conid) throw new Error(`Cannot close position: conid not found for ${symbol}`);
    // Get position size and side
    const positions = await getPositions();
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos || !pos.qty) throw new Error(`No open position for ${symbol}`);
    const side = pos.qty > 0 ? 'SELL' : 'BUY';
    const quantity = Math.abs(pos.qty);
    const orderPayload = {
      conid,
      secType: 'STK',
      orderType: 'MKT',
      side,
      quantity,
      tif: 'DAY'
    };
    return await placeOrder(orderPayload);
  });
}

// --- ATR Calculation ---
async function getATR(symbol, period = 5) {
  const now = moment().tz('America/New_York');
  const start = now.clone().subtract(period * 5, 'minutes').toISOString();
  const candles = await getBars(symbol, '5min', start, now.toISOString());
  if (candles.length < period + 1) return 0.5;

  let atr = 0;
  for (let i = 1; i <= period; i++) {
    const high = candles[candles.length - i].high;
    const low = candles[candles.length - i].low;
    const prevClose = candles[candles.length - i - 1].close;
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

  const candles = await getBars(symbol, '5min', start, end);

  if (!candles.length) {
    console.error(`[${symbol}] No bars found for ORB range. ORB not set.`);
    return;
  }

  const orbWindow = candles.filter(c =>
    new Date(c.timestamp) >= orbStart.toDate() &&
    new Date(c.timestamp) <= orbEnd.toDate()
  );

  const orbHigh = Math.max(...orbWindow.map(c => c.high));
  const orbLow = Math.min(...orbWindow.map(c => c.low));

  symbolState[symbol] = symbolState[symbol] || {};
  symbolState[symbol].orbHigh = orbHigh;
  symbolState[symbol].orbLow = orbLow;
  symbolState[symbol].inPosition = false;
  symbolState[symbol].pendingRetest = null;

  console.log(`[${symbol}] ORB High: ${symbolState[symbol].orbHigh}, ORB Low: ${symbolState[symbol].orbLow}`);
}

// --- State Sync Helpers ---

async function syncAllPositionsWithIBKR(symbols, symbolState) {
  try {
    const positions = await getPositions();
    for (const symbol of symbols) {
      const pos = positions.find(p => p.symbol === symbol);
      symbolState[symbol] = symbolState[symbol] || {};
      symbolState[symbol].inPosition = !!pos;
      if (pos) {
        console.log(`[${symbol}] Synced inPosition with IBKR: true`);
      } else {
        console.log(`[${symbol}] Synced inPosition with IBKR: false`);
      }
    }
  } catch (error) {
    console.error('Error syncing all positions:', error?.response?.data || error.message);
  }
}

async function syncInPositionWithIBKR(symbol, retries = 2) {
  try {
    const positions = await getPositions();
    const pos = positions.find(p => p.symbol === symbol);
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = !!pos && Number(pos.qty) > 0;
    console.log(`[${symbol}] Synced inPosition with IBKR:`, symbolState[symbol].inPosition);
  } catch (err) {
    if (retries > 0) {
      console.warn(`[${symbol}] Error syncing inPosition. Retrying... (${retries} left)`);
      await sleep(2000);
      return syncInPositionWithIBKR(symbol, retries - 1);
    }
    symbolState[symbol] = symbolState[symbol] || {};
    symbolState[symbol].inPosition = false;
    console.error(`[${symbol}] Error syncing inPosition:`, err, err?.response?.data);
  }
}

async function hasOpenOrder(symbol) {
  try {
    const orders = await getOpenOrders(symbol);
    console.log(`[${symbol}] Open orders:`, orders.map(o => ({
      id: o.id, status: o.status, side: o.side, type: o.type
    })));
    return orders.some(order =>
      (order.status === 'Submitted' || order.status === 'PreSubmitted')
    );
  } catch (error) {
    console.error(`[${symbol}] Error checking open orders:`, error, error?.response?.data);
    return false;
  }
}

async function monitorBreakout(symbol) {
  await syncInPositionWithIBKR(symbol);
  symbolState[symbol] = symbolState[symbol] || {};

  if (!symbolState[symbol] || symbolState[symbol].orbHigh == null || symbolState[symbol].orbLow == null) {
    console.log(`[${symbol}] ORB range not set. Skipping breakout monitoring.`);
    return;
  }

  const today = moment().tz('America/New_York').format('YYYY-MM-DD');
  const now = moment().tz('America/New_York');
  const cutoff = moment().tz('America/New_York').hour(14).minute(0).second(0);

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
  const candles = await getBars(symbol, '5min', sessionStart.toISOString(), now.toISOString());

  candles.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const orbBars = candles.filter(c =>
    new Date(c.timestamp) >= sessionStart.toDate() &&
    new Date(c.timestamp) <= orbEnd.toDate()
  );

  const orbEndTime = Math.max(...orbBars.map(c => new Date(c.timestamp).getTime()));
  const postORB = candles.filter(c => new Date(c.timestamp).getTime() > orbEndTime);

  if (postORB.length < 1) {
    console.log(`[${symbol}] Not enough post-ORB bars for breakout monitoring.`);
    return;
  }

  const recent = postORB.length > 4
    ? postORB.slice(1, -1).slice(-3)
    : postORB.slice(-4, -1);
  const latest = postORB[postORB.length - 1];

  if (!latest) {
    console.log(`[${symbol}] No latest post-ORB bar.`);
    return;
  }

  let volConfirmed = true;
  let avgVol = 0;
  let medianVol = 0;

  if (recent.length >= 1) {
    avgVol = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
    const sortedVols = recent.map(c => c.volume).sort((a, b) => a - b);
    medianVol = sortedVols.length % 2 === 0
      ? (sortedVols[sortedVols.length / 2 - 1] + sortedVols[sortedVols.length / 2]) / 2
      : sortedVols[Math.floor(sortedVols.length / 2)];
    volConfirmed = latest.volume > avgVol * 1.2;
    console.log(`[${symbol}] Recent post-ORB volumes:`, recent.map(c => c.volume));
    console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.volume);
    console.log(`[${symbol}] Avg vol: ${avgVol.toFixed(2)}, Median vol: ${medianVol.toFixed(2)}`);
  } else {
    console.log(`[${symbol}] Only one post-ORB bar, skipping volume filter.`);
    console.log(`[${symbol}] Latest post-ORB bar volume:`, latest.volume);
  }

  let breakout = null;
  if (latest.close > symbolState[symbol].orbHigh && volConfirmed) {
    breakout = { direction: 'long', close: latest.close };
  } else if (latest.close < symbolState[symbol].orbLow && volConfirmed) {
    breakout = { direction: 'short', close: latest.close };
  }

  if (breakout) {
    const round2 = x => Math.round(x * 100) / 100;
    const entry = round2(latest.close);

    const atr = await getATR(symbol, 5);
    let rawStop = breakout.direction === 'long'
      ? latest.low - atr * ATR_MULTIPLIER
      : latest.high + atr * ATR_MULTIPLIER;
    let stop = round2(
      breakout.direction === 'long'
        ? Math.min(latest.low - MIN_STOP_DIST, Math.max(rawStop, latest.low - MAX_STOP_DIST))
        : Math.max(latest.high + MIN_STOP_DIST, Math.min(rawStop, latest.high + MAX_STOP_DIST))
    );
    const target = round2(
      breakout.direction === 'long'
        ? entry + (entry - stop) * MIN_RRR
        : entry - (stop - entry) * MIN_RRR
    );

    console.log(`[${symbol}] ATR(5): ${atr.toFixed(2)} | Using stop: ${stop} | Entry: ${entry} | Target: ${target}`);
    logTradeEvent(`${symbol} breakout detected at ${latest.close} (${breakout.direction}), ATR(5): ${atr.toFixed(2)}, stop: ${stop}, target: ${target}`);

    if (!symbolState[symbol].inPosition && !(await hasOpenOrder(symbol))) {
      // Prepare IBKR order payload
      const conid = await resolveConid(symbol);
      if (!conid) {
        console.error(`[${symbol}] Could not resolve conid for order placement.`);
        return;
      }
      const account = await getAccountInfo();
      const qty = calculatePositionSize(Number(account.equity), 0.01, entry, stop);
      const side = breakout.direction === 'long' ? 'BUY' : 'SELL';

      const orderPayload = {
        conid,
        secType: 'STK',
        orderType: 'LMT',
        price: entry,
        side,
        quantity: qty,
        tif: 'DAY'
        // Add bracket logic if supported by IBKR
      };

      await placeOrder(orderPayload);
      logTradeEvent(`${symbol} bracket order placed: entry=${entry}, stop=${stop}, target=${target}`);
      symbolState[symbol].inPosition = true;
      symbolState[symbol].pendingRetest = null;
      symbolState[symbol].barsSinceBreakout = 0;
      symbolState[symbol].hasTradedToday = true;
      symbolState[symbol].lastTradeDate = today;
      symbolState[symbol].tradeType = 'breakout';
      await syncInPositionWithIBKR(symbol);
      console.log(`[${symbol}] Entered trade on breakout bar.`);
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
  await syncInPositionWithIBKR(symbol);
  console.log(`[${symbol}] DEBUG checkRetestAndTrade input:`, JSON.stringify(retestObj));
  await syncInPositionWithIBKR(symbol);

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
  const cutoff = moment().tz('America/New_York').hour(14).minute(0).second(0);
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
    const bars = await getBars(symbol, '1min', from, to);

    if (bars.length < 2) {
      console.log(`[${symbol}] Not enough candles to evaluate retest.`);
      return;
    }

    const previousCandle = bars[bars.length - 2];
    const latestCandle = bars[bars.length - 1];

    let retest = false;
    if (direction === 'long') {
      retest = previousCandle.low <= breakoutLevel && latestCandle.close > breakoutLevel;
      console.log(`[${symbol}] Long retest logic: prev.low (${previousCandle.low}) <= breakoutLevel (${breakoutLevel}) && latest.close (${latestCandle.close}) > breakoutLevel (${breakoutLevel}) => ${retest}`);
    } else {
      retest = previousCandle.high >= breakoutLevel && latestCandle.close < breakoutLevel;
      console.log(`[${symbol}] Short retest logic: prev.high (${previousCandle.high}) >= breakoutLevel (${breakoutLevel}) && latest.close (${latestCandle.close}) < breakoutLevel (${breakoutLevel}) => ${retest}`);
    }

    const MAX_BARS_WITHOUT_RETEST = 5;
    const barsSinceBreakout = symbolState[symbol].pendingRetest.barsSinceBreakout || 0;
    const round2 = x => Math.round(x * 100) / 100;

    // --- Timeout entry logic ---
    if (!retest && barsSinceBreakout >= MAX_BARS_WITHOUT_RETEST && !symbolState[symbol].inPosition) {
      console.log(`[${symbol}] No retest after ${MAX_BARS_WITHOUT_RETEST} bars. Entering trade at market.`);
      const entry = round2(latestCandle.close);
      const atr = await getATR(symbol, 5);
      const rawStop = direction === 'long'
        ? latestCandle.low - atr * ATR_MULTIPLIER
        : latestCandle.high + atr * ATR_MULTIPLIER;

      const stop = round2(
        direction === 'long'
          ? Math.min(latestCandle.low - MIN_STOP_DIST, Math.max(rawStop, latestCandle.low - MAX_STOP_DIST))
          : Math.max(latestCandle.high + MIN_STOP_DIST, Math.min(rawStop, latestCandle.high + MAX_STOP_DIST))
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
        const conid = await resolveConid(symbol);
        if (!conid) {
          console.error(`[${symbol}] Could not resolve conid for order placement.`);
          return;
        }
        const account = await getAccountInfo();
        const qty = calculatePositionSize(Number(account.equity), 0.01, entry, stop);
        const side = direction === 'long' ? 'BUY' : 'SELL';

        const orderPayload = {
          conid,
          secType: 'STK',
          orderType: 'MKT',
          price: entry,
          side,
          quantity: qty,
          tif: 'DAY'
        };

        await placeOrder(orderPayload);
        symbolState[symbol].inPosition = true;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        symbolState[symbol].hasTradedToday = true;
        symbolState[symbol].lastTradeDate = today;
        console.log(`[${symbol}] Timeout entry: Market order submitted and state updated.`);
        await syncInPositionWithIBKR(symbol);
      } catch (error) {
        symbolState[symbol].inPosition = false;
        symbolState[symbol].pendingRetest = null;
        symbolState[symbol].barsSinceBreakout = 0;
        console.error(`[${symbol}] Error placing order (retest):`, error, error?.response?.data);
        await syncInPositionWithIBKR(symbol);
      }
      return;
    }

    // --- Retest confirmed logic ---
    if (retest) {
      logTradeEvent(`${symbol} successful retest at ${latestCandle.close} (${direction})`);
      if (symbolState[symbol].inPosition) {
        console.log(`[${symbol}] Skipping order: already in position.`);
      } else {
        console.log(`[${symbol}] Retest confirmed (${direction}) at ${breakoutLevel}. Entering trade.`);
        const entry = round2(latestCandle.close);
        const atr = await getATR(symbol, 5);
        const rawStop = direction === 'long'
          ? latestCandle.low - atr * ATR_MULTIPLIER
          : latestCandle.high + atr * ATR_MULTIPLIER;

        const stop = round2(
          direction === 'long'
            ? Math.min(latestCandle.low - MIN_STOP_DIST, Math.max(rawStop, latestCandle.low - MAX_STOP_DIST))
            : Math.max(latestCandle.high + MIN_STOP_DIST, Math.min(rawStop, latestCandle.high + MAX_STOP_DIST))
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
          const conid = await resolveConid(symbol);
          if (!conid) {
            console.error(`[${symbol}] Could not resolve conid for order placement.`);
            return;
          }
          const account = await getAccountInfo();
          const qty = calculatePositionSize(Number(account.equity), 0.01, entry, stop);
          const side = direction === 'long' ? 'BUY' : 'SELL';

          const orderPayload = {
            conid,
            secType: 'STK',
            orderType: 'MKT',
            price: entry,
            side,
            quantity: qty,
            tif: 'DAY'
          };

          await placeOrder(orderPayload);
          logTradeEvent(`${symbol} market order placed: entry=${entry}, stop=${stop}, target=${target}`);
          symbolState[symbol].inPosition = true;
          symbolState[symbol].pendingRetest = null;
          symbolState[symbol].barsSinceBreakout = 0;
          symbolState[symbol].hasTradedToday = true;
          symbolState[symbol].lastTradeDate = today;
          symbolState[symbol].tradeType = 'retest';
          console.log(`[${symbol}] Market order submitted and state updated.`);
          await syncInPositionWithIBKR(symbol);
        } catch (error) {
          symbolState[symbol].inPosition = false;
          symbolState[symbol].pendingRetest = null;
          symbolState[symbol].barsSinceBreakout = 0;
          console.error(`[${symbol}] Error placing order (retest):`, error, error?.response?.data);
          await syncInPositionWithIBKR(symbol);
        }
      }
    } else {
      console.log(`[${symbol}] No retest confirmation for ${direction} at ${breakoutLevel}.`);
    }
  } catch (fetchError) {
    console.error(`[${symbol}] Error fetching bars with getBars:`, fetchError?.response?.data || fetchError.message);
  }
}

// --- Exports ---

module.exports = {
  getORBRange,
  monitorBreakout, // You must update this to use IBKR helpers
  placeOrder,
  calculatePositionSize,
  checkRetestAndTrade, // You must update this to use IBKR helpers
  closePosition: closePositionIBKR,
  symbolState,
  syncInPositionWithIBKR,
  syncAllPositionsWithIBKR,
  resetDailyTradeFlags,
  getAccountInfo,
  getPositions,
  getBars,
  resolveConid
};