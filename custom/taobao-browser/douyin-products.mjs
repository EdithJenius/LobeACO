import {closeShopContext, closeTaskPage, trackTaskPage} from './page-cleanup.mjs';
import {isPlatformLogin} from './platforms.mjs';
import {checkSecurityPrompt} from './security-verification.mjs';

// Capture the platform's copy result inside this task page, without altering the OS clipboard.
export function captureCopies() {
  window.__shopCopies=[];
  const original=document.execCommand.bind(document);
  document.execCommand=function(command,...args) {
    if (String(command).toLowerCase()==='copy') {
      window.__shopCopies.push(String(window.getSelection() || document.activeElement?.value || ''));
      return true;
    }
    return original(command,...args);
  };
  try { Object.defineProperty(navigator.clipboard,'writeText',{value:async value=>{window.__shopCopies.push(String(value));}}); } catch {}
}

export async function readDouyinProducts(manager, account, binding, verify, limit=1000) {
  if (!Number.isInteger(limit) || limit<1 || limit>1000) throw Error('商品数量须为 1 至 1000');
  if (!binding?.storeName) throw Error('请先核验店铺身份');
  const owned=!manager.sessions.has(account);
  const context=await manager.context(account,{automatic:true});
  let page;
  try {
    const identity=await verify(manager,account,binding);
    page=trackTaskPage(await context.newPage());
    await page.setViewportSize({width:1440,height:5000});
    await page.addInitScript(captureCopies);
    await page.goto('https://fxg.jinritemai.com/ffa/g/list',{waitUntil:'domcontentloaded',timeout:45000});
    await checkSecurityPrompt(page);
    if(isPlatformLogin(page.url(),'douyin') || new URL(page.url()).origin!=='https://fxg.jinritemai.com') throw Error('商品页面跳转，请检查登录和权限');
    await page.getByRole('tab',{name:'售卖中',exact:true}).waitFor({timeout:30000});
    const rows=[],seen=new Set();let pages=0,reason='';
    while(rows.length<limit) {
      await page.locator('tbody tr[data-row-key]').first().waitFor({timeout:25000});
      // Douyin renders rows incrementally as they enter the viewport.
      await page.waitForFunction(()=>document.querySelectorAll('tbody tr[data-row-key]').length>=20,undefined,{timeout:12000}).catch(()=>{});
      const current=await page.locator('tbody tr[data-row-key]').evaluateAll(items=>items.filter(x=>x.getClientRects().length).map(x=>({
        id:x.getAttribute('data-row-key'),title:x.querySelector('[class*="productNameNew"]')?.textContent?.trim()||'',
      })));
      if(!current.length) {reason='未读取到商品行';break;}
      pages++;
      for(const item of current) {
        if(rows.length>=limit)break;
        if(!/^\d+$/.test(item.id||'') || seen.has(item.id)) {reason='商品 ID 缺失或跨页重复，已停止以避免重复';break;}
        const row=page.locator(`tbody tr[data-row-key="${item.id}"]`);
        await page.evaluate(()=>{window.__shopCopies=[];});
        await row.getByRole('button',{name:'复制链接',exact:true}).click({timeout:10000});
        const copied=await page.evaluate(()=>window.__shopCopies.at(-1) || '');
        let link;
        try {const u=new URL(copied);if(u.protocol==='https:' && u.hostname==='haohuo.jinritemai.com' && u.searchParams.get('id')===item.id)link=u.href;} catch {}
        if(!link) {reason=`商品 ${item.id} 未返回可核验的复制链接`;break;}
        rows.push({id:item.id,title:item.title,url:link});seen.add(item.id);
      }
      if(reason || rows.length>=limit)break;
      const next=page.locator('li[title="下一页"] button');
      if(!await next.count() || await next.isDisabled()){reason='已到最后一页';break;}
      const first=current[0].id;
      await next.click();
      try {await page.waitForFunction(id=>{const row=document.querySelector('tbody tr[data-row-key]');return row && row.getAttribute('data-row-key')!==id;},first,{timeout:25000});}
      catch {reason='翻页后商品列表没有更新';break;}
    }
    await verify(manager,account,identity);
    return {account,platform:'douyin',name:identity.storeName,authStatus:'authenticated',latest:null,
      report:{kind:'products',name:'抖店商品管理',sourceUrl:'https://fxg.jinritemai.com/ffa/g/list',capturedAt:new Date().toISOString(),
        scope:`售卖中列表；按后台当前排序读取 ${pages} 页；已获取 ${rows.length}/${limit} 条`,rows,complete:rows.length===limit,reason:reason||null}};
  } finally {
    if(owned && manager.sessions.get(account)===context) await closeShopContext(context);
    else await closeTaskPage(page);
  }
}
