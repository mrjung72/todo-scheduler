@echo off
cd /d %~dp0

rem ---- find a real python: PYEXE env -> py launcher -> python in PATH (skip WindowsApps stub)
set "PYEXE=%PYEXE%"
if defined PYEXE goto :found
py -3 --version >nul 2>&1 && set "PYEXE=py -3" && goto :found
for /f "delims=" %%p in ('where python 2^>nul ^| findstr /v /i "WindowsApps"') do (
    set "PYEXE=%%p"
    goto :found
)
echo ERROR: Python not found.
echo   - Install Python 3.14 x64 on this machine, or
echo   - set PYEXE to a full python.exe path before running this file.
pause
exit /b 1
:found

rem ---- create venv if its python.exe is missing (covers broken/partial venv)
if not exist .venv\Scripts\python.exe (
    if exist .venv rmdir /s /q .venv
    echo [setup] creating venv with %PYEXE% ...
    %PYEXE% -m venv .venv
    if errorlevel 1 ( echo [setup] venv creation FAILED & pause & exit /b 1 )
)

rem ---- install deps if uvicorn is missing (offline first via bundled wheels)
.venv\Scripts\python.exe -c "import uvicorn" >nul 2>&1 || (
    echo [setup] installing dependencies from bundled wheels, offline...
    .venv\Scripts\python.exe -m pip install --no-index --find-links wheels -r requirements.txt
    if errorlevel 1 (
        echo [setup] offline install failed, trying PyPI...
        .venv\Scripts\python.exe -m pip install -r requirements.txt
        if errorlevel 1 ( echo [setup] pip install FAILED & pause & exit /b 1 )
    )
)

echo [todo-scheduler] http://localhost:8000
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
