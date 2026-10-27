@echo off
rem Developer-only: installs Playwright and its Chromium inside tests\e2e (never globally)
rem using the app's portable Node, then runs the browser tests.
setlocal
cd /d "%~dp0"
set "NODE_DIR=%~dp0..\..\app\runtime\node"
if not exist "%NODE_DIR%\node.exe" (
  echo Run start.bat once first: it installs the portable Node these tests use.
  exit /b 1
)
if not exist "%~dp0..\..\app\tools\ffmpeg\bin\ffmpeg.exe" (
  echo Install the tools first ^(Tools panel in the app^): the tests encode real clips.
  exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0.browsers"
set "npm_config_cache=%~dp0.tmp\npm-cache"

if not exist node_modules\@playwright\test (
  call npm install --no-audit --no-fund || exit /b 1
)
if not exist .browsers (
  call npx playwright install chromium || exit /b 1
)
call npx playwright test %*
