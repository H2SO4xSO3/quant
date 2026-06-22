@echo off
setlocal
set "KEY=%USERPROFILE%\.ssh\quant_vultr_ed25519"
set "URL=http://127.0.0.1:8791"
echo Opening SSH tunnel to the VPS dashboard...
echo VPS dashboard will open at %URL%
echo Keep the tunnel window open while using the dashboard.
start "VPS Quant Dashboard Tunnel" cmd /k ssh -i "%KEY%" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N -L 8791:127.0.0.1:8790 root@167.179.110.244
timeout /t 2 /nobreak >nul
start "" "%URL%"
