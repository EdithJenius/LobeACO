import wholesale1688Icon from './platformIcons/1688.png';
import alibabaIcon from './platformIcons/alibaba.svg?url';
import douyinIcon from './platformIcons/douyin.png';
import jdIcon from './platformIcons/jd.png';
import pinduoduoIcon from './platformIcons/pinduoduo.png';
import taobaoIcon from './platformIcons/taobao.png';
import tmallIcon from './platformIcons/tmall.png';
import wechatShopIcon from './platformIcons/wechat-shop.svg?url';

export const shopPlatforms = [
  { id: 'taobao', name: '淘宝', icon: taobaoIcon },
  { id: 'tmall', name: '天猫', icon: tmallIcon },
  { id: 'pinduoduo', name: '拼多多', icon: pinduoduoIcon },
  { id: 'douyin', name: '抖店', icon: douyinIcon },
  { id: 'jd', name: '京东', icon: jdIcon },
  { id: 'alibaba', name: 'Alibaba.com', icon: alibabaIcon },
  { id: '1688', name: '1688', icon: wholesale1688Icon },
  { id: 'wechat-shop', name: '微信小店', icon: wechatShopIcon },
];

export const buyerPlatforms = shopPlatforms.filter((p) => p.id !== 'wechat-shop').map((p) => ({
  ...p, id: p.id + '-buyer', name: p.id === 'douyin' ? '抖音' : p.name,
}));
export const accountPlatforms = [...shopPlatforms, ...buyerPlatforms];
