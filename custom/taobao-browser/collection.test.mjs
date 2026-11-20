import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CollectionStore,parseDashboard,validateScheduleCapacity} from './collection.mjs';
import {chromium} from 'playwright';
import {BrowserManager} from './core.mjs';
import {visibleReport,shopReports} from './shop-report.mjs';
import {searchTaobaoSources} from './source-catalog.mjs';
import {hasSellerDashboard,parseSellerDashboard} from './seller-dashboard.mjs';
import {recordRun,receipts,pddHomeId} from './source-ledger.mjs';
import {archiveCompass,inspectWorkbook,officialSingleDay} from './compass-workbook.mjs';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';

test('check login presents the original verification page, deduplicates clicks and verifies the shop after handoff',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shop-check-prompt-'));
  const browser=await chromium.launch(), ctx=await browser.newContext();
  const manager=new BrowserManager(root), account='taobao-a';
  manager.registerProfile({id:account,platform:'pinduoduo'});
  manager.sessions.set(account,ctx);
  const store=new CollectionStore(root,manager,{items:[{id:account,platform:'pinduoduo'}]});
  const entry='https://mms.pinduoduo.com/mallcenter/mallinfo';
  let challenge=true;
  const identity='<label>店铺名称</label><div>测试商家</div>';
  await ctx.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:identity+(challenge?'<aside>请向右滑块完成拼图</aside>':'')}));
  const original=await ctx.newPage();
  try{
    await store.init();
    store.state.shops[account]={storeName:'测试商家'};
    await original.goto(entry);
    const check=()=>store.command({action:'check',account});
    manager.backgroundContexts.add(ctx);
    assert.equal((await check()).status,'waiting_for_browser');
    store.resumeLoginChecks();assert.equal(store.checks.size,0);
    manager.backgroundContexts.delete(ctx);store.resumeLoginChecks();
    assert.equal((await check()).status,'security_verification');
    assert.equal((await check()).status,'security_verification');
    assert.deepEqual(ctx.pages(),[original]);
    assert.equal(store.list().shops[0].authStatus,'security_verification');
    const finished=store.checks.get(account);
    challenge=false;await original.setContent(identity);
    assert.equal((await finished).status,'completed');
    assert.deepEqual(ctx.pages(),[original]);
    assert.equal(store.list().shops[0].authStatus,'authenticated');
    // This time the prompt occurs on the new identity page rather than in the workbench.
    challenge=true;
    assert.equal((await check()).status,'security_verification');
    const canceled=store.checks.get(account), prompt=ctx.pages().find(p=>p!==original);
    assert.equal(prompt.url(),entry);await prompt.close();
    assert.equal((await canceled).status,'failed');
    assert.equal(store.list().shops[0].authStatus,'security_verification');
    assert.equal(store.list().shops[0].pendingCheck,false);
    assert.deepEqual(ctx.pages(),[original]);
  }finally{await browser.close();await fs.rm(root,{recursive:true,force:true});}
});

test('Compass export dates distinguish a single merchant day from date ranges',()=>{
  const date='2026-11-17';
  assert.ok(officialSingleDay('抖音电商罗盘-退款分析-2026_11_17.xlsx',date));
  assert.ok(officialSingleDay('抖音电商罗盘-成交分析-20261117-20261117.xlsx',date));
  assert.equal(officialSingleDay('抖音电商罗盘-退款分析-2026_11_16.xlsx',date),false);
  assert.equal(officialSingleDay('抖音电商罗盘-投放分析-20261111-20261117.xlsx',date),false);
});

