@echo off
cd /d "%~dp0.."
set "PYTHONPATH=%CD%\backend;%CD%"
python -m atlas_api
pause
