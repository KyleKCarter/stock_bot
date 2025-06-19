const ORBStockBot2 = require('./openingRangeBreakoutBot');
const { mock5MinBars, mock1MinBars } = require('./mockData');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Mock Alpaca API with delay for "live" simulation ---
ORBStockBot2.alpaca.getBarsV2 = async (symbol, params) => {
  const bars = params.timeframe === '5Min' ? mock5MinBars : mock1MinBars;
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const bar of bars) {
        yield bar;
        await delay(500); // 500ms delay between bars, adjust as needed
      }
    }
  };
};

// --- Test Run: Simulate candles posting one at a time ---
(async () => {
  const symbol = 'MOCK';

  for (let i = 0; i < mock5MinBars.length; i++) {
    const partialBars = mock5MinBars.slice(0, i + 1);

    ORBStockBot2.alpaca.getBarsV2 = async (symbol, params) => {
      let bars;
      if (params.timeframe === '5Min') {
        bars = partialBars;
      } else if (params.timeframe === '1Min') {
        // Provide all 1-min bars up to the current 5-min bar's end time
        const last5MinBarTime = partialBars[partialBars.length - 1].Timestamp;
        bars = mock1MinBars.filter(b => b.Timestamp <= last5MinBarTime);
      } else {
        bars = [];
      }
      return {
        [Symbol.asyncIterator]: async function* () {
          for (const bar of bars) {
            yield bar;
          }
        }
      };
    };

    await ORBStockBot2.getORBRange(symbol, 9, 30, 9, 45);
    await ORBStockBot2.monitorBreakout(symbol);

    // If breakout detected, simulate 1-min checks for retest or timeout
    if (
      ORBStockBot2.symbolState[symbol] &&
      ORBStockBot2.symbolState[symbol].pendingRetest
    ) {
      // Simulate up to 10 1-min bars after breakout
      for (let j = 0; j < 10; j++) {
        await ORBStockBot2.checkRetestAndTrade(
          symbol,
          ORBStockBot2.symbolState[symbol].pendingRetest
        );
        if (ORBStockBot2.symbolState[symbol].inPosition) break;
        await delay(100); // simulate 1-min bar delay (shorter for test)
      }
    }

    await delay(500); // Wait before next "candle"
  }
})();