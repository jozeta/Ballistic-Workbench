/**
 * Ballistic Workbench - the service worker must precache every file the app needs offline.
 * Run with: node tests/sw-assets.mjs
 */

import fs from 'fs';
import path from 'path';

const root = new URL('..', import.meta.url).pathname;
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean));

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]
  );
}
const needed = ['index.html', 'manifest.json', ...['src', 'styles', 'assets', 'vendor'].flatMap(walk)].filter(
  (f) => /\.(js|css|svg|html|json|png)$/.test(f) && !f.endsWith('.DS_Store')
);

let failed = 0;
for (const f of needed) {
  if (!listed.has(f)) {
    console.log(`❌ FAIL: sw.js does not precache ${f}`);
    failed++;
  }
}
for (const f of listed) {
  if (!fs.existsSync(path.join(root, f))) {
    console.log(`❌ FAIL: sw.js lists missing file ${f}`);
    failed++;
  }
}
if (!failed) console.log(`✅ PASS: sw.js precaches all ${needed.length} app files`);
if (failed) process.exit(1);
