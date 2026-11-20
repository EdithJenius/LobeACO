import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
let allowSet=true;
const server=http.createServer((req,res)=>{if(req.url==='/set'&&allowSet){allowSet=false;res.setHeader('Set-Cookie',['fixture_session=value; Path=/; HttpOnly','fixture_persistent=value; Path=/; Max-Age=3600']);}res.end('<h1>Local login persistence test</h1>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const results=[];
async function launch(root,landing){
 await fs.rm(path.join(root,'DevToolsActivePort'),{force:true});
 const child=spawn(chromium.executablePath(),[`--user-data-dir=${root}`,'--no-first-run','--no-default-browser-check','--restore-last-session','--remote-debugging-port=0',landing],{stdio:'ignore',windowsHide:false});
 let port;
 for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(root,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!port)throw Error('Browser debugging port not ready');
 try{const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:10000});return {child,browser,ctx:browser.contexts()[0]};}catch(e){child.kill();throw e;}
}
async function closeWindows(run){for(const p of run.ctx.pages())await p.close().catch(()=>{});for(let i=0;i<50&&run.child.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));if(run.child.exitCode===null){const cdp=await run.browser.newBrowserCDPSession();await cdp.send('Browser.close').catch(()=>{});await new Promise(r=>run.child.once('exit',r));return 'Browser.close fallback';}return 'last window closed';}
try{
 for(const mode of ['flag-only','saved-preference']){
  allowSet=true;
  const root=path.resolve('runtime',`window-close-${mode}-${Date.now()}`);await fs.mkdir(path.join(root,'Default'),{recursive:true});
  if(mode==='saved-preference')await fs.writeFile(path.join(root,'Default','Preferences'),JSON.stringify({session:{restore_on_startup:1}}));
  let run=await launch(root,url+'/set');
  const page=run.ctx.pages().find(p=>p.url().startsWith(url))||run.ctx.pages()[0];await page.waitForLoadState('load');
  const before=(await run.ctx.cookies(url)).map(c=>c.name);
  const closeMethod=await closeWindows(run);
  run=await launch(root,'about:blank');
  const after=(await run.ctx.cookies(url)).map(c=>c.name);
  results.push({mode,closeMethod,before,after,sessionRetained:after.includes('fixture_session')});console.log(JSON.stringify(results.at(-1)));
  await closeWindows(run);
 }
 await fs.writeFile('runtime/window-close-results.json',JSON.stringify(results,null,2));
}finally{server.close();}
