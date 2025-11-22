@echo off

start "" http://localhost:5151

cd /d "%~dp0kemono-peruse"
start "Kemono Peruse Proxy" cmd /c "npm run proxy"
timeout /t 2 >nul
npm run preview
pause
