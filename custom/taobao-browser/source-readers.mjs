import { securityVerification } from './security-verification.mjs';
import {parseSellerDashboard} from './seller-dashboard.mjs';

const jdHome='https://sz.jd.com/sz/view/indexs.html';
const pddHome='https://mms.pinduoduo.com';
export const sourcePages={
  rpa_jd_shop_overview_metrics:jdHome,
  rpa_jd_shop_overview_product_top:jdHome,
  rpa_jd_shop_overview_cumulative_sales:jdHome,
  rpa_pdd_transaction_overview:pddHome+'/sycm/stores_data',
  rpa_pdd_traffic_overview:pddHome+'/sycm/search_data',
};

function between(text,start,end) {
  const a=text.indexOf(start), b=text.indexOf(end,a+start.length);
  if(a<0 || b<0)throw Error('没有找到本来源对应的数据区域');
  return text.slice(a+start.length,b);
}

function jdPayload(text,id) {
  const current=text.match(/当前[：:]\s*(\d{4}-\d\d-\d\d)\s*~\s*((?:\d{4}-)?\d\d-\d\d)/);
  if(!current)throw Error('商智页面没有显示所选比较期');
  const end=current[2].length===5?current[1].slice(0,5)+current[2]:current[2];
  const coverage={kind:'interval',intervals:[{start:current[1],end}]};
  if(id==='rpa_jd_shop_overview_cumulative_sales'){
    const block=between(text,'实时销售累计','商智AI');
    const rows=[...block.matchAll(/(月至今|年至今)\s*[¥￥]([\d,.]+(?:\s*万|\s*亿)?)/g)].map(m=>({口径:m[1],成交金额:m[2]}));
    if(new Set(rows.map(r=>r.口径)).size!==2)throw Error('未读到月、年两个累计值');
    return {rows,coverage:{kind:'observation'},scope:'实时销售累计，按页面月至今和年至今分别记录'};
  }
  if(id==='rpa_jd_shop_overview_product_top'){
    const block=between(text,'热销商品','实时销售累计');
    const rows=[...block.matchAll(/([^\n]+)\nSKU[:：]\s*(\d+)\s*[￥¥]([\d,.]+(?:\s*万|\s*亿)?)/g)].map(m=>({商品:m[1],SKU:m[2],成交金额:m[3]}));
    if(!rows.length)throw Error('未读到热销榜商品与金额');
    return {rows,coverage,scope:'商智经营概览所选区间，页面可见热销商品榜'};
  }
  const block=between(text,'查看更多','热销商品');
  const rows=[...block.matchAll(/(?:^|\n)(成交金额|商品访客数|成交客户数|成交转化率|成交单量)\n([￥¥]?[\d,.]+(?:\s*[万亿%])?)\n环比/g)].map(m=>({指标:m[1],值:m[2]}));
  if(new Set(rows.map(r=>r.指标)).size!==5)throw Error('核心指标卡尚未完整加载');
  return {rows,coverage,scope:'商智经营概览所选区间的五张指标卡'};
}

async function jdReport(page,id,name) {
  await page.goto(jdHome,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByText(name,{exact:true}).first().waitFor({timeout:16000});
  await page.getByText('经营概览',{exact:true}).first().waitFor();
  const close=page.locator('.win-notice-modal .close-modal:visible').first();
  if(await close.isVisible())await close.click();
  const month=page.locator('li[data-component-name="ComboDatePicker"][data-event-content="当前时间_月"]:visible').first();
  await month.waitFor();
  // The JD ad flyout overlays this tab in a narrow window. Activate the rendered date control.
  await month.evaluate(el=>el.click());
  await page.getByText(/当前[：:]\s*\d{4}-\d\d-\d\d\s*~/).first().waitFor();
  // The date selector updates before the previous period's figures finish animating.
  await page.waitForLoadState('networkidle',{timeout:3500}).catch(()=>{});
  const read=async()=>jdPayload(await page.locator('body').innerText(),id);
  const first=await read();
  await page.waitForTimeout(600);
  const final=await read();
  if(JSON.stringify(first)!==JSON.stringify(final))throw Error('商智区间数据仍在刷新，请重试');
  const url=new URL(page.url());
  if(!['jdsz.jd.com','sz.jd.com'].includes(url.hostname) || url.protocol!=='https:' || !await page.getByText(name,{exact:true}).first().isVisible())
    throw Error('商智当前店铺或页面来源未确认');
  return final;
}

async function pddReport(page,id) {
  await page.goto(sourcePages[id],{waitUntil:'domcontentloaded',timeout:30000});
  const traffic=id==='rpa_pdd_traffic_overview';
  const heading=traffic?'数据总览':'交易概况';
  await page.getByText(heading,{exact:true}).first().waitFor({timeout:16000});
  const challenge=page.getByText(/请向右滑块完成拼图|请完成安全验证/).filter({visible:true}).first();
  if(await challenge.isVisible())throw securityVerification('商家数据页要求账号持有人完成页面验证');
  const fields=['成交金额','成交订单数','成交买家数','成交转化率',...(traffic?['店铺访客数','店铺浏览量','商品访客数','商品浏览量']:[])];
  if(!traffic)await page.getByText('昨日',{exact:true}).filter({visible:true}).first().click();
  const yesterday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()-86400000);
  await page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>{});
  const text=await page.locator('body').innerText();
  if(await challenge.isVisible())throw securityVerification('商家数据页要求账号持有人完成页面验证');
  const block=traffic?text.slice(text.indexOf('数据总览')):between(text,'交易概况','年度经营情况');
  const date=block.match(/统计时间[：:]\s*(\d{4}-\d\d-\d\d)([^\n]*)/);
  if(!date || date[1]!==yesterday || date[2].trim())throw Error('未能核对昨日单日统计日期');
  const metrics=parseSellerDashboard(block,fields);
  if(Object.values(metrics).some(v=>v===null))throw Error('页面指标不完整或数字无法可靠读取');
  return {rows:[metrics],coverage:{kind:'days',dates:[yesterday]},scope:'昨日单日可核对的核心指标，其他模块未验证'};
}

export async function readRegisteredPage(page,id,name) {
  if(!Object.hasOwn(sourcePages,id))throw Error('没有该来源的页面执行器');
  const data=id.startsWith('rpa_jd_')?await jdReport(page,id,name):await pddReport(page,id);
  const url=new URL(page.url());
  if(id.startsWith('rpa_pdd_') && (url.origin!==pddHome || !url.pathname.startsWith(new URL(sourcePages[id]).pathname)))throw Error('拼多多报表跳转到其他页面');
  return {...data,kind:id,sourceUrl:url.origin+url.pathname,capturedAt:new Date().toISOString()};
}
