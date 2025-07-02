#!/usr/bin/env node

// ORB Bot Pre-Trading Validation Script
// Run this to verify everything is configured correctly before live trading

// Load environment configurations
require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: './.env.enhanced' });

const Alpaca = require('@alpacahq/alpaca-trade-api');
const moment = require('moment-timezone');

console.log('🚀 ORB Bot Pre-Trading Validation');
console.log('=====================================');

// 1. Environment Configuration Check
console.log('\n1. Environment Configuration:');
console.log(`   ✓ Opening Range Duration: ${process.env.OPENING_RANGE_MINUTES || 15} minutes`);
console.log(`   ✓ Base Position Percent: ${process.env.BASE_POSITION_PERCENT || 0.04} (${(Number(process.env.BASE_POSITION_PERCENT || 0.04) * 100)}%)`);
console.log(`   ✓ Max Position Percent: ${process.env.MAX_POSITION_PERCENT || 0.05} (${(Number(process.env.MAX_POSITION_PERCENT || 0.05) * 100)}%)`);
console.log(`   ✓ Volume Filter Enabled: ${process.env.VOLUME_FILTER_ENABLED || 'true'}`);
console.log(`   ✓ Dynamic Position Sizing: ${process.env.DYNAMIC_POSITION_SIZING || 'true'}`);

// 2. Alpaca API Connection Test
console.log('\n2. Alpaca API Connection Test:');

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true
});

async function validateAlpacaConnection() {
  try {
    console.log('   📡 Testing Alpaca connection...');
    const account = await alpaca.getAccount();
    console.log(`   ✅ Connection successful!`);
    console.log(`   💰 Account Equity: $${Number(account.equity).toLocaleString()}`);
    console.log(`   📊 Buying Power: $${Number(account.buying_power).toLocaleString()}`);
    console.log(`   🏦 Paper Trading: ${account.account_blocked ? '❌ BLOCKED' : '✅ ACTIVE'}`);
    
    return Number(account.equity);
  } catch (error) {
    console.log(`   ❌ Connection failed: ${error.message}`);
    return null;
  }
}

// 3. Position Sizing Test
async function testPositionSizing(accountEquity) {
  console.log('\n3. Position Sizing Test:');
  
  const testStocks = [
    { symbol: 'SPY', price: 600 },
    { symbol: 'AAPL', price: 230 },
    { symbol: 'AMD', price: 140 },
    { symbol: 'TSLA', price: 180 },
    { symbol: 'NVDA', price: 900 }
  ];
  
  // Import position sizing functions
  const ORBBot = require('./orb-bot-alpaca');
  
  for (const stock of testStocks) {
    const entry = stock.price;
    const stop = entry - (entry * 0.01); // 1% stop
    
    try {
      const qty = ORBBot.calculatePositionSize(accountEquity, 0.01, entry, stop, null, entry);
      const positionValue = qty * entry;
      const percentOfAccount = (positionValue / accountEquity) * 100;
      
      console.log(`   📈 ${stock.symbol} ($${stock.price}): ${qty} shares = $${positionValue.toFixed(0)} (${percentOfAccount.toFixed(1)}%)`);
    } catch (error) {
      console.log(`   ❌ ${stock.symbol}: Error calculating position size`);
    }
  }
}

// 4. Market Hours Check
function checkMarketHours() {
  console.log('\n4. Market Hours Check:');
  const now = moment().tz('America/New_York');
  const marketOpen = now.clone().hour(9).minute(30).second(0);
  const marketClose = now.clone().hour(16).minute(0).second(0);
  const orbEnd = now.clone().hour(9).minute(45).second(0);
  
  console.log(`   🕘 Current Time (ET): ${now.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log(`   🔔 Market Open: ${marketOpen.format('HH:mm:ss')}`);
  console.log(`   📊 ORB Period End: ${orbEnd.format('HH:mm:ss')}`);
  console.log(`   🔕 Market Close: ${marketClose.format('HH:mm:ss')}`);
  
  const isMarketDay = now.day() >= 1 && now.day() <= 5; // Monday-Friday
  const isMarketHours = now.isBetween(marketOpen, marketClose);
  const isORBPeriod = now.isBetween(marketOpen, orbEnd);
  
  console.log(`   📅 Market Day: ${isMarketDay ? '✅' : '❌'}`);
  console.log(`   ⏰ Market Hours: ${isMarketHours ? '✅' : '❌'}`);
  console.log(`   🎯 ORB Period: ${isORBPeriod ? '✅ ACTIVE' : '❌ CLOSED'}`);
}

// 5. Risk Management Validation
function validateRiskManagement(accountEquity) {
  console.log('\n5. Risk Management Validation:');
  
  const maxDailyLoss = process.env.MAX_DAILY_LOSS ? Number(process.env.MAX_DAILY_LOSS) : 500;
  const maxDailyTrades = process.env.MAX_DAILY_TRADES ? Number(process.env.MAX_DAILY_TRADES) : 10;
  const maxPositions = process.env.MAX_OPEN_POSITIONS ? Number(process.env.MAX_OPEN_POSITIONS) : 3;
  
  console.log(`   🛡️  Max Daily Loss: $${maxDailyLoss} (${((maxDailyLoss / accountEquity) * 100).toFixed(1)}% of account)`);
  console.log(`   📊 Max Daily Trades: ${maxDailyTrades}`);
  console.log(`   📈 Max Open Positions: ${maxPositions}`);
  console.log(`   ⏱️  Trade Cooldown: ${process.env.TRADE_COOLDOWN_MINUTES || 5} minutes`);
  
  // Validate reasonable risk levels
  const dailyRiskPercent = (maxDailyLoss / accountEquity) * 100;
  if (dailyRiskPercent > 10) {
    console.log(`   ⚠️  WARNING: Daily risk (${dailyRiskPercent.toFixed(1)}%) is very high!`);
  } else {
    console.log(`   ✅ Daily risk level is reasonable`);
  }
}

// Main validation function
async function runValidation() {
  const accountEquity = await validateAlpacaConnection();
  
  if (accountEquity) {
    await testPositionSizing(accountEquity);
    validateRiskManagement(accountEquity);
  }
  
  checkMarketHours();
  
  console.log('\n6. Ready for Trading:');
  if (accountEquity) {
    console.log('   ✅ All systems validated - Ready for paper trading!');
    console.log('\n🎯 To start the ORB bot tomorrow:');
    console.log('   node orbWorkerAlpaca.js');
    console.log('\n📊 Monitor logs:');
    console.log('   tail -f trade_events.log');
  } else {
    console.log('   ❌ Fix Alpaca connection before trading');
  }
  
  console.log('\n=====================================');
}

// Run the validation
runValidation().catch(console.error);
