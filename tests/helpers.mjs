/**
 * Ballistic Workbench - unit tests for small shared helpers (escaping, number coercion).
 * Run with: node tests/helpers.mjs
 */

import { esc, num } from '../src/core/escape.js';
import { sanitizeProfiles, sanitizeSolverConfig, sanitizeBullets, shapeLike } from '../src/core/sanitize.js';
import { DEFAULT_PROFILES } from '../src/data/defaultProfiles.js';
import { solveTrajectory } from '../src/physics/solvers.js';

let failed = 0;
function check(ok, message) {
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}: ${message}`);
  if (!ok) failed++;
}

check(esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'esc encodes tags');
check(esc(`a"b'c&d`) === 'a&quot;b&#39;c&amp;d', 'esc encodes quotes and ampersands');
check(esc(null) === '' && esc(undefined) === '', 'esc turns null/undefined into empty text');
check(esc(6.5) === '6.5', 'esc stringifies numbers');
check(num('0.326') === 0.326, 'num parses numeric strings');
check(num('abc', 7) === 7 && num(NaN, 7) === 7 && num(Infinity, 7) === 7, 'num falls back on junk');

// --- import / storage validation ---
const evil = sanitizeProfiles([{ id: 'x"><b>', name: '<img src=x>', muzzleVelocityMs: '9e99', bullet: null, __proto__: { polluted: 1 } }], DEFAULT_PROFILES);
check(evil.length === 1 && /^profile-/.test(evil[0].id), 'a bad profile id is replaced');
check(evil[0].name === '<img src=x>', 'names stay plain text (escaped when rendered, not mangled)');
check(evil[0].muzzleVelocityMs === 2000, 'out-of-range muzzle velocity is clamped');
check(evil[0].bullet && evil[0].bullet.bcG7 === DEFAULT_PROFILES[0].bullet.bcG7, 'a missing bullet falls back to defaults');
check(!('polluted' in evil[0]) && ({}).polluted === undefined, '__proto__ keys are dropped');
check(sanitizeProfiles([], DEFAULT_PROFILES) === null && sanitizeProfiles('x', DEFAULT_PROFILES) === null, 'empty or non-array profile lists are ignored');

const cfg = sanitizeSolverConfig({ stepM: 0, maxRangeM: 1e9, activeAlgorithm: 'X' }, { activeAlgorithm: 'G7', stepM: 25, maxRangeM: 1200 });
check(cfg.stepM === 25 && cfg.maxRangeM === 3000 && cfg.activeAlgorithm === 'G7', 'solver config: bad step, range and algorithm are corrected');

const bullets = sanitizeBullets([{ id: 'c1', name: 'A'.repeat(500), weightGr: '140', bcG7: 0.3 }, { id: 'c2', name: 'No BC', weightGr: 100 }, { name: 'no id' }]);
check(bullets.length === 1 && bullets[0].name.length === 200 && bullets[0].weightGr === 140, 'custom bullets: long names capped, numeric strings parsed, incomplete entries dropped');
check(JSON.stringify(shapeLike({ a: 1, b: 'x' }, { a: 0 })) === '{"a":1}', 'unknown keys are dropped');

// --- solver loop guard ---
const p = { ...DEFAULT_PROFILES[0] };
const env = { temperatureC: 15, pressureHpa: 1013.25, humidityPercent: 50, altitudeM: 0, windSpeedMs: 0, windDirectionDeg: 90, inclinationDeg: 0, cantDeg: 0, latitudeDeg: 45, shootingAzimuthDeg: 0 };
const t0 = Date.now();
const sol = solveTrajectory({ profile: p, environment: env, airDensity: 1.225, speedOfSound: 340.3, stepM: 0, maxRangeM: 1200 });
check(Date.now() - t0 < 5000 && sol.trajectory.length > 10 && sol.trajectory.length <= 2002, `solver survives stepM = 0 (${sol.trajectory.length} rows)`);

// --- wind input must change the solution (wind zones used to override it) ---
const { appState } = await import('../src/core/state.js');
const { getWindAtDistance } = await import('../src/physics/solvers.js');
appState.updateActiveEnvironment({ windSpeedMs: 0 });
const w = getWindAtDistance(600, appState.getActiveEnvironment());
check(Math.abs(w.wz) < 1e-9 && Math.abs(w.wx) < 1e-9, 'setting wind speed to 0 removes all wind');
const head = getWindAtDistance(300, { windSpeedMs: 5, windDirectionDeg: 0, windZones: [] });
check(Math.abs(head.wz) < 1e-9 && Math.abs(Math.abs(head.wx) - 5) < 1e-9, 'a 0° (12 o\'clock) wind is a head/tail wind, not a crosswind');

// --- target sizes follow the chosen target ---
const { sanitizeTarget } = await import('../src/core/sanitize.js');
const migrated = sanitizeTarget({ targetShape: 'nato-e', targetSizeWidthCm: 45, targetSizeHeightCm: 75, distanceM: 600 }, { distanceM: 600, targetSizeWidthCm: 45, targetSizeHeightCm: 75, targetShape: 'ipsc', targetSpeedKmh: 0, targetDirectionDeg: 90 });
check(migrated.targetSizeWidthCm === 50 && migrated.targetSizeHeightCm === 100, 'a NATO E target stored with the old IPSC size gets 50 × 100 cm');

// --- the solution at an exact distance does not depend on the table step ---
const { interpolateAt } = await import('../src/core/trajectory.js');
const { DEFAULT_PROFILES: DP } = await import('../src/data/defaultProfiles.js');
const calmEnv = { temperatureC: 15, pressureHpa: 1013.25, humidityPercent: 0, altitudeM: 0, windSpeedMs: 0, windDirectionDeg: 90, windZones: [], inclinationDeg: 0, cantDeg: 0, latitudeDeg: 45, shootingAzimuthDeg: 0 };
const solveStep = (stepM) => solveTrajectory({ profile: { ...structuredClone(DP[0]), zeroAngleRad: null }, environment: calmEnv, airDensity: 1.225, speedOfSound: 340.3, stepM, maxRangeM: 1200 }).trajectory;
// The Solver solves a second time with the step on the target (workspace.js); check that's exact
const exactAt = (d) => solveTrajectory({ profile: { ...structuredClone(DP[0]), zeroAngleRad: null }, environment: calmEnv, airDensity: 1.225, speedOfSound: 340.3, stepM: d, maxRangeM: d }).trajectory.find((p) => Math.abs(p.distanceM - d) < 1e-6);
for (const d of [10, 37, 640]) {
  const ref = solveStep(1).find((p) => Math.abs(p.distanceM - d) < 1e-6).elevationMrad;
  const got = exactAt(d)?.elevationMrad;
  check(got !== undefined && Math.abs(got - ref) < 0.005, `exact solve at ${d} m matches a 1 m table (${got?.toFixed(3)} / ${ref.toFixed(3)} MRAD)`);
}
// The interpolation fallback recomputes angles from drop: close within a 10 m table
check(Math.abs(interpolateAt(solveStep(10), 645).elevationMrad - exactAt(645).elevationMrad) < 0.01, 'interpolated angle at 645 m within 0.01 MRAD (10 m table)');

if (failed) process.exit(1);
