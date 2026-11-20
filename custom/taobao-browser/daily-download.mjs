import fs from 'node:fs/promises';
import {importDaily,queryDaily} from './daily-store.mjs';
import {checkSecurityPrompt} from './security-verification.mjs';

const portal='https://sycm.taobao.com/portal/home.htm';
async function ready(page) {
  await page.locator('body').waitFor();
  await checkSecurityPrompt(page);
  if (new URL(page.url()).origin!=='https://sycm.taobao.com') throw Error('生意参谋要求重新登录或校验');
  if (page.url().includes('/no_permission') || await page.getByText(/没有该模块的访问权限|暂无权限|无访问权限/).first().isVisible())
    throw Error('生意参谋拒绝访问：请由主账号或超级管理员在子账号管理中授予经营统计及下载权限');
}
async function legacyDownload(page,panel,reportEntry) {
  if (!await panel.isVisible() && await reportEntry.isVisible()) await reportEntry.click();
  await ready(page);
  const period=page.getByText(/^(近|最近)\s*30\s*天$/).first();
  await period.waitFor({timeout:8000}).catch(()=>{throw Error('未找到经营统计的近30天选项，本次未下载');});
  await period.click();
  await ready(page);
  const buttons=page.getByRole('button',{name:/^(下载原表|下载数据|导出数据|导出报表|下载|导出)$/});
  const links=page.getByRole('link',{name:/^(下载原表|下载数据|导出数据|导出报表|下载|导出)$/});
  const controls=buttons.or(links).filter({visible:true});
  if(await controls.count()!==1) throw Error('未能定位唯一的核心日报下载入口，本次未导入');
  return controls;
}

function lastCompletedDays() {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const before=days=>new Date(Date.parse(today)-days*86400000).toISOString().slice(0,10);
  return {start:before(30),end:before(1)};
}

async function pickDay(frame,day) {
  const calendar=frame.locator('td[title][class*="in-view"]:visible');
  await calendar.first().waitFor({timeout:5000});
  const cells=frame.locator('td[title="'+day+'"][class*="in-view"]:visible');
  if (!await cells.count()) {
    const direction=day<await calendar.first().getAttribute('title') ? 'prev' : 'next';
    await frame.locator('button[class*="-'+direction+'-btn"]:visible').first().click({timeout:5000});
  }
  await cells.first().click({timeout:5000});
}

async function wizardDownload(page,entry,storeName,period) {
  const url=new URL(await entry.getAttribute('href'),page.url());
  if(url.origin!==new URL(portal).origin) throw Error('无法确认自助分析入口');
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
  await ready(page);
  await page.getByText('取数报表',{exact:true}).first().click({timeout:20000});
  const frame=page.frameLocator('iframe[src*="/lyone/auto_analysis/"]').first();
  const start=frame.getByPlaceholder('开始日期');
  await start.waitFor({timeout:25000});
  await frame.getByText(storeName,{exact:true}).first().waitFor({timeout:8000});
  for (const label of ['店铺','整体','分日','不自动更新']) {
    const radio=frame.getByRole('radio',{name:label,exact:true});
    await radio.check({timeout:5000});
  }
  for (const label of ['PC端','无线端']) {
    await frame.getByRole('checkbox',{name:label,exact:true}).uncheck({timeout:5000});
  }
  await frame.getByRole('checkbox',{name:'所有终端',exact:true}).check({timeout:5000});
  await start.click();
  await pickDay(frame,period.start);
  await pickDay(frame,period.end);
  if(await start.inputValue()!==period.start || await frame.getByPlaceholder('结束日期').inputValue()!==period.end)
    throw Error('页面所选日期与近30个完整自然日不一致');
  const title='店铺核心日报_'+period.start.replaceAll('-','')+'_'+period.end.replaceAll('-','');
  await frame.getByPlaceholder('输入报表名称').fill(title);
  await frame.getByText('生成报表',{exact:true}).click();
  const download=frame.getByText('下载报表',{exact:true});
  await download.waitFor({timeout:45000});
  return download;
}

export async function downloadDaily(page,root,storeId,storeName) {
  await page.goto(portal,{waitUntil:'domcontentloaded',timeout:25000});
  const entry=page.getByRole('link',{name:'自助分析',exact:true}).first();
  const reportEntry=page.getByText(/^(店铺经营统计|经营统计|店铺经营分析|核心日报)$/).first();
  const panel=page.getByText(/^(店铺核心指标|经营核心指标|核心指标)$/).first();
  const denial=page.getByText(/没有该模块的访问权限|暂无权限|无访问权限/).first();
  await Promise.any([entry,panel,reportEntry,denial].map(e=>e.waitFor({timeout:10000}))).catch(()=>{});
  await ready(page);
  const namedShop=page.getByText(storeName,{exact:true}).or(page.getByTitle(storeName,{exact:true})).filter({visible:true});
  if(!storeName || !await namedShop.count()) throw Error('生意参谋页面未显示所绑定的店铺名称，已停止归属原表');
  const period=await entry.isVisible() ? lastCompletedDays() : undefined;
  const control=period ? await wizardDownload(page,entry,storeName,period) : await legacyDownload(page,panel,reportEntry);
  await ready(page);
  const [file]=await Promise.all([page.waitForEvent('download',{timeout:30000}),control.click()]);
  const temp=await file.path();
  if(!temp || (await fs.stat(temp)).size>20*1024*1024) throw Error('生意参谋未生成可用的日报文件');
  await ready(page);
  await importDaily(root,storeId,await fs.readFile(temp),file.suggestedFilename(),'official-browser-download',{storeName,period});
  return queryDaily(root,storeId);
}
