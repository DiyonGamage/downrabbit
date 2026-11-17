@echo off
setlocal
net session >nul 2>nul
if errorlevel 1 (
  echo This lets other devices on your Wi-Fi reach the Downrabbit bridge ^(TCP 8765^).
  echo Windows will ask for administrator rights - click Yes to continue.
  echo.
  pause
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Adding Windows Firewall rule: Downrabbit Bridge ^(LAN^), inbound TCP 8765...
powershell -NoProfile -Command "New-NetFirewallRule -DisplayName 'Downrabbit Bridge (LAN)' -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Any | Out-Null"
echo.
echo Done. Phones / tablets / other PCs on the same Wi-Fi can now open the bridge address.
echo Find it in Downrabbit settings - "open on another device", or in the launcher window.
echo.
echo To undo later, run this in an admin terminal:
echo   netsh advfirewall firewall delete rule name="Downrabbit Bridge (LAN)"
echo.
pause
endlocal