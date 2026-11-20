import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {ChatBrowser} from './chat-browser.mjs';
import {clickJdProductCopy,closeJdNotice} from './jd-page-controls.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {registerTaskWindow,setTaskWindowState} from './task-window.mjs';
import {checkSecurityPrompt} from './security-verification.mjs';

test('automatic shop window restores for login and resumes minimized in the same session',async()=>{
  const browser=await chromium.launch({headless:false,args:['--start-minimized']});
  try{
    const context=await browser.newContext({viewport:null});
    registerTaskWindow(context,'pinduoduo');
    await context.route('https://mms.pinduoduo.com/**',r=>r.fulfill({body:'test shop'}));
    const p=await context.newPage(),cdp=await context.newCDPSession(p);
    const state=async()=>(await cdp.send('Browser.getWindowForTarget')).bounds.windowState;
    await setTaskWindowState(p,'minimized');
    await p.goto('https://mms.pinduoduo.com/login');
    const pending=checkSecurityPrompt(p);
    try{
      for(let i=0;i<50&&await state()!=='normal';i++)await p.waitForTimeout(100);
      assert.equal(await state(),'normal');
    }finally{await p.goto('https://mms.pinduoduo.com/home/');await pending;}
    assert.equal(await state(),'minimized');
    const report=await context.newPage();
    await report.goto('https://mms.pinduoduo.com/report');
    const reportSession=await context.newCDPSession(report);
    const reportState=async()=>(await reportSession.send('Browser.getWindowForTarget')).bounds.windowState;
    for(let i=0;i<50&&await reportState()!=='minimized';i++)await report.waitForTimeout(100);
    assert.equal(await reportState(),'minimized');
  }finally{await browser.close();}
});

test('long PDD performance snapshots preserve every row of the current page',async()=>{
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext();
    const url='https://mms.pinduoduo.com/mms-chat/overview/merchant';
    const noise='<p>用于测试长页面导航区域的内容</p>'.repeat(1000);
    const rows=Array.from({length:10},(_,i)=>'<tr><td>客服'+i+'</td><td>0秒</td></tr>').join('');
    await context.route(url,r=>r.fulfill({contentType:'text/html; charset=utf-8',
      body:noise+'<table><tr><th>客服账号</th><th>平均人工响应时长</th></tr>'+rows+'</table>'+noise}));
    const manager={sessions:new Map([['a',context]]),context:async()=>context,run:(_,fn)=>fn()};
    const chat=new ChatBrowser(manager,()=>async()=>({storeName:'测试店'}));
    const call=operation=>chat.execute('a',{platform:'pinduoduo'},{storeName:'测试店'},
      {account:'a',scope:'s',agent:'x',topic:'t',revision:'r',url,operation},()=>{});
    const snapshot=(await call('open')).page.frames[0].snapshot;
    for(let i=0;i<10;i++)assert.ok(snapshot.includes('客服'+i));
    assert.ok(snapshot.length<=18000);
    await call('close');
  }finally{await browser.close();}
});

test('PDD report click saves the browser download only after shop and access rechecks',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdd-export-test-'));
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext();
    const url='https://mms.pinduoduo.com/test-customer-performance';
    const csv='\uFEFF客服账号,人工接待人数,3分钟人工回复率,平均人工响应时长\r\n店铺总计,1,100%,1秒';
    await context.route(url,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:
      '<table><tr><th>人工接待人数</th><th>3分钟人工回复率</th><th>平均人工响应时长</th></tr></table>'+
      '<a download="客服数据.csv" href="data:text/csv,'+encodeURIComponent(csv)+'">下载表单</a>'}));
    const manager={root:path.join(root,'profiles'),sessions:new Map([['a',context]]),context:async()=>context,run:(_id,fn)=>fn()};
    let checks=0,rejectAt=Infinity;
    const chat=new ChatBrowser(manager,()=>async()=>{if(++checks===rejectAt)throw Error('店铺不一致');return {storeName:'测试店'};});
    const call=args=>chat.execute('a',{platform:'pinduoduo'},{storeName:'测试店'},
      {account:'a',scope:'s',agent:'x',topic:'t',revision:'r',...args},()=>{});
    const click={operation:'click',selector:'text=下载表单'};
    await call({operation:'open',url});
    rejectAt=checks+2;
    await assert.rejects(call(click),/店铺不一致/);
    assert.deepEqual(await fs.readdir(root),[]);
    await call({operation:'open',url});
    const {download}=await call(click);
    await call({operation:'close'});
    assert.equal(await fs.readFile(download.file,'utf8'),csv);
    assert.equal(download.originalName,'客服数据.csv');
  } finally {await browser.close();await fs.rm(root,{recursive:true,force:true});}
});

