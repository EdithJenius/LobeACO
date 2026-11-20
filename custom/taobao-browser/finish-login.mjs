import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

// Ask only the scoped Chromium browser to save and close its login window normally.
export async function finishLoginWindow(manager,account) {
  const window=manager.manual.get(account);
  if(!window)return;
  if(process.platform!=='win32'||!Number.isSafeInteger(window.pid))throw Error('请手动关闭这家店铺的登录窗口，系统会自动核验');
  const script=`$ErrorActionPreference='Stop'
$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:SHOP_WINDOW_PID)
if(!$p){exit 0}
if($p.Name -ne 'chrome.exe' -or $p.CommandLine -match '--type=' -or $p.CommandLine -notmatch '"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s"]+)'){throw 'Cannot verify browser process'}
$directory=@($Matches[1],$Matches[2],$Matches[3]) | Where-Object {$_} | Select-Object -First 1
if([IO.Path]::GetFullPath($directory) -ne $env:SHOP_WINDOW_DIR){throw 'Profile mismatch'}
$proc=Get-Process -Id $p.ProcessId
if(!$proc.CloseMainWindow()){throw 'Cannot close login window'}
`;
  try{
    await promisify(execFile)('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,timeout:6000,env:{...process.env,SHOP_WINDOW_PID:String(window.pid),SHOP_WINDOW_DIR:path.resolve(manager.root,account)}});
  }catch{throw Error('请正常关闭该店铺的登录窗口，关闭后系统会自动核验');}
}
