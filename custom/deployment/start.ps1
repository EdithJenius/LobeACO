$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    function Test-DockerEngine {
        try {
            docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
            return ($LASTEXITCODE -eq 0)
        } catch { return $false }
    }
    if (-not (Test-DockerEngine)) {
        docker desktop start --detach
        if ($LASTEXITCODE -ne 0) { throw 'Could not start Docker Desktop.' }
        $deadline = (Get-Date).AddMinutes(2)
        while (-not (Test-DockerEngine)) {
            if ((Get-Date) -ge $deadline) { throw 'Docker engine did not become ready.' }
            Start-Sleep -Seconds 2
        }
    }

    $compose = @('-f', 'compose.yml', '-f', 'compose.checkout-spa.yml')
    $config = docker compose @compose config --format json checkout-spa
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the LobeHub frontend configuration.' }
    $mount = ($config | Out-String | ConvertFrom-Json).services.'checkout-spa'.volumes |
        Where-Object { $_.target -eq '/shop-runtime' -and $_.type -eq 'bind' }
    if (-not $mount.source) { throw 'Missing host shop-runtime mount.' }
    $shopRoot = Split-Path (Split-Path $mount.source -Parent) -Parent
    & (Join-Path $shopRoot 'start.ps1') -NoUI

    docker compose @compose up -d
    if ($LASTEXITCODE -ne 0) { throw 'LobeHub Compose startup failed.' }
    $probe = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'check-shop-startup.cjs') -Raw -Encoding UTF8
    $deadline = (Get-Date).AddMinutes(1)
    do {
        $probe | docker compose @compose exec -T checkout-spa node
        if ($LASTEXITCODE -eq 0) {
            Write-Host 'LobeHub: http://localhost:3210'
            return
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw 'Startup incomplete: the LobeHub backend or the host shop list could not be reached.'
} finally { Pop-Location }
