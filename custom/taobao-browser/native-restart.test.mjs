import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {prepareProfile} from './core.mjs';

test('ordinary Windows Chromium retains a session cookie after window close and restart', {skip:process.platform!=='win32', timeout:60000}, async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'store-native-restart-'));
  const server=http.createServer();
  let child;
  try {
    await prepareProfile(root);
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const base='http://127.0.0.1:'+server.address().port;
    for(const step of ['login','verify']){
      const received=Promise.withResolvers();
      const listener=(req,res)=>{
        if(req.url==='/'+step){
          if(step==='login') res.setHeader('Set-Cookie','fixture=local-only; Path=/; HttpOnly');
          received.resolve(req.headers.cookie||'');
        }
        res.end('Local profile persistence check');
      };
      server.on('request',listener);
      child=spawn(chromium.executablePath(),['--user-data-dir='+root,'--no-first-run','--no-default-browser-check','--restore-last-session',base+'/'+step],{stdio:'ignore'});
      const exited=once(child,'exit');
      const cookies=await Promise.race([received.promise,exited.then(()=>{throw Error('Window exited before fixture loaded')})]);
      if(step==='verify') assert.match(cookies,/fixture=local-only/);
      await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`if (-not (Get-Process -Id ${child.pid}).CloseMainWindow()) { exit 1 }`],{windowsHide:true});
      await exited;
      server.off('request',listener);
    }
  }finally{
    if(child && child.exitCode===null) child.kill();
    server.close();
    if(path.dirname(root)===os.tmpdir() && path.basename(root).startsWith('store-native-restart-')) await fs.rm(root,{recursive:true,force:true,maxRetries:3});
  }
});

test('ordinary shop login opens the landing page on two launches with no restored about:blank tabs', {skip:process.platform!=='win32',timeout:90000}, async()=>{
  const {BrowserManager}=await import('./core.mjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shop-login-tabs-'));
  const manager=new BrowserManager(root,{headless:true});
  const server=http.createServer((_req,res)=>res.end('<html><title>Shop login test</title>Shop login</html>'));
  let child;
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const homeUrl='http://127.0.0.1:'+server.address().port+'/';
    manager.platform=()=>({id:'taobao',homeUrl});
    const ctx=await manager.context('taobao-a');
    await ctx.newPage();await ctx.newPage();await ctx.close();
    for(let i=0;i<2;i++){
      try { await manager.openManualLogin('taobao-a'); }
      finally { child=manager.manual.get('taobao-a'); }
      const exited=once(child,'exit');
      const script=`
        Add-Type -AssemblyName UIAutomationClient
        $p=Get-Process -Id ${child.pid}
        for($i=0;$i -lt 30;$i++){
          $p.Refresh()
          if($p.MainWindowHandle -ne 0){
            $w=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
            $c=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)
            $names=@($w.FindAll([System.Windows.Automation.TreeScope]::Descendants,$c) | ForEach-Object {$_.Current.Name})
            if(($names -join ' ') -like '*Shop login test*'){break}
          }
          Start-Sleep -Milliseconds 200
        }
        if(-not $p.CloseMainWindow()){throw 'Test window did not close'}
        ConvertTo-Json -Compress -InputObject @($names)
      `;
      const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',script],{windowsHide:true,timeout:15000});
      const labels=JSON.parse(stdout);
      assert.equal(labels.filter(s=>s.includes('Shop login test')).length,1,JSON.stringify(labels));
      assert.ok(labels.every(s=>!s.includes('about:blank')),JSON.stringify(labels));
      await exited;
    }
  }finally{
    if(child && child.exitCode===null) child.kill();
    await manager.closeAll();server.close();
    await fs.rm(root,{recursive:true,force:true,maxRetries:4});
  }
});
