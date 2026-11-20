import {customerServiceReport} from './customer-service-report.mjs';
import {randomUUID} from 'node:crypto';

export async function chatShops(store, input) {
  const {scope, agent, topic} = input;
  if (![scope,agent].every(v=>typeof v==='string' && v.length && v.length<=200) ||
      typeof topic!=='string' || topic.length>200) throw Error('店铺会话标识无效');
  const links = store.state.chatLinks ??= {};
  const key = JSON.stringify([scope,agent,topic]);
  const available = () => store.profiles.items.filter(p=>!p.platform.endsWith('-buyer') && !p.restoreError && !store.state.shops[p.id]?.unbound);
  const shops = available();
  const ids = new Set(shops.map(p=>p.id));
  const previous = links[key];
  const inherited = previous ?? links[JSON.stringify([scope,agent,''])];
  const accounts = (inherited?.accounts ?? []).filter(id=>ids.has(id));
  if (!accounts.length && shops.length) accounts.push((shops.find(p=>p.platform==='taobao') ?? shops[0]).id);
  if (!previous || JSON.stringify(accounts)!==JSON.stringify(previous.accounts)) {
    links[key]={accounts, revision:randomUUID()}; await store.save();
  }
  const access = links[key];
  if(input.action==='setAccess') {
    if(input.revision!==access.revision) throw Error('店铺关联已更新，请重新选择');
    if(!Array.isArray(input.accounts) || !input.accounts.length || input.accounts.some(id=>!ids.has(id)) ||
       new Set(input.accounts).size!==input.accounts.length) throw Error('请至少选择一家已绑定店铺');
    links[key]={accounts:[...input.accounts],revision:randomUUID()}; await store.save();
    await store.chatBrowser?.closeConversation(scope,agent,topic,access.revision);
  }
  if(input.action==='customerService' || input.action==='live' || input.action==='snapshot' || input.action==='pageRead' || input.action==='browser' || input.action==='productList') {
    const assertAccess=()=>{
      if(input.revision!==links[key]?.revision || !links[key].accounts.includes(input.account) ||
          !available().some(p=>p.id===input.account)) throw Error('店铺关联已变更，请重新读取');
    };
    assertAccess();
    try {
      if(input.action==='customerService'){
        const job=(store.customerServiceQueue??Promise.resolve()).then(()=>{
          assertAccess();return customerServiceReport(store,input.account,input,assertAccess);
        });
        store.customerServiceQueue=job.catch(()=>{});
        const result=await job;assertAccess();return result;
      }
      if(input.action==='productList') {
        const value=await store.readProducts(input.account,input,assertAccess);
        assertAccess();return value;
      }
      if (input.action==='browser') {
        const value = await store.browserAction(input.account,input,assertAccess);
        assertAccess(); return value;
      }
      if (input.action==='pageRead') {
        const value = await store.readPage(input.account,input);
        assertAccess(); return value;
      }
      if (!['todo','products','quality','finance','daily','syncDaily'].includes(input.kind) &&
          !(input.action==='snapshot' && input.kind==='pddOverview')) throw Error('未知经营报表');
      if (input.action==='snapshot') {
        const value = await store.snapshot(input.account,input.kind);
        assertAccess(); return value;
      }
      const value = input.kind==='todo' ? await store.command({action:'diagnose',account:input.account})
        : await store.command({action:'report',account:input.account,kind:input.kind});
      assertAccess(); return value;
    } catch (error) {
      const binding = store.state.shops[input.account];
      if (binding && !binding.unbound && (error.authStatus === 'security_verification' || error.expired)) {
        Object.assign(binding,{authStatus:error.authStatus || 'expired',checkError:error.message,checkedAt:new Date().toISOString()});
        await store.save();
      }
      throw error;
    }
  }
  return {...links[key],shops:shops.map(({id,name,platform})=>{
    const binding = store.state.shops[id];
    return {id, name:binding?.storeName || name, platform,
      authStatus:store.manager?.manual?.has(id) ? 'awaiting_close' : binding?.authStatus || 'unknown'};
  })};
}
