import { verifySellerPage } from './seller-page-identity.mjs';

export function readWechatShopName() {
  const names = new Set();
  const candidates = [...document.querySelectorAll('.weui-desktop-menu__shop_name')];
  // In the settings micro-app, the first span in the basic information
  // heading is the merchant name. A document query cannot enter its Shadow DOM.
  for (const app of document.querySelectorAll('micro-app[name="setting"]')) {
    const root = app.shadowRoot ?? app;
    candidates.push(...root.querySelectorAll('.cshop > .cshop-name'));
    for (const label of root.querySelectorAll('.right-section span + span')) {
      if (label.innerText.trim() === '基础信息' && label.getClientRects().length &&
          getComputedStyle(label).visibility !== 'hidden') candidates.push(label.previousElementSibling);
    }
  }
  // The redesigned homepage shows the name in the shop identity card.
  for (const card of document.querySelectorAll('div.rounded-\\[12px\\].bg-white')) {
    if (!card.innerText.includes('店铺体验分') || !card.innerText.includes('店铺诊断')) continue;
    candidates.push(...card.querySelectorAll('.cursor-pointer > span.font-medium.text-ellipsis'));
  }
  for (const el of candidates) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    const text = el.innerText.trim();
    if (text && text.length <= 100 && !/^[-—.\s…]+$/u.test(text)) names.add(text);
  }
  return names.size === 1 ? [...names][0] : null;
}

export function verifyWechatShop(manager, account, binding) {
  return verifySellerPage(manager, account, binding, {
    platform:'wechat-shop', name:'微信小店', entryUrl:new URL('/shop/setting/profile',manager.platform(account).homeUrl).href,
    paths:['/shop/setting/profile','/shop/home'], readName:readWechatShopName,
    signedOut:/^\s*(扫码进入我的小店|登录超时，请重新\s*登录)\s*$/,
    unavailable:'未能确认微信小店的店铺名称，请确认扫码后已进入所选店铺的商家后台',
  });
}
