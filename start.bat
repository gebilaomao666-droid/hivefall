@echo off
rem HIVEFALL launcher: starts the local static server and opens the game in the default browser.
setlocal
cd /d "%~dp0"
set PORT=5173
where node >nul 2>nul
if errorlevel 1 (
  echo [HIVEFALL] Node.js was not found. Please install Node.js 16 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo [HIVEFALL] Starting local server on http://127.0.0.1:%PORT%/
echo [HIVEFALL] Keep this window open while playing. Close it to stop the server.
start "" /b cmd /c "ping -n 2 127.0.0.1 >nul & start "" http://127.0.0.1:%PORT%/"
node tools\serve.js %PORT%
echo.
echo [HIVEFALL] The server has stopped. If the port %PORT% is already in use, the game may already be running: open http://127.0.0.1:%PORT%/
pause
