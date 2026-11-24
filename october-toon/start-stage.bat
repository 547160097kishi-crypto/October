@echo off
chcp 65001 >nul
rem ============================================================
rem  十月 Toon - 发布会一键启动（Windows，双击运行）
rem  1. 第一次运行会自动安装依赖（需要联网，之后不需要）
rem  2. 打包网页 -> 启动本地服务 -> 用 Chrome 全屏打开发布会模式
rem  关闭：关掉 Chrome，再关掉这个黑色窗口
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先到 https://nodejs.org 下载安装 LTS 版本，然后重新双击本文件。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 第一次运行，正在安装依赖……
  call npm install
  if errorlevel 1 ( echo [错误] 依赖安装失败，请检查网络 & pause & exit /b 1 )
)

echo 正在打包……
call npm run build
if errorlevel 1 ( echo [错误] 打包失败 & pause & exit /b 1 )

rem 网页服务开在单独的窗口里（演出期间不要关）
start "October Server" cmd /k npx vite preview --port 4173 --strictPort
timeout /t 3 >nul

rem 现场调参：改下面引号里的网址，例如  set "URL=http://localhost:4173/?stage&thickness=0.25&scale=0.75"
set "URL=http://localhost:4173/?stage"
start "" chrome --kiosk --window-position=0,0 --autoplay-policy=no-user-gesture-required "%URL%"
if errorlevel 1 start "" "%URL%"

echo 已打开："%URL%"
echo 关闭：Alt+F4 关掉 Chrome，再关掉 "October Server" 窗口。
timeout /t 5 >nul
