import { checkSecurityPrompt } from './security-verification.mjs';
import { trackTaskPage, closeTaskPage, closeShopContext } from './page-cleanup.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, randomInt} from 'node:crypto';
import { verifyDouyin } from './douyin-identity.mjs';
import { verifyJd } from './jd-identity.mjs';
import { verifyWechatShop } from './wechat-shop-identity.mjs';
import { verifyPinduoduo } from './pinduoduo-identity.mjs';
import { verifyTaobao, verifyTmall } from './login-identity.mjs';
import { finishLoginWindow } from './finish-login.mjs';
import {chatShops} from './chat-shops.mjs';
import {pageCatalog} from './page-catalog.mjs';
import {runQianniuSkill} from './qianniu-plugin.mjs';
import {readShopReport, shopReports} from './shop-report.mjs';
import {queryDaily} from './daily-store.mjs';
import {downloadDaily} from './daily-download.mjs';
import {hasPddBusiness,hasSellerDashboard,pddOverview,readSellerDashboard} from './seller-dashboard.mjs';
import {readRegisteredPage,sourcePages} from './source-readers.mjs';
import {compassGroup,downloadCompass,archiveCompass} from './compass-workbook.mjs';
import {dailyId,pddHomeId,executorFor,getContract,receipts,recordRun,registry} from './source-ledger.mjs';
import {buyerPlatforms, getPlatform, isPlatformLogin} from './platforms.mjs';
import {verifyBuyer} from './buyer-login.mjs';
import {readMerchantPage} from './page-read.mjs';
import {ChatBrowser} from './chat-browser.mjs';
import {readDouyinProducts} from './douyin-products.mjs';

const loginVerifiers = new Map([['taobao', verifyTaobao], ['tmall', verifyTmall], ['pinduoduo', verifyPinduoduo], ['jd', verifyJd], ['douyin', verifyDouyin]]);
loginVerifiers.set('wechat-shop',verifyWechatShop);
for (const p of buyerPlatforms) loginVerifiers.set(p.id,verifyBuyer);
export const canCheckLogin = platform => loginVerifiers.has(platform);
const canCollect = platform => platform==='taobao' || hasSellerDashboard(platform);

export function parseDashboard(snapshot) {
  const metrics = {};
  for (const label of ['待付款','待发货','待售后','待回复差评','待处理投诉','违规']) {
    const match = snapshot.match(new RegExp('(?:link|button) "(\\d+[+]?) ' + label));
    metrics[label] = match ? match[1] : null;
  }
  const name = snapshot.match(/- text: ([^\n]+)\n- img "caret-down"/)?.[1]?.trim();
  const authenticated = Boolean(name && /待发货|订单管理|店铺数据/.test(snapshot));
  return {name, authenticated, metrics};
}

export function validateScheduleCapacity(schedule,count) {
  const [h,m]=schedule.startTime.split(':').map(Number);
  if(count>0&&h*60+m+Math.floor((count-1)/schedule.tasksPerSlot)*schedule.intervalMinutes>=1440)
    throw Error('采集任务会排到次日，请提前开始时间或缩短间隔');
}

