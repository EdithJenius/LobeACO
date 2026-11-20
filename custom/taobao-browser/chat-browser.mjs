import { checkSecurityPrompt, securityVerification, waitForMerchantVerification } from './security-verification.mjs';
import path from 'node:path';
import {taskWindow} from './task-window.mjs';
import {isServiceExport,saveServiceExport} from './pdd-service-export.mjs';
import {getPlatform, isPlatformLogin, validatePlatformUrl} from './platforms.mjs';
import {closeShopContext, closeTaskPage, trackTaskPage} from './page-cleanup.mjs';
import {clickJdProductCopy,closeJdNotice} from './jd-page-controls.mjs';

const operations = new Set(['open','inspect','tabs','click','fill','press','scroll','wait','close']);
const cleanUrl = raw => { try { const u=new URL(raw); return u.origin+u.pathname; } catch { return ''; } };
const sessionKey = input => JSON.stringify([input.scope,input.agent,input.topic,input.account,input.revision,input.runId??'']);
const validIndex = value => value === undefined || (Number.isInteger(value) && value >= 0 && value <= 100);

// The Qianniu tour can mount after navigation, including inside the order frame.
async function prepareRefundPage(page, platform, operation) {
  if (platform !== 'taobao' || !['open','inspect','click','wait'].includes(operation) ||
      cleanUrl(page.url()).replace(/\/$/, '') !== 'https://myseller.taobao.com/home.htm/trade-platform/refund-list') return;
  for (const frame of page.frames()) {
    try { validatePlatformUrl(frame.url(), platform); } catch { continue; }
    const overlay = frame.locator('svg.driver-overlay:visible').first();
    if (!await overlay.isVisible()) continue;
    await frame.locator('body').press('Escape', {timeout:1500});
    try {
      await overlay.waitFor({state:'hidden', timeout:1800});
    } catch {
      throw Error('千牛退款页的新手引导仍在遮挡列表，请先关闭引导后再操作');
    }
  }
}

async function snapshotFrame(frame) {
  const limit = 18000;
  const body = await frame.locator('body').ariaSnapshot({timeout:3000}).catch(() => '页面加载中');
  if (body.length <= limit) return body;
  if(cleanUrl(frame.url())==='https://mms.pinduoduo.com/mms-chat/overview/merchant'){
    const table=frame.getByRole('table').filter({hasText:'平均人工响应时长'}).last();
    if(await table.count()){
      const rows=await table.getByRole('row').allInnerTexts();
      const report=rows.map(row=>row.trim().replace(/\s*\n\s*/g,' | ')).join('\n');
      if(report && report.length<limit-5000){
        const tail=body.slice(-3500);
        const head=body.slice(0,limit-report.length-tail.length-100);
        return head+'\n… 客服绩效表（当前页） …\n'+report+'\n… 页尾控件 …\n'+tail;
      }
    }
  }
  // Portals for share links and filters often follow a long product table.
  const modal = frame.locator('dialog:visible, [role="dialog"]:visible, [aria-modal="true"]:visible').last();
  const dialog = await modal.count() ? await modal.ariaSnapshot({timeout:1500}).catch(() => '') : '';
  const ending = dialog ? '\n当前弹窗：\n' + dialog.slice(0,6000) : body.slice(-4000);
  const omitted = '\n… 页面内容已节选 …\n';
  return body.slice(0,limit - ending.length - omitted.length) + omitted + ending;
}

