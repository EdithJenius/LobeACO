import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as X from 'xlsx';
import {platforms,dateRange,norm,readRows,selectReport} from './customer-service-pages.mjs';
import {closeShopContext,trackTaskPage} from './page-cleanup.mjs';
import {checkSecurityPrompt} from './security-verification.mjs';
import {isPlatformLogin,validatePlatformUrl} from './platforms.mjs';

const output='D:/Date/各平台数据拉取流程/客服数据';
const safe=s=>s.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,95);
function comparable(v,platform,metric,source){
  const value=norm(v);
  if(platform==='taobao'&&['—','--',''].includes(value))return '';
  if(/^[\d,]+(?:\.\d+)?%?$/.test(value)){
    const n=Number(value.replace(/[,%]/g,''));
    return String(Math.round((source&&platform==='taobao'&&/率$/.test(metric)&&!value.includes('%')?n*100:n)*1000000)/1000000)+(value.includes('%')||(platform==='taobao'&&/率$/.test(metric))?'%':'');
  }
  return value;
}
export function compare(book,platform,shop,range,live) {
  const cfg=platforms[platform],key=cfg.sourceKey??cfg.key;
  let grid,head;
  for(const name of book.SheetNames){
    const rows=X.utils.sheet_to_json(book.Sheets[name],{header:1,raw:false,defval:''});
    const pos=rows.findIndex(r=>r.map(norm).includes(norm(key))&&r.map(norm).includes(norm(cfg.metrics[0])));
    if(pos>=0){grid=rows;head=pos;break;}
  }
  if(head===undefined)throw Error('原表未找到客服指标表头');
  if(platform==='wechat-shop'){
    const meta=grid.slice(0,head);
    if(!meta.some(r=>norm(r[0])==='店铺名称'&&String(r[1]).trim()===shop))throw Error('微信原表店名或日期与会话不符：店铺字段未通过');
    const rawDate=meta.find(r=>norm(r[0])==='数据时间')?.slice(1).join(' ')??'';
    const dates=rawDate.match(/\d{4}[-/]\d{2}[-/]\d{2}/g)?.map(d=>d.replaceAll('/','-'))??[];
    if(dates[0]!==range.start||dates.at(-1)!==range.end)throw Error('微信原表店名或日期与会话不符：平台标示 '+rawDate.trim());
  }
  const headers=grid[head].map(norm);
  const ix=[key,...cfg.metrics.map(m=>cfg.aliases?.[m]??m)].map(h=>headers.indexOf(norm(h)));
  if(ix.includes(-1))throw Error('平台原表缺少指定指标');
  const source=new Map();
  for(const r of grid.slice(head+1)){
    if(!r[ix[0]])continue;
    if(platform==='jd'&&(r[headers.indexOf('选择日期范围')]!==range.start+' / '+range.end||r[headers.indexOf('选择客服分组')]!=='全部'))throw Error('京麦原表日期或分组不符');
    if(platform==='douyin'&&!['店铺汇总值','店铺平均值'].includes(r[ix[0]]))continue;
    const row=ix.map(i=>r[i]);if(source.has(row[0]))throw Error('原表客服名重复：'+row[0]);source.set(row[0],row);
  }
  const page=new Map(live.map(r=>[r[0],r]));const details=[];
  for(const name of new Set([...page.keys(),...source.keys()])){
    const a=page.get(name),b=source.get(name);
    cfg.metrics.forEach((m,i)=>{
      if(platform==='douyin'&&((name==='店铺汇总值')!==(i<4)))return;
      const x=a?.[i+1],y=b?.[i+1];
      const status=!a?'仅原表有此行':!b?'仅页面有此行':comparable(x,platform,m,false)===comparable(y,platform,m,true)?'一致':'有差异';
      details.push([name,m,x??'',y??'',status]);
    });
  }
  if(!live.length||!source.size||!details.length)throw Error('缺少可核对的客服行');
  return {details,matched:details.filter(r=>r[4]==='一致').length};
}
function worksheet(rows,widths){
  const sheet=X.utils.aoa_to_sheet(rows);
  sheet['!cols']=widths.map(wch=>({wch}));
  sheet['!autofilter']={ref:sheet['!ref']};
  return sheet;
}
async function originalDownload(page,platform,cfg,range){
  const requestedAt=Math.floor(Date.now()/1000)*1000;
  let generatedAt;
  const owned=new Set([page]);const observe=p=>{owned.add(p);p.on('download',onDownload);p.on('popup',observe);};
  let pendingDownload;const onDownload=d=>{pendingDownload=d;};
  observe(page);
  try{
    await page.getByText(cfg.download,{exact:true}).filter({visible:true}).first().click({timeout:8000});
    let lastPrompt='',confirmed=false,downloadClicked=false;
    const deadline=Date.now()+30000;
    while(!pendingDownload&&Date.now()<deadline){
      for(const p of owned){
        if(p.isClosed())continue;
        const snapshot=await p.locator('body').ariaSnapshot({timeout:1500}).catch(()=>'');
        const controls=snapshot.split('\n').filter(l=>/下载|导出|生成|确定|确认|报表名称|保存至|数据类型/.test(l)&&l.length<280).slice(-24).join(' / ');
        if(controls)lastPrompt=controls;
        const dialog=p.getByRole('dialog').filter({visible:true}).last();
        if(platform==='taobao'&&!downloadClicked){
          const rangeLabel=range.start.replaceAll('-','')+'_'+range.end.replaceAll('-','');
          const rows=dialog.getByRole('row').filter({hasText:'客服绩效_'+rangeLabel+'_全部.xlsx'}).filter({hasText:'已完成'});
          const completed=await Promise.all((await rows.all()).map(async row=>({row,text:await row.innerText()})));
          const stamp=s=>s.match(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/)?.[0]??'';
          completed.sort((a,b)=>stamp(b.text).localeCompare(stamp(a.text)));
          for(const {row} of completed){
            const desc=await row.innerText();
            const timestamp=desc.match(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/);
            if(!timestamp)continue;
            // The official history reuses recent identical exports. Keep its actual generation time.
            const time=Date.parse(timestamp[0].replace(' ','T')+'+08:00');
            // For closed business days the portal can return the previously generated
            // official file on repeated exports. Accept only a completed report generated
            // after the period closed, and disclose its timestamp alongside today's UI read.
            const periodEnd=Date.parse(range.end+'T00:00:00+08:00')+86400000;
            const earliest=periodEnd<=requestedAt?periodEnd:requestedAt;
            if(!Number.isFinite(time)||time<earliest||time>requestedAt+120000)continue;
            const ready=row.getByText('下载',{exact:true});
            if(await ready.isVisible()){generatedAt=timestamp[0];await ready.click();downloadClicked=true;break;}
          }
        }
        const confirm=dialog.getByRole('button',{name:/^(确定|确认|导出|下载|确认下载)$/}).last();
        if(!confirmed&&await confirm.isVisible()){confirmed=true;await confirm.click();break;}
      }
      if(!pendingDownload)await page.waitForTimeout(350);
    }
    if(!pendingDownload)throw Error('平台尚未返回下载。当前控件 '+lastPrompt.slice(-800));
  }finally{for(const p of owned){p.off('download',onDownload);p.off('popup',observe);}}
  const download=pendingDownload;
  const filename=download.suggestedFilename(),ext=path.extname(filename).toLowerCase();
  if(!['.xlsx','.xls','.csv'].includes(ext))throw Error('平台下载的文件格式未识别：'+ext);
  const file=await download.path();
  if(!file||(await fs.stat(file)).size>50*1024*1024)throw Error('平台下载的文件不完整或超出读取上限');
  return {bytes:await fs.readFile(file),ext,filename,generatedAt};
}
export async function customerServiceReport(store,account,input,assertAccess) {
  const range=dateRange(input),profile=store.profiles.items.find(p=>p.id===account),platform=profile?.platform;
  const binding=store.state.shops[account],cfg=platforms[platform];
  if(!cfg||!binding?.storeName)throw Error('当前店铺尚无已核验的客服报表适配');
  const {manager}=store,shop=binding.storeName;
  const base={account,shop,platform,start:range.start,end:range.end};
  if(store.running.has(account)||manager.manual.has(account)||manager.sessions.has(account))return {...base,status:'blocked',reason:'店铺后台正在使用，请在空闲后重试'};
  if(binding.authStatus==='security_verification'||binding.pendingCheck)return {...base,status:'blocked',reason:binding.checkError||'等待账号持有人完成平台核验'};
  const run=manager.run(account,async()=>{
    let context,page,stage='核验店铺',staging;
    try{
      assertAccess();
      if(manager.manual.has(account)||manager.sessions.has(account))throw Error('该店铺有正在使用的后台');
      const manualVerification=['taobao','pinduoduo'].includes(platform);
      context=await manager.context(account,{background:!manualVerification,automatic:manualVerification,viewport:{width:1600,height:950}});
      const verify=store.chatBrowser.verifyForPlatform(platform);
      await verify(manager,account,binding,p=>checkSecurityPrompt(p,assertAccess));assertAccess();
      const guard=async()=>{assertAccess();validatePlatformUrl(page.url(),platform);const verified=await checkSecurityPrompt(page,assertAccess);
        const restriction=page.getByText(/^(您的)?(操作|访问|请求)(太过|过于|过|太)?频繁.{0,35}(稍后|再试).{0,12}$/).filter({visible:true}).first();
        if(await restriction.isVisible())throw Error(await restriction.innerText());
        if(isPlatformLogin(page.url(),platform))throw Object.assign(Error('平台要求重新登录'),{expired:true});
        return verified;
      };
      page=trackTaskPage(await context.newPage());page.setDefaultTimeout(12000);
      stage='打开客服报表';await page.goto(cfg.url,{waitUntil:'domcontentloaded',timeout:40000});await guard();
      stage='选择并核对日期';await selectReport(page,platform,range,guard);
      stage='独立读取客服表';let live=await readRows(page,platform,cfg,guard);
      stage='下载平台原表';await guard();const raw=await originalDownload(page,platform,cfg,range);
      if(platform==='jd'){
        await page.waitForLoadState('networkidle',{timeout:7000}).catch(()=>{});
        live=await readRows(page,platform,cfg,guard);
      }
      if(platform==='douyin'){
        const label=range.start.replaceAll('-','')+'-'+range.end.replaceAll('-','');
        if(!raw.filename.includes(label))throw Error('飞鸽官方文件名的统计区间不符');
        // Feige updates its calendar immediately while the previous table remains visible.
        // Re-observe the UI after export and the report refresh, before opening the file.
        await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
        stage='等待客服表现刷新';
        const deadline=Date.now()+14000;let stable=false;
        while(Date.now()<deadline){
          const before=await readRows(page,platform,cfg,guard);
          await page.waitForTimeout(900);
          const after=await readRows(page,platform,cfg,guard);
          if(JSON.stringify(before)===JSON.stringify(after)){live=after;stable=true;break;}
        }
        if(!stable)throw Error('飞鸽汇总值仍在刷新');
      }
      await guard();stage='核对原表';
      const book=X.read(raw.bytes,{type:'buffer'});
      let comparison=compare(book,platform,shop,range,live);
      const checkedBySearch=[];
      if(platform==='pinduoduo'){
        const missing=new Set(comparison.details.filter(r=>r[4]==='仅原表有此行').map(r=>r[0]));
        // The dashboard reorders tied rows across pages. Use only the account label from
        // reconciliation, then obtain all three values independently from the live filter.
        for(const customerAccount of missing){
          await guard();
          const field=page.getByRole('textbox',{name:'搜索客服账号'}).first();
          await field.fill(customerAccount);
          const query=page.getByRole('button',{name:'查询',exact:true}).filter({visible:true}).first();
          if(await query.isVisible())await query.click();
          const found=await readRows(page,platform,cfg,guard,customerAccount);
          if(found.length!==1)throw Error('客服筛选未能确认唯一账号：'+customerAccount);
          live.push(found[0]);checkedBySearch.push(customerAccount);
        }
        comparison=compare(book,platform,shop,range,live);
      }
      const {details,matched}=comparison;
      const out=X.utils.book_new();
      X.utils.book_append_sheet(out,worksheet([['店铺','平台','起始日','结束日','页面行数','核对项','一致项','平台下载文件名','平台标示生成时间（北京时间）'],[shop,cfg.name,range.start,range.end,live.length,details.length,matched,raw.filename,raw.generatedAt??'']],[25,16,14,14,12,12,12,48,28]),'任务');
      X.utils.book_append_sheet(out,worksheet([[cfg.key,...cfg.metrics],...live],[30,...cfg.metrics.map(()=>24)]),'独立读取');
      if(checkedBySearch.length)X.utils.book_append_sheet(out,worksheet([['原表提示的缺行账号','实读方式'],...checkedBySearch.map(n=>[n,'在实时客服绩效页按完整账号筛选并核对三项指标'])],[38,56]),'页面补查');
      X.utils.book_append_sheet(out,worksheet([['客服','指标','页面原值','平台原值','核对结果'],...details],[32,36,22,22,18]),'逐项核对');
      stage='保存报表';await fs.mkdir(output,{recursive:true});
      const prefix=safe(shop)+'_'+range.start+(range.end===range.start?'':'至'+range.end);
      const id=randomUUID();staging=await fs.mkdtemp(path.join(output,'.writing-'));
      const names=[prefix+'_'+cfg.name+'原始导出'+raw.ext,prefix+'_运营助手独立读取及核对.xlsx'];
      await fs.writeFile(path.join(staging,names[0]),raw.bytes);
      const audit=X.write(out,{type:'buffer',bookType:'xlsx'});await fs.writeFile(path.join(staging,names[1]),audit);
      const back=X.read(await fs.readFile(path.join(staging,names[1])),{type:'buffer'});
      if(X.utils.sheet_to_json(back.Sheets['逐项核对'],{header:1}).length!==details.length+1)throw Error('保存后复核条数不符');
      assertAccess();const dir=path.join(output,prefix+'_'+id.slice(0,8));await fs.rename(staging,dir);staging=null;
      return {...base,status:matched===details.length?'matched':'differences',rows:live.length,items:details.length,matched,searchedAccounts:checkedBySearch.length,originalGeneratedAt:raw.generatedAt,files:names.map(n=>path.join(dir,n)),sample:live[0],metrics:cfg.metrics};
    }catch(e){
      if(e.expired||e.authStatus){Object.assign(binding,{authStatus:e.authStatus||'expired',checkError:e.message,checkedAt:new Date().toISOString()});await store.save();}
      return {...base,status:'blocked',stage,reason:e.message.split('\n').slice(0,3).join(' ')};
    }finally{
      try{if(staging)await fs.rm(staging,{recursive:true,force:true});}
      finally{if(context)await closeShopContext(context);}
    }
  }).finally(()=>store.running.delete(account));
  store.running.set(account,run);return run;
}
