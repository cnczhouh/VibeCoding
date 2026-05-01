@echo off
setlocal
cd /d "%~dp0"
python git_easy.py
if errorlevel 1 (
  echo.
  echo Failed to start Git Easy. Please make sure Python and Git are installed.
  pause
)
