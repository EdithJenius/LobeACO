import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {accounts} from './core.mjs';
import {getPlatform} from './platforms.mjs';
const LIMIT=64*1024*1024;
const ignored=new Set(['Cache','Code Cache','GPUCache','DawnCache','ShaderCache','GrShaderCache','Crashpad','SingletonLock','SingletonCookie','SingletonSocket','LOCK']);
function passwordCheck(p){if(typeof p!=='string'||p.length<12||p.length>1024)throw Error('备份密码至少 12 个字符，最多 1024 个字符');}
export function seal(data,password){passwordCheck(password);const salt=randomBytes(16),iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',scryptSync(password,salt,32),iv);const packed=gzipSync(Buffer.from(JSON.stringify(data)));return Buffer.concat([Buffer.from('TBP1'),salt,iv,cipher.update(packed),cipher.final(),cipher.getAuthTag()]);}
export function unseal(bytes,password){passwordCheck(password);if(bytes.length<48||bytes.length>LIMIT||bytes.subarray(0,4).toString()!=='TBP1')throw Error('无效或过大的备份');try{const dec=createDecipheriv('aes-256-gcm',scryptSync(password,bytes.subarray(4,20),32),bytes.subarray(20,32));dec.setAuthTag(bytes.subarray(-16));return JSON.parse(gunzipSync(Buffer.concat([dec.update(bytes.subarray(32,-16)),dec.final()]),{maxOutputLength:LIMIT}).toString());}catch{throw Error('密码错误、备份损坏或超出大小限制');}}
export function safeEntry(name){if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('备份包含不安全路径');return name;}
async function assertClosed(root){if(process.platform!=='win32')return;const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',"$n=@(Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($env:PROFILE_EXPORT_TARGET.ToLower()) }).Count; Write-Output $n"],{windowsHide:true,env:{...process.env,PROFILE_EXPORT_TARGET:path.resolve(root)},timeout:15000});if(Number(stdout.trim())>0)throw Error('该 Profile 仍有浏览器进程，请正常关闭对应窗口后重试');}
export class ProfileStore{
 constructor(manager){this.manager=manager;this.root=manager.root;this.items=[];}
 async init() {
  await fs.mkdir(this.root, {recursive:true});
  try {
   this.items = JSON.parse(await fs.readFile(path.join(this.root, 'profiles.json'), 'utf8'));
  } catch (error) {
   if (error.code !== 'ENOENT') throw error;
   this.items = ['taobao-a','taobao-b'].map((id, index) => ({id, name:`淘宝账号 ${index ? 'B' : 'A'}`, platform:'taobao', createdAt:new Date().toISOString()}));
  }
  if (!Array.isArray(this.items)) throw Error('Invalid profile registry');
  const ids = new Set();
  for (const item of this.items) {
   if (!/^(taobao-[ab]|shop-[a-f0-9-]{36})$/.test(item.id) || ids.has(item.id)) throw Error('Invalid profile registry');
   ids.add(item.id);
   item.platform = getPlatform(item.platform ?? 'taobao').id;
  }
  await this.save();
  for (const item of this.items) {
   if (!accounts.includes(item.id)) accounts.push(item.id);
   this.manager.registerProfile(item);
  }
 }
 async save(items = this.items) {
  const file = path.join(this.root, 'profiles.json');
  await fs.writeFile(file + '.tmp', JSON.stringify(items, null, 2));
  await fs.rename(file + '.tmp', file);
 }
 async create(name, platform = 'taobao') {
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw Error('请输入 1–80 字的账号名称');
  const item = {id:'shop-' + randomUUID(), name:name.trim(), platform:getPlatform(platform).id, createdAt:new Date().toISOString()};
  const directory = path.join(this.root, item.id);
  await fs.mkdir(directory);
  try { await this.save([...this.items, item]); }
  catch (error) { await fs.rmdir(directory).catch(()=>{}); throw error; }
  this.items.push(item);
  accounts.push(item.id);
  this.manager.registerProfile(item);
  return item;
 }
 async rename(id, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw Error('请输入 1–80 字的店铺名称');
  const index = this.items.findIndex(item => item.id === id);
  if (index === -1) throw Error('Unknown account');
  const updated = {...this.items[index], name:name.trim()};
  const next = this.items.map(item => item.id === id ? updated : item);
  await this.save(next);
  this.items = next;
  this.manager.registerProfile(updated);
  return updated;
 }
 async export(id,password){passwordCheck(password);return this.manager.run(id,async()=>{if(this.manager.manual.has(id))throw Error('请先关闭普通登录窗口');await this.manager.sessions.get(id)?.close();const dir=path.join(this.root,id);await assertClosed(dir);const files=[];let total=0;async function walk(base,rel=''){for(const e of await fs.readdir(base,{withFileTypes:true})){if(ignored.has(e.name))continue;if(e.isSymbolicLink())throw Error('Profile 包含链接，无法导出');const next=rel?rel+'/'+e.name:e.name;safeEntry(next);if(e.isDirectory())await walk(path.join(base,e.name),next);else if(e.isFile()){const stat=await fs.stat(path.join(base,e.name));total+=Math.ceil(stat.size*4/3)+next.length+64;if(total>LIMIT-65536)throw Error('Profile 超过原型 64MB 导出上限');files.push({path:next,data:(await fs.readFile(path.join(base,e.name))).toString('base64')});}}}await walk(dir);const item=this.items.find(p=>p.id===id);const blob=seal({version:1,engine:'playwright-chromium',platform:item.platform,name:item.name,createdAt:new Date().toISOString(),files},password);item.lastExportedAt=new Date().toISOString();await this.save();return {filename:id+'.tbprofile',data:blob.toString('base64')};});}
 async import(name,data,password){if(typeof data!=='string'||data.length>Math.ceil(LIMIT*4/3)+8)throw Error('备份过大');const archive=unseal(Buffer.from(data,'base64'),password);if(archive.version!==1||archive.engine!=='playwright-chromium'||!Array.isArray(archive.files)||archive.files.length>50000)throw Error('不支持的备份格式');const seen=new Set();for(const f of archive.files){safeEntry(f.path);if(typeof f.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))throw Error('无效的文件内容');const key=f.path.toLowerCase();if(seen.has(key))throw Error('备份包含重复路径');seen.add(key);}
 const platform=getPlatform(archive.platform ?? 'taobao').id;
 const item=await this.create(name||archive.name+'（恢复）',platform);try{for(const f of archive.files){const target=path.join(this.root,item.id,f.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(f.data,'base64'),{flag:'wx'});}item.restoredAt=new Date().toISOString();item.needsLoginCheck=true;await this.save();return item;}catch(e){item.restoreError=true;await this.save();throw Error('恢复未完成；源账号未变更，请勿打开标记为失败的恢复环境。');}}
}
