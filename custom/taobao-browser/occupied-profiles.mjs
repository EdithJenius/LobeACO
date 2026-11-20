import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

// A normal login window can outlive a service update. Keep that profile reserved
// until its browser exits, just like a window opened by the current service.
export async function restoreOccupiedProfiles(manager, profiles) {
  if (process.platform !== 'win32') return;
  const script = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$items=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object {
  if ($_.CommandLine -notmatch '--type=|--headless' -and $_.CommandLine -match '"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s"]+)') {
    $profileDir=@($Matches[1],$Matches[2],$Matches[3]) | Where-Object {$_} | Select-Object -First 1
    if ($profileDir.StartsWith($env:SHOP_PROFILE_PREFIX,[StringComparison]::OrdinalIgnoreCase)) {
      [PSCustomObject]@{directory=$profileDir;pid=$_.ProcessId}
    }
  }
})
ConvertTo-Json -InputObject $items -Compress`;
  const {stdout} = await promisify(execFile)('powershell.exe', ['-NoProfile','-Command',script], {
    windowsHide:true, timeout:20000,
    env:{...process.env, SHOP_PROFILE_PREFIX:path.resolve(manager.root)+path.sep},
  });
  const occupied = JSON.parse(stdout);
  for (const profile of profiles) {
    const directory = path.resolve(manager.root,profile.id).toLowerCase();
    const browser = occupied.find(item => item.directory.toLowerCase() === directory);
    if (!browser) continue;
    manager.manual.set(profile.id,browser);
    const timer = setInterval(() => {
      try { process.kill(browser.pid,0); }
      catch (error) {
        if(error.code !== 'ESRCH') return;
        clearInterval(timer);
        if(manager.manual.get(profile.id)===browser) manager.manual.delete(profile.id);
      }
    },1000);
    timer.unref();
  }
}
