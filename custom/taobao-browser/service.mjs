import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BrowserManager,accounts } from './core.mjs';
import { ProfileStore } from './profiles.mjs';
import { platforms } from './platforms.mjs';
import {restoreOccupiedProfiles} from './occupied-profiles.mjs';
import { canCheckLogin, CollectionStore } from './collection.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const runtime=process.env.TAOBAO_BROWSER_RUNTIME||path.join(dir,'runtime'); await fs.mkdir(runtime,{recursive:true});
const token=crypto.randomBytes(32).toString('hex');
const port=Number(process.env.TAOBAO_BROWSER_PORT||18765);
const manager=new BrowserManager(path.join(runtime,'profiles-chromium'));
const profiles=new ProfileStore(manager);await profiles.init();
await restoreOccupiedProfiles(manager,profiles.items);
const collection=new CollectionStore(runtime,manager,profiles);await collection.init();
manager.onManualOpened=async account=>{
  if(canCheckLogin(manager.platform(account).id) && !collection.state.shops[account]?.unbound){
    collection.waitForLogin(account);await collection.save();
  }
};
const loginTimer=setInterval(()=>collection.resumeLoginChecks(),1000);loginTimer.unref();
const scheduleTimer=setInterval(()=>collection.tick().catch(console.error),15000);scheduleTimer.unref();
let profileQueue=Promise.resolve();
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
  const origin=`http://127.0.0.1:${port}`;
  if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin)) {res.writeHead(403).end();return;}
  try {
    if(req.method==='GET' && req.url==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end((await fs.readFile(path.join(dir,'index.html'),'utf8')).replace('__TOKEN__',token).replace('__PAIR_CODE__',collection.state.ownerId?'已连接 LobeHub':collection.state.pairCode)); return;}
    if(req.headers.authorization!==`Bearer ${token}`) {res.writeHead(401).end();return;}
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if(req.method==='GET' && req.url==='/status') {res.end(JSON.stringify({platforms:platforms.map(({id,name,homeUrl})=>({id,name,homeUrl})),accounts,profiles:profiles.items,open:[...manager.sessions.keys()],manual:[...manager.manual.keys()],active:manager.active}));return;}
    if(req.method!=='POST'||!['/command','/profiles','/shops','/collections'].includes(req.url)){res.writeHead(404).end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>(req.url==='/profiles'?90*1024*1024:65536))throw Error('Request too large');}
    const input=JSON.parse(body);
    if(req.url==='/collections'){res.end(JSON.stringify(await collection.command(input)));return;}
    if(req.url==='/shops'){const allowed=await collection.authorize(req.headers['x-lobe-user-id'],input);if(!allowed){res.end(JSON.stringify({pairRequired:true}));return;}
      const task=input.action==='create'||input.action==='rename'
        ? (profileQueue=profileQueue.catch(()=>{}).then(()=>collection.command(input)))
        : collection.command(input);
      res.end(JSON.stringify(await task));return;}
    if(req.url==='/profiles'){
      const task=profileQueue.catch(()=>{}).then(async()=>{
        if(input.action==='create')return profiles.create(input.name,input.platform);
        if(input.action==='rename')return profiles.rename(input.account,input.name);
        if(input.action==='export')return profiles.export(input.account,input.password);
        if(input.action==='import')return profiles.import(input.name,input.data,input.password);
        throw Error('Unknown profile action');
      });profileQueue=task;res.end(JSON.stringify(await task));return;
    }
    if(profiles.items.find(p=>p.id===input.account)?.restoreError)throw Error('该环境恢复失败，不能打开');
    const result=await manager.execute(input);
    await fs.appendFile(path.join(runtime,'audit.jsonl'),JSON.stringify({at:new Date().toISOString(),account:input.account,action:input.action,ok:true})+'\n');
    res.end(JSON.stringify(result));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}
});
server.listen(port,'127.0.0.1',async()=>{await fs.writeFile(path.join(runtime,'connection.json'),JSON.stringify({port,token,pid:process.pid}));await fs.mkdir(path.join(runtime,'bridge'),{recursive:true});await fs.writeFile(path.join(runtime,'bridge','connection.json'),JSON.stringify({port,token,pid:process.pid}));console.log(`Multi-store browser: http://127.0.0.1:${port}`);});
server.on('error',e=>{console.error(e.message);process.exit(1);});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await manager.closeAll();server.close();process.exit(0);});
