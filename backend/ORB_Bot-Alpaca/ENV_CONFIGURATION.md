# ORB Bot Environment Configuration Guide

## Overview

This document explains the environment configuration system for the ORB (Opening Range Breakout) bot and the purpose of different environment files.

## Environment Files Structure

### 1. Main `.env` File (`backend/.env`)
**Purpose**: Contains shared configuration for the entire backend application
- **Scope**: Global settings used across multiple bots and services
- **Contents**: 
  - API keys (Alpaca, OpenAI, News API)
  - Database connections
  - Server configuration
  - Basic trading parameters
- **Usage**: Loaded by all backend services and bots

### 2. Enhanced `.env` File (`ORB_Bot-Alpaca/.env.enhanced`)
**Purpose**: Contains ORB bot-specific advanced configuration
- **Scope**: Specialized settings for the ORB bot only
- **Contents**:
  - Advanced volume filtering parameters
  - Professional risk management settings
  - Market structure analysis configuration
  - Trade management and cooldown settings
  - Performance monitoring parameters
  - Safety and circuit breaker limits
- **Usage**: Loaded specifically by the ORB bot for enhanced features

## Configuration Hierarchy

The ORB bot loads configuration in this order:
1. **Main `.env`** - Base configuration and API keys
2. **`.env.enhanced`** - ORB-specific advanced parameters
3. **Environment variables** - Override any file-based settings

```javascript
// Loading order in the bot
require('dotenv').config({ path: '../.env' });           // Main config
require('dotenv').config({ path: './.env.enhanced' });   // ORB-specific config
```

## Key Configuration Categories

### 🎯 Core Trading Parameters
- Opening range configuration (30-minute default)
- Basic position sizing and risk parameters
- Order types and execution settings

### 📊 Volume Filtering (Professional)
- Time-based volume thresholds
- Lunch hour volume adjustments (11 AM - 1 PM)
- Breakout vs retest volume requirements
- Dynamic volume multipliers

### 🛡️ Risk Management
- Dynamic position sizing based on ATR
- Risk-reward ratio optimization
- Maximum daily loss limits
- Position correlation checks

### 📈 Market Analysis
- Trend confirmation using EMAs
- Market structure analysis
- Support/resistance level detection
- Confidence thresholds for trades

### ⏱️ Trade Management
- Symbol-specific trade cooldowns
- Retest logic and timeout settings
- Bracket order management
- Performance tracking intervals

### 🔒 Safety Features
- Circuit breakers for excessive losses
- Maximum daily trade limits
- Emergency stop functionality
- Connection retry mechanisms

## Environment-Specific Deployment

### Development Mode
```bash
# Use development overrides
docker-compose -f docker-compose.yml -f docker-compose.override.yml up
```

### Production Mode
```bash
# Use production settings
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

## Configuration Best Practices

### 1. Parameter Tuning
- Start with conservative settings
- Adjust volume multipliers based on market conditions
- Monitor performance metrics before increasing position sizes

### 2. Risk Management
- Never disable safety features in production
- Set appropriate daily loss limits
- Use paper trading for new parameter testing

### 3. Performance Monitoring
- Enable detailed logging during optimization
- Track win rate and risk-reward metrics
- Analyze trade cooldown effectiveness

### 4. Market Conditions
- Adjust volume thresholds for different market volatility
- Consider trend filters during choppy markets
- Use lower position sizes during high volatility periods

## Parameter Descriptions

### Volume Filter Settings
```env
BREAKOUT_MIN_VOLUME_MULTIPLIER=1.5     # Breakout needs 150% of avg volume
RETEST_MIN_VOLUME_MULTIPLIER=1.2       # Retest needs 120% of avg volume
LUNCH_VOLUME_MULTIPLIER=0.8            # Lower threshold during lunch (80%)
```

### Dynamic Position Sizing
```env
DYNAMIC_POSITION_SIZING=true           # Enable ATR-based sizing
ATR_MULTIPLIER=0.5                     # Position size = base * (1 + ATR * multiplier)
MAX_POSITION_SIZE=20                   # Hard limit on share count
```

### Trade Cooldowns
```env
TRADE_COOLDOWN_MINUTES=5               # Wait 5 minutes between trades on same symbol
SYMBOL_SPECIFIC_COOLDOWN=true          # Per-symbol cooldown vs global
```

### Market Structure
```env
STRUCTURE_CONFIDENCE_THRESHOLD=0.7     # 70% confidence required for structure trades
SUPPORT_RESISTANCE_BUFFER=0.02         # 2% buffer around S/R levels
```

## Monitoring and Maintenance

### Performance Metrics
The bot tracks and logs:
- Win rate and average risk-reward ratio
- Volume filter effectiveness
- Trade cooldown impact
- Daily P&L and drawdown metrics

### Health Checks
- Connection status to Alpaca API
- Market data feed reliability
- Order execution success rates
- Memory and CPU usage

### Log Analysis
- Review daily performance summaries
- Analyze rejected trades due to filters
- Monitor false breakout rates
- Track retest success rates

## Troubleshooting

### Common Issues
1. **Low Trade Frequency**: Adjust volume multipliers
2. **High False Breakouts**: Increase structure confidence threshold
3. **Poor Risk-Reward**: Review take profit and stop loss distances
4. **Connection Issues**: Check API timeout and retry settings

### Debug Mode
Enable detailed logging for troubleshooting:
```env
LOG_LEVEL=debug
DETAILED_VOLUME_LOGGING=true
DEBUG_BREAKOUT_LOGIC=true
```

## Security Notes

- Never commit `.env` files to version control
- Use Docker secrets for production API keys
- Regularly rotate API keys
- Monitor account activity for unauthorized trades

---

**Note**: Always test configuration changes in paper trading mode before deploying to live trading accounts.
