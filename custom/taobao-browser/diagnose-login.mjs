import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const report=JSON.parse(await fs.readFile('runtime/diagnostic-report.json','utf8'));
const results=[];
for(const account of ['taobao-a','taobao-b'])for(const mode of ['default','native-credential-store']){
 const target=path.resolve('runtime',`diagnostic-${account}-${mode}-${Date.now()}`);
 await fs.cp(path.join(report.backup,account),target,{recursive:true});
 const context=await chromium.launchPersistentContext(target,{headless:false,chromiumSandbox:true,...(mode==='native-credential-store'?{ignoreDefaultArgs:['--use-mock-keychain','--password-store=basic']}:{})});
 try{
  const cookies=(await context.cookies()).filter(c=>c.domain==='taobao.com'||c.domain.endsWith('.taobao.com'));
  const page=context.pages()[0];
  let result={account,mode,readableTaobaoCookies:cookies.length,cookieNames:cookies.map(c=>c.name).sort()};
  if(cookies.length){await page.goto('https://myseller.taobao.com/',{waitUntil:'domcontentloaded',timeout:45000});result.url=new URL(page.url()).origin+new URL(page.url()).pathname;result.title=await page.title();result.loginRedirect=new URL(page.url()).hostname==='loginmyseller.taobao.com';}
  results.push(result);console.log(JSON.stringify(result));
 }finally{await context.close();}
}
await fs.writeFile('runtime/diagnostic-browser-results.json',JSON.stringify(results,null,2));
