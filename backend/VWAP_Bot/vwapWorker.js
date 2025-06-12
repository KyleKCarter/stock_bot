require('dotenv').config();
const cron = require('node-cron');
const { checkVWAPPullback, closePosition } = require('./vwapBot');

const symbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMD', 'AMZN', 'META', 'MSFT']; // Example symbols
// const symbols = ['SPY', 'QQQ', 'TSLA', 'NVDA']; // Today's symbols for testing

const STOP_LOSS = process.env.STOP_LOSS_VWAP ? Number(process.env.STOP_LOSS_VWAP) : 0.01;
const RISK_REWARD = process.env.RISK_REWARD_VWAP ? Number(process.env.RISK_REWARD_VWAP) : 3;

console.log("VWAP Worker started and schedules set.");

const runForAllSymbols = async () => {
    for (const symbol of symbols) {
        try {
            await checkVWAPPullback(symbol, STOP_LOSS, RISK_REWARD);
        } catch (error) {
            console.error(`Error processing ${symbol}:`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid rate limits
    }
}

// 9:30-9:59 AM weekdays
cron.schedule('30-59 9 * * 1-5', async () => {
    console.log('Running VWAP bot (9:30–9:59 AM)');
    await runForAllSymbols()
}, { timezone: 'America/New_York' });

// 10:00 AM–2:59 PM weekdays
cron.schedule('0-59 10-14 * * 1-5', async () => {
    console.log('Running VWAP bot (10:00 AM-3:59 PM)');
    await runForAllSymbols()
}, { timezone: 'America/New_York' });

// 3:00–3:58 PM weekdays
cron.schedule('0-58 15 * * 1-5', async () => {
    console.log('Running VWAP bot (10:00 AM-3:59 PM)');
    await runForAllSymbols()
}, { timezone: 'America/New_York' });

// 4:28 PM weekdays
cron.schedule('28 16 * * 1-5', async () => {
    console.log('Closing all positions before market close');
    for (const symbol of symbols) {
        try {
            await closePosition(symbol);
        } catch (error) {
            console.error(`Error closing position for ${symbol}:`, error.message);
        }
    }
}, { timezone: 'America/New_York' });