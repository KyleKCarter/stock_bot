require("dotenv").config();
const axios = require('axios');
const alpaca = require("../alpacaClient");
const { DateTime } = require('luxon');

const {
    OPENAI_API_KEY,
    NEWS_API_KEY
} = process.env;

if(!OPENAI_API_KEY || !NEWS_API_KEY) {
    throw new Error("Missing required environment variables");
}

const getOpeningRange = async (symbol) => {
    // Set start and end in US/Eastern, then convert to UTC ISO strings
    const start = DateTime.fromObject(
        { year: DateTime.now().year, month: DateTime.now().month, day: DateTime.now().day, hour: 9, minute: 30 },
        { zone: 'America/New_York' }
    ).toUTC().toISO();

    const end = DateTime.fromObject(
        { year: DateTime.now().year, month: DateTime.now().month, day: DateTime.now().day, hour: 9, minute: 45 },
        { zone: 'America/New_York' }
    ).toUTC().toISO();

    console.log(`Requesting bars for ${symbol} from ${start} to ${end} with timeframe 1Min`);

    const barsIterable = await alpaca.getBarsV2(
        symbol, 
        {
            timeframe: '5Min',
            start,
            end,
            feed: 'iex'
        },
        alpaca.configuration
    );

    const bars = [];
    for await (const bar of barsIterable) {
        bars.push(bar);
    }

    if (!bars.length) {
        throw new Error(`No bars returned for ${symbol}`);
    }

    const highs = bars.map(bar => bar.HighPrice);
    const lows = bars.map(bar => bar.LowPrice);

    return {
        high: Math.max(...highs),
        low: Math.min(...lows)
    };
}

const analyzeSentiment = async (text) => {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: `Give a one-word sentiment (Positive, Neutral, or Negative) for this headline: "${text}"` }],
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("error analyzing sentiment:", error);
        return "Neutral"; // Fallback to Neutral if there's an error
    }
}

const fetchLatestNewsHeadline = async (symbol) => {
    try {
        const response = await axios.get(`https://newsapi.org/v2/everything?q=${symbol}&sortBy=publishedAt&apiKey=${NEWS_API_KEY}`);
        return response.data.articles[0]?.title || "No recent headline available";
    } catch (error) {
        console.error("Error fetching news headline:", error);
        return "No recent headline available"; // Fallback if there's an error
    }
}

const getEntryPrice = async (symbol, side, retries = 5) => {
    let entryPrice = null;
    while ( retries-- > 0) {
        try {
            const position = await alpaca.getPosition(symbol);
            if((side === 'buy' && parseFloat(position.qty) > 0) || (side === 'sell' && parseFloat(position.qty) < 0)) {
                entryPrice = parseFloat(position.avg_entry_price);
                break;
            }
        } catch (error) {
            if (!(error.response && error.response.status === 404)) {
                console.error(`Error fetching position for ${symbol}:`, error.message);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
    }

    if (!entryPrice) {
        console.log(`[${symbol}] Failed to get entry price after retries.`);
    }

    return entryPrice;
}

const hasOpenPosition = async (symbol, side) => {
    try {
        const position = await alpaca.getPosition(symbol);
        if (side === 'buy') {
            return parseFloat(position.qty) > 0;
        } else if (side === 'sell') {
            return parseFloat(position.qty) < 0;
        } else {
            return false;
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // No position found
            return false;
        } else {
            throw error
        }
    }
};

const monitorBreakout = async (symbol, openingRange, qty, stopLossPercent, riskRewardRatio) => {
    const latestBar = await alpaca.getLatestBar(symbol);
    const price = latestBar.ClosePrice;

    //Buy Logic
    if (price > openingRange.high) {
        console.log(`Breakout above opening range detected for ${symbol} at price ${price}`);

        const headline = await fetchLatestNewsHeadline(symbol);
        const sentiment = await analyzeSentiment(headline);

        if (await hasOpenPosition(symbol, 'buy')) {
            console.log(`[${symbol}] Skipped: Already in long position.`);
        } else if (!sentiment.toLowerCase().includes('positive')) {
            console.log(`[${symbol}] Skipped: Sentiment not positive (${sentiment}).`);
        } else {
            await placeOrder(symbol, 'buy', qty, price);
            const entryPrice = await getEntryPrice(symbol, 'buy');
            if (!entryPrice) {
                console.log(`[${symbol}] Could not confirm entry price.`);
                return;
            }
            let exitStatus = null;
            while (!exitStatus) {
                exitStatus = await monitorExit(symbol, entryPrice, 'buy', stopLossPercent, riskRewardRatio);
                await new Promise(res => setTimeout(res, 60000));
            }
        }

    //Sell Logic
    } else if (price < openingRange.low) {
        const headline = await fetchLatestNewsHeadline(symbol);
        const sentiment = await analyzeSentiment(headline);

        if (await hasOpenPosition(symbol, 'sell')) {
            console.log(`[${symbol}] Skipped: Already in short position.`);
        } else if (!sentiment.toLowerCase().includes('negative')) {
            console.log(`[${symbol}] Skipped: Sentiment not negative (${sentiment}).`);
        } else {
            await placeOrder(symbol, 'sell', qty, price);
            const entryPrice = await getEntryPrice(symbol, 'sell');
            if (!entryPrice) {
                console.log(`[${symbol}] Could not confirm entry price.`);
                return;
            }
            let exitStatus = null;
            while (!exitStatus) {
                exitStatus = await monitorExit(symbol, entryPrice, 'sell', stopLossPercent, riskRewardRatio);
                await new Promise(res => setTimeout(res, 60000));
            }
        }
    } else {
        console.log(`[${symbol}] Skipped: No breakout or breakdown at price ${price}`);
    }
};

const placeOrder = async (symbol, side, qty) => {
    await alpaca.createOrder({
        symbol,
        qty,
        side,
        type: 'market',
        time_in_force: 'day' // Good for the day
    });
}

const monitorExit = async (symbol, entryPrice, side, stopLossPercent, riskRewardRatio) => {
    try {
        const latestBar = await alpaca.getLatestBar(symbol);
        const price = latestBar.ClosePrice;

        // Calculate stop loss and take profit based on entry price and risk-reward ratio
        const stopLoss = side === 'buy'
            ? entryPrice * (1 - stopLossPercent)
            : entryPrice * (1 + stopLossPercent);
        
        const takeProfit = side === 'buy'
            ? entryPrice * (1 + stopLossPercent * riskRewardRatio)
            : entryPrice * (1 - stopLossPercent * riskRewardRatio);
        
        if ((side === 'buy' && price <= stopLoss) || (side === 'sell' && price >= stopLoss)) {
            // Stop loss hit
            await closePosition(symbol);
            console.log(`Stop loss hit for ${symbol} at price ${price}.`);
            return 'stopLoss';
        } else if ((side === 'buy' && price >= takeProfit) || (side === 'sell' && price <= takeProfit)) {
            // Take profit hit
            await closePosition(symbol);
            console.log(`Take profit hit for ${symbol} at price ${price}`);
            return 'takeProfit';
        }
        return null;
    } catch (error) {
        console.error("Error monitoring exit: ", error);
        return null;
    }
};

const closePosition = async (symbol) => {
    try {
        await alpaca.closePosition(symbol);
        console.log(`Closed position for ${symbol} at end of opening range breakout.`);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(`No open position to close for ${symbol}.`);
        } else {
            console.error(`Error closing position for ${symbol}:`, error.message);
        }
    }
}

module.exports = {
    getOpeningRange,
    analyzeSentiment,
    fetchLatestNewsHeadline,
    monitorBreakout,
    placeOrder,
    closePosition
}