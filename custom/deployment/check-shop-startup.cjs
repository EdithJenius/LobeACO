// Run inside checkout-spa so the probe uses the same mount and host as the shop bridge.
const fs = require('node:fs/promises');
const http = require('node:http');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(options.path + ' returned HTTP ' + res.statusCode));
        try { resolve(JSON.parse(data)); } catch { reject(new Error(options.path + ' returned invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(options.path + ' timed out')));
    req.end(body);
  });
}

async function main() {
  const port = Number(process.env.LOBE_LOCAL_WEB_PORT || 3210);
  await request({ host: '127.0.0.1', port, path: '/api/auth/get-session', headers: { host: 'localhost:' + port } });
  const file = process.env.LOBE_SHOP_CONNECTION || '/shop-runtime/connection.json';
  const connection = JSON.parse(await fs.readFile(file, 'utf8'));
  const list = await request({
    host: process.env.LOBE_SHOP_HOST || 'host.docker.internal',
    port: connection.port,
    path: '/collections',
    method: 'POST',
    headers: { host: '127.0.0.1:' + connection.port, authorization: 'Bearer ' + connection.token, 'content-type': 'application/json' },
  }, JSON.stringify({ action: 'list' }));
  if (!Array.isArray(list?.shops)) throw new Error('Shop manager returned no shop list');
  console.log('Shop manager reachable from LobeHub. Bound accounts: ' + list.shops.length);
}

main().catch((error) => { console.error('Startup check: ' + error.message); process.exitCode = 1; });
