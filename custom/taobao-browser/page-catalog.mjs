import { trackTaskPage, closeTaskPage, closeShopContext } from './page-cleanup.mjs';
import {isPlatformLogin} from './platforms.mjs';
import {readFinance} from './finance-view.mjs';

const home = 'https://myseller.taobao.com/home.htm/QnworkbenchHome/';
const sections = ['交易','商品','营销','推广','客服','店铺','私域','财务','金融','数据','服务'];
const officialPage = new Set(['myseller.taobao.com','sycm.taobao.com']);
const workflow = /发货|发布|创建|申请|开票|提现|还款|缴纳|充值|下单|授权|绑定|签约|订购|报名|设置|修改|编辑|批量|下载|核销|发起|开通|投放|装修|推广商品/;
function endpoint(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !/(?:^|\.)(?:taobao|tmall|alibaba|alimama|alipay)\.com$/.test(u.hostname)) return;
  const path = u.pathname.replace(/[\da-f]{12,}|\d{5,}|[A-Za-z0-9_-]{45,}|%[\da-f]{2}[^/]*/gi, ':id');
  const api = u.searchParams.get('api');
  return {host:u.host,path, ...(api && /^mtop\.[a-z0-9._-]+$/i.test(api) ? {api} : {})};
}
async function discover(page) {
  const result=[{section:'首页',name:'千牛工作台',url:home}];
  for(const section of sections){
    const nav=page.locator('a[class*="navItem"],a[class*="NavItem"]').filter({hasText:new RegExp('^'+section+'$')}).first();
    if(!await nav.count())continue;
    const parent=await nav.getAttribute('href');
    if(!parent?.includes('_firstmenuid_')){if(parent)result.push({section,name:section,url:new URL(parent,home).href});continue;}
    await nav.hover({timeout:3500}).catch(()=>{});
    const overlay=page.locator('[class*="next-overlay-inner"]:visible').filter({has:page.locator('a[href]')}).last();
    await page.waitForTimeout(250);
    const links=await overlay.locator('a[href]').evaluateAll(es=>es.map(e=>({name:e.innerText.trim(),url:e.href})));
    for (const link of links) if(link.name && link.name.length<35 && /^https:\/\//.test(link.url)) result.push({section,...link});
  }
  return result;
}
async function observe(ctx, item) {
  const page=trackTaskPage(await ctx.newPage());
  const requests=new Map();
  const start=Date.now();
  page.on('response',res=>{
    const req=res.request();
    const kind=req.resourceType();
    if(!['xhr','fetch'].includes(kind) && !(kind==='script' && /\/h5\/mtop\./i.test(req.url())))return;
    const address=endpoint(req.url());
    if(!address)return;
    const record={method:req.method(),...address,status:res.status(),type:kind};
    const k=JSON.stringify(record);
    const row=requests.get(k)??{...record,count:0};row.count++;requests.set(k,row);
  });
  const output={capturedAt:new Date().toISOString()};
  try {
    const response=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:22000});
    const finance=item.url.includes('/whale-accountant/index');
    if(finance) await page.getByText('收入金额(元)',{exact:true}).first().waitFor({timeout:15000}).catch(()=>{});
    await page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>{});
    await page.waitForTimeout(600);
    output.http=response?.status();
    const text=await page.locator('body').innerText({timeout:5000});
    output.status=isPlatformLogin(page.url(),'taobao') || /^.{0,30}(?:扫码登录|密码登录)/.test(text) ? '需要登录' :
      /无访问权限|暂无权限|没有权限访问|当前账号无权限/.test(text) ? '权限提示' : output.http >= 400 ? '页面错误' : '已观测';
    if (finance && output.status==='已观测') output.finance=readFinance(text);
    output.columns=[...new Set(await page.locator('th,[role="columnheader"]').allInnerTexts())].map(s=>s.trim()).filter(s=>s.length>0&&s.length<30).slice(0,35);
  } catch(e){output.status='页面未加载完成';output.error=e.name;}
  finally {await closeTaskPage(page);}
  return {...output,durationMs:Date.now()-start,requests:[...requests.values()]};
}
export async function pageCatalog(manager, account, identity, skipRoutes = new Set()) {
  const alreadyOpen=manager.sessions.has(account);
  const ctx=await manager.context(account,{background:true});
  let page;
  try {
    page=trackTaskPage((!alreadyOpen && ctx.pages().find(p=>p.url()==='about:blank')) || await ctx.newPage());
    await page.goto(home,{waitUntil:'domcontentloaded',timeout:45000});
    await page.getByText(identity.storeName,{exact:true}).first().waitFor({timeout:18000});
    const items=await discover(page);
    const visited=new Map(), pages=[];
    for(const item of items){
      const url=new URL(item.url);
      const row={section:item.section,name:item.name,route:url.origin+url.pathname};
      const key=item.url;
      if(!officialPage.has(url.hostname)) row.status='外部入口，仅登记';
      else if (workflow.test(item.name) || /用户触达|内容创作|打单|寄快递|爆款竞价/.test(item.name)) row.status='业务操作入口，仅登记';
      else if (skipRoutes.has(row.route)) row.status='已在同次盘点中观测';
      else if(visited.has(key)) row.sameAs=visited.get(key);
      else { Object.assign(row,await observe(ctx,item)); visited.set(key,pages.length); }
      pages.push(row);
    }
    return {account,store:identity.storeName,verifiedAt:identity.finishedAt,completedAt:new Date().toISOString(),pages};
  } finally {
    if(alreadyOpen) await closeTaskPage(page);
    else await closeShopContext(ctx);
  }
}