export class CollectionStore {
  constructor(runtime, manager, profiles) {
    this.file=path.join(runtime,'shop-collections.json');
    this.manager=manager; this.profiles=profiles; this.checks=new Map(); this.running=new Map(); this.queue=Promise.resolve();
    this.chatBrowser=new ChatBrowser(manager,platform=>loginVerifiers.get(platform));
    this.state={version:1,ownerId:null,pairCode:String(randomInt(100000,1000000)),schedule:{startTime:'10:00',intervalMinutes:30,tasksPerSlot:2},shops:{},runs:[]};
    manager.onWorkbenchOpened=async account=>{
      if(!canCheckLogin(manager.platform(account).id))return;
      const shop=this.state.shops[account] ??= {};
      if(shop.unbound || shop.pendingCheck)return;
      // Persist the pending check so LobeHub keeps polling and a service restart can resume it.
      shop.pendingCheck=true;
      await this.save();
    };
  }
  async init() {
    try {this.state=JSON.parse(await fs.readFile(this.file,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw e;}
    for(const run of this.state.runs) if(run.status==='running') {run.status='interrupted';run.finishedAt=new Date().toISOString();run.error='服务重启，执行未完成，请重新采集';}
    for(const run of this.state.runs)recordRun(path.dirname(this.file),run);
    for (const profile of this.profiles.items) {
      if (!canCheckLogin(profile.platform) || this.state.shops[profile.id]?.unbound) continue;
      if (this.manager.manual?.has(profile.id)) this.waitForLogin(profile.id);
    }
    // Carry the latest verified report of each type forward when upgrading an existing log.
    const retained = this.state.lastReports ??= {};
    for (const run of this.state.runs) {
      if (run.status !== 'completed' || !run.storeId || run.storeId !== this.state.shops[run.account]?.storeId) continue;
      const kind = run.report?.kind ?? 'todo';
      if (!['todo','products','quality','finance'].includes(kind)) continue;
      const byKind = retained[run.account] ??= {};
      if (!byKind[kind] || byKind[kind].finishedAt <= run.finishedAt) byKind[kind] = run;
    }
    await this.save();
  }
  save() {
    const content=JSON.stringify(this.state,null,2);
    this.queue=this.queue.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',content);await fs.rename(this.file+'.tmp',this.file);});
    return this.queue;
  }
  async authorize(ownerId,input) {
    if(typeof ownerId!=='string'||!ownerId.trim()||ownerId.length>200)throw Error('请先登录 LobeHub');
    if(this.state.ownerId===ownerId)return true;
    if(this.state.ownerId)throw Error('本机店铺已绑定其他 LobeHub 账号');
    if(input.action==='pair'&&input.code===this.state.pairCode){this.state.ownerId=ownerId;this.state.pairCode=null;await this.save();return true;}
    if(input.action==='list')return false;
    throw Error('请使用本机管理器显示的连接码');
  }
  list() {
    const isBound = account => !this.state.shops[account]?.unbound;
    const shops = this.profiles.items.filter(p => isBound(p.id)).map(p => ({
      ...p, ...this.state.shops[p.id], canCheckLogin:canCheckLogin(p.platform), canCollect:canCollect(p.platform), enabled: this.state.shops[p.id]?.enabled ?? false,
      manual: this.manager.manual.has(p.id), running: this.running.has(p.id),
    }));
    const removed = this.profiles.items.filter(p => !isBound(p.id)).map(({id, name, platform}) => ({
      id, platform, name: this.state.shops[id]?.storeName || name,
    }));
    return {schedule:this.state.schedule, shops, removed, runs:this.state.runs.filter(r => isBound(r.account)).slice(-100).reverse().map(({report,...r}) =>
      report ? {...r,report:{name:report.name,scope:report.scope,capturedAt:report.capturedAt}} : r)};
  }
  async snapshot(account, kind) {
    const profile = this.profiles.items.find(p => p.id === account);
    const binding = this.state.shops[account];
    if (!profile || binding?.unbound) throw Error('店铺不可用');
    if(kind==='pddOverview') {
      if(profile.platform!=='pinduoduo')throw Error('请选择拼多多店铺');
      const valid=run=>binding?.storeName && run?.status==='completed' && run.platform==='pinduoduo' &&
        run.account===account && run.storeName===binding.storeName && run.scope==='pinduoduo-home-current' && hasPddBusiness(run.metrics);
      const last=this.state.lastReports?.[account]?.todo;
      const run=valid(last) ? last : this.state.runs.findLast(valid);
      if(!run)throw Error('尚无该店的拼多多经营快照，请在店铺管理中点击「立即采集」');
      return {account,platform:profile.platform,name:binding.storeName,authStatus:binding.authStatus,latest:null,report:pddOverview(run)};
    }
    if (hasSellerDashboard(profile.platform)) {
      if(kind!=='todo') throw Error('该平台目前已接入商家首页采集，请查看待办或查询工作台首页');
      const latest=this.state.lastReports?.[account]?.todo;
      if(!binding?.storeName || latest?.platform!==profile.platform || latest?.account!==account || latest?.storeName!==binding.storeName)
        throw Error('尚无该店铺的成功采集记录');
      return {account,platform:profile.platform,name:binding.storeName,authStatus:binding.authStatus,latest};
    }
    if(profile.platform!=='taobao') throw Error('该平台尚未接入采集');
    if (!binding?.storeId) throw Error('该店铺尚未完成身份核验，请先在店铺管理中采集');
    const base = {account, platform:profile.platform, name:binding.storeName || profile.name, authStatus:binding.authStatus, latest:null};
    const runs = this.state.runs.filter(r => r.account === account && r.storeId === binding.storeId);
    if (kind === 'daily') {
      try {
        const root = path.join(path.dirname(this.file),'sycm-daily');
        return {...base, report:await queryDaily(root, binding.storeId, new Date(), {snapshot:true})};
      } catch (error) {
        const failed = runs.findLast(r => r.status === 'failed' && (r.scope === 'syncDaily' || r.error?.includes('生意参谋')));
        if (failed) throw Error(error.message+'。最近采集：'+failed.error);
        throw error;
      }
    }
    if (!['todo','finance','quality','products'].includes(kind)) throw Error('未知快照');
    const latest = this.state.lastReports?.[account]?.[kind];
    const run = latest?.storeId === binding.storeId ? latest : runs.findLast(r =>
      r.status === 'completed' && (kind === 'todo' ? !r.report : r.report?.kind === kind));
    if (!run) {
      const label = shopReports[kind]?.name ?? '经营待办';
      const scope = kind === 'todo' ? 'qianniu-home-current' : kind;
      const attempt = runs.findLast(r => r.scope === scope);
      if (attempt?.status === 'failed') throw Error(label+'最近一次采集失败：'+attempt.error);
      if (attempt?.status === 'running') throw Error(label+'正在采集，完成后可查看');
      if (attempt?.status === 'interrupted') throw Error(label+'上次采集中断，请在店铺管理中重新采集');
      throw Error('尚无「'+label+'」采集记录，请在店铺管理中点击「立即采集」');
    }
    return kind === 'todo' ? {...base, latest:run} : {...base, report:run.report};
  }
  waitForLogin(account) {
    const shop=this.state.shops[account] ??= {};
    Object.assign(shop,{authStatus:'awaiting_close',pendingCheck:true,checkError:null});
  }
  resumeLoginChecks() {
    for (const [account,shop] of Object.entries(this.state.shops)) {
      if(shop.pendingCheck && !shop.unbound && !this.manager.manual.has(account) &&
        !this.manager.hasOpenWorkbench?.(account) && !this.running.has(account)) {
        void this.checkLogin(account).catch(error=>console.error('Login verification:',error.message));
      }
    }
  }
  async checkLogin(account) {
    const verify=loginVerifiers.get(this.profiles.items.find(p=>p.id===account)?.platform);
    if(!verify)throw Error('该平台尚未接入登录核验');
    if(this.checks.has(account)) return this.checks.get(account);
    const binding=this.state.shops[account] ??= {};
    if(this.manager.manual.has(account)){
      this.waitForLogin(account);await this.save();
      return {account,status:'awaiting_close'};
    }
    if(this.running.has(account))throw Error('该店铺正在采集，结束后可检查登录');
    Object.assign(binding,{authStatus:'checking',pendingCheck:true,checkError:null});
    const task=this.manager.run(account,async()=>{
      const verifyAgainOnClose=Boolean(this.manager.hasOpenWorkbench?.(account));
      try {
        await this.save();
        const identity=await verify(this.manager,account,binding);
        Object.assign(binding,identity,{authStatus:'authenticated'});
        return {account,status:'completed',...identity};
      } catch(error) {
        Object.assign(binding,{authStatus:error.authStatus || (error.expired?'expired':'check_failed'),checkError:error.message});
        return {account,status:'failed',error:error.message};
      } finally {
        Object.assign(binding,{pendingCheck:verifyAgainOnClose,checkedAt:new Date().toISOString()});
        await this.save();
      }
    }).finally(()=>{this.checks.delete(account);this.running.delete(account);});
    this.checks.set(account,task);this.running.set(account,task);
    return task;
  }
  async command(input) {
    if (['access','setAccess','live','snapshot','pageRead','browser','productList'].includes(input.action)) return chatShops(this,input);
    if(input.action==='list'||input.action==='pair')return this.list();
    if(input.action==='create') {
      const platform=getPlatform(input.platform ?? 'taobao');
      const ordinal=this.profiles.items.filter(p=>p.platform===platform.id).length+1;
      return this.profiles.create(input.name?.trim() || platform.name+' '+ordinal,platform.id);
    }
    if(input.action==='schedule') {
      const {startTime,intervalMinutes,tasksPerSlot}=input;
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)||!Number.isInteger(intervalMinutes)||intervalMinutes<1||intervalMinutes>180||!Number.isInteger(tasksPerSlot)||tasksPerSlot<1||tasksPerSlot>5)throw Error('采集时间或分组设置无效');
      const schedule={startTime,intervalMinutes,tasksPerSlot};
      validateScheduleCapacity(schedule,this.profiles.items.filter(p=>canCollect(p.platform)&&this.state.shops[p.id]?.enabled).length);
      this.state.schedule=schedule;await this.save();return this.list();
    }
    const p=this.profiles.items.find(p=>p.id===input.account);
    if (!p) throw Error('请选择有效的店铺环境');
    const binding = this.state.shops[p.id] ?? {};
    if (input.action === 'unbind' || input.action === 'rebind') {
      if (this.running.has(p.id)) throw Error('店铺采集中，请稍后重试');
      const unbound = input.action === 'unbind';
      if (Boolean(binding.unbound) !== unbound) {
        if (unbound) for (const link of Object.values(this.state.chatLinks ?? {})) {
          if (link.accounts.includes(p.id)) {
            link.accounts = link.accounts.filter(id => id !== p.id);
            link.revision = randomUUID();
          }
        }
        this.state.shops[p.id] = {...binding, unbound, enabled:false, authStatus:'unknown', checkedAt:null, pendingCheck:false, checkError:null};
      }
      await this.save();
      if(unbound) await this.chatBrowser.closeAccount(p.id);
      return this.list();
    }
    if (binding.unbound || p.restoreError) throw Error('该店铺环境不可用，请先重新绑定');
    if(input.action==='sourceList')return registry.filter(s=>s.platform===p.platform).map(s=>({
      source_id:s.source_id,name:s.name,enabled:s.enabled,type:s.type,executor:executorFor(s.source_id)
    }));
    if(input.action==='sourceCollect' || input.action==='sourceReceipts') {
      const id=input.source_id, source=getContract(id);
      if(!source || source.platform!==p.platform)throw Error('此来源与所选店铺平台不符');
      if(input.action==='sourceReceipts')return receipts(path.dirname(this.file),p.id,id).filter(r=>
        (!binding.storeId||!r.storeId||binding.storeId===r.storeId)&&(!binding.storeName||!r.storeName||binding.storeName===r.storeName));
      if(!source.enabled)throw Error('此来源在 Accio 注册库中未启用');
      if(!executorFor(id))throw Error('此来源尚未接入采集执行器：'+id);
      const run=await this.capture(p.id,true,'source',id===dailyId?'syncDaily':id===pddHomeId?undefined:id);
      if(!run.id)return run;
      const receipt=receipts(path.dirname(this.file),p.id,id).find(r=>r.runId===run.id);
      return receipt?{...run,status:receipt.status,error:receipt.error,receipt}:run;
    }
    if(input.action==='rename')return this.profiles.rename(p.id,input.name);
    if ((input.action==='openWorkbench' || input.action==='login') && this.running.has(p.id))
      throw Error('该账号正在采集或核验，完成后即可打开窗口');
    const signedOutWorkbench = input.action==='openWorkbench' && binding.authStatus==='expired' &&
      (p.platform==='taobao' || p.platform==='tmall');
    if(input.action==='login' || signedOutWorkbench){
      const result=await this.manager.execute({account:p.id,action:'manual_login'});
      if(canCheckLogin(p.platform) && !this.state.shops[p.id]?.pendingCheck){this.waitForLogin(p.id);await this.save();}
      return result;
    }
    if(input.action==='openWorkbench')return this.manager.execute({account:p.id,action:'openWorkbench'});
    if(input.action==='close')return this.manager.execute({account:p.id,action:'close'});
    if(canCheckLogin(p.platform) && input.action==='finishLogin'){
      this.waitForLogin(p.id);await this.save();
      if(this.manager.manual.has(p.id)){await finishLoginWindow(this.manager,p.id);return {account:p.id,status:'awaiting_close'};}
      return this.checkLogin(p.id);
    }
    if(input.action==='check')return this.checkLogin(p.id);
    if(!canCollect(p.platform))throw Error('该平台目前仅支持独立登录环境');
    if(input.action==='enable') {
      if(typeof input.enabled!=='boolean')throw Error('无效开关');
      validateScheduleCapacity(this.state.schedule,this.profiles.items.filter(item=>canCollect(item.platform)&&(item.id===p.id?input.enabled:this.state.shops[item.id]?.enabled)).length);
      this.state.shops[p.id]={...this.state.shops[p.id],enabled:input.enabled};await this.save();return this.list();
    }
    if (input.action === 'catalog') {
      if(p.platform!=='taobao')throw Error('此页面目录仅支持淘宝');
      const skip = input.skipRoutes ?? [];
      if (!Array.isArray(skip) || skip.length > 300 || skip.some(r => typeof r !== 'string' || r.length > 1024)) throw Error('页面筛选参数无效');
      const identity = await this.capture(p.id,false);
      if (identity.status !== 'completed') throw Error(identity.error || '请等待当前采集结束');
      if (this.state.shops[p.id]?.unbound || this.running.has(p.id)) throw Error('店铺不可用或正在采集');
      const task = this.manager.run(p.id, () => pageCatalog(this.manager,p.id,identity,new Set(skip)))
        .finally(() => this.running.delete(p.id));
      this.running.set(p.id,task);
      return task;
    }
    if (input.action === 'diagnose') {
      if(hasSellerDashboard(p.platform)) {
        const latest=await this.capture(p.id,true);
        if(latest.status!=='completed')throw Error(latest.error || '该店正在采集');
        return {account:p.id,platform:p.platform,name:latest.storeName,authStatus:'authenticated',latest};
      }
      return runQianniuSkill(p.id, () => this.capture(p.id,true));
    }
    if (input.action === 'report') {
      if(p.platform!=='taobao')throw Error('该平台目前已接入商家首页采集，请查看待办或查询工作台首页');
      if (input.kind==='daily') {
        const report=await queryDaily(path.join(path.dirname(this.file),'sycm-daily'),binding.storeId);
        return {account:p.id,name:binding.storeName??p.name,platform:'taobao',authStatus:binding.authStatus,latest:null,storeId:binding.storeId,report};
      }
      if (input.kind!=='syncDaily' && !Object.hasOwn(shopReports,input.kind)) throw Error('未知淘宝报表');
      const run = await this.capture(p.id,true,'manual',input.kind);
      if (run.status !== 'completed') throw Error(run.error || '该店铺正在采集，请稍后重试');
      return {account:p.id,name:run.storeName,platform:'taobao',authStatus:'authenticated',latest:null,storeId:run.storeId,report:run.report};
    }
    if(input.action==='collect')return this.capture(p.id,true,'manual',undefined,p.platform==='taobao' && input.kind!=='todo');
    if(input.action==='result')return this.state.runs.find(r=>r.id===input.runId&&r.account===p.id)??null;
    if(input.action==='context') {
      const run=[...this.state.runs].reverse().find(r=>r.account===p.id&&r.status==='completed'&&!r.report);
      return {account:p.id,platform:p.platform,name:this.state.shops[p.id]?.storeName??p.name,authStatus:this.state.shops[p.id]?.authStatus??'unknown',latest:run??null};
    }
    throw Error('不支持的店铺操作');
  }
  async readPage(account, input) {
    const profile = this.profiles.items.find(p => p.id === account);
    const verify = loginVerifiers.get(profile?.platform);
    if (!profile || !verify || this.state.shops[account]?.unbound) throw Error('此店铺暂不支持页面读取');
    if (this.running.has(account)) throw Error('该店铺正在采集，请稍后重试');
    const task = this.manager.run(account, () => readMerchantPage(this.manager, account, profile.platform,
      this.state.shops[account], verify, input)).finally(() => this.running.delete(account));
    this.running.set(account, task);
    return task;
  }
  async readProducts(account,input,assertAccess) {
    const profile=this.profiles.items.find(p=>p.id===account);
    if(profile?.platform!=='douyin' || this.state.shops[account]?.unbound) throw Error('商品链接分页目前支持已绑定的抖店');
    if(this.running.has(account)) throw Error('该店铺正在采集，请稍后重试');
    const task=this.manager.run(account,async()=>{
      assertAccess();
      const result=await readDouyinProducts(this.manager,account,this.state.shops[account],verifyDouyin,input.limit ?? 1000);
      assertAccess();return result;
    }).finally(()=>this.running.delete(account));
    this.running.set(account,task);return task;
  }
  async browserAction(account,input,assertAccess) {
    const profile=this.profiles.items.find(p=>p.id===account);
    if(!profile || this.state.shops[account]?.unbound || profile.restoreError)throw Error('店铺不可用');
    return this.chatBrowser.execute(account,profile,this.state.shops[account],input,assertAccess);
  }
  async readTaobaoReport(page,kind,storeId,storeName) {
    return kind==='syncDaily'
      ? downloadDaily(page,path.join(path.dirname(this.file),'sycm-daily'),storeId,storeName)
      : readShopReport(page,kind);
  }
  async collectPanoramaReports(page,home) {
    const errors=[];
    for(const kind of [...Object.keys(shopReports),'syncDaily']) {
      const name=shopReports[kind]?.name ?? '近30天核心日报';
      const {account,platform,storeId,storeName,trigger}=home;
      const run={id:randomUUID(),account,platform,storeId,storeName,trigger,scope:kind,metrics:{},status:'running',startedAt:new Date().toISOString()};
      if(kind==='syncDaily')run.source_id=dailyId;
      this.state.runs.push(run);
      this.state.runs=this.state.runs.slice(-500);
      await this.save();
      try {
        const report=await this.readTaobaoReport(page,kind,storeId,storeName);
        Object.assign(run,{report,note:report.scope,finishedAt:report.capturedAt,status:'completed'});
        if(kind!=='syncDaily')this.state.lastReports[account][kind]=run;
      } catch(error) {
        const message=name+'：'+error.message;
        errors.push(message);
        if(error.authStatus === 'security_verification')
          Object.assign(this.state.shops[account],{authStatus:error.authStatus,checkError:error.message,checkedAt:new Date().toISOString()});
        Object.assign(run,{status:'failed',error:message,finishedAt:new Date().toISOString()});
      }
      await this.save();
      recordRun(path.dirname(this.file),run);
      if(this.state.shops[account].authStatus === 'security_verification')break;
      if(isPlatformLogin(page.url(),'taobao')) {
        this.state.shops[account].authStatus='expired';
        errors.push('淘宝登录已失效，已停止后续采集');
        break;
      }
    }
    return errors.length ? {...home,status:'failed',error:errors.join('；')} : home;
  }
  async capture(account,persist,trigger='manual',reportKind,panorama=false) {
    if(this.state.shops[account]?.unbound)throw Error('该店铺已移除绑定');
    if(this.running.has(account))return {status:'running',account};
    const platform=this.profiles.items.find(p=>p.id===account)?.platform;
    // One lock spans login validation and reading: another caller cannot switch the profile mid-read.
    const task=this.manager.run(account,async()=>{
      const run={id:randomUUID(),account,platform,trigger,status:'running',startedAt:new Date().toISOString(),scope:reportKind || (platform==='taobao'?'qianniu':platform)+'-home-current',metrics:{}};
      if(reportKind==='syncDaily')run.source_id=dailyId;
      else if(reportKind && (Object.hasOwn(sourcePages,reportKind)||compassGroup(reportKind)))run.source_id=reportKind;
      else if(platform==='pinduoduo' && !reportKind)run.source_id=pddHomeId;
      if(persist){this.state.runs.push(run);this.state.runs=this.state.runs.slice(-500);await this.save();}
      let page;
      let ownedContext;
      let identityVerified = false;
      try {
        if(this.manager.manual.has(account))throw Error('请先关闭该店铺的普通登录窗口');
        const alreadyOpen = this.manager.sessions?.has(account);
        const ctx = await this.manager.context(account, {background:true,automatic:platform==='taobao'});
        if (!alreadyOpen && this.manager.sessions?.get(account) === ctx) ownedContext = ctx;
        page = trackTaskPage((ownedContext && ctx.pages().find(tab => tab.url() === 'about:blank')) || await ctx.newPage());
        if (hasSellerDashboard(platform)) {
          const verify=loginVerifiers.get(platform);
          const binding=this.state.shops[account] ?? {};
          const identity=await verify(this.manager,account,binding);
          identityVerified=true;
          run.storeName=identity.storeName;
          const packet=reportKind && compassGroup(reportKind) ? await downloadCompass(page,reportKind,identity.storeName,registry) : null;
          const data=packet ? {report:packet.report} : reportKind
            ? {report:await readRegisteredPage(page,reportKind,identity.storeName)}
            : await readSellerDashboard(page,platform);
          // Recheck the active merchant after reading, including on platforms with a masked home header.
          identityVerified=false;
          await verify(this.manager,account,identity);
          identityVerified=true;
          if(packet)await archiveCompass(path.dirname(this.file),account,packet);
          const finishedAt=new Date().toISOString();
          Object.assign(run,identity,data,{status:'completed',finishedAt});
          this.state.shops[account]={...binding,...identity,authStatus:'authenticated',checkedAt:finishedAt,checkError:null};
          if(persist) {
            const reports=this.state.lastReports ??= {};
            (reports[account] ??= {})[reportKind || 'todo']=run;
          }
          return run;
        }
        await page.goto('https://myseller.taobao.com/home.htm/shop-manage/shop-center',{waitUntil:'domcontentloaded',timeout:45000});
        await checkSecurityPrompt(page);
        if(isPlatformLogin(page.url(),'taobao'))throw Error('登录已失效，请重新登录');
        await page.getByText(/店铺ID\s*[:：]?\s*\d{1,32}/,{exact:false}).first().waitFor({timeout:25000});
        if(new URL(page.url()).hostname!=='myseller.taobao.com')throw Error('无法确认店铺身份来源');
        const identityText=await page.locator('body').ariaSnapshot({timeout:10000});
        const identities=[...new Set([...identityText.matchAll(/店铺ID\s*[:：]?\s*(\d{1,32})/g)].map(m=>m[1]))];
        if(identities.length!==1)throw Error('无法确认唯一淘宝店铺ID，未保存经营数据');
        const storeId=identities[0];
        const boundId=this.state.shops[account]?.storeId;
        if(boundId&&boundId!==storeId)throw Error('此登录环境的店铺ID已改变，请新建店铺环境进行绑定');
        await page.goto('https://myseller.taobao.com/home.htm/QnworkbenchHome/',{waitUntil:'domcontentloaded',timeout:45000});
        await checkSecurityPrompt(page);
        if(isPlatformLogin(page.url(),'taobao'))throw Error('登录已失效，请重新登录');
        await page.getByText('待发货',{exact:false}).first().waitFor({timeout:25000});
        if(new URL(page.url()).hostname!=='myseller.taobao.com')throw Error('后台跳转，请重新检查登录');
        const snapshot=await page.locator('body').ariaSnapshot({timeout:10000});
        const parsed=parseDashboard(snapshot);
        if(!parsed.authenticated)throw Error('无法确认店铺身份，未保存经营数据');
        const previous=this.state.shops[account]?.storeName;
        if(!boundId&&previous&&previous!==parsed.name)throw Error('此登录环境的店铺身份已改变，请新建店铺环境进行绑定');
        Object.assign(run,{storeId,storeName:parsed.name,metrics:parsed.metrics,sourceUrl:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',finishedAt:new Date().toISOString(),note:'当前千牛首页待办数量；不是近30天经营报表。缺失值为 null。'});
        this.state.shops[account]={...this.state.shops[account],storeId,storeName:parsed.name,authStatus:'authenticated',checkedAt:run.finishedAt};
        identityVerified = true;
        if (reportKind) {
          run.report = await this.readTaobaoReport(page,reportKind,storeId,parsed.name);
          run.scope = reportKind;
          run.note = run.report.scope;
          run.finishedAt = run.report.capturedAt;
        }
        run.status='completed';
        if (persist && reportKind !== 'syncDaily') {
          const lastReports = this.state.lastReports ??= {};
          (lastReports[account] ??= {})[reportKind || 'todo'] = run;
        }
        if(panorama)return await this.collectPanoramaReports(page,run);
      } catch(e) {
        run.status='failed';run.error=e.message;run.finishedAt=new Date().toISOString();
        const expired=e.expired || isPlatformLogin(page?.url()??'',platform);
        if (!identityVerified || expired || e.authStatus === 'security_verification')
          this.state.shops[account]={...this.state.shops[account],authStatus:e.authStatus || (expired?'expired':'check_failed'),checkError:e.message,checkedAt:run.finishedAt};
      } finally {
        if (ownedContext) await closeShopContext(ownedContext);
        else await closeTaskPage(page);
        await this.save();
        if(persist)recordRun(path.dirname(this.file),run);
      }
      return run;
    }).finally(()=>this.running.delete(account));
    this.running.set(account,task);return task;
  }
  async tick(now=new Date()) {
    // Explicit China time; a suspended/offline host does not silently backfill missed days.
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
    const d=Object.fromEntries(parts.map(p=>[p.type,p.value]));const day=`${d.year}-${d.month}-${d.day}`;
    const current=Number(d.hour)*60+Number(d.minute);const schedule=this.state.schedule;
    const [h,m]=schedule.startTime.split(':').map(Number);
    const shops=this.profiles.items.filter(p=>canCollect(p.platform)&&this.state.shops[p.id]?.enabled);
    for(const [index,p] of shops.entries()) {
      const due=h*60+m+Math.floor(index/schedule.tasksPerSlot)*schedule.intervalMinutes;
      if(current!==due||this.state.shops[p.id].lastScheduledDay===day)continue;
      if(this.state.shops[p.id].authStatus==='security_verification' ||
          this.state.shops[p.id].pendingCheck || this.manager.manual?.has(p.id))continue;
      this.state.shops[p.id].lastScheduledDay=day;await this.save();
      void this.capture(p.id,true,'schedule',undefined,p.platform==='taobao').catch(()=>{});
    }
  }
}
