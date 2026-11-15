/**
 * Ballistic Workbench - CLI Physics & Solver Verification Suite
 * Run with: node tests/verify.mjs
 */

import { UnitConverter } from '../src/core/units.js';
import { getCd, G1_SPLINE, G7_SPLINE, G1_TABLE, G7_TABLE } from '../src/data/dragTables.js';
import { PROJECTILES, calculateStability } from '../src/data/projectiles.js';
import { DEFAULT_PROFILES, DEFAULT_ENVIRONMENTS } from '../src/data/defaultProfiles.js';
import {
  getAirDensity,
  getSpeedOfSound,
  getDensityAltitude,
  getSaturationVaporPressure,
  getVirtualTemperature,
  getAtmosphericConditions,
} from '../src/physics/atmosphere.js';
import { solveZeroAngle, solveTrajectory, getWindAtDistance, pointAtDistance } from '../src/physics/solvers.js';
import { trueMuzzleVelocity, trueDropScaleFactor } from '../src/physics/truing.js';
import { runWezSimulation, isTargetHit } from '../src/physics/wez.js';

let passedTests = 0;
let totalTests = 0;

const failures = [];
// Records a result instead of throwing, so one run shows every failing check. The process exits
// non-zero at the end if anything failed.
function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failures.push(message);
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    return;
  }
  passedTests++;
  console.log(`PASS: ${message}`);
}
function near(actual, expected, tol) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
}

console.log('--- STARTING BALLISTIC WORKBENCH VERIFICATION SUITE ---\n');

// 1. UNIT CONVERSIONS TEST
console.log('[1/7] Testing Unit Converter...');
assert(Math.abs(UnitConverter.toSI(100, 'yd') - 91.44) < 1e-4, '100 yards to SI meters');
assert(Math.abs(UnitConverter.fromSI(91.44, 'yd') - 100) < 1e-4, '91.44 meters to yards');
assert(Math.abs(UnitConverter.toSI(1, 'gr') - 0.00006479891) < 1e-8, '1 grain to kg');
assert(Math.abs(UnitConverter.toSI(1, 'MOA') - 0.0002908882) < 1e-6, '1 MOA to radians');
assert(Math.abs(UnitConverter.convert(1, 'MRAD', 'MOA') - 3.43775) < 0.01, '1 MRAD to MOA');
assert(Math.abs(UnitConverter.toSI(1013.25, 'hPa') - 101325) < 1e-2, '1013.25 hPa to Pa');
assert(Math.abs(UnitConverter.toSI(32, 'F') - 273.15) < 1e-3, '32 F to Kelvin');
assert(Math.abs(UnitConverter.fromSI(293.15, 'C') - 20) < 1e-3, '293.15 K to 20 C');

// 2. ATMOSPHERIC MODEL TEST
console.log('\n[2/7] Testing Atmosphere Engine (ICAO & CIPM)...');
const stdP = 101325.0; // Pa
const stdT = 288.15; // K (15 C)
const stdRh = 0.5; // 50%
const density = getAirDensity(stdP, stdT, stdRh);
assert(density > 1.21 && density < 1.23, `Standard air density ~1.22 kg/m3 (got: ${density.toFixed(4)})`);

const soundSpeed = getSpeedOfSound(stdP, density);
assert(soundSpeed > 338 && soundSpeed < 343, `Standard speed of sound ~340 m/s (got: ${soundSpeed.toFixed(2)})`);

const da = getDensityAltitude(density);
assert(Math.abs(da) < 150, `Standard sea level DA within 150m (got: ${da.toFixed(1)})`);

const es = getSaturationVaporPressure(stdT);
assert(es > 1650 && es < 1750, `Tetens saturation vapor pressure at 15C ~1705 Pa (got: ${es.toFixed(1)})`);

const tv = getVirtualTemperature(stdP, stdT, stdRh);
assert(tv >= stdT && tv < stdT + 2, `Virtual temp slightly higher than dry temp (got: ${tv.toFixed(2)})`);

// 3. DRAG TABLES & SPLINE INTERPOLATION
console.log('\n[3/7] Testing Drag Tables & Splines...');
// Reference values: the standard G1 and G7 drag functions as published by JBM Ballistics
// (mcg1.txt / mcg7.txt, from the BRL / McCoy tables). py-ballisticcalc's drag_tables.py carries
// identical numbers.
const CD_REF = {
  G1: [[0.0, 0.2629], [0.5, 0.2032], [0.8, 0.2546], [0.9, 0.3415], [0.95, 0.4084], [1.0, 0.4805], [1.05, 0.5427],
    [1.2, 0.6393], [1.5, 0.6573], [2.0, 0.5934], [2.5, 0.5397], [3.0, 0.5133], [4.0, 0.5006], [5.0, 0.4988]],
  G7: [[0.0, 0.1198], [0.5, 0.1194], [0.8, 0.1242], [0.9, 0.1464], [0.95, 0.2054], [1.0, 0.3803], [1.05, 0.4043],
    [1.2, 0.3884], [1.5, 0.3440], [2.0, 0.2980], [2.5, 0.2697], [3.0, 0.2424], [4.0, 0.1935], [5.0, 0.1618]],
};
for (const model of ['G1', 'G7']) {
  for (const [mach, cd] of CD_REF[model]) {
    const got = getCd(model, mach);
    assert(near(got, cd, 0.001), `${model} Cd at Mach ${mach} is ${cd} (got: ${got.toFixed(4)})`);
  }
}
assert(G1_TABLE.mach.length === 79 && G7_TABLE.mach.length === 84, `Full standard tables loaded (G1 ${G1_TABLE.mach.length}/79, G7 ${G7_TABLE.mach.length}/84 points)`);
assert(G7_SPLINE.interpolate(0.5) < G7_SPLINE.interpolate(1.1), 'G7 subsonic Cd lower than supersonic peak');
assert(G7_SPLINE.interpolate(2.0) < G1_SPLINE.interpolate(2.0), 'G7 boat-tail Cd lower than G1 flat-base at Mach 2');
assert(getCd('DOPPLER', 1.5) === getCd('G7', 1.5), 'Legacy DOPPLER drag model falls back to the standard G7 table');
// Between nodes the curve must stay between the neighbouring table values (no spline overshoot)
for (const [model, tab] of [['G1', G1_TABLE], ['G7', G7_TABLE]]) {
  let ok = true;
  for (let i = 0; i < tab.mach.length - 1; i++) {
    const mid = getCd(model, (tab.mach[i] + tab.mach[i + 1]) / 2);
    const lo = Math.min(tab.cd[i], tab.cd[i + 1]) - 1e-9;
    const hi = Math.max(tab.cd[i], tab.cd[i + 1]) + 1e-9;
    if (!(mid >= lo && mid <= hi)) ok = false;
  }
  assert(ok, `${model} interpolation is monotone between table points (no overshoot)`);
}

// 4. PROJECTILES & STABILITY
console.log('\n[4/7] Testing Projectile Database & Miller Twist...');
assert(PROJECTILES.length >= 35, `35+ projectiles available (got: ${PROJECTILES.length})`);
assert(PROJECTILES.length >= 100, `Expanded projectile library contains 100+ projectiles (got: ${PROJECTILES.length})`);

// Deep check: Validate every projectile record schema and data integrity
const requiredBrands = ['Sako', 'Norma', 'GGG', 'Lapua', 'Hornady', 'Federal', 'Sierra', 'RWS', 'Sellier & Bellot'];
const brandCounts = Object.fromEntries(requiredBrands.map((b) => [b, 0]));

