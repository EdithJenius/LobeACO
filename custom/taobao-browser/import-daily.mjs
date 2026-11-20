// Local operator supplies the original official workbook and explicitly selects its bound store.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {importDaily} from './daily-store.mjs';

const [account,filename]=process.argv.slice(2);
if(!account || !filename) throw Error('用法：node import-daily.mjs <店铺环境 ID> <生意参谋原表路径>');
const runtime=process.env.TAOBAO_BROWSER_RUNTIME || fileURLToPath(new URL('./runtime/',import.meta.url));
const {port,token}=JSON.parse(await fs.readFile(path.join(runtime,'connection.json'),'utf8'));
const response=await fetch('http://127.0.0.1:'+port+'/collections',{method:'POST',
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'check',account})});
const run=await response.json();
if(!response.ok || run.account!==account || run.status!=='completed' || !run.storeId) throw Error(run.error || '店铺身份未确认');
if((await fs.stat(filename)).size>20*1024*1024) throw Error('原表超过20 MB');
console.log(await importDaily(path.join(runtime,'sycm-daily'),run.storeId,await fs.readFile(filename),path.basename(filename),'merchant-supplied',{storeName:run.storeName}));
