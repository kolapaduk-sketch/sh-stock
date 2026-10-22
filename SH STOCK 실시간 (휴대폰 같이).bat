@echo off
chcp 65001 >nul
title SH STOCK realtime
cd /d "%~dp0"
python tools\live_server.py --open --lan
echo.
echo Server stopped. Press any key to close.
pause >nul
