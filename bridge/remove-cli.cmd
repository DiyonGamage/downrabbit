@echo off
setlocal
if exist "%LOCALAPPDATA%\downrabbit\downr.cmd" del "%LOCALAPPDATA%\downrabbit\downr.cmd"
powershell -NoProfile -Command "$b=Join-Path $env:LOCALAPPDATA 'downrabbit'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if($p){ $n=(($p -split ';') | Where-Object { $_ -and $_ -ne $b }) -join ';'; [Environment]::SetEnvironmentVariable('Path',$n,'User') }"
echo downr removed. files you already downloaded are untouched.
pause
