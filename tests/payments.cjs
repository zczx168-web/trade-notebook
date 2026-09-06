const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function loaded(page, selector) {
  await expect.poll(() => page.locator(selector).evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
}
async function fits(page, selector) {
  assert.ok(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth), `${selector} must fit horizontally`);
}
(async () => {
  let browser, server;
  try {
    let url = process.env.TEST_URL;
    if (!url) {
      const siteRoot = path.join(root, 'site');
      server = http.createServer((req, res) => {
        try {
          const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
          const file = path.resolve(siteRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
          if (!file.startsWith(siteRoot + path.sep)) { res.writeHead(403).end(); return; }
          const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
          const data = fs.readFileSync(file);
          res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
          res.end(data);
        } catch { res.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${server.address().port}/`;
    }
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'zh-CN' });
    const page = await context.newPage();
    const errors = [], paymentRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/\/pay\/orders|\/auth\//.test(r.url())) paymentRequests.push(r.url()); });
    await page.goto(url);
    const before = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    await page.locator('#openVipModal').click();
    await expect(page.locator('#paymentNotice')).toContainText('不会自动开通');
    await expect(page.locator('.pay-alipay').first()).toBeHidden();
    await expect(page.locator('.pay-wechat').first()).toBeHidden();
    for (const [goods, price, name] of [['month', '19.90', '月度会员'], ['forever', '199.00', '永久会员']]) {
      await page.locator(`.pay-manual[data-goods=${goods}]`).click();
      await expect(page.locator('#manualPayDialog')).toBeVisible();
      await expect(page.locator('#manualAmount')).toHaveText('¥' + price);
      await expect(page.locator('#manualPayTitle')).toContainText(name);
      await expect(page.locator('#manualPayQr')).toHaveAttribute('src', `assets/payments/wechat-${goods}-qr.png`);
      await expect(page.locator('#originalPaymentQr')).toHaveAttribute('href', `assets/payments/wechat-${goods}.jpg`);
      await loaded(page, '#manualPayQr'); await fits(page, '#manualPayDialog');
      await page.screenshot({ path: path.join(output, `payment-${goods}-desktop.png`) });
      await page.locator('#manualPayQr').screenshot({ path: path.join(output, `qr-${goods}-desktop.png`) });
      const event = page.waitForEvent('download');
      await page.locator('#savePaymentQr').click();
      const file = path.join(output, `download-${goods}.jpg`);
      await (await event).saveAs(file);
      assert.equal(hash(file), hash(path.join(root, `site/assets/payments/wechat-${goods}.jpg`)));
      await page.locator('#paymentSupport').click();
      await expect(page.locator('#supportPlan')).toContainText(name);
      await expect(page.locator('#supportPlan')).toContainText(price);
      await loaded(page, '#supportQr');
      await expect(page.locator('#supportName')).toHaveText('焦煤观察');
      await page.locator('#backFromSupport').click();
      await expect(page.locator('#manualAmount')).toHaveText('¥' + price);
      await page.locator('#backToPlans').click();
    }
    await page.locator('#vipSupport').click();
    await expect(page.locator('#supportPlan')).toHaveText('会员咨询与付款核验');
    await loaded(page, '#supportQr');
    const supportEvent = page.waitForEvent('download');
    await page.locator('#saveSupportQr').click();
    const supportFile = path.join(output, 'download-support.jpg');
    await (await supportEvent).saveAs(supportFile);
    assert.equal(hash(supportFile), hash(path.join(root, 'site/assets/payments/wechat-support.jpg')));
    await page.locator('#backFromSupport').click();
    for (const width of [390, 320, 768]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
      await fits(page, '#vipModal');
      await page.screenshot({ path: path.join(output, `plans-${width}.png`) });
      for (const goods of ['month', 'forever']) {
        await page.locator(`.pay-manual[data-goods=${goods}]`).click();
        await loaded(page, '#manualPayQr'); await fits(page, '#manualPayDialog');
        await page.screenshot({ path: path.join(output, `payment-${goods}-${width}.png`) });
        await page.locator('#manualPayQr').screenshot({ path: path.join(output, `qr-${goods}-${width}.png`) });
        await page.locator('#paymentSupport').click();
        await loaded(page, '#supportQr'); await fits(page, '#supportDialog');
        await page.screenshot({ path: path.join(output, `support-${width}.png`) });
        await page.locator('#supportQr').screenshot({ path: path.join(output, `qr-support-${width}.png`) });
        await page.locator('#backFromSupport').click();
        await page.locator('#backToPlans').click();
      }
    }
    await page.locator('#closeVipModal').click();
    await expect(page.locator('#memberStatus')).toHaveText('普通版');
    assert.equal(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })), before);
    assert.deepEqual(paymentRequests, []);
    assert.deepEqual(errors, []);
    console.log('PASS: plan-to-QR mapping, original downloads, support navigation, desktop/mobile layout, no fake orders or membership grants.');
    {
      await page.route('**/assets/payments/wechat-month-qr.png', route => route.abort());
      await page.reload();
      await page.locator('[data-view=settings]').click(); await page.locator('#settingsVip').click();
      await page.locator('.pay-manual[data-goods=month]').click();
      await expect(page.locator('#manualQrError')).toBeVisible();
      await expect(page.locator('#originalPaymentQr')).toHaveAttribute('href', 'assets/payments/wechat-month.jpg');
      console.log('PASS: failed image shows actionable fallback.');
    }
  } finally {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
