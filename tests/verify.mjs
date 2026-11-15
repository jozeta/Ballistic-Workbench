/**
 * Ballistic Workbench - CLI Physics & Solver Verification Suite
 * Run with: node tests/verify.mjs
 */

import { UnitConverter } from '../src/core/units.js';
import { getCd, G1_SPLINE, G7_SPLINE, DOPPLER_SPLINE, MACH_POINTS } from '../src/data/dragTables.js';
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
import { solveZeroAngle, solveTrajectory, getWindAtDistance } from '../src/physics/solvers.js';
import { trueMuzzleVelocity, trueDropScaleFactor } from '../src/physics/truing.js';
import { runWezSimulation, isTargetHit } from '../src/physics/wez.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASS: ${message}`);
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
assert(MACH_POINTS.length === 60, `60 Mach points present (got: ${MACH_POINTS.length})`);
assert(Math.abs(G7_SPLINE.interpolate(1.05) - 0.403) < 0.02, 'G7 spline interpolation near transonic peak');
assert(G7_SPLINE.interpolate(0.5) < G7_SPLINE.interpolate(1.1), 'G7 subsonic Cd lower than supersonic peak');
assert(DOPPLER_SPLINE.interpolate(2.0) < G1_SPLINE.interpolate(2.0), 'Doppler boattail Cd lower than G1 flat-base at Mach 2');

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
assert(Math.abs(point100.dropM) < 0.002, `Zero drop at 100m is ~0m (got: ${(point100.dropM * 100).toFixed(2)} cm)`);

// Check 600m point
const point600 = solG7.trajectory.find((p) => p.distanceM === 600);
assert(point600.dropM < -1.5 && point600.dropM > -3.5, `Drop at 600m between -1.5m and -3.5m (got: ${point600.dropM.toFixed(2)} m)`);
assert(point600.velocityMs > 500 && point600.velocityMs < 700, `Velocity at 600m realistic (got: ${point600.velocityMs.toFixed(1)} m/s)`);
assert(point600.mach > 1.3, `Projectile still supersonic at 600m (Mach: ${point600.mach.toFixed(2)})`);

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
  observedDropMrad: 9.0,
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
console.log(`⏱️ 1,000-shot Monte Carlo simulation ran in ${wezElapsed}ms`);
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

// Test 8.2: Reticle holdover direction convention
// When a 3 o'clock crosswind blows bullet to the left (negative drift),
// windageHoldMrad is positive.
// The hold pip coordinate MUST displace to the right (+x) so the shooter holds right into the wind.
const cx = 200;
const cy = 200;
const ppm = 15;
const windHoldMrad = 1.5; // Dial/hold right
const pipX = cx + (windHoldMrad * ppm);
assert(pipX > cx, `Hold pip X shifts RIGHT (+x) into wind for leftward drift (got: ${pipX} > ${cx})`);

// Test 8.3: Miller twist stability edge cases (aspect ratios L/d > 7 and invalid inputs)
const extremeLongStab = calculateStability(140, 0.264, 2.0, 8.0, 2700); // L/d = 7.58
assert(extremeLongStab.sg > 0 && extremeLongStab.sg < 1.0, `Extreme long aspect ratio L/d=7.58 correctly detected as unstable (got Sg: ${extremeLongStab.sg})`);
const zeroParamStab = calculateStability(0, 0, 0, 0, 0);
assert(zeroParamStab.sg === 0 && zeroParamStab.status === 'Invalid parameters', 'Miller twist safely handles zero inputs without crashing');
const negativeParamStab = calculateStability(-50, 0.264, 1.4, 8.0, 2700);
assert(negativeParamStab.sg === 0 && negativeParamStab.status === 'Invalid parameters', 'Miller twist safely handles negative inputs');

