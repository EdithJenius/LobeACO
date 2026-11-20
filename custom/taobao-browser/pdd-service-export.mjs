import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import * as XLSX from 'xlsx';
import {parse} from 'csv-parse/sync';

const metrics=['人工接待人数','3分钟人工回复率','平均人工响应时长'];
const normalize=v=>String(v??'').replace(/\s/g,'').replace('三分钟','3分钟');

export async function isServiceExport(frame,button) {
  if(new URL(frame.url()).origin!=='https://mms.pinduoduo.com') return false;
  if(normalize(await button.textContent())!=='下载表单') return false;
  const tables=await frame.getByRole('table').allInnerTexts();
  return tables.some(t=>metrics.every(k=>normalize(t).includes(k)));
}

export async function saveServiceExport(download,root,account,assertAccess) {
  const ext=path.extname(download.suggestedFilename()).toLowerCase();
  if(!['.xlsx','.xls','.csv'].includes(ext))throw Error('下载结果不是客服表格');
  const temp=await download.path();
  if(!temp||(await fs.stat(temp)).size>40*1024*1024)throw Error('客服表单下载不完整或超出大小限制');
  const bytes=await fs.readFile(temp);
  let sheets;
  if(ext==='.csv'){
    let csv;
    try{csv=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch{csv=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}
    sheets=[parse(csv,{bom:true,to:35,relax_column_count:true,skip_empty_lines:true})];
  }else{
    const book=XLSX.read(bytes,{type:'buffer',sheetRows:35});
    sheets=book.SheetNames.map(n=>XLSX.utils.sheet_to_json(book.Sheets[n],{header:1}));
  }
  const hasHeader=sheets.some(rows=>rows.some(row=>{
    const headers=row.map(normalize);
    return metrics.every(k=>headers.some(h=>h===k||h.startsWith(k+'（')||h.startsWith(k+'(')));
  }));
  if(!hasHeader)throw Error('下载内容未找到完整的客服绩效指标表头');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const folder=path.join(root,'pdd-service-exports',account);
  await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,hash+ext),stage=path.join(folder,randomUUID()+'.tmp');
  try {
    await fs.writeFile(stage,bytes,{flag:'wx'});
    assertAccess();
    try{await fs.link(stage,file);}catch(e){if(e.code!=='EEXIST')throw e;}
  } finally {await fs.rm(stage,{force:true});}
  return {file,originalName:download.suggestedFilename(),sha256:hash,bytes:bytes.length};
}
