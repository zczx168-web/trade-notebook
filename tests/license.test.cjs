const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../site/license-core.js');
const Issuer = require('../scripts/issuer-lib.cjs');
const device = 'TN-' + 'A'.repeat(32), another = 'TN-' + 'B'.repeat(32);
const now = Date.now(), day = 86400000;
function store(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trade-issuer-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return Issuer.initialize(dir); }
const input = overrides => ({ device, plan: 'month', reference: 'WECHAT000001', confirmed: true, ...overrides });
test('signed monthly code verifies for the correct browser and expires exactly on schedule', async t => {
  const s = store(t), record = Issuer.issue(s, input(), now);
  const claims = await C.verify(record.token, s.publicKey, device);
  assert.equal(claims.expiresAt, now + 30 * day);
  assert.equal(C.isActive(claims, claims.expiresAt - 1), true);
  assert.equal(C.isActive(claims, claims.expiresAt), false);
  assert.equal(C.isActive(claims, now - 1), false);
  await assert.rejects(C.verify(record.token, s.publicKey, another), /不属于/);
});
test('modified payload, signature, public key and malformed tokens do not grant access', async t => {
  const s = store(t), record = Issuer.issue(s, input(), now), parts = record.token.split('.');
  const forged = JSON.parse(Buffer.from(parts[1], 'base64url')); forged.plan = 'forever'; forged.expiresAt = 0;
  await assert.rejects(C.verify(['TN1', Buffer.from(JSON.stringify(forged)).toString('base64url'), parts[2]].join('.'), s.publicKey, device));
  const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
  await assert.rejects(C.verify([parts[0], parts[1], signature.toString('base64url')].join('.'), s.publicKey, device));
  const different = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  await assert.rejects(C.verify(record.token, different, device));
  for (const malformed of ['free', 'TN1.abc.xyz', record.token + '.extra', 'x'.repeat(9000)]) await assert.rejects(C.verify(malformed, s.publicKey, device));
});
test('reusing a payment reference is idempotent and cannot grant another device', t => {
  const s = store(t), first = Issuer.issue(s, input(), now);
  const second = Issuer.issue(s, input(), now + day);
  assert.equal(second.token, first.token); assert.equal(second.reused, true);
  assert.equal(Issuer.readState(s.directory).records.length, 1);
  assert.throws(() => Issuer.issue(s, input({ device: another }), now), /不能重复/);
  assert.throws(() => Issuer.issue(s, input({ plan: 'forever' }), now), /不能重复/);
});
test('monthly renewal extends current expiry, expired renewal starts now, permanent cannot be downgraded', async t => {
  const s = store(t), first = Issuer.issue(s, input(), now);
  const renewed = Issuer.issue(s, input({ reference: 'WECHAT000002' }), now + day);
  assert.equal(renewed.expiresAt, first.expiresAt + 30 * day);
  const late = Issuer.issue(s, input({ reference: 'WECHAT000003' }), now + 100 * day);
  assert.equal(late.expiresAt, now + 130 * day);
  const forever = Issuer.issue(s, input({ reference: 'WECHAT000004', plan: 'forever' }), now + 101 * day);
  const claims = await C.verify(forever.token, s.publicKey, device);
  assert.equal(C.isActive(claims, now + 10000 * day), true);
  assert.equal(C.isUpgrade(claims, first, now + 101 * day), false);
  assert.throws(() => Issuer.issue(s, input({ reference: 'WECHAT000005' }), now + 102 * day), /永久/);
});
test('receipt confirmation, device, plan and reference are required; corrupted ledger fails closed', t => {
  const s = store(t);
  for (const override of [{ confirmed: false }, { device: '123' }, { plan: 'week' }, { reference: '' }]) assert.throws(() => Issuer.issue(s, input(override), now));
  fs.writeFileSync(path.join(s.directory, 'issuer-state.json'), '{broken');
  assert.throws(() => Issuer.issue(s, input(), now));
  assert.equal(fs.existsSync(path.join(s.directory, 'issue.lock')), false);
});
test('reinitialization keeps the signing identity; missing private key with ledger never regenerates it', t => {
  const s = store(t); assert.deepEqual(Issuer.initialize(s.directory).publicKey, s.publicKey);
  Issuer.issue(s, input(), now);
  fs.unlinkSync(path.join(s.directory, 'issuer.private.pem'));
  assert.throws(() => Issuer.initialize(s.directory), /私钥缺失/);
  assert.equal(fs.existsSync(path.join(s.directory, 'issuer.private.pem')), false);
});
