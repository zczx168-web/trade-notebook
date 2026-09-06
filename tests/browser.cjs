const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const url = process.env.TEST_URL || pathToFileURL(path.join(root, 'site/index.html')).href;
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await expect(page.locator('#metrics')).toContainText('12');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    const pixels = await page.locator('#profitChart').evaluate(canvas => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let visible = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) visible++;
      return visible;
    });
    assert.ok(pixels > 1000, 'chart must contain plotted pixels');
    await page.locator('#ownBook').click(); await expect(page.locator('#recentTable')).toContainText('还没有交易记录');
    await page.locator('#newTrade').click();
    await page.locator('#tradeSymbol').fill('焦煤2611'); await page.locator('#tradeDirection').selectOption('空');
    await page.locator('#openPrice').fill('1200'); await page.locator('#closePrice').fill('1190'); await page.locator('#volume').fill('2'); await page.locator('#fee').fill('12');
    await expect(page.locator('#pnlPreview')).toContainText('+1,988.00');
    await page.locator('#openReason').fill('跌破支撑，等待反抽确认'); await page.locator('#tradeNote').fill('按计划执行止损与止盈');
    await page.locator('#tradeForm button[type=submit]').click(); await expect(page.locator('#tradeDialog')).not.toBeVisible();
    await expect(page.locator('#recentTable')).toContainText('+1,988.00');
    await page.reload(); await expect(page.locator('#recentTable')).toContainText('焦煤2611');
    await page.locator('[data-view=trades]').click(); await page.locator('[data-edit]').filter({ visible: true }).first().click();
    await page.locator('#closePrice').fill('1210'); await page.locator('#errorChoices input[value="扛单"]').check();
    await page.locator('#tradeForm button[type=submit]').click(); await expect(page.locator('#allTable')).toContainText('-2,012.00');
    await page.locator('#search').fill('不存在的品种'); await expect(page.locator('#allTable')).toContainText('没有匹配的交易');
    await page.locator('#search').fill(''); await page.locator('#resultFilter').selectOption('win'); await expect(page.locator('#allTable')).toContainText('没有匹配的交易'); await page.locator('#resultFilter').selectOption('');
    const csvEvent = page.waitForEvent('download'); await page.locator('#exportCsv').click(); await (await csvEvent).saveAs(path.join(output, 'records.csv'));
    await page.locator('[data-view=settings]').click();
    const backupEvent = page.waitForEvent('download'); await page.locator('#backupButton').click(); await (await backupEvent).saveAs(path.join(output, 'backup.json'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'backup.json'), 'utf8')).trades.length, 1);
    await page.locator('#settingsVip').click(); await expect(page.locator('#paymentNotice')).toContainText('人工核验'); await expect(page.locator('.pay-manual').first()).toBeEnabled(); await expect(page.locator('.pay-wechat').first()).toBeHidden(); await page.locator('#closeVipModal').click();
    await page.locator('#accountButton').click(); await expect(page.locator('#authSubmit')).toBeDisabled(); await page.locator('[data-auth=register]').click(); await expect(page.locator('#authPassword')).toBeVisible(); await page.locator('[data-close=authDialog]').click();
    await page.locator('[data-view=trades]').click(); await page.locator('[data-delete]').filter({ visible: true }).first().click(); await page.locator('#confirmAction').click(); await expect(page.locator('#allTable')).toContainText('还没有交易记录');
    await page.locator('[data-view=settings]').click(); await page.locator('#importFile').setInputFiles(path.join(output, 'backup.json')); await expect(page.locator('#confirmText')).toContainText('1 笔'); await page.locator('#confirmAction').click();
    await page.locator('[data-view=overview]').click(); await expect(page.locator('#recentTable')).toContainText('焦煤2611');
    await page.locator('#demoBook').click();
    await page.evaluate(() => { window.print = () => {}; }); await page.locator('#exportPdfBtn').click();
    await expect(page.locator('#printReport')).toContainText('教训与改进'); await page.pdf({ path: path.join(output, 'report.pdf'), format: 'A4', printBackground: true });
    for (const width of [390, 320, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('#toast')).toBeHidden({ timeout: 6000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(output, `mobile-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${width}`);
      await page.locator('#newTrade').click(); await page.screenshot({ path: path.join(output, `form-${width}.png`) });
      assert.ok(await page.locator('#tradeDialog').evaluate(el => el.scrollWidth <= el.clientWidth), `form overflow at ${width}`);
      await page.locator('[data-close=tradeDialog]').first().click();
      await page.locator('[data-view=settings]').click(); await page.locator('#settingsVip').click();
      await page.screenshot({ path: path.join(output, `membership-${width}.png`) });
      assert.ok(await page.locator('#vipModal').evaluate(el => el.scrollWidth <= el.clientWidth), `membership overflow at ${width}`);
      await page.locator('#closeVipModal').click(); await page.locator('[data-view=overview]').click();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile, chart pixels, CRUD, short P&L, filters, persistence, CSV, backups, import, report, disabled unconfigured services.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