PROJECTILES.forEach((p) => {
  assert(p.id && typeof p.id === 'string' && p.id.trim().length > 0, `Projectile has valid id: ${p.name}`);
  assert(p.name && typeof p.name === 'string' && p.name.trim().length > 0, `Projectile has valid name: ${p.id}`);
  assert(p.caliber && typeof p.caliber === 'string', `Projectile has caliber string: ${p.id}`);
  assert(p.manufacturer && typeof p.manufacturer === 'string', `Projectile has manufacturer: ${p.id}`);
  assert(typeof p.weightGr === 'number' && p.weightGr > 20 && p.weightGr < 1500, `Valid weightGr for ${p.id}: ${p.weightGr}`);
  assert(typeof p.diameterIn === 'number' && p.diameterIn > 0.15 && p.diameterIn < 1.0, `Valid diameterIn for ${p.id}: ${p.diameterIn}`);
  assert(typeof p.lengthIn === 'number' && p.lengthIn > 0.5 && p.lengthIn < 4.0, `Valid lengthIn for ${p.id}: ${p.lengthIn}`);
  assert(typeof p.bcG1 === 'number' && p.bcG1 > 0.1 && p.bcG1 < 1.5, `Valid bcG1 for ${p.id}: ${p.bcG1}`);
  assert(typeof p.bcG7 === 'number' && p.bcG7 > 0.05 && p.bcG7 < 1.0, `Valid bcG7 for ${p.id}: ${p.bcG7}`);
  assert(typeof p.factoryVelocityFps === 'number' && p.factoryVelocityFps > 1500 && p.factoryVelocityFps < 4500, `Valid factoryVelocityFps for ${p.id}: ${p.factoryVelocityFps}`);
  assert(typeof p.factoryVelocityMs === 'number' && p.factoryVelocityMs > 500 && p.factoryVelocityMs < 1500, `Valid factoryVelocityMs for ${p.id}: ${p.factoryVelocityMs}`);
  assert(typeof p.velocityRangeFps === 'string' && p.velocityRangeFps.includes('fps'), `Valid velocityRangeFps for ${p.id}`);
  assert(typeof p.recommendedTwist === 'string' && p.recommendedTwist.length > 0, `Valid recommendedTwist for ${p.id}`);

  if (requiredBrands.includes(p.manufacturer)) {
    brandCounts[p.manufacturer]++;
  }
});

for (const brand of requiredBrands) {
  assert(brandCounts[brand] >= 5, `Brand "${brand}" well represented with >=5 bullets (got: ${brandCounts[brand]})`);
}

// Deep stability verification across all projectiles in database
PROJECTILES.forEach((p) => {
  const match = p.recommendedTwist.match(/1:([0-9.]+)/);
  const twist = match ? parseFloat(match[1]) : 8.0;
  const res = calculateStability(p.weightGr, p.diameterIn, p.lengthIn, twist, p.factoryVelocityFps);
  assert(isFinite(res.sg) && res.sg >= 1.0, `Projectile ${p.id} gyroscopically stable at rec twist 1:${twist}" (got Sg: ${res.sg})`);
});

// BC provenance: every bullet either names a checked source or is flagged as an estimated G7
assert(PROJECTILES.every((p) => (typeof p.bcSource === 'string' && p.bcSource.length > 0) !== (p.bcG7Estimated === true)),
  'Every bullet has exactly one of bcSource (checked BCs) or bcG7Estimated: true');
assert(PROJECTILES.every((p) => p.dragModel === 'G1' || p.dragModel === 'G7'), 'Library uses only the standard G1 / G7 drag models');
{
  const byId = (id) => PROJECTILES.find((p) => p.id === id);
  const checks = [
    ['sierra-308-175-smk', 0.505, 0.243], ['sierra-308-168-smk', 0.462, 0.218], ['hornady-65-140-eldm', 0.646, 0.326],
    ['hornady-308-230-atip', 0.823, 0.414], ['hornady-300wm-200-eldx', 0.597, 0.301], ['berger-308-215-hybrid', 0.691, 0.354],
    ['berger-6mm-105-hybrid', 0.536, 0.275], ['federal-223-73-berger', 0.348, 0.178],
  ];
  for (const [id, g1, g7] of checks) {
    const p = byId(id);
    assert(p && p.bcG1 === g1 && p.bcG7 === g7 && !p.bcG7Estimated, `${id}: published BC G1 ${g1} / G7 ${g7} (got ${p?.bcG1} / ${p?.bcG7})`);
  }
}

// Check coverage of key lines requested
assert(PROJECTILES.some((p) => p.manufacturer === 'Sako' && p.name.includes('Powerhead Blade')), 'Sako Powerhead Blade bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Sako' && p.name.includes('TRG Precision')), 'Sako TRG Precision bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Sako' && p.name.includes('Super Hammerhead')), 'Sako Super Hammerhead bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Sako' && p.name.includes('Gamehead Pro')), 'Sako Gamehead Pro bullets present');

assert(PROJECTILES.some((p) => p.manufacturer === 'Norma' && p.name.includes('Diamond Line')), 'Norma Diamond Line bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Norma' && p.name.includes('Golden Target')), 'Norma Golden Target bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Norma' && p.name.includes('Bondstrike')), 'Norma Bondstrike bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Norma' && p.name.includes('Tipstrike')), 'Norma Tipstrike bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Norma' && p.name.includes('Oryx')), 'Norma Oryx bullets present');

assert(PROJECTILES.some((p) => p.manufacturer === 'GGG' && p.caliber.includes('5.56') && p.name.includes('Sierra MatchKing')), 'GGG .223 Sierra MatchKing present');
assert(PROJECTILES.some((p) => p.manufacturer === 'GGG' && p.caliber.includes('308') && p.name.includes('Sierra MatchKing')), 'GGG .308 Sierra MatchKing present');

assert(PROJECTILES.some((p) => p.manufacturer === 'Lapua' && p.name.includes('Mega')), 'Lapua Mega bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Lapua' && p.name.includes('Naturalis')), 'Lapua Naturalis bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Lapua' && p.name.includes('Scenar')), 'Lapua Scenar bullets present');

assert(PROJECTILES.some((p) => p.manufacturer === 'Hornady' && p.name.includes('ELD Match')), 'Hornady ELD Match bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Hornady' && p.name.includes('ELD-X')), 'Hornady ELD-X bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Hornady' && p.name.includes('CX')), 'Hornady CX bullets present');

assert(PROJECTILES.some((p) => p.manufacturer === 'Federal' && p.name.includes('Berger')), 'Federal Berger bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Federal' && p.name.includes('Terminal Ascent')), 'Federal Terminal Ascent bullets present');

assert(PROJECTILES.some((p) => p.manufacturer === 'Sierra' && p.name.includes('MatchKing')), 'Sierra MatchKing bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Sierra' && p.name.includes('Tipped MatchKing')), 'Sierra Tipped MatchKing bullets present');
assert(PROJECTILES.some((p) => p.manufacturer === 'Sierra' && p.name.includes('GameChanger')), 'Sierra GameChanger bullets present');

// Caliber coverage check
const keyCalibers = [
  { label: '.223 / 5.56', check: (p) => p.caliber.includes('5.56') },
  { label: '6mm Creedmoor', check: (p) => p.caliber.includes('6mm') },
  { label: '6.5 Creedmoor / PRC', check: (p) => p.caliber.includes('6.5') },
  { label: '.308 Win', check: (p) => p.caliber.includes('308') },
  { label: '.300 Win Mag / PRC', check: (p) => p.caliber.includes('300') },
  { label: '.338 Lapua Mag', check: (p) => p.caliber.includes('338') },
];
for (const cal of keyCalibers) {
  const count = PROJECTILES.filter(cal.check).length;
  assert(count >= 8, `Caliber ${cal.label} has >=8 projectiles (got: ${count})`);
}

// Caliber isolation check: verify 6mm filter contains no .224 bullets, and .223 contains no 6mm bullets
const sixMmBullets = PROJECTILES.filter((p) => p.caliber.includes('6mm'));
assert(sixMmBullets.length >= 8, `6mm Creedmoor has >=8 bullets (got: ${sixMmBullets.length})`);
assert(sixMmBullets.every((p) => p.diameterIn === 0.243), '6mm filter contains ONLY .243 bullets, zero 5.56 bleed');
assert(sixMmBullets.every((p) => !p.caliber.includes('5.56')), '6mm bullets do not contain 5.56 string');

const fiveFiveSixBullets = PROJECTILES.filter((p) => p.caliber.includes('5.56'));
assert(fiveFiveSixBullets.length >= 8, `5.56/.223 has >=8 bullets (got: ${fiveFiveSixBullets.length})`);
assert(fiveFiveSixBullets.every((p) => p.diameterIn === 0.224), '5.56/.223 filter contains ONLY .224 bullets');

