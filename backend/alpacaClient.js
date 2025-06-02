require("dotenv").config();
const Alpaca = require("@alpacahq/alpaca-trade-api");

const {
    ALPACA_API_KEY_ID,
    ALPACA_SECRET_KEY,
} = process.env;

if(!ALPACA_API_KEY_ID || !ALPACA_SECRET_KEY) {
    throw new Error("Missing required environment variables");
}

const alpaca = new Alpaca({
    keyId: ALPACA_API_KEY_ID,
    secretKey: ALPACA_SECRET_KEY,
    paper: true, // Set to false for live trading
})

module.exports = alpaca;