import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {registry,executorFor,receipts} from './source-ledger.mjs';
import {sourcePages} from './source-readers.mjs';
import {compassEntry,inspectWorkbook} from './compass-workbook.mjs';
import {getPlatform} from './platforms.mjs';

const runtime=process.env.TAOBAO_BROWSER_RUNTIME || fileURLToPath(new URL('./runtime/',import.meta.url));
const out=fileURLToPath(new URL('../analysis/store-execution/',import.meta.url));
const {port,token}=JSON.parse(await fs.readFile(path.join(runtime,'connection.json'),'utf8'));
async function command(input){
  const r=await fetch('http://127.0.0.1:'+port+'/collections',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)});
  const body=await r.json();
  if(!r.ok)throw Error(body.error || '店铺服务读取失败');
  return body;
}
function period(r) {
  if(!r.coverage)return '—';
  if(r.coverage.kind==='observation')return '快照 '+new Date(r.capturedAt).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'});
  if(r.coverage.kind==='interval')return r.coverage.intervals.map(i=>i.start+' 至 '+i.end+'（区间汇总）').join('、');
  const days=[...new Set(r.coverage.dates)].sort();
  return days.length===1 ? days[0] : days[0]+' 至 '+days.at(-1)+'（实有 '+days.length+' 天）';
}
const cell=s=>String(s??'—').replaceAll('|','\\|').replace(/[\r\n]+/g,' ');

function summarizeAccount(shop,history){
  const attempts=history.filter(r=>(!r.storeId || !shop.storeId || r.storeId===shop.storeId) && (!r.storeName || r.storeName===shop.storeName));
  const success=attempts.filter(r=>r.status==='completed');
  const days=new Set(),intervals=new Map(),observations=[];
  for(const r of success){
    if(r.coverage.kind==='days')for(const d of r.coverage.dates)days.add(d);
    if(r.coverage.kind==='interval')for(const i of r.coverage.intervals)intervals.set(i.start+'/'+i.end,i);
    if(r.coverage.kind==='observation')observations.push(r.capturedAt);
  }
  return {account:shop.id,name:shop.storeName||shop.name,attempts,latest:attempts.at(-1)??null,
    lastSuccess:success.at(-1)??null,coverage:{dates:[...days].sort(),intervals:[...intervals.values()],observations}};
}

