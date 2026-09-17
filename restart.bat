@echo off
title TRIACT - Restart Servers
echo =========================================
echo        Restarting TRIACT Servers         
echo =========================================
echo.

set "ROOT=%~dp0"

echo [1/3] Stopping any running servers on ports 3001 and 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":3001[ ]"') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /r ":5173[ ]"') do (
    taskkill /f /pid %%a >nul 2>&1
)

timeout /t 2 /nobreak >nul
echo Ports cleared.
echo.

echo [2/3] Starting Backend (Port 3001)...
start "TRIACT Backend (3001)" cmd /k "cd /d %ROOT%backend && npm run dev"

echo [3/3] Starting Frontend (Port 5173)...
start "TRIACT Frontend (5173)" cmd /k "cd /d %ROOT%frontend && npm run dev"

echo.
echo =========================================
echo  Servers launched in separate windows!   
echo  Backend:  http://localhost:3001         
echo  Frontend: http://localhost:5173         
echo =========================================
timeout /t 4 >nul
