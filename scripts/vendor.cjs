const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'site', 'vendor');
fs.mkdirSync(dest, { recursive: true });
for (const [from, to] of [
  ['chart.js/dist/chart.umd.js', 'chart.umd.js'],
  ['chart.js/LICENSE.md', 'chart.LICENSE.md'],
  ['lucide/dist/umd/lucide.js', 'lucide.js'],
  ['lucide/LICENSE', 'lucide.LICENSE'],
]) fs.copyFileSync(path.join(root, 'node_modules', from), path.join(dest, to));
console.log('Local browser dependencies copied.');