test('one merchant workbook links each source to its own sheet, dates and original', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'compass-proof-'));
  try{
    const names=['成交概览','自营成交','合作成交','人群构成'];
    const sources=names.map(name=>({source_id:'rpa_dy_shop_transaction_'+name,rules:{sheet_name:name},metrics:[{path:['销售额']}]}));
    const workbook=XLSX.utils.book_new();
    const header=['日期','销售额'];
    for(const [index,data] of [[[20261117,0]],[],[[20261116,1]]].entries()){
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header,...data]),names[index]);
    }
    const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
    const members=inspectWorkbook(bytes,sources,'2026-11-17');
    const id=sources[0].source_id;
    const report={kind:id,members,artifact:{originalName:'20261117-20261117.xlsx',sha256:createHash('sha256').update(bytes).digest('hex')}};
    await archiveCompass(root,'a',{report,bytes});
    const run={id:'shared',source_id:id,platform:'douyin',account:'a',storeName:'测试店',status:'completed',finishedAt:'2026-11-18T09:00:00Z',report};
    recordRun(root,run);recordRun(root,run);
    for(const [index,s] of sources.entries()){
      const [item,...others]=receipts(root,'a',s.source_id);
      assert.equal(others.length,0);assert.equal(item.requestedSourceId,id);assert.equal(item.evidence.sheet,names[index]);
      assert.equal(item.evidence.sha256,report.artifact.sha256);
      assert.deepEqual(item.coverage,index===0?{kind:'days',dates:['2026-11-17']}:null);
      assert.equal(item.status,index===0?'completed':'unverified');
    }
    await fs.appendFile(report.artifact.file,'corrupt');
    recordRun(root,{...run,id:'bad'});
    assert.equal(receipts(root,'a',id).find(r=>r.runId==='bad').coverage,null);
    assert.equal(receipts(root,'b',id).length,0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('source receipts preserve retries and merchant identity without attributing shop snapshots to deep sources',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'source-receipts-'));
  try {
    const run={id:'run-a',account:'a',platform:'pinduoduo',scope:'pinduoduo-home-current',status:'completed',storeName:'店A',
      metrics:{成交金额:'0.00'},sourceUrl:'https://mms.pinduoduo.com/home/',finishedAt:'2026-11-18T09:00:00Z'};
    recordRun(root,run);recordRun(root,run);
    recordRun(root,{...run,id:'run-b',status:'failed',error:'无权限'});
    recordRun(root,{...run,id:'run-c',platform:'douyin',scope:'douyin-home-current'});
    const records=receipts(root,'a',pddHomeId);
    assert.equal(records.length,2);
    assert.equal(records[0].coverage.kind,'observation');
    assert.equal(records[0].evidence.metrics.成交金额,'0.00');
    assert.equal(records[1].coverage,null);
    assert.deepEqual(receipts(root,'b',pddHomeId),[]);
    assert.deepEqual(receipts(root,'a','rpa_pdd_transaction_overview'),[]);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('seller home distinguishes missing, conflicting, zero and explicitly scaled readings',()=>{
  const fields=['待发货','待支付','金额','冲突','缺数','超时未发货'];
  const input='待支付\n0\n待发货\n管理\n金额\n¥\n1.25\n万\n冲突\n2\n冲突\n3\n超时未发货\n急\n8';
  assert.deepEqual(parseSellerDashboard(input,fields),{'待发货':null,'待支付':'0','金额':'¥1.25万','冲突':null,'缺数':null,'超时未发货':'8'});
});

test('report reader preserves null, zero and selected columns, and detects denied pages', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<table><thead><tr><th></th><th>商品名称</th><th>价格</th><th>库存</th><th>质量分</th><th>操作</th></tr></thead><tbody><tr><td></td><td>示例</td><td>--</td><td>0</td><td>85</td><td>编辑</td></tr></tbody></table>');
    const {rows} = await page.evaluate(visibleReport,shopReports.products);
    assert.equal(rows[0]['库存'],'0');
    assert.equal(rows[0]['价格'],null);
    assert.equal(rows[0]['30日销量'],null);
    assert.equal(rows[0]['操作'],undefined);
    await page.setContent('暂无权限');
    assert.ok((await page.evaluate(visibleReport,shopReports.products)).error);
    await page.setContent('销售收支统计 收支构成 加载中');
    assert.equal(await page.evaluate(visibleReport,shopReports.finance),null);
  } finally {await browser.close();}
});

test('source search exposes definitions and finds SKU inventory',async()=>{
  const all = await searchTaobaoSources();
  assert.equal(all.sources.filter(s=>s.acquisition==='rpa').length,40);
  assert.equal(all.sources.filter(s=>s.acquisition==='manual').length,1);
  const result = await searchTaobaoSources('tb_inventory_sku');
  assert.equal(result.sources.length,1);
  assert.equal(result.sources[0].sourceId,'rpa_tb_inventory_sku');
  assert.deepEqual((await searchTaobaoSources('不存在的数据源-xyz')).sources,[]);
});

