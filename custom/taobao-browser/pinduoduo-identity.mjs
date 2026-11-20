import { verifySellerPage } from './seller-page-identity.mjs';

const origin = 'https://mms.pinduoduo.com';
const mallInfo = '/mallcenter/mallinfo';

export function visibleMallName() {
  const labels = [...document.querySelectorAll('label')].filter(el =>
    el.innerText.trim() === '店铺名称' && el.getClientRects().length);
  const names = labels.map(el => {
    const field = el.nextElementSibling;
    if (!field?.getClientRects().length) return '';
    const text = [...field.childNodes].filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent).join('').replace(/^[\s\u200b]+|[\s\u200b]+$/gu, '');
    const copy = field.querySelector('[data-clipboard-text]')?.getAttribute('data-clipboard-text');
    return copy && copy !== text ? '' : text;
  }).filter(v => v && v.length <= 100 && !/^[-—]+$/.test(v));
  return new Set(names).size === 1 ? names[0] : null;
}

export function verifyPinduoduo(manager, account, binding, checkPrompt) {
  return verifySellerPage(manager, account, binding, {
    platform: 'pinduoduo', name: '拼多多', entryUrl: origin + mallInfo,
    paths: [mallInfo, '/mallcenter/info/basic'], readName: visibleMallName, checkPrompt,
    unavailable: '未能读取拼多多「店铺信息」中的店铺名称，请检查该账号能否访问店铺信息页后重试',
  });
}
