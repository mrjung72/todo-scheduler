@echo off
echo [todo-scheduler] Starting servers...

start "todo-backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload"
start "todo-frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo [todo-scheduler] Started.
echo   - backend : http://localhost:8000  (API docs: /docs)
echo   - frontend: http://localhost:5173
