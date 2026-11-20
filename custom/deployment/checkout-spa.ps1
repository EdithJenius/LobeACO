param(
    [ValidateSet('Start', 'Restore')][string]$Action = 'Start',
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
$baseCompose = Join-Path $PSScriptRoot 'compose.yml'
$checkoutCompose = Join-Path $PSScriptRoot 'compose.checkout-spa.yml'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Invoke-Compose {
    param([string[]]$Files, [string[]]$Arguments)
    $options = foreach ($file in $Files) { '-f'; $file }
    docker compose @options @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed with status $LASTEXITCODE." }
}

if ($Action -eq 'Restore') {
    Invoke-Compose -Files $baseCompose,$checkoutCompose -Arguments 'stop','checkout-spa'
    Invoke-Compose -Files $baseCompose -Arguments 'up','-d','--no-deps','lobe'
    Write-Host 'Stock LobeHub at http://localhost:3210'
    return
}

if ($Build -or !(Test-Path (Join-Path $repo 'dist/desktop/index.html')) -or !(Test-Path (Join-Path $repo 'dist/mobile/index.mobile.html'))) {
    $originalMobile = $env:MOBILE
    Push-Location -LiteralPath $repo
    try {
        $env:MOBILE = 'false'
        node node_modules/vite/bin/vite.js build
        if ($LASTEXITCODE -ne 0) { throw 'Desktop SPA build failed.' }

        $env:MOBILE = 'true'
        node node_modules/vite/bin/vite.js build
        if ($LASTEXITCODE -ne 0) { throw 'Mobile SPA build failed.' }
    } finally {
        $env:MOBILE = $originalMobile
        Pop-Location
    }
}

Invoke-Compose -Files $baseCompose,$checkoutCompose -Arguments 'up','-d','--no-deps','lobe'
Invoke-Compose -Files $baseCompose,$checkoutCompose -Arguments 'up','-d','--no-deps','checkout-spa'
if ($Build) {
    Invoke-Compose -Files $baseCompose,$checkoutCompose -Arguments 'restart','checkout-spa'
}
Write-Host 'Checkout LobeHub at http://localhost:3210'