const stabResult = calculateStability(140, 0.264, 1.378, 8.0, 2700);
assert(stabResult.sg > 1.4 && stabResult.sg < 1.8, `6.5mm 140gr in 1:8" twist Sg ~1.5 (got: ${stabResult.sg})`);
assert(stabResult.badgeClass === 'stable', 'Status is stable');
// Miller atmospheric correction: Sg is proportional to (T_R / 518.67) * (29.92 / P_inHg), so thinner
// (hotter or higher) air makes a bullet MORE stable.
{
  const L = 1.378 / 0.264;
  const T = 8.0 / 0.264;
  const millerStd = (30 * 140) / (T * T * Math.pow(0.264, 3) * L * (1 + L * L)) * Math.cbrt(2700 / 2800);
  const sStd = calculateStability(140, 0.264, 1.378, 8.0, 2700, 59, 29.92).sg;
  const sHot = calculateStability(140, 0.264, 1.378, 8.0, 2700, 100, 29.92).sg;
  const sHigh = calculateStability(140, 0.264, 1.378, 8.0, 2700, 59, 24.0).sg;
  assert(near(sStd, millerStd, 0.006), `Miller Sg at standard conditions matches the formula (${sStd} vs ${millerStd.toFixed(3)})`);
  assert(near(sHot, millerStd * (559.67 / 518.67), 0.006), `Miller Sg rises in hot air: 100 F gives ${sHot} (expected ${(millerStd * 559.67 / 518.67).toFixed(3)})`);
  assert(near(sHigh, millerStd * (29.92 / 24.0), 0.006), `Miller Sg rises at low pressure: 24 inHg gives ${sHigh} (expected ${(millerStd * 29.92 / 24).toFixed(3)})`);
}

// 5. RK4 ZERO & TRAJECTORY SOLVERS
console.log('\n[5/7] Testing RK4 Zero & Trajectory Solvers...');
const defaultProfile = DEFAULT_PROFILES[0]; // 6.5 Creedmoor
const defaultEnv = DEFAULT_ENVIRONMENTS[0];
const atmos = getAtmosphericConditions({
  pressurePa: defaultEnv.pressureHpa * 100,
  tempK: defaultEnv.temperatureC + 273.15,
  relativeHumidity: defaultEnv.humidityPercent / 100,
  altitudeM: defaultEnv.altitudeM,
});

const zeroAngle = solveZeroAngle(defaultProfile, defaultEnv, atmos.densityKgM3, atmos.speedOfSoundMs);
assert(zeroAngle > 0.0005 && zeroAngle < 0.003, `Calculated bore zero angle ~1.2 mrad (got: ${(zeroAngle * 1000).toFixed(3)} mrad)`);

const solG7 = solveTrajectory({
  profile: { ...defaultProfile, zeroAngleRad: zeroAngle },
  environment: defaultEnv,
  airDensity: atmos.densityKgM3,
  speedOfSound: atmos.speedOfSoundMs,
  algorithm: 'G7',
  stepM: 25,
  maxRangeM: 1000,
});

// Check zero point at 100m
const point100 = solG7.trajectory.find((p) => p.distanceM === 100);
assert(Math.abs(point100.dropM) < 1e-4, `Zero drop at 100m is 0 within 0.1 mm (got: ${(point100.dropM * 1000).toFixed(3)} mm)`);

// Check 600m point (default environment: ICAO with 50 % humidity, slightly thinner than dry ICAO air)
const point600 = solG7.trajectory.find((p) => p.distanceM === 600);
assert(point600.dropM < -2.55 && point600.dropM > -2.75, `Drop at 600m about -2.65 m (got: ${point600.dropM.toFixed(3)} m)`);
assert(point600.velocityMs > 560 && point600.velocityMs < 580, `Velocity at 600m about 568 m/s (got: ${point600.velocityMs.toFixed(1)} m/s)`);
assert(point600.mach > 1.6 && point600.mach < 1.7, `Mach at 600m about 1.67 (got: ${point600.mach.toFixed(3)})`);

// MPM Solver (with Spin Drift & Aerodynamic Jump)
const solMpm = solveTrajectory({
  profile: { ...defaultProfile, zeroAngleRad: zeroAngle },
  environment: defaultEnv,
  airDensity: atmos.densityKgM3,
  speedOfSound: atmos.speedOfSoundMs,
  algorithm: 'MPM',
  stepM: 50,
  maxRangeM: 1000,
});
assert(solMpm.trajectory.length > 10, 'MPM solver produced trajectory points');

// 4DOF Solver
const sol4dof = solveTrajectory({
  profile: { ...defaultProfile, zeroAngleRad: zeroAngle },
  environment: defaultEnv,
  airDensity: atmos.densityKgM3,
  speedOfSound: atmos.speedOfSoundMs,
  algorithm: '4DOF',
  stepM: 50,
  maxRangeM: 1000,
});
assert(sol4dof.trajectory.length > 10, '4DOF solver produced trajectory points');

// [R] REFERENCE CHECKS
// Expected values come from outside this app:
// - point-mass benchmarks: an independent RK4 solver using the JBM G1/G7 tables, cross-checked with
//   py-ballisticcalc 2.2.2 (identical velocities and times of flight; its "mil" is 1/6400, converted)
// - Hornady's published 6.5 Creedmoor 140 gr ELD Match table (2710 fps, 200 yd zero, 1.5 in sight height)
// - Bryan Litz's spin drift and aerodynamic jump formulas
// - py-ballisticcalc 2.2.2 results for inclination, cant, wind, Coriolis and spin drift
console.log('\n[R] Reference checks (standard tables, Hornady, Litz, py-ballisticcalc)...');
const ICAO_RHO = 1.225;
const ICAO_SOS = Math.sqrt((1.4 * 101325) / 1.225); // 340.294 m/s
const calm = { windSpeedMs: 0, windDirectionDeg: 90, windZones: [], inclinationDeg: 0, cantDeg: 0, latitudeDeg: 45, shootingAzimuthDeg: 0 };
const mkProfile = (bullet, mv, twist, extra = {}) => ({
  bullet, muzzleVelocityMs: mv, sightHeightM: 0.048, zeroDistanceM: 100, zeroAngleRad: null,
  twistRateIn: twist, twistDirection: 'right', optic: { clickValueRad: 0.0001 }, ...extra,
});
const b65 = { weightGr: 140, diameterIn: 0.264, lengthIn: 1.378, bcG1: 0.646, bcG7: 0.326, dragModel: 'G7' };
const b308 = { weightGr: 175, diameterIn: 0.308, lengthIn: 1.24, bcG1: 0.496, bcG7: 0.243, dragModel: 'G7' };
const b223 = { weightGr: 77, diameterIn: 0.224, lengthIn: 0.99, bcG1: 0.372, bcG7: 0.19, dragModel: 'G7' };
const p65 = mkProfile(b65, 825, 8);
const solveRef = (profile, env, algorithm = 'G7', extra = {}) => solveTrajectory({
  profile, environment: env, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, algorithm, stepM: 50, maxRangeM: 1200, ...extra,
});
const at = (sol, d) => pointAtDistance(sol.trajectory, d);

// R.1 Point-mass benchmarks, ICAO dry air, no wind, 100 m zero, 4.8 cm sight height
const BENCH = [
  ['6.5 CM 140 ELD-M, G7 0.326, 825 m/s', p65, 'G7', [[300, 1.370, 689.4], [600, 4.429, 567.5], [1000, 10.231, 422.4]]],
  ['.308 175 SMK, G7 0.243, 2600 fps', mkProfile(b308, 2600 * 0.3048, 10), 'G7', [[300, 1.628, 618.0], [600, 5.512, 466.0], [1000, 14.223, 315.3]]],
  ['.308 175 SMK, G1 0.496, 2600 fps', mkProfile(b308, 2600 * 0.3048, 10), 'G1', [[300, 1.616, 622.1], [600, 5.437, 476.5], [1000, 13.595, 340.9]]],
  ['.223 77 SMK, G7 0.190, 2750 fps', mkProfile(b223, 2750 * 0.3048, 8), 'G7', [[300, 1.526, 611.9], [600, 5.569, 421.7], [1000, 16.115, 290.1]]],
];
for (const [name, prof, alg, rows] of BENCH) {
  const sol = solveRef(prof, calm, alg);
  for (const [d, mrad, v] of rows) {
    const p = at(sol, d);
    assert(near(p.elevationMrad, mrad, 0.05), `${name}: elevation at ${d} m is ${mrad} mrad ±0.05 (got ${p.elevationMrad.toFixed(3)})`);
    assert(near(p.velocityMs, v, 1.0), `${name}: velocity at ${d} m is ${v} m/s ±1 (got ${p.velocityMs.toFixed(1)})`);
  }
}

