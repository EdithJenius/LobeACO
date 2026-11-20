export const platforms = {
  'wechat-shop': {name:'微信小店',url:'https://store.weixin.qq.com/shop/kf/staff/examine',key:'全部客服',sourceKey:'客服人员名称',
    metrics:['咨询用户数','咨询会话数','3分钟人工回复率','平均回复时长','不回复率','用户满意度'], aliases:{用户满意度:'用户满意率'},download:'下载'},
  jd: {name:'京麦',url:'https://xi.jd.com/kf-manage-lite/#/DataAnalysis/AssessmentData',key:'客服',
    metrics:['工作时间咨询量','工作时间接待量','工作时间无响应量','工作时间留言量','工作时间咚咚首次30s应答率','工作时间3分钟人工回复率','工作时间3分钟内人工回复量','工作时间平均响应时长（新标）','全天咨询量','满意率','咨询差评率','差评量','好评量','评价量'],download:'导出Excel'},
  taobao: {name:'生意参谋',url:'https://sycm.taobao.com/qos/service/self_made_report',key:'旺旺昵称',
    metrics:['接待人数','旺旺回复率','平均响应时长（秒)','客户满意率','收到评价数','不满','很不满','很满意','满意','发出评价数','一般'],download:'下载'},
  pinduoduo:{name:'拼多多',url:'https://mms.pinduoduo.com/mms-chat/overview/merchant',key:'客服账号',
    metrics:['人工接待人数','3分钟人工回复率','平均人工响应时长'],aliases:{'3分钟人工回复率':'3分钟人工回复率(8-23点)'},download:'下载表单'},
  douyin:{name:'飞鸽',url:'https://im.jinritemai.com/pc_seller_v2/main/data/customerService/index',key:'客服昵称',
    metrics:['已接待人数','有效评价数','有效好评数','有效差评数','全天满意率','全天平响时长','全天3分钟回复率'],download:'导出数据'},
};
export function dateRange(input,now=new Date()) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const yesterday=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  if(input.endDate&&!input.startDate)throw Error('请指定开始日期');
  const start=input.startDate??yesterday,end=input.endDate??start;
  for(const d of [start,end]){
    if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('无效的业务日期');
  }
  if(start>end||end>day)throw Error('日期顺序不正确或包含未来日期');
  return {start,end};
}
export const norm=s=>String(s??'').replace(/\s/g,'').replaceAll('（','(').replaceAll('）',')');
const vis=(loc)=>loc.filter({visible:true}).first();
async function chooseDay(page,date,platform) {
  const [y,m,d]=date.split('-').map(Number);
  for(let step=0;step<36;step++){
    if(platform==='wechat-shop'){
      const caption=vis(page.getByText(new RegExp('^'+y+'年\\s*0?'+m+'月$')));
      if(await caption.isVisible()){
        const panel=caption.locator('xpath=ancestor::*[descendant::table][1]');
        const link=panel.getByRole('link',{name:String(d),exact:true}).and(panel.locator('a:not([class*="disabled"])')).filter({visible:true});
        if(await link.count()===1){await link.click();return;}
      }
    }
    const exact=vis(page.locator('[title="'+date+'"],[data-date="'+date+'"]'));
    if(await exact.isVisible()){await exact.click();return;}
    if(platform==='pinduoduo'){
      const calendars=page.locator('table:visible').filter({has:page.getByRole('columnheader',{name:'一',exact:true})});
      const years=await page.locator('input:visible').evaluateAll(es=>es.map(e=>e.value).filter(v=>/^\d{4}年$/.test(v)).map(parseFloat));
      const months=await page.getByText(/^\s*\d{1,2}月\s*$/).filter({visible:true}).allInnerTexts();
      const monthIndex=months.findIndex((label,i)=>parseInt(label)===m&&years[i]===y);
      if(monthIndex>=0&&await calendars.count()===months.length){
        const cells=calendars.nth(monthIndex).locator('tbody td');
        const numbers=(await cells.allInnerTexts()).map(s=>Number(s.trim()));
        const first=numbers.indexOf(1),offset=first+d-1;
        if(first>=0&&numbers[offset]===d){await cells.nth(offset).click();return;}
      }
    }
    const month=vis(page.getByText(new RegExp('^'+y+'\\s*年\\s*0?'+m+'\\s*月$')));
    if(await month.isVisible()){
      const block=month.locator('xpath=ancestor::*[descendant::table][1]');
      const day=block.getByText(String(d),{exact:true}).filter({visible:true});
      const usable=day.and(block.locator('a:not([class*="disabled"]),td:not([class*="disabled"]),[role=gridcell]:not([aria-disabled=true])'));
      if(await usable.count()===1){await usable.click();return;}
      if(await day.count()===1){await day.click();return;}
    }
    const dates=await page.locator('[title]').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&/^\d{4}-\d{2}-\d{2}$/.test(e.title)).map(e=>e.title));
    const monthLabels=await page.getByText(/^\d{4}年\s*\d{1,2}月$/).allTextContents();
    const first=dates.sort()[0]??monthLabels[0]?.replace(/(\d+)年\s*(\d+)月/,(_,a,b)=>a+'-'+b.padStart(2,'0')+'-01');
    if(!first)break;
    const dir=date<first?'prev':'next';
    const nav=vis(page.locator('[class*="'+dir+'-month"],[class*="month-'+dir+'"],button[class*="'+dir+'-btn"]:not([class*="super"]),[title="'+(dir==='prev'?'上个月':'下个月')+'"]'));
    if(!await nav.isVisible())break;
    await nav.click();
  }
  throw Error(platform+'日历未能定位 '+date);
}
async function inputDates(page){
  return page.locator('input:visible').evaluateAll(es=>es.map(e=>e.value.replaceAll('/','-')).filter(Boolean));
}
export async function selectReport(page,platform,range,guard) {
  const {start,end}=range;
  const exact=(s)=>vis(page.getByText(s,{exact:true}));
  if(platform==='jd') {
    await page.locator('input[placeholder="开始日期"]').first().click();
    await chooseDay(page,start,platform);await chooseDay(page,end,platform);
    await exact('查询').click();
    await page.getByRole('tab',{name:'客服数据对比'}).click();
    // The tab caption changes before the daily totals table is replaced by the agent table.
    await page.getByRole('cell',{name:'总值',exact:true}).first().waitFor();
    await page.getByRole('cell',{name:'均值',exact:true}).first().waitFor();
  } else if(platform==='wechat-shop') {
    await page.locator('input[placeholder="开始日期"]').first().waitFor();
    const welcome=exact('我知道了'); if(await welcome.isVisible())await welcome.click();
    // WeChat keeps a separate realtime export mode. Switch the toolbar to history
    // before applying a custom calendar range, then verify the exported interval.
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
    if(end<today){
      await exact('昨日').click();
      await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});
    }
    await page.locator('input[placeholder="开始日期"]').first().click();
    await chooseDay(page,start,platform);await chooseDay(page,end,platform);
    await page.waitForLoadState('networkidle',{timeout:7000}).catch(()=>{});
    const popup=vis(page.getByText(/^\d{4}年\s*\d+月$/));
    await popup.waitFor({state:'hidden'});
    await page.getByRole('table').filter({hasText:'用户满意度'}).last().waitFor();
    if(start===end&&end<today){
      await page.getByRole('columnheader',{name:'操作',exact:true}).first().waitFor();
    }
  } else if(platform==='pinduoduo'){
    const date=vis(page.locator('input[placeholder*="结束时间"]').or(page.getByRole('textbox',{name:/开始时间.*结束时间/})));
    // The sidebar label is present before the report mounts. Clicking it during
    // hydration can open the sidebar instead of the selected report.
    let until=Date.now()+30000,reopened=false;
    while(!await date.isVisible()&&Date.now()<until){
      const verified=await guard();
      if(verified)until=Date.now()+30000;
      const current=new URL(page.url()),report=new URL(platforms.pinduoduo.url);
      if(!reopened&&current.origin===report.origin&&current.pathname!==report.pathname){
        reopened=true;
        await page.goto(report.href,{waitUntil:'domcontentloaded',timeout:30000});
      }
      await page.waitForTimeout(300);
    }
    if(!await date.isVisible()){
      const controls=await page.locator('input:visible,[role=tab]:visible').evaluateAll(es=>es.map(e=>e.placeholder||e.innerText).filter(Boolean));
      throw Error('未找到客服绩效日期框，当前页面 '+new URL(page.url()).pathname+' '+controls.join(' / '));
    }
    await date.click();
    await chooseDay(page,start,platform);await chooseDay(page,end,platform);await exact('确认').click();
  } else if(platform==='douyin'){
    await page.getByRole('tab',{name:'客服表现'}).waitFor();
    const notice=page.getByRole('button',{name:'Close',exact:true}).filter({visible:true});
    // Feige leaves a second, transparent announcement layer over its close icon.
    await guard();
    for(const button of await notice.all()){
      await button.evaluate(el=>el.click()).catch(()=>{});
    }
    if(start===end&&dateRange({}).start===start)await exact('昨天').click();
    else {await vis(page.locator('input[placeholder="开始日期"]')).click();await chooseDay(page,start,platform);await chooseDay(page,end,platform);}
  } else if(platform==='taobao'){
    const tab=page.getByRole('tab',{name:'售前客服个人绩效'});await tab.click();
    const stats=page.getByText(/统计时间/).filter({visible:true}).last();await stats.waitFor();
    const shown=async()=>((await stats.innerText())+' '+(await stats.locator('..').innerText())).match(/\d{4}-\d{2}-\d{2}/g)??[];
    if(!(start===end&&(await shown()).includes(start))){await stats.click();await chooseDay(page,start,platform);if(end!==start)await chooseDay(page,end,platform);}
    const dates=await shown();if(!dates.includes(start)||!dates.includes(end))throw Error('淘宝报表统计时间未确认');
    await guard();return;
  }
  await guard();
  const dates=(await inputDates(page)).join(' ').match(/\d{4}-\d{2}-\d{2}/g)??[];
  if(!dates.some((v,i)=>v===start&&dates[i+1]===end))throw Error('页面起止日期与请求不符：'+dates.join(' / '));
}

