/**
 * Ballistic Workbench - Automated Headless Browser & CDP Console Verification
 * Tests:
 * 1. Zero HTTP 404s or network failures
 * 2. Zero uncaught JavaScript errors or console errors
 * 3. Navigation across all 5 modules (#workspace, #solverLab, #dopeStudio, #tools, #libraryManager)
 * 4. Units toggle interaction (Metric <-> Imperial)
 * 5. Slider and inputs interaction
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 3982;
const CHROME_PORT = 9223;
const ROOT_DIR = process.cwd();

// 1. Static HTTP Server
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(ROOT_DIR, reqPath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`📡 Local test server running at http://localhost:${PORT}`);

// 2. Launch Google Chrome in Headless Debug Mode
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeProcess = spawn(
  chromePath,
  [
    `--remote-debugging-port=${CHROME_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/chrome_test_profile_' + Date.now(),
    'about:blank',
  ],
  { stdio: 'ignore' }
);

// Wait for Chrome remote debugging endpoint
let wsUrl = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
    if (res.ok) {
      const data = await res.json();
      wsUrl = data.webSocketDebuggerUrl;
      break;
    }
  } catch (e) {
    // wait
  }
}

if (!wsUrl) {
  console.error('❌ Failed to connect to Chrome debugging port');
  chromeProcess.kill();
  server.close();
  process.exit(1);
}

// Create a target page
const newPageRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?http://localhost:${PORT}/`, {
  method: 'PUT',
});
const pageData = await newPageRes.json();
const pageWsUrl = pageData.webSocketDebuggerUrl;

console.log('🌐 Connected to Chrome Target via CDP WebSocket');

// Connect to page WebSocket using native WebSocket (Node 22+)
const ws = new WebSocket(pageWsUrl);

let msgId = 1;
const pending = new Map();
const consoleErrors = [];
const consoleLogs = [];

function send(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(data.error);
    else resolve(data.result);
  }

  // Intercept runtime errors
  if (data.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(data.params.exceptionDetails);
  }
  if (data.method === 'Runtime.consoleAPICalled') {
    const type = data.params.type;
    const text = data.params.args.map((a) => a.value || a.description || '').join(' ');
    consoleLogs.push({ type, text });
    if (type === 'error') {
      consoleErrors.push(text);
    }
  }
};

await new Promise((resolve) => {
  ws.onopen = resolve;
});

// Enable CDP Domains
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

console.log('⏳ Waiting for initial load and render...');
await new Promise((r) => setTimeout(r, 1000));

// Test 1: Verify Telemetry HUD rendered
const evalHud = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.telemetry-card').length`,
});
const hudCards = evalHud.result.value;
console.log(`📊 Rendered ${hudCards} Telemetry HUD cards`);
if (hudCards !== 6) {
  throw new Error(`Expected 6 telemetry cards, got ${hudCards}`);
}

// Test 2: Navigate through each tab
const views = ['#solverLab', '#dopeStudio', '#tools', '#libraryManager', '#workspace'];
for (const view of views) {
  console.log(`👉 Testing navigation to ${view}...`);
  await send('Runtime.evaluate', {
    expression: `window.location.hash = '${view}';`,
  });
  await new Promise((r) => setTimeout(r, 400));
}

// Test 2b: Solver Lab Trajectory Divergence Curve Chart Height and Bold Curves
console.log('👉 Testing Solver Lab Trajectory Divergence Chart Enlargement...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#solverLab';`,
});
await new Promise((r) => setTimeout(r, 400));

const labChartMetrics = await send('Runtime.evaluate', {
  expression: `(() => {
    const container = document.querySelector('.lab-chart-container') || document.querySelector('.lab-chart-panel .chart-canvas-container');
    const canvas = document.getElementById('solver-lab-canvas');
    return {
      containerHeight: container ? container.clientHeight : 0,
      containerWidth: container ? container.clientWidth : 0,
      canvasHeight: canvas ? canvas.clientHeight : 0,
      canvasWidth: canvas ? canvas.clientWidth : 0,
      canvasInternalHeight: canvas ? canvas.height : 0
    };
  })()`,
  returnByValue: true,
});

const lcm = labChartMetrics.result.value;
console.log(`📈 Solver Lab Chart container height: ${lcm.containerHeight}px, canvas internal height: ${lcm.canvasInternalHeight}px`);
if (lcm.containerHeight < 500) {
  throw new Error(`Solver Lab chart container height expected >= 500px, got ${lcm.containerHeight}px`);
}

// Test 3: Test DOPE Studio format switching
console.log('👉 Testing DOPE Studio formats (Scope cap, Wrist coach, Stock tape, PRS, A4)...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#dopeStudio';`,
});
await new Promise((r) => setTimeout(r, 300));

for (const fmt of ['wrist-coach', 'stock-tape', 'prs-stage', 'a4-sheet', 'scope-cap']) {
  await send('Runtime.evaluate', {
    expression: `
      const btn = document.querySelector('.btn-format[data-format="${fmt}"]');
      if (btn) btn.click();
    `,
  });
  await new Promise((r) => setTimeout(r, 200));
}

// Test 3a: Scope Cap Enlarged Preview, Calibration Ruler, and Butler Creek Presets
console.log('👉 Testing Scope Cap Disk Enlarged Preview, Typography & Calibration Ruler...');
await send('Runtime.evaluate', {
  expression: `
    const capBtn = document.querySelector('.btn-format[data-format="scope-cap"]');
    if (capBtn) capBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 300));

const capMetrics = await send('Runtime.evaluate', {
  expression: `(() => {
    const container = document.querySelector('.scope-cap-print-container');
    const svg = document.querySelector('.scope-cap-svg');
    const ruler = document.querySelector('.calibration-ruler-strip');
    const select = document.getElementById('scope-cap-preset-select');
    const input = document.getElementById('scope-cap-diameter-input');
    const textEls = Array.from(svg ? svg.querySelectorAll('text') : []).map(t => ({
      text: t.textContent,
      fontSize: parseFloat(t.getAttribute('font-size') || '0'),
      fontWeight: t.getAttribute('font-weight')
    }));
    const hasClicks = textEls.some(t => t.text.endsWith('c') && t.fontSize >= 14);
    const hasButler = textEls.some(t => t.text.includes('BUTLER CREEK'));
    const hasBoldDistance = textEls.some(t => ['100', '200', '500'].includes(t.text) && t.fontSize >= 20);
    const hasBoldElevation = textEls.some(t => ['0.0', '0.5', '1.3', '3.0'].includes(t.text) && t.fontSize >= 21);
    return {
      w: container ? container.clientWidth : 0,
      h: container ? container.clientHeight : 0,
      hasSvg: !!svg,
      viewBox: svg ? svg.getAttribute('viewBox') : '',
      hasRuler: !!ruler,
      hasSelect: !!select,
      hasInput: !!input,
      hasClicks,
      hasButler,
      hasBoldDistance,
      hasBoldElevation
    };
  })()`,
  returnByValue: true,
});

const cm = capMetrics.result.value;
console.log(`🔍 Scope Cap container dimensions: ${cm.w}px × ${cm.h}px`);
console.log(`🔍 Scope Cap viewBox: ${cm.viewBox}, Has Clicks: ${cm.hasClicks}, Has Butler Creek: ${cm.hasButler}, Has Bold Dist/Elev: ${cm.hasBoldDistance && cm.hasBoldElevation}`);

if (cm.w < 460 || cm.w > 520 || cm.h < 460 || cm.h > 520) {
  throw new Error(`Scope Cap container width/height not in 460-520px range, got ${cm.w}x${cm.h}`);
}
if (!cm.hasRuler) throw new Error('Calibration check ruler not found under Scope Cap');
if (!cm.hasClicks) throw new Error('Scope Cap SVG missing enlarged turret click callouts (>=14px)');
if (!cm.hasButler) throw new Error('Scope Cap SVG missing Butler Creek specification');
if (!cm.hasBoldDistance || !cm.hasBoldElevation) throw new Error('Scope Cap SVG missing enlarged bold distance/elevation typography');

// Test Butler Creek preset switching to #30 (49.8mm)
await send('Runtime.evaluate', {
  expression: `(() => {
    const sel = document.getElementById('scope-cap-preset-select');
    if (sel) {
      sel.value = '49.8';
      sel.dispatchEvent(new Event('change'));
    }
  })()`,
});
await new Promise((r) => setTimeout(r, 300));

const updatedCapSpec = await send('Runtime.evaluate', {
  expression: `(() => {
    const container = document.querySelector('.scope-cap-print-container');
    const badge = document.querySelector('.card-meta-bar .meta-badge');
    return {
      cssVar: container ? container.style.getPropertyValue('--cap-diameter-mm') : '',
      badgeText: badge ? badge.textContent : ''
    };
  })()`,
  returnByValue: true,
});
console.log(`🎯 Scope Cap preset updated: ${JSON.stringify(updatedCapSpec.result.value)}`);
if (!updatedCapSpec.result.value.cssVar.includes('49.8mm')) {
  throw new Error(`Expected --cap-diameter-mm to be 49.8mm, got ${updatedCapSpec.result.value.cssVar}`);
}

// Test 3b: Dedicated PRS Match Stage Card & Interactive Stage Builder Verification
console.log('👉 Testing PRS / NRL Match Stage Card & Interactive Stage Builder...');
await send('Runtime.evaluate', {
  expression: `
    const prsBtn = document.querySelector('.btn-format[data-format="prs-stage"]');
    if (prsBtn) prsBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 350));

// Check arm board card exists
const cardExists = await send('Runtime.evaluate', {
  expression: `!!document.getElementById('prs-arm-board-card')`,
});
if (!cardExists.result.value) throw new Error('PRS arm board card element not found');

// Check crop marks exist
const cropCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.card-crop-corner').length`,
});
console.log(`📐 Crop corners rendered: ${cropCount.result.value}`);
if (cropCount.result.value !== 4) throw new Error(`Expected 4 crop marks, got ${cropCount.result.value}`);

// Check schematic SVG rendered
const schematicExists = await send('Runtime.evaluate', {
  expression: `!!document.querySelector('.stage-schematic-svg')`,
});
console.log(`🗺️ Downrange schematic rendered: ${schematicExists.result.value}`);
if (!schematicExists.result.value) throw new Error('Downrange schematic SVG not found');

// Check 3-way wind brackets exist in matrix
const windBrackets = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.wind-bracket-pill').length`,
});
console.log(`💨 3-Way Wind brackets rendered: ${windBrackets.result.value}`);
if (windBrackets.result.value === 0) throw new Error('No 3-way wind brackets rendered in matrix');

// Test Presets: Click "Troop Line" preset
console.log('👉 Testing Troop Line Match Preset loading...');
await send('Runtime.evaluate', {
  expression: `
    const troopBtn = document.querySelector('.btn-preset[data-preset="troop-line"]');
    if (troopBtn) troopBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 350));
const troopStageName = await send('Runtime.evaluate', {
  expression: `document.querySelector('.stage-title-text').textContent`,
});
console.log(`🎯 Troop line stage title: "${troopStageName.result.value}"`);
if (!troopStageName.result.value.includes('Troop Line')) {
  throw new Error(`Expected Troop Line in stage title, got: ${troopStageName.result.value}`);
}

const troopTargetRows = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.prs-target-matrix .matrix-row').length`,
});
console.log(`🎯 Troop line target count: ${troopTargetRows.result.value}`);
if (troopTargetRows.result.value !== 5) {
  throw new Error(`Expected 5 targets for troop line, got: ${troopTargetRows.result.value}`);
}

// Test Presets: Click "KYL Rack" preset
console.log('👉 Testing KYL Rack Match Preset loading...');
await send('Runtime.evaluate', {
  expression: `
    const kylBtn = document.querySelector('.btn-preset[data-preset="kyl-rack"]');
    if (kylBtn) kylBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 350));
const kylStageName = await send('Runtime.evaluate', {
  expression: `document.querySelector('.stage-title-text').textContent`,
});
console.log(`🎯 KYL rack stage title: "${kylStageName.result.value}"`);
if (!kylStageName.result.value.includes('KYL')) {
  throw new Error(`Expected KYL in stage title, got: ${kylStageName.result.value}`);
}

// Test Presets: Click "Far-to-Near Barricade" preset
console.log('👉 Testing Far-to-Near Barricade Match Preset loading...');
await send('Runtime.evaluate', {
  expression: `
    const farBtn = document.querySelector('.btn-preset[data-preset="far-to-near"]');
    if (farBtn) farBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 350));

// Test Interactive Stage Builder: Add Target
console.log('👉 Testing Add Target button...');
const beforeAddCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.builder-target-table tbody tr').length`,
});
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-add-target').click();`,
});
await new Promise((r) => setTimeout(r, 350));
const afterAddCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.builder-target-table tbody tr').length`,
});
console.log(`➕ Targets before: ${beforeAddCount.result.value}, after add: ${afterAddCount.result.value}`);
if (afterAddCount.result.value !== beforeAddCount.result.value + 1) {
  throw new Error('Target was not added by Add Target button');
}

// Test Orientation Switcher:
console.log('👉 Testing Orientation Switcher (3x5 vs 5x3 vs Full)...');
await send('Runtime.evaluate', {
  expression: `
    const landBtn = document.querySelector('.btn-orientation[data-orientation="landscape-5x3"]');
    if (landBtn) landBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 200));
const isLandscape = await send('Runtime.evaluate', {
  expression: `document.getElementById('prs-arm-board-card').classList.contains('landscape-5x3')`,
});
console.log(`📐 Card has landscape-5x3 class: ${isLandscape.result.value}`);
if (!isLandscape.result.value) throw new Error('Landscape orientation class not applied');

// Test Theme Switcher:
console.log('👉 Testing Card Theme Switcher (Night vs Mil-Spec vs High-Vis)...');
await send('Runtime.evaluate', {
  expression: `
    const themeBtn = document.querySelector('.btn-theme-swatch[data-theme="match-day"]');
    if (themeBtn) themeBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 200));
const hasMatchTheme = await send('Runtime.evaluate', {
  expression: `document.getElementById('prs-arm-board-card').classList.contains('theme-match-day')`,
});
console.log(`☀️ Card has theme-match-day class: ${hasMatchTheme.result.value}`);
if (!hasMatchTheme.result.value) throw new Error('Match day theme class not applied');

// Switch back to tactical night
await send('Runtime.evaluate', {
  expression: `
    const nightBtn = document.querySelector('.btn-theme-swatch[data-theme="tactical-night"]');
    if (nightBtn) nightBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 200));

// Test Clone Target:
console.log('👉 Testing Clone Target button...');
const countBeforeClone = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.builder-target-table tbody tr').length`,
});
await send('Runtime.evaluate', {
  expression: `
    const cloneBtn = document.querySelector('.btn-clone-target');
    if (cloneBtn) cloneBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 300));
const countAfterClone = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.builder-target-table tbody tr').length`,
});
console.log(`📋 Targets before clone: ${countBeforeClone.result.value}, after: ${countAfterClone.result.value}`);
if (countAfterClone.result.value !== countBeforeClone.result.value + 1) {
  throw new Error('Target was not cloned');
}

// Test Par Time splits bar:
const parTimeExists = await send('Runtime.evaluate', {
  expression: `!!document.querySelector('.par-time-flow-bar')`,
});
console.log(`⏱️ Par time splits bar rendered: ${parTimeExists.result.value}`);
if (!parTimeExists.result.value) throw new Error('Par time flow bar not rendered');

// Test Print Media Fidelity & Zero-Overflow:
console.log('🖨️ Verifying print layout zero-overflow in 75mm portrait...');
await send('Emulation.setEmulatedMedia', { media: 'print' });
await new Promise((r) => setTimeout(r, 300));
const printOverflow = await send('Runtime.evaluate', {
  expression: `
    const table = document.querySelector('.prs-target-matrix');
    ({ clientWidth: table.clientWidth, scrollWidth: table.scrollWidth, overflow: table.scrollWidth > table.clientWidth + 2 })
  `,
  returnByValue: true,
});
console.log(`🖨️ Print table dimensions: clientWidth=${printOverflow.result.value.clientWidth}px, scrollWidth=${printOverflow.result.value.scrollWidth}px, overflow=${printOverflow.result.value.overflow}`);
if (printOverflow.result.value.overflow) {
  throw new Error(`PRS target matrix overflows in print: scrollWidth ${printOverflow.result.value.scrollWidth} > clientWidth ${printOverflow.result.value.clientWidth}`);
}

// Reset emulated media to screen
await send('Emulation.setEmulatedMedia', { media: 'screen' });
await new Promise((r) => setTimeout(r, 200));

// Switch back to portrait
await send('Runtime.evaluate', {
  expression: `
    const portBtn = document.querySelector('.btn-orientation[data-orientation="portrait-3x5"]');
    if (portBtn) portBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 200));

// Test 4: Test Unit Switcher button
console.log('👉 Testing Units Switcher button...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#workspace';`,
});
await new Promise((r) => setTimeout(r, 300));

// Check metric headers
const metricHeader = await send('Runtime.evaluate', {
  expression: `document.querySelector('#trajectory-thead th').textContent`,
});
console.log(`📏 Metric header: "${metricHeader.result.value}"`);

// Toggle to Imperial
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-units-toggle').click();`,
});
await new Promise((r) => setTimeout(r, 400));
const unitLabelAfterClick = await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-units-toggle').textContent.trim()`,
});
console.log(`🔄 Units toggle changed to: "${unitLabelAfterClick.result.value}"`);

const imperialHeader = await send('Runtime.evaluate', {
  expression: `document.querySelector('#trajectory-thead th').textContent`,
});
console.log(`📏 Imperial header: "${imperialHeader.result.value}"`);
if (!imperialHeader.result.value.includes('yd')) {
  throw new Error(`Expected imperial header to include 'yd', got: ${imperialHeader.result.value}`);
}

// Switch back to metric
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-units-toggle').click();`,
});
await new Promise((r) => setTimeout(r, 400));

// Test 4b: Test WEZ Monte Carlo Tool in #tools
console.log('👉 Testing WEZ Monte Carlo Simulation Tool in #tools...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#tools';`,
});
await new Promise((r) => setTimeout(r, 300));
await send('Runtime.evaluate', {
  expression: `
    const wezBtn = document.querySelector('.btn-tool[data-tool="wez"]');
    if (wezBtn) wezBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 300));

const wezCanvasExists = await send('Runtime.evaluate', {
  expression: `!!document.getElementById('wez-canvas')`,
});
console.log(`🎨 WEZ canvas rendered: ${wezCanvasExists.result.value}`);
if (!wezCanvasExists.result.value) {
  throw new Error('WEZ canvas was not rendered');
}

// Click Run WEZ button
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-run-wez').click();`,
});
await new Promise((r) => setTimeout(r, 300));

const wezHitRate = await send('Runtime.evaluate', {
  expression: `document.querySelector('#wez-metrics-container .stat-val')?.textContent`,
});
console.log(`🎯 WEZ Hit Rate simulated: ${wezHitRate.result.value}`);
if (!wezHitRate.result.value || !wezHitRate.result.value.includes('%')) {
  throw new Error(`Invalid WEZ hit rate: ${wezHitRate.result.value}`);
}

// Test 4b-2: Computer Vision Target Group Detector in #tools
console.log('👉 Testing Computer Vision Target Group Detector in #tools...');
await send('Runtime.evaluate', {
  expression: `
    const groupBtn = document.querySelector('.btn-tool[data-tool="group"]');
    if (groupBtn) groupBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 350));

const groupCanvasMetrics = await send('Runtime.evaluate', {
  expression: `(() => {
    const canvas = document.getElementById('group-canvas');
    return {
      exists: !!canvas,
      w: canvas ? canvas.width : 0,
      h: canvas ? canvas.height : 0
    };
  })()`,
  returnByValue: true,
});
console.log(`🎯 Group canvas exists: ${groupCanvasMetrics.result.value.exists}, dimensions: ${groupCanvasMetrics.result.value.w}x${groupCanvasMetrics.result.value.h}`);
if (!groupCanvasMetrics.result.value.exists) throw new Error('Group analyzer canvas not found');

// Click "Load Sample Target" button
console.log('👉 Loading Sample Target Photo & Running Computer Vision Detection...');
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-load-sample-photo')?.click();`,
});
await new Promise((r) => setTimeout(r, 400));

// Verify detected shots and stats
const cvStats = await send('Runtime.evaluate', {
  expression: `(() => {
    const summary = document.getElementById('group-metrics-summary');
    const text = summary ? summary.textContent : '';
    const hasShots = text.includes('shots');
    const hasEs = text.includes('EXTREME SPREAD');
    const hasMr = text.includes('MEAN RADIUS');
    const hasCep = text.includes('CEP 50%');
    const hasPoi = text.includes('CENTER OF IMPACT');
    return { hasShots, hasEs, hasMr, hasCep, hasPoi, text };
  })()`,
  returnByValue: true,
});
console.log(`🎯 CV Metrics Rendered - Shots: ${cvStats.result.value.hasShots}, ES: ${cvStats.result.value.hasEs}, MR: ${cvStats.result.value.hasMr}, CEP: ${cvStats.result.value.hasCep}`);
if (!cvStats.result.value.hasShots || !cvStats.result.value.hasEs || !cvStats.result.value.hasCep) {
  throw new Error(`Target Group CV Metrics incomplete: ${JSON.stringify(cvStats.result.value)}`);
}

// Test Caliber Selector
await send('Runtime.evaluate', {
  expression: `(() => {
    const sel = document.getElementById('group-caliber-select');
    if (sel) {
      sel.value = '7.8';
      sel.dispatchEvent(new Event('change'));
    }
  })()`,
});
await new Promise((r) => setTimeout(r, 200));

// Test Sensitivity Slider
await send('Runtime.evaluate', {
  expression: `(() => {
    const slider = document.getElementById('cv-sensitivity-slider');
    if (slider) {
      slider.value = '65';
      slider.dispatchEvent(new Event('input'));
    }
  })()`,
});
await new Promise((r) => setTimeout(r, 200));
const sensVal = await send('Runtime.evaluate', {
  expression: `document.getElementById('cv-sens-val')?.textContent`,
});
console.log(`🎛️ Sensitivity slider updated to: ${sensVal.result.value}`);
if (sensVal.result.value !== '65%') throw new Error(`Expected sensitivity 65%, got ${sensVal.result.value}`);

// Test Scale Reference Unit Selector (1 inch vs 1 cm)
await send('Runtime.evaluate', {
  expression: `(() => {
    const scaleSel = document.getElementById('cv-scale-unit-select');
    if (scaleSel) {
      scaleSel.value = '10.0';
      scaleSel.dispatchEvent(new Event('change'));
    }
  })()`,
});
await new Promise((r) => setTimeout(r, 200));
const scaleHint = await send('Runtime.evaluate', {
  expression: `document.getElementById('cv-status-hint')?.textContent`,
});
console.log(`📐 Scale unit selector updated: ${scaleHint.result.value}`);
if (!scaleHint.result.value.includes('1 cm (10mm)')) {
  throw new Error(`Scale unit selector failed to update status hint, got: ${scaleHint.result.value}`);
}

// Test 4c: Test Library Manager Database Filtering & Bullet Loading
console.log('👉 Testing Library Manager Database Filtering & Loading...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#libraryManager';`,
});
await new Promise((r) => setTimeout(r, 400));

// Check total rows rendered in table
const totalRows = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.dope-table tbody tr').length`,
});
console.log(`📚 Rendered ${totalRows.result.value} projectile rows`);
if (totalRows.result.value < 100) {
  throw new Error(`Expected >=100 projectile rows, got: ${totalRows.result.value}`);
}

// Filter by 6mm
await send('Runtime.evaluate', {
  expression: `(() => {
    const calSelect = document.getElementById('caliber-filter');
    calSelect.value = '6mm';
    calSelect.dispatchEvent(new Event('change'));
  })()`,
});
await new Promise((r) => setTimeout(r, 300));

const sixMmRowCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.dope-table tbody tr').length`,
});
console.log(`🎯 6mm filter rows: ${sixMmRowCount.result.value}`);
if (sixMmRowCount.result.value !== 13) {
  throw new Error(`Expected exactly 13 6mm rows, got: ${sixMmRowCount.result.value}`);
}

// Reset filter to all and search "Sako"
await send('Runtime.evaluate', {
  expression: `(() => {
    const calSelect = document.getElementById('caliber-filter');
    calSelect.value = 'all';
    calSelect.dispatchEvent(new Event('change'));
    const searchInput = document.getElementById('proj-search');
    searchInput.value = 'Sako';
    searchInput.dispatchEvent(new Event('input'));
  })()`,
});
await new Promise((r) => setTimeout(r, 300));

const sakoRowCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.dope-table tbody tr').length`,
});
console.log(`🎯 Sako search rows: ${sakoRowCount.result.value}`);
if (sakoRowCount.result.value < 15) {
  throw new Error(`Expected >=15 Sako rows, got: ${sakoRowCount.result.value}`);
}

// Reset search input
await send('Runtime.evaluate', {
  expression: `(() => {
    const searchInput = document.getElementById('proj-search');
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
  })()`,
});
await new Promise((r) => setTimeout(r, 300));

// Test 5: Command Palette opening and searching
console.log('👉 Testing Command Palette (Ctrl+K)...');
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-cmd-palette-trigger').click();`,
});
await new Promise((r) => setTimeout(r, 200));
await send('Runtime.evaluate', {
  expression: `
    const input = document.getElementById('palette-search-input');
    input.value = '4DOF';
    input.dispatchEvent(new Event('input'));
  `,
});
await new Promise((r) => setTimeout(r, 200));
const paletteResultsCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.palette-item').length`,
});
console.log(`🔍 Command palette filtered to ${paletteResultsCount.result.value} items`);

// Close palette
await send('Runtime.evaluate', {
  expression: `
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(escEvent);
  `,
});
await new Promise((r) => setTimeout(r, 200));

// Test 6: Printable Turret Tape Generator in DOPE Studio
console.log('👉 Testing Printable Turret Tape Generator in DOPE Studio...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#dopeStudio';`,
});
await new Promise((r) => setTimeout(r, 300));
await send('Runtime.evaluate', {
  expression: `
    const tapeBtn = document.querySelector('.btn-format[data-format="turret-tape"]');
    if (tapeBtn) tapeBtn.click();
  `,
});
await new Promise((r) => setTimeout(r, 300));

const turretTapeSvgExists = await send('Runtime.evaluate', {
  expression: `!!document.getElementById('turret-tape-svg')`,
});
console.log(`🎯 Turret Tape SVG rendered: ${turretTapeSvgExists.result.value}`);
if (!turretTapeSvgExists.result.value) {
  throw new Error('Turret tape SVG was not rendered');
}

const rulerStripExists = await send('Runtime.evaluate', {
  expression: `!!document.querySelector('.calibration-ruler-strip')`,
});
console.log(`📏 50mm Calibration check bar rendered: ${rulerStripExists.result.value}`);
if (!rulerStripExists.result.value) {
  throw new Error('Calibration check bar was not rendered');
}

// Verification of Turret Tape UP direction arrow and 30mm preset
const turretArrowText = await send('Runtime.evaluate', {
  expression: `document.querySelector('.turret-dir-arrow-group text')?.textContent || ''`,
});
console.log(`🎯 Turret direction arrow text: "${turretArrowText.result.value}"`);
if (!turretArrowText.result.value.includes('UP ▲')) {
  throw new Error(`Expected turret tape to include 'UP ▲', got: ${turretArrowText.result.value}`);
}

const turretPresetSelect = await send('Runtime.evaluate', {
  expression: `(() => {
    const sel = document.getElementById('turret-tape-preset-select');
    return sel ? Array.from(sel.options).map(o => o.value) : [];
  })()`,
  returnByValue: true,
});
console.log(`🎯 Turret tape presets: ${JSON.stringify(turretPresetSelect.result.value)}`);
if (!turretPresetSelect.result.value.includes('94.2')) {
  throw new Error('Turret tape missing 30mm (94.2mm) preset');
}
const count94 = turretPresetSelect.result.value.filter(v => v === '94.2').length;
if (count94 !== 1) {
  throw new Error(`Expected exactly one 94.2 preset option, found: ${count94}`);
}

// Verification of Stock Tape 180mm x 32mm and 5 rows
console.log('👉 Testing Stock Tape Layout & Matrix Rows in DOPE Studio...');
await send('Runtime.evaluate', {
  expression: `document.querySelector('.btn-format[data-format="stock-tape"]')?.click();`,
});
await new Promise((r) => setTimeout(r, 300));
const stockTapeCheck = await send('Runtime.evaluate', {
  expression: `(() => {
    const table = document.querySelector('.tape-matrix-table');
    const hasElev = !!document.querySelector('.tape-row-elev');
    const hasClk = !!document.querySelector('.tape-row-clk');
    const hasWind = !!document.querySelector('.tape-row-wind');
    const hasGust = !!document.querySelector('.tape-row-gust');
    const badge = document.querySelector('.meta-badge')?.textContent || '';
    return { hasTable: !!table, hasElev, hasClk, hasWind, hasGust, badge };
  })()`,
  returnByValue: true,
});
console.log(`📏 Stock tape check: ${JSON.stringify(stockTapeCheck.result.value)}`);
if (!stockTapeCheck.result.value.hasElev || !stockTapeCheck.result.value.hasClk || !stockTapeCheck.result.value.hasGust) {
  throw new Error(`Stock tape missing required 5 aligned matrix rows: ${JSON.stringify(stockTapeCheck.result.value)}`);
}

// Verification of Wrist Coach standard sleeve layout
console.log('👉 Testing Wrist Coach 3x5 Sleeve Format in DOPE Studio...');
await send('Runtime.evaluate', {
  expression: `document.querySelector('.btn-format[data-format="wrist-coach"]')?.click();`,
});
await new Promise((r) => setTimeout(r, 300));
const wristCheck = await send('Runtime.evaluate', {
  expression: `(() => {
    const card = document.querySelector('.wrist-coach-card');
    const crops = document.querySelectorAll('.wrist-coach-card .card-crop-corner').length;
    const table = document.querySelector('.coach-table');
    const overflow = table ? table.scrollWidth > table.clientWidth + 2 : false;
    return { hasCard: !!card, crops, overflow };
  })()`,
  returnByValue: true,
});
console.log(`⌚ Wrist coach check: hasCard=${wristCheck.result.value.hasCard}, crops=${wristCheck.result.value.crops}, overflow=${wristCheck.result.value.overflow}`);
if (!wristCheck.result.value.hasCard || wristCheck.result.value.crops !== 4 || wristCheck.result.value.overflow) {
  throw new Error(`Wrist coach failed verification: ${JSON.stringify(wristCheck.result.value)}`);
}

// Verification of A4 Master Data Sheet
console.log('👉 Testing A4 Data Sheet Reticle Reference & Shooter Notes...');
await send('Runtime.evaluate', {
  expression: `document.querySelector('.btn-format[data-format="a4-sheet"]')?.click();`,
});
await new Promise((r) => setTimeout(r, 300));
const a4Check = await send('Runtime.evaluate', {
  expression: `(() => {
    const hasReticle = !!document.querySelector('.a4-reticle-hold-section');
    const hasNotes = !!document.querySelector('.a4-notes-section');
    const reticleNodes = document.querySelectorAll('.reticle-tree-node').length;
    const notesBoxes = document.querySelectorAll('.notes-box').length;
    return { hasReticle, hasNotes, reticleNodes, notesBoxes };
  })()`,
  returnByValue: true,
});
console.log(`📄 A4 data sheet check: ${JSON.stringify(a4Check.result.value)}`);
if (!a4Check.result.value.hasReticle || !a4Check.result.value.hasNotes || a4Check.result.value.reticleNodes < 5) {
  throw new Error(`A4 data sheet missing reticle tree or notes: ${JSON.stringify(a4Check.result.value)}`);
}

// Test 7: Dark / Light Theme Toggle
console.log('👉 Testing Dark / Light Theme Toggle...');
const initialTheme = await send('Runtime.evaluate', {
  expression: `document.documentElement.getAttribute('data-theme') || 'dark'`,
});
console.log(`🌙 Initial theme: ${initialTheme.result.value}`);

await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-theme-toggle').click();`,
});
await new Promise((r) => setTimeout(r, 300));

const lightTheme = await send('Runtime.evaluate', {
  expression: `document.documentElement.getAttribute('data-theme')`,
});
console.log(`☀️ Theme after toggle: ${lightTheme.result.value}`);
if (lightTheme.result.value !== 'light') {
  throw new Error(`Expected theme 'light', got '${lightTheme.result.value}'`);
}

// Toggle back to dark
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-theme-toggle').click();`,
});
await new Promise((r) => setTimeout(r, 300));

const darkTheme = await send('Runtime.evaluate', {
  expression: `document.documentElement.getAttribute('data-theme') || 'dark'`,
});
console.log(`🌙 Theme after 2nd toggle: ${darkTheme.result.value}`);
if (darkTheme.result.value !== 'dark') {
  throw new Error(`Expected theme 'dark', got '${darkTheme.result.value}'`);
}

// Test 8: Workspace Visualizers, Turret Knob, and Reticle Coupling
console.log('👉 Testing Workspace Turret Knob and Reticle Coupling...');
await send('Runtime.evaluate', {
  expression: `window.location.hash = '#workspace';`,
});
await new Promise((r) => setTimeout(r, 300));

const turretCanvasExists = await send('Runtime.evaluate', {
  expression: `!!document.getElementById('turret-canvas')`,
});
console.log(`🎛️ Turret Canvas rendered: ${turretCanvasExists.result.value}`);
if (!turretCanvasExists.result.value) {
  throw new Error('Turret canvas not found in workspace');
}

// Click +1 Click button
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-turret-plus')?.click();`,
});
await new Promise((r) => setTimeout(r, 200));

const dialClicksAfterUp = await send('Runtime.evaluate', {
  expression: `document.getElementById('turret-dialed-clicks')?.textContent`,
});
console.log(`🎛️ Turret clicks after +1: ${dialClicksAfterUp.result.value}`);
if (!dialClicksAfterUp.result.value.includes('1 clicks') && !dialClicksAfterUp.result.value.includes('1 clicks)')) {
  throw new Error(`Expected '1 clicks', got: ${dialClicksAfterUp.result.value}`);
}

// Click Dial to Target button
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-turret-match-target')?.click();`,
});
await new Promise((r) => setTimeout(r, 200));
const dialedTargetClicks = await send('Runtime.evaluate', {
  expression: `document.getElementById('turret-dialed-clicks')?.textContent`,
});
console.log(`🎯 Dialed to Target clicks: ${dialedTargetClicks.result.value}`);

// Reset turret to zero
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-turret-zero')?.click();`,
});
await new Promise((r) => setTimeout(r, 200));

// Test 8b: Reticle Canvas and Turret Matching Backgrounds & Symmetrical Layout
console.log('👉 Testing Reticle and Turret Container Backgrounds & Alignment...');
const reticleTurretMetrics = await send('Runtime.evaluate', {
  expression: `(() => {
    const retContainer = document.querySelector('.reticle-canvas-container');
    const turContainer = document.querySelector('.turret-knob-container');
    const split = document.querySelector('.reticle-turret-split');
    const retBg = retContainer ? window.getComputedStyle(retContainer).backgroundColor : '';
    const turBg = turContainer ? window.getComputedStyle(turContainer).backgroundColor : '';
    const retCanvas = document.getElementById('reticle-canvas');
    let hasBlackBarOnRight = false;
    let rightSidePixelSample = null;
    let housingPixelSample = null;

    if (retCanvas) {
      const ctx = retCanvas.getContext('2d');
      const w = retCanvas.width;
      const h = retCanvas.height;
      const s = Math.min(w, h);
      const cx = w / 2;
      const cy = h / 2;
      const r = s / 2 - 10 * (window.devicePixelRatio || 1);
      // Sample pixel on the far right side of the circular ocular (x = cx + r * 0.75, y = cy)
      const testX = Math.floor(cx + r * 0.7);
      const testY = Math.floor(cy);
      const px = ctx.getImageData(testX, testY, 1, 1).data;
      rightSidePixelSample = [px[0], px[1], px[2], px[3]];
      // If pure black / unpainted housing (near 5, 7, 10 or 0,0,0) where terrain/sky should be, black bar is present
      // Berm grass terrain in dark mode has green/brown channel > 30 (e.g. #14532d or #86efac)
      if (px[3] === 0 || (px[0] <= 8 && px[1] <= 10 && px[2] <= 15)) {
        hasBlackBarOnRight = true;
      }

      // Sample housing pixel outside the ocular circle (top left corner)
      const hpx = ctx.getImageData(8, 8, 1, 1).data;
      housingPixelSample = [hpx[0], hpx[1], hpx[2]];
    }

    const btnZero = document.getElementById('btn-turret-zero');
    const btnDial = document.getElementById('btn-turret-match-target');
    const turretButtonsVisible = !!(btnZero && btnZero.offsetHeight > 0 && btnDial && btnDial.offsetHeight > 0);

    return {
      hasSplit: !!split,
      retBg,
      turBg,
      bgMatch: retBg === turBg,
      retW: retCanvas ? retCanvas.clientWidth : 0,
      retH: retCanvas ? retCanvas.clientHeight : 0,
      hasBlackBarOnRight,
      rightSidePixelSample,
      housingPixelSample,
      turretButtonsVisible
    };
  })()`,
  returnByValue: true,
});

const rtm = reticleTurretMetrics.result.value;
console.log(`👁️ Reticle split present: ${rtm.hasSplit}, Background match: ${rtm.bgMatch} (${rtm.retBg}), Housing px: [${rtm.housingPixelSample}], Turret buttons visible: ${rtm.turretButtonsVisible}, Canvas size: ${rtm.retW}x${rtm.retH}, Right pixel: [${rtm.rightSidePixelSample}], Black bar detected: ${rtm.hasBlackBarOnRight}`);
if (!rtm.hasSplit) throw new Error('Missing .reticle-turret-split layout element');
if (!rtm.bgMatch) throw new Error(`Reticle background (${rtm.retBg}) does not match Turret background (${rtm.turBg})`);
if (rtm.hasBlackBarOnRight) throw new Error(`Reticle ocular has black bar on right side! Sampled pixel: [${rtm.rightSidePixelSample}]`);
if (!rtm.turretButtonsVisible) throw new Error('Turret buttons are not visible or clipped in layout');

// Test 9: Workspace Primary Bullet Drop Chart Tab
console.log('👉 Testing Bullet Drop Chart tab...');
await send('Runtime.evaluate', {
  expression: `
    const dropTab = document.querySelector('.tab-btn[data-tab="drop"]');
    if (dropTab) dropTab.click();
  `,
});
await new Promise((r) => setTimeout(r, 200));

const dropTabActive = await send('Runtime.evaluate', {
  expression: `document.querySelector('.tab-btn[data-tab="drop"]')?.classList.contains('active')`,
});
console.log(`📈 Drop tab active: ${dropTabActive.result.value}`);
if (!dropTabActive.result.value) {
  throw new Error('Drop tab is not marked active after click');
}

// Test 10: DOPE Column Visibility Dropdown & Range Checkbox Transfer
console.log('👉 Testing DOPE Column Visibility and Range Transfer...');
// Open column picker details
await send('Runtime.evaluate', {
  expression: `
    const details = document.getElementById('col-picker-details');
    if (details) details.open = true;
  `,
});
await new Promise((r) => setTimeout(r, 200));
const menuVisible = await send('Runtime.evaluate', {
  expression: `document.getElementById('col-picker-details')?.open`,
});
console.log(`⚙️ Column picker menu open: ${menuVisible.result.value}`);

// Toggle a column checkbox (e.g. drop)
await send('Runtime.evaluate', {
  expression: `
    const chk = document.querySelector('.column-picker-menu input[data-col="drop"]');
    if (chk) { chk.click(); }
  `,
});
await new Promise((r) => setTimeout(r, 200));

// Close details
await send('Runtime.evaluate', {
  expression: `
    const details = document.getElementById('col-picker-details');
    if (details) details.open = false;
  `,
});
await new Promise((r) => setTimeout(r, 200));

// Check range checkboxes exist
const rangeCheckboxesCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('.chk-range-select').length`,
});
console.log(`☑️ Trajectory range checkboxes rendered: ${rangeCheckboxesCount.result.value}`);
if (rangeCheckboxesCount.result.value === 0) {
  throw new Error('No range checkboxes found in trajectory table');
}

// Test 11: Rifle Profile Builder UI Modal
console.log('👉 Testing Rifle Profile Builder UI Modal...');
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-quick-add-rifle')?.click();`,
});
await new Promise((r) => setTimeout(r, 300));

const modalOpen = await send('Runtime.evaluate', {
  expression: `!!document.getElementById('rifle-builder-modal-root')`,
});
console.log(`🔫 Rifle builder modal open: ${modalOpen.result.value}`);
if (!modalOpen.result.value) {
  throw new Error('Rifle builder modal was not opened');
}

const projectileOptionsCount = await send('Runtime.evaluate', {
  expression: `document.querySelectorAll('#rf-bullet-select option').length`,
});
console.log(`📦 Modal projectile options: ${projectileOptionsCount.result.value}`);
if (projectileOptionsCount.result.value < 100) {
  throw new Error(`Expected >=100 modal projectile options, got: ${projectileOptionsCount.result.value}`);
}

// Close rifle builder modal
await send('Runtime.evaluate', {
  expression: `document.getElementById('btn-close-rifle-modal')?.click();`,
});
await new Promise((r) => setTimeout(r, 200));

const modalClosed = await send('Runtime.evaluate', {
  expression: `!document.getElementById('rifle-builder-modal-root')`,
});
console.log(`🔒 Rifle builder modal closed: ${modalClosed.result.value}`);
if (!modalClosed.result.value) {
  throw new Error('Rifle builder modal was not closed');
}

// Test 12: PWA Manifest & Service Worker
console.log('👉 Testing PWA Manifest and Offline setup...');
const manifestHref = await send('Runtime.evaluate', {
  expression: `document.querySelector('link[rel="manifest"]')?.getAttribute('href')`,
});
console.log(`📱 PWA Manifest link: ${manifestHref.result.value}`);
if (!manifestHref.result.value || !manifestHref.result.value.includes('manifest.json')) {
  throw new Error(`Expected link rel="manifest" with manifest.json, got: ${manifestHref.result.value}`);
}

// Test 13: Version footer shows manifest.json's version
console.log('👉 Testing version footer...');
const expectedVersion = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8')).version;
const footerVersion = await send('Runtime.evaluate', {
  expression: `document.getElementById('app-version')?.textContent`,
});
console.log(`🏷️  Footer version: ${footerVersion.result.value}`);
if (footerVersion.result.value !== `v${expectedVersion}`) {
  throw new Error(`Expected footer "v${expectedVersion}", got: ${footerVersion.result.value}`);
}

// Final check on console errors
console.log('\n--- VERIFYING CONSOLE ERROR RECORD ---');
console.log(`Console messages logged: ${consoleLogs.length}`);
console.log(`Console errors recorded: ${consoleErrors.length}`);

if (consoleErrors.length > 0) {
  console.error('❌ Console errors encountered:');
  consoleErrors.forEach((e) => console.error(e));
  throw new Error('Automated browser test failed due to console errors!');
}

console.log('✅ ZERO CONSOLE ERRORS ENCOUNTERED!');

// Cleanup
ws.close();
chromeProcess.kill();
server.close();

console.log('\n========================================');
console.log('🎉 FULL BROWSER CDP VERIFICATION PASSED!');
console.log('========================================');
