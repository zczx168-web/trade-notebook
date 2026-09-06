const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const Issuer = require('../scripts/issuer-lib.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results');
const url = process.env.TEST_URL || pathToFileURL(path.join(root, 'site/index.html')).href;
const trialKey = 'trade_trial_v1', duration = 7 * 86400000;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-trial-test-'));
const store = Issuer.initialize(temporary);
fs.mkdirSync(output, { recursive: true });
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 950 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date() });
    await page.goto(url);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), trialKey), null);
    await page.locator('#ownBook').click();
    await expect(page.locator('#analyticsLocked')).toBeVisible();
    await page.locator('#openVipModal').click();
    await expect(page.locator('#vipModal [data-start-trial]')).toBeEnabled();
    await page.screenshot({ path: path.join(output, 'trial-desktop.png') });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: path.join(output, `trial-${width}.png`) });
      assert.ok(await page.locator('#vipModal').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.setViewportSize({ width: 1366, height: 950 });
    await page.locator('#vipModal [data-start-trial]').click();
    await expect(page.locator('#memberStatus')).toContainText('免费试用');
    await expect(page.locator('#trialStatus')).toContainText('到期时间');
    await expect(page.locator('#vipModal [data-start-trial]')).toBeDisabled();
    const trial = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), trialKey);
    assert.equal(trial.expiresAt - trial.startedAt, duration);
    await page.locator('#closeVipModal').click();
    await expect(page.locator('#analyticsContent')).toBeVisible();
    await page.locator('#newTrade').click();
    await page.locator('#tradeMode').selectOption('manual');
    await page.locator('#tradeSymbol').fill('试用保留记录');
    await page.locator('#tradePnl').fill('100');
    await page.locator('#tradeForm button[type=submit]').click();
    await page.reload();
    await expect(page.locator('#memberStatus')).toContainText('免费试用');
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), trialKey), trial);
    await page.locator('[data-view=review]').click();
    await expect(page.locator('#reviewContent')).toBeVisible();
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('#exportPdfBtn').click();
    await expect(page.locator('#printReport')).toContainText('试用保留记录');
    await page.clock.setSystemTime(trial.expiresAt - 1);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#memberStatus')).toContainText('免费试用');
    await page.clock.setSystemTime(trial.expiresAt);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#memberStatus')).toHaveText('免费试用已结束');
    await expect(page.locator('#reviewLocked')).toBeVisible();
    await expect(page.locator('#printReport')).toBeEmpty();
    await page.locator('#exportPdfBtn').click();
    await expect(page.locator('#vipModal')).toBeVisible();
    await expect(page.locator('#vipModal [data-start-trial]')).toBeDisabled();
    await page.locator('#closeVipModal').click();
    await page.locator('[data-view=trades]').click();
    await expect(page.locator('#allTable')).toContainText('试用保留记录');
    await page.reload();
    await expect(page.locator('#memberStatus')).toHaveText('免费试用已结束');

    // Two tabs share a single trial record; a test signing key exercises paid upgrades.
    const shared = await browser.newContext();
    await shared.route('**/license-key.js*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.TRADE_LICENSE_PUBLIC_KEY=' + JSON.stringify(store.publicKey) + ';' }));
    const first = await shared.newPage(), second = await shared.newPage();
    for (const tab of [first, second]) { tab.on('pageerror', error => errors.push(error.message)); await tab.goto(url); await tab.locator('#ownBook').click(); }
    await first.locator('#analyticsLocked [data-start-trial]').click();
    await expect(first.locator('#memberStatus')).toContainText('免费试用');
    await expect(second.locator('#memberStatus')).toContainText('免费试用');
    const device = await first.evaluate(() => localStorage.getItem('trade_license_device_v1'));
    for (const plan of ['month', 'forever']) {
      const license = Issuer.issue(store, { device, plan, reference: 'TEST-TRIAL-' + plan, confirmed: true });
      await first.locator('#openVipModal').click();
      await first.locator('#vipModal [data-open-activation]').click();
      await first.locator('#activationToken').fill(license.token);
      await first.locator('#activateLicense').click();
      await expect(first.locator('#memberStatus')).toContainText(plan === 'month' ? '月度会员' : '永久会员');
      await expect(second.locator('#memberStatus')).toContainText(plan === 'month' ? '月度会员' : '永久会员');
      await first.locator('[data-close=activationDialog]').click();
      await first.locator('#openVipModal').click();
      await expect(first.locator('#vipModal [data-start-trial]')).toBeDisabled();
      await first.locator('#closeVipModal').click();
    }
    const beforeExpiry = await first.evaluate(key => JSON.parse(localStorage.getItem(key)), trialKey);
    await first.clock.install({ time: new Date(beforeExpiry.expiresAt + 1) });
    await first.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(first.locator('#memberStatus')).toHaveText('永久会员');

    const broken = await browser.newContext();
    const invalid = await broken.newPage();
    await invalid.goto(url);
    await invalid.evaluate(key => localStorage.setItem(key, '{broken'), trialKey);
    await invalid.reload(); await invalid.locator('#openVipModal').click();
    await expect(invalid.locator('#trialStatus')).toContainText('无法读取');
    await expect(invalid.locator('#memberStatus')).toHaveText('普通版');
    await expect(invalid.locator('#vipModal [data-start-trial]')).toBeDisabled();
    const unavailable = await browser.newContext();
    const blocked = await unavailable.newPage();
    await blocked.goto(url); await blocked.locator('#ownBook').click();
    await blocked.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError'); return original.call(this, name, value); }; }, trialKey);
    await blocked.locator('#analyticsLocked [data-start-trial]').click();
    await expect(blocked.locator('#toast')).toContainText('本地保存失败');
    await expect(blocked.locator('#analyticsLocked')).toBeVisible();
    assert.equal(await blocked.evaluate(key => localStorage.getItem(key), trialKey), null);
    assert.deepEqual(errors, []);
    console.log('PASS: opt-in seven-day trial, exact expiry, reload, repeat protection, retained trades, report gates, cross-tab sync, paid upgrades, corrupt/unavailable storage and desktop/mobile layout.');
  } finally {
    if (browser) await browser.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
