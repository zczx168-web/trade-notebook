/* global TradeVault, TradeCore, Chart */
'use strict';
const V = TradeVault;
const BACKUP_META = 'trade_backup_status_v1';
let bookState = null, formBaseRaw = null, restoreCandidate = null, restoreBaseRaw = null, pendingBackup = null;
let monthlyChart, drawdownChart;
function applyBook(book) { bookState = book; trades = book.trades; profile = book.profile; storageBroken = false; }
function backupMeta() { try { return JSON.parse(localStorage.getItem(BACKUP_META)) || {}; } catch { return {}; } }
function backupStatus() {
  if (!$('backupStatus')) return;
  const meta = backupMeta(), changes = bookState?.changes || 0;
  const missing = !meta.confirmedAt || meta.revision !== bookState?.revision;
  const dirty = Math.max(0, changes - (meta.changes || 0));
  $('backupStatus').textContent = storageBroken ? '账本读取异常，可导出原始数据后恢复有效备份。' : `${meta.confirmedAt ? '上次确认备份：' + new Date(meta.confirmedAt).toLocaleString('zh-CN') : '尚未确认外部备份'}${missing ? ` · 有未备份数据（${dirty} 次更改）` : ' · 当前账本已备份'}`;
  const days = meta.days ?? 7;
  $('backupReminder').value = String(days);
  $('backupBanner').hidden = !storageBroken && (!days || (!trades.length && !changes) || !missing || (meta.confirmedAt && dirty < 10 && Date.now() - meta.confirmedAt < days * 86400000));
  $('backupBannerText').textContent = storageBroken ? '账本读取异常，请先保留原始数据。' : '账本有未备份数据，请保存一份外部备份。';
  $('undoRestore').disabled = !bookState?.recovery || bookState.recovery.damaged;
  $('downloadRecovery').disabled = !bookState?.recovery;
  $('confirmBackupSaved').hidden = !pendingBackup;
}
async function exportBackup() {
  try {
    if (storageBroken) { download(localStorage.getItem(STORAGE_KEY) || '{}', `账本原始数据-${localDate()}.json`, 'application/json'); return; }
    const source = V.read(localStorage), file = await V.backup(source);
    download(JSON.stringify(file, null, 2), `交易纠错本备份-${localDate()}.json`, 'application/json');
    pendingBackup = { revision: source.revision, changes: source.changes };
    backupStatus(); toast('已发起备份下载，请保存文件后在账本设置中确认');
  } catch (error) { toast(error.message); }
}
function restorePreview() {
  if (!restoreCandidate) return;
  const merge = $('restoreMerge').checked;
  const result = V.merge(storageBroken ? [] : trades, restoreCandidate.trades);
  $('restoreSummary').textContent = `备份：${restoreCandidate.trades.length} 笔 · ${restoreCandidate.checked ? '完整性校验通过' : '旧版备份，无校验码'}\n当前账本：${trades.length} 笔\n${merge ? `新增 ${result.added} 笔，跳过 ${result.duplicates} 笔重复记录，保留 ${result.conflicts} 笔同编号冲突的本地记录。` : `将替换为 ${restoreCandidate.trades.length} 笔记录${restoreCandidate.profile ? '，并恢复备份中的账本名称' : ''}。`}\n恢复前将保存本机快照；会员和试用状态不变。`;
}
async function prepareRestore(file) {
  if (!file) return;
  try {
    if (file.size > 20000000) throw new Error('备份文件不能超过 20 MB');
    const candidate = await V.parseBackup(await file.text());
    restoreCandidate = candidate; restoreBaseRaw = localStorage.getItem(STORAGE_KEY);
    if (!storageBroken) applyBook(V.read(localStorage));
    $('restoreMerge').disabled = storageBroken;
    $('restoreMerge').checked = !storageBroken; $('restoreReplace').checked = storageBroken;
    $('restoreError').textContent = ''; restorePreview(); $('restoreDialog').showModal();
  } catch (error) { toast(error instanceof SyntaxError ? '备份 JSON 格式不正确，当前账本未改动' : error.message); }
}
function restoreBook() {
  try {
    if (!restoreCandidate) return;
    const merge = $('restoreMerge').checked;
    const next = { version: 2, trades: merge ? V.merge(trades, restoreCandidate.trades).trades : restoreCandidate.trades, profile: merge ? profile : restoreCandidate.profile || profile };
    applyBook(V.commit(localStorage, restoreBaseRaw, next, { snapshot: true, allowDamaged: storageBroken }));
    restoreCandidate = null; demo = false; $('restoreDialog').close(); render(); toast('备份已恢复，恢复前快照已保存');
  } catch (error) { $('restoreError').textContent = error.message; }
}
function undoRecovery() {
  const recovery = bookState?.recovery, expected = bookState?.raw;
  if (!recovery || recovery.damaged) return;
  confirmAction('恢复到上一个快照？', '将撤销快照之后的账本更改。会员状态不变，请先导出当前备份。', () => {
    applyBook(V.commit(localStorage, expected, recovery, { snapshot: true }));
    demo = false; render(); toast('已恢复快照，当前版本也已保留为快照');
  });
}
async function downloadRecovery() {
  try {
    const recovery = bookState?.recovery;
    if (!recovery) return;
    const raw = recovery.damaged ? recovery.raw : JSON.stringify(await V.backup(recovery), null, 2);
    download(raw || '{}', `账本恢复点-${localDate()}.json`, 'application/json');
  } catch (error) { toast(error.message); }
}
function addFill(fill = {}, readOnly = false) {
  if ($('fillRows').children.length >= 100) return toast('最多 100 条成交');
  const row = document.createElement('div'); row.className = 'fill-row';
  row.innerHTML = '<label>成交日期<input data-fill="date" type="date"></label><label>动作<select data-fill="action"><option value="open">开仓 / 加仓</option><option value="close">平仓 / 减仓</option></select></label><label>成交价<input data-fill="price" type="number" step="0.0001" min="0"></label><label>数量<input data-fill="quantity" type="number" step="0.0001" min="0.0001"></label><label>本次费用<input data-fill="fee" type="number" step="0.01" min="0"></label><button type="button" class="icon-button" data-remove-fill title="删除成交" aria-label="删除成交"><i data-lucide="trash-2"></i></button>';
  const defaults = { date: $('tradeDate').value || localDate(), action: 'open', quantity: 1, price: '', fee: 0 };
  row.querySelectorAll('[data-fill]').forEach(input => { input.value = fill[input.dataset.fill] ?? defaults[input.dataset.fill]; input.disabled = readOnly; });
  row.querySelector('button').disabled = readOnly;
  $('fillRows').appendChild(row); icons();
}
function readFills() { return [...$('fillRows').children].map(row => Object.fromEntries([...row.querySelectorAll('[data-fill]')].map(input => [input.dataset.fill, input.value]))); }
function batchPreview() {
  if ($('tradeMode').value !== 'batch') return;
  try {
    const result = C.batches({ fills: readFills(), direction: $('tradeDirection').value, multiplier: $('batchMultiplier').value, market: $('tradeMarket').value });
    $('tradeDate').value = result.date;
    $('batchPreview').textContent = `已实现净盈亏 ¥${money(result.pnl)} · 费用 ¥${fmt.format(result.fee)}\n${result.status === 'open' ? `持仓中：剩余 ${result.remaining}，移动平均成本 ${result.averagePrice}` : '已全部平仓，可计入绩效统计'}`;
    $('batchPreview').classList.remove('invalid');
  } catch (error) { $('batchPreview').textContent = error.message; $('batchPreview').classList.add('invalid'); }
}
function fillSummary(t) {
  if (t.mode !== 'batch') return '';
  return `<p>分批成交 · ${t.status === 'open' ? '持仓中' : '已结束'} · 剩余 ${t.remaining} · 乘数 ${t.multiplier}</p><div class="table-scroll"><table><thead><tr><th>日期</th><th>动作</th><th>价格</th><th>数量</th><th>费用</th></tr></thead><tbody>${t.fills.map(f => `<tr><td>${esc(f.date)}</td><td>${f.action === 'open' ? '开仓' : '平仓'}</td><td>${f.price}</td><td>${f.quantity}</td><td>${f.fee}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderBatchBadges() {
  document.querySelectorAll('[data-edit]').forEach(button => {
    const trade = activeTrades().find(t => t.id === button.dataset.edit);
    if (trade?.mode !== 'batch') return;
    const cell = button.closest('tr').querySelector('.symbol-cell');
    cell.querySelector('.trade-open')?.remove();
    const badge = document.createElement('span'); badge.className = 'trade-open';
    badge.textContent = trade.status === 'open' ? `持仓中 · 剩余 ${trade.remaining} · 盈亏为已实现金额` : `分批成交 ${trade.fills.length} 条 · 已结束`;
    cell.appendChild(badge);
  });
}
function destroyPerformance() {
  if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
  if (drawdownChart) { drawdownChart.destroy(); drawdownChart = null; }
}
function renderPerformance(list, enabled) {
  $('performanceSection').hidden = !enabled;
  destroyPerformance();
  if (!enabled) { $('performanceTable').textContent = ''; $('performanceMetrics').textContent = ''; return; }
  const s = C.stats(list), groups = C.performance(list, $('performanceGroup').value);
  $('performanceMetrics').innerHTML = [['盈利因子', s.factor === null ? '暂无' : s.factor === Infinity ? '无亏损样本' : s.factor.toFixed(2)], ['平均每笔净盈亏', money(s.expectancy)], ['已结束 / 持仓中', `${s.count} / ${s.openCount}`]].map(([name, value]) => `<div><span>${name}</span><b>${value}</b></div>`).join('');
  $('performanceTable').innerHTML = groups.length ? `<div class="table-scroll"><table class="performance-table"><thead><tr><th>分组</th><th>已结束</th><th>净盈亏</th><th>胜率</th><th>平均每笔</th></tr></thead><tbody>${groups.map(g => `<tr><td>${esc(g.name)}</td><td>${g.count}</td><td class="${g.total >= 0 ? 'positive' : 'negative'}">${money(g.total)}</td><td>${g.winRate.toFixed(1)}%</td><td>${money(g.expectancy)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="performance-note">当前范围内暂无已结束交易。</p>';
  if (currentView !== 'overview' || !window.Chart) return;
  const months = C.performance(list, 'month');
  const options = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 0, maxTicksLimit: 6 } }, y: { beginAtZero: true } } };
  monthlyChart = new Chart($('monthlyChart'), { type: 'bar', data: { labels: months.map(g => g.name), datasets: [{ data: months.map(g => g.total), backgroundColor: months.map(g => g.total >= 0 ? '#66947a' : '#c27972') }] }, options });
  drawdownChart = new Chart($('drawdownChart'), { type: 'line', data: { labels: s.curve.map(p => p.date), datasets: [{ data: s.curve.map(p => -p.drawdown), borderColor: '#b57d58', backgroundColor: '#b57d5818', fill: true, pointRadius: 0, borderWidth: 2 }] }, options });
}
function setupWorkflows() {
  $('backupButton').closest('.setting-row').querySelector('p').textContent = '包含全部交易、分批明细、策略和账本名称。';
  $('importButton').closest('.setting-row').querySelector('p').textContent = '预览 JSON 备份，选择合并或替换，恢复前保留快照。';
  $('contextBar').insertAdjacentHTML('beforebegin', '<div id="backupBanner" class="backup-banner" role="status" hidden><i data-lucide="hard-drive-download"></i><span id="backupBannerText"></span><button class="secondary" data-backup>导出备份</button></div>');
  $('backupButton').closest('.settings-section').insertAdjacentHTML('beforeend', '<p id="backupStatus" class="backup-status" role="status"></p><div class="backup-options"><label for="backupReminder">备份提醒</label><select id="backupReminder"><option value="1">每天</option><option value="7">每 7 天</option><option value="30">每 30 天</option><option value="0">关闭提醒</option></select></div><div class="backup-actions"><button id="confirmBackupSaved" class="secondary" hidden><i data-lucide="check"></i>已保存备份文件</button><button id="undoRestore" class="secondary" disabled><i data-lucide="undo-2"></i>恢复上个快照</button><button id="downloadRecovery" class="secondary" disabled><i data-lucide="download"></i>导出恢复点</button></div><p class="performance-note">本机快照不能防止浏览器数据被清除。外部备份包含全部交易、分批明细和账本名称；会员激活码请另外保留。</p>');
  document.body.insertAdjacentHTML('beforeend', '<dialog id="restoreDialog" aria-labelledby="restoreTitle"><div class="dialog-heading"><h2 id="restoreTitle">恢复备份预览</h2><button class="icon-button" data-close="restoreDialog" aria-label="取消恢复"><i data-lucide="x"></i></button></div><div class="restore-options"><label><input id="restoreMerge" type="radio" name="restoreMode" checked>合并，保留本地冲突记录</label><label><input id="restoreReplace" type="radio" name="restoreMode">替换全部交易</label></div><p id="restoreSummary"></p><p id="restoreError" class="form-error" role="alert"></p><div class="dialog-actions"><button class="secondary" data-close="restoreDialog">取消</button><button id="applyRestore" class="primary"><i data-lucide="rotate-ccw"></i>确认恢复</button></div></dialog>');
  $('tradeMode').insertAdjacentHTML('beforeend', '<option value="batch">分批开平仓</option>');
  $('contractFields').insertAdjacentHTML('afterend', '<section id="batchFields" class="full" hidden><label>合约乘数<input id="batchMultiplier" type="number" min="0.0001" step="0.0001" value="100"></label><div class="batch-head"><h3>成交明细</h3><button type="button" id="addFill" class="secondary"><i data-lucide="plus"></i>添加成交</button></div><div id="fillRows"></div><p id="batchPreview" class="batch-preview" role="status"></p><p class="performance-note">按行顺序、移动平均成本计算，费用在对应成交扣除。日期取最后一条成交日期；未全部平仓的交易不计入绩效统计。</p></section>');
  $('tradeSymbol').parentElement.insertAdjacentHTML('afterend', '<label class="trade-strategy">策略<input id="tradeStrategy" maxlength="40" placeholder="例如：趋势突破"></label>');
  document.querySelector('.trades-section').insertAdjacentHTML('beforebegin', '<section id="performanceSection" class="performance-section"><div class="performance-toolbar"><h2>绩效分析</h2><select id="performanceGroup" aria-label="绩效分组"><option value="symbol">按品种合约</option><option value="strategy">按策略</option><option value="direction">按多空方向</option><option value="month">按月份</option></select></div><div id="performanceMetrics" class="performance-metrics"></div><div class="performance-charts"><div><h3>月度净盈亏 · 元</h3><div class="performance-chart"><canvas id="monthlyChart" aria-label="月度净盈亏柱状图" role="img"></canvas></div></div><div><h3>日终回撤 · 元</h3><div class="performance-chart"><canvas id="drawdownChart" aria-label="日终回撤曲线" role="img"></canvas></div></div></div><div id="performanceTable"></div><p class="performance-note">仅统计已结束交易，按结束日期归属；不包含持仓浮盈亏，不代表账户净值或资金收益率。盈利因子 = 盈利总额 / 亏损总额绝对值。</p></section>');
  $('backupReminder').onchange = () => { try { write(BACKUP_META, { ...backupMeta(), days: Number($('backupReminder').value) }); backupStatus(); } catch (error) { toast(error.message); } };
  $('confirmBackupSaved').onclick = () => { try { if (!pendingBackup) return; write(BACKUP_META, { ...backupMeta(), ...pendingBackup, confirmedAt: Date.now() }); pendingBackup = null; backupStatus(); toast('已记录备份确认时间'); } catch (error) { toast(error.message); } };
  $('restoreMerge').onchange = $('restoreReplace').onchange = restorePreview;
  $('applyRestore').onclick = restoreBook; $('undoRestore').onclick = undoRecovery; $('downloadRecovery').onclick = downloadRecovery;
  $('addFill').onclick = () => { addFill(); tradeMode(); };
  $('batchFields').oninput = batchPreview;
  $('fillRows').onclick = event => { const button = event.target.closest('[data-remove-fill]'); if (button) { button.closest('.fill-row').remove(); batchPreview(); } };
  $('performanceGroup').onchange = () => renderPerformance(filtered(), demo || hasMembership());
}
