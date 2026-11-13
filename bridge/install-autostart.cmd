@echo off
setlocal
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%~dp0Downrabbit-hidden.vbs" "%STARTUP%\Downrabbit.vbs" >nul
echo Downrabbit bridge will now start hidden with Windows.
echo To undo, run remove-autostart.cmd.
pause