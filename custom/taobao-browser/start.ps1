param([switch]$NoUI)
$ErrorActionPreference = 'Stop'
$prototypeRoot = $PSScriptRoot
$runtimePath = Join-Path $prototypeRoot 'runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$existing = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue
if (-not $existing) {
    Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'service.mjs' -WorkingDirectory $prototypeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath 'service.log') -RedirectStandardError (Join-Path $runtimePath 'service-error.log')
    Start-Sleep -Seconds 2
}
if (-not $NoUI) { Start-Process 'http://127.0.0.1:18765/' }
