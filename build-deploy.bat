@echo off
setlocal
set ROOT=%~dp0
set PKG=%ROOT%deploy\todo-scheduler

echo [1/5] frontend build...
cd /d %ROOT%frontend
call npm run build
if errorlevel 1 ( echo BUILD FAILED & exit /b 1 )

echo [2/5] assemble package...
if exist "%PKG%" rmdir /s /q "%PKG%"
mkdir "%PKG%"
xcopy /E /I /Q "%ROOT%backend\app" "%PKG%\app" >nul
xcopy /E /I /Q "%ROOT%frontend\dist" "%PKG%\static" >nul
copy /Y "%ROOT%backend\requirements.txt" "%PKG%\" >nul
copy /Y "%ROOT%backend\.env.example" "%PKG%\" >nul
copy /Y "%ROOT%prod-run.bat" "%PKG%\run.bat" >nul

echo [3/5] download wheels (offline install)...
"%ROOT%backend\.venv\Scripts\python.exe" -m pip download -q -r "%PKG%\requirements.txt" -d "%PKG%\wheels" --only-binary :all:
if errorlevel 1 ( echo WHEEL DOWNLOAD FAILED & exit /b 1 )

echo [4/5] read version...
for /f %%v in ('powershell -nologo -command "(Get-Content '%ROOT%backend\app\__init__.py' | Select-String '[0-9]+\.[0-9]+\.[0-9]+').Matches.Value"') do set VER=%%v
echo     version = %VER%

echo [5/5] zip...
powershell -nologo -command "Compress-Archive -Path '%PKG%' -DestinationPath '%ROOT%deploy\todo-scheduler-%VER%.zip' -Force"

echo.
echo DONE: deploy\todo-scheduler-%VER%.zip  (offline-capable)
echo       (unzip -^> run.bat -^> http://localhost:8000)
endlocal
