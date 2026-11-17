@echo off
setlocal
set "HERE=%~dp0"
set "BIN=%LOCALAPPDATA%\downrabbit"
set "JS="
if exist "%HERE%bridge\downr.js" set "JS=%HERE%bridge\downr.js"
if not defined JS if exist "%HERE%downr.js" set "JS=%HERE%downr.js"
if not defined JS (
  echo downr.js was not found next to this script.
  pause
  exit /b 1
)
if not exist "%BIN%" mkdir "%BIN%"

> "%BIN%\downr.cmd" echo @echo off
if exist "%HERE%node.exe" (
  >> "%BIN%\downr.cmd" echo "%HERE%node.exe" "%JS%" %%*
) else (
  >> "%BIN%\downr.cmd" echo node "%JS%" %%*
)

powershell -NoProfile -Command "$b=Join-Path $env:LOCALAPPDATA 'downrabbit'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''}; if(($p -split ';') -notcontains $b){ [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';' + $b).TrimStart(';')), 'User'); Write-Host ('added to PATH: ' + $b) } else { Write-Host 'already on PATH' }"

echo.
echo installed. open a NEW terminal (or restart this one), then:
echo    downr "https://youtu.be/..."
echo default folder: %USERPROFILE%\Downloads
echo remove anytime with remove-cli.cmd
pause
