const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const License = require('../site/license-core.js');
const DAY = 86400000;
function home() {
  return process.env.TRADE_LICENSE_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'TradeNotebookIssuer');
}
function initialize(directory = home()) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(directory, 'issuer.private.pem');
  if (!fs.existsSync(keyPath)) {
    if (fs.existsSync(path.join(directory, 'issuer-state.json'))) throw new Error('签发记录存在但私钥缺失，请恢复原私钥备份，不能重新生成');
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  return { directory, privateKey, publicKey };
}
function readState(directory) {
  const file = path.join(directory, 'issuer-state.json');
  if (!fs.existsSync(file)) return { version: 1, records: [] };
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.version !== 1 || !Array.isArray(state.records)) throw new Error('签发记录损坏，请恢复备份');
  return state;
}
function issue(store, input, now = Date.now()) {
  if (input.confirmed !== true) throw new Error('请先核实收款，再确认签发');
  const device = License.normalizeDevice(input.device);
  const reference = String(input.reference || '').trim();
  if (!License.DEVICE_PATTERN.test(device)) throw new Error('设备编号格式不正确');
  if (!['month', 'forever'].includes(input.plan)) throw new Error('请选择会员类型');
  if (!/^[A-Za-z0-9._-]{6,100}$/.test(reference)) throw new Error('请填写真实微信交易单号（6 至 100 位字母、数字或 ._-）');
  const lock = path.join(store.directory, 'issue.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { throw new Error('另一个签发操作正在进行；如上次异常退出，请按操作说明处理锁文件'); }
  try {
    const state = readState(store.directory);
    const existing = state.records.find(record => record.reference === reference);
    if (existing) {
      if (existing.device !== device || existing.plan !== input.plan) throw new Error('此交易单号已用于另一设备或会员类型，不能重复开通');
      return { ...existing, reused: true };
    }
    const previous = state.records.filter(record => record.device === device);
    if (previous.some(record => record.plan === 'forever')) throw new Error('此设备已有永久会员，请在历史记录中复制原激活码');
    const latestExpiry = Math.max(now, ...previous.filter(record => record.plan === 'month').map(record => record.expiresAt));
    const claims = { v: 1, app: 'trade-notebook', id: crypto.randomUUID(), device, plan: input.plan, issuedAt: now, expiresAt: input.plan === 'month' ? latestExpiry + 30 * DAY : 0 };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.sign('sha256', Buffer.from('TN1.' + payload), { key: store.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const record = { ...claims, reference, amount: input.plan === 'month' ? '19.90' : '199.00', token: `TN1.${payload}.${signature}` };
    state.records.push(record);
    const temp = path.join(store.directory, `state-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, path.join(store.directory, 'issuer-state.json'));
    return { ...record, reused: false };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
module.exports = { home, initialize, readState, issue };
