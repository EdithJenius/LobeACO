import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';

const origin='https://compass.jinritemai.com';
const groups=[
  ['rpa_dy_shop_transaction_','/shop/business-part','全店成交分析'],
  ['rpa_dy_shop_refund_analysis_','/shop/refund-analysis','全店退款分析'],
  ['rpa_dy_shop_income_expense_','/shop/settlement-analysis','收支投放分析'],
  ['rpa_dy_shop_transaction_by_account_','/shop/account-analysis','账号成交分析'],
].sort((a,b)=>b[0].length-a[0].length);
export const compassGroup=id=>groups.find(([prefix])=>id.startsWith(prefix));
export const compassEntry=id=>compassGroup(id)?origin+compassGroup(id)[1]:null;
const timeZone='Asia/Shanghai';
const isoDay=ms=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);

export function inspectWorkbook(bytes,sources,date) {
  const wb=XLSX.read(bytes,{type:'buffer'});
  return Object.fromEntries(sources.map(s=>{
    const sheetName=s.rules.sheet_name, sheet=wb.Sheets[sheetName];
    try {
      if(!sheet?.['!ref'])throw Error('官方原表没有所登记的工作表 '+sheetName);
      const range=XLSX.utils.decode_range(sheet['!ref']);
      if(range.e.r>250000 || range.e.c>800)throw Error('原表超出可校验范围');
      const lines=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,blankrows:true,range:0});
      const header=lines[0]?.map(v=>String(v??'').trim())??[];
      const dateCol=header.findIndex(v=>['日期','统计日期','统计时间','业务日期','时间'].includes(v));
      const expected=s.metrics.flatMap(m=>m.path).filter(v=>typeof v==='string').map(v=>v.split('#').at(-1));
      const matched=header.filter(v=>expected.includes(v));
      const metricCols=header.flatMap((name,index)=>expected.includes(name)?[index]:[]);
      if(!matched.length)throw Error('工作表与登记指标没有可核对的同名字段');
      let rows=0,firstRow=null,lastRow=null,hasValues=false;
      for(let i=1;i<lines.length;i++) {
        const line=lines[i];
        if(!line?.some(v=>v!==undefined && v!==''))continue;
        if(metricCols.some(col=>!['','-','--','—','N/A'].includes(String(line[col]??'').trim())))hasValues=true;
        if(dateCol>=0) {
          const actual=String(line[dateCol]??'').trim().replace(/[-/.]/g,'');
          if(actual!==date.replaceAll('-',''))throw Error('工作表存在未能归属目标日期的记录');
        }
        rows++;firstRow??=i+1;lastRow=i+1;
      }
      if(!rows)throw Error('工作表无明细行，未建立业务覆盖');
      if(!hasValues)throw Error('登记字段均为空或占位符，未建立业务覆盖');
      return [s.source_id,{status:'completed',coverage:{kind:'days',dates:[date]},
        evidence:{sheet:sheetName,range:sheet['!ref'],rows,firstRow,lastRow,header,matchedFields:matched,
          dateEvidence:dateCol<0?'选定单日及官方文件名':'逐行日期、选定单日及官方文件名'}}];
    } catch(error){return [s.source_id,{status:'unverified',error:error.message,coverage:null,evidence:{sheet:sheetName}}];}
  }));
}

export async function downloadCompass(page,id,storeName,registry) {
  const group=compassGroup(id),url=compassEntry(id);
  const date=isoDay(Date.now()-86400000);
  await page.setViewportSize({width:1440,height:900});
  await page.goto(url,{waitUntil:'commit',timeout:25000});
  const merchant=page.getByText(storeName,{exact:true}).filter({visible:true}).first();
  await merchant.waitFor({timeout:22000});
  const day=page.getByText(/^(近1天|昨天|昨日)$/).filter({visible:true}).first();
  await day.click({timeout:16000});
  // On the settlement page the adjacent advertising panel has its own independent date and export.
  const controls=group[1]==='/shop/settlement-analysis'?page.locator('[class^="filters-"]'):page;
  const download=controls.getByRole('button',{name:'下载明细',exact:true});
  await download.waitFor({timeout:12000});
  const event=page.waitForEvent('download',{timeout:35000});
  event.catch(()=>{});
  await download.click();
  const current=page.getByText('下载当前明细',{exact:true}).filter({visible:true}).first();
  // Moving the pointer from the trigger can collapse this hover menu across a fixed tab bar.
  if(await current.waitFor({timeout:2200}).then(()=>true,()=>false))await current.evaluate(el=>el.click());
  const file=await event, filename=file.suggestedFilename();
  if(!officialSingleDay(filename,date))throw Error('官方文件名未确认选中的单日统计区间：'+filename);
  if(page.url().split(/[?#]/)[0]!==url || !await merchant.isVisible())throw Error('下载完成时无法确认罗盘当前店铺或报表页面');
  const tmp=await file.path();
  if(!tmp || (await fs.stat(tmp)).size>40*1024*1024)throw Error('官方报表文件缺失或超过40 MB');
  const bytes=await fs.readFile(tmp);
  const members=inspectWorkbook(bytes,registry.filter(s=>s.enabled && compassGroup(s.source_id)===group),date);
  return {bytes,report:{kind:id,name:group[2],scope:'罗盘近1天明细，逐工作表验收',sourceUrl:url,capturedAt:new Date().toISOString(),members,
    artifact:{originalName:filename,sha256:createHash('sha256').update(bytes).digest('hex')}}};
}

export function officialSingleDay(filename,date) {
  const compact=date.replaceAll('-','');
  const interval=filename.match(/[-_](\d{8})[-_~至](\d{8})\.xlsx$/i);
  if(interval)return interval[1]===compact && interval[2]===compact;
  // The refund export uses one underscored calendar date instead of a range.
  const single=filename.match(/^抖音电商罗盘-[^\d]+-(\d{4})_(\d\d)_(\d\d)\.xlsx$/i);
  return !!single && single.slice(1).join('')===compact;
}

export async function archiveCompass(root,account,packet) {
  const dir=path.join(root,'source-originals',account);
  const final=path.join(dir,packet.report.artifact.sha256+'.xlsx'),tmp=final+'.'+randomUUID()+'.tmp';
  await fs.mkdir(dir,{recursive:true});
  try{
    await fs.writeFile(tmp,packet.bytes,{flag:'wx'});
    try{await fs.link(tmp,final);}catch(error){if(error.code!=='EEXIST')throw error;}
    if(createHash('sha256').update(await fs.readFile(final)).digest('hex')!==packet.report.artifact.sha256)throw Error('归档文件校验失败');
  } finally{await fs.rm(tmp,{force:true});}
  packet.report.artifact.file=final;
  return packet.report;
}
