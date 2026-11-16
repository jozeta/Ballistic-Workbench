/**
 * Ballistic Workbench - checks for the hunting helpers, multi-point truing, sharing and the
 * match / logbook / hunting data validation.
 * Run with: node tests/features.mjs
 */

import { DEFAULT_PROFILES, DEFAULT_ENVIRONMENTS } from '../src/data/defaultProfiles.js';
import { getAtmosphericConditions } from '../src/physics/atmosphere.js';
import { solveTrajectory, pointAtDistance } from '../src/physics/solvers.js';
import { maxPointBlankRange, rangeLimits } from '../src/physics/hunting.js';
import { fitLogbook, canFitDrag } from '../src/physics/fit.js';
import { encodeShare, decodeShare, payloadFromHash, shareFileName, readEnvelope, shareEnvelope } from '../src/core/share.js';
import { sanitizeMatches, sanitizeLogbook, sanitizeHunting } from '../src/core/sanitize.js';
import { StateStore } from '../src/core/state.js';

let passed = 0;
let total = 0;
function assert(cond, msg) {
  total++;
  if (cond) {
    passed++;
    console.log(`PASS: ${msg}`);
  } else {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  }
}
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

const profile = structuredClone(DEFAULT_PROFILES[0]); // 6.5 CM 140 ELD-M, 825 m/s, 4.8 cm sight height
const env = { ...DEFAULT_ENVIRONMENTS[0], windZones: [] };
const atmosOf = (e) => getAtmosphericConditions({ pressurePa: e.pressureHpa * 100, tempK: e.temperatureC + 273.15, relativeHumidity: e.humidityPercent / 100, altitudeM: e.altitudeM });
const atm = atmosOf(env);
const base = { profile, environment: env, airDensity: atm.densityKgM3, speedOfSound: atm.speedOfSoundMs };

// ---- maximum point-blank range ---------------------------------------------------------------
console.log('[1/5] Maximum point-blank range');
const mpbr = maxPointBlankRange({ ...base, vitalZoneM: 0.2 });
assert(mpbr && near(mpbr.mpbrM, 285, 6), `6.5 CM, 20 cm vital zone: MPBR about 285 m (got ${mpbr?.mpbrM?.toFixed(1)})`);
assert(near(mpbr.farZeroM, 242, 6), `zero distance about 242 m (got ${mpbr.farZeroM?.toFixed(1)})`);
assert(mpbr.nearM === 0, 'sight height inside the zone: point blank from the muzzle');
assert(near(mpbr.heightAt100M, 0.089, 0.01), `about 9 cm high at 100 m (got ${(mpbr.heightAt100M * 100).toFixed(1)} cm)`);
{
  // Check the definition directly with that bore angle: highest point +10 cm, -10 cm at the MPBR
  const rows = solveTrajectory({ ...base, profile: { ...profile, zeroAngleRad: mpbr.boreAngleRad }, environment: { ...env, windSpeedMs: 0 }, algorithm: 'G7', stepM: 1, maxRangeM: 400 }).trajectory;
  const top = Math.max(...rows.map((r) => r.dropM));
  assert(near(top, 0.1, 0.002), `top of the path is +half the zone (${(top * 100).toFixed(2)} cm)`);
  assert(near(pointAtDistance(rows, mpbr.mpbrM).dropM, -0.1, 0.002), 'bullet is half the zone low at the MPBR');
}
const big = maxPointBlankRange({ ...base, vitalZoneM: 0.3 });
assert(big.mpbrM > mpbr.mpbrM, 'a bigger vital zone gives a longer MPBR');
const tall = maxPointBlankRange({ ...base, profile: { ...profile, sightHeightM: 0.08 }, vitalZoneM: 0.1 });
assert(tall.nearM > 0, `sight height above half the zone: the zone starts past the muzzle (${tall.nearM.toFixed(1)} m)`);
assert(maxPointBlankRange({ ...base, vitalZoneM: 0 }) === null, 'no vital zone: no result');

