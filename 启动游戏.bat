@echo off
chcp 65001 >nul
title 星莓的一天 · 启动中
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  未检测到 Node.js，请先安装 Node.js（版本 18 或更高）：
  echo  https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖，请稍候……
  call npm install
  if errorlevel 1 (
    echo.
    echo  依赖安装失败，请检查网络后重试。
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  正在启动《星莓的一天》……
echo  浏览器会自动打开（若未打开，请访问 http://localhost:5173/）
echo  关闭本窗口即可停止游戏。
echo.
call npm run dev
pause