test('dashboard parser preserves missing values and rejects login screen',()=>{
  const data=parseDashboard('- text: 测试店\n- img "caret-down"\n- link "12 待发货 即将超时3"\n- link "0 待付款"');
  assert.equal(data.authenticated,true);assert.equal(data.metrics['待发货'],'12');assert.equal(data.metrics['待付款'],'0');assert.equal(data.metrics['待售后'],null);
  assert.equal(parseDashboard('扫码登录').authenticated,false);
});
test('schedule rejects a group spilling into the next day',()=>{
  assert.throws(()=>validateScheduleCapacity({startTime:'23:50',tasksPerSlot:1,intervalMinutes:30},2));
  assert.doesNotThrow(()=>validateScheduleCapacity({startTime:'23:50',tasksPerSlot:2,intervalMinutes:30},2));
});
test('pairing isolates owners; runs, identity and schedule survive restart',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shops-collection-'));
  let name='店铺 A';let fail=false;let closed=0;
  const page={goto:async()=>{},url:()=>fail?'https://login.taobao.com/':'https://myseller.taobao.com/home.htm/QnworkbenchHome/',getByText:()=>({first:()=>({waitFor:async()=>{}})}),locator:()=>({ariaSnapshot:async()=>`- text: 店铺ID ${name === '店铺 A' ? '100' : '200'}\n- text: ${name}\n- img "caret-down"\n- link "12 待发货"`}),close:async()=>closed++};
  const manager={manual:new Map(),run:(_id,fn)=>Promise.resolve().then(fn),context:async()=>({newPage:async()=>page})};
  const profiles={items:[{id:'taobao-a',platform:'taobao',name:'A'},{id:'taobao-b',platform:'taobao',name:'B'}]};
  try {
    const store=new CollectionStore(root,manager,profiles);await store.init();
    assert.equal(await store.authorize('owner',{action:'list'}),false);
    await assert.rejects(store.authorize('owner',{action:'pair',code:'wrong'}));
    assert.equal(await store.authorize('owner',{action:'pair',code:store.state.pairCode}),true);
    await assert.rejects(store.authorize('other',{action:'list'}));
    assert.equal((await store.command({action:'collect',account:'taobao-a',kind:'todo'})).status,'completed');
    name='店铺 B';assert.equal((await store.command({action:'collect',account:'taobao-b',kind:'todo'})).status,'completed');
    assert.equal((await store.command({action:'context',account:'taobao-a'})).name,'店铺 A');
    assert.equal((await store.command({action:'collect',account:'taobao-a'})).status,'failed');
    fail=true;assert.equal((await store.command({action:'check',account:'taobao-b'})).status,'failed');
    assert.equal(store.state.shops['taobao-b'].authStatus,'expired');
    await store.command({action:'enable',account:'taobao-a',enabled:true});
    await store.command({action:'schedule',startTime:'10:03',tasksPerSlot:2,intervalMinutes:30});
    const restored=new CollectionStore(root,manager,profiles);await restored.init();
    assert.equal(restored.state.ownerId,'owner');assert.equal(restored.list().runs.length,3);assert.equal(restored.state.schedule.startTime,'10:03');
    let count=0;restored.capture=async(account,persist,trigger,kind,panorama)=>{
      assert.equal(account,'taobao-a');assert.equal(trigger,'schedule');assert.equal(panorama,true);count++;
    };
    await restored.tick(new Date('2026-11-18T02:03:00Z'));await restored.tick(new Date('2026-11-18T02:03:20Z'));assert.equal(count,1);
    await restored.tick(new Date('2026-11-19T02:04:00Z'));assert.equal(count,1);
    restored.state.shops['taobao-a'].authStatus='security_verification';
    await restored.tick(new Date('2026-11-20T02:03:00Z'));assert.equal(count,1);
    assert.equal(closed,5);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('binding carries the chosen platform and account into the login command', async () => {
  const commands = [];
  const manager = {execute: async command => commands.push(command)};
  const profiles = {
    items: [],
    async create(name, platform) {
      const item = {id: 'shop-' + this.items.length, name, platform};
      this.items.push(item);
      return item;
    },
  };
  const store = new CollectionStore('', manager, profiles);
  store.save=async()=>{};
  for (const platform of ['taobao','tmall','pinduoduo','douyin','jd','alibaba','1688']) {
    const shop = await store.command({action:'create', platform});
    assert.equal(shop.platform, platform);
    assert.match(shop.name, / 1$/);
    await store.command({action:'login', account:shop.id});
    assert.deepEqual(commands.at(-1), {action:'manual_login', account:shop.id});
      await store.command({action:'openWorkbench', account:shop.id});
      assert.deepEqual(commands.at(-1), {action:'openWorkbench', account:shop.id});
      if (platform !== 'taobao' && !hasSellerDashboard(platform)) {
      await assert.rejects(store.command({action:'collect', account:shop.id}), /仅支持独立登录/);
    }
  }
  assert.equal((await store.command({action:'create'})).name, '淘宝 2');
  assert.equal((await store.command({action:'create', platform:'pinduoduo', name:'  二店  '})).name, '二店');
  await assert.rejects(store.command({action:'create', platform:'unknown'}));
});

test('opening a signed-out Qianniu shop starts manual login for that shop and waits for closure', async () => {
  const commands = [];
  const profiles = {items:[{id:'taobao-a',platform:'taobao'}, {id:'taobao-b',platform:'taobao'}]};
  const store = new CollectionStore('', {execute:async cmd=>{commands.push(cmd);return {mode:'manual'};}}, profiles);
  store.save=async()=>{};
  store.state.shops['taobao-a']={authStatus:'authenticated'};
  store.state.shops['taobao-b']={authStatus:'expired'};
  await store.command({action:'openWorkbench',account:'taobao-b'});
  assert.deepEqual(commands,[{action:'manual_login',account:'taobao-b'}]);
  assert.equal(store.state.shops['taobao-b'].pendingCheck,true);
  assert.equal(store.state.shops['taobao-a'].authStatus,'authenticated');
});

test('financial snapshot keeps amount, account scope and independent accounting periods', async () => {
  const {readFinance}=await import('./finance-view.mjs');
  const sample='待开票\n欠费金额(元)\n-0.63\n财务助手\n货款账户\n冻结金额(元)\n12.00\n保证金账户\n冻结金额(元)\n1.00\n推广业务账户\n销售收支统计截止时间：2026年11月17日\n已支付\n2026-10-18 ~ 2026-11-17\n金额(元)\n100.00\n已支付未发货\n已发货未收款\n已收款\n收支构成\n收入\n2026-10-17 ~ 2026-11-16\n收入金额(元)\n80.00\n上月汇总数据\n2026-10\n服务费等支出(元)\n--\n常用财务工具';
  const f=readFinance(sample);
  assert.equal(f['实时待办']['欠费金额(元)'],'-0.63');
  assert.equal(f['货款账户']['冻结金额(元)'],'12.00');
  assert.equal(f['保证金账户']['冻结金额(元)'],'1.00');
  assert.equal(f['销售收支'].period,'2026-10-18 ~ 2026-11-17');
  assert.equal(f['账单收入'].period,'2026-10-17 ~ 2026-11-16');
  assert.equal(f['账单支出']['服务费等支出(元)'],null);
});

test('conversation selection is versioned, permits only chosen shops and requests fresh readings', async () => {
  const {chatShops}=await import('./chat-shops.mjs');
  let reads=0;
  const store={profiles:{items:[{id:'a',name:'A',platform:'taobao'},{id:'b',name:'B',platform:'taobao'}]},state:{shops:{}},save:async()=>{},command:async({account})=>({account,sequence:++reads})};
  const key={scope:'owner:personal',agent:'seller',topic:'draft'};
  const access=()=>chatShops(store,{...key,action:'access'});
  const select=(accounts,revision)=>chatShops(store,{...key,action:'setAccess',accounts,revision});
  const read=(account,revision)=>chatShops(store,{...key,action:'live',account,revision,kind:'todo'});
  const one=await access();
  assert.deepEqual(one.accounts,['a']);
  assert.equal(one.shops[0].authStatus,'unknown');
  store.state.shops.a={authStatus:'authenticated'};
  store.state.shops.b={authStatus:'expired'};
  assert.deepEqual((await access()).shops.map(s=>s.authStatus),['authenticated','expired']);
  store.readPage=async()=>{throw Object.assign(Error('请完成安全验证'),{authStatus:'security_verification'});};
  await assert.rejects(chatShops(store,{...key,action:'pageRead',account:'a',revision:one.revision}));
  const blocked=await access();
  assert.equal(blocked.shops[0].authStatus,'security_verification');
  assert.equal(blocked.revision,one.revision);
  await assert.rejects(select([],one.revision));
  await assert.rejects(read('b',one.revision));
  const two=await select(['b','a'],one.revision);
  assert.equal((await read('a',two.revision)).sequence,1);
  assert.equal((await read('a',two.revision)).sequence,2);
  assert.equal((await read('b',two.revision)).account,'b');
  await assert.rejects(select(['a'],one.revision));
  const wait=Promise.withResolvers();
  store.command=async()=>wait.promise;
  const inFlight=read('b',two.revision);
  await select(['a'],two.revision);
  wait.resolve({account:'b'});await assert.rejects(inFlight);
  assert.deepEqual((await chatShops(store,{...key,topic:'other',action:'access'})).accounts,['a']);
});

test('snapshot reads the selected verified shop and retains successes through later failures and log pruning',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shops-snapshot-'));
  const profiles={items:[{id:'a',name:'A',platform:'taobao'},{id:'b',name:'B',platform:'taobao'}]};
  try {
    const store=new CollectionStore(root,{},profiles);
    store.state.shops={a:{storeId:'100'},b:{storeId:'200'}};
    store.state.runs=[
      {account:'a',storeId:'100',status:'completed',report:{kind:'finance',name:'A finance'},finishedAt:'2026-11-16'},
      {account:'a',storeId:'100',status:'failed',scope:'finance',finishedAt:'2026-11-17'},
      {account:'b',storeId:'200',status:'completed',report:{kind:'finance',name:'B finance'},finishedAt:'2026-11-18'},
    ];
    await store.save();
    await store.init();
    store.state.runs=[];
    const key={scope:'store-owner',agent:'assistant',topic:'t'};
    const {revision}=await store.command({...key,action:'access'});
    const read=account=>store.command({...key,action:'snapshot',revision,account,kind:'finance'});
    assert.equal((await read('a')).report.name,'A finance');
    await assert.rejects(read('b'),/店铺关联/);
    await assert.rejects(store.snapshot('a','products'),/尚无/);
    store.state.shops.a.storeId='300';
    await assert.rejects(read('a'),/尚无/);
    assert.equal(store.state.runs.length,0);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('ordinary Taobao collection saves each panorama tab and reports individual failures',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'panorama-'));
  const account='taobao-a';
  const page={goto:async()=>{},url:()=>'https://myseller.taobao.com/',close:async()=>{},
    getByText:()=>({first:()=>({waitFor:async()=>{}})}),
    locator:()=>({ariaSnapshot:async()=>'- text: 店铺ID 123\n- text: A店\n- img "caret-down"\n- link "3 待发货"'})};
  const manager={manual:new Map(),run:(_id,fn)=>Promise.resolve().then(fn),context:async()=>({newPage:async()=>page})};
  const store=new CollectionStore(root,manager,{items:[{id:account,name:'A',platform:'taobao'}]});
  const reads=[];
  let fail=true;
  store.readTaobaoReport=async(_page,kind,id,name)=>{
    assert.equal(id,'123');assert.equal(name,'A店');reads.push(kind);
    if(fail && kind==='products')throw Error('无权限');
    return {kind,name:kind,rows:[],capturedAt:new Date().toISOString(),scope:kind};
  };
  try {
    await store.init();
    assert.equal((await store.command({action:'collect',account})).status,'failed');
    assert.deepEqual(reads,['products','quality','finance','syncDaily']);
    assert.equal((await store.snapshot(account,'todo')).latest.metrics['待发货'],'3');
    assert.equal((await store.snapshot(account,'finance')).report.kind,'finance');
    await assert.rejects(store.snapshot(account,'products'),/我的商品.*无权限/);
    fail=false;
    assert.equal((await store.command({action:'collect',account})).status,'completed');
    const last=(await store.snapshot(account,'products')).report;
    assert.deepEqual(last.rows,[]);
    fail=true;
    await store.command({action:'collect',account});
    assert.deepEqual((await store.snapshot(account,'products')).report,last);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('manual login is verified once after close and records the shop and account name separately', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'login-identity-'));
  const manual=new Map([['taobao-a',{}]]);
  let calls=0;
  const gate=Promise.withResolvers();
  const manager={manual,sessions:new Map(),run:(_id,fn)=>Promise.resolve().then(fn),context:async()=>{
    calls++;
    await gate.promise;
    return {newPage:async()=>{
      let url='about:blank';
      return {goto:async next=>{url=next},url:()=>url,frames:()=>[{url:()=>url,evaluate:async(_fn,kind)=>kind==='identity'?{storeId:'501',storeName:'测试经营店'}:'陈示例'}],close:async()=>{}};
    }};
  }};
  const store=new CollectionStore(root,manager,{items:[{id:'taobao-a',platform:'taobao',name:'淘宝 4'}]});
  try {
    await store.init(); const request={action:'check',account:'taobao-a'};
    assert.equal((await store.command(request)).status,'awaiting_close');
    store.resumeLoginChecks();assert.equal(calls,0);
    manual.clear();store.resumeLoginChecks();store.resumeLoginChecks();
    assert.equal(store.list().shops[0].authStatus,'checking');
    const active=store.command(request);gate.resolve();assert.equal((await active).status,'completed');
    assert.equal(calls,1);assert.equal(store.list().shops[0].pendingCheck,false);
    const saved=JSON.parse(await fs.readFile(store.file));assert.equal(saved.shops['taobao-a'].storeName,'测试经营店');assert.equal(saved.shops['taobao-a'].accountName,'陈示例');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('identity parsing rejects ambiguous IDs and reads only the named account field',async()=>{
  const {extractAccountField}=await import('./login-identity.mjs');
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    await page.setContent('<div>店铺信息</div><div>测试店</div><div>修改信息</div><div>淘宝账号名</div><div>账号一</div><div>店铺ID</div><div>123</div>');
    assert.deepEqual(await page.evaluate(extractAccountField,'identity'),{storeId:'123',storeName:'测试店'});
    await page.evaluate(()=>document.body.append(Object.assign(document.createElement('div'),{textContent:'店铺ID：456'})));
    assert.equal(await page.evaluate(extractAccountField,'identity'),null);
    await page.setContent('<div>账号信息</div><div>姓名</div><div>陈示例</div><div>身份证号码</div><div>2***3</div><div>子账号名称</div><div>测试商家:员工甲</div>');
    assert.equal(await page.evaluate(extractAccountField,'remark'),'陈示例');
    await page.setContent('<div>账号信息</div><div>子账号名称</div><div>测试商家:员工甲</div>');
    assert.equal(await page.evaluate(extractAccountField,'remark'),null);
  }finally{await browser.close();}
});

test('Tmall verifies read-only shop fields on its own Qianniu route after close and on retry',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tmall-verify-'));
  const browser=await chromium.launch();
  const context=await browser.newContext();
  const account='test-tmall', manual=new Map([[account,{}]]), visits=[];
  const manager={manual,sessions:new Map([[account,context]]),context:async()=>context,run:(_id,fn)=>Promise.resolve().then(fn)};
  const store=new CollectionStore(root,manager,{items:[{id:account,name:'天猫 1',platform:'tmall'}]});
  const field=(label,value)=>`<div class="next-form-item"><div class="next-form-item-label"><label>${label}</label></div><div class="next-form-item-control"><input disabled value="${value}"><button>复制</button></div></div>`;
  let id='123';
  try{
    await context.route('**/*',r=>{
      const route=new URL(r.request().url()).pathname;
      visits.push(route);
      const body=route==='/home.htm/tm-shop-info-manage/' ? field('店铺名称','示例旗舰店')+field('店铺ID',id)
        : route==='/home.htm/Subaccount/' ? '<div>账号信息</div><div>姓名</div><div>测试员工</div>' : '当前非淘宝商家';
      return r.fulfill({contentType:'text/html; charset=utf-8',body});
    });
    await store.init();
    assert.equal((await store.command({action:'check',account})).status,'awaiting_close');
    manual.clear();store.resumeLoginChecks();await store.checks.get(account);
    const bound=store.list().shops[0];
    assert.equal(bound.authStatus,'authenticated');assert.equal(bound.storeId,id);
    assert.equal(bound.storeName,'示例旗舰店');assert.equal(bound.accountName,'测试员工');
    assert.equal((await store.command({action:'check',account})).status,'completed');
    id='456';
    assert.match((await store.command({action:'check',account})).error,/店铺ID已改变/);
    assert.equal(store.list().shops[0].storeId,'123');assert.equal(context.pages().length,0);
    assert.ok(!visits.includes('/home.htm/shop-manage/shop-center'));
    const page=await context.newPage();
    const {extractTmallIdentity}=await import('./login-identity.mjs');
    await page.setContent(field('店铺名称','示例旗舰店')+field('店铺ID','123')+field('店铺ID','456'));
    assert.equal(await page.evaluate(extractTmallIdentity),null);
  } finally {
    await browser.close();await fs.rm(root,{recursive:true,force:true});
  }
});

test('Pinduoduo uses the saved profile to verify the visible shop after close and on manual retry',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdd-verify-'));
  const browser=await chromium.launch();
  const context=await browser.newContext();
  let outcome='login', visits=0;
  await context.route('https://mms.pinduoduo.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/mallcenter/mallinfo'){
      visits++;
      const target=outcome==='login'?'/login/':'/mallcenter/info/basic';
      return route.fulfill({contentType:'text/html',body:'<script>location.replace('+JSON.stringify(target)+')</script>'});
    }
    const html=path==='/login/'?'账号登录': '<div><label>店铺名称</label><div>'+outcome+'<span>复制</span></div></div>';
    await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  });
  const account='test-pdd', manual=new Map([[account,{}]]);
  let foreground=false;
  const manager={manual,sessions:new Map([[account,context]]),context:async()=>context,run:(_id,fn)=>Promise.resolve().then(fn),
    platform:()=>({id:'pinduoduo'}),hasOpenWorkbench:()=>foreground};
  const store=new CollectionStore(root,manager,{items:[{id:account,name:'拼多多 2',platform:'pinduoduo'}]});
  try{
    await store.init();
    assert.equal(store.list().shops[0].canCheckLogin,true);
    assert.equal((await store.command({action:'check',account})).status,'awaiting_close');
    assert.equal(visits,0);
    const placeholder=await context.newPage();
    await placeholder.setContent('<label>店铺名称</label><div>&nbsp;<span>复制</span></div>');
    const { visibleMallName }=await import('./pinduoduo-identity.mjs');
    assert.equal(await placeholder.evaluate(visibleMallName),null);
    await placeholder.close();
    manual.clear();outcome='测试拼多多店';store.resumeLoginChecks();
    await store.checks.get(account);
    const verified=store.list().shops[0];assert.equal(verified.authStatus,'authenticated');assert.equal(verified.storeName,outcome);
    Object.assign(store.state.shops[account],{authStatus:'security_verification',checkError:'商家后台要求完成安全验证'});
    foreground=true;
    await manager.onWorkbenchOpened(account);await manager.onWorkbenchOpened(account);
    const beforeClose=visits;
    store.resumeLoginChecks();assert.equal(store.checks.size,0);
    assert.equal(store.list().shops[0].authStatus,'security_verification');
    assert.equal(store.list().shops[0].pendingCheck,true);
    foreground=false;store.resumeLoginChecks();store.resumeLoginChecks();await store.checks.get(account);
    assert.equal(visits,beforeClose+1);
    const afterClose=store.list().shops[0];
    assert.equal(afterClose.authStatus,'authenticated');assert.equal(afterClose.checkError,null);assert.equal(afterClose.pendingCheck,false);
    outcome='其他店铺';await store.command({action:'check',account});assert.equal(store.list().shops[0].authStatus,'check_failed');assert.equal(store.list().shops[0].storeName,'测试拼多多店');
    outcome='login';await store.command({action:'check',account});assert.equal(store.list().shops[0].authStatus,'expired');
    outcome='测试拼多多店';assert.equal((await store.command({action:'check',account})).status,'completed');
    assert.equal(context.pages().length,0);assert.equal(store.state.runs.length,0);
  }finally{await browser.close();await fs.rm(root,{recursive:true,force:true});}
});

