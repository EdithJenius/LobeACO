import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as X from 'xlsx';
import {dateRange} from './customer-service-pages.mjs';
import {compare} from './customer-service-report.mjs';
import {chatShops} from './chat-shops.mjs';

test('business date crosses midnight in Shanghai and rejects impossible ranges',()=>{
  assert.deepEqual(dateRange({},new Date('2026-01-01T16:01:00Z')),{start:'2026-01-01',end:'2026-01-01'});
  assert.deepEqual(dateRange({startDate:'2026-10-01',endDate:'2026-10-08'},new Date('2026-11-20T00:00Z')),{start:'2026-10-01',end:'2026-10-08'});
  assert.throws(()=>dateRange({startDate:'2026-02-30'}));
  assert.throws(()=>dateRange({startDate:'2026-01-03',endDate:'2026-01-02'}));
});
test('conversation routes customer service to the scoped report queue',async()=>{
  const profile={id:'s',name:'测试',platform:'jd'};
  const store={state:{shops:{s:{storeName:'测试'}}},profiles:{items:[profile]},save:async()=>{},running:new Map([['s',true]]),manager:{}};
  const key={scope:'owner',agent:'agent',topic:'topic'};
  const {revision}=await chatShops(store,{...key,action:'access'});
  const request={...key,account:'s',revision,action:'customerService',startDate:'2026-01-03'};
  const result=await chatShops(store,request);
  assert.equal(result.status,'blocked');assert.equal(result.shop,'测试');assert.equal(result.start,'2026-01-03');
  await assert.rejects(()=>chatShops(store,{...request,account:'other'}),/关联/);
});
test('WeChat joins by person and field, rejects stale filters, and keeps differences',()=>{
  const book=X.utils.book_new(),range={start:'2026-10-17',end:'2026-10-20'};
  X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['店铺名称','测试'],['数据时间','2026-10-17 - 2026-10-20'],['客服人员名称','咨询用户数','咨询会话数','3分钟人工回复率','平均回复时长','用户满意率','不回复率'],['A','3','4','100%','0.1分钟','90%','0%']]),'原表');
  const live=[['A','3','4','100%','0.1分钟','0%','80%']];
  const r=compare(book,'wechat-shop','测试',range,live);
  assert.equal(r.details.length,6);assert.equal(r.matched,5);
  assert.throws(()=>compare(book,'wechat-shop','其他',range,live),/店名或日期/);
});
