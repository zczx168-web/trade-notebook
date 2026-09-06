const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { initialize, readState, issue } = require('./issuer-lib.cjs');
function startAdmin({ directory, port = 0, trustedKey } = {}) {
  const store = initialize(directory);
  if (!trustedKey) {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'site', 'license-key.js'), 'utf8'), context);
    trustedKey = context.window.TRADE_LICENSE_PUBLIC_KEY;
  }
  if (trustedKey?.x !== store.publicKey.x || trustedKey?.y !== store.publicKey.y) throw new Error('本机私钥与网站公钥不匹配，请恢复原签发私钥');
  const bootstrapToken = crypto.randomBytes(32).toString('hex');
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  let lastActive = 0;
  const uiRoot = path.join(__dirname, '..', 'admin');
  let origin;
  const server = http.createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" };
    const send = (status, value) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== origin.slice(7)) return send(403, { error: '仅允许本机访问' });
    let url;
    try { url = new URL(req.url, origin); } catch { return send(400, { error: '请求地址无效' }); }
    if (req.method === 'GET' && url.pathname === '/start/' + bootstrapToken) {
      lastActive = Date.now();
      res.writeHead(303, { ...headers, Location: '/', 'Set-Cookie': `tn_issuer=${sessionToken}; HttpOnly; SameSite=Strict; Path=/` });
      return res.end();
    }
    if (Date.now() - lastActive > 30 * 60 * 1000 || !(req.headers.cookie || '').split(';').some(cookie => cookie.trim() === 'tn_issuer=' + sessionToken)) return send(401, { error: '会话已过期，请从本机“会员开通工具”重新启动' });
    lastActive = Date.now();
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, { csrf, records: readState(store.directory).records.slice(-100).reverse() });
      if (req.method === 'POST' && url.pathname === '/api/issue') {
        if (req.headers.origin !== origin || req.headers['x-csrf-token'] !== csrf || !(req.headers['content-type'] || '').startsWith('application/json')) return send(403, { error: '请求来源验证失败' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 10000) { send(413, { error: '请求过大' }); req.destroy(); return; } }
        return send(200, issue(store, JSON.parse(body)));
      }
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'], '/admin.css': ['admin.css', 'text/css; charset=utf-8'], '/icons.js': ['../site/vendor/lucide.js', 'text/javascript'] };
      if (req.method === 'GET' && files[url.pathname]) {
        const [file, type] = files[url.pathname];
        res.writeHead(200, { ...headers, 'Content-Type': type });
        return res.end(fs.readFileSync(path.join(uiRoot, file)));
      }
      send(404, { error: '未找到页面' });
    } catch (error) { send(400, { error: error.message || '签发失败' }); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, url: origin + '/start/' + bootstrapToken, origin, directory: store.directory });
    });
  });
}
module.exports = { startAdmin };
if (require.main === module) startAdmin().then(info => {
  const runtime = { pid: process.pid, url: info.url };
  fs.writeFileSync(path.join(info.directory, 'issuer-runtime.json'), JSON.stringify(runtime), { mode: 0o600 });
  console.log('Issuer started on loopback. The local launcher can open it.');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
