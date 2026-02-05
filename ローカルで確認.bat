@echo off
cd /d %~dp0
echo ローカルサーバーを起動し、ブラウザを開きます...
echo 終了するにはこの画面を閉じるか Ctrl+C を押してください。
echo.
call npm run preview -- --open
pause
