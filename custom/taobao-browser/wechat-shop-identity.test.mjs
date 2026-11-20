import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { getPlatform } from './platforms.mjs';
import { verifyWechatShop } from './wechat-shop-identity.mjs';

test('WeChat shop checks the merchant in the settings shadow root and rejects a different binding', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const manager = {sessions:new Map([['fixture',context]]), context:async()=>context, platform:()=>getPlatform('wechat-shop')};
    await context.route('https://store.weixin.qq.com/**', route => {
      assert.equal(new URL(route.request().url()).pathname, '/shop/setting/profile');
      return route.fulfill({contentType:'text/html; charset=utf-8', body:`
        <micro-app name="setting"></micro-app>
        <script>
          document.querySelector('micro-app').attachShadow({mode:'open'}).innerHTML =
            '<div class="right-section"><div><span>测试店</span><span>基础信息</span></div></div>';
        </script>`});
    });
    assert.deepEqual(await verifyWechatShop(manager,'fixture',{}), {storeName:'测试店'});
    await assert.rejects(verifyWechatShop(manager,'fixture',{storeName:'另一家店'}), /店名与已绑定店铺不一致/);
    assert.equal(context.pages().length,0);
  } finally {
    await browser.close();
  }
});