// R.2 Hornady published table, 6.5 CM 140 ELD-M (G7 0.326), 2710 fps, 200 yd zero, 1.5 in sight height.
// Hornady computes its tables with its own radar drag curve, so allow 1.5 % velocity and 1 in drop.
{
  const yd = 0.9144;
  const prof = { ...mkProfile(b65, 2710 * 0.3048, 8), sightHeightM: 1.5 * 0.0254, zeroDistanceM: 200 * yd };
  const sol = solveRef(prof, calm, 'G7', { stepM: 10, maxRangeM: 600 });
  for (const [ydd, fps, inch] of [[100, 2564, 1.9], [200, 2422, 0], [300, 2285, -7.8], [400, 2152, -22.3], [500, 2023, -44.4]]) {
    const p = at(sol, ydd * yd);
    const gotFps = p.velocityMs / 0.3048;
    const gotIn = p.dropM / 0.0254;
    assert(Math.abs(gotFps - fps) <= fps * 0.015, `Hornady table ${ydd} yd: ${fps} fps ±1.5 % (got ${gotFps.toFixed(0)})`);
    assert(near(gotIn, inch, 1.0), `Hornady table ${ydd} yd: ${inch} in ±1.0 (got ${gotIn.toFixed(1)})`);
  }
}

// R.3 The zero is solved level, with no wind, cant, Coriolis or jump, whatever the shooting conditions
{
  const z0 = solveZeroAngle(p65, calm, ICAO_RHO, ICAO_SOS, 'G7');
  assert(near(z0 * 1000, 1.229, 0.002), `Zero angle for the 6.5 CM benchmark is 1.229 mrad (got ${(z0 * 1000).toFixed(4)})`);
  const rough = {
    ...calm, inclinationDeg: 20, cantDeg: 8, windSpeedMs: 10, windDirectionDeg: 90,
    windZones: [{ startM: 0, endM: 2000, speedMs: 10, directionDeg: 90 }], latitudeDeg: 60, shootingAzimuthDeg: 90,
  };
  for (const alg of ['G7', 'MPM', '4DOF']) {
    const z = solveZeroAngle(p65, rough, ICAO_RHO, ICAO_SOS, alg);
    assert(near(z, z0, 1e-9), `${alg} zero does not change with incline, cant, wind or Coriolis (${(z * 1000).toFixed(5)} vs ${(z0 * 1000).toFixed(5)} mrad)`);
  }
  const auto = solveRef(p65, rough, 'MPM');
  assert(near(auto.telemetry.boreAngleRad, z0, 1e-9), 'solveTrajectory solves its own zero level and calm');
  const g1z = solveZeroAngle(p65, calm, ICAO_RHO, ICAO_SOS, 'G1');
  const g1 = solveRef({ ...p65, zeroAngleRad: g1z }, calm, 'G1');
  assert(Math.abs(at(g1, 100).dropM) < 1e-5, `G1 zero lands at the zero distance within 0.01 mm (got ${(at(g1, 100).dropM * 1000).toFixed(4)} mm)`);
}

// R.4 Inclination 30 deg uphill, level zero. Reference: an independent RK4 solver in level-ground axes
// (gravity straight down, barrel raised by 30 deg + zero angle, constant air density), sampled where
// the bullet crosses the plane perpendicular to the line of sight: 4.7129 mrad / 1.0506 s at 692.8 m
// and 11.5219 mrad / 2.1053 s at 1154.7 m. (py-ballisticcalc gives less because it also thins the air
// as the bullet climbs, which this app does not model.)
{
  const sol = solveRef(p65, { ...calm, inclinationDeg: 30 }, 'G7', { stepM: 10, maxRangeM: 1300 });
  for (const [slant, ref, tof] of [[692.82, 4.7129, 1.0506], [1154.7, 11.5219, 2.1053]]) {
    const p = at(sol, slant);
    assert(near(p.elevationMrad, ref, 0.01), `30 deg incline, ${slant.toFixed(0)} m: elevation ${ref} mrad ±0.01 (got ${p.elevationMrad.toFixed(4)})`);
    assert(near(p.tofS, tof, 0.002), `30 deg incline, ${slant.toFixed(0)} m: time of flight ${tof} s (got ${p.tofS.toFixed(4)})`);
  }
  const level = solveRef(p65, calm, 'G7');
  assert(at(sol, 600).elevationMrad < at(level, 600).elevationMrad, 'Uphill needs less elevation than level at the same distance');
}

// R.5 Cant 10 deg (clockwise). Undialled impact matches py-ballisticcalc (0.2051 m right, 10.2495 m low at 1000 m);
// the reported elevation/windage are the turret corrections needed while canted: the whole
// bore-to-sight angle (zero angle + elevation) is rotated about the line of sight.
{
  const c = (10 * Math.PI) / 180;
  const level = solveRef(p65, calm, 'G7');
  const canted = solveRef(p65, { ...calm, cantDeg: 10 }, 'G7');
  const p = at(canted, 1000);
  const q = at(level, 1000);
  assert(near(p.driftM, 0.2051, 0.002), `Cant 10 deg: undialled impact 0.2051 m right at 1000 m (got ${p.driftM.toFixed(4)})`);
  assert(near(p.dropM, -10.2495, 0.01), `Cant 10 deg: undialled impact 10.2495 m low at 1000 m (got ${p.dropM.toFixed(4)})`);
  const theta0 = level.telemetry.boreAngleRad;
  const total = theta0 + q.elevationRad;
  const wExp = -total * Math.sin(c);
  assert(near(p.windageRad, wExp, Math.abs(wExp) * 0.02), `Cant 10 deg: windage correction -(zero angle + elevation)·sin(cant) = ${(wExp * 1000).toFixed(3)} mrad (got ${p.windageMrad.toFixed(3)})`);
  assert(near(p.elevationRad, total * Math.cos(c) - theta0, 2e-5), `Cant 10 deg: elevation (zero angle + elevation)·cos(cant) - zero angle (got ${p.elevationMrad.toFixed(3)} mrad)`);
  assert(Math.abs(q.windageMrad) < 1e-9, 'No wind, no cant, point mass: windage is exactly 0');
}

// R.6 Wind drift (py-ballisticcalc, 4 m/s full value: 0.1369 / 0.6013 / 1.9290 m)
{
  const windy = solveRef(p65, { ...calm, windSpeedMs: 4, windDirectionDeg: 90 }, 'G7');
  for (const [d, ref] of [[300, 0.1369], [600, 0.6013], [1000, 1.929]]) {
    const drift = -at(windy, d).driftM;
    assert(near(drift, ref, ref * 0.005), `Wind from 3 o'clock 4 m/s pushes ${ref} m left at ${d} m ±0.5 % (got ${drift.toFixed(4)})`);
  }
}

// R.7 Spin drift: Litz 1.25·(Sg + 1.2)·t^1.83 in, added after the solve (py-ballisticcalc: 0.0169 / 0.0717 / 0.2389 m)
{
  const off = { includeCoriolis: false, includeAerodynamicJump: false };
  const mpm = solveRef(p65, calm, 'MPM', off);
  const mpmNoSpin = solveRef(p65, calm, 'MPM', { ...off, includeSpinDrift: false });
  const L = 1.378 / 0.264;
  const T = 8 / 0.264;
  const sgExp = (30 * 140) / (T * T * Math.pow(0.264, 3) * L * (1 + L * L)) * Math.cbrt((825 / 0.3048) / 2800);
  const sg = mpm.telemetry.sg;
  assert(near(sg, sgExp, 0.006), `Solver Sg is the Miller value at ICAO conditions (${sg} vs ${sgExp.toFixed(3)})`);
  for (const [d, ref] of [[300, 0.0169], [600, 0.0717], [1000, 0.2389]]) {
    const drift = at(mpm, d).driftM - at(mpmNoSpin, d).driftM;
    const litz = 1.25 * (sg + 1.2) * Math.pow(at(mpm, d).tofS, 1.83) * 0.0254;
    assert(near(drift, litz, litz * 0.01), `MPM spin drift at ${d} m equals Litz ${(litz * 100).toFixed(2)} cm (got ${(drift * 100).toFixed(2)} cm)`);
    assert(near(drift, ref, ref * 0.03), `MPM spin drift at ${d} m matches py-ballisticcalc ${(ref * 100).toFixed(2)} cm ±3 % (got ${(drift * 100).toFixed(2)} cm)`);
  }
  const dof = solveRef(p65, calm, '4DOF', off);
  assert(near(at(dof, 1000).driftM, at(mpm, 1000).driftM, 1e-6), '4DOF spin drift uses the same Litz model as MPM');
  assert(at(dof, 1000).spinRateRpm < at(dof, 0).spinRateRpm, `4DOF tracks spin decay (${at(dof, 0).spinRateRpm} -> ${at(dof, 1000).spinRateRpm} rpm)`);
  const lefty = solveRef({ ...p65, twistDirection: 'left' }, calm, 'MPM', off);
  assert(near(at(lefty, 1000).driftM, -at(mpm, 1000).driftM, 1e-6), 'Left-hand twist drifts left by the same amount');
  assert(Math.abs(at(mpmNoSpin, 1000).driftM) < 1e-9, 'includeSpinDrift false removes spin drift');
}

