const fs = require('node:fs/promises');
const http = require('node:http');

function call(options, body, timeoutMs=90000) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      const chunks=[]; let size=0;
      res.on('data', b=>{size+=b.length;if(size>2*1024*1024)req.destroy(new Error('Response too large'));else chunks.push(b);});
      res.on('end', ()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('Local shop service timed out')));
    req.on('error',reject);req.end(body);
  });
}

// Older running managers can serve their stored reports while a shop login window is open.
// The bridge checks the same conversation revision before and after the read.
async function legacySnapshot(send, input) {
  const {account, agent, scope, topic, revision, kind} = input;
  if (!['daily','todo','finance','products','quality'].includes(kind)) throw Error('未知快照');
  const read = async command => {
    const response = await send(command);
    const data = JSON.parse(response.body);
    if (response.status !== 200) throw Error(data.error || '读取店铺快照失败');
    return data;
  };
  const assertAccess = async () => {
    const access = await read({action:'access', agent, scope, topic});
    if (access.revision !== revision || !access.accounts?.includes(account)) throw Error('店铺关联已变更，请重新读取');
  };
  await assertAccess();
  const {shops, runs} = await read({action:'list'});
  const shop = shops.find(s => s.id === account);
  if (shop?.platform !== 'taobao' || !shop.storeId) throw Error('该店铺尚无已核验的淘宝快照');
  const history = runs.filter(r => r.account === account && r.storeId === shop.storeId);
  const stored = async reportKind => {
    const run = history.find(r => r.status === 'completed' && (reportKind === 'todo' ? !r.report : r.scope === reportKind));
    if (!run) return null;
    const full = await read({action:'result', account, runId:run.id});
    return full?.storeId === shop.storeId && full.account === account ? full : null;
  };
  const base = {account, name:shop.storeName || shop.name, platform:shop.platform, authStatus:shop.authStatus, latest:null};
  let result;
  if (kind === 'daily') {
    // 'daily' queries the local SQLite store. Only 'syncDaily' starts a download.
    try {
      const daily = await read({action:'report',kind:'daily',account});
      if (daily.storeId !== shop.storeId) throw Error('店铺身份已变更');
      result = {...base, report:daily.report};
    } catch (error) {
      const prior = await stored('syncDaily');
      if (!prior?.report) {
        const failure = history.find(r => r.status === 'failed' && r.error?.includes('生意参谋'));
        throw Error(failure ? error.message+'。最近采集：'+failure.error : error.message);
      }
      result = {...base,report:prior.report};
    }
  } else {
    const last = await stored(kind);
    if (!last) throw Error('尚无该店铺的成功采集记录');
    result = kind === 'todo' ? {...base,latest:last} : {...base,report:last.report};
  }
  await assertAccess();
  return {status:200, body:JSON.stringify(result)};
}

module.exports = async function shopBridge(req,res,{backendHost,backendPort,frontendPort=3210}) {
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    if(req.method!=='POST'||![`localhost:${frontendPort}`,`127.0.0.1:${frontendPort}`].includes(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`) {
      res.writeHead(403);return res.end(JSON.stringify({error:'Local same-origin request required'}));
    }
    const auth=await call({host:backendHost,port:backendPort,path:'/api/auth/get-session',headers:{cookie:req.headers.cookie||'',host:req.headers.host}});
    const session=JSON.parse(auth.body.toString());
    if(auth.status!==200||!session?.user?.id){res.writeHead(401);return res.end(JSON.stringify({error:'请先登录 LobeHub'}));}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)throw Error('Request too large');}
    const input=JSON.parse(body);
    const connection=JSON.parse(await fs.readFile(process.env.LOBE_SHOP_CONNECTION||'/shop-runtime/connection.json','utf8'));
    const options={host:process.env.LOBE_SHOP_HOST||'host.docker.internal',port:connection.port,path:'/shops',method:'POST',headers:{host:`127.0.0.1:${connection.port}`,authorization:`Bearer ${connection.token}`,'x-lobe-user-id':session.user.id,'content-type':'application/json'}};
    let result=await call(options,body,['collect','productList','pageRead','browser'].includes(input.action) ? 600000 : 90000);
    // A manager with an active merchant window may still serve the older access payload.
    if (result.status === 200 && ['access','setAccess'].includes(input.action)) {
      const access = JSON.parse(result.body);
      if (access.shops?.some(shop => !shop.authStatus)) {
        const response = await call(options,JSON.stringify({action:'list'}));
        if (response.status === 200) {
          const {shops = [], runs = []} = JSON.parse(response.body);
          for (const target of access.shops) {
            if (target.authStatus) continue;
            const shop = shops.find(s => s.id === target.id);
            const last = runs.find(r => r.account === target.id && r.status === 'failed');
            const challenge = /弹出安全验证|要求账号持有人完成页面验证/;
            const blocked = last && last.finishedAt >= (shop?.checkedAt || '') && challenge.test(last.error);
            const failedCheck = shop?.authStatus === 'check_failed' && challenge.test(shop.checkError);
            target.authStatus = shop?.manual ? 'awaiting_close' : blocked || failedCheck
              ? 'security_verification' : shop?.authStatus || 'unknown';
          }
          result = {status:200,body:JSON.stringify(access)};
        }
      }
    }
    if(input.action==='snapshot' && result.status===400 && JSON.parse(result.body).error==='不支持的店铺操作') {
      try {result=await legacySnapshot(command=>call(options,JSON.stringify(command)),input);}
      catch(error){result={status:400,body:JSON.stringify({error:error.message})};}
    }
    res.writeHead(result.status);res.end(result.body);
  } catch(e) {res.writeHead(503);res.end(JSON.stringify({error:e.code==='ENOENT'||e.code==='ECONNREFUSED'?'本机店铺管理器未启动，请启动后重试':e.message}));}
};
