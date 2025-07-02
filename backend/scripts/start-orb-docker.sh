#!/bin/bash

# Docker-based ORB Bot Startup Script
# This script starts the ORB bot using Docker containers

echo "🐳 Starting ORB Bot with Docker"
echo "================================"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if .env.enhanced exists
if [ ! -f "./ORB_Bot-Alpaca/.env.enhanced" ]; then
    echo "❌ .env.enhanced file not found!"
    echo "Please ensure ORB_Bot-Alpaca/.env.enhanced exists"
    exit 1
fi

# Choose environment
echo "🔧 Select environment:"
echo "1) Development (with debug logs)"
echo "2) Production (optimized)"
read -p "Enter choice (1 or 2): " choice

case $choice in
    1)
        echo "🚀 Starting in DEVELOPMENT mode..."
        docker-compose -f docker-compose.yml -f docker-compose.override.yml up --build orbworkeralpaca
        ;;
    2)
        echo "🚀 Starting in PRODUCTION mode..."
        docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build orbworkeralpaca
        ;;
    *)
        echo "❌ Invalid choice. Exiting."
        exit 1
        ;;
esac

# Instructions for stopping
echo ""
echo "🛑 To stop the bot:"
echo "   Press Ctrl+C, then run:"
echo "   docker-compose down"
echo ""
echo "📊 To view logs:"
echo "   docker logs orb-worker-alpaca -f"
