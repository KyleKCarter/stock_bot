@echo off
REM Docker-based ORB Bot Startup Script (Windows)
REM This script starts the ORB bot using Docker containers

echo 🐳 Starting ORB Bot with Docker
echo ================================

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not running. Please start Docker first.
    pause
    exit /b 1
)

REM Check if .env.enhanced exists
if not exist ".\ORB_Bot-Alpaca\.env.enhanced" (
    echo ❌ .env.enhanced file not found!
    echo Please ensure ORB_Bot-Alpaca\.env.enhanced exists
    pause
    exit /b 1
)

REM Choose environment
echo 🔧 Select environment:
echo 1) Development (with debug logs)
echo 2) Production (optimized)
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    echo 🚀 Starting in DEVELOPMENT mode...
    docker-compose -f docker-compose.yml -f docker-compose.override.yml up --build orbworkeralpaca
) else if "%choice%"=="2" (
    echo 🚀 Starting in PRODUCTION mode...
    docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build orbworkeralpaca
) else (
    echo ❌ Invalid choice. Exiting.
    pause
    exit /b 1
)

REM Instructions for stopping
echo.
echo 🛑 To stop the bot:
echo    Press Ctrl+C, then run:
echo    docker-compose down
echo.
echo 📊 To view logs:
echo    docker logs orb-worker-alpaca -f

pause
