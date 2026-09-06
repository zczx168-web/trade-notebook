/* global TradeCore, Chart, lucide */
'use strict';
const C = TradeCore;
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'trade_notebook_data_v1';
const PROFILE_KEY = 'trade_notebook_profile_v1';
const PENDING_KEY = 'trade_pending_order_v1';
const palette = ['#66947a', '#a9bcb0', '#cf9b7c', '#8698b8', '#c8b77e', '#b68e9c', '#95babb'];
const fmt = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (n > 0 ? '+' : n < 0 ? '-' : '') + fmt.format(Math.abs(n));
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let trades = [], profile = { name: '我的交易账本' }, demo = true, storageBroken = false;
let currentView = 'overview', page = 1, profitChartInstance, errorChartInstance, toastTimer;
let session = null, payPollTimer, pollGeneration = 0, authBusy = false, authMode = 'login', codeDeadline = 0;
let manualPlan = null, supportReturn = 'plans';
let deviceId = '', verifiedLicense = null, licenseRestoreError = '', licenseRevision = 0;
const titles = { overview: ['复盘总览', '把每一次交易，变成下一次进步。'], trades: ['交易记录', '记录决策的依据，也记录真实的结果。'], review: ['错误分析', '找到重复的偏差，让下一笔更有纪律。'], settings: ['账本设置', '管理你的交易账本与数据备份。'] };
function icons() { if (window.lucide) lucide.createIcons(); }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { throw new Error('本地保存失败，浏览器存储不可用或空间已满。请先导出备份。'); } }
function saveTrades(next) {
  if (storageBroken) throw new Error('已存数据无法读取，请先在设置中导出原始数据并恢复有效备份。');
  write(STORAGE_KEY, { version: 1, trades: next });
  trades = next;
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) trades = C.validateBackup(JSON.parse(raw));
    const rawProfile = localStorage.getItem(PROFILE_KEY);
    if (rawProfile) { const p = JSON.parse(rawProfile); if (typeof p.name === 'string' && p.name.trim() && p.name.length <= 24) profile.name = p.name; }
    demo = !trades.length;
  } catch { storageBroken = true; setTimeout(() => toast('已存数据无法读取，原始内容已保留。请到设置导出备份。'), 500); }
}
function sampleTrades() {
  const today = new Date(), end = today.getDate();
  const rows = [
    ['螺纹钢 RB', 860, '多', ['无错误'], '回踩前高后入场，按计划止盈。'],
    ['焦煤 JM', -420, '多', ['追涨杀跌'], '没有等待回踩。下次入场前先核对信号。'],
    ['沪铜 CU', 1280, '空', ['无错误'], '弱势反弹承压，入场与离场均按计划执行。'],
    ['黄金 AU', 540, '多', ['提前止盈'], '达到第一目标便全部平仓，后续考虑分批退出。'],
    ['焦煤 JM', -680, '空', ['扛单', '仓位过重'], '止损触发后犹豫。入场同时设置止损委托。'],
    ['豆粕 M', 920, '多', ['无错误'], '缩量回踩得到确认，耐心等待计划内机会。'],
    ['螺纹钢 RB', -350, '空', ['追涨杀跌'], '连续波动时入场过急，建立入场检查清单。'],
    ['沪银 AG', 1160, '多', ['无错误'], '执行移动止损，持有至趋势结构改变。'],
    ['焦煤 JM', 680, '多', ['提前止盈'], '观察到浮盈回撤后提前离场，重新明确出场依据。'],
    ['纯碱 SA', -290, '多', ['追涨杀跌'], '突破未经确认，不再凭单根走势下结论。'],
    ['沪铜 CU', 1420, '空', ['无错误'], '方向、仓位、止损均符合交易计划。'],
    ['螺纹钢 RB', 760, '多', ['无错误'], '遵守预设风险预算，完成一次计划内交易。']
  ];
  return rows.map((r, i) => ({ id: `demo-${i}`, date: localDate(new Date(today.getFullYear(), today.getMonth(), Math.max(1, Math.round(1 + i * (end - 1) / 11)))), symbol: r[0] + `${String(today.getFullYear()).slice(2)}10`, market: '期货', direction: r[2], pnl: r[1], errors: r[3], note: r[4], openReason: '根据趋势结构与关键价格区域制定入场计划。', mode: 'manual' }));
}
function activeTrades() { return demo ? sampleTrades() : trades; }
function filtered(extra = {}) { return C.filter(activeTrades(), { period: $('period').value, ...extra }); }
function table(list, full = false) {
  if (!list.length) return `<div class="empty-state"><i data-lucide="notebook-pen"></i><h3>${full && ($('search').value || $('marketFilter').value || $('resultFilter').value) ? '没有匹配的交易' : '还没有交易记录'}</h3><p>每一次认真记录，都是复盘的起点。</p><button class="primary" data-new><i data-lucide="plus"></i>记一笔交易</button></div>`;
  return `<div class="table-scroll" tabindex="0" aria-label="交易记录表格"><table><thead><tr><th>交易日期</th><th>品种 / 合约</th><th>方向</th><th>净盈亏 · 元</th><th>错误标签</th>${full ? '<th>复盘笔记</th>' : ''}<th>操作</th></tr></thead><tbody>${list.map(t => `<tr><td>${esc(t.date)}</td><td class="symbol-cell">${esc(t.symbol)}<small>${esc(t.market)}${t.mode === 'contract' ? ` · ${t.volume} 手` : ''}</small></td><td><span class="direction ${t.direction === '空' ? 'short' : ''}">${t.direction === '空' ? '做空' : '做多'}</span></td><td class="pnl ${t.pnl >= 0 ? 'positive' : 'negative'}">${money(t.pnl)}</td><td>${t.errors.map(e => `<span class="error-tag ${e === '无错误' ? 'clean' : ''}">${esc(e)}</span>`).join('')}</td>${full ? `<td class="note-cell" title="${esc(t.note)}">${esc(t.note) || '—'}</td>` : ''}<td><div class="row-actions"><button class="icon-button" data-edit="${esc(t.id)}" aria-label="${demo ? '查看' : '编辑'} ${esc(t.symbol)}" title="${demo ? '查看示例' : '编辑交易'}"><i data-lucide="${demo ? 'eye' : 'pencil'}"></i></button>${demo ? '' : `<button class="icon-button" data-delete="${esc(t.id)}" aria-label="删除 ${esc(t.symbol)}" title="删除交易"><i data-lucide="trash-2"></i></button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function metric(title, value, note, icon, color = '') { return `<div class="metric"><div class="metric-title">${title}<i data-lucide="${icon}"></i></div><div class="metric-value ${color}">${value}</div><div class="metric-note">${note}</div></div>`; }
function charts(s) {
  if (!window.Chart) return;
  Chart.defaults.font.family = '"Segoe UI", "Microsoft YaHei", sans-serif';
  Chart.defaults.color = '#94a095';
  Chart.defaults.font.size = 10;
  Chart.defaults.animation = false;
  if (profitChartInstance) profitChartInstance.destroy();
  if (errorChartInstance) errorChartInstance.destroy();
  const points = s.curve.length ? [{ date: '起始', value: 0 }, ...s.curve] : [];
  profitChartInstance = new Chart($('profitChart'), { type: 'line', data: { labels: points.map(p => p.date === '起始' ? p.date : p.date.slice(5).replace('-', '.')), datasets: [{ label: '累计净盈亏', data: points.map(p => p.value), borderColor: '#568b6a', borderWidth: 2, backgroundColor: '#6596740d', fill: true, tension: 0.15, pointRadius: points.length < 3 ? 3 : 0, pointHoverRadius: 4, pointBackgroundColor: '#568b6a' }] }, options: { responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#2b4e39', padding: 12, displayColors: false, callbacks: { label: item => ' ¥ ' + fmt.format(item.parsed.y) } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0, padding: 12, font: { size: 9 } } }, y: { border: { display: false }, grid: { color: '#edf1ec' }, beginAtZero: true, ticks: { maxTicksLimit: 5, padding: 10, font: { size: 9 }, callback: n => Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString() } } } } });
  const top = s.errors.slice(0, 3), rest = s.errors.slice(3).reduce((n, e) => n + e.count, 0);
  if (rest) top.push({ name: '其他错误', count: rest });
  const errorCount = s.errors.reduce((n, e) => n + e.count, 0);
  errorChartInstance = new Chart($('errorChart'), { type: 'doughnut', data: { labels: top.length ? top.map(e => e.name) : ['暂无错误'], datasets: [{ data: top.length ? top.map(e => e.count) : [1], backgroundColor: top.length ? palette : ['#edf2ec'], borderWidth: 4, borderColor: '#fff', borderRadius: 3, hoverOffset: top.length ? 3 : 0 }] }, options: { cutout: '79%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: !!top.length, callbacks: { label: c => `${c.label}：${c.raw} 次` } } } } });
  $('errorCount').textContent = errorCount;
  $('errorLegend').innerHTML = top.length ? top.map((e, i) => `<div><span class="swatch" style="background:${palette[i]}"></span><span>${esc(e.name)}</span><b>${Math.round(e.count / errorCount * 100)}%</b></div>`).join('') : '<span class="muted">暂无错误标签</span>';
  $('curveEmpty').hidden = !!s.count;
  $('curveRange').textContent = s.curve.length ? `${s.curve[0].date.slice(5)} 至 ${s.curve.at(-1).date.slice(5)}` : '';
}
const advice = { '追涨杀跌': '把入场条件写成检查清单，信号确认后再执行。', '扛单': '开仓前明确退出条件，触发条件后按预案执行。', '仓位过重': '依据止损距离和个人风险预算确定仓位。', '频繁交易': '记录每次入场依据，定期复核计划外交易。', '提前止盈': '预先写下分批止盈与最终离场条件。', '未设止损': '先确定风险边界，再决定是否开仓。' };
function render() {
  const list = filtered(), s = C.stats(list);
  $('ownBook').classList.toggle('active', !demo); $('demoBook').classList.toggle('active', demo);
  $('datasetLabel').textContent = demo ? '示例数据' : `${list.length} 笔交易`;
  $('navCount').textContent = activeTrades().length;
  $('metrics').innerHTML = metric('累计净盈亏', `<small>¥</small>${money(s.total)}`, '按已记录的平仓交易统计', 'wallet', s.total >= 0 ? 'positive' : 'negative') + metric('交易胜率', `${s.winRate.toFixed(1)}<small>%</small>`, `${s.wins} 笔盈利 / ${s.count} 笔交易`, 'crosshair') + metric('平均盈亏比', s.averageRatio === null ? '—' : s.averageRatio.toFixed(2), '平均盈利 / 平均亏损绝对值', 'scale') + metric('交易笔数', s.count, `${s.clean} 笔无错误标签`, 'layers');
  $('recentCount').textContent = `${list.length} 笔`;
  $('recentTable').innerHTML = table(list.slice(0, 5));
  $('dailyInsight').textContent = (demo || hasMembership()) && s.errors.length ? `本期「${s.errors[0].name}」出现 ${s.errors[0].count} 次。${advice[s.errors[0].name] || '回看相关记录，明确下一次的改进动作。'}` : '稳定的执行，来自每一次认真复盘。';
  $('reviewMetrics').innerHTML = metric('无错误交易占比', `${s.count ? Math.round(s.clean / s.count * 100) : 0}<small>%</small>`, `${s.clean} 笔交易标记为无错误`, 'shield-check', 'positive') + metric('最大单笔盈利', `<small>¥</small>${money(s.maxWin)}`, `最大单笔亏损 ¥${money(s.maxLoss)}`, 'trending-up') + metric('最大日终回撤', `<small>¥</small>${fmt.format(s.drawdown)}`, '累计已实现盈亏从高点回落的最大金额', 'trending-down');
  $('errorAnalysis').innerHTML = s.errors.length ? s.errors.map((e, i) => `<div class="error-analysis-row"><span><span class="rank">${String(i + 1).padStart(2, '0')}</span>${esc(e.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${e.count / s.errors[0].count * 100}%"></div></div><span class="muted">${e.count} 次</span><span class="loss-value">关联亏损 ¥${fmt.format(e.loss)}</span></div>${i < 3 ? `<p class="error-advice">${esc(advice[e.name] || '复核入场与退出条件，为下一笔交易写下明确的改进动作。')}</p>` : ''}`).join('') : '<div class="empty-state"><i data-lucide="shield-check"></i><h3>暂无交易错误</h3><p>标记交易中的偏差后，在这里查看归因。</p></div>';
  $('reviewNotes').innerHTML = list.filter(t => t.note || t.openReason).map(t => `<article class="review-note"><div><h3>${esc(t.symbol)}</h3><small>${esc(t.date)} · ${esc(t.direction)} · ${money(t.pnl)}</small></div><div>${t.openReason ? `<p><b>开仓理由：</b>${esc(t.openReason)}</p>` : ''}<p>${esc(t.note)}</p></div></article>`).join('') || '<p class="muted">暂无复盘笔记</p>';
  renderTable(); renderProfile();
  const advanced = demo || hasMembership();
  $('analyticsContent').hidden = !advanced;
  $('analyticsLocked').hidden = advanced;
  $('reviewContent').hidden = !advanced;
  $('reviewLocked').hidden = advanced;
  if (advanced && currentView === 'overview') charts(s);
  if (!advanced) {
    $('printReport').textContent = '';
    if (profitChartInstance) { profitChartInstance.destroy(); profitChartInstance = null; }
    if (errorChartInstance) { errorChartInstance.destroy(); errorChartInstance = null; }
    $('errorAnalysis').textContent = ''; $('reviewMetrics').textContent = ''; $('reviewNotes').textContent = '';
  }
  icons();
}
function renderTable() {
  const list = filtered({ query: $('search').value, market: $('marketFilter').value, result: $('resultFilter').value });
  const pages = Math.max(1, Math.ceil(list.length / 10)); page = Math.min(page, pages);
  $('allTable').innerHTML = table(list.slice((page - 1) * 10, page * 10), true);
  $('recordsSummary').textContent = `共 ${list.length} 笔交易 · 净盈亏 ¥${money(C.stats(list).total)}${demo ? ' · 示例账本' : ''}`;
  $('pageInfo').textContent = `第 ${page} / ${pages} 页`;
  $('prevPage').disabled = page <= 1; $('nextPage').disabled = page >= pages;
  icons();
}
function renderProfile() { $('profileName').innerHTML = `${esc(profile.name)}<small>${session?.user ? esc(session.user.phone) : '仅存于当前浏览器'}</small>`; $('avatar').textContent = [...profile.name][0]; $('bookName').value = profile.name; }
function route() {
  currentView = Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== currentView + 'View');
  document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === currentView); if (el.dataset.view === currentView) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('pageTitle').textContent = titles[currentView][0]; $('breadcrumb').textContent = titles[currentView][0]; $('pageSubtitle').textContent = titles[currentView][1];
  $('contextBar').hidden = currentView === 'settings';
  document.title = `${titles[currentView][0]} · 交易纠错本`;
  render(); window.scrollTo(0, 0);
}
function confirmAction(title, text, action) { $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmAction').onclick = () => { try { action(); $('confirmDialog').close(); } catch (e) { toast(e.message); } }; $('confirmDialog').showModal(); }
function tradeMode() {
  const contract = $('tradeMode').value === 'contract';
  $('contractFields').hidden = !contract; $('manualPnlLabel').hidden = contract;
  $('tradePnl').required = !contract;
  $('contractFields').querySelectorAll('input').forEach(i => i.required = contract);
  if (contract) { try { const pnl = C.calculatePnl(readForm()); $('pnlPreview').textContent = `预计净盈亏 ¥${money(pnl)}`; $('pnlPreview').className = pnl >= 0 ? 'positive' : 'negative'; } catch { $('pnlPreview').textContent = '待填写完整交易价格'; $('pnlPreview').className = 'muted'; } }
}
function openTrade(id) {
  const t = id ? activeTrades().find(t => t.id === id) : null;
  $('tradeForm').reset(); $('tradeError').textContent = ''; $('tradeId').value = t && !demo ? t.id : '';
  $('tradeDialogTitle').textContent = t ? demo ? '查看示例交易' : '编辑交易' : '记录一笔交易';
  $('tradeDate').value = t?.date || localDate(); $('tradeSymbol').value = t?.symbol || ''; $('tradeMarket').value = t?.market || '期货'; $('tradeDirection').value = t?.direction || '多'; $('tradePnl').value = t?.pnl ?? ''; $('tradeNote').value = t?.note || ''; $('openReason').value = t?.openReason || ''; $('tradeMode').value = t?.mode || 'contract';
  for (const key of ['openPrice', 'closePrice', 'volume', 'multiplier', 'fee']) $(key).value = t?.[key] ?? ({ volume: 1, multiplier: 100, fee: 0 }[key] ?? '');
  $('customErrors').value = t ? t.errors.filter(e => !C.ERRORS.includes(e)).join('，') : '';
  $('errorChoices').innerHTML = C.ERRORS.map(e => `<label><input type="checkbox" name="errors" value="${e}" ${(t?.errors || ['无错误']).includes(e) ? 'checked' : ''}>${e}</label>`).join('');
  const readOnly = !!t && demo;
  $('tradeForm').querySelectorAll('input,select,textarea,button[type=submit]').forEach(el => el.disabled = readOnly);
  tradeMode(); $('tradeDialog').showModal();
}
function readForm() { const t = { id: $('tradeId').value || crypto.randomUUID(), date: $('tradeDate').value, symbol: $('tradeSymbol').value, market: $('tradeMarket').value, direction: $('tradeDirection').value, pnl: $('tradePnl').value, note: $('tradeNote').value, openReason: $('openReason').value, mode: $('tradeMode').value, errors: [...$('errorChoices').querySelectorAll('input:checked')].map(i => i.value) }; for (const key of ['openPrice', 'closePrice', 'volume', 'multiplier', 'fee']) t[key] = $(key).value; const custom = $('customErrors').value.split(/[,，]/).map(x => x.trim()).filter(Boolean); if (custom.length) t.errors = t.errors.filter(e => e !== '无错误').concat(custom); if (!t.errors.length) t.errors = ['无错误']; return t; }
function download(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function report() {
  if (!demo && !hasMembership()) { $('printReport').textContent = ''; openVip(); return; }
  const list = filtered(); if (!list.length) return toast('暂无交易记录，无法生成报告');
  const s = C.stats(list);
  $('printReport').innerHTML = `<div class="print-heading"><h1>交易纠错本 · 专业复盘报告</h1><p>${esc(demo ? '示例账本' : profile.name)} · ${esc($('period').selectedOptions[0].text)} · 生成于 ${localDate()}</p></div><div class="print-stats"><p>交易 ${s.count} 笔　盈利 ${s.wins} 笔　胜率 ${s.winRate.toFixed(1)}%</p><p>净盈亏 ¥${money(s.total)}　平均盈亏比 ${s.averageRatio === null ? '不适用' : s.averageRatio.toFixed(2)}</p><p>最大单笔盈利 ¥${money(s.maxWin)}　最大单笔亏损 ¥${money(s.maxLoss)}</p></div><h2>高频错误与改进方案</h2>${s.errors.slice(0, 3).map(e => `<p>${esc(e.name)}（${e.count} 次）：${esc(advice[e.name] || '回顾对应交易，写下下一次可执行的改进动作。')}</p>`).join('') || '<p>暂无错误标签</p>'}<h2>完整交易记录</h2>${[...list].reverse().map(t => `<article class="print-trade"><h3>${esc(t.date)} · ${esc(t.symbol)} · 做${t.direction} · 净盈亏 ¥${money(t.pnl)}</h3>${t.mode === 'contract' ? `<p>开仓 ${t.openPrice}　平仓 ${t.closePrice}　${t.volume} 手　乘数 ${t.multiplier}　手续费 ${t.fee}</p>` : ''}<p>错误标签：${t.errors.map(esc).join('、')}</p><p>开仓理由：${esc(t.openReason || '未填写')}</p><p>教训与改进：${esc(t.note || '未填写')}</p></article>`).join('')}<p class="print-disclaimer">记录与复盘，不构成投资建议。</p>`;
  window.print();
}
// Manual entitlements require a verified signature; local flags and payment clicks grant nothing.
function apiBase() { const raw = window.TRADE_CONFIG?.apiBase; if (!raw) return ''; try { const u = new URL(raw); return u.protocol === 'https:' ? u.href.replace(/\/$/, '') : ''; } catch { return ''; } }
async function request(path, body) { const base = apiBase(); if (!base) throw new Error('服务尚未接通'); const res = await fetch(base + path, { method: body ? 'POST' : 'GET', credentials: 'include', headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken || '' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) }); if (!res.ok) throw new Error(res.status === 401 ? '请先登录账号' : '服务暂时不可用，请稍后重试'); return res.json(); }
async function refreshSession() { if (!apiBase()) return; session = await request('/me'); if (!session || typeof session !== 'object') throw new Error('账号服务返回异常'); updateMembership(); renderProfile(); render(); }
function currentMembership() {
  const remote = session?.membership;
  const activeLocal = TradeLicense.isActive(verifiedLicense);
  if (remote?.type === 'forever' || (activeLocal && verifiedLicense.plan === 'forever')) return { type: 'forever', expire: 0 };
  const remoteExpiry = remote?.type === 'month' ? Date.parse(remote.expiresAt) : 0;
  const expiry = Math.max(Number.isFinite(remoteExpiry) ? remoteExpiry : 0, activeLocal ? verifiedLicense.expiresAt : 0);
  return expiry > Date.now() ? { type: 'month', expire: expiry } : { type: 'free', expire: 0 };
}
function hasMembership() { return currentMembership().type !== 'free'; }
function updateMembership() {
  const m = currentMembership();
  const text = m.type === 'forever' ? '永久会员' : m.type === 'month' ? `月度会员 · 至 ${new Date(m.expire).toLocaleDateString('zh-CN')}` : verifiedLicense?.plan === 'month' ? '月度会员已到期' : '普通版';
  $('memberStatus').textContent = text; $('settingsMembership').textContent = text;
  $('vipLicenseStatus').textContent = text; $('activationStatus').textContent = '当前状态：' + text;
  $('accountStatus').textContent = session?.user ? `已登录 ${session.user.phone} · 交易记录仍保存在当前浏览器` : apiBase() ? '尚未登录' : '账号服务暂未接通，会员可使用激活码开通';
  $('logoutButton').hidden = !session?.user;
}
function loadDevice() {
  const saved = localStorage.getItem(TradeLicense.DEVICE_KEY);
  if (saved && !TradeLicense.DEVICE_PATTERN.test(saved)) throw new Error('设备编号损坏，请联系客服核对原设备编号');
  deviceId = saved || 'TN-' + crypto.randomUUID().replaceAll('-', '').toUpperCase();
  if (!saved) localStorage.setItem(TradeLicense.DEVICE_KEY, deviceId);
  document.querySelectorAll('[data-device-code]').forEach(element => element.textContent = deviceId);
  return deviceId;
}
async function restoreLicense() {
  const revision = ++licenseRevision;
  let claims = null, error = '';
  try { loadDevice(); const token = localStorage.getItem(TradeLicense.TOKEN_KEY); if (token) claims = await TradeLicense.verify(token, window.TRADE_LICENSE_PUBLIC_KEY, deviceId); }
  catch (failure) { error = failure.message; }
  if (revision !== licenseRevision) return;
  verifiedLicense = claims; licenseRestoreError = error;
  updateMembership(); render();
}
function openActivation() {
  ['vipModal', 'manualPayDialog', 'supportDialog'].forEach(id => $(id).close());
  try { loadDevice(); } catch (error) { licenseRestoreError = error.message; }
  $('activationError').textContent = licenseRestoreError;
  $('activationMessage').textContent = '';
  updateMembership();
  if (!$('activationDialog').open) $('activationDialog').showModal();
}
function openVip() {
  const available = !!apiBase(), manual = !!window.TRADE_CONFIG?.manualPayment;
  $('paymentNotice').textContent = manual ? '微信扫码收款 · 客服人工核验，不会自动开通。' : available ? '付款结果以支付服务确认的订单状态为准。' : '支付服务暂未接通，当前不可购买。';
  document.querySelectorAll('.pay-wechat,.pay-alipay').forEach(b => { b.disabled = !available; b.hidden = !available; });
  document.querySelectorAll('.pay-manual').forEach(b => b.hidden = !window.TRADE_CONFIG?.manualPayment?.plans?.[b.dataset.goods]);
  $('vipSupport').hidden = !manual;
  if (!$('vipModal').open) $('vipModal').showModal();
}
function setQrImage(imageId, errorId, path) {
  const image = $(imageId);
  $(errorId).hidden = true;
  image.onload = () => { $(errorId).hidden = true; };
  image.onerror = () => { $(errorId).hidden = false; };
  image.src = path;
}
function openManualPayment(goodsType) {
  const config = window.TRADE_CONFIG?.manualPayment, plan = config?.plans?.[goodsType];
  if (!plan) return toast('该收款方式暂不可用');
  manualPlan = goodsType;
  $('manualPayTitle').textContent = `${plan.name} · ¥${plan.price}`;
  $('manualPlanName').textContent = plan.name;
  $('manualAmount').textContent = '¥' + plan.price;
  $('manualDuration').textContent = plan.duration;
  $('manualMerchant').textContent = config.merchant;
  $('manualPayQr').alt = `${plan.name} ¥${plan.price} 微信收款二维码`;
  setQrImage('manualPayQr', 'manualQrError', plan.qr);
  $('savePaymentQr').href = plan.original;
  $('savePaymentQr').download = `交易纠错本-${plan.name}-${plan.price}元-微信收款码.jpg`;
  $('originalPaymentQr').href = plan.original;
  $('vipModal').close();
  if (!$('manualPayDialog').open) $('manualPayDialog').showModal();
  $('manualPayDialog').scrollTop = 0;
}
function openSupport(from = 'plans') {
  const config = window.TRADE_CONFIG?.manualPayment;
  if (!config) return toast('客服入口暂不可用');
  supportReturn = from;
  const plan = from === 'payment' ? config.plans[manualPlan] : null;
  $('supportName').textContent = config.supportName;
  $('supportPlan').textContent = plan ? `${plan.name} · ¥${plan.price} · ${plan.duration}` : '会员咨询与付款核验';
  setQrImage('supportQr', 'supportQrError', config.supportQr);
  $('saveSupportQr').href = config.supportOriginal;
  $('saveSupportQr').download = '交易纠错本-客服微信二维码.jpg';
  $('originalSupportQr').href = config.supportOriginal;
  $('backFromSupport').querySelector('span').textContent = from === 'payment' ? '返回收款码' : '返回会员中心';
  $('manualPayDialog').close(); $('vipModal').close();
  if (!$('supportDialog').open) $('supportDialog').showModal();
  $('supportDialog').scrollTop = 0;
}
function stopPoll() { clearTimeout(payPollTimer); pollGeneration++; }
function pendingOrder() { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } }
async function createPayOrder(goodsType, payType) {
  if (!apiBase()) return toast('支付服务暂未接通');
  if (!session?.user || !session.csrfToken) { $('vipModal').close(); openAuth(); return; }
  document.querySelectorAll('.pay-wechat,.pay-alipay').forEach(b => b.disabled = true);
  $('orderStatus').textContent = '正在创建订单…';
  try {
    if (pendingOrder()) { startOrderPoll(pendingOrder()); return; }
    const result = await request('/pay/orders', { goodsType, payType: payType === 'wx' ? 'wxpay' : 'alipay', returnUrl: location.origin + location.pathname });
    const u = new URL(result.payUrl);
    if (u.protocol !== 'https:' || u.username || u.password || !window.TRADE_CONFIG.checkoutOrigins.includes(u.origin) || typeof result.orderNo !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.orderNo)) throw new Error('支付服务返回了无效的收银台地址或订单编号');
    sessionStorage.setItem(PENDING_KEY, result.orderNo);
    $('orderStatus').textContent = '订单已创建，正在前往收银台。';
    location.assign(u.href);
  } catch (e) { $('orderStatus').textContent = e.message; } finally { document.querySelectorAll('.pay-wechat,.pay-alipay').forEach(b => b.disabled = false); }
}
function startOrderPoll(orderNo) {
  stopPoll(); const generation = pollGeneration, start = Date.now(); let failures = 0;
  $('resumePay').hidden = true;
  async function tick() {
    if (generation !== pollGeneration) return;
    try {
      const order = await request('/pay/orders/' + encodeURIComponent(orderNo));
      if (generation !== pollGeneration) return;
      if (order.orderNo !== orderNo || !['pending', 'success', 'fail', 'expired'].includes(order.status)) throw new Error('订单状态响应异常');
      failures = 0;
      if (order.status === 'success') { await refreshSession(); sessionStorage.removeItem(PENDING_KEY); $('orderStatus').textContent = '支付成功，会员状态已从服务器刷新。'; toast('支付成功，会员状态已更新'); return; }
      if (order.status === 'fail' || order.status === 'expired') { sessionStorage.removeItem(PENDING_KEY); $('orderStatus').textContent = order.status === 'fail' ? '订单支付失败，可重新下单。' : '订单已过期，可重新下单。'; return; }
      $('orderStatus').textContent = '订单待支付，正在查询付款结果…';
    } catch (e) { if (generation !== pollGeneration) return; failures++; $('orderStatus').textContent = e.message; }
    if (Date.now() - start > 600000 || failures >= 3) { $('resumePay').hidden = false; $('orderStatus').textContent += ' 自动查询已暂停。'; return; }
    payPollTimer = setTimeout(tick, document.hidden ? 10000 : 2500);
  }
  tick();
}
function openAuth(mode = 'login') { authMode = mode; $('authTitle').textContent = { login: '账号登录', register: '注册账号', reset: '找回密码' }[mode]; $('authPasswordLabel').hidden = mode === 'login'; $('authPassword').required = mode !== 'login'; $('authSubmit').textContent = { login: '登录', register: '完成注册', reset: '重置密码' }[mode]; $('authError').textContent = ''; $('authNotice').textContent = apiBase() ? '手机号验证码登录' : '短信与账号服务暂未接通，当前可直接使用本地账本。'; $('authSubmit').disabled = !apiBase(); $('sendCode').disabled = !apiBase() || Date.now() < codeDeadline; document.querySelectorAll('[data-auth]').forEach(b => b.classList.toggle('active', b.dataset.auth === mode)); if (!$('authDialog').open) $('authDialog').showModal(); }
function addExtraUI() {
  const gate = (id, title) => `<div id="${id}" class="member-gate" hidden><i data-lucide="lock-keyhole"></i><h3>${title}</h3><p>会员专属 · 已购买可输入客服发放的激活码</p><button class="primary" data-open-activation><i data-lucide="key-round"></i>激活会员</button><button class="text-button" data-open-vip>查看会员方案</button></div>`;
  const analytics = document.querySelector('.analysis-grid'); analytics.id = 'analyticsContent'; analytics.insertAdjacentHTML('afterend', gate('analyticsLocked', '盈亏曲线与错误分布'));
  const review = $('reviewView'); const content = document.createElement('div'); content.id = 'reviewContent'; while (review.firstChild) content.appendChild(review.firstChild); review.appendChild(content); review.insertAdjacentHTML('beforeend', gate('reviewLocked', '交易错误分析'));
  $('settingsView').insertAdjacentHTML('beforeend', '<section class="settings-section"><h2>会员激活</h2><div class="license-device"><div><span>当前设备编号</span><code data-device-code></code></div><button class="icon-button" data-copy-device title="复制设备编号" aria-label="复制设备编号"><i data-lucide="copy"></i></button></div><p class="license-hint" data-device-copy-status role="status"></p><button id="activationEntrySettings" class="secondary" data-open-activation><i data-lucide="key-round"></i>激活或续费会员</button></section>');
  $('exportCsv').insertAdjacentHTML('beforebegin', '<button class="secondary report-button" id="exportPdfBtn"><i data-lucide="file-down"></i><span>复盘报告</span></button>');
  $('tradeForm').querySelector('.form-grid').insertAdjacentHTML('afterbegin', '<label class="full">记账方式<select id="tradeMode"><option value="contract">按开平仓价计算</option><option value="manual">直接填写净盈亏</option></select></label>');
  $('tradePnl').parentElement.id = 'manualPnlLabel';
  $('manualPnlLabel').insertAdjacentHTML('beforebegin', '<div id="contractFields" class="full form-grid"><label>开仓价<input type="number" step="0.0001" min="0" id="openPrice"></label><label>平仓价<input type="number" step="0.0001" min="0" id="closePrice"></label><label>交易手数<input type="number" step="1" min="1" id="volume" value="1"></label><label>合约乘数<input type="number" step="0.0001" min="0.0001" id="multiplier" value="100"></label><label>手续费（元）<input type="number" step="0.01" min="0" id="fee" value="0"></label><div class="pnl-preview"><span id="pnlPreview" class="muted"></span></div></div>');
  $('tradeNote').parentElement.insertAdjacentHTML('beforebegin', '<label class="full">自定义错误标签<input id="customErrors" placeholder="例如：入场过早，止损过紧" maxlength="300"></label><label class="full">开仓理由<textarea id="openReason" rows="2" maxlength="2000" placeholder="当时为什么开仓"></textarea></label>');
  $('settingsView').insertAdjacentHTML('beforeend', '<section class="settings-section"><h2>账号与会员</h2><div class="setting-row"><div><h3>账号服务</h3><p id="accountStatus">账号服务暂未接通</p></div><button class="secondary" id="accountButton"><i data-lucide="user-round"></i>账号登录</button><button id="logoutButton" class="secondary" hidden>退出登录</button></div><div class="setting-row"><div><h3>会员中心</h3><p>月度会员 ¥19.90 / 30 天 · 永久会员 ¥199</p></div><button class="secondary" id="settingsVip"><i data-lucide="crown"></i>查看会员</button></div></section>');
  document.body.insertAdjacentHTML('beforeend', '<dialog id="authDialog"><div class="dialog-heading"><h2 id="authTitle">账号登录</h2><button class="icon-button" data-close="authDialog" aria-label="关闭"><i data-lucide="x"></i></button></div><div class="segmented auth-tabs"><button data-auth="login">登录</button><button data-auth="register">注册</button><button data-auth="reset">找回密码</button></div><p id="authNotice" class="auth-notice"></p><form id="authForm"><div class="form-grid"><label class="full">手机号<input id="authPhone" type="tel" pattern="1[3-9][0-9]{9}" maxlength="11" placeholder="11 位手机号" autocomplete="tel" required></label><label>短信验证码<input id="authCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><div class="code-button"><button type="button" id="sendCode" class="secondary">获取验证码</button></div><label id="authPasswordLabel" class="full" hidden>设置密码（8 至 64 位，包含字母和数字）<input id="authPassword" type="password" minlength="8" maxlength="64" autocomplete="new-password"></label></div><p class="form-error" id="authError" role="alert"></p><div class="auth-legal"><input type="checkbox" id="authAgree" required><label for="authAgree">我已阅读并同意</label><button type="button" data-policy="terms">用户协议</button><span>与</span><button type="button" data-policy="privacy">隐私说明</button></div><div class="dialog-actions"><button class="primary" id="authSubmit" type="submit">登录</button></div></form></dialog><dialog id="policyDialog"><div class="dialog-heading"><h2 id="policyTitle"></h2><button class="icon-button" data-close="policyDialog" aria-label="关闭"><i data-lucide="x"></i></button></div><div id="policyText" class="policy-text"></div></dialog><div id="printReport"></div>');
}
load(); addExtraUI();
$('today').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
$('newTrade').onclick = () => openTrade();
$('ownBook').onclick = () => { demo = false; page = 1; render(); }; $('demoBook').onclick = () => { demo = true; page = 1; render(); };
$('period').onchange = () => { page = 1; render(); };
['search', 'marketFilter', 'resultFilter'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 1; renderTable(); }));
$('prevPage').onclick = () => { page--; renderTable(); }; $('nextPage').onclick = () => { page++; renderTable(); };
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.goto) location.hash = b.dataset.goto;
  if (b.hasAttribute('data-new')) openTrade();
  if (b.dataset.edit) openTrade(b.dataset.edit);
  if (b.dataset.delete) { const t = trades.find(t => t.id === b.dataset.delete); if (t) confirmAction('删除这笔交易？', `${t.date} · ${t.symbol} · 净盈亏 ¥${money(t.pnl)}。删除后无法撤销。`, () => { saveTrades(trades.filter(x => x.id !== t.id)); render(); toast('交易已删除'); }); }
  if (b.dataset.close) $(b.dataset.close).close();
  if (b.hasAttribute('data-open-activation')) openActivation();
  if (b.hasAttribute('data-open-vip')) openVip();
  if (b.hasAttribute('data-copy-device')) {
    try {
      loadDevice();
      navigator.clipboard.writeText(deviceId).then(() => document.querySelectorAll('[data-device-copy-status]').forEach(el => el.textContent = '设备编号已复制，可发送给客服')).catch(() => { document.querySelectorAll('[data-device-copy-status]').forEach(el => el.textContent = '复制不可用，请选中并复制上方完整设备编号'); });
    } catch (error) { document.querySelectorAll('[data-device-copy-status]').forEach(el => el.textContent = error.message); }
  }
  if (b.dataset.auth) openAuth(b.dataset.auth);
  if (b.dataset.policy) { const privacy = b.dataset.policy === 'privacy'; $('policyTitle').textContent = privacy ? '隐私说明' : '用户协议'; $('policyText').textContent = privacy ? '交易、笔记、随机生成的设备编号和已验证的激活码保存在当前浏览器，不会自动上传。GitHub Pages 可能处理访问日志。付款在微信中完成；核账时由你主动将付款凭证及设备编号发送给客服，客服在本机记录交易单号与签发信息。清除浏览器数据会移除账本及设备编号，请保留账本备份和激活码；换设备请联系客服。当前未接通在线账号服务，不发送手机号或密码。' : '本工具用于交易记录与复盘，不提供交易执行或投资建议。基础记账、统计、CSV 和数据备份免费；个人盈亏图表、错误分析与完整复盘报告为会员功能，示例账本可免费预览。月度会员 19.90 元，从激活码签发时起 30 天，续费顺延；永久会员 199 元，无固定到期日。微信付款后由客服核账并签发绑定浏览器设备编号的激活码，本站不自动确认付款。换设备、退款和服务安排请与客服确认。'; $('policyDialog').showModal(); }
});
$('tradeForm').onsubmit = e => { e.preventDefault(); try { const t = C.validateTrade(readForm()); const next = [...trades]; const i = next.findIndex(x => x.id === t.id); if (i >= 0) next[i] = t; else next.push(t); saveTrades(next); demo = false; $('tradeDialog').close(); render(); toast(i >= 0 ? '交易已更新' : '交易已保存到我的账本'); } catch (error) { $('tradeError').textContent = error.message; } };
$('tradeMode').onchange = tradeMode; $('tradeDirection').onchange = tradeMode; $('contractFields').oninput = tradeMode;
$('errorChoices').onchange = e => { if (e.target.checked) $('errorChoices').querySelectorAll('input').forEach(i => { if (i !== e.target && (e.target.value === '无错误' || i.value === '无错误')) i.checked = false; }); };
$('profileButton').onclick = () => location.hash = 'settings';
$('profileForm').onsubmit = e => { e.preventDefault(); try { const name = $('bookName').value.trim(); if (!name || name.length > 24) throw new Error('账本名称应为 1 至 24 个字'); write(PROFILE_KEY, { name }); profile.name = name; renderProfile(); toast('账本名称已保存'); } catch (error) { toast(error.message); } };
$('exportCsv').onclick = () => { const list = filtered(currentView === 'trades' ? { query: $('search').value, market: $('marketFilter').value, result: $('resultFilter').value } : {}); if (!list.length) return toast('暂无可导出的记录'); download(C.csv(list), `${demo ? '示例账本' : '交易记录'}-${localDate()}.csv`, 'text/csv;charset=utf-8'); };
$('exportPdfBtn').onclick = report;
$('backupButton').onclick = () => { try { download(storageBroken ? localStorage.getItem(STORAGE_KEY) || '{}' : JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), trades }, null, 2), `交易纠错本备份-${localDate()}.json`, 'application/json'); } catch (e) { toast(e.message); } };
$('importButton').onclick = () => $('importFile').click();
$('importFile').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { if (file.size > 20000000) throw new Error('备份文件不能超过 20 MB'); const next = C.validateBackup(JSON.parse(await file.text())); confirmAction('恢复账本备份？', `备份包含 ${next.length} 笔交易，将替换我的账本现有的 ${trades.length} 笔记录。请确认已导出当前备份。`, () => { write(STORAGE_KEY, { version: 1, trades: next }); storageBroken = false; trades = next; demo = false; render(); toast('备份已恢复'); }); } catch (error) { toast(error instanceof SyntaxError ? 'JSON 文件格式不正确' : error.message); } finally { e.target.value = ''; } };
$('openVipModal').onclick = openVip; $('settingsVip').onclick = openVip; $('closeVipModal').onclick = () => $('vipModal').close(); $('vipModal').addEventListener('close', stopPoll);
document.querySelectorAll('.pay-manual').forEach(b => b.onclick = () => openManualPayment(b.dataset.goods));
$('vipSupport').onclick = () => openSupport('plans');
$('paymentSupport').onclick = () => openSupport('payment');
$('backToPlans').onclick = () => { $('manualPayDialog').close(); openVip(); };
$('backFromSupport').onclick = () => { $('supportDialog').close(); if (supportReturn === 'payment') openManualPayment(manualPlan); else openVip(); };
$('activationSupport').onclick = () => { $('activationDialog').close(); openSupport('plans'); };
$('activationForm').onsubmit = async event => {
  event.preventDefault(); const revision = ++licenseRevision;
  $('activateLicense').disabled = true; $('activationError').textContent = ''; $('activationMessage').textContent = '';
  try {
    loadDevice(); const token = $('activationToken').value.trim();
    const claims = await TradeLicense.verify(token, window.TRADE_LICENSE_PUBLIC_KEY, deviceId);
    if (!TradeLicense.isActive(claims)) throw new Error(claims.issuedAt > Date.now() ? '激活码尚未生效，请核对设备时间' : '此月度激活码已到期，请联系客服续费');
    if (!TradeLicense.isUpgrade(verifiedLicense, claims)) throw new Error('当前会员期限更长，此旧激活码不会覆盖现有会员');
    if (revision !== licenseRevision) return;
    localStorage.setItem(TradeLicense.TOKEN_KEY, token); verifiedLicense = claims; licenseRestoreError = '';
    updateMembership(); render();
    $('activationMessage').textContent = '激活成功，个人盈亏图表、错误分析与复盘报告已解锁。';
  } catch (error) { if (revision === licenseRevision) $('activationError').textContent = error.message; }
  finally { $('activateLicense').disabled = false; }
};
$('importLicense').onclick = () => $('licenseFile').click();
$('licenseFile').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 10000) throw new Error('激活文件过大，请选择客服提供的激活文件'); $('activationToken').value = (await file.text()).trim(); $('activationForm').requestSubmit(); }
  catch (error) { $('activationError').textContent = error.message; }
  finally { event.target.value = ''; }
};
document.querySelectorAll('.pay-wechat').forEach(b => b.onclick = () => createPayOrder(b.dataset.goods, 'wx')); document.querySelectorAll('.pay-alipay').forEach(b => b.onclick = () => createPayOrder(b.dataset.goods, 'alipay'));
$('resumePay').onclick = () => { const no = pendingOrder(); if (no) startOrderPoll(no); };
$('accountButton').onclick = () => openAuth();
$('logoutButton').onclick = async () => { try { await request('/auth/logout', {}); stopPoll(); sessionStorage.removeItem(PENDING_KEY); session = null; updateMembership(); renderProfile(); toast('已退出登录'); } catch (e) { toast(e.message); } };
$('sendCode').onclick = async () => { if (authBusy || Date.now() < codeDeadline) return; if (!/^1[3-9]\d{9}$/.test($('authPhone').value)) { $('authError').textContent = '请输入有效的 11 位手机号'; return; } if (!$('authAgree').checked) { $('authError').textContent = '请先阅读并同意用户协议与隐私说明'; return; } authBusy = true; $('sendCode').disabled = true; try { if (!session?.csrfToken) await refreshSession(); await request('/auth/code', { phone: $('authPhone').value, purpose: authMode }); codeDeadline = Date.now() + 60000; toast('验证码已发送'); const timer = setInterval(() => { const sec = Math.ceil((codeDeadline - Date.now()) / 1000); $('sendCode').textContent = sec > 0 ? `${sec} 秒后重试` : '获取验证码'; if (sec <= 0) { clearInterval(timer); $('sendCode').disabled = false; } }, 1000); } catch (e) { $('authError').textContent = e.message; $('sendCode').disabled = false; } finally { authBusy = false; } };
$('authForm').onsubmit = async e => { e.preventDefault(); if (authBusy) return; const password = $('authPassword').value; if (authMode !== 'login' && !/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(password)) { $('authError').textContent = '密码需为 8 至 64 位，包含字母和数字'; return; } authBusy = true; $('authSubmit').disabled = true; try { if (!session?.csrfToken) await refreshSession(); await request('/auth/' + authMode, { phone: $('authPhone').value, code: $('authCode').value, ...(authMode !== 'login' ? { password } : {}) }); $('authPassword').value = ''; $('authCode').value = ''; if (authMode === 'reset') { openAuth('login'); toast('密码已重置，请重新登录'); } else { await refreshSession(); $('authDialog').close(); toast('登录成功'); } } catch (error) { $('authError').textContent = error.message; } finally { authBusy = false; $('authSubmit').disabled = !apiBase(); } };
window.addEventListener('hashchange', route);
window.addEventListener('storage', e => { if (e.key === STORAGE_KEY || e.key === PROFILE_KEY) { load(); render(); } if (e.key === TradeLicense.TOKEN_KEY || e.key === TradeLicense.DEVICE_KEY || e.key === null) restoreLicense(); });
window.addEventListener('pagehide', stopPoll);
route(); updateMembership(); restoreLicense();
let lastMembershipStatus = JSON.stringify(currentMembership());
function checkExpiry() { const status = JSON.stringify(currentMembership()); if (status !== lastMembershipStatus) { lastMembershipStatus = status; $('printReport').textContent = ''; updateMembership(); render(); } }
setInterval(checkExpiry, 15000); window.addEventListener('focus', checkExpiry);
if (apiBase()) refreshSession().then(() => { const no = pendingOrder(); if (no && session?.user) { openVip(); startOrderPoll(no); } }).catch(() => toast('账号服务暂时不可用，本地账本仍可使用'));
