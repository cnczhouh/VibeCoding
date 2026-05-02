@echo off
setlocal

set "WEB_DIR=E:\mylife\gpt-image-prompt-studio"
set "LOCAL_URL=http://127.0.0.1:8787/"
set "PUBLIC_URL=https://zhouhui.tail1dc8d0.ts.net/"
set "PORT=8787"

title Prompt Studio Public Launcher

echo [1/4] Building Prompt Studio...
cd /d "%WEB_DIR%"
call npm run build
if errorlevel 1 (
  echo Build failed. Check the messages above.
  pause
  exit /b 1
)

echo [2/4] Checking local server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%LOCAL_URL%api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul

if errorlevel 1 (
  echo Starting Prompt Studio server...
  start "Prompt Studio Server" cmd /k "cd /d ""%WEB_DIR%"" && npm run server"

  echo Waiting for Prompt Studio...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 40;$i++){ try { Invoke-WebRequest -UseBasicParsing -Uri '%LOCAL_URL%api/health' -TimeoutSec 2 | Out-Null; $ok=$true; break } catch { Start-Sleep -Seconds 1 } }; if(-not $ok){ exit 1 }"
  if errorlevel 1 (
    echo Prompt Studio did not start correctly. Check the server window.
    pause
    exit /b 1
  )
) else (
  echo Local Prompt Studio server is already running.
)

echo [3/4] Starting Tailscale Funnel...
tailscale funnel --bg http://127.0.0.1:%PORT%
if errorlevel 1 (
  echo Failed to start Tailscale Funnel.
  pause
  exit /b 1
)

echo [4/4] Funnel status:
tailscale funnel status

echo.
echo Public URL:
echo %PUBLIC_URL%
echo.
start "" "%PUBLIC_URL%"

echo Keep the Prompt Studio Server window open while sharing the site.
echo To stop public access, run: tailscale funnel --https=443 off
pause
