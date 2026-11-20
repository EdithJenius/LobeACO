import {getPlatform, isPlatformLogin} from './platforms.mjs';

const pddBusiness=['成交金额','成交订单数','商品访客数','商品浏览量','推广花费'];
const pddTodos=['待付款','待打印','待发货','待收货','退款/售后','待处理工单','售后过期预警'];
export const hasPddBusiness = metrics => pddBusiness.some(field => metrics?.[field] != null);
export function pddOverview(run) {
  const values=fields=>Object.fromEntries(fields.filter(k=>run.metrics[k]!=null).map(k=>[k,run.metrics[k]]));
  return {kind:'pddOverview',name:'拼多多经营概览',sourceUrl:run.sourceUrl,capturedAt:run.finishedAt,
    scope:'拼多多商家工作台首页 · 采集时点快照',
    sections:{经营指标:values(pddBusiness),商家待办:values(pddTodos)}};
}
const dashboards = {
  'wechat-shop': {path:'/shop/home', fields:['待发货','物流异常','售后','服务保障','客诉工单','店铺预警','店铺违规']},
  jd: {path:'/jdm/home', fields:['近三月待发货','待打印订单','待回复催单','待审核售后','待收货售后','待处理售后','待回复纠纷','待确认结算单','待处理违约单']},
  pinduoduo: {path:'/home', fields:[...pddTodos,...pddBusiness]},
  douyin: {path:'/ffa/mshop/homepage/index', fields:['待支付','超时未发货','待发货','异常包裹','待处理售后','服务工单','待整改风险点','待处理违规','成交金额','成交订单数','成交人数','用户支付金额','客单价']},
};
export const hasSellerDashboard = platform => Object.hasOwn(dashboards,platform);

export function parseSellerDashboard(text,fields) {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const metrics={};
  for(const field of fields) {
    const values=new Set();
    for(let i=0;i<lines.length;i++) {
      if (lines[i]!==field) continue;
      let pos=i+1;
      if (lines[pos]==='急' && field==='超时未发货') pos++;
      const currency=lines[pos]==='¥' || lines[pos]==='￥';
      if(currency) pos++;
      const value=lines[pos];
      if(!value || !/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\+?$/.test(value)) continue;
      const unit=['万','亿','%'].includes(lines[pos+1]) ? lines[pos+1] : '';
      values.add((currency?'¥':'')+value+unit);
    }
    metrics[field]=values.size===1 ? [...values][0] : null;
  }
  return metrics;
}

export async function readSellerDashboard(page,platform) {
  const home=getPlatform(platform).homeUrl;
  const spec=dashboards[platform];
  await page.goto(home,{waitUntil:'commit',timeout:25000});
  const deadline=Date.now()+22000;
  let partial;
  do {
    const url=new URL(page.url());
    partial=undefined;
    if(isPlatformLogin(url.href,platform))throw Object.assign(Error('商家工作台要求重新登录'),{expired:true});
    if(url.origin===new URL(home).origin && url.pathname.replace(/\/$/,'')===spec.path) {
      // The WeChat homepage renders its dashboard inside an open micro-app shadow root.
      const text=platform==='wechat-shop'
        ? await page.getByText('待发货',{exact:true}).evaluateAll(elements=>elements
            .filter(el=>el.getClientRects().length && el.getRootNode().host?.tagName==='MICRO-APP')
            .map(el=>Array.from(el.getRootNode().children).map(child=>child.innerText||'').join('\n')).join('\n'))
        : await page.locator('body').innerText({timeout:3000});
      const metrics=parseSellerDashboard(text,spec.fields);
      if(platform==='pinduoduo' ? hasPddBusiness(metrics) : Object.values(metrics).some(value=>value!==null)) {
        partial = {metrics,sourceUrl:url.origin+url.pathname,scope:platform+'-home-current',
          note:'来源为商家工作台首页，按页面的当前待办和实时经营指标展示。各字段沿用平台原名，未读到的字段为空。'};
        if(platform!=='pinduoduo' || Object.values(metrics).every(value=>value!==null))return partial;
      }
    }
    await page.waitForTimeout(300);
  } while(Date.now()<deadline);
  if(partial && new URL(page.url()).origin+new URL(page.url()).pathname===partial.sourceUrl)return partial;
  throw Error('未取得可核对的商家首页指标，请检查登录、页面权限及数据加载状态');
}
