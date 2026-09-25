@echo off
echo [todo-scheduler] Stopping servers...

rem 1) kill the spawned console windows and their whole process trees
taskkill /F /T /FI "WINDOWTITLE eq todo-backend*" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq todo-frontend*" >nul 2>&1

rem 2) kill anything still listening on the ports (incl. orphaned workers)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr LISTENING') do (
    echo   port 8000 PID %%a stopped
    taskkill /F /T /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do (
    echo   port 5173 PID %%a stopped
    taskkill /F /T /PID %%a >nul 2>&1
)

echo [todo-scheduler] Done.
