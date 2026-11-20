import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright';
const file='runtime/b-save-verification.json';
const record=JSON.parse(await fs.readFile(file,'utf8'));
const context=await chromium.launchPersistentContext(record.testCopy,{executablePath:chromium.executablePath(),headless:false,chromiumSandbox:true,viewport:null,args:['--restore-last-session']});
try{
 const cookies=(await context.cookies()).filter(c=>c.domain==='taobao.com'||c.domain.endsWith('.taobao.com'));
 record.readableCookieCount=cookies.length;record.readableSessionCookieCount=cookies.filter(c=>c.expires===-1).length;
 const page=await context.newPage();
 await page.goto('https://myseller.taobao.com/home.htm/QnworkbenchHome/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.locator('body').waitFor({state:'visible'});
 // Wait for either the official login screen or the loaded dashboard, not a fixed sleep.
 await page.getByText(/欢迎登录|店铺数据|待发货/).first().waitFor({state:'visible',timeout:20000}).catch(()=>{});
 record.url=page.url().split('?')[0];record.title=await page.title();
 record.redirectedToLogin=new URL(page.url()).hostname==='loginmyseller.taobao.com';
 record.pageExcerpt=(await page.locator('body').innerText()).slice(0,1600);
 await page.screenshot({path:'runtime/b-restored-page.png'});
 record.checkedAt=new Date().toISOString();
}finally{await context.close();record.originalCookieFileUnchanged=createHash('sha256').update(await fs.readFile(path.join(record.source,'Default','Network','Cookies'))).digest('hex')===record.cookieFileHash;await fs.writeFile(file,JSON.stringify(record,null,2));}
console.log(JSON.stringify({readableCookieCount:record.readableCookieCount,readableSessionCookieCount:record.readableSessionCookieCount,url:record.url,title:record.title,redirectedToLogin:record.redirectedToLogin,pageExcerpt:record.pageExcerpt,originalCookieFileUnchanged:record.originalCookieFileUnchanged},null,2));
