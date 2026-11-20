import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';

const accounts=process.argv.slice(2).filter(arg=>arg!=='--resume');
if(!accounts.length || accounts.some(id=>!/^taobao-[ab]$|^shop-[a-f0-9-]{36}$/.test(id))) throw Error('请指定本机淘宝店铺环境 ID');
const dest=fileURLToPath(new URL('../analysis/taobao-chain/',import.meta.url));
await mkdir(dest,{recursive:true});
const {port,token}=JSON.parse(await readFile(new URL('./runtime/connection.json',import.meta.url)));
async function scan(account) {
  const output=path.join(dest,account+'-页面请求.json');
  let previous;
  if(process.argv.includes('--resume')){
    try{previous=JSON.parse(await readFile(output,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const prior=new Map(previous?.pages.filter(p=>p.requests && p.status==='已观测').map(p=>[p.route,p]));
  const report=await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/collections',method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('error',reject);
      res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks));if(res.statusCode!==200)throw Error(body.error);resolve(body);}catch(e){reject(e);}});
    });
    req.on('error',reject);
    req.end(JSON.stringify({account,action:'catalog',skipRoutes:[...prior.keys()]}));
  });
  if(previous && (previous.account!==account || previous.store!==report.store))throw Error('历史盘点与当前店铺身份不匹配，请重新运行完整盘点');
  report.pages=report.pages.map(row=>row.status==='已在同次盘点中观测'?prior.get(row.route):row);
  const temp=output+'.'+process.pid+'.tmp';
  await writeFile(temp,JSON.stringify(report,null,2));await rename(temp,output);
  console.log(account,report.pages.length,'个导航入口',report.pages.filter(p=>p.requests).length,'个页面已打开');
}
const results=await Promise.allSettled(accounts.map(scan));
for(const result of results) if(result.status==='rejected'){console.error(result.reason.message);process.exitCode=1;}
