(function (root) {
  'use strict';
  const ERRORS = ['无错误', '追涨杀跌', '扛单', '仓位过重', '频繁交易', '未设止损', '逆势交易', '提前止盈', '情绪交易', '计划外交易'];
  const MARKETS = ['期货', '股票', '外汇', '其他'];
  function calculatePnl(t) {
    for (const name of ['openPrice', 'closePrice', 'volume', 'multiplier', 'fee']) {
      if (t[name] === '' || t[name] === null || !Number.isFinite(Number(t[name]))) throw new Error('请完整填写价格、手数、乘数和手续费');
    }
    if (Number(t.openPrice) < 0 || Number(t.closePrice) < 0 || Number(t.volume) <= 0 || !Number.isInteger(Number(t.volume)) || Number(t.multiplier) <= 0 || Number(t.fee) < 0) throw new Error('价格和手续费不能为负，手数须为正整数，乘数须大于零');
    if (!['多', '空'].includes(t.direction)) throw new Error('请选择交易方向');
    return Math.round(((Number(t.closePrice) - Number(t.openPrice)) * (t.direction === '空' ? -1 : 1) * Number(t.volume) * Number(t.multiplier) - Number(t.fee)) * 100) / 100;
  }
  function validateTrade(t) {
    if (!t || typeof t !== 'object') throw new Error('交易数据格式不正确');
    const symbol = String(t.symbol || '').trim();
    if (!symbol || symbol.length > 24) throw new Error('请输入 1 至 24 个字的交易品种');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !Number.isFinite(Date.parse(t.date + 'T00:00:00Z')) || new Date(t.date + 'T00:00:00Z').toISOString().slice(0, 10) !== t.date) throw new Error('请选择有效的交易日期');
    if (!MARKETS.includes(t.market) || !['多', '空'].includes(t.direction)) throw new Error('市场或方向不正确');
    const pnl = t.mode === 'contract' ? calculatePnl(t) : t.pnl;
    if (pnl === '' || pnl === null || !Number.isFinite(Number(pnl)) || Math.abs(Number(pnl)) > 1e9) throw new Error('盈亏金额应在正负 10 亿元以内');
    const errors = Array.isArray(t.errors) ? [...new Set(t.errors)] : [];
    if (!errors.length || errors.length > 15 || errors.some(e => typeof e !== 'string' || !e.trim() || e.length > 20) || (errors.length > 1 && errors.includes('无错误'))) throw new Error('错误标签最多 15 个，每个最多 20 字，不能与无错误同时选择');
    const note = String(t.note || '').trim();
    if (note.length > 2000) throw new Error('复盘笔记不能超过 2000 字');
    const openReason = String(t.openReason || '').trim();
    if (openReason.length > 2000) throw new Error('开仓理由不能超过 2000 字');
    const result = { id: typeof t.id === 'string' && t.id.length > 0 && t.id.length < 100 ? t.id : crypto.randomUUID(), date: t.date, symbol, market: t.market, direction: t.direction, pnl: Math.round(Number(pnl) * 100) / 100, errors, note, openReason, mode: t.mode === 'contract' ? 'contract' : 'manual' };
    if (result.mode === 'contract') for (const key of ['openPrice', 'closePrice', 'volume', 'multiplier', 'fee']) result[key] = Number(t[key]);
    return result;
  }
  function validateBackup(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.trades) || data.trades.length > 20000) throw new Error('请选择有效的交易纠错本备份，最多 20000 条记录');
    const trades = data.trades.map(validateTrade);
    if (new Set(trades.map(t => t.id)).size !== trades.length) throw new Error('备份包含重复的记录编号');
    return trades;
  }
  function stats(trades) {
    let cents = 0, wins = 0, gains = 0, losses = 0, peak = 0, drawdown = 0;
    const daily = new Map();
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const t of sorted) {
      const p = Math.round(t.pnl * 100);
      cents += p;
      if (p > 0) { wins++; gains += p; }
      if (p < 0) losses -= p;
      daily.set(t.date, (daily.get(t.date) || 0) + p);
    }
    let cumulative = 0;
    const curve = [...daily].map(([date, p]) => {
      cumulative += p;
      peak = Math.max(peak, cumulative);
      drawdown = Math.max(drawdown, peak - cumulative);
      return { date, value: cumulative / 100 };
    });
    const errors = [...new Set(trades.flatMap(t => t.errors))].filter(e => e !== '无错误').map(name => {
      const related = trades.filter(t => t.errors.includes(name));
      return { name, count: related.length, loss: related.reduce((n, t) => n + Math.max(0, -Math.round(t.pnl * 100)), 0) / 100 };
    }).filter(e => e.count).sort((a, b) => b.count - a.count);
    const lossCount = trades.filter(t => t.pnl < 0).length;
    return { total: cents / 100, count: trades.length, wins, winRate: trades.length ? wins / trades.length * 100 : 0, factor: losses ? gains / losses : gains ? Infinity : null, averageRatio: wins && lossCount ? (gains / wins) / (losses / lossCount) : null, maxWin: Math.max(0, ...trades.map(t => t.pnl)), maxLoss: Math.min(0, ...trades.map(t => t.pnl)), drawdown: drawdown / 100, clean: trades.filter(t => t.errors.includes('无错误')).length, errors, curve };
  }
  function filter(trades, { query = '', market = '', result = '', period = 'all', now = new Date() } = {}) {
    const year = now.getFullYear(), month = now.getMonth();
    return trades.filter(t => {
      const date = new Date(t.date + 'T12:00:00');
      const periodOK = period === 'all' || (period === 'month' && date.getFullYear() === year && date.getMonth() === month) || (period === 'year' && date.getFullYear() === year);
      return periodOK && (!query || (t.symbol + ' ' + t.note + ' ' + t.errors.join(' ')).toLowerCase().includes(query.toLowerCase())) && (!market || t.market === market) && (!result || (result === 'win' ? t.pnl > 0 : result === 'loss' ? t.pnl < 0 : t.pnl === 0));
    }).sort((a, b) => b.date.localeCompare(a.date));
  }
  function csv(trades) {
    const cell = value => {
      let s = String(value);
      if (/^[=+@\-\t\r]/.test(s) && typeof value !== 'number') s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    return '\uFEFF' + [['日期', '品种', '市场', '方向', '开仓价', '平仓价', '手数', '乘数', '手续费', '净盈亏', '错误标签', '开仓理由', '复盘笔记'], ...trades.map(t => [t.date, t.symbol, t.market, t.direction, t.openPrice ?? '', t.closePrice ?? '', t.volume ?? '', t.multiplier ?? '', t.fee ?? '', t.pnl, t.errors.join('、'), t.openReason || '', t.note])].map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = { ERRORS, MARKETS, calculatePnl, validateTrade, validateBackup, stats, filter, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
