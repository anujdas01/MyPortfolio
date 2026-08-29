@echo off
setlocal EnableExtensions
title MyPortfolio Launcher
cd /d "%~dp0"

echo ================================================
echo   MyPortfolio - one-click launcher
echo ================================================

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js was not found on PATH.
    pause
    exit /b 1
)

set "PROBE=cmd"
where curl.exe >nul 2>nul
if errorlevel 1 set "PROBE=ps"

echo [1/4] Checking dependencies...
if not exist "server\node_modules\" (
    echo    Installing server packages ^(first run^)...
    pushd server
    call npm.cmd install --no-audit --no-fund
    popd
    if errorlevel 1 goto :fail_install
)
if not exist "client\node_modules\" (
    echo    Installing client packages ^(first run^)...
    pushd client
    call npm.cmd install --no-audit --no-fund
    popd
    if errorlevel 1 goto :fail_install
)

echo [2/4] Building the web app...
pushd client
call npm.cmd run build
popd
if errorlevel 1 goto :fail_build

echo [3/4] Starting server...
call :probe
if errorlevel 1 (
    start "MyPortfolio Server" /min cmd /k "title MyPortfolio Server - close this window to stop the app && node server\src\index.js"
) else (
    echo    Server is already running - reusing it.
)

set /a tries=0
:waitloop
call :probe
if not errorlevel 1 goto :ready
set /a tries+=1
if %tries% GEQ 30 goto :fail_server
ping -n 2 127.0.0.1 >nul
goto :waitloop

:ready
echo [4/4] Opening http://localhost:3001 in your browser...
start "" "http://localhost:3001"
echo.
echo    MyPortfolio is ready!
echo    Keep the minimized "MyPortfolio Server" window open while using the app.
echo    Close it to stop the server.
echo.
ping -n 11 127.0.0.1 >nul
exit /b 0

:probe
if "%PROBE%"=="ps" (
    powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:3001/api/auth/status' | Out-Null; exit 0 } catch { exit 1 }"
    exit /b
)
curl.exe -s -o nul -m 2 http://127.0.0.1:3001/api/auth/status >nul 2>&1
exit /b

:fail_install
echo.
echo ERROR: Failed to install dependencies. See output above.
pause
exit /b 1

:fail_build
echo.
echo ERROR: Client build failed. See output above.
pause
exit /b 1

:fail_server
echo.
echo ERROR: Server did not become healthy within 30 seconds.
echo        Check the "MyPortfolio Server" window for details.
pause
exit /b 1
