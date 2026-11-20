import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const info=JSON.parse((await fs.readFile(new URL('./runtime/import-test.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const context=await chromium.launchPersistentContext(info.testRoot,{headless:false,chromiumSandbox:true,viewport:null});
try {
  const before=await context.cookies('https://myseller.taobao.com/');
  const page=context.pages()[0]||await context.newPage();
  await page.goto('https://myseller.taobao.com/',{waitUntil:'domcontentloaded',timeout:45000});
  const body=await page.locator('body').innerText({timeout:15000});
  const result={cookieCountBeforeNavigation:before.length,url:page.url(),title:await page.title(),redirectedToLogin:new URL(page.url()).hostname==='loginmyseller.taobao.com',loginPageText:body.includes('欢迎登录'),checkedAt:new Date().toISOString()};
  await fs.writeFile(new URL('./runtime/import-result.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { await context.close(); }
