#!/usr/bin/env node

// Docker Health Check for ORB Bot
// This script is used by Docker to check if the ORB bot is healthy

const fs = require('fs');
const path = require('path');

// Check if the bot is running by looking for recent log activity
function checkHealth() {
  try {
    const logFile = path.join(__dirname, '../logs/orb-bot.log');
    
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      const lastModified = stats.mtime;
      const now = new Date();
      const timeDiff = now - lastModified;
      
      // Consider healthy if log was updated within last 10 minutes
      if (timeDiff < 10 * 60 * 1000) {
        console.log('✅ ORB Bot is healthy');
        process.exit(0);
      } else {
        console.log('⚠️  ORB Bot may be stuck - no recent log activity');
        process.exit(1);
      }
    } else {
      // No log file yet - could be starting up
      console.log('⏳ ORB Bot starting up...');
      process.exit(0);
    }
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

checkHealth();
