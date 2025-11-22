@echo off

start "" http://localhost:4173

cd /d "%~dp0kemono-peruse"
npm run preview:all
pause