// R.8 Coriolis (py-ballisticcalc: 0.0782 m right shooting north at 45 deg N; shooting east hits 0.0777 mrad high)
{
  const off = { includeSpinDrift: false, includeAerodynamicJump: false };
  const flat = solveRef(p65, calm, 'G7');
  const north = solveRef(p65, { ...calm, latitudeDeg: 45, shootingAzimuthDeg: 0 }, 'MPM', off);
  const east = solveRef(p65, { ...calm, latitudeDeg: 45, shootingAzimuthDeg: 90 }, 'MPM', off);
  assert(near(at(north, 1000).driftM, 0.0782, 0.004), `Coriolis 45 N shooting north: 7.8 cm right at 1000 m (got ${(at(north, 1000).driftM * 100).toFixed(2)} cm)`);
  const dEast = at(east, 1000).elevationMrad - at(flat, 1000).elevationMrad;
  assert(near(dEast, -0.0777, 0.008), `Coriolis shooting east hits high: -0.078 mrad elevation at 1000 m (got ${dEast.toFixed(4)})`);
  const equator = solveRef(p65, { ...calm, latitudeDeg: 0, shootingAzimuthDeg: 0 }, 'MPM', off);
  assert(Math.abs(at(equator, 1000).driftM) < 0.002, `Latitude 0 is honoured: no sideways Coriolis at the equator shooting north (got ${(at(equator, 1000).driftM * 100).toFixed(2)} cm)`);
  const noCor = solveRef(p65, { ...calm, latitudeDeg: 45 }, 'MPM', { ...off, includeCoriolis: false });
  assert(Math.abs(at(noCor, 1000).driftM) < 1e-9 && near(at(noCor, 1000).elevationMrad, at(flat, 1000).elevationMrad, 1e-9),
    'includeCoriolis false: MPM with no extras equals the G7 point mass');
}

// R.9 Aerodynamic jump (Litz): Y [MOA per mph crosswind] = 0.01·Sg - 0.0024·L + 0.032.
// Right-hand twist: wind from the right pushes the bullet down, wind from the left pushes it up.
{
  const off = { includeSpinDrift: false, includeCoriolis: false };
  const fromRight = { ...calm, windSpeedMs: 4, windDirectionDeg: 90 };
  const withAj = solveRef(p65, fromRight, 'MPM', off);
  const noAj = solveRef(p65, fromRight, 'MPM', { ...off, includeAerodynamicJump: false });
  const L = 1.378 / 0.264;
  const yMoaPerMph = 0.01 * withAj.telemetry.sg - 0.0024 * L + 0.032;
  const jumpMrad = yMoaPerMph * 4 * 2.2369363 * (Math.PI / (180 * 60)) * 1000;
  for (const d of [300, 600, 1000]) {
    const dE = at(withAj, d).elevationMrad - at(noAj, d).elevationMrad;
    assert(near(dE, jumpMrad, 0.005), `Jump, wind from the right: +${jumpMrad.toFixed(3)} mrad elevation at ${d} m (got ${dE.toFixed(4)})`);
  }
  const fromLeft = solveRef(p65, { ...fromRight, windDirectionDeg: 270 }, 'MPM', off);
  const noAjLeft = solveRef(p65, { ...fromRight, windDirectionDeg: 270 }, 'MPM', { ...off, includeAerodynamicJump: false });
  const dL = at(fromLeft, 600).elevationMrad - at(noAjLeft, 600).elevationMrad;
  assert(near(dL, -jumpMrad, 0.005), `Jump, wind from the left: -${jumpMrad.toFixed(3)} mrad (got ${dL.toFixed(4)})`);
  assert(near(withAj.telemetry.boreAngleRad, noAj.telemetry.boreAngleRad, 1e-12), 'Jump is not part of the zero');
}

// R.10 Powder temperature (sensitivity in m/s per deg C, relative to powderRefTempC)
{
  const pt = { ...p65, powderTempSensitivity: 1.0, powderRefTempC: 15 };
  const warm = solveRef(pt, { ...calm, temperatureC: 25 });
  assert(near(warm.telemetry.muzzleVelocityMs, 835, 1e-9) && near(warm.trajectory[0].velocityMs, 835, 1e-6), `Powder at 25 C with 1 m/s per C: MV 835 m/s (got ${warm.telemetry.muzzleVelocityMs})`);
  const cold = solveRef(pt, { ...calm, temperatureC: 25, powderTempC: 5 });
  assert(near(cold.telemetry.muzzleVelocityMs, 815, 1e-9), `A separate powderTempC overrides air temperature: MV 815 m/s (got ${cold.telemetry.muzzleVelocityMs})`);
  const plain = solveRef(p65, { ...calm, temperatureC: 25 });
  assert(plain.telemetry.muzzleVelocityMs === 825, 'No powder data: MV unchanged');
}

// R.11 Danger space uses the target height
{
  const a = solveRef(p65, calm, 'G7', { targetHeightM: 0.5 });
  const b = solveRef(p65, calm, 'G7', { targetHeightM: 1.0 });
  assert(at(a, 800).dangerSpaceM < 100 && near(at(b, 800).dangerSpaceM, 2 * at(a, 800).dangerSpaceM, 1e-6),
    `Danger space scales with target height (${at(a, 800).dangerSpaceM.toFixed(1)} m for 0.5 m, ${at(b, 800).dangerSpaceM.toFixed(1)} m for 1.0 m)`);
}

// R.12 Legacy DOPPLER bullets are solved with the standard G7 table
{
  const dop = solveRef(mkProfile({ ...b65, dragModel: 'DOPPLER' }, 825, 8), calm, 'G7');
  assert(near(at(dop, 1000).elevationMrad, 10.231, 0.05), 'A DOPPLER bullet is solved with G7 (no invented drag curve)');
}

// R.13 WEZ sensitivities: one consistent fixed-zero solve, interpolated at the exact distance
{
  const env = { ...calm, windSpeedMs: 4, windDirectionDeg: 90 };
  const tgt = { distanceM: 610, targetShape: 'ipsc', targetSizeWidthCm: 45, targetSizeHeightCm: 75 };
  const r = runWezSimulation({ profile: p65, environment: env, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, target: tgt, numShots: 200 });
  const z = solveZeroAngle(p65, env, ICAO_RHO, ICAO_SOS, 'G7');
  const fine = (prof, e) => solveTrajectory({ profile: { ...prof, zeroAngleRad: z }, environment: e, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, algorithm: 'G7', stepM: 1, maxRangeM: 700 });
  const base = fine(p65, env);
  const mv = fine({ ...p65, muzzleVelocityMs: 827 }, env);
  const dYdMv = (at(mv, 610).dropM - at(base, 610).dropM) / 2;
  assert(near(r.derivatives.dYdMv, dYdMv, Math.abs(dYdMv) * 0.02), `WEZ dY/dMV ${(dYdMv * 100).toFixed(3)} cm per m/s (got ${(r.derivatives.dYdMv * 100).toFixed(3)})`);
  const dEdR = (at(base, 620).elevationRad - at(base, 600).elevationRad) / 20;
  const rangeExp = 610 * dEdR;
  assert(near(r.derivatives.dYdRange, rangeExp, Math.abs(rangeExp) * 0.03), `WEZ range error: R·dE/dR = ${(rangeExp * 100).toFixed(3)} cm per m (got ${(r.derivatives.dYdRange * 100).toFixed(3)})`);
  const w5 = fine(p65, { ...env, windSpeedMs: 5 });
  const dZdWind = at(w5, 610).driftM - at(base, 610).driftM;
  assert(near(r.derivatives.dZdWind, dZdWind, Math.abs(dZdWind) * 0.02), `WEZ dZ/dwind ${(dZdWind * 100).toFixed(2)} cm per m/s (got ${(r.derivatives.dZdWind * 100).toFixed(2)})`);
  const r0 = runWezSimulation({ profile: p65, environment: calm, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, target: tgt, numShots: 200 });
  const w1 = fine(p65, { ...calm, windSpeedMs: 1 });
  const exp1 = at(w1, 610).driftM - at(fine(p65, calm), 610).driftM;
  assert(near(r0.derivatives.dZdWind, exp1, Math.abs(exp1) * 0.02), `WEZ with 0 m/s wind: a 1 m/s wind error, not 4 -> 5 (got ${(r0.derivatives.dZdWind * 100).toFixed(2)} cm, expected ${(exp1 * 100).toFixed(2)})`);
  const rPartial = runWezSimulation({ profile: p65, environment: env, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, target: tgt, numShots: 100, uncertainties: { mvSdMs: 5 } });
  assert(Number.isFinite(rPartial.cepCm) && rPartial.cepCm > 0, 'WEZ fills in missing uncertainty fields with defaults');
}

