const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../site/core.js');
const V = require('../site/vault.js');
const trade = overrides => C.validateTrade({ id: 'trade-a', mode: 'manual', date: '2026-09-01', symbol: 'JM2611', market: '期货', direction: '多', pnl: 100, errors: ['无错误'], ...overrides });
const fill = (action, price, quantity, fee = 1, date = '2026-09-01') => ({ date, action, price, quantity, fee });
const batch = overrides => trade({ mode: 'batch', multiplier: 100, fills: [fill('open', 100, 2, 2), fill('open', 130, 1), fill('close', 120, 1)], ...overrides });
function storage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}
test('partial closes and subsequent additions use moving average, with long/short symmetry and fees', () => {
  const open = batch();
  assert.equal(open.pnl, 996); assert.equal(open.remaining, 2); assert.equal(open.averagePrice, 110); assert.equal(open.status, 'open');
  const complete = batch({ fills: [...open.fills, fill('open', 80, 1), fill('close', 90, 3, 3, '2026-09-02')] });
  assert.equal(complete.pnl, -2008); assert.equal(complete.status, 'closed'); assert.equal(complete.date, '2026-09-02');
  assert.equal(batch({ direction: '空', fills: complete.fills }).pnl, 1992);
  assert.equal(batch({ pnl: 999999, fills: complete.fills }).pnl, -2008);
  const stats = C.stats([open, complete]);
  assert.equal(stats.count, 1); assert.equal(stats.openCount, 1); assert.equal(stats.total, -2008); assert.equal(stats.winRate, 0);
});
test('batch validation prevents overselling, missing numbers, invalid order and bad dates', () => {
  for (const fills of [[fill('close', 1, 1)], [fill('open', 1, 1), fill('close', 1, 2)], [fill('open', '', 1)], [fill('open', 1, 1, -1)], [fill('open', 1, 1.5)], [fill('open', 1, 1, 0, '2026-02-30')], [fill('open', 1, 1, 0, '2026-09-02'), fill('close', 1, 1)]]) assert.throws(() => batch({ fills }));
  assert.equal(batch({ market: '外汇', multiplier: 1, fills: [fill('open', 0.1, 0.3, 0), fill('close', 0.2, 0.3, 0)] }).pnl, 0.03);
});
test('performance groups use completed trades and display daily drawdown and expectancy', () => {
  const rows = [trade({ id: 'a', pnl: 200, strategy: '趋势' }), trade({ id: 'b', pnl: -100, date: '2026-09-02', strategy: '趋势' }), trade({ id: 'c', pnl: 0, date: '2026-08-01', strategy: '均值' }), batch({ id: 'd' })];
  const groups = C.performance(rows, 'strategy');
  assert.equal(groups[0].total, 100); assert.equal(groups[0].expectancy, 50);
  assert.deepEqual(C.performance(rows, 'month').map(g => g.name), ['2026-08', '2026-09']);
  assert.equal(C.stats(rows).curve.at(-1).drawdown, 100);
});
test('new backups verify integrity, preserve profile and batches, and accept legacy backups', async () => {
  const book = { trades: [batch()], profile: { name: '我的策略账本' } };
  const backup = await V.backup(book);
  const restored = await V.parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored.trades, book.trades); assert.deepEqual(restored.profile, book.profile);
  await assert.rejects(V.parseBackup(JSON.stringify({ ...backup, trades: [] })), /校验失败/);
  assert.equal((await V.parseBackup(JSON.stringify({ version: 1, trades: [trade()] }))).checked, false);
  await assert.rejects(V.parseBackup('{bad'));
});
test('restore snapshot is atomic, stale writes fail and undo can recover the previous profile', () => {
  const s = storage();
  const first = V.commit(s, null, { version: 2, trades: [trade()], profile: { name: '原账本' } });
  const next = V.commit(s, first.raw, { version: 2, trades: [trade({ id: 'new' })], profile: { name: '新账本' } }, { snapshot: true });
  assert.equal(next.recovery.trades[0].id, 'trade-a');
  assert.throws(() => V.commit(s, first.raw, { version: 2, trades: [] }), /其他标签页/);
  const before = s.getItem(V.KEY), realSet = s.setItem;
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => V.commit(s, before, { version: 2, trades: [] }, { snapshot: true }));
  assert.equal(s.getItem(V.KEY), before);
  s.setItem = realSet;
  const undone = V.commit(s, before, next.recovery, { snapshot: true });
  assert.equal(undone.profile.name, '原账本'); assert.equal(undone.trades[0].id, 'trade-a');
});
test('merging skips identical IDs and preserves local conflicting records; damaged raw is recoverable', () => {
  const a = trade(), b = trade({ id: 'b' });
  const merged = V.merge([a], [a, b, trade({ pnl: 999 })]);
  assert.equal(merged.added, 1); assert.equal(merged.duplicates, 1); assert.equal(merged.conflicts, 1); assert.equal(merged.trades[0].pnl, 100);
  const s = storage(); s.setItem(V.KEY, '{broken');
  const restored = V.commit(s, '{broken', { version: 2, trades: [a] }, { snapshot: true, allowDamaged: true });
  assert.equal(restored.recovery.raw, '{broken'); assert.equal(restored.recovery.damaged, true);
});
