@echo off
rem HIVEFALL phone mode: serves the game to other devices on the same Wi-Fi.
setlocal
cd /d "%~dp0"
set PORT=5174
set HIVEFALL_HOST=0.0.0.0
echo [HIVEFALL] Phone mode. Make sure the phone is on the same Wi-Fi as this PC.
echo [HIVEFALL] On the phone, open one of these addresses in the browser:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=1" %%b in ("%%a") do echo     http://%%b:%PORT%/
echo [HIVEFALL] If Windows Firewall asks, allow Node.js on private networks.
echo [HIVEFALL] Keep this window open while playing.
node tools\serve.js %PORT%
pause
