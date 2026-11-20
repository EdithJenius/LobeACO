import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseDaily} from './daily-store.mjs';
import {sourcePages} from './source-readers.mjs';
import {compassGroup} from './compass-workbook.mjs';

export const registry=JSON.parse(readFileSync(new URL('../analysis/store-execution/source-registry.json',import.meta.url),'utf8'));
const contracts=new Map(registry.map(s=>[s.source_id,s]));
export const getContract=id=>contracts.get(id);
export const dailyId='rpa_tb_shop_core_daily', pddHomeId='rpa_pdd_shop_overview';
export function executorFor(id) {
  if(compassGroup(id))return 'downloadCompass';
  if(id===dailyId)return 'downloadDaily';
  if(id===pddHomeId)return 'readSellerDashboard';
  return Object.hasOwn(sourcePages,id)?'readRegisteredPage':null;
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const open=root=>{
  const db=new DatabaseSync(path.join(root,'source-receipts.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS receipt(
      source_id TEXT NOT NULL,account TEXT NOT NULL,run_id TEXT NOT NULL,finished TEXT NOT NULL,
      status TEXT NOT NULL,evidence_hash TEXT NOT NULL,payload TEXT NOT NULL,
      PRIMARY KEY(source_id,account,run_id))`);
  return db;
};

function dailyProof(root,run) {
  const rows=run.report?.rows ?? [];
  const hashes=[...new Set(rows.map(r=>r['原表SHA256']))];
  if(hashes.length!==1 || !/^[\da-f]{64}$/.test(hashes[0]))throw Error('日报无法归于单一原表');
  const digest=hashes[0], source=run.report.sources[digest];
  if(source.origin!=='official-browser-download'||!/^\d+$/.test(run.storeId))throw Error('缺少已验证的店铺或官方下载来源');
  const file=path.join(root,'sycm-daily','originals',run.storeId,digest+path.extname(source.originalName).toLowerCase());
  const bytes=readFileSync(file);
  if(hash(bytes)!==digest)throw Error('日报原表 SHA256 不匹配');
  const parsed=parseDaily(bytes,source.originalName,run.storeId,{storeName:run.storeName});
  const dates=parsed.rows.map(r=>r.date);
  if(dates.length!==rows.length || parsed.sheetName!==source.sheet || parsed.rows.some((r,i)=>r.date!==rows[i]['日期'] || String(r.row)!==rows[i]['原表行']))
    throw Error('原表与查询行无法逐日对应');
  return {coverage:{kind:'days',dates},evidence:{file,sha256:digest,sheet:source.sheet,originalName:source.originalName,
    fields:['日期','支付金额','访客数','支付转化率'],columns:parsed.columns,rows:parsed.rows.map(r=>({date:r.date,row:r.row}))}};
}

export function recordRun(root,run) {
  let id=run.source_id;
  if(!id && run.scope==='syncDaily')id=dailyId;
  if(!id && run.platform==='pinduoduo' && run.scope==='pinduoduo-home-current')id=pddHomeId;
  if(!id || !contracts.has(id) || !run.id || !run.finishedAt || !['completed','failed','interrupted'].includes(run.status))return;
  const source=contracts.get(id);
  if(run.platform && run.platform!==source.platform)throw Error('来源与执行平台不一致');
  const payload={source_id:id,platform:source.platform,account:run.account,storeName:run.storeName??null,storeId:run.storeId??null,
    runId:run.id,startedAt:run.startedAt,capturedAt:run.finishedAt,url:run.report?.sourceUrl??(run.status==='completed'?run.sourceUrl:null)??null,
    executor:executorFor(id),status:run.status,coverage:null};
  let payloads=[payload];
  if(run.status!=='completed')payload.error=(run.error??'采集失败').split('\n')[0];
  else {
    try {
      if(!run.storeName)throw Error('缺少核验店名');
      if(compassGroup(id)){
        const {artifact,members,kind}=run.report;
        if(kind!==id || !members?.[id] || !/^[\da-f]{64}$/.test(artifact?.sha256) ||
          path.resolve(artifact.file)!==path.resolve(root,'source-originals',run.account,artifact.sha256+'.xlsx') ||
          hash(readFileSync(artifact.file))!==artifact.sha256)throw Error('罗盘原表或归档摘要无法核对');
        payloads=Object.entries(members).map(([key,member])=>{
          if(!contracts.has(key) || compassGroup(key)!==compassGroup(id))throw Error('工作表与来源登记不匹配');
          return {...payload,source_id:key,requestedSourceId:id,...member,evidence:{...member.evidence,...artifact}};
        });
      }else if(id===dailyId)Object.assign(payload,dailyProof(root,run));
      else if(id===pddHomeId){
        const fields=Object.entries(run.metrics).filter(([,v])=>v!==null);
        if(!fields.length || new URL(run.sourceUrl).origin!=='https://mms.pinduoduo.com')throw Error('缺少拼多多首页指标或来源');
        Object.assign(payload,{coverage:{kind:'observation'},evidence:{metrics:run.metrics,scope:run.note}});
      } else {
        if(run.report?.kind!==id || !run.report.rows?.length || !run.report.coverage)throw Error('来源不匹配或缺少证据');
        Object.assign(payload,{coverage:run.report.coverage,evidence:{rows:run.report.rows,scope:run.report.scope}});
      }
    } catch(error) {payload.status='unverified';payload.error=error.message;}
  }
  const db=open(root);
  try {
    db.exec('BEGIN IMMEDIATE');
    const insert=db.prepare('INSERT INTO receipt VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id,account,run_id) DO NOTHING');
    for(const item of payloads){
      const json=JSON.stringify(item);
      insert.run(item.source_id,run.account,run.id,run.finishedAt,item.status,hash(json),json);
    }
    db.exec('COMMIT');
  } finally{db.close();}
}

export function receipts(root,account,id) {
  const db=open(root);
  try {
    return db.prepare('SELECT evidence_hash,payload FROM receipt WHERE account=? AND source_id=? ORDER BY finished,run_id').all(account,id)
      .map(row=>{
        if(hash(row.payload)!==row.evidence_hash)throw Error('采集回执校验失败');
        return {...JSON.parse(row.payload),receiptSha256:row.evidence_hash};
      });
  } finally{db.close();}
}
