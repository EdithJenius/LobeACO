import { checkSecurityPrompt } from './security-verification.mjs';
import { trackTaskPage, closeTaskPage, closeShopContext } from './page-cleanup.mjs';
import { isPlatformLogin } from './platforms.mjs';

// Only return the business fields used for binding. Account pages can also contain masked IDs.
export function extractAccountField(kind) {
  const lines=document.body.innerText.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const labelValues=(label,from=0)=>{
    const values=[];
    const inline=new RegExp('^'+label+'(?:\\s*[:：]\\s*|\\s+)(.+)$');
    const alone=new RegExp('^'+label+'[:：]?$');
    for(let i=from;i<lines.length;i++){
      const match=lines[i].match(inline);
      if(match)values.push(match[1].trim());
      else if(alone.test(lines[i]) && lines[i+1])values.push(lines[i+1].replace(/^[:：]\s*/,'').trim());
    }
    return [...new Set(values)];
  };
  if(kind==='remark'){
    const start=lines.lastIndexOf('账号信息');
    if(start<0)return null;
    const values=labelValues('姓名',start+1);
    const value=values.length===1 && values[0];
    return value && !/身份证|账号名称|姓名|^[-—]+$/.test(value) && value.length<=80 ? value : null;
  }
  const ids=labelValues('店铺\\s*ID');
  const id=ids.length===1 && ids[0];
  if(!/^\d{1,32}$/.test(id||''))return null;
  const names=labelValues('店铺名(?:称)?');
  if(names.length>1)return null;
  let name=names[0];
  if(!name){
    const edit=lines.findIndex((v,i)=>v==='修改信息' && lines[i+1]?.startsWith('淘宝账号名'));
    if(edit>0 && lines.slice(0,edit-1).includes('店铺信息'))name=lines[edit-1];
  }
  return name && name.length<=100 && !/^(修改信息|店铺信息|淘宝账号名|店铺ID|[-—]+)$/.test(name) ? {storeId:id,storeName:name} : null;
}

const origin='https://myseller.taobao.com';
export const centerUrl=origin+'/home.htm/shop-manage/shop-center';
const tmallCenterUrl=origin+'/home.htm/tm-shop-info-manage/';
const subUrl=origin+'/home.htm/Subaccount/';

export function extractTmallIdentity() {
  const ids=new Set(), names=new Set();
  const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility==='visible';
  for(const row of document.querySelectorAll('.next-form-item')) {
    const label=row.querySelector('.next-form-item-label label');
    if(!label || !visible(label))continue;
    const field=label.innerText.replace(/\s+/g,'').replace(/[:：]$/,'');
    if(field!=='店铺名称' && field!=='店铺ID')continue;
    for(const input of row.querySelectorAll('.next-form-item-control input:disabled, .next-form-item-control input[readonly]')) {
      if(!visible(input))continue;
      const value=input.value.trim();
      if(value)(field==='店铺ID'?ids:names).add(value);
    }
  }
  const [storeId]=ids, [storeName]=names;
  if(ids.size!==1 || names.size!==1 || !/^\d{1,32}$/.test(storeId) ||
      storeName.length>100 || /^[-—.…\s]+$/u.test(storeName))return null;
  return {storeId,storeName};
}

export async function readIdentityField(page,kind,platform='taobao') {
  const tmallIdentity=kind==='identity' && platform==='tmall';
  const url=kind==='remark'?subUrl:tmallIdentity?tmallCenterUrl:centerUrl;
  const duration=kind==='remark'?7500:14000;
  let deadline=Date.now()+duration;
  await page.goto(url,{waitUntil:'commit',timeout:deadline-Date.now()});
  do {
    if(page.isClosed?.())throw Error('核验页面已关闭');
    if(await checkSecurityPrompt(page)){
      deadline=Date.now()+duration;
      if(new URL(page.url()).pathname!==new URL(url).pathname)await page.goto(url,{waitUntil:'commit',timeout:duration});
    }
    const outer=new URL(page.url());
    if(isPlatformLogin(outer.href,platform)) {
      throw Object.assign(Error('千牛要求重新登录'),{expired:true});
    }
    const route=outer.pathname.replace(/\/$/,'');
    const expected=route===new URL(url).pathname.replace(/\/$/,'') || (kind==='remark' && route==='/home.htm/Subaccount/sub/myself');
    if(outer.origin===origin && expected){
      for(const frame of page.frames()){
        const match=frame.url().match(/^https:\/\/([^/?#]+)/);
        if(!match || !(/^(?:[a-z0-9-]+\.)*taobao\.com$/i.test(match[1]) ||
          (platform==='tmall' && /^(?:[a-z0-9-]+\.)*tmall\.com$/i.test(match[1])))) continue;
        const value=await frame.evaluate(tmallIdentity?extractTmallIdentity:extractAccountField,kind).catch(()=>null);
        if(value)return value;
      }
    }
    await new Promise(resolve=>setTimeout(resolve,180));
  }while(Date.now()<deadline);
  if(kind==='remark')return null;
  if(tmallIdentity)throw Error('未能从天猫「店铺基本信息」确认唯一的店铺名称和店铺ID，请检查该页是否可访问');
  throw Error('未能在千牛「店铺信息」读取唯一店铺 ID 和店名，请检查该账号的店铺信息权限后重试');
}

export function verifyTmall(manager,account,binding) {
  return verifyTaobao(manager,account,binding,'tmall');
}

export async function verifyTaobao(manager,account,binding,platform='taobao') {
  const owned=!manager.sessions?.has(account);
  const context=await manager.context(account,{background:true});
  const pages=[];
  try {
    const shopPage=trackTaskPage(await context.newPage());
    pages.push(shopPage);
    const notePage=trackTaskPage(await context.newPage());
    pages.push(notePage);
    const identity=await readIdentityField(shopPage,'identity',platform);
    if(binding.storeId && identity.storeId!==binding.storeId)throw Error('此登录环境的店铺ID已改变，请新建店铺环境进行绑定');
    if(!binding.storeId && binding.storeName && identity.storeName!==binding.storeName)throw Error('此登录环境的店铺名称与原绑定不一致');
    const accountName=await readIdentityField(notePage,'remark',platform).catch(()=>null);
    return {...identity,accountName};
  } finally {
    if(owned && manager.sessions?.get(account)===context) await closeShopContext(context);
    else await Promise.all(pages.map(closeTaskPage));
  }
}
