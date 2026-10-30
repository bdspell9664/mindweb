@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"
title 心络 · Mindweb

echo.
echo   心 络 · INNER SYNAPSE MAP
echo   ------------------------------------
echo.

rem 已经在跑就直接打开浏览器，绝不再起第二个服务：
rem 换端口等于换一个空的数据库，旧日志会“消失”。
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto running

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "node_modules\vite" goto install

:run
echo   正在启动，浏览器会自动打开...
echo.
echo   地址固定为 http://localhost:5173
echo   你的日志只存在这个地址下，别用 IP 或别的端口打开它。
echo   关掉这个窗口就等于退出心络。
echo.
call npm run dev -- --open
goto end

:running
echo   心络已经在运行，正在打开浏览器...
echo.
echo   地址：http://localhost:5173
echo.
echo   如果打开的页面不是心络，说明 5173 被别的程序占了，
echo   先把那个程序关掉，再双击本文件。
echo   如果页面打不开，可能是上次的进程卡住了：
echo   在任务管理器里结束所有 node.exe，再双击本文件。
echo.
start "" http://localhost:5173
echo.
pause
goto end

:install
echo   第一次启动，正在安装依赖（需要联网，大约一分钟）...
echo.
call npm install
if errorlevel 1 goto install_failed
echo.
goto run

:no_node
echo   没找到 Node.js。
echo.
echo   请先安装 Node.js 20 或更高版本：https://nodejs.org
echo   装好之后，再双击本文件。
echo.
pause
goto end

:install_failed
echo.
echo   依赖安装失败。
echo   先检查网络，或者在这个文件夹里打开命令行手动运行：npm install
echo.
pause
goto end

:end
endlocal
