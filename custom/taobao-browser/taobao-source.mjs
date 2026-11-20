import { securityVerification } from './security-verification.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';

const origin='https://sycm.taobao.com';
export const rankId='rpa_tb_product_rank_export';
export const taobaoSourcePages={[rankId]:origin+'/cc/item_rank'};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function saveEvidence(root,storeId,bytes,ext) {
  if(!/^\d+$/.test(storeId)||!['.xlsx','.xls','.png','.json','.csv'].includes(ext))throw Error('店铺或原件类型无效');
  const dir=path.join(root,'taobao-source-originals',storeId),sha256=digest(bytes);
  await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,sha256+ext);
  try{await fs.writeFile(file,bytes,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  if(digest(await fs.readFile(file))!==sha256)throw Error('归档文件摘要不一致');
  return {file,sha256};
}

function tableRows(sheet){
  const range=XLSX.utils.decode_range(sheet['!ref']??'A1');
  if(range.e.r>150000 || range.e.c>500)throw Error('工作表超出可核验范围');
  return XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,blankrows:true,range:0});
}

export function rankProof(bytes){
  const workbook=XLSX.read(bytes,{type:'buffer'}),matches=[];
  for(const name of workbook.SheetNames){
    const rows=tableRows(workbook.Sheets[name]);
    const headerIndex=rows.slice(0,25).findIndex(r=>r.some(v=>/^(商品名称|商品标题|商品|主商品ID|商品ID)$/i.test(String(v).trim())) &&
      r.some(v=>/支付金额|商品访客数|支付件数/.test(String(v))));
    if(headerIndex<0)continue;
    const header=rows[headerIndex].map(v=>String(v??'').trim());
    const product=header.findIndex(v=>/^(商品名称|商品标题|商品|主商品ID|商品ID)$/i.test(v));
    const metric=header.flatMap((v,i)=>/支付金额|商品访客数|支付件数/.test(v)?[i]:[]);
    const valid=rows.flatMap((r,i)=>i>headerIndex && r[product] && metric.some(k=>/\d/.test(String(r[k]??'')))?[i+1]:[]);
    if(valid.length)matches.push({sheet:name,header,firstRow:valid[0],lastRow:valid.at(-1),rows:valid.length});
  }
  if(matches.length!==1)throw Error('无法在原表中确定唯一的商品排行数据表');
  return matches[0];
}

async function checkPage(page,url,storeName){
  if(page.url().split(/[?#]/)[0]!==url)throw Error('生意参谋页面跳转，未核实报表');
  if(await page.locator('.baxia-dialog-mask:visible').count())throw securityVerification('淘宝商品排行弹出安全验证，需由账号持有人在商家窗口完成');
  if(!await page.getByText(storeName,{exact:true}).first().isVisible())throw Error('报表页未核对到绑定店名');
}

export async function taobaoSource(page,id,root,storeId,storeName){
  if(id!==rankId)throw Error('未登记的淘宝报表');
  const url=taobaoSourcePages[id];
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
  await page.getByText(storeName,{exact:true}).first().waitFor({timeout:18000});
  try{
    await checkPage(page,url,storeName);
    await page.getByText('30天',{exact:true}).first().click();
    const stamp=page.getByText(/统计时间\s*\d{4}-\d\d-\d\d\s*~\s*\d{4}-\d\d-\d\d/).first();
    await stamp.waitFor({timeout:10000});
    const [start,end]=((await stamp.innerText()).match(/\d{4}-\d\d-\d\d/g)??[]);
    if(Date.parse(end)-Date.parse(start)!==29*86400000)throw Error('商品排行统计时间未确认连续30天');
    await checkPage(page,url,storeName);
    await page.getByText('报表',{exact:true}).first().click();
    const download=page.getByText(/^(下载报表|下载数据|导出报表|下载|导出)$/).or(page.getByTitle(/^(下载|导出)(报表|数据)?$/)).filter({visible:true});
    await download.first().waitFor({timeout:8000});
    if(await download.count()!==1)throw Error('无法确认唯一的商品排行下载控件');
    const [file]=await Promise.all([page.waitForEvent('download',{timeout:30000}),download.click()]);
    const originalName=file.suggestedFilename(),ext=path.extname(originalName).toLowerCase(),temp=await file.path();
    if(!['.xlsx','.xls'].includes(ext)||!temp||(await fs.stat(temp)).size>40*1024*1024)throw Error('商品排行未返回可核验的 Excel');
    await checkPage(page,url,storeName);
    if(!(await stamp.innerText()).includes(start)||!(await stamp.innerText()).includes(end))throw Error('下载后统计周期已改变');
    const bytes=await fs.readFile(temp);
    const evidence={...rankProof(bytes),...await saveEvidence(root,storeId,bytes,ext),originalName};
    return {kind:id,name:'淘宝商品排行',sourceUrl:url,capturedAt:new Date().toISOString(),coverage:{kind:'interval',intervals:[{start,end}]},evidence,scope:'商品排行近30天区间汇总'};
  }catch(error){
    if(page.url().split(/[?#]/)[0]===url){
      const blocked=await page.locator('.baxia-dialog-mask:visible').count();
      if(blocked)error=securityVerification('淘宝商品排行弹出安全验证，需由账号持有人在商家窗口完成');
      error.sourceUrl=url;
      const bytes=await page.screenshot({timeout:5000}).catch(()=>null);
      if(bytes)error.evidence={...await saveEvidence(root,storeId,bytes,'.png'),type:'执行现场截图'};
    }
    throw error;
  }
}
