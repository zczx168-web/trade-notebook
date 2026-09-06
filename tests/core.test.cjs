const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../site/core.js');
const t = overrides => C.validateTrade({ id: crypto.randomUUID(), date: '2026-09-05', symbol: '焦煤2611', market: '期货', direction: '多', pnl: 100, errors: ['无错误'], note: '', ...overrides });
test('long and short contract P&L include fees with correct sign', () => {
  const position = { openPrice: 1200, closePrice: 1210, volume: 2, multiplier: 100, fee: 12, direction: '多' };
  assert.equal(C.calculatePnl(position), 1988);
  assert.equal(C.calculatePnl({ ...position, direction: '空' }), -2012);
  assert.equal(C.calculatePnl({ ...position, direction: '空', closePrice: 1190 }), 1988);
  assert.equal(C.calculatePnl({ ...position, closePrice: 1200 }), -12);
  assert.throws(() => C.calculatePnl({ ...position, volume: -1 }));
  assert.throws(() => C.calculatePnl({ ...position, volume: 1.5 }));
  assert.throws(() => C.calculatePnl({ ...position, closePrice: '' }));
});
test('backup recomputes contract P&L instead of trusting supplied totals', () => {
  const trade = t({ mode: 'contract', openPrice: 1200, closePrice: 1190, volume: 1, multiplier: 100, fee: 8, direction: '空', pnl: 999999 });
  assert.equal(trade.pnl, 992);
  assert.equal(C.validateBackup({ version: 1, trades: [trade] })[0].pnl, 992);
});
test('stats are exact in cents, order by day, and separate average ratio from profit factor', () => {
  const data = [t({ date: '2026-09-03', pnl: -100, errors: ['扛单', '仓位过重'] }), t({ date: '2026-09-01', pnl: 200 }), t({ date: '2026-09-02', pnl: 100 }), t({ date: '2026-09-04', pnl: 0 })];
  const s = C.stats(data);
  assert.equal(s.total, 200); assert.equal(s.winRate, 50); assert.equal(s.factor, 3); assert.equal(s.averageRatio, 1.5); assert.equal(s.drawdown, 100);
  assert.deepEqual(s.curve.map(x => x.value), [200, 300, 200, 200]);
  assert.equal(s.errors[0].loss, 100); assert.equal(s.errors.length, 2);
  assert.equal(C.stats([t({ pnl: 0.1 }), t({ pnl: 0.2 })]).total, 0.3);
});
test('all-loss, all-win and empty samples do not report fictitious values', () => {
  assert.equal(C.stats([]).averageRatio, null); assert.equal(C.stats([]).winRate, 0);
  assert.equal(C.stats([t({ pnl: -100 })]).maxWin, 0);
  assert.equal(C.stats([t({ pnl: 100 })]).maxLoss, 0);
  assert.equal(C.stats([t({ pnl: 100 })]).factor, Infinity);
});
test('invalid dates, numbers, duplicate IDs and conflicting tags are rejected', () => {
  assert.throws(() => t({ date: '2026-02-30' })); assert.throws(() => t({ pnl: 'NaN' })); assert.throws(() => t({ pnl: Infinity })); assert.throws(() => t({ pnl: '' }));
  assert.throws(() => t({ errors: ['无错误', '扛单'] })); assert.throws(() => t({ symbol: ' ' }));
  const item = t(); assert.throws(() => C.validateBackup({ version: 1, trades: [item, item] }));
  assert.throws(() => C.validateBackup({ trades: [item] }));
});
test('date, result, market and keyword filters compose correctly', () => {
  const data = [t({ date: '2026-08-31' }), t({ date: '2026-09-01', pnl: -50, note: '等待确认' }), t({ date: '2026-09-02', market: '股票' })];
  assert.equal(C.filter(data, { period: 'month', now: new Date(2026, 8, 6), market: '期货', result: 'loss', query: '确认' }).length, 1);
  assert.equal(C.filter(data, { period: 'month', now: new Date(2026, 8, 6) }).length, 2);
});
test('CSV preserves all notes and neutralizes spreadsheet formulas in text', () => {
  const csv = C.csv([t({ symbol: '=HYPERLINK("x")', note: '甲,"乙"\n下一段', pnl: -10, openReason: '+cmd' })]);
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'+cmd")); assert.ok(csv.includes('"-10"')); assert.ok(csv.includes('""乙""')); assert.ok(csv.startsWith('\uFEFF'));
});
