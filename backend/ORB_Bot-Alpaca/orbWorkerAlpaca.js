// Load environment configurations
require('dotenv').config({ path: '../.env' });           // Main backend config
require('dotenv').config({ path: './.env.enhanced' });   // ORB-specific enhanced config

const cron = require('node-cron');
const moment = require('moment-timezone');
const ORBStockBot = require('./orb-bot-alpaca'); // Import the ORBStockBot class

let isRunning = false; // Lock flag

const ORDER_QTY = process.env.ORDER_QTY ? Number(process.env.ORDER_QTY) : 5;
const stopLossPercent = process.env.STOP_LOSS ? Number(process.env.STOP_LOSS) : 0.01;
const riskRewardRatio = process.env.RISK_REWARD ? Number(process.env.RISK_REWARD) : 3;

const symbols = ['SPY', 'QQQ', 'TSLA', 'NVDA', 'AMD']; // Today's symbols for testing

const orbReady = {}; // { [symbol]: true/false }

// Helper to calculate ORB range for a specific window
async function setORBRangeForWindow(symbol, startHour, startMinute, endHour, endMinute) {
    try {
        console.log(`[${symbol}] Setting ORB range for ${startHour}:${startMinute} - ${endHour}:${endMinute}`);
        await ORBStockBot.getORBRange(symbol, startHour, startMinute, endHour, endMinute);
        orbReady[symbol] = true;
        console.log(`[${symbol}] ORB range set for ${startHour}:${startMinute.toString().padStart(2, '0')} - ${endHour}:${endMinute.toString().padStart(2, '0')}`);
    } catch (error) {
        orbReady[symbol] = false;
        console.error(`[${symbol}] Error calculating ORB range for window:`, error);
    }
}

// Market condition check before trading starts
cron.schedule('25 9 * * 1-5', async () => {
    console.log('\n=== PRE-MARKET CHECK ===');
    const now = moment().tz('America/New_York');
    console.log(`Date: ${now.format('YYYY-MM-DD')}`);
    console.log(`Symbols to monitor: ${symbols.join(', ')}`);
    console.log('ORB range will be calculated from 9:30-9:45 AM ET');
    console.log('Breakout monitoring starts at 9:46 AM ET');
    console.log('=== END PRE-MARKET CHECK ===\n');
}, { timezone: 'America/New_York' });

// Reset daily trade flags before market open (9:25 AM ET)
cron.schedule('28 9 * * 1-5', async () => {
    console.log('\n=== RESETTING DAILY FLAGS ===');
    ORBStockBot.resetDailyTradeFlags();
    
    // Reset orbReady flags for new day
    for (const symbol of symbols) {
        orbReady[symbol] = false;
    }
    
    console.log("Daily trade flags and ORB ready flags reset at 9:28 AM ET.");
    console.log('=== FLAGS RESET COMPLETE ===\n');
}, { timezone: 'America/New_York' });

// Schedule ORB range calculation at 9:30, 9:40, and 9:45 AM ET
const orbWindows = [
    { startHour: 9, startMinute: 30, endHour: 9, endMinute: 45 },
];

