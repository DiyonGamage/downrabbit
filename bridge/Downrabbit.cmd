@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required: https://nodejs.org
  pause
  exit /b 1
)
pushd "%~dp0"
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8765/ping';if($r.StatusCode -eq 200){exit 0}}catch{};exit 1"
if not errorlevel 1 (
  start "" "http://127.0.0.1:8765"
  exit /b 0
)
start "downrabbit bridge" /min node server.js
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8765/ping';if($r.StatusCode -eq 200){break}}catch{};Start-Sleep -Milliseconds 250}"
start "" "http://127.0.0.1:8765"
popd
endlocal