$ErrorActionPreference = 'Stop'
$sourceRoot = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
$sourceProfile = Join-Path $sourceRoot 'Default'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runtime'))
$backupRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot ('chrome-backup-' + $stamp)))
$testRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot ('chromium-import-' + $stamp)))
foreach ($destination in @($backupRoot,$testRoot)) {
    if (-not $destination.StartsWith($runtimeRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Destination outside runtime' }
    if (Test-Path -LiteralPath $destination) { throw 'Destination already exists' }
}
$running = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
    $_.ExecutablePath -eq 'C:\Program Files\Google\Chrome\Application\chrome.exe' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'crashpad' -and $_.CommandLine -notmatch '--user-data-dir='
}
if ($running) { throw 'Daily Chrome is still running' }
$check=[IO.File]::Open((Join-Path $sourceProfile 'Network\Cookies'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
$check.Dispose()
New-Item -ItemType Directory -Path $backupRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'Local State') -Destination (Join-Path $backupRoot 'Local State')
# Retain persistent site data; omit caches, extensions, and tabs from unrelated browsing.
& robocopy.exe $sourceProfile (Join-Path $backupRoot 'Default') /E /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP /XD 'Cache' 'Code Cache' 'GPUCache' 'DawnCache' 'GrShaderCache' 'ShaderCache' 'Extensions' 'Sessions' 'Crashpad' /XF 'LOCK' 'SingletonLock' 'SingletonCookie' 'SingletonSocket' | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Profile backup failed; Chromium not started' }
& robocopy.exe $backupRoot $testRoot /E /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Test copy failed; Chromium not started' }
@{backupRoot=$backupRoot;testRoot=$testRoot;sourceProfile=$sourceProfile;createdAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'import-test.json') -Encoding utf8
Write-Output 'Profile backup and separate Chromium test copy created. Original unchanged.'
Write-Output $testRoot
