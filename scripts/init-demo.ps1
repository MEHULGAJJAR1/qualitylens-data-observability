$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendRoot = Join-Path $ProjectRoot 'backend'
$Python = Join-Path $BackendRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) { $Python = 'python' }
Push-Location $BackendRoot
try {
  & $Python -m app.cli init-db
  if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
  & $Python -m app.cli demo
  if ($LASTEXITCODE -ne 0) { throw 'Demo monitoring pipeline failed.' }
} finally { Pop-Location }
