import { checkSecurityPrompt } from './security-verification.mjs';
import { trackTaskPage, closeTaskPage, closeShopContext } from './page-cleanup.mjs';
import { isPlatformLogin } from './platforms.mjs';

export async function verifySellerPage(manager, account, binding, source) {
  const owned = !manager.sessions?.has(account);
  const context = await manager.context(account, {background:true});
  let page;
  try {
    page = trackTaskPage(await context.newPage());
    await page.goto(source.entryUrl, {waitUntil:'commit', timeout:14000});
    const identityTimeout=source.identityTimeout ?? 16000;
    let deadline = Date.now() + identityTimeout;
    do {
      if(await (source.checkPrompt??checkSecurityPrompt)(page)){
        deadline=Date.now()+identityTimeout;
        const current=new URL(page.url());
        if(current.origin!==new URL(source.entryUrl).origin || !source.paths.includes(current.pathname.replace(/\/$/,'')))
          await page.goto(source.entryUrl,{waitUntil:'commit',timeout:14000});
      }
      const url = new URL(page.url());
      const signedOut = source.signedOut && url.origin === new URL(source.entryUrl).origin &&
        await page.getByText(source.signedOut).filter({visible:true}).first().isVisible();
      if (signedOut || isPlatformLogin(url.href, source.platform))
        throw Object.assign(Error(source.name+'商家后台要求重新登录'), {expired:true});
      if (url.origin === new URL(source.entryUrl).origin && source.paths.includes(url.pathname.replace(/\/$/, ''))) {
        const raw = await page.evaluate(source.readName).catch(() => null);
        const name = typeof raw === 'string' ? raw.replace(/^[\s\u200b]+|[\s\u200b]+$/gu, '') : '';
        if (name) {
          if(source.checkPrompt && await source.checkPrompt(page,{confirm:true})){
            deadline=Date.now()+identityTimeout;
            continue;
          }
          if (binding.storeName?.trim() && binding.storeName.trim() !== name)
            throw Error('当前'+source.name+'店名与已绑定店铺不一致，请核对登录账号');
          return {storeName:name};
        }
      }
      await new Promise(resolve => setTimeout(resolve,200));
    } while (Date.now() < deadline && !page.isClosed());
    throw Error(source.unavailable);
  } finally {
    if (owned && manager.sessions?.get(account) === context) await closeShopContext(context);
    else await closeTaskPage(page);
  }
}
