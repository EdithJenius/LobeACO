export const platforms = [
  {
    id: 'wechat-shop', name: '微信小店',
    homeUrl: 'https://store.weixin.qq.com/shop/home', loginUrl: 'https://store.weixin.qq.com/',
    domains: ['store.weixin.qq.com'], loginHosts: [],
  },
  {id: 'jd', name: '京东', homeUrl: 'https://shop.jd.com/', domains: ['jd.com'], loginHosts: ['passport.shop.jd.com', 'passport.jd.com']},
  {id: 'alibaba', name: 'Alibaba.com', homeUrl: 'https://i.alibaba.com/', domains: ['alibaba.com'], loginHosts: ['login.alibaba.com']},
  {
    id: 'taobao', name: '淘宝',
    homeUrl: 'https://myseller.taobao.com/',
    domains: ['taobao.com', 'tmall.com', 'alipay.com'],
    loginHosts: ['loginmyseller.taobao.com', 'login.taobao.com'],
  },
  {
    id: 'tmall', name: '天猫',
    homeUrl: 'https://myseller.taobao.com/',
    domains: ['taobao.com', 'tmall.com', 'alipay.com'],
    loginHosts: ['loginmyseller.taobao.com', 'login.taobao.com', 'login.tmall.com'],
  },
  {
    id: 'pinduoduo', name: '拼多多',
    homeUrl: 'https://mms.pinduoduo.com/',
    domains: ['pinduoduo.com'],
    loginHosts: [],
  },
  {
    id: '1688', name: '1688',
    homeUrl: 'https://work.1688.com/',
    domains: ['1688.com', 'taobao.com', 'alipay.com'],
    loginHosts: ['login.1688.com', 'login.taobao.com'],
  },
  {
    id: 'douyin', name: '抖店',
    homeUrl: 'https://fxg.jinritemai.com/ffa/mshop/homepage/index',
    domains: ['jinritemai.com', 'douyin.com'],
    loginHosts: ['sso.douyin.com', 'login.douyin.com'],
  },
];

// Buyer profiles have their own platform key so login, restore and backup always
// resolve the consumer portal, including when a merchant uses the same account.
const buyerHomes = {
  taobao:'https://i.taobao.com/my_taobao.htm',
  tmall:'https://www.tmall.com/',
  jd:'https://home.jd.com/',
  pinduoduo:'https://mobile.yangkeduo.com/personal.html',
  douyin:'https://www.douyin.com/user/self',
  '1688':'https://www.1688.com/',
  alibaba:'https://www.alibaba.com/',
};
export const buyerPlatforms = platforms.filter(p => Object.hasOwn(buyerHomes,p.id)).map(p => ({
  ...p, id:p.id+'-buyer', name:(p.id==='douyin'?'抖音':p.name)+'买家',
  accountType:'buyer', homeUrl:buyerHomes[p.id],
  loginUrl:p.id==='taobao'?'https://login.taobao.com/member/login.jhtml?redirectURL='+encodeURIComponent(buyerHomes.taobao):undefined,
  domains:p.id==='pinduoduo'?[...p.domains,'yangkeduo.com']:p.domains,
}));
platforms.push(...buyerPlatforms);

export function getPlatform(id = 'taobao') {
  const platform = platforms.find(item => item.id === id);
  if (!platform) throw new Error('请选择支持的平台');
  return platform;
}

export function validatePlatformUrl(raw, platformId = 'taobao') {
  const url = new URL(raw);
  const platform = getPlatform(platformId);
  const official = platform.domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !official)
    throw new Error(`仅允许打开${platform.name}账号对应的官方 HTTPS 页面`);
  return url.href;
}

export function isPlatformLogin(raw, platformId = 'taobao') {
  try {
    const url = new URL(validatePlatformUrl(raw, platformId));
    const platform = getPlatform(platformId);
    return platform.loginHosts.includes(url.hostname) ||
      /(?:^|\/)(?:login|login\.html|login\.htm|login\.jsp|signin)(?:\/|$)/i.test(url.pathname + '/' + url.hash.replace(/^#/, ''));
  } catch { return false; }
}
