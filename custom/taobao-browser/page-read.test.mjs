import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readMerchantPage } from './page-read.mjs';

test('page read uses the selected shop, returns visible table and closes its own tab', async () => {
  const browser = await chromium.launch({headless:true});
  const ctx = await browser.newContext();
  await ctx.route('https://fxg.jinritemai.com/**', route => route.fulfill({contentType:'text/html; charset=utf-8',body:
    route.request().url().includes('/ffa/g/list')
      ? '<title>商品管理</title><table><thead><tr><th>商品信息</th></tr></thead><tbody><tr><td>商品 A ID: 123</td></tr></tbody></table>'
      : '<a href="/ffa/g/list">商品管理</a>'}));
  const userPage = await ctx.newPage();
  const manager = {sessions:new Map([['a',ctx]]),context:async()=>ctx};
  let checks = 0;
  try {
    const result = await readMerchantPage(manager,'a','douyin',{storeName:'测试店'},async()=>{checks++;return {storeName:'测试店'};},{pageName:'商品管理'});
    assert.equal(checks,2);
    assert.equal(result.report.tables[0].rows[0].cells[0],'商品 A ID: 123');
    assert.equal(result.report.sourceUrl,'https://fxg.jinritemai.com/ffa/g/list');
    assert.deepEqual(ctx.pages(),[userPage]);
    await assert.rejects(readMerchantPage(manager,'a','douyin',{storeName:'测试店'},async()=>({storeName:'测试店'}),{pageName:'不存在'}),/未发现/);
    assert.deepEqual(ctx.pages(),[userPage]);
  } finally { await browser.close(); }
});
