#!/bin/bash

# Development deployment script
echo "🚀 Starting Trading System in Development Mode..."

# Copy environment
cp .env.development .env.local

# Start with development overrides
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.override.yml \
  --env-file .env \
  --env-file .env.development \
  up --build -d

echo "✅ Development environment started!"
echo "📊 ORB Bot (Enhanced): http://localhost:32224"
echo "📈 Monitor logs: docker-compose logs -f orbworkeralpaca"
echo ""
echo "Available services:"
echo "  - API Server"
echo "  - ORB Worker (Alpaca Enhanced)"
echo "  - Log Monitor"
echo ""
echo "To stop: docker-compose down"
