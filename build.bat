@echo off
setlocal
cd /d "%~dp0"
pyinstaller --noconfirm --windowed --name "24色卡实时统计工具" --collect-all PySide6 --hidden-import mss app.py
if errorlevel 1 (
  echo.
  echo 打包失败。
  pause
  exit /b 1
)
echo.
echo 打包完成，产物位于 dist\24色卡实时统计工具\
pause
