const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Issuer = require('../scripts/issuer-lib.cjs');
const { startAdmin } = require('../scripts/license-admin.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const privateTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-activation-test-'));
const store = Issuer.initialize(privateTestDir);
function signClaims(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `TN1.${payload}.` + crypto.sign('sha256', Buffer.from('TN1.' + payload), { key: store.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
(async () => {
  let browser, siteServer, admin;
  try {
    let url = process.env.TEST_URL;
    if (!url) {
      const siteRoot = path.join(root, 'site');
      siteServer = http.createServer((req, res) => {
        try {
          const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
          const file = path.resolve(siteRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
          if (!file.startsWith(siteRoot + path.sep)) return res.writeHead(403).end();
          const data = fs.readFileSync(file);
          const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': type }); res.end(data);
        } catch { res.writeHead(404).end(); }
      });
      await new Promise(resolve => siteServer.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${siteServer.address().port}/`;
    }
    admin = await startAdmin({ directory: privateTestDir, trustedKey: store.publicKey });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 950 }, locale: 'zh-CN' });
    // A separate signing identity exercises activation without issuing real production memberships.
    await context.route('**/license-key.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.TRADE_LICENSE_PUBLIC_KEY=' + JSON.stringify(store.publicKey) + ';' }));
    const customer = await context.newPage(), errors = [];
    customer.on('pageerror', error => errors.push(error.message));
    const publicKeyResponse = await context.request.get(new URL('license-key.js?v=20260906-activation1', url).href);
    assert.equal((await publicKeyResponse.text()).replace(/\r\n/g, '\n'), fs.readFileSync(path.join(root, 'site/license-key.js'), 'utf8').replace(/\r\n/g, '\n'));
    await customer.goto(url);
    await customer.locator('#ownBook').click();
    await expect(customer.locator('#analyticsLocked')).toBeVisible();
    await customer.locator('#newTrade').click();
    await customer.locator('#tradeMode').selectOption('manual');
    await customer.locator('#tradeSymbol').fill('权限测试合约'); await customer.locator('#tradePnl').fill('-100');
    await customer.locator('#tradeForm button[type=submit]').click();
    await expect(customer.locator('#recentTable')).toContainText('权限测试合约');
    await customer.locator('#exportPdfBtn').click(); await expect(customer.locator('#vipModal')).toBeVisible();
    await customer.locator('#vipModal [data-open-activation]').click();
    const device = await customer.locator('#activationDialog [data-device-code]').innerText();
    assert.match(device, /^TN-[A-F0-9]{32}$/);
    await customer.locator('#activationToken').fill('TN1.invalid.invalid'); await customer.locator('#activateLicense').click();
    await expect(customer.locator('#activationError')).not.toBeEmpty();
    await expect(customer.locator('#memberStatus')).toHaveText('普通版');
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: 'zh-CN' });
    const owner = await ownerContext.newPage(); owner.on('pageerror', error => errors.push(error.message));
    await owner.goto(admin.url);
    await owner.locator('#device').fill(device); await owner.locator('#reference').fill('TEST-WECHAT-0001'); await owner.locator('#confirmed').check(); await owner.locator('#issueButton').click();
    await expect(owner.locator('#issuedStatus')).toHaveText('签发成功');
    const monthlyToken = await owner.locator('#token').inputValue();
    await owner.screenshot({ path: path.join(output, 'issuer-desktop.png'), fullPage: true });
    await owner.locator('#confirmed').check(); await owner.locator('#issueButton').click();
    await expect(owner.locator('#issuedStatus')).toContainText('未重复续期');
    assert.equal(await owner.locator('#token').inputValue(), monthlyToken);
    await customer.locator('#activationToken').fill(monthlyToken); await customer.locator('#activateLicense').click();
    await expect(customer.locator('#activationMessage')).toContainText('激活成功');
    await expect(customer.locator('#memberStatus')).toContainText('月度会员');
    await customer.locator('[data-close=activationDialog]').click();
    await expect(customer.locator('#analyticsContent')).toBeVisible();
    await customer.reload(); await expect(customer.locator('#memberStatus')).toContainText('月度会员');
    await expect(customer.locator('#analyticsLocked')).toBeHidden();
    await customer.locator('[data-view=review]').click(); await expect(customer.locator('#reviewContent')).toBeVisible();
    await customer.evaluate(() => { window.print = () => {}; }); await customer.locator('#exportPdfBtn').click();
    await expect(customer.locator('#printReport')).toContainText('权限测试合约');
    const claims = JSON.parse(Buffer.from(monthlyToken.split('.')[1], 'base64url'));
    const expired = signClaims({ ...claims, issuedAt: Date.now() - 60 * 86400000, expiresAt: Date.now() - 30 * 86400000 });
    await customer.evaluate(token => localStorage.setItem('trade_license_token_v1', token), expired); await customer.reload();
    await expect(customer.locator('#memberStatus')).toContainText('已到期'); await expect(customer.locator('#reviewLocked')).toBeVisible();
    await customer.locator('#reviewLocked [data-open-activation]').click();
    await customer.locator('#activationToken').fill(expired); await customer.locator('#activateLicense').click(); await expect(customer.locator('#activationError')).toContainText('已到期');
    const foreign = Issuer.issue(store, { device: 'TN-' + 'D'.repeat(32), plan: 'forever', reference: 'TEST-FOREIGN-001', confirmed: true }).token;
    await customer.locator('#activationToken').fill(foreign); await customer.locator('#activateLicense').click(); await expect(customer.locator('#activationError')).toContainText('不属于');
    await customer.locator('#activationToken').fill(monthlyToken); await customer.locator('#activateLicense').click(); await expect(customer.locator('#activationMessage')).toContainText('激活成功');
    await owner.locator('#plan').selectOption('forever'); await owner.locator('#reference').fill('TEST-WECHAT-0002'); await owner.locator('#confirmed').check(); await owner.locator('#issueButton').click();
    await expect(owner.locator('#issuedStatus')).toHaveText('签发成功');
    const foreverToken = await owner.locator('#token').inputValue();
    await customer.locator('#licenseFile').setInputFiles({ name: 'activation.txt', mimeType: 'text/plain', buffer: Buffer.from(foreverToken) });
    await expect(customer.locator('#memberStatus')).toHaveText('永久会员');
    await customer.locator('#activationToken').fill(monthlyToken); await customer.locator('#activateLicense').click();
    await expect(customer.locator('#activationError')).toContainText('不会覆盖'); await expect(customer.locator('#memberStatus')).toHaveText('永久会员');
    for (const width of [390, 320]) {
      await customer.setViewportSize({ width, height: 844 });
      await customer.screenshot({ path: path.join(output, `activation-${width}.png`) });
      assert.ok(await customer.locator('#activationDialog').evaluate(el => el.scrollWidth <= el.clientWidth));
      await owner.setViewportSize({ width, height: 844 }); await owner.screenshot({ path: path.join(output, `issuer-${width}.png`), fullPage: true });
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    const parts = foreverToken.split('.'); const payload = JSON.parse(Buffer.from(parts[1], 'base64url')); payload.device = 'TN-' + 'E'.repeat(32);
    const tampered = [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
    await customer.evaluate(token => { localStorage.setItem('trade_license_token_v1', token); localStorage.setItem('trade_notebook_vip', JSON.stringify({ type: 'forever', expire: 0 })); }, tampered);
    await customer.reload(); await expect(customer.locator('#memberStatus')).toHaveText('普通版'); await expect(customer.locator('#reviewLocked')).toBeVisible();
    assert.deepEqual(errors, []);
    console.log('PASS: owner issuance UI, idempotency, device matching, signed activation, restart, expiry, report gates, file import, permanent upgrade, tamper rejection and mobile layouts.');
  } finally {
    if (browser) await browser.close();
    for (const server of [siteServer, admin?.server].filter(Boolean)) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(privateTestDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
