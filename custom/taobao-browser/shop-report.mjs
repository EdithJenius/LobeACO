import {readFinance} from './finance-view.mjs';

const origin = 'https://myseller.taobao.com';
export const shopReports = {
  products: {name:'我的商品', path:'/home.htm/SellManage/on_sale', key:'商品名称',
    fields:['商品名称','价格','库存','累计销量','30日销量','质量分']},
  quality: {name:'商品质量分', path:'/home.htm/item-diagnose-manage/', key:'商品信息',
    fields:['商品信息','30日销量','30日访客数','质量分']},
  finance: {name:'财务总览', path:'/home.htm/whale-accountant/index'},
};

// Runs inside the selected official page. Return business fields only, never the full DOM.
export function visibleReport(spec) {
  const visible = el => el.getClientRects().length > 0;
  const body = document.body.innerText;
  if (/没有权限访问|无访问权限|暂无权限|当前账号无权限|您没有权限/.test(body)) return {error:'该店铺账号没有此页面的访问权限'};
  if (!spec.key) {
    if (!body.includes('销售收支统计') || !body.includes('收支构成') ||
        !/(?:欠费金额|可提现余额|收入金额|总金额)\(元\)\s*\n\s*-?[\d,]+(?:\.\d+)?(?:\n|$)/.test(body)) return null;
    return {financeText:body};
  }
  const cells = tr => Array.from(tr.cells, cell => cell.innerText.trim());
  const tables = [...document.querySelectorAll('table')].filter(visible);
  for (const table of tables) {
    const header = [...table.querySelectorAll('thead tr')].map(cells).find(row => row.includes(spec.key));
    if (!header || !header.includes('质量分')) continue;
    // Some grids render the header and the body as adjacent tables.
    const next = tables[tables.indexOf(table) + 1];
    const grid = table.tBodies[0]?.rows.length ? table : next && !next.tHead ? next : null;
    const rows = [];
    for (const tr of grid?.tBodies[0]?.rows ?? []) {
      if (!visible(tr) || tr.cells.length !== header.length || [...tr.cells].some(td => td.colSpan !== 1)) continue;
      const values = cells(tr);
      if (!values[header.indexOf(spec.key)]) continue;
      const row = Object.fromEntries(spec.fields.map(key => {
        const value = values[header.indexOf(key)];
        return [key, value && !/^(?:--|—|-)$/.test(value) ? value.slice(0,350) : null];
      }));
      rows.push(row);
      if (rows.length === 20) break;
    }
    if (rows.length) return {rows};
    if (/暂无(?:相关)?(?:商品|数据)|没有符合条件的商品/.test((grid ?? table).parentElement.innerText)) return {rows:[]};
  }
  return null;
}

export async function readShopReport(page, kind) {
  if (!Object.hasOwn(shopReports,kind)) throw Error('未知淘宝报表');
  const spec = shopReports[kind];
  const url = origin + spec.path;
  const response = await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  if (response?.status() >= 400) throw Error('后台报表返回 HTTP '+response.status());
  const checkLocation = () => {
    const actual = new URL(page.url());
    if (actual.origin !== origin || actual.pathname.replace(/\/$/,'') !== spec.path.replace(/\/$/,'')) {
      throw Error('店铺后台发生跳转，请检查登录状态和访问权限');
    }
  };
  checkLocation();
  const handle = await page.waitForFunction(visibleReport,spec,{timeout:16000}).catch(() => {
    throw Error('未能读取已知报表结构或明确的空列表，请检查页面和权限');
  });
  let data;
  try { data = await handle.jsonValue(); } finally { await handle.dispose(); }
  checkLocation();
  if (data.error) throw Error(data.error);
  const meta = {kind,name:spec.name,sourceUrl:url,capturedAt:new Date().toISOString()};
  if (kind !== 'finance') return {...meta,scope:'当前列表页，最多20行；不代表全店或全部分页',rows:data.rows};
  const sections = readFinance(data.financeText);
  if (!Object.values(sections).some(group => Object.entries(group).some(([key,value]) =>
    key !== 'period' && typeof value === 'string' && /\d/.test(value)))) throw Error('尚未读到财务金额，未生成快照');
  return {...meta,scope:'千牛财务总览；按各分区返回的账期解读，缺失字段为 null',sections};
}
