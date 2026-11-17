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
if not errorlevel 1 goto ready
start "downrabbit bridge" /min node server.js
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:8765/ping';if($r.StatusCode -eq 200){break}}catch{};Start-Sleep -Milliseconds 250}"
:ready
echo.
echo   Downrabbit is running.
echo   On this PC:       http://127.0.0.1:8765
powershell -NoProfile -Command "try{$j=Invoke-RestMethod -TimeoutSec 2 'http://127.0.0.1:8765/ping';foreach($u in $j.lan){Write-Host ('   On your network:  '+$u)}}catch{}"
echo.
echo   Phone / tablet / other PC on the same Wi-Fi: open the "On your network" address above.
echo   First time only: run allow-firewall.cmd once so other devices can reach this PC.
echo.
start "" "http://127.0.0.1:8765"
popd
endlocal