import { verifySellerPage } from './seller-page-identity.mjs';

function visibleJdShopName() {
  const names = new Set();
  for (const el of document.querySelectorAll('[class*="shop-menu-account"][class*="__right-account-top-name"]')) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
    const text = el.innerText.trim();
    const title = el.getAttribute('title')?.trim();
    if (text && text.length <= 100 && !/^[-—.\s\u200b…]+$/u.test(text) && (!title || title === text))
      names.add(text);
  }
  return names.size === 1 ? [...names][0] : null;
}

export function verifyJd(manager, account, binding) {
  return verifySellerPage(manager, account, binding, {
    platform: 'jd', name: '京东', entryUrl: 'https://shop.jd.com/',
    paths: ['/jdm/home'], readName: visibleJdShopName,
    unavailable: '未能读取京麦首页当前店名，请确认账号可以进入京麦工作台后重试',
  });
}
