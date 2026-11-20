import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BrowserManager,validateAccount,validateUrl} from './core.mjs';
import {trackTaskPage,closeTaskPage} from './page-cleanup.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('reject unknown profiles and nonofficial navigation',()=>{
  assert.throws(()=>validateAccount('../other'));
  for(const u of ['http://taobao.com','https://taobao.com.evil.example','https://evil.example','file:///C:/','https://u:p@taobao.com'])assert.throws(()=>validateUrl(u));
  assert.equal(validateUrl('https://myseller.taobao.com/'),'https://myseller.taobao.com/');
});
test('manual login reserves the profile against automation',async()=>{
  const m=new BrowserManager('unused');
  m.manual.set('taobao-a',{});
  await assert.rejects(()=>m.context('taobao-a'),/普通登录窗口/);
  await assert.rejects(()=>m.execute({account:'taobao-a',action:'open'}),/请先手动关闭/);
  // The placeholder has no live OS window to bring to the foreground.
  await assert.rejects(m.execute({account:'taobao-a',action:'manual_login'}),/登录窗口已退出/);
  assert.ok(m.manual.has('taobao-a'));
});
test('seller login redirect hands off the same account and preserves other business tabs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-login-route-'));
  const manager = new BrowserManager(root, {headless:true});
  try {
    const account = 'taobao-a';
    const ctx = await manager.context(account);
    const login = 'https://loginmyseller.taobao.com/';
    await ctx.route('https://myseller.taobao.com/', route =>
      route.fulfill({status:302, headers:{location:login}}));
    await ctx.route(login, route => route.fulfill({body:'Login fixture'}));
    const handoff = [];
    manager.openManualLogin = async id => {
      handoff.push(id);
      return {account:id, mode:'manual'};
    };
    await ctx.newPage();
    for (const action of ['open', 'switch', 'openWorkbench']) {
      assert.equal((await manager.execute({account, action})).mode, 'manual');
    }
    const business = await ctx.newPage();
    const draft = 'https://myseller.taobao.com/draft';
    await ctx.route(draft, route => route.fulfill({body:'Draft fixture'}));
    await business.goto(draft);
    assert.equal((await manager.execute({account, action:'switch'})).loginRequired, true);
    await assert.rejects(manager.execute({account, action:'openWorkbench'}), /保存并关闭其他业务页面/);
    assert.equal(business.isClosed(), false);
    assert.deepEqual(handoff, [account, account, account]);
  } finally {
    await manager.closeAll();
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('taobao-login-route-')) {
      await fs.rm(root, {recursive:true, force:true});
    }
  }
});
test('profiles isolate persistent cookies and storage; reopen and switch retain identity',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'taobao-prototype-test-'));
  const m=new BrowserManager(root,{headless:true});
  try{
    for(const [id,value] of [['taobao-a','A'],['taobao-b','B']]){
      const ctx=await m.context(id);
      await ctx.route('https://fixture.taobao.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Fixture</h1><input aria-label="Title"><button>Save draft</button>'}));
      const p=ctx.pages()[0]; await p.goto('https://fixture.taobao.com/');
      await ctx.addCookies([{name:'fixture_account',value,domain:'fixture.taobao.com',path:'/',expires:Math.floor(Date.now()/1000)+3600,secure:true}]);
      await ctx.addCookies([{name:'fixture_session',value,domain:'fixture.taobao.com',path:'/',httpOnly:true,secure:true}]);
      await p.evaluate(v=>localStorage.setItem('fixture_account',v),value);
    }
    await m.execute({account:'taobao-a',action:'fill',selector:'input',text:'test draft'});
    assert.equal(await m.sessions.get('taobao-a').pages()[0].locator('input').inputValue(),'test draft');
    assert.equal(await m.sessions.get('taobao-b').pages()[0].locator('input').inputValue(),'');
    await m.execute({account:'taobao-b',action:'switch'});assert.equal(m.active,'taobao-b');
    await m.closeAll();
    for(const [id,value] of [['taobao-a','A'],['taobao-b','B']]){
      const ctx=await m.context(id);
      assert.equal((await ctx.cookies('https://fixture.taobao.com')).find(c=>c.name==='fixture_account').value,value);
      assert.equal((await ctx.cookies('https://fixture.taobao.com')).find(c=>c.name==='fixture_session').value,value);
      await ctx.route('https://fixture.taobao.com/**',r=>r.fulfill({body:'fixture'}));
      await ctx.pages()[0].goto('https://fixture.taobao.com/');
      assert.equal(await ctx.pages()[0].evaluate(()=>localStorage.getItem('fixture_account')),value);
    }
  }finally{await m.closeAll();await fs.rm(root,{recursive:true,force:true});}
});
test('MCP handshake exposes browser tools',async()=>{
  const client=new Client({name:'prototype-test',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp.mjs')]});
  try{await client.connect(transport);const {tools}=await client.listTools();assert.deepEqual(tools.map(t=>t.name).sort(),['taobao_browser','taobao_browser_status']);}finally{await client.close();}
});

test('shared work closes task popups; finishing the shop prevents old reports from reopening', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-finished-'));
  const manager = new BrowserManager(root, {headless:true});
  const account = 'taobao-a';
  try {
    const ctx = await manager.context(account);
    const workbench = ctx.pages()[0];
    await workbench.goto('data:text/html,workbench');
    const task = trackTaskPage(await ctx.newPage());
    await task.goto('data:text/html,report');
    const opened = task.waitForEvent('popup');
    await task.evaluate(() => window.open('about:blank') && true);
    const popup = await opened;
    await closeTaskPage(task);
    assert.ok(popup.isClosed());
    assert.deepEqual(ctx.pages(), [workbench]);
    await manager.execute({account,action:'close'});
    const reopened = await manager.context(account);
    assert.deepEqual(reopened.pages().map(p => p.url()), ['about:blank']);
  } finally {
    await manager.closeAll();
    await fs.rm(root,{recursive:true,force:true,maxRetries:3});
  }
});

test('reopening an isolated profile removes restored empty tabs and keeps its business page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'store-blank-tabs-'));
  const manager = new BrowserManager(root, {headless:true});
  const account = 'taobao-a';
  try {
    let ctx = await manager.context(account);
    const business = ctx.pages()[0] || await ctx.newPage();
    const local = 'data:text/html,<title>Shop dashboard</title>ready';
    await business.goto(local);
    await ctx.newPage();
    await ctx.newPage();
    await ctx.close();
    for (let i = 0; i < 2; i++) {
      ctx = await manager.context(account);
      assert.ok(ctx.pages().some(p => p.url() === local));
      assert.equal(ctx.pages().filter(p => p.url() === 'about:blank').length, 0);
      await ctx.close();
    }
  } finally {
    await manager.closeAll();
    await fs.rm(root,{recursive:true,force:true,maxRetries:3});
  }
});