test('PDD panorama reads the bound last successful business snapshot without opening a browser', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdd-panorama-'));
  const account='test-pdd';
  const store=new CollectionStore(root,{}, {items:[{id:account,name:'PDD',platform:'pinduoduo'}]});
  const good={account,storeName:'测试店',platform:'pinduoduo',scope:'pinduoduo-home-current',status:'completed',
    finishedAt:'2026-11-18T01:12:00Z',metrics:{成交金额:'0.00',商品浏览量:null,商品访客数:'8',待付款:'0'}};
  const key={scope:'owner',agent:'business',topic:''};
  try {
    store.state.shops[account]={storeName:'测试店'};
    store.state.runs=[good,{...good,status:'failed'},{...good,storeName:'其他店'}];
    store.state.lastReports={[account]:{todo:{...good,metrics:{待付款:'1'}}}};
    const {revision}=await store.command({...key,action:'access'});
    const read=()=>store.command({...key,action:'snapshot',kind:'pddOverview',account,revision});
    const {report}=await read();
    assert.deepEqual(report.sections,{经营指标:{成交金额:'0.00',商品访客数:'8'},商家待办:{待付款:'0'}});
    assert.equal(report.capturedAt,good.finishedAt);
    store.state.runs=[];
    await assert.rejects(read(),/尚无/);
    store.state.lastReports[account].todo=good;
    assert.deepEqual((await read()).report,report);
    store.state.shops[account].storeName='另一家店';
    await assert.rejects(read(),/尚无/);
    await assert.rejects(store.command({...key,action:'snapshot',kind:'pddOverview',account,revision:'stale'}),/关联已变更/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('JD checks the current visible merchant in the saved profile after close, and recognizes passport expiry',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'jd-login-test-'));
  const browser=await chromium.launch();
  const context=await browser.newContext();
  const account='test-jd';
  let name='示例旗舰店', expired=false, showMetrics=true;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    const target=expired?'https://passport.shop.jd.com/login':'https://shop.jd.com/jdm/home';
    const html=url.pathname==='/' ? '<script>location.replace('+JSON.stringify(target)+')</script>'
        : url.hostname==='shop.jd.com' ? '<span class="shop-menu-accountV1__right-account-top-name" title="'+name+'">'+name+'</span><span hidden class="shop-menu-accountV1__right-account-top-name">旧店</span>'+(showMetrics?'<div>待打印订单</div><div>0</div>':'') : '账号登录';
    await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  });
  const manual=new Map([[account,{}]]);
  const manager={manual,sessions:new Map([[account,context]]),context:async()=>context,run:(_id,fn)=>Promise.resolve().then(fn)};
  const store=new CollectionStore(root,manager,{items:[{id:account,name:'京东 1',platform:'jd'}]});
  try{
    await store.init();
    assert.equal(store.list().shops[0].canCheckLogin,true);
    assert.equal((await store.command({action:'check',account})).status,'awaiting_close');
    manual.clear();store.resumeLoginChecks();await store.checks.get(account);
    assert.equal(store.list().shops[0].storeName,name);
    assert.equal(store.list().shops[0].authStatus,'authenticated');
    const result=await store.command({action:'collect',account});
    assert.equal(result.status,'completed');
    assert.equal(result.metrics['待打印订单'],'0');
    const key={scope:'owner',agent:'assistant',topic:'test'};
    const {revision}=await store.command({...key,action:'access'});
    const snapshot=()=>store.command({...key,action:'snapshot',account,revision,kind:'todo'});
    assert.equal((await snapshot()).latest.id,result.id);
    showMetrics=false;
    assert.equal((await store.command({action:'collect',account})).status,'failed');
    assert.equal((await snapshot()).latest.id,result.id);
    name='另一店';await store.command({action:'check',account});
    assert.equal(store.list().shops[0].authStatus,'check_failed');assert.equal(store.list().shops[0].storeName,'示例旗舰店');
    expired=true;await store.command({action:'check',account});assert.equal(store.list().shops[0].authStatus,'expired');
    assert.equal((await store.command({action:'collect',account})).status,'failed');
    assert.equal((await snapshot()).latest.id,result.id);
    assert.equal(context.pages().length,0);
  }finally{await browser.close();await fs.rm(root,{recursive:true,force:true});}
});

