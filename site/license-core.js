(function (root) {
  'use strict';
  const DEVICE_KEY = 'trade_license_device_v1';
  const TOKEN_KEY = 'trade_license_token_v1';
  const DEVICE_PATTERN = /^TN-[A-F0-9]{32}$/;
  function normalizeDevice(value) { return String(value || '').trim().toUpperCase(); }
  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > 5000) throw new Error('激活码格式不正确');
    const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    if (encode(bytes) !== text) throw new Error('激活码格式不正确');
    return bytes;
  }
  async function verify(token, publicKey, device) {
    if (!crypto?.subtle) throw new Error('当前浏览器不支持激活验证，请使用新版浏览器访问 HTTPS 网站');
    if (typeof token !== 'string' || token.length > 8000) throw new Error('激活码格式不正确');
    const parts = token.trim().split('.');
    if (parts.length !== 3 || parts[0] !== 'TN1') throw new Error('激活码格式不正确');
    const payloadBytes = decode(parts[1]), signature = decode(parts[2]);
    if (signature.length !== 64 || !publicKey || publicKey.d) throw new Error('激活验证配置不正确');
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode('TN1.' + parts[1]));
    if (!valid) throw new Error('激活码无效或已被修改，请核对客服发送的完整内容');
    let claims;
    try { claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)); }
    catch { throw new Error('激活码内容不正确'); }
    if (claims?.v !== 1 || claims.app !== 'trade-notebook' || !DEVICE_PATTERN.test(claims.device) || !['month', 'forever'].includes(claims.plan) || !/^[a-f0-9-]{36}$/.test(claims.id) || !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt <= 0 || !Number.isSafeInteger(claims.expiresAt) || (claims.plan === 'forever' ? claims.expiresAt !== 0 : claims.expiresAt <= claims.issuedAt)) throw new Error('激活码内容不正确');
    if (claims.device !== normalizeDevice(device)) throw new Error('此激活码不属于当前设备，请将本页设备编号发给客服核对');
    return Object.freeze(claims);
  }
  function isActive(claims, now = Date.now()) {
    return !!claims && claims.issuedAt <= now && (claims.plan === 'forever' || claims.expiresAt > now);
  }
  function isUpgrade(current, next, now = Date.now()) {
    if (!isActive(current, now)) return true;
    if (current.plan === 'forever') return next.plan === 'forever';
    return next.plan === 'forever' || next.expiresAt >= current.expiresAt;
  }
  const api = { DEVICE_KEY, TOKEN_KEY, DEVICE_PATTERN, normalizeDevice, verify, isActive, isUpgrade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeLicense = api;
})(typeof window !== 'undefined' ? window : globalThis);
