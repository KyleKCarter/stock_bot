const axios = require('axios');
const Alpaca = require('@alpacahq/alpaca-trade-api')
const WebSocket = require('ws');

const {
    ALPACA_API_KEY_ID,
    ALPACA_SECRET_KEY,
    // ALPACA_API_BASE_URL,
    OPENAI_API_KEY
} = process.env;

if(!ALPACA_API_KEY_ID || !ALPACA_SECRET_KEY || !OPENAI_API_KEY) {
    throw new Error("Missing required environment variables");
}

const alpaca = new Alpaca({
    keyId: ALPACA_API_KEY_ID,
    secretKey: ALPACA_SECRET_KEY,
    paper: true, // Set to true if you want to use paper trading, false for live trading
});
const wss = new WebSocket('wss://stream.data.alpaca.markets/v1beta1/news');

wss.on('open', function() {
    console.log("WebSocket connection opened");

    //Login to the data source
    const authMsg = {
        action: 'auth',
        key: ALPACA_API_KEY_ID,
        secret: ALPACA_SECRET_KEY,
        paper: true // Set to true if you want to use paper trading, false for live trading
    };
    wss.send(JSON.stringify(authMsg)); // Send auth data to ws, "log us in"

    //Subscribe to all news feeds
    const subscribeMsg = {
        action: 'subscribe',
        news: ['*'] // Subscribe to all news feeds -> also can request specific symbols ["AAPL", "TSLA"]
    };
    wss.send(JSON.stringify(subscribeMsg)); // Send subscribe data to ws, "subscribe to all news feeds"
});

wss.on('message', async function(message) {
    const msgStr = message.toString();
    let events;
    // Parse the incoming message
    try {
        events = JSON.parse(msgStr);
    } catch (error) {
        console.error("Failed to parse message: ", msgStr)
        return;
    }

    if (!Array.isArray(events)) {
        events = [events]; // Ensure events is an array
    }

    for (const currentEvent of events) {
        try {
            console.log("Received message:", currentEvent);
            if(currentEvent.T === "n") { // Check to see if this is a news event
                let companyImpact = 0; // Variable to hold the impact of the news event
    
                // Ask ChatGPT for a summary of the news event
                const apiRequestBody = {
                    "model": "gpt-3.5-turbo",
                    "messages": [
                        { role: "system", content: "Only respond with a number from 1-100 detailing the impact of the headline."}, // How ChatGPT should talk to us
                        { role: "user", content: `Given the headline '${currentEvent.headline}', show me a number from 1-100 detailing the impact of this headline.`}
                    ]
                }
                try {
                    //Axios request to OpenAI API
                    const response = await axios.post('https://api.openai.com/v1/chat/completions', apiRequestBody, {
                        headers: {
                            "Authorization": `Bearer ${OPENAI_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                    })
    
                    const choices = response.data.choices;
                    if (choices && choices[0] && choices[0].message && choices[0].message.content) {
                        const impactValue = parseInt(choices[0].message.content);
                        if (!isNaN(impactValue)) {
                            companyImpact = impactValue; // Set the companyImpact to the value returned by ChatGPT
                            console.log("Company Impact Score:", companyImpact);
                        } else {
                            console.error("OpenAI response content is not a valid number:", choices[0].message.content);
                            continue; // Skip this event if the response is not a valid number
                        }
                    } else {
                        console.error("OpenAI API response missing expected fields: ", response.data);
                        continue; // Skip this event if the response is not as expected
                    }
                } catch (error) {
                    console.error("Error calling OpenAI API:", error.response ? error.response.data : error.message);
                }
    
                // Make trades based on the output (of the impact saved in companyImpact)
                const tickerSymbol = (currentEvent.symbols && currentEvent.symbols[0]) ? currentEvent.symbols[0] : null;
                if (!tickerSymbol) {
                    console.error("No ticker symbol found in event: ", currentEvent);
                    continue; // Skip this event if no ticker symbol is found
                }
                // 1 - 100, 1 being the most negative, 100 being the most positive impact on a company.
                console.log(new Date().toISOString(), `Company Impact Score: ${companyImpact}`);
                const isMarketOpen = await alpaca.getClock().then(clock => clock.is_open);

                // if score >= 70 : Buy Stock
                if(companyImpact >= 70 && isMarketOpen) {
                    // Buy Stock
                    try {
                        const asset = await alpaca.getAsset(tickerSymbol);
                        if (!asset.tradable) {
                            console.log(`Asset ${tickerSymbol} is not tradable. Skipping order.`);
                            continue; // Skip if the asset is not tradable
                        }
                        let order = await alpaca.createOrder({
                            symbol: tickerSymbol,
                            qty: 1,
                            side: 'buy',
                            type: 'market',
                            time_in_force: 'day' // day ends, it wont trade.
                        });
                    } catch (error) {
                        console.error(`Error placing order for ${tickerSymbol}:`, error);
                        continue; // Skip this event if there was an error placing the order
                    }
                
                    // else if impact <= 30: Sell all of stock
                } else if(companyImpact <= (isMarketOpen ? 30 : 20)) {
                    // Sell stock
                    // Check if we have a position in the stock
                    try {
                        const position = await alpaca.getPosition(tickerSymbol);
                        if (position && Number(position.qty) > 0) {
                            await alpaca.closePosition(tickerSymbol);
                            console.log(`Closed position for ${tickerSymbol}`);
                        } else {
                            console.log(`No position to close for ${tickerSymbol}`);
                        }
                    } catch (error) {
                        const status = error.statusCode || (error.response && error.response.status);
                        if (status === 404) {
                            console.log(`No position found for ${tickerSymbol}`);
                        } else {
                            console.error(`Error closing position for ${tickerSymbol}:`, error);
                        }
                    }
                }
                
            }
        } catch (error) {
            console.error("Error processing event:", error);
        }
    }
});

wss.on('error', (err) => {
    console.error("WebSocket error:", err);
});

wss.on('close', () => {
    console.log("WebSocket connection closed");
});