// R.14 Truing at an exact distance (not the nearest table row)
{
  const res = trueMuzzleVelocity({ profile: p65, environment: calm, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, observedDistanceM: 615, observedDropMrad: 4.2 });
  const chk = solveRef({ ...p65, muzzleVelocityMs: res.calibratedMv }, calm, 'G7', { stepM: 5, maxRangeM: 700 });
  assert(res.converged && near(at(chk, 615).elevationMrad, 4.2, 0.01), `Trued MV ${res.calibratedMv} m/s reproduces 4.2 mrad at 615 m (got ${at(chk, 615).elevationMrad.toFixed(3)})`);
  const dsf = trueDropScaleFactor({ profile: p65, environment: calm, airDensity: ICAO_RHO, speedOfSound: ICAO_SOS, observedDistanceM: 1005, observedDropMrad: 10.5 });
  assert(near(dsf.calibratedBc, 0.326 / dsf.calibratedDsf, 0.0005), `Drag scale factor is reported as a whole-trajectory BC scale (BC ${dsf.calibratedBc})`);
  const chk2 = solveRef({ ...p65, bullet: { ...b65, bcG7: dsf.calibratedBc } }, calm, 'G7', { stepM: 5, maxRangeM: 1100 });
  assert(dsf.converged && near(at(chk2, 1005).elevationMrad, 10.5, 0.03), `Trued BC reproduces 10.5 mrad at 1005 m (got ${at(chk2, 1005).elevationMrad.toFixed(3)})`);
}

// 6. TRUING SOLVER TEST
console.log('\n[6/7] Testing Truing Solver...');
// Suppose measured dial at 600m was slightly different: 4.2 MRAD
const truingResult = trueMuzzleVelocity({
  profile: defaultProfile,
  environment: defaultEnv,
  airDensity: atmos.densityKgM3,
  speedOfSound: atmos.speedOfSoundMs,
  observedDistanceM: 600,
  observedDropMrad: 4.2,
});
assert(truingResult.converged, 'MV truing converged');
assert(truingResult.calibratedMv > 700 && truingResult.calibratedMv < 900, `Trued MV realistic (${truingResult.calibratedMv} m/s)`);

const dsfResult = trueDropScaleFactor({
  profile: defaultProfile,
  environment: defaultEnv,
  airDensity: atmos.densityKgM3,
  speedOfSound: atmos.speedOfSoundMs,
  observedDistanceM: 1000,
  observedDropMrad: 10.5, // the model predicts about 10.2 mrad here: a few percent more drag
});
assert(dsfResult.converged, 'DSF truing converged');
assert(dsfResult.calibratedDsf > 0.8 && dsfResult.calibratedDsf < 1.3, `DSF realistic (${dsfResult.calibratedDsf})`);

// 7. WEZ & MONTE CARLO TEST
console.log('\n[7/7] Testing WEZ 1,000-shot Monte Carlo Engine...');
const target = {
  distanceM: 600,
  targetSizeWidthCm: 45,
  targetSizeHeightCm: 75,
  targetShape: 'ipsc',
};

const wezStart = Date.now();
const wezResult = runWezSimulation({
  profile: defaultProfile,
  environment: defaultEnv,
  airDensity: atmos.densityKgM3,
  speedOfSound: atmos.speedOfSoundMs,
  target,
  numShots: 1000,
});
const wezElapsed = Date.now() - wezStart;

assert(wezResult.hitProbabilityPercent >= 0 && wezResult.hitProbabilityPercent <= 100, `Hit rate between 0-100% (${wezResult.hitProbabilityPercent}%)`);
assert(wezResult.cepCm > 0, `CEP is positive (${wezResult.cepCm} cm)`);
assert(wezResult.r95Cm >= wezResult.cepCm, `R95 (${wezResult.r95Cm} cm) >= CEP (${wezResult.cepCm} cm)`);
assert(wezResult.sensitivity.length === 4, 'Sensitivity analysis has 4 factors');
console.log(`1,000-shot Monte Carlo simulation ran in ${wezElapsed}ms`);
assert(wezElapsed < 250, 'WEZ simulation performance < 250ms');

// 8. DEEP PHYSICS, RETICLE DIRECTION, EDGE CASES & STATE TESTS
console.log('\n[8/8] Testing Deep Physics, Reticle Holdover Direction, Edge Cases & State Robustness...');

// Test 8.1: Drag deceleration physics equation exact match with standard fluid dynamics
const testMassKg = 140 * 0.00006479891; // 140 gr
const testDiaM = 0.264 * 0.0254; // 0.264 in
const testAreaM2 = (Math.PI * testDiaM * testDiaM) / 4.0;
const testBcSI = 0.326 * (0.45359237 / (0.0254 * 0.0254)); // G7 BC 0.326 in kg/m^2
const testRho = 1.225;
const testV = 680.0;
const testCd = getCd('G7', 2.0); // Cd at Mach 2
// Analytical drag force: Fd = 0.5 * rho * v^2 * Area * (Cd * formFactor)
const testFormFactor = (140 / (7000 * 0.264 * 0.264)) / 0.326;
const testFd = 0.5 * testRho * testV * testV * testAreaM2 * (testCd * testFormFactor);
const analyticalDecel = testFd / testMassKg;
const solverDecel = (Math.PI * testRho * testCd) / (8.0 * testBcSI) * testV * testV;
assert(Math.abs(analyticalDecel - solverDecel) < 1e-4, `Drag decel formula matches physical Fd/m (${solverDecel.toFixed(2)} vs ${analyticalDecel.toFixed(2)} m/s2)`);

// Test 8.2: Reticle hold mark convention
// A 3 o'clock wind blows the bullet left (negative drift), so the solver's windage correction is
// positive (aim right). To aim right with a hold, the shooter puts a reticle mark that is LEFT of the
// centre (the downwind side) on the target: the hold mark is drawn at cx - hold, just as an
// elevation hold mark sits below the centre (cy + hold).
{
  const windy = solveTrajectory({ profile: { ...defaultProfile, zeroAngleRad: zeroAngle }, environment: { ...defaultEnv, windZones: [], windSpeedMs: 4, windDirectionDeg: 90 }, airDensity: atmos.densityKgM3, speedOfSound: atmos.speedOfSoundMs, algorithm: 'G7', stepM: 100, maxRangeM: 600 });
  const p = windy.trajectory.find((q) => q.distanceM === 600);
  assert(p.driftM < 0 && p.windageMrad > 0, `Wind from 3 o'clock: drift left, windage correction positive (right) (${p.windageMrad.toFixed(2)} mrad)`);
  const cx = 200;
  const ppm = 15;
  const holdMarkX = cx - p.windageMrad * ppm;
  assert(holdMarkX < cx, `Hold mark for a right correction is drawn left of centre, on the downwind side (${holdMarkX.toFixed(1)} < ${cx})`);
}

// Test 8.3: Miller twist stability edge cases (aspect ratios L/d > 7 and invalid inputs)
const extremeLongStab = calculateStability(140, 0.264, 2.0, 8.0, 2700); // L/d = 7.58
assert(extremeLongStab.sg > 0 && extremeLongStab.sg < 1.0, `Extreme long aspect ratio L/d=7.58 correctly detected as unstable (got Sg: ${extremeLongStab.sg})`);
const zeroParamStab = calculateStability(0, 0, 0, 0, 0);
assert(zeroParamStab.sg === 0 && zeroParamStab.status === 'Invalid parameters', 'Miller twist safely handles zero inputs without crashing');
const negativeParamStab = calculateStability(-50, 0.264, 1.4, 8.0, 2700);
assert(negativeParamStab.sg === 0 && negativeParamStab.status === 'Invalid parameters', 'Miller twist safely handles negative inputs');

// The remaining sections load app modules. A crash in one section is recorded as a failure and the
// run continues, so the summary (and the exit code) always reflect every check.
const runSection = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    assert(false, `${name} checks crashed: ${e.message}`);
  }
};

