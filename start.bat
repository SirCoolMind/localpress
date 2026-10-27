@echo off
title LocalPress
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\bootstrap.ps1"
if errorlevel 1 (
  echo.
  echo LocalPress stopped with an error. See the messages above.
  pause
)
