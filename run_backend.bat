@echo off
echo ===================================================
echo Starting Student Training System - Python Backend
echo URL: http://localhost:8000
echo ===================================================
cd /d "%~dp0python_backend"
venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
pause
