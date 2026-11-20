const shopBridge = require('./shop-bridge.cjs');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const desktop = process.env.LOBE_LOCAL_DESKTOP_BUILD || path.resolve(__dirname, '../../dist/desktop');
const mobile = process.env.LOBE_LOCAL_MOBILE_BUILD || path.resolve(__dirname, '../../dist/mobile');
const desktopTemplate = fs.readFileSync(path.join(desktop, 'index.html'), 'utf8');
const mobileTemplate = fs.existsSync(path.join(mobile, 'index.mobile.html'))
  ? fs.readFileSync(path.join(mobile, 'index.mobile.html'), 'utf8')
  : undefined;
const frontendPort = +(process.env.LOBE_LOCAL_WEB_PORT || 3210);
const backendPort = +(process.env.LOBE_LOCAL_BACKEND_PORT || 3212);
const backendHost = process.env.LOBE_LOCAL_BACKEND_HOST || '127.0.0.1';
const frontendHost = process.env.LOBE_LOCAL_WEB_HOST || '127.0.0.1';
const base = '/_spa/';
const mime = {
  '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.mjs': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const isExpertDocument = /^\/(?:[a-zA-Z0-9_-]+\/)?(?:experts|stores)\/?$/;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if(pathname === '/api/local-shops') return void shopBridge(req,res,{backendHost,backendPort,frontendPort});
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith(base)) {
    const relative = '.' + pathname.slice(base.length - 1);
    const file = [desktop, mobile].map(directory => path.resolve(directory, relative)).find(
      (candidate, index) => candidate.startsWith([desktop, mobile][index] + path.sep) && fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
    );
    if (file) {
      res.writeHead(200, {
        'cache-control': 'no-cache',
        'content-type': mime[path.extname(file)] || 'application/octet-stream',
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).pipe(res);
    }
  }

  const document = req.method === 'GET' && req.headers.accept?.includes('text/html');
  // The unchanged server handles login and provides server config. Its old route
  // table lacks /experts so resolve that document like its parent workspace.
  const upstreamPath = document && isExpertDocument.test(pathname)
    ? (pathname.replace(/(?:experts|stores)\/?$/, '') || '/') + url.search
    : req.url;
  const headers = { ...req.headers, ...(document && { 'accept-encoding': 'identity' }) };
  const upstream = http.request({ host: backendHost, port: backendPort, path: upstreamPath, method: req.method, headers }, response => {
    const received = response.headers;
    if (!document || response.statusCode !== 200 || !received['content-type']?.includes('text/html')) {
      res.writeHead(response.statusCode, received);
      return response.pipe(res);
    }
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const original = Buffer.concat(chunks);
      const html = original.toString('utf8');
      const config = html.match(/window\.__SERVER_CONFIG__\s*=\s*([^\n]+?);\s*<\/script>/);
      // Keep the original auth, onboarding and secondary product shells.
      const template = html.includes('/_spa/assets/index.mobile-') ? mobileTemplate
        : html.includes('/_spa/assets/index-') ? desktopTemplate : undefined;
      if (!config || !template) {
        res.writeHead(response.statusCode, received);
        return res.end(original);
      }
      const title = html.match(/<title>[^<]*<\/title>/)?.[0] || '';
      const page = template.replace('<!--SEO_META-->', title)
        .replace('<!--ANALYTICS_SCRIPTS-->', '')
        .replace(/window\.__SERVER_CONFIG__\s*=\s*undefined;\s*\/\*\s*SERVER_CONFIG\s*\*\//, () => 'window.__SERVER_CONFIG__ = ' + config[1] + ';');
      const output = { ...received, 'cache-control': 'no-cache', 'x-lobe-local-spa': 'checkout' };
      delete output['content-length'];
      delete output['content-encoding'];
      delete output.etag;
      res.writeHead(200, output);
      res.end(page);
    });
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('LobeHub backend unavailable');
  });
  req.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  const upstream = http.request({
    host: backendHost, port: backendPort, path: request.url,
    method: request.method, headers: request.headers,
  });
  upstream.on('upgrade', (response, backendSocket, backendHead) => {
    socket.write('HTTP/1.1 ' + response.statusCode + ' ' + response.statusMessage + '\r\n' +
      response.rawHeaders.reduce((lines, value, index) => lines + value + (index % 2 ? '\r\n' : ': '), '') + '\r\n');
    if (head.length) backendSocket.write(head);
    if (backendHead.length) socket.write(backendHead);
    socket.pipe(backendSocket).pipe(socket);
  });
  upstream.on('response', () => socket.destroy());
  upstream.on('error', () => socket.destroy());
  upstream.end();
});
server.listen(frontendPort, frontendHost, () => console.log('Local checkout SPA at http://localhost:' + frontendPort));

