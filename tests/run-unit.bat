@echo off
rem Runs the unit tests with the app's own portable Node (start.bat installs it).
cd /d "%~dp0.."
if not exist "app\runtime\node\node.exe" (
  echo Run start.bat once first: it installs the portable Node these tests use.
  exit /b 1
)
"app\runtime\node\node.exe" --test "tests/unit/*.test.js"
