import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const results=[];
for(const mode of ['default','restore-session']){
 const root=path.resolve('runtime',`fixture-session-${mode}-${Date.now()}`);
 const options={headless:false,chromiumSandbox:true,args:mode==='restore-session'?['--restore-last-session']:[]};
 let ctx=await chromium.launchPersistentContext(root,options);
 await ctx.route('https://fixture.taobao.com/**',r=>r.fulfill({body:'<h1>Local session fixture</h1>'}));
 await ctx.pages()[0].goto('https://fixture.taobao.com/');
 await ctx.addCookies([{name:'fixture_session',value:'fixture-only',domain:'fixture.taobao.com',path:'/',httpOnly:true,secure:true},{name:'fixture_persistent',value:'fixture-only',domain:'fixture.taobao.com',path:'/',expires:Math.floor(Date.now()/1000)+3600}]);
 await ctx.close();
 ctx=await chromium.launchPersistentContext(root,options);
 try{const names=(await ctx.cookies('https://fixture.taobao.com/')).map(c=>c.name);const result={mode,sessionRetained:names.includes('fixture_session'),persistentRetained:names.includes('fixture_persistent')};results.push(result);console.log(JSON.stringify(result));}finally{await ctx.close();}
}
await fs.writeFile('runtime/session-cookie-results.json',JSON.stringify(results,null,2));