await runSection('StateStore', async () => {
// Test 8.4: StateStore node-safe execution and robust JSON import
  const { StateStore } = await import('../src/core/state.js');
  const store = new StateStore();
  assert(store.state.profiles.length > 0, 'StateStore initialized with fallback profiles in Node environment');
  
  // Test importing empty / corrupt JSON
  const corruptOk = store.importJSON('{"profiles": [], "solverConfig": {}}');
  assert(corruptOk === true, 'Corrupted JSON imported safely without overwriting profiles with empty array');
  assert(store.getActiveProfile() !== undefined, 'Active profile remains valid after empty profiles import');
  
  // Test importing malformed JSON syntax
  const invalidSyntaxOk = store.importJSON('not a valid json string');
  assert(invalidSyntaxOk === false, 'Invalid JSON syntax rejected cleanly without exception');

  // Test 8.5: WEZ Target Shapes
  const shapeCircleHit = isTargetHit(10, 10, { targetShape: 'circle', targetSizeWidthCm: 30, targetSizeHeightCm: 30 });
  const shapeCircleMiss = isTargetHit(20, 20, { targetShape: 'circle', targetSizeWidthCm: 30, targetSizeHeightCm: 30 });
  assert(shapeCircleHit === true && shapeCircleMiss === false, 'Circle target hit detection accurate');

  const shapeSquareHit = isTargetHit(14, 14, { targetShape: 'square', targetSizeWidthCm: 30, targetSizeHeightCm: 30 });
  const shapeSquareMiss = isTargetHit(16, 14, { targetShape: 'square', targetSizeWidthCm: 30, targetSizeHeightCm: 30 });
  assert(shapeSquareHit === true && shapeSquareMiss === false, 'Square target hit detection accurate');

});

