@echo off
cd /d %~dp0
echo ローカルサーバーを起動します...
echo PCでは http://localhost:4173 を開いてください。
echo iPhone SafariではGitHub Pagesではなく、同じWi-Fiで下のURL候補を開いてください。
echo Windowsファイアウォールの確認が出た場合は、アクセスを許可してください。
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Sort-Object InterfaceAlias | ForEach-Object { '  ' + $_.InterfaceAlias + '  http://' + $_.IPAddress + ':4173' }"
echo 終了するにはこの画面を閉じるか Ctrl+C を押してください。
echo.
call npm run preview -- --host 0.0.0.0 --port 4173 --open http://localhost:4173
pause
