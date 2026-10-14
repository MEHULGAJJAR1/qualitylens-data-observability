$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendRoot = Join-Path $ProjectRoot 'backend'
$FrontendRoot = Join-Path $ProjectRoot 'frontend'
$VenvPath = Join-Path $BackendRoot '.venv'

Write-Host 'QualityLens setup' -ForegroundColor Cyan
if (Get-Command py -ErrorAction SilentlyContinue) {
  & py -3 -m venv $VenvPath
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  & python -m venv $VenvPath
} else {
  throw 'Python 3 is required. Install Python 3.11+ and retry.'
}
$Python = Join-Path $VenvPath 'Scripts\python.exe'
& $Python -m pip install --upgrade pip
& $Python -m pip install -r (Join-Path $BackendRoot 'requirements.txt')

$EnvFile = Join-Path $BackendRoot '.env'
if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $BackendRoot '.env.example') $EnvFile
  Write-Host 'Created backend\.env from .env.example (SQLite default).' -ForegroundColor Green
}

Push-Location $FrontendRoot
try { npm install } finally { Pop-Location }
Write-Host ''
Write-Host 'Dependencies installed.' -ForegroundColor Green
Write-Host 'Next: .\scripts\init-demo.ps1, then start the backend and frontend in separate terminals.' -ForegroundColor Cyan
