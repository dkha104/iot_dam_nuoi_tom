@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 22 tro len, khuyen dung Node.js 24 LTS.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Mo trinh duyet tai http://localhost:3000 sau khi server san sang.
call npm start
pause
