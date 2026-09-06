const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const C = require('../site/core.js');
const V = require('../site/vault.js');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-results');
const url = process.env.TEST_URL || pathToFileURL(path.join(root, 'site/index.html')).href;
fs.mkdirSync(output, { recursive: true });
const file = value => ({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#ownBook').click();
    await page.locator('#analyticsLocked [data-start-trial]').click();
    await page.locator('#newTrade').click();
    await page.locator('#tradeMode').selectOption('batch');
    await page.locator('#tradeSymbol').fill('JM分批测试'); await page.locator('#tradeStrategy').fill('趋势突破');
    await page.locator('#tradeNote').fill('<img src=x onerror="window.untrustedRan=true">');
    const fillRow = async (index, action, price, quantity, fee) => {
      const row = page.locator('.fill-row').nth(index);
      await row.locator('[data-fill=action]').selectOption(action); await row.locator('[data-fill=price]').fill(price); await row.locator('[data-fill=quantity]').fill(quantity); await row.locator('[data-fill=fee]').fill(fee);
    };
    await fillRow(0, 'open', '100', '2', '2'); await fillRow(1, 'close', '110', '1', '1');
    await expect(page.locator('#batchPreview')).toContainText('997.00'); await expect(page.locator('#batchPreview')).toContainText('剩余 1');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await page.screenshot({ path: path.join(output, `batch-${width}.png`) });
      assert.ok(await page.locator('#tradeDialog').evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await page.locator('#tradeForm button[type=submit]').click();
    await expect(page.locator('#tradeDialog')).toBeHidden();
    await expect(page.locator('#recentTable')).toContainText('持仓中');
    await expect(page.locator('#metrics')).toContainText('0.00');
    await page.locator('[data-view=trades]').click(); await page.locator('#allTable [data-edit]').click();
    await page.locator('#addFill').click(); await fillRow(2, 'close', '120', '1', '1');
    await expect(page.locator('#batchPreview')).toContainText('2,996.00');
    await page.locator('#tradeForm button[type=submit]').click();
    await page.locator('[data-view=overview]').click();
    await expect(page.locator('#metrics')).toContainText('2,996.00');
    await page.locator('#performanceGroup').selectOption('strategy');
    await expect(page.locator('#performanceTable')).toContainText('趋势突破');
    for (const id of ['monthlyChart', 'drawdownChart']) {
      assert.ok(await page.locator('#' + id).evaluate(canvas => { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let pixels = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) pixels++; return pixels > 100; }));
    }
    await page.locator('[data-view=settings]').click();
    await page.locator('#bookName').fill('完整备份测试'); await page.locator('#profileForm button').click();
    await expect(page.locator('#backupBanner')).toBeVisible();
    const download = page.waitForEvent('download'); await page.locator('#backupButton').click();
    const backupPath = path.join(output, 'enhanced-backup.json'); await (await download).saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.trades[0].fills.length, 3); assert.equal(backup.profile.name, '完整备份测试');
    assert.equal((await V.parseBackup(JSON.stringify(backup))).checked, true);
    await page.locator('#confirmBackupSaved').click(); await expect(page.locator('#backupStatus')).toContainText('当前账本已备份');
    await page.locator('#importFile').setInputFiles(file(backup));
    await expect(page.locator('#restoreSummary')).toContainText('跳过 1 笔');
    await page.locator('#applyRestore').click();
    const replacement = await V.backup({ trades: [], profile: { name: '替换账本' } });
    await page.locator('#importFile').setInputFiles(file(replacement));
    await page.locator('#restoreReplace').check(); await page.locator('#applyRestore').click();
    await expect(page.locator('#bookName')).toHaveValue('替换账本');
    await page.reload(); await expect(page.locator('#undoRestore')).toBeEnabled();
    await page.locator('#undoRestore').click(); await page.locator('#confirmAction').click();
    await expect(page.locator('#bookName')).toHaveValue('完整备份测试');
    const before = await page.evaluate(() => localStorage.getItem('trade_notebook_data_v1'));
    await page.locator('#importFile').setInputFiles(file({ ...backup, trades: [] }));
    await expect(page.locator('#toast')).toContainText('校验失败');
    assert.equal(await page.evaluate(() => localStorage.getItem('trade_notebook_data_v1')), before);
    // Quota failure cannot leave the book half-restored or overwrite its recovery point.
    await page.locator('#importFile').setInputFiles(file(replacement)); await page.locator('#restoreReplace').check();
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'trade_notebook_data_v1') throw new DOMException('Storage full', 'QuotaExceededError'); return window.originalSetItem.call(this, key, value); }; });
    await page.locator('#applyRestore').click(); await expect(page.locator('#restoreError')).not.toBeEmpty();
    assert.equal(await page.evaluate(() => localStorage.getItem('trade_notebook_data_v1')), before);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; }); await page.locator('[data-close=restoreDialog]').first().click();
    await page.locator('[data-view=overview]').click(); await page.locator('#newTrade').click();
    await page.locator('#tradeMode').selectOption('manual'); await page.locator('#tradeSymbol').fill('过期编辑'); await page.locator('#tradePnl').fill('1');
    const second = await context.newPage(); await second.goto(url + '#settings');
    await second.locator('#bookName').fill('另一个标签页'); await second.locator('#profileForm button').click();
    await page.locator('#tradeForm button[type=submit]').click(); await expect(page.locator('#tradeError')).toContainText('其他标签页');
    await page.locator('[data-close=tradeDialog]').first().click();
    await page.locator('[data-view=review]').click();
    assert.equal(await page.locator('#reviewNotes img').count(), 0); assert.equal(await page.evaluate(() => window.untrustedRan), undefined);
    await page.evaluate(() => { window.print = () => {}; }); await page.locator('#exportPdfBtn').click();
    await expect(page.locator('#printReport')).toContainText('分批成交');
    assert.equal(await page.locator('#printReport img').count(), 0);
    const violations = await page.evaluate(async () => {
      const events = []; document.addEventListener('securitypolicyviolation', e => events.push(e.effectiveDirective));
      const script = document.createElement('script'); script.textContent = 'window.inlineScriptRan=true'; document.body.appendChild(script);
      try { await fetch('https://example.invalid/security-test'); } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
      return { events, ran: !!window.inlineScriptRan };
    });
    assert.equal(violations.ran, false); assert.ok(violations.events.includes('script-src-elem')); assert.ok(violations.events.includes('connect-src'));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 }); await page.locator('[data-view=overview]').click();
      await page.screenshot({ path: path.join(output, `performance-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('[data-view=settings]').click(); await page.screenshot({ path: path.join(output, `backup-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: partial/complete batch editing, performance chart pixels, backup checksum/reminders/merge/replace/undo, quota failure, cross-tab protection, CSP/XSS and responsive layouts.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
