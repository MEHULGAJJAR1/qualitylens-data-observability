$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendRoot = Join-Path $ProjectRoot 'backend'
$Python = Join-Path $BackendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) { $Python = 'python' }
Push-Location $BackendRoot
try {
  & $Python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
} finally { Pop-Location }
