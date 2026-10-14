$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FrontendRoot = Join-Path $ProjectRoot 'frontend'
Push-Location $FrontendRoot
try { npm run dev -- --host 0.0.0.0 } finally { Pop-Location }
