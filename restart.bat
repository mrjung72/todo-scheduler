@echo off
call "%~dp0stop.bat"
ping -n 3 127.0.0.1 >nul
call "%~dp0start.bat"
