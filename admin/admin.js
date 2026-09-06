'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let state, selected;
function icons() { window.lucide?.createIcons(); }
function date(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '永久'; }
async function refresh() {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('本机会话失效，请重新打开会员开通工具');
  state = await response.json();
  $('history').innerHTML = state.records.map(record => `<tr><td>${date(record.issuedAt)}</td><td title="${escapeHtml(record.device)}">${escapeHtml(record.device.slice(0, 13))}…</td><td>${record.plan === 'month' ? '月度' : '永久'}</td><td>${escapeHtml(record.reference)}</td><td>${date(record.expiresAt)}</td><td><button class="secondary" data-id="${record.id}">查看激活码</button></td></tr>`).join('') || '<tr><td colspan="6">暂无签发记录</td></tr>';
}
function show(record) {
  selected = record;
  $('result').hidden = false;
  $('issuedStatus').textContent = record.reused ? '已存在，未重复续期' : '签发成功';
  $('summary').innerHTML = [['客户设备', record.device], ['会员类型', record.plan === 'month' ? '月度会员' : '永久会员'], ['到期时间', date(record.expiresAt)], ['已核账金额', '¥' + record.amount]].map(([title, value]) => `<div><dt>${title}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  $('token').value = record.token;
  $('copyStatus').textContent = '';
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('issueForm').onsubmit = async event => {
  event.preventDefault(); $('error').textContent = ''; $('issueButton').disabled = true;
  try {
    const response = await fetch('/api/issue', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: JSON.stringify({ device: $('device').value, plan: $('plan').value, reference: $('reference').value, confirmed: $('confirmed').checked }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '签发失败');
    show(result); $('confirmed').checked = false; await refresh();
  } catch (error) { $('error').textContent = error.message; }
  finally { $('issueButton').disabled = false; }
};
$('copyMessage').onclick = async () => {
  if (!selected) return;
  const message = `交易纠错本${selected.plan === 'month' ? '月度' : '永久'}会员已核账。\n设备编号：${selected.device}\n到期时间：${date(selected.expiresAt)}\n请在网站“会员中心 → 激活会员”中粘贴以下激活码：\n\n${selected.token}\n\n网址：https://zczx168-web.github.io/trade-notebook/\n激活码适用于上述浏览器设备编号，请保存激活码；换设备请联系客服。`;
  try { await navigator.clipboard.writeText(message); $('copyStatus').textContent = '开通信息已复制，可通过微信发给客户'; }
  catch { $('token').focus(); $('token').select(); $('copyStatus').textContent = '无法访问剪贴板，已选中激活码'; }
};
$('downloadLicense').onclick = () => {
  if (!selected) return;
  const url = URL.createObjectURL(new Blob([selected.token], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `会员激活-${selected.device.slice(-8)}.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
$('history').onclick = event => { const button = event.target.closest('[data-id]'); if (button) show({ ...state.records.find(record => record.id === button.dataset.id), reused: true }); };
$('refresh').onclick = () => refresh().catch(error => $('error').textContent = error.message);
$('device').oninput = () => { $('device').value = $('device').value.trim().toUpperCase(); };
icons(); refresh().catch(error => { $('error').textContent = error.message; $('issueButton').disabled = true; });
