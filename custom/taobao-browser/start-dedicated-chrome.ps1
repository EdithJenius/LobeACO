param(
    [ValidateSet('taobao-a','taobao-b')]
    [string]$Account = 'taobao-a'
)
$ErrorActionPreference = 'Stop'
$chromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chromeExe)) { throw '未找到正式 Chrome。' }
$profileRoot = Join-Path $PSScriptRoot ('runtime\profiles-chrome\' + $Account)
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
$loginUrl = 'https://loginmyseller.taobao.com/?from=taobaoindex&f=top&style=&sub=true&redirect_url=https%3A%2F%2Fmyseller.taobao.com%2F'
# Explicitly visible: this is the user's interactive login window.
# Keep this profile separate from daily Chrome and from the Chromium test profiles.
Start-Process -FilePath $chromeExe -ArgumentList @(
    ('--user-data-dir="' + $profileRoot + '"'),
    '--no-first-run',
    '--restore-last-session',
    '--no-default-browser-check',
    $loginUrl
)
Write-Output ('已打开正式 Chrome 专用店铺环境：' + $Account)
Write-Output ('Profile：' + $profileRoot)
Write-Output '登录成功后，请关闭该专用窗口，再测试 Chromium 副本。'