// ---- energy and velocity limits ---------------------------------------------------------------
console.log('[2/5] Energy and velocity limits');
const traj = solveTrajectory({ ...base, algorithm: 'G7', stepM: 25, maxRangeM: 1500 }).trajectory;
const lim = rangeLimits(traj, { minEnergyJ: 1356, minVelocityMs: 549 });
assert(near(pointAtDistance(traj, lim.energyLimitM).energyJ, 1356, 2), 'energy limit is where energy crosses the minimum');
assert(near(pointAtDistance(traj, lim.velocityLimitM).velocityMs, 549, 0.5), 'velocity limit is where velocity crosses the minimum');
assert(lim.limitM === Math.min(lim.energyLimitM, lim.velocityLimitM), 'the limit is the nearer of the two');
assert(rangeLimits(traj, { minEnergyJ: 1, minVelocityMs: 0 }).beyond, 'a minimum never reached: beyond the table');
assert(rangeLimits(traj, { minEnergyJ: 1e6 }).limitM === 0, 'a minimum above muzzle energy: limit 0');

// ---- multi-point truing --------------------------------------------------------------------------
console.log('[3/5] Multi-point truing');
const truth = { ...profile, muzzleVelocityMs: 840, bullet: { ...profile.bullet, bcG7: 0.3 } };
const days = [env, { ...env, temperatureC: 0 }, { ...env, temperatureC: 25, pressureHpa: 950 }];
const observe = (d, e) => {
  const a = atmosOf(e);
  const s = solveTrajectory({ profile: { ...truth, zeroAngleRad: null }, environment: e, airDensity: a.densityKgM3, speedOfSound: a.speedOfSoundMs, algorithm: 'G7', stepM: 10, maxRangeM: d + 20 });
  return { distanceM: d, observedElevationRad: pointAtDistance(s.trajectory, d).elevationRad, environment: e };
};
const entries = [300, 600, 800, 1000].map((d, i) => observe(d, days[i % 3]));
const fit = fitLogbook({ profile, entries });
assert(near(fit.muzzleVelocityMs, 840, 0.5), `recovers MV 840 m/s from 4 entries on 3 days (${fit.muzzleVelocityMs.toFixed(2)})`);
assert(near(fit.bc, 0.3, 0.002) && fit.fittedDrag, `recovers G7 BC 0.300 (${fit.bc.toFixed(4)})`);
assert(fit.rmsAfterMrad < 0.005 && fit.rmsBeforeMrad > 0.03, `residuals drop from ${fit.rmsBeforeMrad.toFixed(3)} to ${fit.rmsAfterMrad.toFixed(4)} MRAD`);
const short = fitLogbook({ profile, entries: [observe(400, env), observe(450, env)] });
assert(!short.fittedDrag && short.dsf === 1, 'entries close together: only MV is fitted');
assert(!canFitDrag([{ distanceM: 600 }]) && canFitDrag([{ distanceM: 300 }, { distanceM: 800 }]), 'drag needs spread and reach');
{
  // Noisy readings (±0.05 MRAD): still close
  const noisy = entries.map((e, i) => ({ ...e, observedElevationRad: e.observedElevationRad + [0.00005, -0.00005, 0.00003, -0.00002][i] }));
  const f = fitLogbook({ profile, entries: noisy });
  assert(near(f.muzzleVelocityMs, 840, 6) && near(f.bc, 0.3, 0.015), `noisy readings: MV ${f.muzzleVelocityMs.toFixed(1)}, BC ${f.bc.toFixed(3)}`);
}
assert(fitLogbook({ profile, entries: [] }) === null, 'no entries: no fit');

