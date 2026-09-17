# TRIACT - Restart Backend and Frontend Servers
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       Restarting TRIACT Servers         " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $RootPath) { $RootPath = (Get-Location).Path }

# 1. Kill existing processes on port 3001 (Backend) and port 5173 (Frontend)
Write-Host "`n[1/3] Stopping existing servers on ports 3001 and 5173..." -ForegroundColor Yellow

$ports = @(3001, 5173)
foreach ($port in $ports) {
    $killed = $false
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($connections) {
            foreach ($conn in $connections) {
                $procId = $conn.OwningProcess
                if ($procId -and $procId -ne 0) {
                    Write-Host "Stopping process $procId on port $port..." -ForegroundColor Yellow
                    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                    $killed = $true
                }
            }
        }
    } catch {}

    if (-not $killed) {
        $lines = netstat -ano | Select-String ":$port\s+"
        foreach ($line in $lines) {
            $tokens = ($line -split '\s+') | Where-Object { $_ -ne '' }
            $procId = $tokens[-1]
            if ($procId -match '^\d+$' -and $procId -ne '0') {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Start-Sleep -Seconds 2
Write-Host "Ports 3001 and 5173 cleared." -ForegroundColor Green

# 2. Start Backend
Write-Host "`n[2/3] Starting Backend server (Port 3001)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath\backend'; Write-Host 'Starting TRIACT Backend on Port 3001...' -ForegroundColor Green; npm run dev"

# 3. Start Frontend
Write-Host "`n[3/3] Starting Frontend server (Port 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$RootPath\frontend'; Write-Host 'Starting TRIACT Frontend on Port 5173...' -ForegroundColor Green; npm run dev"

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host " Servers launched in separate windows!   " -ForegroundColor Green
Write-Host " Backend:  http://localhost:3001         " -ForegroundColor White
Write-Host " Frontend: http://localhost:5173         " -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Green