test('Douyin verifies the active dashboard shop after close and handles login, placeholders and account changes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-verification-'));
  const browser=await chromium.launch();
  const context=await browser.newContext();
  let expired=false,name='测试抖店',reads=0;
  const card=()=>'<main class="newHomeContainer-demo"><div class="shopInfoContainer-demo"><span class="shopName-demo">'+name+'</span></div></main>';
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    const html=url.pathname==='/login/common'?'手机登录':expired?'<script>location.replace("/login/common")</script>':card()+'<aside><span class="shopName-demo">备选店铺</span></aside>';
    reads++;await route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  });
  const account='test-douyin',manual=new Map([[account,{}]]);
  const manager={manual,sessions:new Map([[account,context]]),context:async()=>context,run:(_id,fn)=>Promise.resolve().then(fn)};
  const store=new CollectionStore(root,manager,{items:[{id:account,name:'抖店 1',platform:'douyin'}]});
  try{
    await store.init();
    assert.equal(store.list().shops[0].canCheckLogin,true);
    assert.equal((await store.command({action:'check',account})).status,'awaiting_close');
    assert.equal(reads,0);manual.clear();store.resumeLoginChecks();await store.checks.get(account);
    assert.equal(store.list().shops[0].storeName,name);assert.equal(store.list().shops[0].authStatus,'authenticated');
    name='另一家';assert.equal((await store.command({action:'check',account})).status,'failed');
    assert.equal(store.list().shops[0].storeName,'测试抖店');
    expired=true;await store.command({action:'check',account});assert.equal(store.list().shops[0].authStatus,'expired');
    expired=false;name='测试抖店';assert.equal((await store.command({action:'check',account})).status,'completed');
    const p=await context.newPage();const {visibleDouyinShopName}=await import('./douyin-identity.mjs');
    name='加载中';await p.setContent(card());assert.equal(await p.evaluate(visibleDouyinShopName),null);
  }finally{await browser.close();await fs.rm(root,{recursive:true,force:true});}
});