// Each chat controls only pages it creates, never tabs that the merchant already had open.
export class ChatBrowser {
  constructor(manager, verifyForPlatform, {idleMs=180000}={}) {
    this.manager=manager; this.verifyForPlatform=verifyForPlatform; this.idleMs=idleMs; this.sessions=new Map(); this.ownedContexts=new WeakSet();
  }
  async dispose(key, session) {
    if(!session || this.sessions.get(key)!==session)return;
    this.sessions.delete(key); clearTimeout(session.timer);
    for(const page of session.pages) await closeTaskPage(page).catch(()=>{});
    if(this.ownedContexts.has(session.context) && this.manager.sessions.get(session.account)===session.context &&
      ![...this.sessions.values()].some(s=>s.context===session.context) &&
      session.context.pages().every(page=>page.url()==='about:blank')) {
      await closeShopContext(session.context);
      this.ownedContexts.delete(session.context);
    }
  }
  touch(key, session) {
    clearTimeout(session.timer);
    const generation=session.generation=(session.generation??0)+1;
    session.timer=setTimeout(()=>{void this.manager.run(session.account,()=>{
      if(session.generation===generation)return this.dispose(key,session);
    }).catch(()=>{});},this.idleMs);
    session.timer.unref?.();
  }
  async closeConversation(scope,agent,topic,revision) {
    const sessions=[...this.sessions.entries()].filter(([,s])=>s.scope===scope && s.agent===agent && s.topic===topic && s.revision===revision);
    for(const [key,session] of sessions)await this.manager.run(session.account,()=>this.dispose(key,session));
  }
  async closeAccount(account) {
    await this.manager.run(account,async()=>{
      for(const [key,session] of this.sessions)if(session.account===account)await this.dispose(key,session);
    });
  }
  async execute(account, profile, binding, input, assertAccess) {
    if(!operations.has(input.operation))throw Error('不支持的浏览器操作');
    if(!validIndex(input.tab)||!validIndex(input.frame))throw Error('页面或框架索引无效');
    if(input.runId!==undefined && (typeof input.runId!=='string'||input.runId.length>200))throw Error('任务标识无效');
    if(['click','fill'].includes(input.operation) && (typeof input.selector!=='string'||!input.selector||input.selector.length>2000))throw Error('请提供有效的页面选择器');
    if(input.operation==='fill' && (typeof input.text!=='string'||input.text.length>10000))throw Error('输入内容无效');
    if(input.operation==='press' && (typeof input.key!=='string'||input.key.length>80))throw Error('按键信息无效');
    if(input.operation==='scroll' && (!Number.isFinite(input.deltaY)||Math.abs(input.deltaY)>5000))throw Error('滚动距离无效');
    if(input.operation==='wait' && (!Number.isInteger(input.waitMs)||input.waitMs<0||input.waitMs>10000))throw Error('等待时间无效');
    const verify=this.verifyForPlatform(profile.platform);
    if(!verify || !binding?.storeName)throw Error('此平台尚未完成店铺身份核验，不能操作页面');
    const key=sessionKey(input);
    return this.manager.run(account,async()=>{
      assertAccess();
      let session=this.sessions.get(key);
      // A revised selection invalidates the previous conversation session.
      for(const [otherKey,other] of this.sessions) {
        if(other.account===account && other.scope===input.scope && other.agent===input.agent && other.topic===input.topic && other.revision!==input.revision)
          await this.dispose(otherKey,other);
      }
      if(input.operation==='close') {
        if(session)await this.dispose(key,session);
        return {account,platform:profile.platform,closed:true};
      }
      if(this.manager.manual?.has(account))throw Error('请先关闭该店铺的普通登录窗口');
      if(session && this.manager.sessions.get(account)!==session.context) {await this.dispose(key,session);session=null;}
      if(session)this.touch(key,session);
      let performed=false;
      try {
        if(!session) {
          const owned=!this.manager.sessions.has(account);
          const headless=profile.headlessChat===true;
          if(headless && !owned && !this.manager.backgroundContexts.has(this.manager.sessions.get(account)))
            throw Error('此店铺已启用无头会话，请先正常关闭该店的可见后台');
          const context=await this.manager.context(account,headless?{background:true,viewport:{width:1600,height:950}}:{automatic:true});
          if(owned)this.ownedContexts.add(context);
          session={account,scope:input.scope,agent:input.agent,topic:input.topic,revision:input.revision,runId:input.runId??'',owned,context,pages:[]};
          this.sessions.set(key,session);
          const page=trackTaskPage(await context.newPage());
          const addPopup = popup => {if(!session.pages.includes(popup)){session.pages.push(popup);popup.on('popup',addPopup);}};
          page.on('popup',addPopup);session.pages.push(page);
        }
        // Validate the current binding and selected shop immediately before the action.
        const deadline=Date.now()+45000;
        const interactive=profile.platform==='pinduoduo' && !this.manager.backgroundContexts?.has(session.context);
        const automatic=taskWindow(session.pages[0]);
        const checkPrompt=automatic?p=>checkSecurityPrompt(p,assertAccess):interactive?p=>waitForMerchantVerification(p,assertAccess,deadline):checkSecurityPrompt;
        const verifyBinding=b=>profile.platform==='pinduoduo'?verify(this.manager,account,b,checkPrompt):verify(this.manager,account,b);
        const identity=await verifyBinding(binding);
        assertAccess();
        const pages=session.pages.filter(page=>!page.isClosed());
        session.pages=pages;
        const tab=input.tab??0, page=pages[tab];
        if(!page)throw Error('页面已关闭，请先重新打开');
        if(input.operation==='open') {
          const url=validatePlatformUrl(input.url||getPlatform(profile.platform).homeUrl,profile.platform);
          await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
        } else if(page.url()==='about:blank') {
          await page.goto(getPlatform(profile.platform).homeUrl,{waitUntil:'domcontentloaded',timeout:45000});
        }
        validatePlatformUrl(page.url(),profile.platform);
        await checkPrompt(page);
        if(isPlatformLogin(page.url(),profile.platform))throw Object.assign(Error('商家后台要求重新登录，请手动登录'),{expired:true});
        await prepareRefundPage(page,profile.platform,input.operation);
        if(profile.platform==='jd') await closeJdNotice(page);
        let copiedProductUrl,serviceDownload;
        if(['click','fill','press'].includes(input.operation)) {
          const frame=page.frames()[input.frame??0];
          if(!frame)throw Error('页面框架不存在，请重新查看页面');
          validatePlatformUrl(frame.url(),profile.platform);
          const locator=frame.locator(input.selector||'body');
          if(input.operation==='fill') {
            const type=(await locator.getAttribute('type')||'').toLowerCase();
            if(type==='password'||type==='file')throw Error('密码和文件上传请由用户手动完成');
            await locator.fill(input.text);
          } else if(input.operation==='click') {
            if(profile.platform==='jd') copiedProductUrl=await clickJdProductCopy(frame,locator);
            if(profile.platform==='pinduoduo' && await isServiceExport(frame,locator)){
              const [download]=await Promise.all([page.waitForEvent('download',{timeout:30000}),locator.click().then(()=>{performed=true;})]);
              serviceDownload=download;
            }else if(!copiedProductUrl) await locator.click();
          }
          else await locator.press(input.key);
          performed=true;
          assertAccess();
        }
        if(input.operation==='scroll')await page.mouse.wheel(0,input.deltaY);
        if(input.operation==='wait')await page.waitForTimeout(input.waitMs);
        await checkPrompt(page);
        await verifyBinding(identity);
        assertAccess();
        const current=session.pages.filter(p=>!p.isClosed());
        const tabs=await Promise.all(current.map(async(p,i)=>({tab:i,url:cleanUrl(p.url()),title:await p.title().catch(()=> '')})));
        const result={account,platform:profile.platform,storeName:identity.storeName,tabs,
          headless:this.manager.backgroundContexts?.has(session.context)??false};
        if(copiedProductUrl) result.copiedProductUrl=copiedProductUrl;
        if(input.operation!=='tabs') {
          validatePlatformUrl(page.url(),profile.platform);
          const readFrames=()=>Promise.all(page.frames().map(async(f,i)=>{
            try {validatePlatformUrl(f.url(),profile.platform);return {frame:i,url:cleanUrl(f.url()),snapshot:await snapshotFrame(f)};}
            catch{return {frame:i,url:'',snapshot:'非该平台页面，未读取'};}
          }));
          const showsChallenge=frames=>frames.some(f=>/请向右滑块完成拼图|请拖动滑块完成验证|请先完成安全验证/.test(f.snapshot));
          let frames=await readFrames();
          if(profile.platform==='pinduoduo' && showsChallenge(frames)){
            await checkPrompt(page);
            await verifyBinding(identity);
            assertAccess();
            validatePlatformUrl(page.url(),profile.platform);
            frames=await readFrames();
            if(showsChallenge(frames))throw securityVerification();
          }
          result.page={tab,url:cleanUrl(page.url()),frames};
        }
        assertAccess();
        if(serviceDownload)result.download=await saveServiceExport(serviceDownload,path.dirname(this.manager.root),account,assertAccess);
        assertAccess();this.touch(key,session);return result;
      } catch(error) {
        await this.dispose(key,session).catch(()=>{});
        if(performed)throw Object.assign(Error('操作可能已执行，但后续核验失败：'+error.message+'；请检查后台结果，勿自动重试'),
          {authStatus:error.authStatus,expired:error.expired,accessRestricted:error.accessRestricted});
        throw error;
      }
    });
  }
}