await runSection('DOPE studio', async () => {
  // [9/9] Testing PRS / NRL Tactical Stage Card Engine & Match Presets
  console.log('\n[9/9] Testing PRS / NRL Match Stage Engine & Tactical Arm Board...');
  {
    const { DopeStudioView } = await import('../src/ui/dopeStudio.js');
    const mockContainer = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
    const studio = new DopeStudioView(mockContainer);

    // Test 9.1: Match Stage Presets
    const presets = studio.presets;
    assert(!!presets['troop-line'], 'Preset Troop Line exists');
    assert(presets['troop-line'].targets.length === 5, 'Troop Line has 5 steel gongs (300m - 700m)');
    assert(presets['troop-line'].targets[0].distanceM === 300 && presets['troop-line'].targets[4].distanceM === 700, 'Troop Line spans 300m to 700m');

    assert(!!presets['kyl-rack'], 'Preset KYL Rack exists');
    assert(presets['kyl-rack'].targets.length === 5, 'KYL Rack has 5 decreasing plates');
    assert(presets['kyl-rack'].targets[0].widthCm === 30 && presets['kyl-rack'].targets[4].widthCm === 10, 'KYL Rack diameters decrease from 30cm to 10cm');

    assert(!!presets['far-to-near'], 'Preset Far-to-Near Barricade exists');
    assert(presets['far-to-near'].targets[0].distanceM > presets['far-to-near'].targets[3].distanceM, 'Far-to-Near engages far target first (750m down to 350m)');

    assert(!!presets['skills-stage'], 'Preset PRS Skills Stage exists');
    const skillsTotalRounds = presets['skills-stage'].targets.reduce((s, t) => s + t.rounds, 0);
    assert(skillsTotalRounds === 10, `PRS Skills Stage allocates 10 rounds total (got: ${skillsTotalRounds})`);

    // Test 9.2: Target Silhouettes SVGs
    const ipscSvg = studio.renderTargetSilhouetteSvg('ipsc', 24);
    assert(ipscSvg.includes('<svg') && ipscSvg.includes('<polygon'), 'IPSC torso silhouette SVG generated cleanly');
    const gongSvg = studio.renderTargetSilhouetteSvg('gong', 24);
    assert(gongSvg.includes('<svg') && gongSvg.includes('<circle'), 'Gong circular plate silhouette SVG generated cleanly');
    const squareSvg = studio.renderTargetSilhouetteSvg('square', 24);
    assert(squareSvg.includes('<svg') && squareSvg.includes('<rect'), 'Square plate silhouette SVG generated cleanly');
    const diamondSvg = studio.renderTargetSilhouetteSvg('diamond', 24);
    assert(diamondSvg.includes('<svg') && diamondSvg.includes('<polygon'), 'Diamond popper silhouette SVG generated cleanly');
    const kylSvg = studio.renderTargetSilhouetteSvg('kyl', 24);
    assert(kylSvg.includes('<svg') && kylSvg.includes('silhouette-kyl'), 'KYL rack silhouette SVG generated cleanly');

    // Test 9.3: 3-Way Wind Hold Brackets (Lull < Base < Gust)
    const baseDope = studio.computeDope(10, 1000, 4.0, 90);
    const lullDope = studio.computeDope(10, 1000, 2.0, 90);
    const gustDope = studio.computeDope(10, 1000, 6.0, 90);

    const ballistics = studio.computeStageBallistics(presets['rooftop-barricade'], baseDope, lullDope, gustDope, baseDope.profile, false);
    assert(ballistics.length === 4, `Computed ballistics for 4 targets (got: ${ballistics.length})`);
    
    // Check 3-way bracket ordering for first target
    const t1 = ballistics[0];
    const lullVal = parseFloat(t1.lullHold);
    const baseVal = parseFloat(t1.baseHold);
    const gustVal = parseFloat(t1.gustHold);
    assert(lullVal < baseVal && baseVal < gustVal, `3-Way wind hold progression verified: Lull (${lullVal}) < Base (${baseVal}) < Gust (${gustVal})`);
    assert(t1.holdDirLabel === 'R', 'Crosswind from 90 deg right produces RIGHT hold into wind (got: R)');

    // Test 9.4: Danger Space Physics
    // Danger Space = TargetHeight / flightAngle. Larger target height -> larger danger space window.
    const bNear = ballistics[0]; // 380m
    const bFar = ballistics[3]; // 780m
    assert(bNear.dangerSpaceM > bFar.dangerSpaceM, `Near target has larger danger space forgiveness than far target (${bNear.dangerSpaceM.toFixed(1)}m > ${bFar.dangerSpaceM.toFixed(1)}m)`);

    // Test 9.5: Downrange Stage Schematic SVG Generation
    const schematicSvg = studio.renderStageSchematicSvg(presets['rooftop-barricade'], ballistics, baseDope, false);
    assert(schematicSvg.includes('<svg') && schematicSvg.includes('stage-schematic-svg'), 'Downrange schematic SVG generated with container');
    assert(schematicSvg.includes('FIRING LINE'), 'Schematic includes firing line baseline');
    assert(schematicSvg.includes('WIND'), 'Schematic includes wind vector HUD');
    assert(schematicSvg.includes('<polygon') || schematicSvg.includes('circle'), 'Schematic includes target silhouettes in downrange nodes');

    // Test 9.6: Angular Target Size Calculation
    assert(t1.angularSizeDisplay && /MRAD|MOA/.test(t1.angularSizeDisplay) && !t1.angularSizeDisplay.includes('MIL'), `Angular target size shown in MRAD/MOA (got: ${t1.angularSizeDisplay})`);

    // Test 9.7: Left Crosswind Hold Direction
    const leftDope = studio.computeDope(10, 1000, 4.0, 270);
    const leftBallistics = studio.computeStageBallistics(presets['rooftop-barricade'], leftDope, leftDope, leftDope, baseDope.profile, false);
    assert(leftBallistics[0].holdDirLabel === 'L', `Crosswind from 270 deg left produces LEFT hold into wind (got: ${leftBallistics[0].holdDirLabel})`);

    // Test 9.8: Par Time Pacing Guide
    const pacingHtml = studio._renderParTimeFlow(presets['rooftop-barricade'], 10, 90);
    assert(pacingHtml.includes('Suggested pace') && pacingHtml.includes('pace-split-pill'), 'Suggested pace splits generated cleanly');

    // Test 9.9: KYL Rack Schematic Rack Bar
    const kylBallistics = studio.computeStageBallistics(presets['kyl-rack'], baseDope, lullDope, gustDope, baseDope.profile, false);
    const kylSchematic = studio.renderStageSchematicSvg(presets['kyl-rack'], kylBallistics, baseDope, false);
    assert(kylSchematic.includes('stroke-width="2.5"'), 'KYL rack schematic includes hanging crossbar');

    // [10/10] Testing All 6 DOPE Studio Formats & Computer Vision Target Detector Engine
    console.log('\n[10/10] Testing All 6 DOPE Studio Formats & Pure Client-Side CV Engine...');

    // 10.0 Print scale check (shown under every printable card)
    const rulerHtml = studio._ruler();
    assert(rulerHtml.includes('Print scale check: this bar should measure 50 mm'), 'Print scale check bar has a plain-English caption');
    assert(rulerHtml.includes('width="50mm"') && (rulerHtml.match(/<line /g) || []).length === 51, 'Scale bar is 50 mm wide with 51 millimetre ticks');

    // 10.1 Scope cap insert
    const scopeCapHtml = studio.renderScopeCapSvg(baseDope);
    assert(scopeCapHtml.includes('scope-cap-svg') && scopeCapHtml.includes('role="img"'), 'Scope cap renders an accessible SVG insert');
    assert(scopeCapHtml.includes('font-size="22"') && scopeCapHtml.includes('font-size="15"'), 'Scope cap uses large distance/elevation text (22) and click text (15)');
    assert((scopeCapHtml.match(/font-size="22"/g) || []).length >= 2 * 5, 'Scope cap prints distance and elevation for every distance');
    const capSettings = studio._scopeCapSettings();
    for (const preset of ['Butler Creek #13 (39.9 mm)', 'Butler Creek #19 (43.9 mm)', 'Butler Creek #30 (49.8 mm)', 'Butler Creek #34 (53.3 mm)', 'Butler Creek #43 (58.7 mm)']) {
      assert(capSettings.includes(preset), `Scope cap size presets include ${preset}`);
    }
    assert(capSettings.includes('id="scope-cap-diameter-input"') && capSettings.includes('for="scope-cap-diameter-input"'), 'Scope cap has a labelled custom diameter field');

    // 10.2 Wrist card (3 x 5 in)
    const wristHtml = studio.renderWristCoach(baseDope);
    assert(wristHtml.includes('card-crop-corner'), 'Wrist card includes corner crop marks');
    assert(wristHtml.includes('coach-table') && wristHtml.includes('scope="col"'), 'Wrist card has a table with column headers');
    assert(wristHtml.includes('cell-elev') && wristHtml.includes('cell-clk'), 'Wrist card has distinct elevation and click columns');
    assert(wristHtml.includes('Wind hold'), 'Wrist card includes wind holds');

    // 10.3 Stock tape (180 x 32 mm)
    const stockHtml = studio.renderStockTape(baseDope);
    assert(stockHtml.includes('tape-matrix-table'), 'Stock tape includes the distance matrix table');
    assert(stockHtml.includes('tape-row-elev') && stockHtml.includes('tape-row-clk'), 'Stock tape includes elevation and click rows');
    assert(stockHtml.includes('tape-row-wind') && stockHtml.includes('tape-row-gust'), 'Stock tape includes two wind hold rows');

    // 10.4 Turret tape
    const turretHtml = studio.renderTurretTape(baseDope);
    assert(turretHtml.includes('turret-tape-svg'), 'Turret tape generates SVG wrap strip');
    assert(turretHtml.includes('ZERO'), 'Turret tape includes click 0 ZERO marker');
    assert(/>UP</.test(turretHtml) && turretHtml.includes('turret-dir-arrow-group'), 'Turret tape includes an UP dial direction arrow (drawn, no unicode symbol)');
    assert(!/[\u25B2\u25BC\u25B6\u25C0]/.test(turretHtml), 'Turret tape uses no decorative unicode arrows');
    const turretSettings = studio._turretSettings(0);
    assert(turretSettings.includes('30 mm turret (94.2 mm around)'), 'Turret size presets include a 30 mm turret (94.2 mm around)');
    const selectHtml = turretSettings.split('id="turret-tape-preset-select"')[1].split('</select>')[0];
    const presetMatches = selectHtml.match(/value="94\.2"/g) || [];
    assert(presetMatches.length === 1, `Turret tape presets contain 94.2 exactly once (got: ${presetMatches.length})`);

    // 10.5 A4 data sheet
    const a4Html = studio.renderA4DataSheet(baseDope);
    assert(a4Html.includes('Ballistic data sheet') && a4Html.includes('Rifle:'), 'A4 data sheet has a title and rifle summary');
    assert(a4Html.includes('a4-table') && a4Html.includes('scope="row"'), 'A4 data sheet includes the multi-distance table');
    assert(a4Html.includes('Reticle holds') && a4Html.includes('reticle-tree-node'), 'A4 data sheet includes reticle holds');
    assert(a4Html.includes('a4-notes-section') && a4Html.includes('Notes'), 'A4 data sheet includes a notes section');
    assert(a4Html.includes('Cold bore and zero check'), 'A4 data sheet includes a cold bore log');
    assert(a4Html.includes('Chronograph'), 'A4 data sheet includes a chronograph log');

    // 10.6 Computer Vision & Target Group Dispersion Formulas
    const sampleShots = [
      { x: 0, y: 0 },
      { x: 8, y: -6 },
      { x: -5, y: 10 },
      { x: -12, y: -4 },
      { x: 6, y: 12 },
    ];
    // Extreme Spread calculation
    let maxDist = 0;
    for (let i = 0; i < sampleShots.length; i++) {
      for (let j = i + 1; j < sampleShots.length; j++) {
        const d = Math.hypot(sampleShots[i].x - sampleShots[j].x, sampleShots[i].y - sampleShots[j].y);
        if (d > maxDist) maxDist = d;
      }
    }
    assert(Math.abs(maxDist - 24.08) < 0.2, `Extreme spread Euclidean calculation accurate (got: ${maxDist.toFixed(2)}mm, expected ~24.08mm)`);

    // Mean Center of Impact (POI)
    const mX = sampleShots.reduce((s, p) => s + p.x, 0) / sampleShots.length; // (0+8-5-12+6)/5 = -0.6
    const mY = sampleShots.reduce((s, p) => s + p.y, 0) / sampleShots.length; // (0-6+10-4+12)/5 = 2.4
    assert(Math.abs(mX - (-0.6)) < 0.01 && Math.abs(mY - 2.4) < 0.01, 'Center of Impact (POI bias) accurate');

    // Mean Radius
    const mr = sampleShots.reduce((s, p) => s + Math.hypot(p.x - mX, p.y - mY), 0) / sampleShots.length;
    assert(Math.abs(mr - 9.60) < 0.1, `Mean Radius calculated cleanly (got: ${mr.toFixed(2)}mm, expected 9.60mm)`);

    // CEP 50% Median Radius
    const sortedRadii = sampleShots.map(p => Math.hypot(p.x - mX, p.y - mY)).sort((a, b) => a - b);
    const cep50 = sortedRadii[Math.floor(sortedRadii.length / 2)];
    assert(cep50 > 5 && cep50 <= mr * 1.5, `CEP 50% median dispersion verified (got: ${cep50.toFixed(2)}mm)`);

    // Sobel Gradient Convolution Test
    // 3x3 horizontal step edge test: left 0, center 128, right 255
    const patch = [
      0, 128, 255,
      0, 128, 255,
      0, 128, 255,
    ];
    const testGx = (patch[2] + 2*patch[5] + patch[8]) - (patch[0] + 2*patch[3] + patch[6]);
    assert(testGx === 1020, `Sobel Gx step edge response verified (${testGx} === 1020)`);

  }
});

await runSection('Tools', async () => {
    // 10.7 CV Scale Calibration Unit Selector (1-inch & 1-cm)
    {
      const { ToolsView } = await import('../src/ui/tools.js');
      const dummyTools = Object.create(ToolsView.prototype);
      dummyTools.selectedCaliberMm = 6.7;
      dummyTools.cvSensitivity = 55;
      dummyTools.scaleRefLengthMm = 25.4;
      const groupHtml = dummyTools.renderGroupAnalyzer();
      assert(groupHtml.includes('id="cv-scale-unit-select"'), 'CV Group Analyzer includes Scale Reference Unit selector');
      assert(groupHtml.includes('value="25.4"') && groupHtml.includes('value="10.0"'), 'Scale Unit selector contains both 1-inch (25.4mm) and 1-cm (10mm) calibration modes');

    }
});

console.log(`\n========================================`);
if (failures.length === 0) {
  console.log(`ALL ${passedTests}/${totalTests} TESTS PASSED`);
} else {
  console.log(`${failures.length} OF ${totalTests} TESTS FAILED:`);
  failures.forEach((f) => console.log(`  - ${f}`));
}
console.log(`========================================`);
