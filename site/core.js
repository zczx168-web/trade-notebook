(function (root) {
  'use strict';
  const Decimal = typeof module !== 'undefined' && module.exports ? require('decimal.js') : root.Decimal;
  const D = value => new Decimal(value);
  const ERRORS = ['无错误', '追涨杀跌', '扛单', '仓位过重', '频繁交易', '未设止损', '逆势交易', '提前止盈', '情绪交易', '计划外交易'];
  const MARKETS = ['期货', '股票', '外汇', '其他'];
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  }
  function batches(t) {
    if (!Array.isArray(t.fills) || !t.fills.length || t.fills.length > 100) throw new Error('请录入 1 至 100 条成交');
    if (!['多', '空'].includes(t.direction) || !Number.isFinite(Number(t.multiplier)) || Number(t.multiplier) <= 0 || Number(t.multiplier) > 1e8) throw new Error('请核对方向和合约乘数');
    let quantity = D(0), cost = D(0), gross = D(0), fees = D(0), lastDate = '';
    // Moving average cost tracks additions and partial closes without inventing unrealized P&L.
    const fills = t.fills.map(fill => {
      if (!fill || !validDate(fill.date) || fill.date < lastDate || !['open', 'close'].includes(fill.action)) throw new Error('成交须按日期先后排列，同日按行顺序计算');
      for (const key of ['price', 'quantity', 'fee']) if (fill[key] === '' || fill[key] == null || !Number.isFinite(Number(fill[key])) || Math.abs(Number(fill[key])) > 1e9) throw new Error('请完整填写有效的成交价、数量和费用');
      const price = D(fill.price), qty = D(fill.quantity), fee = D(fill.fee);
      if (price.isNegative() || !qty.isPositive() || fee.isNegative() || (t.market !== '外汇' && !qty.isInteger())) throw new Error('价格和费用不能为负，数量必须为正；期货和股票数量须为整数');
      if (fill.action === 'open') { quantity = quantity.plus(qty); cost = cost.plus(price.times(qty)); }
      else {
        if (qty.gt(quantity)) throw new Error('平仓数量不能超过当时持仓数量');
        const average = cost.div(quantity);
        gross = gross.plus(price.minus(average).times(qty).times(t.multiplier).times(t.direction === '空' ? -1 : 1));
        quantity = quantity.minus(qty); cost = quantity.isZero() ? D(0) : cost.minus(average.times(qty));
      }
      fees = fees.plus(fee); lastDate = fill.date;
      return { date: fill.date, action: fill.action, price: price.toNumber(), quantity: qty.toNumber(), fee: fee.toNumber() };
    });
    return { fills, date: lastDate, pnl: gross.minus(fees).toDecimalPlaces(2).toNumber(), fee: fees.toDecimalPlaces(2).toNumber(), remaining: quantity.toNumber(), averagePrice: quantity.isZero() ? 0 : cost.div(quantity).toDecimalPlaces(6).toNumber(), status: quantity.isZero() ? 'closed' : 'open' };
  }
  function calculatePnl(t) {
    for (const name of ['openPrice', 'closePrice', 'volume', 'multiplier', 'fee']) {
      if (t[name] === '' || t[name] === null || !Number.isFinite(Number(t[name]))) throw new Error('请完整填写价格、手数、乘数和手续费');
    }
    if (Number(t.openPrice) < 0 || Number(t.closePrice) < 0 || Number(t.volume) <= 0 || !Number.isInteger(Number(t.volume)) || Number(t.multiplier) <= 0 || Number(t.fee) < 0) throw new Error('价格和手续费不能为负，手数须为正整数，乘数须大于零');
    if (!['多', '空'].includes(t.direction)) throw new Error('请选择交易方向');
    return D(t.closePrice).minus(t.openPrice).times(t.direction === '空' ? -1 : 1).times(t.volume).times(t.multiplier).minus(t.fee).toDecimalPlaces(2).toNumber();
  }
  function validateTrade(t) {
    if (!t || typeof t !== 'object') throw new Error('交易数据格式不正确');
    const symbol = String(t.symbol || '').trim();
    if (!symbol || symbol.length > 24) throw new Error('请输入 1 至 24 个字的交易品种');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !Number.isFinite(Date.parse(t.date + 'T00:00:00Z')) || new Date(t.date + 'T00:00:00Z').toISOString().slice(0, 10) !== t.date) throw new Error('请选择有效的交易日期');
    if (!MARKETS.includes(t.market) || !['多', '空'].includes(t.direction)) throw new Error('市场或方向不正确');
    if (t.mode != null && !['contract', 'manual', 'batch'].includes(t.mode)) throw new Error('不支持的记账方式');
    const batch = t.mode === 'batch' ? batches(t) : null;
    const pnl = batch ? batch.pnl : t.mode === 'contract' ? calculatePnl(t) : t.pnl;
    if (pnl === '' || pnl === null || !Number.isFinite(Number(pnl)) || Math.abs(Number(pnl)) > 1e9) throw new Error('盈亏金额应在正负 10 亿元以内');
    const errors = Array.isArray(t.errors) ? [...new Set(t.errors)] : [];
    if (!errors.length || errors.length > 15 || errors.some(e => typeof e !== 'string' || !e.trim() || e.length > 20) || (errors.length > 1 && errors.includes('无错误'))) throw new Error('错误标签最多 15 个，每个最多 20 字，不能与无错误同时选择');
    const note = String(t.note || '').trim();
    if (note.length > 2000) throw new Error('复盘笔记不能超过 2000 字');
    const openReason = String(t.openReason || '').trim();
    if (openReason.length > 2000) throw new Error('开仓理由不能超过 2000 字');
    const batchOvernight = batch ? batch.fills[0].date !== batch.fills[batch.fills.length - 1].date : false;
    const overnight = batch ? batchOvernight : t.overnight === true;
    const result = { id: typeof t.id === 'string' && t.id.length > 0 && t.id.length < 100 ? t.id : crypto.randomUUID(), date: t.date, symbol, market: t.market, direction: t.direction, pnl: Math.round(Number(pnl) * 100) / 100, errors, note, openReason, mode: t.mode === 'contract' ? 'contract' : 'manual', overnight };
    if (result.mode === 'contract') for (const key of ['openPrice', 'closePrice', 'volume', 'multiplier', 'fee']) result[key] = Number(t[key]);
    const strategy = String(t.strategy || '').trim();
    if (strategy.length > 40) throw new Error('策略名称不能超过 40 字');
    result.strategy = strategy;
    if (batch) Object.assign(result, batch, { mode: 'batch', multiplier: Number(t.multiplier) });
    return result;
  }
  function validateBackup(data) {
    if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.trades) || data.trades.length > 20000) throw new Error('请选择有效的交易纠错本备份，最多 20000 条记录');
    const trades = data.trades.map(validateTrade);
    if (new Set(trades.map(t => t.id)).size !== trades.length) throw new Error('备份包含重复的记录编号');
    return trades;
  }
  function stats(trades) {
    const overnightTrades = trades.filter(t => t.overnight === true);
    const overnightPnl = overnightTrades.reduce((n, t) => n + Number(t.pnl || 0), 0);
    const openCount = trades.filter(t => t.mode === 'batch' && t.status === 'open').length;
    trades = trades.filter(t => !(t.mode === 'batch' && t.status === 'open'));
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
      return { date, value: cumulative / 100, drawdown: (peak - cumulative) / 100 };
    });
    const errors = [...new Set(trades.flatMap(t => t.errors))].filter(e => e !== '无错误').map(name => {
      const related = trades.filter(t => t.errors.includes(name));
      return { name, count: related.length, loss: related.reduce((n, t) => n + Math.max(0, -Math.round(t.pnl * 100)), 0) / 100 };
    }).filter(e => e.count).sort((a, b) => b.count - a.count);
    const lossCount = trades.filter(t => t.pnl < 0).length;
    return { total: cents / 100, count: trades.length, openCount, wins, winRate: trades.length ? wins / trades.length * 100 : 0, factor: losses ? gains / losses : gains ? Infinity : null, expectancy: trades.length ? cents / 100 / trades.length : 0, averageRatio: wins && lossCount ? (gains / wins) / (losses / lossCount) : null, maxWin: Math.max(0, ...trades.map(t => t.pnl)), maxLoss: Math.min(0, ...trades.map(t => t.pnl)), drawdown: drawdown / 100, clean: trades.filter(t => t.errors.includes('无错误')).length, errors, curve, overnightCount: overnightTrades.length, overnightRate: trades.length ? overnightTrades.length / trades.length * 100 : 0, overnightPnl };
  }
  function performance(trades, by = 'symbol') {
    if (!['symbol', 'strategy', 'direction', 'month'].includes(by)) throw new Error('统计分组无效');
    const groups = new Map();
    for (const t of trades) {
      if (t.mode === 'batch' && t.status === 'open') continue;
      const key = by === 'month' ? t.date.slice(0, 7) : t[by] || '未分类';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups].map(([name, rows]) => ({ name, ...stats(rows) })).sort((a, b) => by === 'month' ? a.name.localeCompare(b.name) : b.total - a.total);
  }
  function filter(trades, { query = '', market = '', result = '', period = 'all', now = new Date() } = {}) {
    const year = now.getFullYear(), month = now.getMonth();
    return trades.filter(t => {
      const date = new Date(t.date + 'T12:00:00');
      const periodOK = period === 'all' || (period === 'month' && date.getFullYear() === year && date.getMonth() === month) || (period === 'year' && date.getFullYear() === year);
      return periodOK && (!query || (t.symbol + ' ' + t.note + ' ' + (t.strategy || '') + ' ' + t.errors.join(' ')).toLowerCase().includes(query.toLowerCase())) && (!market || t.market === market) && (!result || (result === 'win' ? t.pnl > 0 : result === 'loss' ? t.pnl < 0 : t.pnl === 0));
    }).sort((a, b) => b.date.localeCompare(a.date));
  }
  function csv(trades) {
    const cell = value => {
      let s = String(value);
      if (/^[=+@\-\t\r]/.test(s) && typeof value !== 'number') s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    return '\uFEFF' + [['日期', '品种', '市场', '方向', '隔夜单', '开仓价', '平仓价', '手数', '乘数', '手续费', '净盈亏', '错误标签', '开仓理由', '复盘笔记', '策略', '状态', '剩余数量', '分批成交明细'], ...trades.map(t => [t.date, t.symbol, t.market, t.direction, t.overnight ? '是' : '否', t.openPrice ?? '', t.closePrice ?? '', t.volume ?? '', t.multiplier ?? '', t.fee ?? '', t.pnl, t.errors.join('、'), t.openReason || '', t.note, t.strategy || '', t.status === 'open' ? '持仓中' : '已结束', t.remaining || 0, t.fills ? JSON.stringify(t.fills) : ''])].map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = { ERRORS, MARKETS, calculatePnl, batches, validateTrade, validateBackup, stats, performance, filter, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