async function matrix(){
  const {shops}=await command({action:'list'});
  const built=new Date().toISOString();
  const rows=registry.map(s=>{
    const executor=executorFor(s.source_id);
    const accounts=shops.filter(shop=>shop.platform===s.platform).map(shop=>summarizeAccount(shop,receipts(runtime,shop.id,s.source_id)));
    const successful=accounts.filter(a=>a.lastSuccess).length;
    const status=!s.enabled?'注册停用':successful?'有取数回执':accounts.some(a=>a.latest)?'尝试未取数':executor?'待实测':'待适配';
    const platformHome=getPlatform(s.platform).homeUrl;
    const entry=sourcePages[s.source_id] ?? compassEntry(s.source_id) ?? (s.source_id==='rpa_tb_shop_core_daily'?'https://sycm.taobao.com/portal/home.htm':s.source_id==='rpa_pdd_shop_overview'?platformHome:null);
    return {source_id:s.source_id,platform:s.platform,name:s.name,enabled:s.enabled,type:s.type,
      connector:s.type==='manual'?'商家原件手动导入':getPlatform(s.platform).name+'独立商家浏览器',
      registeredNode:s.rules.collection_node??null,
      connectorCode:s.type==='manual'?null:'taobao-browser/core.mjs#BrowserManager.context',
      executorCode:({downloadDaily:'taobao-browser/daily-download.mjs',readSellerDashboard:'taobao-browser/seller-dashboard.mjs',
        readRegisteredPage:'taobao-browser/source-readers.mjs',downloadCompass:'taobao-browser/compass-workbook.mjs'})[executor]??null,
      executor,entry,connectorEntry:s.type==='manual'?null:platformHome,expectedSheet:s.rules.sheet_name??null,
      entity:s.rules.collection?.scope_binding??null,parameters:s.parameters,registeredTime:s.rules.statistical_time,
      status,requirements:s.description,
      accounts};
  });
  const full=path.join(runtime,'source-coverage.json');
  const report=JSON.stringify({built,timezone:'Asia/Shanghai',sources:rows},null,2);
  await fs.writeFile(full,report);
  const counts=new Map();for(const r of rows)counts.set(r.status,(counts.get(r.status)??0)+1);
  const md=['# 四平台逐来源采集验收','', '生成于 '+new Date(built).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})+'（北京时间）。',
    '',rows.length+' 个来源，按当前店铺形成 '+rows.reduce((n,r)=>n+r.accounts.length,0)+' 个来源与账号组合。'+[...counts].map(([k,v])=>k+' '+v+' 项').join('，')+'。',
    '', '一个来源可以有多次执行。下表保留各店最近尝试及最近成功覆盖。完整运行 ID、账号、连接器与执行器代码位置、原始指标或原表行号、本次执行状态、业务日期和证据摘要在[逐账号机器可读记录](../../taobao-browser/runtime/source-coverage.json)。来源的入参、指标路径、工作表和时间口径见[注册契约](source-registry.json)。',
    '', '“有取数回执”表示至少一家店读到记录的字段或区间。淘宝核心日报保留日期、支付金额、访客数、支付转化率。拼多多首页只记录观测时点。京东商智的区间汇总单独标注。抖店罗盘共享下载按工作表分别验收，记录原件路径、SHA256、工作表和行号。JSON 的 coverage 汇总各次成功的日期、区间与快照时点。空执行器表示该来源尚待适配。'];
  const platforms=['taobao','pinduoduo','jd','douyin'];
  md.push('','| 平台 | 登记来源 | 已接执行器 | 有取数回执的来源 | 店铺与来源组合 | 有成功回执的组合 |','|---|---:|---:|---:|---:|---:|');
  for(const platform of platforms){
    const group=rows.filter(r=>r.platform===platform),accounts=group.flatMap(r=>r.accounts);
    md.push('| '+[getPlatform(platform).name,group.length,group.filter(r=>r.executor).length,
      group.filter(r=>r.accounts.some(a=>a.lastSuccess)).length,accounts.length,accounts.filter(a=>a.lastSuccess).length].join(' | ')+' |');
  }
  for(const platform of platforms){
    const names=shops.filter(s=>s.platform===platform).map(s=>s.storeName||s.name).join('、');
    md.push('','## '+getPlatform(platform).name,'','本平台核对的店铺为'+names+'。未执行的来源在逐账号记录中也保留独立空项。','','| source_id | 来源和采集口径 | 连接器 / 执行器 | 状态 | 账号回执及业务覆盖 |','|---|---|---|---|---|');
    for(const r of rows.filter(r=>r.platform===platform)){
      const evidence=r.accounts.map(a=>{
        if(!a.latest)return a.name+'：无执行回执 · 无覆盖';
        const ref=a.latest.runId.slice(0,8);
        const last=a.latest.status==='completed'?'成功 '+ref:(a.latest.status==='unverified'?'原件待核验 ':'执行失败 ')+ref+' '+(a.latest.error??'');
        const proof=a.lastSuccess?.evidence;
        const sheet=proof?.sheet?'；表「'+proof.sheet+'」':'';
        return a.name+'：'+last+(a.lastSuccess?'；覆盖 '+period(a.lastSuccess)+sheet:'；无覆盖');
      }).join('<br>') || '无执行回执 · 无覆盖';
      md.push('| '+[r.source_id,r.name+'。'+r.requirements,r.connector+' / '+(r.executor??'—'),r.status,evidence].map(cell).join(' | ')+' |');
    }
  }
  md.push('','## 复核命令','','在项目的 `taobao-browser` 目录运行。','','```powershell','node source-control.mjs list <账号环境ID>',
    'node source-control.mjs run <账号环境ID> <source_id>','node source-control.mjs receipts <账号环境ID> <source_id>','node source-control.mjs matrix','node source-control.mjs verify','```','');
  await fs.writeFile(path.join(out,'四平台逐来源采集验收.md'),md.join('\n'));
  console.log(JSON.stringify({sources:rows.length,counts:Object.fromEntries(counts),full}));
}

async function verifyOriginals(){
  const {shops}=await command({action:'list'});
  const files=new Map();
  let checked=0;
  for(const source of registry){
    for(const shop of shops.filter(s=>s.platform===source.platform)){
      for(const receipt of receipts(runtime,shop.id,source.source_id)){
        const ev=receipt.evidence;
        if(!ev?.file)continue;
        if(!files.has(ev.file))files.set(ev.file,[]);
        files.get(ev.file).push({source,receipt});
      }
    }
  }
  for(const [file,refs] of files){
    const bytes=await fs.readFile(file),digest=createHash('sha256').update(bytes).digest('hex');
    for(const {source,receipt} of refs){
      const ev=receipt.evidence;
      if(digest!==ev.sha256)throw Error('原件摘要不一致 '+receipt.runId);
      if(receipt.executor==='downloadCompass' && receipt.status==='completed'){
        const result=inspectWorkbook(bytes,[source],receipt.coverage.dates[0])[source.source_id];
        if(result.status!=='completed' || result.evidence.rows!==ev.rows || result.evidence.range!==ev.range)
          throw Error('工作表、行数或业务日期不一致 '+source.source_id+' '+receipt.runId);
      }
      checked++;
    }
  }
  console.log(JSON.stringify({verifiedOriginals:files.size,receiptsWithOriginals:checked}));
}
const [action,account,source_id]=process.argv.slice(2);
if(action==='matrix')await matrix();
else if(action==='verify')await verifyOriginals();
else {
  const commands={list:'sourceList',run:'sourceCollect',receipts:'sourceReceipts'};
  if(!Object.hasOwn(commands,action)||!account||(action!=='list'&&!source_id))throw Error('用法：source-control.mjs matrix | verify | list <account> | run/receipts <account> <source_id>');
  const result=await command({action:commands[action],account,source_id});
  console.log(JSON.stringify(result,null,2));
  if(action==='run' && result.status!=='completed')process.exitCode=1;
}
