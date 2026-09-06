const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', 'site');
function scan(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    assert.ok(!item.isSymbolicLink(), 'Public files must not be symlinks');
    if (item.isDirectory()) { scan(file); continue; }
    assert.ok(!/\.pem$|^\.env|issuer-(state|runtime)|^issue\.lock$/.test(item.name), 'Private issuer material must not be published');
    if (/\.(js|html|json|txt)$/.test(file)) {
      const text = fs.readFileSync(file, 'utf8');
      assert.ok(!/-----BEGIN (?:EC |RSA |ENCRYPTED )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(text), 'Possible secret in public assets');
    }
  }
}
scan(root);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /http-equiv="Content-Security-Policy"/);
assert.match(html, /script-src 'self';/);
assert.match(html, /connect-src 'none';/);
assert.ok(!/<script[^>]*src="https?:/i.test(html), 'Production scripts must be vendored');
const crypto = require('node:crypto');
const pairs = [['decimal.js/decimal.js', 'decimal.js'], ['chart.js/dist/chart.umd.js', 'chart.umd.js'], ['lucide/dist/umd/lucide.js', 'lucide.js']];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file).toString().replace(/\r\n/g, '\n')).digest('hex');
for (const [dependency, vendor] of pairs) assert.equal(hash(path.join(root, 'vendor', vendor)), hash(path.join(root, '..', 'node_modules', dependency)), 'Vendored dependency differs from lockfile installation');
console.log('PASS: public asset secret checks, CSP, local dependencies and vendor integrity.');
