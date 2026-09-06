(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.TradeCore;
  const KEY = 'trade_notebook_data_v1';
  const LEGACY_PROFILE = 'trade_notebook_profile_v1';
  function profile(value) {
    if (value == null) return { name: '我的交易账本' };
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 24) throw new Error('账本名称格式不正确');
    return { name: value.name.trim() };
  }
  function read(storage) {
    const raw = storage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : { version: 1, trades: [] };
    return { raw, trades: C.validateBackup(data), profile: profile(data.profile || JSON.parse(storage.getItem(LEGACY_PROFILE) || 'null')), revision: data.revision || '', changes: Number.isSafeInteger(data.changes) ? data.changes : 0, recovery: data.recovery || null };
  }
  function documentOf(book) { return { version: 2, trades: book.trades, profile: book.profile }; }
  function commit(storage, expectedRaw, next, { snapshot = false, allowDamaged = false, clearRecovery = false } = {}) {
    if (storage.getItem(KEY) !== expectedRaw) throw new Error('账本已在其他标签页更新，请刷新后重试，避免覆盖新记录');
    let current, damaged = false;
    try { current = read(storage); }
    catch (error) { if (!allowDamaged) throw error; damaged = true; current = { trades: [], profile: profile(null), changes: 0, recovery: { at: Date.now(), raw: expectedRaw, damaged: true } }; }
    const value = { version: 2, trades: C.validateBackup(next), profile: profile(next.profile), revision: crypto.randomUUID(), changes: current.changes + 1, updatedAt: Date.now(), recovery: clearRecovery ? null : snapshot && !damaged ? { at: Date.now(), ...documentOf(current) } : current.recovery };
    // A single storage write atomically saves the new book and its pre-restore snapshot.
    storage.setItem(KEY, JSON.stringify(value));
    return read(storage);
  }
  function merge(current, incoming) {
    const ids = new Map(current.map(t => [t.id, t]));
    let duplicates = 0, conflicts = 0;
    for (const trade of incoming) {
      if (!ids.has(trade.id)) ids.set(trade.id, trade);
      else if (JSON.stringify(ids.get(trade.id)) === JSON.stringify(trade)) duplicates++;
      else conflicts++;
    }
    if (ids.size > 20000) throw new Error('合并后超过 20000 条记录');
    return { trades: [...ids.values()], duplicates, conflicts, added: ids.size - current.length };
  }
  async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function backup(book) {
    const payload = { ...documentOf(book), exportedAt: new Date().toISOString() };
    return { ...payload, checksum: await digest(payload) };
  }
  async function parseBackup(text) {
    if (typeof text !== 'string' || text.length > 20000000) throw new Error('备份文件不能超过 20 MB');
    const data = JSON.parse(text);
    if (data?.version === 2) {
      const { checksum, ...payload } = data;
      if (typeof checksum !== 'string' || checksum !== await digest(payload)) throw new Error('备份校验失败，文件可能损坏或被修改');
    }
    return { version: data.version, trades: C.validateBackup(data), profile: data.profile ? profile(data.profile) : null, exportedAt: data.exportedAt || null, checked: data.version === 2 };
  }
  const api = { KEY, read, documentOf, commit, merge, backup, parseBackup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeVault = api;
})(typeof window !== 'undefined' ? window : globalThis);
