#!/usr/bin/env node

// Comprehensive Health Check for ORB Bot
// This script validates the bot's health across multiple dimensions

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

// Check market hours to determine expected bot behavior
function isMarketHours() {
  const now = moment().tz('America/New_York');
  const marketOpen = now.clone().hour(9).minute(30).second(0);
  const marketClose = now.clone().hour(16).minute(0).second(0);
  const isWeekday = now.day() >= 1 && now.day() <= 5; // Monday-Friday
  
  return isWeekday && now.isBetween(marketOpen, marketClose);
}

// Check if we're in the ORB period
function isORBPeriod() {
  const now = moment().tz('America/New_York');
  const marketOpen = now.clone().hour(9).minute(30).second(0);
  const orbEnd = now.clone().hour(9).minute(45).second(0);
  const isWeekday = now.day() >= 1 && now.day() <= 5;
  
  return isWeekday && now.isBetween(marketOpen, orbEnd);
}

// Enhanced health check with multiple validation points
function checkHealth() {
  try {
    console.log(`🕐 Current Time: ${moment().tz('America/New_York').format('YYYY-MM-DD HH:mm:ss')} ET`);
    
    const marketHours = isMarketHours();
    const orbPeriod = isORBPeriod();
    
    console.log(`📊 Market Hours: ${marketHours ? 'YES' : 'NO'}`);
    console.log(`🎯 ORB Period: ${orbPeriod ? 'YES' : 'NO'}`);
    
    // Check multiple possible log locations
    const logFiles = [
      path.join(__dirname, 'trade_events.log'),           // Main ORB bot log
      path.join(__dirname, '../logs/orb-bot.log'),        // Docker log location
      path.join(__dirname, '../logs/trade_events.log')    // Alternative location
    ];
    
    let mostRecentLog = null;
    let mostRecentTime = 0;
    
    // Find the most recently updated log file
    for (const logFile of logFiles) {
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.mtime > mostRecentTime) {
          mostRecentTime = stats.mtime;
          mostRecentLog = logFile;
        }
      }
    }
    
    if (mostRecentLog) {
      const now = new Date();
      const timeDiff = now - mostRecentTime;
      const minutesAgo = Math.round(timeDiff / 60000);
      
      console.log(`📝 Log File: ${path.basename(mostRecentLog)}`);
      console.log(`⏰ Last Activity: ${minutesAgo} minutes ago`);
      
      // Different health criteria based on market status
      let healthyThreshold = 10; // Default 10 minutes
      
      if (marketHours) {
        healthyThreshold = 5; // During market hours, expect more frequent activity
      } else {
        healthyThreshold = 30; // Outside market hours, allow longer periods
      }
      
      if (timeDiff < healthyThreshold * 60 * 1000) {
        console.log(`✅ ORB Bot is healthy (last activity: ${minutesAgo} minutes ago)`);
        process.exit(0);
      } else {
        console.log(`⚠️  ORB Bot may be stuck - no recent activity (${minutesAgo} minutes ago, threshold: ${healthyThreshold} minutes)`);
        process.exit(1);
      }
    } else {
      // No log file yet - different behavior based on market status
      if (marketHours) {
        console.log('⚠️  ORB Bot should be active during market hours but no logs found');
        process.exit(1);
      } else {
        console.log('⏳ ORB Bot starting up or idle outside market hours');
        process.exit(0);
      }
    }
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

checkHealth();
