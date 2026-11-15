/**
 * Ballistic Workbench - end-to-end browser test (headless Chrome over CDP).
 * Run with: node tests/browser_check.mjs   (CHROME_PATH overrides the Chrome binary)
 *
 * Covers: every view loads in dark and light themes with no console errors, exceptions or CSP
 * violations; no horizontal scrolling at phone width; header (units, theme, command palette);
 * the Solver (solution values, validation, tabs, table, turret); DOPE card formats; every tool;
 * Library (tabs, search, rifle dialog); Compare models.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 3990 + Math.floor(Math.random() * 400);
const CHROME_PORT = 9600 + Math.floor(Math.random() * 400);
const ROOT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// ---- static server ------------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT_DIR, p);
  if (!file.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/index.html`;

// ---- Chrome --------------------------------------------------------------------------------------
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profileDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'bw-chrome-'));
const chrome = spawn(chromePath, [`--remote-debugging-port=${CHROME_PORT}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });

let pageWs = null;
for (let i = 0; i < 50 && !pageWs; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const list = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json`)).json();
    pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    // Chrome not up yet
  }
}
if (!pageWs) {
  console.error('❌ Could not connect to Chrome');
  chrome.kill();
  server.close();
  process.exit(1);
}

const ws = new WebSocket(pageWs);
let msgId = 1;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const d = JSON.parse(event.data);
  if (d.id && pending.has(d.id)) {
    const { resolve, reject } = pending.get(d.id);
    pending.delete(d.id);
    if (d.error) reject(new Error(d.error.message));
    else resolve(d.result);
  }
  if (d.method === 'Runtime.exceptionThrown') errors.push(`exception: ${d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text}`);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(`console.error: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(`[${d.params.entry.source}] ${d.params.entry.text}`);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// Låda Glass binds Mod+K: Meta on Apple platforms, Ctrl elsewhere (CDP modifier bits: 2 = Ctrl, 4 = Meta)
const MOD = process.platform === 'darwin' ? 4 : 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Evaluates a JS expression in the page and returns its value; page exceptions fail the test. */
async function ev(body) {
  const expression = `(async () => (${body}))()`;
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`Page-side exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\nin: ${body.slice(0, 160)}`);
  return r.result.value;
}

let passed = 0;
function check(ok, message) {
  if (!ok) throw new Error(`❌ FAIL: ${message}`);
  passed++;
  console.log(`✅ ${message}`);
}

async function goto(hash, wait = 900) {
  await ev(`window.location.hash = '${hash}'`);
  await sleep(wait);
}

async function fresh(opts = {}) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.light ? 'light' : 'dark' }] });
  await send('Page.navigate', { url: `${BASE}#${opts.hash || 'workspace'}` });
  await sleep(1500);
}

/** Types into an input and fires change. */
async function setValue(selector, value) {
  return ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
    el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
}

const VIEWS = ['workspace', 'solverLab', 'dopeStudio', 'tools', 'libraryManager'];

