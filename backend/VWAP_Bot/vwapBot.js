require('dotenv').config();
const { parse } = require('dotenv');
const alpaca = require('../alpacaClient');
const axios = require('axios');

const {
    OPENAI_API_KEY,
    NEWS_API_KEY
} = process.env;

if(!OPENAI_API_KEY || !NEWS_API_KEY) {
    throw new Error("Missing required environment variables");
}

const companyNames = {
    TSLA: 'Tesla',
    NVDA: 'Nvidia',
    QQQ: 'Invesco QQQ',
    SPY: 'SPDR S&P 500',
    AAPL: 'Apple',
    AMD: 'Advanced Micro Devices',
    AMZN: 'Amazon',
    META: 'Meta Platforms',
    MSFT: 'Microsoft'
};

const newsCache = {}; // { [symbol]: { headline, hasNews, timestamp} }

const fetchLatestNewsHeadline = async (symbol) => {
    const now = Date.now();
    const cache = newsCache[symbol];

    // If chaced and less than 15 minutes old, return cached headline
    if (cache && (now - cache.timestamp < 15 * 60 * 1000)) {
        return { headline: cache.headline, hasNews: cache.hasNews };
    }

    const query = `${symbol} OR ${companyNames[symbol] || ''}`;
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&apiKey=${NEWS_API_KEY}`;
    try {
        const response = await axios.get(url);
        let result;
        if (response.data.articles && response.data.articles.length > 0) {
            result =  { headline: response.data.articles[0].title, hasNews: true };
        } else {
            result =  { headline: 'No news found', hasNews: false };
        }

        // Cache the result
        newsCache[symbol] = {...result, timestamp: now };
        return result;
    } catch (error) {
        console.error('News API Error: ', error.message);
        // Cache the error result to avoid spamming the API
        newsCache[symbol] = { headline: 'No news found', hasNews: false, timestamp: now };
        return { headline: 'No news found', hasNews: false };
    }
}

const getSentiment = async (text) => {
    const prompt = `Analyze the following text and return a one-word sentiment (Positive, Neutral, or Negative): "${text}"`;
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const sentiment = response.data.choices[0].message.content.trim();
        console.log(`Sentiment for "${text}": ${sentiment}`);
        return sentiment;
    } catch (error) {
        console.error('OpenAI Error: ', error.message);
        return 'Neutral';
    }
}

const getMarketTrend = async (symbol) => {
    const bars = await alpaca.getBarsV2(
        symbol,
        { timeframe: '1Min', limit: 3 },
        alpaca.configuration
    );

    const barArray = [];
    for await (let b of bars) {
        barArray.push(b);
    }
    
    if (barArray.length < 2) {
        return 'Neutral'; // Not enough data to determine trend
    }

    const prev = barArray[barArray.length - 2].ClosePrice;
    const curr = barArray[barArray.length - 1].ClosePrice;

    if (curr > prev) {
        return 'Bullish';
    }
    if (curr < prev) {
        return 'Bearish';
    }
    return 'Neutral';
}

const isMarketOpenTime = async () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const estHour = hour - 4; // Convert UTC to EST
    return estHour >= 10 && estHour < 15; // 10 AM to 3 PM ET
}

const checkVWAPPullback = async (symbol, stopLossPercent = 0.005, riskRewardRatio = 3) => {
    const bars = await alpaca.getBarsV2(
        symbol,
        { timeframe: '15Min', limit: 15 },
        alpaca.configuration
    );
    
    const barArray = [];
    for await (let b of bars) {
        barArray.push(b);
    }

    if (barArray.length < 1) {
        console.error(`No bars returned for ${symbol} in checkVWAPPullback`);
        return;
    }

    const latestBar = barArray[barArray.length - 1];
    const vwap = latestBar.VWAP; // Use VWAP from the latest bar directly
    const close = latestBar.ClosePrice;
    const open = latestBar.OpenPrice;

    // Fetch a relevant news headline for sentiment analysis
    const { headline, hasNews} = await fetchLatestNewsHeadline(symbol);
    let sentiment = 'Neutral'; // Default sentiment if no news found
    let actionableNews = hasNews; // Assume news is actionable unless sentiment is neutral
    if (hasNews) {
        sentiment = await getSentiment(headline);
        if (sentiment.toLowerCase() === 'neutral') {
            actionableNews = false; // Treat neutral sentiment as no impactful news
        }
    }

    const isBullishCandle = close > open;
    const nearVWAP = Math.abs(close - vwap) < 0.5; //was 0.2
    const marketTrend = await getMarketTrend(symbol);

    let currentPositionQty = 0;
    try {
        const position = await alpaca.getPosition(symbol);
        currentPositionQty = parseFloat(position.qty);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            currentPositionQty = 0; // No position found
        } else {
            console.error(`Error fetching position for ${symbol}:`, error);
            return; // Exit if another error occurs
        }
    }

    // Bullish pullback (long)
    // if (currentPositionQty === 0 && nearVWAP && isBullishCandle && marketTrend === 'Bullish' /* && (!actionableNews || sentiment.toLowerCase() === 'positive') */) {
    if (currentPositionQty !== 0) {
        console.log(`[${symbol}] Skipped: Already in position.`);
        } else if (!nearVWAP) {
            console.log(`[${symbol}] Skipped: Not near VWAP.`);
        } else if (!isBullishCandle) {
            console.log(`[${symbol}] Skipped: Not a bullish candle.`);
        } else if (marketTrend !== 'Bullish') {
            console.log(`[${symbol}] Skipped: Market trend not bullish.`);
        } else {
            await submitBuyOrder(symbol, 3);
            logTrade({ symbol, action: 'BUY', price: close });

            // Wait for the order to fill
            await new Promise(res => setTimeout(res, 2000));

            // Fetch the actual position to get the real entry price
            let entryPrice = close; //fallback
            let retries = 5;
            while (retries > 0) {
                try {
                    const position = await alpaca.getPosition(symbol);
                    if (parseFloat(position.qty) > 0) {
                        entryPrice = parseFloat(position.avg_entry_price);
                        break; // Exit loop if successful
                    }
                } catch (error) {
                    if(error.response && error.response.status === 404) {
                        // Position not found, wait and retry
                    } else {
                        console.error(`Could not fetch entry price for ${symbol}, using bar close:`, error);
                        break; // Exit loop on other errors
                    }
                }
                await new Promise(res => setTimeout(res, 2000)); // Wait before retrying
                retries--;
            }

            // Wait for the next 1-minute bar before starting exit checks
            const now = new Date();
            const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
            await new Promise(res => setTimeout(res, msToNextMinute));

            // Monitor for exit with 1:3 risk-reward ratio
            let exited = false;
            while (!exited) {
                await new Promise(res => setTimeout(res, 60000)); // wait 1 minute
                // await new Promise(res => setTimeout(res, 120000)); // 2 minutes
                // await new Promise(res => setTimeout(res, 300000)); // 5 minutes
                exited = await checkExit(
                    symbol,
                    entryPrice,
                    stopLossPercent * riskRewardRatio * 100, // takeProfit in %
                    stopLossPercent * 100 // stopLoss in %
                );
            }
            return entryPrice;
        }

    // Bearish reversal (short)
    // if (currentPositionQty === 0 && nearVWAP && !isBullishCandle && marketTrend === 'Bearish' /* && (!actionableNews || sentiment.toLowerCase() === 'negative') */) {
    if (currentPositionQty !== 0) {
        console.log(`[${symbol}] Skipped: Already in position.`);
    } else if (!nearVWAP) {
        console.log(`[${symbol}] Skipped: Not near VWAP.`);
    } else if (isBullishCandle) {
        console.log(`[${symbol}] Skipped: Not a bearish candle.`);
    } else if (marketTrend !== 'Bearish') {
        console.log(`[${symbol}] Skipped: Market trend not bearish.`);
    } else {

        await submitSellOrder(symbol, 3);
        logTrade({ symbol, action: 'SELL', price: close });

        // Wait for the order to fill
        await new Promise(res => setTimeout(res, 2000));

        // Fetch the actual position to get the real entry price
        let entryPrice = close; //fallback
        let retries = 5;
        while (retries > 0) {
            try {
                const position = await alpaca.getPosition(symbol);
                if (parseFloat(position.qty) < 0) { // Ensure it's a short position
                    entryPrice = parseFloat(position.avg_entry_price);
                    break;
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    // Position not found, wait and retry
                } else {
                    console.error(`Could not fetch entry price for ${symbol}, using bar close:`, error);
                    break;
                }
            }
            await new Promise(res => setTimeout(res, 2000));
            retries--;
        }

        // Wait for the next 1-minute bar before starting exit checks
        const now = new Date();
        const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
        await new Promise(res => setTimeout(res, msToNextMinute));

        // Monitor for exit with 1:3 risk-reward ratio (short)
        let exited = false;
        while (!exited) {
            await new Promise(res => setTimeout(res, 60000)); // wait 1 minute
            exited = await checkExitShort(
                symbol,
                entryPrice,
                stopLossPercent * riskRewardRatio * 100, // takeProfit in %
                stopLossPercent * 100 // stopLoss in %
            );
        }
        return entryPrice;
    }    
}

const submitBuyOrder = async (symbol, qty) => {
    try {
        await alpaca.createOrder({
            symbol,
            qty,
            side: 'buy',
            type: 'market',
            time_in_force: 'day' // Good for the trading day
        });
    } catch (error) {
        console.error(`Error submitting buy order for ${symbol}:`, error);
    }
}

const submitSellOrder = async (symbol, qty) => {
    try {
        await alpaca.createOrder({
            symbol,
            qty,
            side: 'sell',
            type: 'market',
            time_in_force: 'day' // Good for the trading day
        })
    } catch (error) {
        console.error(`Error submitting sell order for ${symbol}:`, error);
    }
}


const logTrade = async (trade) => {
    console.log(`[TRADE]: ${new Date().toISOString()} - ${JSON.stringify(trade)}`);
}

const checkExit = async (symbol, entryPrice, takeProfit = 1.5, stopLoss = 0.5) => {
    const bars = await alpaca.getBarsV2(
        symbol,
        { timeframe: '1Min', limit: 1 },
        alpaca.configuration
    );

    let lastClose;
    for await (let bar of bars) {
        lastClose = bar.ClosePrice;
    }

    if (!lastClose) return false;

    const gain = ((lastClose - entryPrice) / entryPrice) * 100;

    if (gain >= takeProfit) {
        await closePosition(symbol);
        logTrade({ symbol, action: 'SELL_TP', price: lastClose, gain: `${gain.toFixed(2)}%` });
        return true;
    } else if (gain <= -stopLoss) {
        await closePosition(symbol);
        logTrade({ symbol, action: 'SELL_SL', price: lastClose, loss: `${gain.toFixed(2)}%` });
        return true;
    }
    return false;
}

const checkExitShort = async (symbol, entryPrice, takeProfit = 1.5, stopLoss = 0.5) => {
    const bars = await alpaca.getBarsV2(
        symbol,
        { timeframe: '1Min', limit: 1 },
        alpaca.configuration
    );

    let lastClose;
    for await (let bar of bars) {
        lastClose = bar.ClosePrice;
    }

    if (!lastClose) return false;

    const gain = ((entryPrice - lastClose) / entryPrice) * 100; // Profit for short

    if (gain >= takeProfit) {
        await closePosition(symbol);
        logTrade({ symbol, action: 'COVER_TP', price: lastClose, gain: `${gain.toFixed(2)}%` });
        return true;
    } else if (gain <= -stopLoss) {
        await closePosition(symbol);
        logTrade({ symbol, action: 'COVER_SL', price: lastClose, loss: `${gain.toFixed(2)}%` });
        return true;
    }
    return false;
}

const closePosition = async (symbol) => {
    try {
        await alpaca.closePosition(symbol);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // Position does not exist, safe to ignore
            console.warn(`No open position to close for ${symbol}.`);
        } else {
            console.error(`Exit Error:`, error);
        }
    }
}

module.exports ={
    checkVWAPPullback,
    checkExit,
    checkExitShort,
    isMarketOpenTime,
    logTrade,
    closePosition
}