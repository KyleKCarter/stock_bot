require("dotenv").config();
const axios = require('axios');
const alpaca = require("../alpacaClient");

const sellAllPositions = async (req, res) => {
    try {
        // Get all positions
        const positions = await alpaca.getPositions();
        
        if (positions.length === 0) {
            return res.status(200).json({ message: "No positions to sell." });
        }

        // Sell each position
        for (const position of positions) {
            const symbol = position.symbol;
            const qty = position.qty;

            // Place a market order to sell the position
            await alpaca.createOrder({
                symbol: symbol,
                qty: qty,
                side: 'sell',
                type: 'market',
                time_in_force: 'gtc' // Good 'til canceled
            });
        }

        res.status(200).json({ message: "All positions sold successfully." });
    } catch (error) {
        console.error("Error selling positions:", error);
        res.status(500).json({ error: "Failed to sell positions." });
    }
}

const sellPosition = async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: "Symbol is required." });
    }
    try {
        const position = await alpaca.getPosition(symbol);
        if (position) {
            await alpaca.createOrder({
                symbol: symbol,
                qty: position.qty,
                side: 'sell',
                type: 'market',
                time_in_force: 'gtc'
            });
            console.log(`Sold ${position.qty} shares of ${symbol}`);
            res.status(200).json({ message: `Sold ${position.qty} shares of ${symbol}` });
        } else {
            console.log(`No position found for ${symbol}`);
            res.status(404).json({ error: `No position found for ${symbol}` });
        }
    } catch (error) {
        console.error(`Error selling position for ${symbol}:`, error);
        res.status(500).json({ error: `Failed to sell position for ${symbol}.` });
    }
}

module.exports = {
    sellAllPositions,
    sellPosition
};