/**
 * Ballistic Workbench - version consistency check
 * Run with: node tests/version.mjs
 *
 * manifest.json "version" is the single source. Everything that repeats it must agree:
 * the service worker cache name, the README's "Version" line and the newest CHANGELOG section.
 */

import fs from 'fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const version = JSON.parse(read('manifest.json')).version;
let failed = 0;

function check(ok, message) {
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}: ${message}`);
  if (!ok) failed++;
}

check(/^\d+\.\d+\.\d+$/.test(version || ''), `manifest.json has a semver version (${version})`);
check(JSON.parse(read('package.json')).version === version, 'package.json version matches manifest.json');
check(read('sw.js').includes(`'ballistic-workbench-v${version}'`), 'sw.js cache name matches the version');

if (fs.existsSync(new URL('../README.md', import.meta.url))) {
  check(read('README.md').includes(`**Version:** ${version}`), 'README shows the version');
}
if (fs.existsSync(new URL('../CHANGELOG.md', import.meta.url))) {
  const firstRelease = read('CHANGELOG.md').match(/^## \[?(\d+\.\d+\.\d+)/m);
  check(firstRelease?.[1] === version, 'newest CHANGELOG release matches the version');
}

if (failed) process.exit(1);
