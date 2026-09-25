@echo off
echo [todo-scheduler] Stopping servers...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr LISTENING') do (
    echo   backend PID %%a stopped
    taskkill /F /PID %%a >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do (
    echo   frontend PID %%a stopped
    taskkill /F /PID %%a >nul 2>&1
)

echo [todo-scheduler] Done.
