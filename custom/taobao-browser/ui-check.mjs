import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'taobao-ui-test-'));
const child=spawn(process.execPath,['service.mjs'],{env:{...process.env,TAOBAO_BROWSER_PORT:'18768',TAOBAO_BROWSER_RUNTIME:root},windowsHide:true,stdio:['ignore','pipe','pipe']});
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve()});child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'))})});
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18768/');await page.locator('.card').nth(1).waitFor();
 await page.locator('#name').fill('测试专用店铺');await page.getByRole('button',{name:'创建环境',exact:true}).click();await page.getByRole('heading',{name:'测试专用店铺',exact:true}).waitFor();
 await page.locator('#account').selectOption({label:'测试专用店铺'});
 await page.locator('#password').fill('ui-test-password-123');await page.locator('#repeat').fill('ui-test-password-123');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'加密导出',exact:true}).click();const download=await downloadPromise;const backup=path.join(root,'test.tbprofile');await download.saveAs(backup);
 await page.locator('#output').filter({hasText:'加密备份已生成'}).waitFor();await page.locator('#password').fill('ui-test-password-123');await page.locator('#file').setInputFiles(backup);await page.locator('#restoreName').fill('恢复验证店铺');await page.getByRole('button',{name:'导入到新环境',exact:true}).click();await page.getByRole('heading',{name:'恢复验证店铺',exact:true}).waitFor();
 assert.equal(await page.locator('#password').inputValue(),'');assert.deepEqual(errors,[]);assert.equal(await page.locator('.card').count(),4);
 const unauth=await fetch('http://127.0.0.1:18768/status');assert.equal(unauth.status,401);
 const badOrigin=await fetch('http://127.0.0.1:18768/',{headers:{Origin:'https://example.com'}});assert.equal(badOrigin.status,403);
 await fs.mkdir('runtime',{recursive:true});await page.screenshot({path:'runtime/profile-manager-preview.png',fullPage:true});console.log('UI create/export/download/import + password clearing + HTTP authorization checks passed');
}finally{await browser.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'taobao-ui-test-'));await fs.rm(root,{recursive:true,force:true});}
