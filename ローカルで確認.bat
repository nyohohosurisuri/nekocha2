@echo off
cd /d %~dp0
echo ローカルサーバーを起動します...
echo PCでは http://localhost:4173 を開いてください。
echo 同じWi-FiのiPhoneでは、下のURL候補を開いてください。
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { '  http://' + $_.IPAddress + ':4173' }"
echo 終了するにはこの画面を閉じるか Ctrl+C を押してください。
echo.
call npm run preview -- --host 0.0.0.0 --port 4173 --open http://localhost:4173
pause