test('JD share uses the visible row popup and the notice closes through its control', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://wares-jdm.jd.com/**', route=>route.fulfill({contentType:'text/html; charset=utf-8',
      body:'<button onclick="document.querySelector(\'aside\').hidden=false">分享</button><aside hidden role="tooltip">扫码查看商品<button onclick="navigator.clipboard.writeText(\'https://item.jd.com/123.html?sdx=abc\')">复制链接</button></aside>'}));
    await page.goto('https://wares-jdm.jd.com/ware/wareList');
    const result = await clickJdProductCopy(page.mainFrame(),page.getByText('分享',{exact:true}));
    assert.equal(result,'https://item.jd.com/123.html?sdx=abc');
    await page.route('https://jdsz.jd.com/**', route=>route.fulfill({contentType:'text/html; charset=utf-8',
      body:'<div class="win-notice-modal"><button class="close-modal" onclick="this.parentNode.remove()">关闭</button></div><button>近7天</button>'}));
    await page.goto('https://jdsz.jd.com/szweb/view/index/home.html');
    await closeJdNotice(page);
    assert.equal(await page.getByText('关闭').count(),0);
    await page.getByText('近7天').click();
  } finally { await browser.close(); }
});

test('refund tab is clicked once when a tour appears after opening the page', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const url = 'https://myseller.taobao.com/home.htm/trade-platform/refund-list';
    await context.route(url, route => route.fulfill({contentType:'text/html; charset=utf-8',
      body:'<button role="tab" onclick="this.textContent=String(++window.clicks)">退款（不含退货）</button>'}));
    const manager = {sessions:new Map([['a',context]]),context:async()=>context,run:(_id,fn)=>fn()};
    const tool = new ChatBrowser(manager,()=>async()=>({storeName:'测试店'}));
    const call = args => tool.execute('a',{platform:'taobao'},{storeName:'测试店'},
      {scope:'s',agent:'a',topic:'t',account:'a',revision:'r',...args},()=>{});
    await call({operation:'open',url});
    const page = context.pages()[0];
    await page.evaluate(() => {
      window.clicks = 0;
      document.body.insertAdjacentHTML('beforeend','<svg class="driver-overlay" style="position:fixed;inset:0;width:100%;height:100%"></svg>');
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') document.querySelector('svg').remove();
      });
    });
    await call({operation:'click',selector:'role=tab[name="退款（不含退货）"]'});
    assert.equal(await page.getByRole('tab').textContent(),'1');
    await call({operation:'close'});
  } finally { await browser.close(); }
});

test('browser operations run on a task tab with a real browser',async()=>{
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  await context.route('https://fxg.jinritemai.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>商品管理</h1><input aria-label="商品名称"><button onclick="document.body.dataset.clicked=1">查询</button>'}));
  const userPage=await context.newPage();
  const manager={sessions:new Map([['a',context]]),manual:new Map(),context:async()=>context,run:async(_id,fn)=>fn()};
  let verifies=0;
  const tool=new ChatBrowser(manager,()=>async()=>{verifies++;return {storeName:'测试店'};});
  const input={scope:'s',agent:'a',topic:'t',account:'a',revision:'r',operation:'open',url:'https://fxg.jinritemai.com/ffa/g/list'};
  const call=extra=>tool.execute('a',{platform:'douyin'},{storeName:'测试店'},{...input,...extra},()=>{});
  try {
    const open=await call({});
    assert.match(open.page.frames[0].snapshot,/商品管理/);
    await call({operation:'fill',selector:'input',text:'测试商品'});
    await call({operation:'click',selector:'button'});
    assert.equal(await context.pages()[1].locator('input').inputValue(),'测试商品');
    assert.equal(await context.pages()[1].locator('body').getAttribute('data-clicked'),'1');
    assert.equal(verifies,6);
    await context.pages()[1].evaluate(() => {
      const list = document.createElement('ol');
      for(let i=0; i<1200; i++) {
        const row = document.createElement('li');
        row.textContent = '验收商品名称与当前行 ' + i;
        list.append(row);
      }
      document.body.append(list);
      const dialog = document.createElement('dialog');
      dialog.textContent = '本行商品分享链接 https://example.com/item/123';
      document.body.append(dialog);
      dialog.show();
    });
    const longPage = (await call({operation:'inspect'})).page.frames[0].snapshot;
    assert.ok(longPage.length <= 18000);
    assert.match(longPage,/当前弹窗：[\s\S]*example\.com\/item\/123/);
    await call({operation:'close'});
    assert.deepEqual(context.pages(),[userPage]);
  } finally {await browser.close();}
});
