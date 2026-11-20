import { closeShopContext } from './page-cleanup.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {recoverBlankLogin, showLoginWindow} from './foreground-window.mjs';
import {getPlatform, isPlatformLogin, validatePlatformUrl} from './platforms.mjs';
import {registerTaskWindow,releaseTaskWindow,setTaskWindowState,taskWindow} from './task-window.mjs';
export const accounts = ['taobao-a', 'taobao-b'];
export function validateAccount(id) { if (!accounts.includes(id)) throw Error('Unknown account'); return id; }
export async function prepareProfile(root){
  const marker = path.join(root, 'startup-setting-v1');
  try { await fs.access(marker); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const context = await chromium.launchPersistentContext(root, {
    executablePath: chromium.executablePath(), headless: true, chromiumSandbox: true,
    args: ['--restore-last-session']
  });
  try {
    const settings = await context.newPage();
    await settings.goto('chrome://settings/onStartup');
    const resume = settings.locator('settings-on-startup-page controlled-radio-button[name="1"]').getByRole('radio');
    if (!(await resume.isChecked())) await resume.click();
    if (!(await resume.isChecked())) throw Error('Chromium 未接受会话恢复设置');
    await settings.close();
  } finally { await context.close(); }
  await fs.writeFile(marker, '1');
}
// Run only while opening a profile, before a user can open a fresh tab.
async function trimStartupBlanks(context) {
  const pages = context.pages();
  const blanks = [];
  for (const page of pages) {
    if (page.url() !== 'about:blank' || await page.opener()) continue;
    const empty = await page.evaluate(() => !document.title && !document.body?.childElementCount && !document.body?.textContent?.trim()).catch(() => false);
    if (empty) blanks.push(page);
  }
  // A new Chromium profile needs one tab for the first navigation.
  if (blanks.length === pages.length) blanks.shift();
  await Promise.all(blanks.map(page => page.close()));
}
export const validateUrl = validatePlatformUrl;
export class BrowserManager {
  backgroundContexts=new WeakSet();
  workbenchPages=new WeakMap();
  constructor(root, options = {}) { this.root=root; this.options=options; this.sessions=new Map(); this.manual=new Map(); this.queues=new Map(); this.active=null; this.profiles=new Map(['taobao-a','taobao-b'].map(id=>[id,{id,platform:'taobao'}])); }
  registerProfile(profile) { getPlatform(profile.platform); this.profiles.set(profile.id, profile); }
  platform(account) { const profile=this.profiles.get(account); if(!profile)throw Error('Unknown account'); return getPlatform(profile.platform); }
  run(id, fn) {
    validateAccount(id);
    this.platform(id);
    const next=(this.queues.get(id)||Promise.resolve()).catch(()=>{}).then(fn);
    this.queues.set(id,next); return next;
  }
  async context(id, {background = false, trimBlanks = true, automatic = false, viewport = automatic ? {width:1600,height:950} : null} = {}) {
    validateAccount(id);
    this.platform(id);
    if(this.manual.has(id)) throw Error('普通登录窗口正在使用此账号。请手动关闭该账号的所有窗口，再连接 Codex。');
    if (this.sessions.has(id)) return this.sessions.get(id);
    await prepareProfile(path.join(this.root,id));
    const ctx=await chromium.launchPersistentContext(path.join(this.root,id), {executablePath:chromium.executablePath(),headless:background&&!automatic,chromiumSandbox:true,viewport,...this.options,args:['--restore-last-session',...(automatic?['--start-minimized']:[]),...(this.options.args||[])]});
    if(automatic){
      try{
        const page=ctx.pages()[0]??await ctx.newPage();
        await setTaskWindowState(page,'minimized');
        registerTaskWindow(ctx,this.platform(id).id);
      }catch(e){await ctx.close();throw e;}
    }
    if (background&&!automatic) this.backgroundContexts.add(ctx);
    if (trimBlanks) await trimStartupBlanks(ctx);
    ctx.setDefaultTimeout(10000);
    this.sessions.set(id,ctx);
    ctx.on('close',()=>{if(this.sessions.get(id)===ctx)this.sessions.delete(id);});
    return ctx;
  }
  hasOpenWorkbench(account) {
    return this.workbenchPages.has(this.sessions.get(account));
  }
  async openWorkbench(account) {
    const platform=this.platform(account);
    if (this.manual.has(account)) {
      await showLoginWindow(this.manual.get(account));
    } else {
      const existing=this.sessions.get(account);
      if (existing && this.backgroundContexts.has(existing)) await closeShopContext(existing);
      const context=await this.context(account);
      if(context.pages()[0]&&taskWindow(context.pages()[0])){
        await releaseTaskWindow(context);
        await setTaskWindowState(context.pages()[0],'normal');
      }
      let page=this.workbenchPages.get(context);
      if (!page || page.isClosed()) {
        const tabs=context.pages();
        page=tabs.find(p=>p.url()===platform.homeUrl) ?? tabs.find(p=>isPlatformLogin(p.url(),platform.id)) ?? tabs.find(p=>p.url()==='about:blank') ?? await context.newPage();
        await page.bringToFront();
        if (page.url()!==platform.homeUrl && !isPlatformLogin(page.url(),platform.id)) await page.goto(platform.homeUrl,{waitUntil:'commit',timeout:12000});
        this.workbenchPages.set(context,page);
      }
      await page.bringToFront();
      if (isPlatformLogin(page.url(),platform.id)) {
        if (context.pages().some(p=>p.url()!=='about:blank' && !isPlatformLogin(p.url(),platform.id)))
          throw Error('当前需要手动登录，请先保存并关闭其他业务页面，再选择重新登录。');
        return this.openManualLogin(account);
      }
      await this.onWorkbenchOpened?.(account);
    }
    this.active=account;
    return {account,platform:platform.id,opened:true};
  }
  async openManualLogin(account) {
    if(this.manual.has(account)) {
      await showLoginWindow(this.manual.get(account));
      return {account,mode:'manual',message:'已显示此账号的登录窗口。'};
    }
    const existing = this.sessions.get(account);
    const platform = this.platform(account);
    const target = platform.loginUrl || platform.homeUrl;
    if (existing) {
      const businessTabs = existing.pages().filter(page => {
        const url = page.url();
        return url !== 'about:blank' && url !== platform.homeUrl &&
          !isPlatformLogin(url, platform.id) && page !== this.workbenchPages.get(existing);
      });
      if (!this.backgroundContexts.has(existing) && businessTabs.length)
        throw Error('该账号还有打开的业务页面，请保存并关闭后再重新登录。');
    }
    // Stage just one offline tab. Its first load in ordinary Chromium navigates
    // to the platform, so a slow sign-in page cannot block the window handoff.
    const staging = existing || await this.context(account, {background:true, trimBlanks:false});
    const prepareTab = async () => {
      await staging.addInitScript(() => { window.stagingShopLogin = true; });
      const tab = await staging.newPage();
      const destination = JSON.stringify(target).replaceAll('<','\\u003c');
      const handoff = '<!doctype html><meta charset="utf-8"><title>账号登录</title>' +
        '<script>if(!window.stagingShopLogin)location.replace('+destination+')</script>';
      await tab.goto('data:text/html;charset=utf-8,'+encodeURIComponent(handoff),{waitUntil:'commit',timeout:5000});
      for (const old of staging.pages()) if (old !== tab) await old.close();
    };
    let timer;
    try {
      await Promise.race([prepareTab(), new Promise((_,reject) => {
        timer = setTimeout(() => reject(Error('浏览器准备窗口超时，请重试')),8000);
      })]);
    } finally {
      clearTimeout(timer);
      await staging.close();
    }
    const profile=path.join(this.root,account);
    await fs.mkdir(profile,{recursive:true});
    await prepareProfile(profile);
    const child=spawn(chromium.executablePath(),[`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--restore-last-session'],{stdio:'ignore',windowsHide:false});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    this.manual.set(account,child);
    child.once('exit',()=>{if(this.manual.get(account)===child)this.manual.delete(account);});
    await this.onManualOpened?.(account);
    await showLoginWindow(child);
    await recoverBlankLogin(child,chromium.executablePath(),profile,target);
    this.active=account;
    return {account,platform:this.platform(account).id,mode:'manual',message:'已打开专属普通 Chromium。请手动登录，成功后关闭此账号的所有窗口，再点击连接后台。'};
  }
  async execute({account,action,url,tab=0,frame=0,selector,text,key}) {
    return this.run(account,async()=>{
      const platform=this.platform(account);
      if(action==='openWorkbench') return this.openWorkbench(account);
      if(action==='manual_login') return this.openManualLogin(account);
      if(this.manual.has(account)) throw Error('请先手动关闭此账号的普通登录窗口，再连接 Codex；关闭窗口会保存登录数据。');
      if (action==='close') { await closeShopContext(this.sessions.get(account)); return {account,closed:true}; }
      const justOpened = !this.sessions.has(account);
      const ctx=await this.context(account);
      const pages=ctx.pages();
      const page=pages[tab] || (pages.length===0 && tab===0 ? await ctx.newPage() : null);
      if (!page) throw Error('Invalid tab index; inspect tabs first');
      if (justOpened && page.url()==='about:blank' && ['inspect','tabs','screenshot'].includes(action)) {
        await page.goto(platform.homeUrl,{waitUntil:'domcontentloaded',timeout:45000});
      }
      const target=page.frames()[frame];
      if(!target) throw Error('Invalid frame index; inspect page first');
      if(action==='open') { await page.goto(validateUrl(url||platform.homeUrl,platform.id),{waitUntil:'domcontentloaded',timeout:45000}); await page.bringToFront(); this.active=account; }
      else if(action==='switch') { if(page.url()==='about:blank')await page.goto(platform.homeUrl,{waitUntil:'domcontentloaded',timeout:45000}); await page.bringToFront(); this.active=account; }
      else if(action==='click') { validateUrl(target.url(),platform.id); await target.locator(selector).click(); }
      else if(action==='fill') { validateUrl(target.url(),platform.id); const el=target.locator(selector); if(await el.getAttribute('type')==='password') throw Error('Enter passwords manually in browser'); await el.fill(text); }
      else if(action==='press') { validateUrl(target.url(),platform.id); await target.locator(selector||'body').press(key); }
      else if(!['inspect','screenshot','tabs'].includes(action)) throw Error('Unknown action');
      if (['open', 'switch'].includes(action) && isPlatformLogin(page.url(),platform.id)) {
        // Hand off only if closing the context cannot interrupt another business page.
        const loginOnly = ctx.pages().every(p => p.url() === 'about:blank' || isPlatformLogin(p.url(),platform.id));
        if (loginOnly) return this.openManualLogin(account);
        return {account,platform:platform.id, loginRequired:true, message:'当前需要登录，另有其他页面打开。请先保存其他页面的工作，再选择普通窗口登录。'};
      }
      if(action==='screenshot') return {account,image:(await page.screenshot({type:'png'})).toString('base64')};
      const result={account,platform:platform.id,active:this.active,tabs:await Promise.all(ctx.pages().map(async(p,i)=>({tab:i,url:p.url().split('?')[0],title:await p.title().catch(()=> '')})))};
      if(action!=='tabs') result.page={tab,url:page.url().split('?')[0],frames:await Promise.all(page.frames().map(async(f,i)=>({frame:i,url:f.url().split('?')[0],snapshot:(await f.locator('body').ariaSnapshot({timeout:3000}).catch(()=> 'Frame loading; inspect again')).slice(0,18000)})))};
      return result;
    });
  }
  async closeAll(){await Promise.all([...this.sessions.values()].map(c=>closeShopContext(c)));}
}
