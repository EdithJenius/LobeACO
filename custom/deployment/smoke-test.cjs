const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const base = 'http://localhost:3210';
const results = [];
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, passed: true, detail }); console.log(`PASS ${name}: ${detail}`); }
  catch (e) { results.push({ name, passed: false, detail: e.message }); console.error(`FAIL ${name}: ${e.message}`); }
}
function assert(value, message) { if (!value) throw new Error(message); }
let cookies;
async function request(path, body) {
  return fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookies ? { Cookie: cookies } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
}
async function main() {
  await check('首页 HTTP', async () => {
    const r = await request('/'); const html = await r.text();
    assert(r.ok && html.includes('Lobe'), `HTTP ${r.status}, missing LobeHub HTML`);
    return `HTTP ${r.status}; ${html.length} characters`;
  });
  await check('PostgreSQL', async () => {
    const out = execFileSync('docker', ['compose','exec','-T','postgresql','psql','-U','postgres','-d','lobechat','-tAc', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"], { encoding:'utf8' }).trim();
    assert(Number(out) > 20, `Only ${out} tables`); return `${out} application tables`;
  });
  await check('Redis', async () => {
    const out = execFileSync('docker', ['compose','exec','-T','redis','redis-cli','ping'], {encoding:'utf8'}).trim();
    assert(out === 'PONG', out); return out;
  });
  await check('Agent 网关', async () => {
    const r = await fetch('http://localhost:8787/health');
    assert(r.ok && (await r.text()) === 'OK', `HTTP ${r.status}`); return 'HTTP 200 OK';
  });
  await check('对象存储', async () => {
    const r = await fetch('http://localhost:9000/health'); assert(r.ok, `HTTP ${r.status}`); return `HTTP ${r.status}`;
  });
  await check('文件写入 / 读取 / 清理', async () => {
    const script = 'rc alias set rustfs http://rustfs:9000 "$RUSTFS_ACCESS_KEY" "$RUSTFS_SECRET_KEY" >/dev/null; printf "lobehub-storage-smoke" > /tmp/smoke.txt; rc cp /tmp/smoke.txt rustfs/lobe/deployment-smoke-test.txt >/dev/null; rc cat rustfs/lobe/deployment-smoke-test.txt; rc rm rustfs/lobe/deployment-smoke-test.txt >/dev/null';
    const out = execFileSync('docker', ['compose','run','--rm','--no-deps','--entrypoint','/bin/sh','rustfs-init','-ec',script], {encoding:'utf8',timeout:60000});
    assert(out.includes('lobehub-storage-smoke'), 'S3 round-trip content mismatch');
    return 'S3 object write/read matched; temporary object removed';
  });
  await check('注册 / 登录', async () => {
    const exists = fs.existsSync('test-account.json');
    const account = exists ? JSON.parse(fs.readFileSync('test-account.json','utf8')) : { name:'Local deployment test', email:'deployment-test@example.test', password:crypto.randomBytes(18).toString('base64url') };
    if (!exists) fs.writeFileSync('test-account.json', JSON.stringify(account, null, 2));
    const r = await request(exists ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email', account);
    const data = await r.json();
    assert(r.ok && data.user?.email === account.email, `HTTP ${r.status}: ${data.message || data.code || 'No user returned'}`);
    cookies = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert(cookies, 'No session cookie'); return exists ? 'Existing test account login succeeded' : 'Test account registration succeeded';
  });
  await check('登录会话', async () => {
    assert(cookies, 'Login did not establish a session');
    const r = await request('/api/auth/get-session'); const data = await r.json();
    assert(r.ok && data?.user?.email === 'deployment-test@example.test', `HTTP ${r.status}; no authenticated user`);
    return 'Authenticated session round-trip succeeded';
  });
  await check('联网搜索', async () => {
    const code = 'fetch("http://searxng:8080/search?q=LobeHub&format=json",{signal:AbortSignal.timeout(45000)}).then(async r=>{const d=await r.json();console.log(JSON.stringify({status:r.status,results:d.results?.length,failedEngines:d.unresponsive_engines}));if(!r.ok||!d.results?.length)process.exitCode=1}).catch(e=>{console.error(e.message);process.exitCode=1})';
    return execFileSync('docker',['compose','exec','-T','lobe','node','-e',code],{encoding:'utf8',timeout:50000}).trim();
  });
  fs.writeFileSync('test-results.json', JSON.stringify({ testedAt:new Date().toISOString(), base, results, limitations:['Real model inference requires a configured provider API key.', 'QStash-dependent background workflows are not configured.', 'Some external search engines may rate-limit requests or require CAPTCHA.'] }, null, 2));
  if (results.some(r=>!r.passed)) process.exitCode = 1;
}
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