// ---- sharing ------------------------------------------------------------------------------------
console.log('[4/5] Sharing');
const payload = await encodeShare('rifle', profile);
assert(payload[0] === 'z' && /^[A-Za-z0-9_-]+$/.test(payload.slice(1)), 'payload is compressed base64url');
const back = await decodeShare(payload);
assert(back?.kind === 'rifle' && back.data.name === profile.name && back.data.bullet.bcG7 === profile.bullet.bcG7, 'round trip keeps the rifle');
assert(payload.length < 900, `a rifle link fits a QR code easily (${payload.length} characters)`);
assert(await decodeShare('z!!!') === null, 'bad characters are refused');
assert(await decodeShare('zAAAA') === null, 'garbage is refused');
assert(await decodeShare(`j${Buffer.from('{"app":"other"}').toString('base64url')}`) === null, 'another app\'s data is refused');
assert(await decodeShare(`j${Buffer.from(JSON.stringify(shareEnvelope('rifle', profile))).toString('base64url')}`) !== null, 'the plain form decodes');
{
  // A deflate bomb (5 MB of zeros) must stop at the size cap
  const zeros = new Uint8Array(5 * 1024 * 1024);
  const bomb = new Uint8Array(await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  assert(await decodeShare(`z${Buffer.from(bomb).toString('base64url')}`) === null, 'a deflate bomb is refused');
}
assert(readEnvelope({ app: 'ballistic-workbench', type: 'share', kind: 'virus', version: 1, data: {} }) === null, 'unknown kinds are refused');
assert(payloadFromHash(`#share=${payload}`) === payload && payloadFromHash('#workspace') === null, 'share links are recognised');
assert(shareFileName('My <rifle>/.308') === 'My-rifle-.308.bwshare.json', 'file names are safe');

// ---- validation and merging -------------------------------------------------------------------------
console.log('[5/5] Validation and merging');
const evil = sanitizeMatches([{ id: 'x', name: '<b>M</b>', __proto__: { polluted: true }, stages: [{ name: '', targets: [{ distanceM: 1e9, targetShape: 'evil', offsetDeg: 999, extra: 'drop' }] }] }, 'junk']);
assert(evil.length === 1 && evil[0].stages[0].targets[0].distanceM === 5000, 'distances are clamped');
assert(evil[0].stages[0].targets[0].targetShape === 'square' && evil[0].stages[0].targets[0].offsetDeg === 180, 'bad shapes and angles are fixed');
assert(!('extra' in evil[0].stages[0].targets[0]) && evil[0].stages[0].name === 'Stage 1', 'unknown keys dropped, empty names filled');
assert(({}).polluted === undefined, 'no prototype pollution');
const logs = sanitizeLogbook([{ id: 'a', profileId: 'p1', date: '2026-11-16', distanceM: 600, dialRad: 0.0045, impactOffsetM: 0.06, observedElevationRad: 99 }, { id: 'b', distanceM: 300 }]);
assert(logs.length === 1, 'entries without a rifle are dropped');
assert(near(logs[0].observedElevationRad, 0.0045 - 0.06 / 600, 1e-12), 'observed elevation = dial − impact offset ÷ distance (6 cm high at 600 m = 0.1 MRAD less)');
assert(sanitizeLogbook([{ id: 'c', profileId: 'p', date: '<script>' }])[0].date === '', 'bad dates are dropped');
assert(sanitizeHunting({ vitalZoneM: 50, minEnergyJ: -3 }).vitalZoneM === 1, 'hunting values are clamped');

const store = new StateStore();
const first = store.importShared('rifle', { ...profile, name: 'Shared rifle', id: 'profile-shared-1' });
assert(first?.status === 'added' && store.getActiveProfile().name === 'Shared rifle', 'a shared rifle is added and selected');
const again = store.importShared('rifle', { ...profile, name: 'Shared rifle', id: 'profile-shared-1' });
assert(again.status === 'same' && store.state.profiles.filter((p) => p.id === 'profile-shared-1').length === 1, 'the same rifle again is not duplicated');
const changed = store.importShared('rifle', { ...profile, name: 'Shared rifle', id: 'profile-shared-1', muzzleVelocityMs: 800 });
assert(changed.status === 'copy' && store.state.profiles.find((p) => p.id === 'profile-shared-1').muzzleVelocityMs === profile.muzzleVelocityMs, 'a different rifle with the same id is added as a copy; the original is untouched');
const m = store.importShared('match', { id: 'match-a', name: 'Club match', stages: [{ id: 'st1', name: 'Barricade', targets: [{ id: 't1', name: 'T1', distanceM: 450 }] }] });
assert(m.status === 'added' && store.getActiveMatch().stages[0].targets[0].distanceM === 450, 'a shared match is added');
assert(store.importShared('virus', {}) === null, 'unknown kinds are not imported');
store.addLogEntry({ profileId: store.state.activeProfileId, date: '2026-11-16', distanceM: 600, dialRad: 0.0044, impactOffsetM: 0 });
assert(store.logbookFor().length === 1, 'a logbook entry is stored for the active rifle');
const backup = JSON.parse(store.exportJSON());
const fresh = new StateStore();
fresh.importJSON(JSON.stringify(backup));
assert(fresh.state.matches.length === 1 && fresh.state.logbook.length === 1, 'backups carry matches and the logbook');

console.log(`\n${passed}/${total} feature checks passed`);
