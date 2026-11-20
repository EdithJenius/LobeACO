import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BrowserManager} from './core.mjs';
import {ProfileStore,seal,unseal,safeEntry} from './profiles.mjs';
test('authenticated encryption rejects wrong password, tampering and unsafe paths',()=>{
 const blob=seal({files:[]},'fixture-password-123');
 assert.deepEqual(unseal(blob,'fixture-password-123'),{files:[]});
 assert.throws(()=>unseal(blob,'wrong-password-123'));
 blob[35]^=1;assert.throws(()=>unseal(blob,'fixture-password-123'));
 for(const name of ['../escape','/root','C:/root','a/../b','a\\b','NUL','a/CON.txt'])assert.throws(()=>safeEntry(name));
});
test('profile export/import restores cookie and storage into a new isolated profile',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'taobao-profile-test-'));
 const manager=new BrowserManager(root,{headless:true});const store=new ProfileStore(manager);await store.init();
 try{
  const original=await store.create('测试店铺');const ctx=await manager.context(original.id);
  await ctx.route('https://fixture.taobao.com/**',r=>r.fulfill({body:'<h1>Profile test</h1>'}));
  const page=ctx.pages()[0];await page.goto('https://fixture.taobao.com/');
  await ctx.addCookies([{name:'profile_fixture',value:'A',domain:'fixture.taobao.com',path:'/',expires:Math.floor(Date.now()/1000)+3600}]);
  await ctx.addCookies([{name:'session_fixture',value:'A',domain:'fixture.taobao.com',path:'/',httpOnly:true,secure:true}]);
  await page.evaluate(()=>localStorage.setItem('fixture','A'));
  const backup=await store.export(original.id,'fixture-password-123');assert.equal(manager.sessions.has(original.id),false);
  await assert.rejects(()=>store.import('错误密码',backup.data,'wrong-password-123'));assert.equal(store.items.length,3);
  const malicious=seal({version:1,engine:'playwright-chromium',files:[{path:'../escape',data:'QQ=='}]},'fixture-password-123');
  await assert.rejects(()=>store.import('越界',malicious.toString('base64'),'fixture-password-123'));assert.equal(store.items.length,3);
  const restored=await store.import('恢复店铺',backup.data,'fixture-password-123');assert.notEqual(restored.id,original.id);
  const rc=await manager.context(restored.id);assert.equal((await rc.cookies('https://fixture.taobao.com')).find(c=>c.name==='profile_fixture').value,'A');
  assert.equal((await rc.cookies('https://fixture.taobao.com')).find(c=>c.name==='session_fixture').value,'A');
  await rc.route('https://fixture.taobao.com/**',r=>r.fulfill({body:'restored'}));await rc.pages()[0].goto('https://fixture.taobao.com/');assert.equal(await rc.pages()[0].evaluate(()=>localStorage.getItem('fixture')),'A');
  await rc.pages()[0].evaluate(()=>localStorage.setItem('fixture','B'));await rc.close();
  const oc=await manager.context(original.id);await oc.route('https://fixture.taobao.com/**',r=>r.fulfill({body:'original'}));await oc.pages()[0].goto('https://fixture.taobao.com/');assert.equal(await oc.pages()[0].evaluate(()=>localStorage.getItem('fixture')),'A');
  const reopened=new ProfileStore(manager);await reopened.init();assert.equal(reopened.items.find(p=>p.id===restored.id).name,'恢复店铺');
 }finally{await manager.closeAll();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'taobao-profile-test-'));await fs.rm(root,{recursive:true,force:true});}
});
