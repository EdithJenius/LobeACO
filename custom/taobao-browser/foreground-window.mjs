import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

// A crash/reboot can cause Chromium to discard the saved startup tab. Recover
// only a newly launched, otherwise empty window belonging to this profile.
export async function recoverBlankLogin(browser, executable, directory, url) {
  if (process.platform !== 'win32') return;
  const script = fileURLToPath(new URL('./login-tabs.ps1',import.meta.url));
  const inspect = (...flags) => promisify(execFile)('powershell.exe',
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-BrowserPid',String(browser.pid),...flags],
    {windowsHide:true,timeout:5000});
  await delay(700);
  if ((await inspect()).stdout.trim() !== 'empty') return;
  const forward = spawn(executable,[`--user-data-dir=${directory}`,url],{stdio:'ignore',windowsHide:false});
  const [code] = await once(forward,'exit');
  if (code !== 0) throw Error('无法在该账号的窗口打开平台页面');
  await inspect('-Cleanup');
}

// Windows may start Chromium successfully before it has created a desktop window.
// Use the tracked browser PID so another shop's Chromium never receives focus.
export async function showLoginWindow(browser) {
  if (process.platform !== 'win32') return;
  if (!Number.isSafeInteger(browser?.pid)) throw Error('登录窗口已退出，请重新打开');
  const script = `$ErrorActionPreference='Stop'
$p=Get-Process -Id $env:SHOP_FOREGROUND_PID
if($p.ProcessName -ne 'chrome' -or $p.SessionId -ne (Get-Process -Id $PID).SessionId){exit 1}
for($i=0;$i -lt 50;$i++){
  $p.Refresh()
  if($p.HasExited){exit 1}
  if($p.MainWindowHandle -ne 0) {
    $shell=New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($p.Id)
    exit 0
  }
  Start-Sleep -Milliseconds 200
}
exit 1`;
  try {
    await promisify(execFile)('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {
      env: {...process.env, SHOP_FOREGROUND_PID:String(browser.pid)}, timeout:15000, windowsHide:true,
    });
  } catch {
    throw Error('未检测到该账号的可见浏览器窗口，请稍后重试');
  }
}
