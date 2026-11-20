import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import * as XLSX from 'xlsx';
import {parse as parseCsv} from 'csv-parse/sync';

const headers = [
  ['日期','统计日期','业务日期','时间','统计时间','统计周期'],
  ['支付金额','支付金额(元)'],
  ['访客数','访客数(人)','店铺访客数'],
  ['支付转化率','支付转化率(%)'],
];
const clean = s => String(s ?? '').trim().replaceAll('（','(').replaceAll('）',')');
const value = cell => cell?.v ?? null;
function dateOf(cell, date1904) {
  let raw = value(cell);
  if (typeof raw === 'number' && raw < 100000) {
    const d = XLSX.SSF.parse_date_code(raw,{date1904});
    if (!d) return null;
    raw = [d.y,d.m,d.d].join('-');
  }
  const m = String(raw).trim().match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/);
  if (!m) return null;
  const date = m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  const iso = new Date(date+'T00:00:00Z');
  if (!Number.isFinite(+iso) || iso.toISOString().slice(0,10)!==date) throw Error('原表中存在无效业务日期 '+date);
  return date;
}
function numberOf(cell,kind,header) {
  const raw = value(cell);
  const text = clean(raw).replaceAll(',','');
  if (!text || /^(?:--?|—|暂无|N\/A)$/.test(text)) return null;
  if (!/^-?\d+(?:\.\d+)?%?$/.test(text)) throw Error('原表中有无法识别的指标值：'+header);
  let n = Number(text.replace('%',''));
  if (kind===3) {
    if (typeof raw==='number' && /%/.test(cell.z ?? '')) n=raw*100;
    else if (!text.endsWith('%') && !header.includes('%') && n!==0) throw Error('支付转化率缺少百分比单位，无法判定其口径');
    if (n<0 || n>100) throw Error('支付转化率超出范围');
  } else if (text.includes('%') || n<0 || (kind===2 && !Number.isSafeInteger(n))) throw Error('指标数值或单位无效：'+header);
  return Number(n.toFixed(8));
}
export function parseDaily(buffer,filename,storeId,{storeName,period}={}) {
  if (!buffer.length || buffer.length>20*1024*1024) throw Error('原表为空或超过20 MB');
  let workbook;
  const ext = path.extname(filename).toLowerCase();
  if (ext==='.csv') {
    let text;
    try {text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);} catch {text=new TextDecoder('gb18030').decode(buffer);}
    const records=parseCsv(text,{bom:true,relax_column_count:true,skip_empty_lines:false});
    workbook={SheetNames:['CSV'],Sheets:{CSV:XLSX.utils.aoa_to_sheet(records)}};
  } else {
    if (!['.xlsx','.xls'].includes(ext)) throw Error('仅支持官方 Excel 或 CSV 原表');
    workbook=XLSX.read(buffer,{type:'buffer',cellNF:true});
  }
  const matches=[];
  for (const sheetName of workbook.SheetNames) {
    const sheet=workbook.Sheets[sheetName];
    if (!sheet['!ref']) continue;
    const range=XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r>10000 || range.e.c>600) throw Error('工作表范围超出日报预期');
    const at=(r,c)=>sheet[XLSX.utils.encode_cell({r,c})];
    for(let h=range.s.r;h<=Math.min(range.e.r,range.s.r+30);h++) {
      const labels=Array.from({length:range.e.c+1},(_,c)=>clean(value(at(h,c))));
      const cols=headers.map(names=>labels.findIndex(label=>names.includes(label)));
      if(cols.includes(-1)) continue;
      if(headers.some(names=>labels.filter(label=>names.includes(label)).length!==1)) throw Error('原表指标列不唯一');
      const idCol=labels.findIndex(x=>['店铺ID','店铺id','shop_id'].includes(x));
      const nameCol=labels.indexOf('店铺名称');
      if(period && nameCol===-1 && idCol===-1) throw Error('取数原表缺少店铺标识');
      const rows=[], seen=new Set();
      for(let r=h+1;r<=range.e.r;r++) {
        const date=dateOf(at(r,cols[0]),Boolean(workbook.Workbook?.WBProps?.date1904));
        if(!date) {
          const field=clean(value(at(r,cols[0])));
          if (field && /^\d/.test(field)) throw Error('发现非日粒度或无法解析的日期：'+field);
          continue;
        }
        if(idCol!==-1 && String(value(at(r,idCol))).trim()!==storeId) throw Error('原表店铺ID与目标绑定不符');
        if(storeName && nameCol!==-1 && clean(value(at(r,nameCol)))!==storeName) throw Error('原表店铺名称与目标绑定不符');
        if(seen.has(date)) throw Error('同一工作表重复日期 '+date);
        seen.add(date);
        rows.push({date,row:r+1,gmv:numberOf(at(r,cols[1]),1,labels[cols[1]]),uv:numberOf(at(r,cols[2]),2,labels[cols[2]]),cvr:numberOf(at(r,cols[3]),3,labels[cols[3]])});
      }
      if(rows.length) matches.push({sheetName,columns:cols.map(c=>XLSX.utils.encode_col(c)),rows});
      break;
    }
  }
  if(matches.length!==1) throw Error('需要唯一的日粒度工作表，含日期、支付金额、访客数、支付转化率');
  const result=matches[0];result.rows.sort((a,b)=>a.date.localeCompare(b.date));
  if(period && (result.rows.length!==30 || result.rows[0].date!==period.start || result.rows.at(-1).date!==period.end))
    throw Error('取数原表未完整覆盖所选30个日期，本次未入库');
  if(Date.parse(result.rows.at(-1).date)-Date.parse(result.rows[0].date)>29*86400000) throw Error('日期范围超过30天，请导出近30天日报');
  return result;
}
function openDb(root) {
  const db=new DatabaseSync(path.join(root,'daily.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS source(store TEXT,hash TEXT,name TEXT,sheet TEXT,cols TEXT,at TEXT,origin TEXT,PRIMARY KEY(store,hash));
    CREATE TABLE IF NOT EXISTS day(store TEXT,date TEXT,gmv REAL,uv INTEGER,cvr REAL,hash TEXT,source_row INTEGER,
      PRIMARY KEY(store,date),FOREIGN KEY(store,hash) REFERENCES source(store,hash));`);
  return db;
}
export async function importDaily(root,storeId,bytes,name,origin='manual',expected={}) {
  if(!/^\d{1,32}$/.test(storeId)) throw Error('需先验证官方店铺 ID');
  const parsed=parseDaily(bytes,name,storeId,expected);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const ext=path.extname(name).toLowerCase();
  const dir=path.join(root,'originals',storeId);
  await fs.mkdir(dir,{recursive:true});
  const archive=path.join(dir,hash+ext);
  const temp=archive+'.'+randomUUID()+'.tmp';
  try {
    await fs.writeFile(temp,bytes,{flag:'wx'});
    try {await fs.link(temp,archive);} catch(e){if(e.code!=='EEXIST') throw e;}
    if (createHash('sha256').update(await fs.readFile(archive)).digest('hex')!==hash) throw Error('已归档文件校验失败');
  } finally {await fs.rm(temp,{force:true});}
  const db=openDb(root);
  try {
    db.exec('BEGIN IMMEDIATE');
    const add=db.prepare('INSERT OR IGNORE INTO source VALUES(?,?,?,?,?,?,?)').run(storeId,hash,path.basename(name),parsed.sheetName,JSON.stringify(parsed.columns),new Date().toISOString(),origin);
    if(add.changes) {
      const save=db.prepare('INSERT INTO day VALUES(?,?,?,?,?,?,?) ON CONFLICT(store,date) DO UPDATE SET gmv=excluded.gmv,uv=excluded.uv,cvr=excluded.cvr,hash=excluded.hash,source_row=excluded.source_row');
      for(const r of parsed.rows) save.run(storeId,r.date,r.gmv,r.uv,r.cvr,hash,r.row);
    }
    db.exec('COMMIT');
    return {hash,archive,days:parsed.rows.length,repeated:!add.changes};
  } finally {db.close();}
}
export async function queryDaily(root,storeId,now=new Date(),{snapshot=false}={}) {
  if(!/^\d{1,32}$/.test(storeId)) throw Error('需先验证官方店铺 ID');
  await fs.mkdir(root,{recursive:true});
  const db=openDb(root);
  try {
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const latest=db.prepare('SELECT max(date) d FROM day WHERE store=? AND date<=?').get(storeId,today).d;
    if(!latest) throw Error('该店尚无已入库的生意参谋原表，请先下载或导入近30天核心日报');
    const end=snapshot ? latest : latest===today ? today : new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
    const spanStart=new Date(Date.parse(end)-29*86400000).toISOString().slice(0,10);
    const data=db.prepare(`SELECT d.*,s.name,s.sheet,s.cols,s.at,s.origin FROM day d JOIN source s USING(store,hash)
      WHERE store=? AND date BETWEEN ? AND ? ORDER BY date`).all(storeId,spanStart,end);
    if(!data.length) throw Error('近30天没有已入库日报，最近的业务日期为 '+latest);
    const first=data[0],last=data.at(-1);
    const sources=Object.fromEntries(data.map(r=>[r.hash,{file:path.join(root,'originals',storeId,r.hash+path.extname(r.name).toLowerCase()),originalName:r.name,sheet:r.sheet,columns:JSON.parse(r.cols),origin:r.origin}]));
    const diff=(a,b)=>a===null||b===null?null:Number((b-a).toFixed(8));
    return {kind:'daily',name:'近30天核心日报',sourceUrl:'https://sycm.taobao.com/portal/home.htm',capturedAt:data.map(x=>x.at).sort().at(-1),
      period:{start:spanStart,end},scope:`按北京时间查询近30个日历日：${spanStart} 至 ${end}。实有 ${data.length} 天，缺 ${30-data.length} 天。缺日不补零。成交采用支付金额，转化采用支付转化率。`,
      change:data.length<2 ? null : {from:first.date,to:last.date,gmvYuan:diff(first.gmv,last.gmv),visitors:diff(first.uv,last.uv),conversionPercentagePoints:diff(first.cvr,last.cvr)},
      rows:data.map(r=>({'日期':r.date,'支付金额(元)':r.gmv?.toString()??null,'访客数':r.uv?.toString()??null,'支付转化率(%)':r.cvr?.toString()??null,'原表SHA256':r.hash,'工作表':r.sheet,'原表行':String(r.source_row)})),sources};
  } finally {db.close();}
}
