import { getPlatform } from './platforms.mjs';
import { verifySellerPage } from './seller-page-identity.mjs';

export function visibleDouyinShopName() {
  // The dashboard's active-shop card is separate from the store-switcher and its candidate list.
  const elements = document.querySelectorAll('[class*="newHomeContainer-"] [class*="shopInfoContainer-"] [class*="shopName-"]');
  const names = new Set();
  for (const el of elements) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    const name = el.innerText.trim();
    if (!name || name.length > 100 || /[\r\n]/.test(name) || /^(抖店|店铺名称|我的店铺|切换店铺|选择店铺|加载中|[-—.…\s]+)$/.test(name)) continue;
    const title = el.getAttribute('title')?.trim();
    if (!title || title === name) names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
}

export function verifyDouyin(manager, account, binding) {
  const entryUrl = getPlatform('douyin').homeUrl;
  return verifySellerPage(manager, account, binding, {
    platform: 'douyin', name: '抖店', entryUrl,
    identityTimeout:35000,
    paths: [new URL(entryUrl).pathname], readName: visibleDouyinShopName,
    unavailable: '未能确认抖店商家首页的当前店名，请在专属窗口完成登录并选择店铺后重试',
  });
}
