#!/bin/bash

# Production deployment script
echo "🚀 Starting Trading System in Production Mode..."

# Backup current .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Copy production environment
cp .env.production .env.local

# Start with production overrides
docker-compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  --env-file .env \
  --env-file .env.production \
  up --build -d

echo "✅ Production environment started!"
echo "📊 API Server: http://localhost:32224"
echo "📈 Monitor system: docker-compose logs -f"
echo ""
echo "Production services running:"
echo "  - API Server"
echo "  - ORB Worker (Alpaca Enhanced)"
echo ""
echo "To stop: docker-compose -f docker-compose.yml -f docker-compose.prod.yml down"
echo "To monitor: docker-compose logs -f orbworkeralpaca"
