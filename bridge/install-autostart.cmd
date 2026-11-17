@echo off
setlocal
set "BD=%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\Downrabbit.vbs" echo Set sh = CreateObject("WScript.Shell")
>> "%STARTUP%\Downrabbit.vbs" echo sh.CurrentDirectory = "%BD%"
>> "%STARTUP%\Downrabbit.vbs" echo sh.Run "node server.js", 0, False
echo Downrabbit bridge will now start hidden with Windows.
echo To undo, run remove-autostart.cmd.
pause