async function tables(page) {
  return page.locator('table:visible').evaluateAll(els=>els.map(t=>Array.from(t.rows??[],r=>Array.from(r.cells,c=>Array.from({length:c.colSpan||1},()=>c.innerText.trim())).flat())));
}
export async function readRows(page,platform,cfg,guard,onlyAccount) {
  const root=platform==='taobao'?page.getByRole('tabpanel',{name:'售前客服个人绩效'}):page;
  await root.getByText(cfg.metrics[0],{exact:true}).first().waitFor();
  if(platform==='douyin'){
    const headerRow=page.getByRole('row').filter({has:page.getByRole('columnheader',{name:'客服昵称'})}).first();
    const columns=(await headerRow.getByRole('columnheader').allInnerTexts()).map(norm);
    const online=columns.indexOf('在线状态');
    const indices=cfg.metrics.map(m=>columns.indexOf(norm(m)));
    if(online<0||indices.some(i=>i<=online))throw Error('飞鸽客服表现未展示完整七项指标：'+columns.join('、'));
    const output=[];
    for(const label of ['店铺汇总值','店铺平均值']){
      const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:label,exact:true})}).first();
      await row.waitFor();
      // Summary rows merge the rank/name cells and omit the final action column.
      const cells=(await row.getByRole('cell').allInnerTexts()).map(v=>v.trim());
      const first=cells.indexOf(label);
      const values=indices.map(i=>cells[first+1+i-online]);
      if(first<0||values.some(v=>v===undefined))throw Error('飞鸽汇总行与指标列未对齐');
      output.push([label,...values]);
    }
    await guard();return output;
  }
  const get=async()=>{
    const grids=await tables(root);
    const header=grids.flat().find(r=>r.some(v=>norm(v)===norm(cfg.key))&&r.some(v=>norm(v)===norm(cfg.metrics[0])));
    if(!header)return [];
    const ix=[cfg.key,...cfg.metrics].map(h=>header.findIndex(c=>norm(c)===norm(h)));
    if(ix.includes(-1))throw Error('页面缺少指标 '+[cfg.key,...cfg.metrics].filter((_,i)=>ix[i]<0).join('、'));
    const own=grids.find(g=>g.includes(header));
    const isRecord=r=>r.length===header.length&&r!==header&&r[ix[0]]&&norm(r[ix[0]])!==norm(cfg.key)&&new Set(r).size>1;
    const inline=own.filter(isRecord);
    if(platform==='jd'){
      // Scope to the matching customer comparison table. Other panels can stay mounted
      // with an identical number of metric columns when the date range changes.
      const comparison=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'客服',exact:true})}).filter({visible:true}).last();
      const headerRow=comparison.getByRole('row').filter({has:page.getByRole('columnheader',{name:'客服',exact:true})}).last();
      const cols=(await headerRow.getByRole('columnheader').allInnerTexts()).map(norm);
      const indices=[cfg.key,...cfg.metrics].map(h=>cols.indexOf(norm(h)));
      const records=await comparison.getByRole('row').evaluateAll(es=>es.map(e=>Array.from(e.querySelectorAll('td'),c=>c.innerText.trim())).filter(r=>r.length));
      if(records.length&&indices.every(i=>i>=0)){
        const result=records.filter(r=>r.length===cols.length).map(r=>indices.map(i=>r[i]));
        if(result.some(r=>r[0]==='总值')&&result.some(r=>r[0]==='均值')){
          if(result.some(r=>r[0]==='--')&&!result.some(r=>!['--','总值','均值'].includes(r[0])))return [];
          return result;
        }
      }
      console.info('京麦对比表结构',JSON.stringify({cols,recordLabels:records.slice(0,7).map(r=>[r.length,...r.slice(0,2)]),tableShapes:grids.map(g=>g.slice(0,2).map(r=>[r.length,...r.slice(0,3)]))}));
    }
    // Fixed-header tables may render the body as the following sibling table.
    const jdBody=platform==='jd'?grids.find(g=>g.some(r=>r[ix[0]]==='总值')&&g.some(r=>r[ix[0]]==='均值')):undefined;
    const all=jdBody?jdBody.filter(isRecord):inline.length?inline:(grids[grids.indexOf(own)+1]??[]).filter(isRecord);
    const rows=all.map(r=>ix.map(i=>r[i]));
    return onlyAccount?rows.filter(r=>r[0]===onlyAccount):rows;
  };
  const data=new Map();let previous;
  for(let pageNumber=1;pageNumber<=1000;pageNumber++){
    let rows=[];const deadline=Date.now()+12000;
    do{await guard();rows=await get();if(rows.length&&JSON.stringify(rows)!==previous)break;await page.waitForTimeout(220);}while(Date.now()<deadline);
    if(!rows.length||JSON.stringify(rows)===previous)throw Error('客服表未加载或翻页未更新');
    for(const row of rows){
      const old=data.get(row[0]);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('客服标识重复且指标冲突：'+row[0]+' '+JSON.stringify(old.slice(1,4))+' / '+JSON.stringify(row.slice(1,4)));
      data.set(row[0],row);
    }
    if(onlyAccount)break;
    const next=vis(root.locator('li[title="下一页"],button[aria-label="下一页"],[class*="pagination-next"],[class*="pagination__next"],[data-testid="beast-core-pagination-next"]'));
    if(!await next.isVisible()||await next.evaluate(e=>e.matches(':disabled,[disabled],[aria-disabled=true],[class*="disabled"]')||!!e.querySelector('button:disabled')))break;
    previous=JSON.stringify(rows);await next.click();
  }
  return [...data.values()];
}
