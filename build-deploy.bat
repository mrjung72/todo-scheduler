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
rem license key -> app/license.key : 발급 프로젝트로 무료 키(5명,빌드일+365일) 자동 생성
set LICGEN=%ROOT%..\todo-scheduler-license
if exist "%LICGEN%\license_signer.py" (
    "%ROOT%backend\.venv\Scripts\python.exe" -c "import sys;sys.path.insert(0,r'%LICGEN%');from license_signer import make_key;from datetime import date,timedelta;open(r'%PKG%\app\license.key','w').write(make_key('FREE',(date.today()+timedelta(days=365)).isoformat(),'free',None))"
    if errorlevel 1 ( echo [warn] license generation FAILED ) else ( echo     license: free key generated ^(exp +365d^) )
    goto :lic_done
)
if exist "%ROOT%backend\license-deploy.key" (
    copy /Y "%ROOT%backend\license-deploy.key" "%PKG%\app\license.key" >nul
    echo     license: copied license-deploy.key
) else (
    echo [warn] license key 없음 - 라이선스 키 없이 패키징됨
)
:lic_done

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