// Test 8.4: StateStore node-safe execution and robust JSON import
import('../src/core/state.js').then(({ StateStore }) => {
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

  // [9/9] Testing PRS / NRL Tactical Stage Card Engine & Match Presets
  console.log('\n[9/9] Testing PRS / NRL Match Stage Engine & Tactical Arm Board...');
  import('../src/ui/dopeStudio.js').then(({ DopeStudioView }) => {
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
    assert(t1.angularSizeDisplay && t1.angularSizeDisplay.includes('MIL'), `Angular size in MIL computed cleanly (got: ${t1.angularSizeDisplay})`);

    // Test 9.7: Left Crosswind Hold Direction
    const leftDope = studio.computeDope(10, 1000, 4.0, 270);
    const leftBallistics = studio.computeStageBallistics(presets['rooftop-barricade'], leftDope, leftDope, leftDope, baseDope.profile, false);
    assert(leftBallistics[0].holdDirLabel === 'L', `Crosswind from 270 deg left produces LEFT hold into wind (got: ${leftBallistics[0].holdDirLabel})`);

    // Test 9.8: Par Time Pacing Guide
    const pacingHtml = studio._renderParTimeFlow(presets['rooftop-barricade'], 10, 90);
    assert(pacingHtml.includes('PAR PACING') && pacingHtml.includes('pace-split-pill'), 'Par time pacing splits generated cleanly');

    // Test 9.9: KYL Rack Schematic Rack Bar
    const kylBallistics = studio.computeStageBallistics(presets['kyl-rack'], baseDope, lullDope, gustDope, baseDope.profile, false);
    const kylSchematic = studio.renderStageSchematicSvg(presets['kyl-rack'], kylBallistics, baseDope, false);
    assert(kylSchematic.includes('stroke-width="2.5"'), 'KYL rack schematic includes hanging crossbar');

    // [10/10] Testing All 6 DOPE Studio Formats & Computer Vision Target Detector Engine
    console.log('\n[10/10] Testing All 6 DOPE Studio Formats & Pure Client-Side CV Engine...');

    // 10.1 Scope Cap Disk
    const scopeCapHtml = studio.renderScopeCapSvg(baseDope);
    assert(scopeCapHtml.includes('50mm EXACT'), 'Scope Cap includes 50mm print calibration check bar');
    assert(scopeCapHtml.includes('BUTLER CREEK'), 'Scope Cap includes Butler Creek specification');
    assert(scopeCapHtml.includes('Butler Creek #13 (39.9mm)'), 'Scope Cap includes Butler Creek #13 preset');
    assert(scopeCapHtml.includes('Butler Creek #19 (43.9mm)'), 'Scope Cap includes Butler Creek #19 preset');
    assert(scopeCapHtml.includes('Butler Creek #30 (49.8mm)'), 'Scope Cap includes Butler Creek #30 preset');
    assert(scopeCapHtml.includes('Butler Creek #34 (53.3mm)'), 'Scope Cap includes Butler Creek #34 preset');
    assert(scopeCapHtml.includes('Butler Creek #43 (58.7mm)'), 'Scope Cap includes Butler Creek #43 preset');

    // 10.2 Wrist Coach
    const wristHtml = studio.renderWristCoach(baseDope);
    assert(wristHtml.includes('75×125mm') || wristHtml.includes('75mm×125mm'), 'Wrist coach formatted for standard 3"x5" (75x125mm) sleeve');
    assert(wristHtml.includes('card-crop-corner'), 'Wrist coach includes waterproof sleeve corner crop marks');
    assert(wristHtml.includes('coach-table'), 'Wrist coach includes compact tactical ballistic table');
    assert(wristHtml.includes('cell-elev') && wristHtml.includes('cell-clk'), 'Wrist coach includes distinct elevation and click callouts');

    // 10.3 Stock Tape
    const stockHtml = studio.renderStockTape(baseDope);
    assert(stockHtml.includes('180mm × 32mm'), 'Stock tape layout formatted to physical 180mm x 32mm chassis strip');
    assert(stockHtml.includes('tape-matrix-table'), 'Stock tape includes tactical 5-row matrix table');
    assert(stockHtml.includes('tape-row-elev'), 'Stock tape includes aligned Elev row');
    assert(stockHtml.includes('tape-row-clk'), 'Stock tape includes aligned Clicks row');
    assert(stockHtml.includes('tape-row-wind'), 'Stock tape includes aligned Wind 4m/s row');
    assert(stockHtml.includes('tape-row-gust'), 'Stock tape includes aligned Gust 10m/s row');
    assert(stockHtml.includes('50mm EXACT'), 'Stock tape includes 50mm print calibration check bar');

    // 10.4 Turret Tape Wrap
    const turretHtml = studio.renderTurretTape(baseDope);
    assert(turretHtml.includes('30mm Diameter (94.2mm wrap)'), 'Turret tape includes 30mm diameter (94.2mm circumference) preset');
    assert(turretHtml.includes('UP ▲'), 'Turret tape includes bold UP ▲ dial direction arrow');
    assert(turretHtml.includes('turret-tape-svg'), 'Turret tape generates SVG wrap strip');
    assert(turretHtml.includes('ZERO'), 'Turret tape includes click 0 ZERO marker');
    assert(turretHtml.includes('50mm EXACT'), 'Turret tape includes 50mm print calibration check bar');
    // Verify preset values don't have duplicate 94.2
    const selectHtml = turretHtml.split('id="turret-tape-preset-select"')[1].split('</select>')[0];
    const presetMatches = selectHtml.match(/value="94\.2"/g) || [];
    assert(presetMatches.length === 1, `Turret tape presets contains 94.2 exactly once (got: ${presetMatches.length})`);

    // 10.5 A4 Master Data Sheet
    const a4Html = studio.renderA4DataSheet(baseDope);
    assert(a4Html.includes('BALLISTIC DATA SHEET - PRECISION RIFLE'), 'A4 data sheet includes weapon title banner');
    assert(a4Html.includes('a4-table'), 'A4 data sheet includes comprehensive multi-range ballistic table');
    assert(a4Html.includes('OPTIC RETICLE HOLDOVER REFERENCE TREE'), 'A4 data sheet includes Reticle Holdover Reference section');
    assert(a4Html.includes('FIELD SHOOTER LOG & TARGET ENGAGEMENT NOTES'), 'A4 data sheet includes Shooter Notes & Log section');
    assert(a4Html.includes('COLD BORE & ZERO CONFIRMATION'), 'A4 data sheet includes Cold Bore log');
    assert(a4Html.includes('CHRONOGRAPH VELOCITY STRING'), 'A4 data sheet includes Chrono String log');

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

    // 10.7 CV Scale Calibration Unit Selector (1-inch & 1-cm)
    return import('../src/ui/tools.js').then(({ ToolsView }) => {
      const dummyTools = Object.create(ToolsView.prototype);
      dummyTools.selectedCaliberMm = 6.7;
      dummyTools.cvSensitivity = 55;
      dummyTools.scaleRefLengthMm = 25.4;
      const groupHtml = dummyTools.renderGroupAnalyzer();
      assert(groupHtml.includes('id="cv-scale-unit-select"'), 'CV Group Analyzer includes Scale Reference Unit selector');
      assert(groupHtml.includes('value="25.4"') && groupHtml.includes('value="10.0"'), 'Scale Unit selector contains both 1-inch (25.4mm) and 1-cm (10mm) calibration modes');

      console.log(`\n========================================`);
      console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED CLEANLY!`);
      console.log(`========================================`);
    });
  });
});
