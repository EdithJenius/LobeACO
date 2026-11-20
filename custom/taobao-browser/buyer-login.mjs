import { closeShopContext, closeTaskPage, trackTaskPage } from './page-cleanup.mjs';
import { isPlatformLogin, validatePlatformUrl } from './platforms.mjs';
import { checkSecurityPrompt } from './security-verification.mjs';

export function readBuyerSession(platform) {
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const labels = [...document.querySelectorAll('a,button,[role="button"]')].filter(visible)
    .map(el => (el.innerText || '').trim());
  const loggedIn = labels.some(t=>/^(退出登录|退出登陆|安全退出|Sign out|Log out)$/i.test(t));
  const signedOut = labels.some(t=>/^(亲，请登录|亲，请先登录|立即登录|请登录|登录|Sign in|Log in)$/i.test(t));
  let name = '';
  if (platform==='taobao-buyer' || platform==='tmall-buyer') {
    const nick = [...document.querySelectorAll('.site-nav-login-info-nick,#J_SiteNavLogin .site-nav-user a.vip-name,[class*="site-nav-login-info-nick"]')]
      .find(el=>visible(el) && el.innerText.trim());
    if (nick && !/登录|注册/.test(nick.innerText)) name = nick.innerText.trim().slice(0,100);
  }
  return {authenticated:Boolean(name || loggedIn),name,signedOut};
}

export async function verifyBuyer(manager,account,binding,inspect=checkSecurityPrompt) {
  const platform=manager.platform(account);
  const owned=!manager.sessions.has(account);
  const ctx=await manager.context(account,{background:true});
  let page;
  try {
    page=trackTaskPage(await ctx.newPage());
    await page.goto(platform.homeUrl,{waitUntil:'domcontentloaded',timeout:30000});
    let deadline=Date.now()+12000;
    let signedOut=false;
    do {
      if(await inspect(page))deadline=Date.now()+12000;
      const url=validatePlatformUrl(page.url(),platform.id);
      if (isPlatformLogin(url,platform.id)) throw Object.assign(Error('买家账号未登录'),{expired:true});
      const state=await page.evaluate(readBuyerSession,platform.id);
      signedOut=state.signedOut;
      if (state.authenticated) {
        if(inspect!==checkSecurityPrompt && await inspect(page,{confirm:true})){deadline=Date.now()+12000;continue;}
        if (binding.accountName && state.name && state.name!==binding.accountName)
          throw Error('当前买家账号与已绑定账号不同，请为此账号新建环境');
        return state.name?{accountName:state.name}:{};
      }
      await page.waitForTimeout(400);
    } while(Date.now()<deadline);
    if (signedOut) throw Object.assign(Error('买家账号未登录'),{expired:true});
    throw Error('未能在买家页面确认登录状态，请打开账号核对');
  } finally {
    if(owned) await closeShopContext(ctx);
    else await closeTaskPage(page);
  }
}
