# LocalPress launcher: makes sure the portable Node exists inside the app folder,
# reuses a running server if there is one, otherwise starts the server in this window.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$App = $PSScriptRoot
$NodeVersion = '24.21.0'
$NodeSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

$RuntimeDir = Join-Path $App 'runtime'
$NodeDir = Join-Path $RuntimeDir 'node'
$NodeExe = Join-Path $NodeDir 'node.exe'
$StateFile = Join-Path $App '.state\server.json'

# 1. Already running? Just open the tab.
if (Test-Path $StateFile) {
  try {
    $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    $url = "http://127.0.0.1:$($state.port)/"
    $ping = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$($url)api/ping"
    if ($ping.Content -match '"app":"localpress"') {
      Write-Host "LocalPress is already running at $url - opening it."
      Start-Process $url
      exit 0
    }
  } catch { }
}

# 2. Portable Node inside the app folder (never the one installed on the PC).
if (-not (Test-Path $NodeExe)) {
  Write-Host "First launch: downloading Node $NodeVersion (about 30 MB) into app\runtime ..."
  New-Item -ItemType Directory -Force $RuntimeDir | Out-Null
  $zip = Join-Path $RuntimeDir 'node.zip.part'
  $tmp = Join-Path $RuntimeDir '.extract'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  (New-Object Net.WebClient).DownloadFile($NodeUrl, $zip)

  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $NodeSha256) {
    Remove-Item $zip -Force
    throw "Node download failed verification (got $hash). Nothing was installed."
  }

  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force $tmp | Out-Null
  & "$env:SystemRoot\System32\tar.exe" -xf $zip -C $tmp
  if ($LASTEXITCODE -ne 0) { throw "Could not extract Node." }
  Move-Item (Join-Path $tmp "node-v$NodeVersion-win-x64") $NodeDir
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zip -Force
  Write-Host "Node installed."
}

# 3. Run the server here; closing this window stops LocalPress.
Write-Host "Starting LocalPress ... (close this window to stop it)"
& $NodeExe (Join-Path $App 'server.js')
exit $LASTEXITCODE
