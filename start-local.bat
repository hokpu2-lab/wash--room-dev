@echo off
setlocal

cd /d "%~dp0"
set "APP_URL=http://localhost:3003/prototype?variant=A"

where node >nul 2>&1
if errorlevel 1 (
  echo [wash-room] Node.js was not found. Install Node.js 24 first.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\next.cmd" (
  echo [wash-room] Installing dependencies for the first run...
  call npm ci
  if errorlevel 1 (
    echo [wash-room] npm ci failed. Check your network or npm settings.
    pause
    exit /b 1
  )
)

echo [wash-room] Starting the dev server at http://localhost:3003
start "wash-room dev" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo [wash-room] Waiting for the server...
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3003/status' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto :open
  timeout /t 1 /nobreak >nul
)

echo [wash-room] The server did not respond. Check the dev server window.
pause
exit /b 1

:open
start "" "%APP_URL%"
echo [wash-room] Opened %APP_URL%
exit /b 0
