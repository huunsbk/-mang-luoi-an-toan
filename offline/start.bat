@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mang luoi an toan - LAN
set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY (where python >nul 2>nul && set PY=python)
if not defined PY goto nopython
%PY% -c "import qrcode" >nul 2>nul
if errorlevel 1 %PY% -m pip install -r requirements.txt
%PY% server.py
goto end
:nopython
echo Khong tim thay Python 3.
pause
:end
