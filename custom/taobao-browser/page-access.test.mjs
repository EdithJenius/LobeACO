import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatShops} from './chat-shops.mjs';
import {readMerchantPage} from './page-read.mjs';

test('page access requires a matching conversation revision before and after reading', async () => {
  const key=JSON.stringify(['scope','agent','topic']);
  const store={state:{shops:{a:{storeName:'店'}},chatLinks:{[key]:{accounts:['a'],revision:'r'}}},
    profiles:{items:[{id:'a',name:'店',platform:'douyin'}]},save:async()=>{},readPage:async()=>({ok:true})};
  const input={scope:'scope',agent:'agent',topic:'topic',action:'pageRead',account:'a',revision:'r',pageName:'商品管理'};
  assert.deepEqual(await chatShops(store,input),{ok:true});
  await assert.rejects(chatShops(store,{...input,revision:'old'}),/关联已变更/);
  store.readPage=async()=>{store.state.chatLinks[key].revision='new';return {ok:true};};
  await assert.rejects(chatShops(store,input),/关联已变更/);
});

test('page read verifies identity twice and closes only the task tab', async () => {
  let current='about:blank', closed=false, checks=0;
  const page={on(){},isClosed:()=>closed,close:async()=>{closed=true;},url:()=>current,
    goto:async url=>{current=url;return {status:()=>200};},
    locator:selector=>selector==='body' ? {waitFor:async()=>{}} : {evaluateAll:async()=>['https://fxg.jinritemai.com/ffa/g/list']},
    waitForLoadState:async()=>{},evaluate:async()=>({title:'商品管理',text:'商品列表',tables:[{rows:[{cells:['商品 A']}]}]})};
  const context={newPage:async()=>page};
  const manager={sessions:new Map([['a',context]]),context:async()=>context};
  const result=await readMerchantPage(manager,'a','douyin',{storeName:'店'},async()=>{checks++;return {storeName:'店'};},{pageName:'商品管理'});
  assert.equal(checks,2);assert.equal(closed,true);
  assert.equal(result.report.tables[0].rows[0].cells[0],'商品 A');
  assert.match(result.report.scope,/未自动翻页/);
});

test('changing selected shops closes the previous revision of browser sessions',async()=>{
  const key=JSON.stringify(['scope','agent','topic']),closed=[];
  const store={state:{shops:{a:{},b:{}},chatLinks:{[key]:{accounts:['a'],revision:'old'}}},
    profiles:{items:[{id:'a',name:'A',platform:'douyin'},{id:'b',name:'B',platform:'douyin'}]},
    save:async()=>{},chatBrowser:{closeConversation:async(...args)=>closed.push(args)}};
  const result=await chatShops(store,{scope:'scope',agent:'agent',topic:'topic',action:'setAccess',revision:'old',accounts:['b']});
  assert.deepEqual(result.accounts,['b']);assert.notEqual(result.revision,'old');
  assert.deepEqual(closed,[['scope','agent','topic','old']]);
});
