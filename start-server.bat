@echo off
echo Starting Gshop Server with Node 20...
echo.

REM Check if Node 20 is available in WSL
wsl test -f /tmp/node-v20.20.2-linux-x64/bin/node
if %ERRORLEVEL% EQU 0 (
    echo Found Node 20 in WSL, starting server...
    wsl cd /mnt/c/Users/MSI\ CYBORG/.openclaw/workspace/gshop-app/server \&\& /tmp/node-v20.20.2-linux-x64/bin/node start-node20.js
) else (
    echo Node 20 not found in WSL.
    echo Please install Node 20 or run: wsl /tmp/node-v20.20.2-linux-x64/bin/node start-node20.js
    pause
)