try {
  // ---- 1. Shell -----------------------------------------------------------------------------------
  await send('Page.navigate', { url: BASE });
  await sleep(500);
  await ev(`(() => { localStorage.clear(); return true; })()`);
  await fresh();
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8')).version;
  check((await ev(`document.getElementById('app-version')?.textContent`)) === expectedVersion, `sidebar shows version ${expectedVersion}`);
  check(await ev(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`), 'strict CSP meta tag present');
  check((await ev(`document.documentElement.getAttribute('data-theme')`)) === 'dark', 'system dark theme resolves to data-theme="dark"');
  check(!(await ev(`/[\\u{1F300}-\\u{1FAFF}]/u.test(document.body.innerText)`)), 'no emoji in the UI text');

  // ---- 2. Every view, both themes, no errors, one h1 ------------------------------------------------
  for (const light of [false, true]) {
    await fresh({ light });
    for (const view of VIEWS) {
      await goto(`#${view}`);
      const info = await ev(`({ h1: document.querySelectorAll('#app-main-content h1').length, active: document.querySelector('.nav-link[aria-current="page"]')?.dataset.view, text: document.getElementById('app-main-content').innerText })`);
      check(info.active === view, `${view} (${light ? 'light' : 'dark'}): nav marks it as current`);
      check(info.h1 === 1, `${view} (${light ? 'light' : 'dark'}): exactly one h1`);
      check(!/\bNaN\b|Infinity|undefined/.test(info.text), `${view} (${light ? 'light' : 'dark'}): no NaN/Infinity/undefined in the text`);
    }
  }

  // ---- 3. Header: theme cycle, units, command palette ---------------------------------------------
  await fresh();
  const themes = [];
  for (const pref of ['light', 'dark', 'system']) {
    await ev(`document.querySelector('#theme-switch [data-theme-set="${pref}"]').click()`);
    await sleep(300);
    themes.push(await ev(`[document.querySelector('#theme-switch [aria-selected="true"]').dataset.themeSet, document.documentElement.getAttribute('data-theme')].join('/')`));
  }
  check(themes.join(',') === 'light/light,dark/dark,system/dark', `theme switch: Light, Dark, System (${themes.join(', ')})`);

  await ev(`document.querySelector('#units-switch [data-units="imperial"]').click()`);
  await sleep(500);
  check((await ev(`document.querySelector('.hold-elev .hold-unit').textContent`)) === 'MOA', 'imperial units: solution in MOA');
  check((await ev(`document.querySelector('.solution-range').textContent`)).includes('yd'), 'imperial units: distance in yards');
  await ev(`document.querySelector('#units-switch [data-units="metric"]').click()`);
  await sleep(500);

  // The search button (clicked like a person would) opens the palette
  const btn = await ev(`(() => { const b = document.getElementById('btn-cmd-palette-trigger').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  await sleep(400);
  check(await ev(`!!document.querySelector('dialog.lg-palette[open]')`), 'clicking Search opens the command palette');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: MOD, windowsVirtualKeyCode: 75 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: MOD, windowsVirtualKeyCode: 75 });
  await sleep(300);
  check(await ev(`!!document.querySelector('dialog.lg-palette[open]')`), `${process.platform === 'darwin' ? '⌘K' : 'Ctrl+K'} opens the command palette`);
  await send('Input.insertText', { text: 'go to tools' });
  await sleep(200);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(700);
  check((await ev(`location.hash`)) === '#tools', 'palette: typing "go to tools" + Enter opens Tools');

  // ---- 4. Solver ------------------------------------------------------------------------------------
  await fresh();
  const elev600 = parseFloat(await ev(`document.querySelector('.hold-elev .hold-value').textContent`));
  check(elev600 > 4.2 && elev600 < 4.7, `6.5 CM 140 ELD-M at 600 m needs ~4.4 MRAD (standard G7 drag): got ${elev600}`);
  await setValue('#target-range-input', 1000);
  await sleep(500);
  const elev1000 = parseFloat(await ev(`document.querySelector('.hold-elev .hold-value').textContent`));
  check(elev1000 > 9.7 && elev1000 < 10.8, `…and ~10.2 MRAD at 1000 m: got ${elev1000}`);
  check((await ev(`document.querySelector('.solution-range-value').textContent`)) === '1000', 'solution is for the exact distance typed');

  await setValue('#mv-input', 9999);
  await sleep(300);
  const invalid = await ev(`({ aria: document.getElementById('mv-input').getAttribute('aria-invalid'), msg: document.getElementById('mv-input-error')?.textContent, elev: document.querySelector('.hold-elev .hold-value').textContent })`);
  check(invalid.aria === 'true' && /Enter 200/.test(invalid.msg || ''), `out-of-range muzzle velocity shows "${invalid.msg}"`);
  check(parseFloat(invalid.elev) === elev1000, 'invalid input does not change the solution');
  await setValue('#mv-input', 825);

  await setValue('#wind-speed-input', 0);
  await sleep(500);
  check((await ev(`document.querySelector('.hold-wind .hold-value').textContent`)).startsWith('0.0'), 'wind speed 0 gives no wind correction (wind zones no longer override it)');
  await setValue('#wind-speed-input', 4);
  await sleep(400);

  await ev(`document.getElementById('tab-chart').click()`);
  await sleep(500);
  const chart = await ev(`({ hidden: document.getElementById('panel-chart').hidden, w: document.querySelector('#trajectory-chart svg')?.getBoundingClientRect().width || 0, lines: document.querySelectorAll('#trajectory-chart path').length })`);
  check(!chart.hidden && chart.w > 200 && chart.lines > 0, 'chart tab shows a Låda Glass line chart');
  await ev(`document.querySelector('.chart-metric [data-metric="velocity"]').click()`);
  await sleep(300);
  check((await ev(`document.getElementById('chart-title').textContent`)).startsWith('Velocity'), 'chart switches to velocity');
  await ev(`document.getElementById('tab-table').click()`);
  await sleep(400);
  const table = await ev(`({ rows: document.querySelectorAll('#trajectory-tbody tr').length, target: document.querySelectorAll('.target-row').length, zero: document.querySelectorAll('.zero-row').length, ticked: document.getElementById('selected-ranges-count').textContent })`);
  check(table.rows > 30 && table.target === 1 && table.zero === 1, `range table: ${table.rows} rows, one target row, one zero row`);
  check(table.ticked === '12', `range table: every 100 m ticked for DOPE cards by default (${table.ticked})`);

  await ev(`document.getElementById('tab-reticle').click()`);
  await sleep(400);
  await ev(`document.getElementById('btn-turret-match-target').click()`);
  await sleep(300);
  const turret = await ev(`({ dialed: document.getElementById('turret-dialed-clicks').textContent, need: document.getElementById('turret-target-needed').textContent })`);
  check(turret.need.includes(turret.dialed.replace(/[()]/g, '')), `"Dial" sets the turret to the solution (${turret.dialed} / ${turret.need})`);

  // ---- 5. DOPE cards --------------------------------------------------------------------------------
  await goto('#dopeStudio', 1200);
  for (const fmt of ['scope-cap', 'wrist-coach', 'stock-tape', 'turret-tape', 'prs-stage', 'a4-sheet']) {
    await ev(`document.querySelector('[data-format="${fmt}"]').click()`);
    await sleep(500);
    const card = await ev(`({ selected: document.querySelector('[data-format="${fmt}"]').getAttribute('aria-selected'), text: document.getElementById('app-main-content').innerText })`);
    check(card.selected === 'true' && !/\bNaN\b|Infinity|undefined/.test(card.text), `DOPE card "${fmt}" renders cleanly`);
    if (fmt === 'turret-tape') {
      const vars = await ev(`(() => { const w = document.querySelector('.turret-tape-preview-wrapper'); return w ? w.style.getPropertyValue('--tape-circ-mm') : ''; })()`);
      check(/mm$/.test(vars), `turret tape size set through the CSSOM (${vars})`);
    }
    if (fmt === 'scope-cap') {
      await ev(`(() => { const s = document.getElementById('scope-cap-preset-select'); s.value = '49.8'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(400);
      check((await ev(`document.querySelector('.scope-cap-print-container').style.getPropertyValue('--cap-diameter-mm')`)).includes('49.8'), 'scope cap preset sets the printed diameter');
    }
  }

  // ---- 6. Tools -------------------------------------------------------------------------------------
  await goto('#tools', 1000);
  for (const tool of ['truing', 'wez', 'group', 'chrono', 'milling', 'recoil']) {
    await ev(`document.querySelector('.tool-tab[data-tool="${tool}"]').click()`);
    await sleep(tool === 'wez' ? 1500 : 500);
    const t = await ev(`({ sel: document.querySelector('.tool-tab[data-tool="${tool}"]').getAttribute('aria-selected'), text: document.getElementById('app-main-content').innerText })`);
    check(t.sel === 'true' && !/\bNaN\b|Infinity|undefined/.test(t.text), `tool "${tool}" opens cleanly`);
    if (tool === 'wez') {
      const wez = await ev(`({ hit: document.querySelector('#wez-metrics-container .stat-val')?.textContent || '', bars: [...document.querySelectorAll('.sens-bar-fill')].map((b) => b.style.width) })`);
      check(/%/.test(wez.hit) && wez.bars.length > 0 && wez.bars.every((w) => /%$/.test(w)), `hit probability ${wez.hit}, ${wez.bars.length} error bars sized`);
    }
    if (tool === 'chrono') {
      await setValue('#chrono-input', '825,4 827,1 826');
      await ev(`document.getElementById('btn-calc-chrono')?.click()`);
      await sleep(400);
      check(/826\.2/.test(await ev(`document.getElementById('chrono-results').innerText`)), 'chronograph reads comma decimals (mean 826.2)');
    }
  }

  // ---- 7. Library and rifle dialog -------------------------------------------------------------------
  await goto('#libraryManager', 1000);
  check((await ev(`document.querySelectorAll('[data-action="use-rifle"], [data-action="edit-rifle"]').length`)) >= 4, 'library lists the rifles with actions');
  await ev(`document.querySelector('.library-tabs [data-tab="bullets"]').click()`);
  await sleep(500);
  const count = () => ev(`parseInt(document.getElementById('bullet-count').textContent, 10)`);
  const all = await count();
  await setValue('#proj-search', 'eld match 140');
  await sleep(500);
  const filtered = await count();
  check(filtered > 0 && filtered < all, `bullet search narrows the list (${all} → ${filtered})`);
  await ev(`document.querySelector('.library-tabs [data-tab="rifles"]').click()`);
  await sleep(400);
  await ev(`document.querySelector('[data-action="new-rifle"]').click()`);
  await sleep(500);
  check(await ev(`!!document.querySelector('dialog[open]') && document.activeElement?.id === 'rf-name'`), 'New rifle opens a dialog with focus in the first field');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(600);
  check(!(await ev(`!!document.querySelector('dialog[open]')`)), 'Esc closes the rifle dialog');

  // ---- 8. Compare models -----------------------------------------------------------------------------
  await goto('#solverLab', 1200);
  const lab = await ev(`({ w: document.getElementById('solver-lab-canvas').getBoundingClientRect().width, rows: document.querySelectorAll('.lab-table tbody tr').length })`);
  check(lab.w > 200 && lab.rows > 5, `compare models: chart drawn and ${lab.rows} table rows`);
  const before = await ev(`document.querySelector('[data-series]').getAttribute('aria-pressed')`);
  await ev(`document.querySelector('[data-series]').click()`);
  await sleep(300);
  check((await ev(`document.querySelector('[data-series]').getAttribute('aria-pressed')`)) !== before, 'compare models: series toggle works');
  await ev(`document.querySelector('#theme-switch [data-theme-set="light"]').click()`);
  await sleep(600);
  check((await ev(`document.querySelectorAll('.lab-table tbody tr').length`)) === lab.rows, 'compare models survives a theme change (it used to go blank)');

  // ---- 9. Phone width: no horizontal scrolling --------------------------------------------------------
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await fresh();
  for (const view of VIEWS) {
    await goto(`#${view}`, 1000);
    const w = await ev(`[document.documentElement.clientWidth, document.documentElement.scrollWidth]`);
    check(w[1] <= w[0], `${view} at 390 px: no horizontal scroll (${w[1]} ≤ ${w[0]})`);
  }
  await send('Emulation.clearDeviceMetricsOverride');

  // ---- 10. No errors anywhere -------------------------------------------------------------------------
  check(errors.length === 0, `no console errors, exceptions or CSP violations${errors.length ? `:\n${errors.join('\n')}` : ''}`);

  console.log(`\n🎉 Browser test passed: ${passed} checks`);
} catch (err) {
  console.error(err.message);
  if (errors.length) console.error(`Errors seen in the page:\n${errors.join('\n')}`);
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
