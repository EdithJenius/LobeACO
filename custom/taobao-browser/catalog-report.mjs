import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const directory=new URL('../analysis/taobao-chain/',import.meta.url);
const accounts=process.argv.slice(2);
if(!accounts.length || accounts.some(id=>!/^taobao-[ab]$|^shop-[a-f0-9-]{36}$/.test(id))) throw Error('请指定已盘点的店铺环境 ID');
const data=await Promise.all(accounts.map(id=>readFile(new URL(id+'-页面请求.json',directory),'utf8').then(JSON.parse)));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千牛店铺页面与请求目录</title>
<style>*{box-sizing:border-box}body{font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#f7f8fa;color:#1f2935}main{max-width:1320px;margin:auto;padding:28px}h1{margin:0 0 8px;font-size:26px}h2{font-size:19px}section{background:#fff;border:1px solid #dce2df;border-radius:12px;padding:16px 18px;margin:14px 0}p{margin:5px 0 12px;color:#50605c}label{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;margin:2px 16px 8px 0}select,input{font:inherit;border:1px solid #b8c5c0;border-radius:6px;background:white;padding:4px 8px;max-width:100%}summary{cursor:pointer;padding:8px 0;font-weight:600}details details{margin-left:12px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e7ece9;overflow-wrap:anywhere}th{background:#f3f7f5}small{color:#576761}article{margin:6px 0}code{overflow-wrap:anywhere}strong{color:#196348}@media(max-width:640px){main{padding:12px}section{padding:10px}label{display:flex;margin-right:0}}</style>
<main><h1>千牛店铺页面与请求目录</h1><p>记录实际导航入口、正常打开页面时观测到的请求和页面可见字段。相同请求可能被多个页面共用，页面与字段之间的接口归属仍需单独验证。</p>
<section><label>店铺<select id="store"></select></label><label>模块<select id="area"></select></label><label>查询<input id="search" placeholder="页面、字段、接口路径"></label><div id="stats"></div></section><section id="finance"></section><section><h2>页面目录</h2><div id="pages"></div></section></main>
<script type="application/json" id="catalog">${JSON.stringify(data).replaceAll('<','\\u003c')}</script>
<script>
const data=JSON.parse(document.querySelector('#catalog').textContent),q=id=>document.getElementById(id);
const el=(name,txt)=>{const n=document.createElement(name);if(txt!==undefined)n.textContent=txt;return n};
const table=(headers,rows)=>{const t=el('table'),h=el('tr');for(const s of headers)h.append(el('th',s));t.append(h);for(const row of rows){const r=el('tr');for(const v of row)r.append(el('td',v??'未读到'));t.append(r)}return t};
for(const [i,s] of data.entries())q('store').add(new Option(s.store,i));
function areas(){q('area').replaceChildren(new Option('全部',''));for(const s of new Set(data[q('store').value].pages.map(x=>x.section)))q('area').add(new Option(s,s));render()}
function render(){const shop=data[q('store').value], filter=q('search').value.trim().toLowerCase();
const pages=shop.pages.filter(p=>(!q('area').value||p.section===q('area').value)&&(!filter||JSON.stringify(p).toLowerCase().includes(filter)));
q('stats').textContent='导航入口 '+shop.pages.length+' 个 · 实际打开 '+shop.pages.filter(x=>x.requests).length+' 页 · 当前筛选 '+pages.length+' 个 · 盘点结束 '+new Date(shop.completedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'（北京时间）';
const f=shop.pages.find(p=>p.finance);q('finance').replaceChildren();if(f){const d=el('details');d.append(el('summary','财务总览 · 查看账户和统计周期'),el('p','观察时间 '+new Date(f.capturedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'（北京时间）。缺失值显示为“未读到”。'));const rows=[];
for(const [group,metrics] of Object.entries(f.finance))for(const [label,v] of Object.entries(metrics)){if(label==='period')continue;if(v && typeof v==='object'){for(const [k,n] of Object.entries(v))rows.push([group,metrics.period??'实时',label+' / '+k,n])}else rows.push([group,Object.hasOwn(metrics,'period')?(metrics.period??'周期未读到'):'实时',label,v]);}
d.append(table(['模块','页面统计周期','指标','页面值'],rows));q('finance').append(d);}
q('pages').replaceChildren();for(const p of pages){const d=el('details');d.append(el('summary',p.section+' / '+p.name+' · '+(p.status||'重复入口')+' · '+(p.requests?.length??0)+' 类请求'),el('code',p.route));if(p.capturedAt)d.append(el('p','观察时间 '+new Date(p.capturedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'（北京时间）'));if(p.columns?.length)d.append(el('p','可见列名：'+p.columns.join('、')));if(p.requests?.length)d.append(table(['方法','主机','路径 / API','HTTP','次数'],p.requests.map(r=>[r.method,r.host,r.path+(r.api?' · '+r.api:''),r.status,r.count])));q('pages').append(d);}}
q('store').onchange=areas;q('search').oninput=render;q('area').onchange=render;areas();</script></html>`;
const target=new URL('千牛页面与请求目录.html',directory);
await writeFile(target,html);console.log(fileURLToPath(target));