cron.schedule('45 9 * * 1-5', async () => {
    
    for (const symbol of symbols) {
        await setORBRangeForWindow(symbol, 9, 30, 9, 45);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}, { timezone: 'America/New_York' });

// On startup, retroactively set ORB ranges for all windows if missed
(async () => {
    const now = moment().tz('America/New_York');
    if (now.day() >= 1 && now.day() <= 5 && (now.hour() === 9 || now.hour() === 10)) {
        for (const [i, window] of orbWindows.entries()) {
            // Only set if the window's end time is before now
            const windowEnd = moment().tz('America/New_York').hour(window.endHour).minute(window.endMinute).second(0);
            if (now.isAfter(windowEnd)) {
                for (const symbol of symbols) {
                    if (!orbReady[symbol]) { // Only set if not already set
                        await setORBRangeForWindow(symbol, window.startHour, window.startMinute, window.endHour, window.endMinute);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        }
    }
})();

// Manual trigger to set ORB ranges for all symbols
(async () => {
    for (const [i, window] of orbWindows.entries()) {
        for (const symbol of symbols) {
            if (!orbReady[symbol]) {
                await setORBRangeForWindow(symbol, window.startHour, window.startMinute, window.endHour, window.endMinute);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
})();

// Sync inPosition state with Alpaca on startup
(async () => {
    console.log("Syncing inPosition state with Alpaca...");
    for (const symbol of symbols) {
        try {
            await ORBStockBot.syncInPositionWithAlpaca(symbol);
        } catch (err) {
            console.error(`[${symbol}] Error syncing inPosition on startup:`, err.message);
        }
    }
    console.log("Finished syncing inPosition state.");
})();

// Monitor for breakouts for each symbol every minute from 9:46 to 9:59 AM ET
cron.schedule('46-59 9 * * 1-5', async () => {

    if (isRunning) {
        console.log("Previous ORB task still running, skipping this run.");
        return;
    }
    isRunning = true;
    try {
        await Promise.all(symbols.map(async (symbol) => {
            if (!orbReady[symbol]) {
                console.log(`[${symbol}] ORB not ready, skipping breakout monitoring.`);
                return;
            }
            try {
                await ORBStockBot.monitorBreakout(symbol);
            } catch (error) {
                console.error(`[${symbol}] Error monitoring breakout:`, error);
            }
        }));
    } finally {
        isRunning = false;
    }
}, { timezone: 'America/New_York' });

// Monitor for breakouts for each symbol every minute from 10:00 AM to 1:59 PM ET
// Extended window for professional ORB trading - captures afternoon breakouts
cron.schedule('0-59 10-13 * * 1-5', async () => {

    if (isRunning) {
        console.log("Previous ORB task still running, skipping this run.");
        return;
    }
    isRunning = true;
    try {
        await Promise.all(symbols.map(async (symbol) => {
            if (!orbReady[symbol]) {
                console.log(`[${symbol}] ORB not ready, skipping breakout monitoring.`);
                return;
            }
            try {
                await ORBStockBot.monitorBreakout(symbol);
            } catch (error) {
                console.error(`[${symbol}] Error monitoring breakout:`, error);
            }
        }));
    } finally {
        isRunning = false;
    }
}, { timezone: 'America/New_York' });

// Retest monitor: checks for retest and trade every minute from 9:46 to 9:59 range
cron.schedule('46-59 9 * * 1-5', async () => { 
  await Promise.all(symbols.map(async (symbol) => {
        const state = ORBStockBot.symbolState[symbol];
        if (state && state.pendingRetest) {
            try {
                await ORBStockBot.checkRetestAndTrade(symbol, {
                    direction: state.pendingRetest.direction,
                    breakoutLevel: Number(state.pendingRetest.breakoutLevel)
                });
            } catch (error) {
                console.error(`[${symbol}] Error in retest monitor:`, error.message);
            }
        }
    }));
}, { timezone: 'America/New_York' });

// Retest monitor: checks for retest and trade every minute from 10:00 AM to 1:59 PM ET
// Extended retest window aligns with professional ORB practices
cron.schedule('0-59 10-13 * * 1-5', async () => { 
  await Promise.all(symbols.map(async (symbol) => {
        const state = ORBStockBot.symbolState[symbol];
        if (state && state.pendingRetest) {
            try {
                await ORBStockBot.checkRetestAndTrade(symbol, {
                    direction: state.pendingRetest.direction,
                    breakoutLevel: Number(state.pendingRetest.breakoutLevel)
                });
            } catch (error) {
                console.error(`[${symbol}] Error in retest monitor:`, error.message);
            }
        }
    }));
}, { timezone: 'America/New_York' });

// Close all positions at 4:00 PM ET
cron.schedule('00 16 * * 1-5', async () => {
    try {
        for (const symbol of symbols) {
            await ORBStockBot.closePosition(symbol);
        }
    } catch (error) {
        console.error("Error closing positions:", error);
    }
    console.log("All positions closed at 4:00 PM EST.");
}, { timezone: 'America/New_York' });

// Professional state logging every 30 minutes during market hours
cron.schedule('0,30 9-15 * * 1-5', async () => {
    console.log('\n=== ORB BOT STATUS REPORT ===');
    console.log(`Time: ${moment().tz('America/New_York').format('YYYY-MM-DD HH:mm:ss')} ET`);
    
    for (const symbol of symbols) {
        const state = ORBStockBot.symbolState[symbol];
        if (state) {
            console.log(`[${symbol}] ORB High: ${state.orbHigh}, Low: ${state.orbLow}, InPosition: ${state.inPosition}, TradeType: ${state.tradeType || 'none'}, PendingRetest: ${!!state.pendingRetest}`);
        } else {
            console.log(`[${symbol}] No state data available`);
        }
    }
    console.log('=== END STATUS REPORT ===\n');
}, { timezone: 'America/New_York' });

// Market close summary
cron.schedule('01 16 * * 1-5', async () => {
    console.log('\n=== DAILY SUMMARY ===');
    for (const symbol of symbols) {
        const state = ORBStockBot.symbolState[symbol];
        if (state && state.hasTradedToday) {
            console.log(`[${symbol}] Traded today: ${state.tradeType || 'unknown type'}`);
        } else {
            console.log(`[${symbol}] No trades today`);
        }
    }
    console.log('=== END DAILY SUMMARY ===\n');
}, { timezone: 'America/New_York' });

// Health check every 15 minutes during market hours
cron.schedule('*/15 9-15 * * 1-5', async () => {
    const now = moment().tz('America/New_York');
    const afterORB = now.hour() >= 9 && now.minute() >= 45;
    
    if (afterORB) {
        // Check if ORB ranges are set
        const missingORB = symbols.filter(symbol => !orbReady[symbol]);
        if (missingORB.length > 0) {
            console.log(`⚠️  WARNING: Missing ORB ranges for: ${missingORB.join(', ')}`);
            // Attempt to recover
            for (const symbol of missingORB) {
                try {
                    await setORBRangeForWindow(symbol, 9, 30, 9, 45);
                    console.log(`✅ Recovered ORB range for ${symbol}`);
                } catch (error) {
                    console.error(`❌ Failed to recover ORB range for ${symbol}:`, error.message);
                }
            }
        }
        
        // Check for stale pending retests (older than 30 minutes)
        for (const symbol of symbols) {
            const state = ORBStockBot.symbolState[symbol];
            if (state && state.pendingRetest && state.pendingRetest.barsSinceBreakout > 30) {
                console.log(`⚠️  WARNING: Stale retest for ${symbol}, clearing...`);
                state.pendingRetest = null;
            }
        }
    }
}, { timezone: 'America/New_York' });

console.log("ORB Worker 2 started and waiting for scheduled tasks.");