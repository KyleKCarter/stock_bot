require('dotenv').config();
const cron = require('node-cron');
const ORBStockBot = require('./openingRangeBreakout');

let isRunning = false; // Lock flag

const ORDER_QTY = process.env.ORDER_QTY ? Number(process.env.ORDER_QTY) : 2;
const stopLossPercent = process.env.STOP_LOSS ? Number(process.env.STOP_LOSS) : 0.01;
const riskRewardRatio = process.env.RISK_REWARD ? Number(process.env.RISK_REWARD) : 3;

const symbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMD', 'AMZN', 'META', 'MSFT']; // symbols
    // const symbols = ['SPY', 'QQQ', 'TSLA', 'NVDA']; // Today's symbols for testing

cron.schedule('30-44 9 * * 1-5', async () => {
    if (isRunning) {
        console.log("Previous ORB task still running, skipping this run.");
        return; // Exit if already running
    }

    isRunning = true; // Set lock to prevent concurrent runs

    try {
        for (const symbol of symbols) {
                    try {
                        const openingRange = await ORBStockBot.getOpeningRange(symbol);
                        await ORBStockBot.monitorBreakout(symbol, openingRange, ORDER_QTY, stopLossPercent, riskRewardRatio);
                    } catch (error) {
                        console.error("Error running opening range breakout:", error);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid rate limits
                }
    } finally {
        isRunning = false; // Release lock after completion
    }
}, { timezone: 'America/New_York' }); // Runs every weekday at 9:30 AM EST

// Close all positions at 10:00 AM EST
cron.schedule('00 10 * * 1-5', async () => {

    try {
        for (const symbol of symbols) {
            await ORBStockBot.closePosition(symbol);
        }
    } catch (error) {
        console.error("Error closing positions:", error);
    }

    console.log("All positions closed at 10:00 AM EST.");
}, { timezone: 'America/New_York' }); // Runs every weekday at 10:00 AM EST

console.log("ORB Worker started and waiting for scheduled tasks.");
