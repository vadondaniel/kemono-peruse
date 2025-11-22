@echo off
setlocal EnableDelayedExpansion

set "DEV_PORT=5173"
set "ENV_FILE=%~dp0kemono-peruse\.env"

if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    set "key=%%A"
    set "value=%%B"
    for /f "tokens=* delims= " %%K in ("!key!") do set "key=%%K"
    if /i "!key!"=="VITE_DEV_SERVER_PORT" (
      for /f "tokens=1 delims=#;" %%C in ("!value!") do set "value=%%C"
      for /f "tokens=* delims= " %%C in ("!value!") do set "value=%%C"
      set "value=!value:"=!"
      if defined value set "DEV_PORT=!value!"
    ) else if /i "!key!"=="VITE_PORT" (
      for /f "tokens=1 delims=#;" %%C in ("!value!") do set "value=%%C"
      for /f "tokens=* delims= " %%C in ("!value!") do set "value=%%C"
      set "value=!value:"=!"
      if defined value set "DEV_PORT=!value!"
    )
  )
)

start "" http://localhost:%DEV_PORT%

cd /d "%~dp0kemono-peruse"
npm run host:all
