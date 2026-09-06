const fs = require('node:fs');
const path = require('node:path');
const { initialize } = require('./issuer-lib.cjs');
const store = initialize();
const target = path.join(__dirname, '..', 'site', 'license-key.js');
const content = '// Verification key only. The signing key stays on the owner computer.\nwindow.TRADE_LICENSE_PUBLIC_KEY = Object.freeze(' + JSON.stringify(store.publicKey, null, 2) + ');\n';
if (fs.existsSync(target) && fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error('The site already trusts another signing key. Restore that key; do not rotate it implicitly.');
fs.writeFileSync(target, content);
console.log('Public verification key ready. Private issuer data remains in:', store.directory);
