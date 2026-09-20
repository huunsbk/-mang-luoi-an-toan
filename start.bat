@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Mang luoi an toan - Child Protection Training
set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY (where python >nul 2>nul && set PY=python)
if not defined PY goto nopython
%PY% -c "import qrcode" >nul 2>nul
if errorlevel 1 (
  echo Dang cai thu vien QR lan dau...
  %PY% -m pip install -r requirements.txt
  if errorlevel 1 goto nodeps
)
%PY% server.py
goto end
:nopython
echo.
echo KHONG TIM THAY PYTHON 3 TREN MAY.
echo Cai Python 3 tu https://www.python.org/downloads/ va chon "Add Python to PATH".
echo.
pause
goto end
:nodeps
echo.
echo KHONG CAI DUOC THU VIEN QR. Hay ket noi Internet va chay lai start.bat mot lan.
echo.
pause
:end
