import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import * as XLSX from 'xlsx';
import {importDaily,queryDaily,parseDaily} from './daily-store.mjs';
import {downloadDaily} from './daily-download.mjs';

function workbook(base=10) {
  const lines=[['模拟原表，仅用于回归测试'],['日期','支付金额(元)','访客数','支付转化率']];
  for(let i=0;i<30;i++) {
    const day=new Date(Date.now()-(30-i)*86400000);
    lines.push([day.toISOString().slice(0,10),base+i,100+i,(5+i)/100]);
  }
  const sheet=XLSX.utils.aoa_to_sheet(lines);
  for(let i=3;i<=32;i++) sheet['D'+i].z='0.00%';
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'日报');
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
}

test('official UI download, immutable original, date upsert, replay, isolation and trace',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sycm-fixture-'));
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    const bytes=workbook();
    await page.route('https://sycm.taobao.com/**',route=>{
      return route.fulfill({contentType:'text/html; charset=utf-8',body:'<span>测试店</span><b>核心指标</b><button>近30天</button><a download="report.xlsx" href="data:application/octet-stream;base64,'+bytes.toString('base64')+'">下载数据</a>'});
    });
    await assert.rejects(downloadDaily(page,root,'100','另一家店'),/店铺名称/);
    const initial=await downloadDaily(page,root,'100','测试店');
    assert.equal(initial.rows.length,30);
    const hash=createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(await fs.readFile(initial.sources[hash].file),bytes);
    assert.deepEqual(initial.sources[hash].columns,['A','B','C','D']);
    assert.equal(initial.rows[0]['原表行'],'3');
    assert.equal(initial.rows.at(-1)['支付转化率(%)'],'34');
    assert.equal(initial.change.conversionPercentagePoints,29);
    const update=await importDaily(root,'100',workbook(20),'revision.xlsx');
    assert.equal((await importDaily(root,'100',bytes,'duplicate.xlsx')).repeated,true);
    const q=await queryDaily(root,'100');
    assert.equal(q.rows.length,30);
    assert.equal(q.rows[0]['支付金额(元)'],'20');
    assert.equal(q.rows[0]['原表SHA256'],update.hash);
    const archived=await queryDaily(root,'100',new Date('2050-01-01'),{snapshot:true});
    assert.deepEqual(archived.rows,q.rows);
    assert.equal(archived.period.end,q.rows.at(-1)['日期']);
    await assert.rejects(queryDaily(root,'200'),/尚无已入库/);
    await assert.rejects(queryDaily(root,'100',new Date('2050-01-01')),/近30天没有/);
  } finally {await browser.close();await fs.rm(root,{recursive:true,force:true});}
});

test('CSV distinguishes absent data, unit, store and duplicates',()=>{
  const csv='日期,支付金额,访客数,支付转化率,店铺ID\n2026-11-16,0,--,1.20%,100';
  const parse=s=>parseDaily(Buffer.from(s),'日报.csv','100');
  assert.deepEqual(parse(csv).rows[0],{date:'2026-11-16',row:2,gmv:0,uv:null,cvr:1.2});
  assert.throws(()=>parse(csv.replace('1.20%','0.012')),/单位/);
  assert.throws(()=>parse(csv.replace(',100\n',',200\n').replace(/100$/,'200')),/店铺ID/);
  assert.throws(()=>parse(csv+'\n'+csv.split('\n')[1]),/重复日期/);
});

test('self-analysis export must cover the selected shop and all requested dates',()=>{
  const period={start:'2026-10-19',end:'2026-11-17'};
  const records=Array.from({length:30},(_,i)=>{
    const day=new Date(Date.parse(period.start)+i*86400000).toISOString().slice(0,10);
    return day+',示例店,15.82,20,5%';
  });
  const parse=rows=>parseDaily(Buffer.from(['日期,店铺名称,支付金额,访客数,支付转化率',...rows].join('\n')),
    '取数.csv','100',{storeName:'示例店',period});
  assert.equal(parse([...records].reverse()).rows[0].row,31);
  assert.throws(()=>parse(records.slice(1)),/覆盖/);
  assert.throws(()=>parse([...records.slice(0,-1),records.at(-1).replace('示例店','另一店')]),/店铺名称/);
});
