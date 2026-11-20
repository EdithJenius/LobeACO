import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ChatBrowser} from './chat-browser.mjs';
import {waitForMerchantVerification} from './security-verification.mjs';

test('visible PDD verification waits on the same page, and stops on access revocation or timeout',async()=>{
  let challenge=true,shown=0,waited=0;
  const marker={or(){return this;},filter(){return this;},first(){return this;},isVisible:async()=>challenge};
  const page={frames:()=>[{getByText:()=>marker,locator:()=>marker}],bringToFront:async()=>{shown++;},
    waitForTimeout:async()=>{waited++;challenge=false;}};
  await waitForMerchantVerification(page,()=>{},Date.now()+3000);
  assert.equal(shown,1);assert.equal(waited,1);
  challenge=true;
  await assert.rejects(waitForMerchantVerification(page,()=>{},0),{authStatus:'security_verification'});
  await assert.rejects(waitForMerchantVerification(page,()=>{throw Error('关联已变更');},Infinity),/关联已变更/);
  assert.equal(waited,1);
});

test('a visible Taobao access restriction stops the report without waiting or retrying',async()=>{
  const text='您的账户因异常访问行为触发安全机制，依据平台规则限制访问。';
  const frame={getByText:regex=>({filter(){return this;},first(){return this;},isVisible:async()=>regex.test(text)})};
  const page={url:()=>'https://sycm.taobao.com/portal/home.htm',frames:()=>[frame]};
  await assert.rejects(waitForMerchantVerification(page,()=>{},Infinity),
    {authStatus:'security_verification',accessRestricted:true});
});

class FakePage extends EventEmitter {
  constructor(){super();this.address='about:blank';this.closed=false;this.value='';this.type='text';this.clicks=0;}
  isClosed(){return this.closed;}
  async close(){this.closed=true;}
  url(){return this.address;}
  async goto(url){this.address=url;}
  async title(){return '商品管理';}
  frames(){return [this];}
  locator(){return {ariaSnapshot:async()=>'- button "查询"',getAttribute:async()=>this.type,
    fill:async text=>{this.value=text;},click:async()=>{this.clicks++;},press:async()=>{}};}
}
function fixture(verify=async()=>({storeName:'测试店'})) {
  const userPage=new FakePage();userPage.address='https://fxg.jinritemai.com/other';
  const pages=[userPage];
  const context={pages:()=>pages.filter(p=>!p.closed),newPage:async()=>{const p=new FakePage();pages.push(p);return p;}};
  const manager={sessions:new Map([['shop',context]]),manual:new Map(),context:async()=>context,run:async(_id,fn)=>fn()};
  const browser=new ChatBrowser(manager,()=>verify);
  const input={scope:'s',agent:'a',topic:'t',account:'shop',revision:'r',operation:'open',url:'https://fxg.jinritemai.com/ffa/g/list'};
  return {browser,manager,userPage,pages,input,profile:{platform:'douyin'},binding:{storeName:'测试店'}};
}

test('headless chat requires a background context and preserves a merchant window',async()=>{
  const f=fixture(), ctx=await f.manager.context();
  f.profile.headlessChat=true;
  f.manager.backgroundContexts=new WeakSet();
  const open=()=>f.browser.execute('shop',f.profile,f.binding,f.input,()=>{});
  await assert.rejects(open(),/可见后台/);
  assert.equal(f.userPage.closed,false);
  f.manager.sessions.clear();
  f.manager.context=async(id,options)=>{
    assert.equal(options.background,true);assert.ok(!options.automatic);
    f.manager.backgroundContexts.add(ctx);f.manager.sessions.set(id,ctx);return ctx;
  };
  assert.equal((await open()).headless,true);
  await f.browser.execute('shop',f.profile,f.binding,{...f.input,operation:'close'},()=>{});
});

test('chat browser uses only its own page and cleans it without closing user tabs',async()=>{
  const f=fixture(), invoke=(input,assert=()=>{})=>f.browser.execute('shop',f.profile,f.binding,input,assert);
  const opened=await invoke(f.input);
  assert.equal(opened.page.url,'https://fxg.jinritemai.com/ffa/g/list');
  assert.equal(opened.tabs.length,1);
  await invoke({...f.input,operation:'fill',selector:'input',text:'abc'});
  assert.equal(f.pages[1].value,'abc');
  await invoke({...f.input,operation:'close'});
  assert.equal(f.userPage.closed,false);assert.equal(f.pages[1].closed,true);
});

test('chat browser refuses non-official destinations and cleans failed session',async()=>{
  const f=fixture();
  await assert.rejects(f.browser.execute('shop',f.profile,f.binding,{...f.input,url:'https://evil.example/'},()=>{}),/官方/);
  assert.equal(f.pages[1].closed,true);assert.equal(f.userPage.closed,false);
});

test('PDD challenge appearing in the final snapshot cannot be delivered as a successful business page',async()=>{
  const f=fixture();
  const create=f.manager.context;
  const ctx=await create();
  const make=ctx.newPage.bind(ctx);
  ctx.newPage=async()=>{
    const page=await make();
    page.locator=()=>({ariaSnapshot:async()=>'- text: 请向右滑块完成拼图'});
    return page;
  };
  await assert.rejects(f.browser.execute('shop',{platform:'pinduoduo'},f.binding,
    {...f.input,url:'https://mms.pinduoduo.com/home/'},()=>{}),{authStatus:'security_verification'});
  assert.equal(f.pages[1].closed,true);
});

test('access is checked again after identity verification before click',async()=>{
  let allowed=true;const f=fixture(async()=>{allowed=false;return {storeName:'测试店'};});
  await assert.rejects(f.browser.execute('shop',f.profile,f.binding,{...f.input,operation:'click',selector:'button'},()=>{if(!allowed)throw Error('关联已变更');}),/关联已变更/);
  assert.equal(f.pages[1].clicks,0);assert.equal(f.pages[1].closed,true);
});

test('password and file inputs are not filled and sessions are isolated by conversation',async()=>{
  const f=fixture(), invoke=input=>f.browser.execute('shop',f.profile,f.binding,input,()=>{});
  await invoke(f.input);await invoke({...f.input,topic:'other'});
  assert.equal(f.browser.sessions.size,2);
  f.pages[1].type='password';
  await assert.rejects(invoke({...f.input,operation:'fill',selector:'input',text:'secret'}),/密码/);
  assert.equal(f.pages[1].closed,true);assert.equal(f.pages[2].closed,false);
  await invoke({...f.input,topic:'other',operation:'close'});
});

test('reports uncertain execution when access changes after a click',async()=>{
  const f=fixture();let calls=0;
  await assert.rejects(f.browser.execute('shop',f.profile,f.binding,{...f.input,operation:'click',selector:'button'},()=>{
    calls++;if(calls===3)throw Error('关联已变更');
  }),/可能已执行.*勿自动重试/);
  assert.equal(f.pages[1].clicks,1);assert.equal(f.pages[1].closed,true);
});

test('concurrent runs in one conversation stay isolated and revocation closes both',async()=>{
  const f=fixture(), invoke=input=>f.browser.execute('shop',f.profile,f.binding,input,()=>{});
  await invoke({...f.input,runId:'one'});await invoke({...f.input,runId:'two'});
  assert.equal(f.browser.sessions.size,2);
  await invoke({...f.input,runId:'one',operation:'close'});
  assert.equal(f.pages[1].closed,true);assert.equal(f.pages[2].closed,false);
  await f.browser.closeConversation('s','a','t','r');
  assert.equal(f.pages[2].closed,true);assert.equal(f.userPage.closed,false);
});
