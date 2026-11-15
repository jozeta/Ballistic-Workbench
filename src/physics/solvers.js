/**
 * Ballistic Workbench - RK4 trajectory and zero solvers
 *
 * Models (the `algorithm` parameter):
 * - 'G1' / 'G7': point mass with the standard G1 or G7 drag function and the bullet's matching BC.
 *   Gravity, drag, wind, inclination and cant. No spin drift, jump or Coriolis.
 * - 'MPM' (modified point mass): the point-mass path (drag table from the bullet's drag model) plus,
 *   each switchable with includeSpinDrift / includeCoriolis / includeAerodynamicJump:
 *     - Coriolis: the full -2 Ω × v acceleration (horizontal drift and the vertical Eötvös effect),
 *     - spin drift: Bryan Litz's empirical formula 1.25 · (Sg + 1.2) · t^1.83 inches, added to the
 *       lateral position after the solve (it is a kinematic offset, not a force),
 *     - aerodynamic jump: Litz's crosswind jump, Y [MOA per mph of crosswind] = 0.01·Sg − 0.0024·L + 0.032
 *       (L = bullet length in calibres), applied as a vertical launch-angle change.
 * - '4DOF': the MPM path plus an estimate of spin decay (reported as spinRateRpm). A true 4DOF
 *   model needs per-bullet aerodynamic coefficients (lift and overturning-moment slopes) that the
 *   library does not have, so spin drift deliberately uses the same Litz formula as MPM.
 *
 * Zero: the bore angle is solved level, with no wind, cant, Coriolis or jump, in the given atmosphere
 * and with the same drag model and integration step as the trajectory. The zero therefore does not
 * change when inclination, cant or wind change.
 *
 * Cant (environment.cantDeg, positive = rifle rotated clockwise as seen by the shooter): the whole
 * bore-to-sight geometry (sight height and bore angle) is rotated about the line of sight. The reported
 * elevation and windage are the turret corrections needed while the rifle is held at that cant, so the
 * dialled elevation is rotated too: correction = rotation(−cant) · (correction needed in level axes).
 *
 * Coordinates: x along the line of sight, y perpendicular to it (up), z to the right. All inputs and
 * internal values are SI: m, m/s, kg, Pa, K, rad, s.
 */

import { getCd, normalizeDragModel } from '../data/dragTables.js';
import { BC_LB_IN2_TO_KG_M2 } from '../core/units.js';
import { calculateStability } from '../data/projectiles.js';
import { adjustMuzzleVelocityForPowderTemp } from './atmosphere.js';

const EARTH_OMEGA = 7.292115e-5; // rad/s
const GRAVITY = 9.80665; // m/s^2
const DT = 0.001; // s, RK4 step for both the zero and the trajectory (converged to < 0.001 mrad at 1000 m)
const MAX_TIME_S = 20;
const MOA_RAD = Math.PI / (180 * 60);
const MS_TO_MPH = 1 / 0.44704;
const INCH_M = 0.0254;
// Dry air at 59 F / 29.92 inHg (15 C / 1013.25 hPa): the reference density of the Miller rule
const MILLER_STD_DENSITY = 1.225;
// Spin damping coefficient used for the 4DOF spin-decay estimate (typical rifle bullet value)
const SPIN_DAMPING = 0.018;

const finiteOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const positiveOr = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);
const degToRad = (d) => (d * Math.PI) / 180;
const isExtendedModel = (algorithm) => algorithm === 'MPM' || algorithm === '4DOF';

/**
 * Get effective wind vector at distance x
 * Returns { wx, wy, wz } in m/s
 * - wx: along line of fire (positive = tailwind, negative = headwind)
 * - wy: vertical updraft (positive = updraft)
 * - wz: lateral crosswind (positive = left-to-right blowing bullet right, negative = blowing bullet left)
 */
export function getWindAtDistance(x, environment) {
  // ?? not ||: a 0 m/s wind or a 0° (12 o'clock) direction are real values
  const defaultSpeed = environment.windSpeedMs ?? 0;
  const defaultDirDeg = environment.windDirectionDeg ?? 90; // 90 = 3 o'clock
  let speed = defaultSpeed;
  let dirDeg = defaultDirDeg;

  // Check multi-zone wind
  if (environment.windZones && environment.windZones.length > 0) {
    const zone = environment.windZones.find((z) => x >= z.startM && x < z.endM);
    if (zone) {
      speed = zone.speedMs;
      dirDeg = zone.directionDeg;
    } else if (x >= environment.windZones[environment.windZones.length - 1].endM) {
      const last = environment.windZones[environment.windZones.length - 1];
      speed = last.speedMs;
      dirDeg = last.directionDeg;
    }
  }

  // Convert clock/compass angle where:
  // 0 deg = 12 o'clock headwind (blowing bullet backward: wx < 0)
  // 90 deg = 3 o'clock wind from right (blowing bullet to the left: wz < 0)
  // 180 deg = 6 o'clock tailwind (blowing bullet forward: wx > 0)
  // 270 deg = 9 o'clock wind from left (blowing bullet to the right: wz > 0)
  const rad = (dirDeg * Math.PI) / 180.0;
  const wx = -speed * Math.cos(rad); // 0 deg -> -speed (headwind); 180 deg -> +speed (tailwind)
  const wy = 0.0; // standard flat vertical wind
  const wz = -speed * Math.sin(rad); // 90 deg -> -speed (left drift); 270 deg -> +speed (right drift)

  return { wx, wy, wz, speed, dirDeg };
}

/**
 * Muzzle velocity corrected for powder temperature.
 * profile.muzzleVelocityMs is the velocity at profile.powderRefTempC; profile.powderTempSensitivity is
 * in m/s per °C. The powder temperature is environment.powderTempC, or the air temperature when that
 * is not given. Without all three numbers the velocity is returned unchanged.
 */
export function effectiveMuzzleVelocity(profile, environment = {}) {
  const mv = profile.muzzleVelocityMs;
  const sensitivity = profile.powderTempSensitivity;
  const refC = profile.powderRefTempC;
  const powderC = environment?.powderTempC ?? environment?.temperatureC;
  if (![mv, sensitivity, refC, powderC].every(Number.isFinite)) return mv;
  const adjusted = adjustMuzzleVelocityForPowderTemp(mv, powderC + 273.15, refC + 273.15, sensitivity);
  return Math.max(1, adjusted);
}

/**
 * Drag table and BC a model uses. G1/G7 use that table; MPM/4DOF use the bullet's own drag model.
 * When the matching BC is missing it is estimated from the other one and flagged.
 */
function resolveDrag(bullet, algorithm) {
  const table = algorithm === 'G1' || algorithm === 'G7' ? algorithm : normalizeDragModel(bullet.dragModel);
  let bc = table === 'G1' ? bullet.bcG1 : bullet.bcG7;
  let bcEstimated = table === 'G7' && bullet.bcG7Estimated === true;
  if (!(bc > 0)) {
    bc = table === 'G1' ? bullet.bcG7 * 1.95 : bullet.bcG1 * 0.51;
    bcEstimated = true;
  }
  return { table, bc: Math.max(0.01, finiteOr(bc, 0.01)), bcEstimated };
}

/**
 * Gyroscopic stability (Miller) at the muzzle, corrected to the actual air density.
 * Miller's correction (T / 518.67 °R) · (29.92 / P inHg) equals ρ_std / ρ for dry air; using the
 * density directly also includes humidity.
 */
function muzzleStability(bullet, profile, mv, airDensity) {
  const pressureEquivalentInHg = 29.92 * (airDensity / MILLER_STD_DENSITY);
  const stab = calculateStability(bullet.weightGr, bullet.diameterIn, bullet.lengthIn, profile.twistRateIn, mv * 3.28084, 59, pressureEquivalentInHg);
  return stab.sg > 0 ? { sg: stab.sg, estimated: false } : { sg: 1.5, estimated: true };
}

/**
 * Equations of motion in the line-of-sight frame.
 * State vector: [x, y, z, vx, vy, vz, spinRadS]
 */
class TrajectorySolverCore {
  constructor({ profile, environment, airDensity, speedOfSound, algorithm, includeCoriolis, muzzleVelocityMs }) {
    this.profile = profile;
    this.bullet = profile.bullet;
    this.environment = environment;
    this.rho = airDensity;
    this.sos = speedOfSound;
    this.algorithm = algorithm;
    this.v0 = muzzleVelocityMs;

    this.massKg = this.bullet.weightGr * 0.00006479891;
    this.diameterM = this.bullet.diameterIn * INCH_M;
    this.areaM2 = (Math.PI * this.diameterM * this.diameterM) / 4.0;
    this.twistM = positiveOr(profile.twistRateIn, 10) * INCH_M;
    this.twistSign = (profile.twistDirection || 'right') === 'left' ? -1 : 1;

    this.drag = resolveDrag(this.bullet, algorithm);
    // a_drag = (π ρ Cd / (8 BC)) · v · v_vec, with BC in kg/m² (standard ballistic-coefficient form)
    this.dragK = (Math.PI * this.rho) / (8.0 * this.drag.bc * BC_LB_IN2_TO_KG_M2);

    this.incRad = degToRad(finiteOr(environment.inclinationDeg, 0));
    this.cantRad = degToRad(finiteOr(environment.cantDeg, 0));
    this.sinInc = Math.sin(this.incRad);
    this.cosInc = Math.cos(this.incRad);

    // Earth rotation in the level shooter frame (x horizontal downrange, y up, z right) ...
    this.useCoriolis = includeCoriolis === true;
    const latRad = degToRad(finiteOr(environment.latitudeDeg, 45));
    const azRad = degToRad(finiteOr(environment.shootingAzimuthDeg, 0));
    const wxLevel = EARTH_OMEGA * Math.cos(latRad) * Math.cos(azRad);
    const wyLevel = EARTH_OMEGA * Math.sin(latRad);
    // ... rotated into the line-of-sight frame (tilted up by the inclination)
    this.omegaX = wxLevel * this.cosInc + wyLevel * this.sinInc;
    this.omegaY = -wxLevel * this.sinInc + wyLevel * this.cosInc;
    this.omegaZ = -EARTH_OMEGA * Math.cos(latRad) * Math.sin(azRad);

    this.spin0 = ((2.0 * Math.PI * this.v0) / this.twistM) * this.twistSign;
    this.trackSpin = algorithm === '4DOF';
    // Spin decay estimate: dp/dt = -(ρ S d² / (2 Ix)) · C · v · p, with Ix ≈ ½ m r²
    const ix = 0.5 * this.massKg * Math.pow(this.diameterM / 2, 2);
    this.spinDecayK = ((this.rho * this.areaM2 * this.diameterM * this.diameterM) / (2.0 * ix)) * SPIN_DAMPING;
  }

  derivatives(state) {
    const [x, , , vx, vy, vz, spin] = state;

    // Wind is horizontal: rotate its downrange part into the line-of-sight frame
    const wind = getWindAtDistance(x, this.environment);
    const vrelX = vx - wind.wx * this.cosInc;
    const vrelY = vy + wind.wx * this.sinInc - wind.wy;
    const vrelZ = vz - wind.wz;
    const vrel = Math.sqrt(vrelX * vrelX + vrelY * vrelY + vrelZ * vrelZ);

    const cd = getCd(this.drag.table, vrel / this.sos);
    const k = this.dragK * cd * vrel;
    let ax = -k * vrelX - GRAVITY * this.sinInc;
    let ay = -k * vrelY - GRAVITY * this.cosInc;
    let az = -k * vrelZ;

    if (this.useCoriolis) {
      // a = -2 Ω × v
      ax += -2.0 * (this.omegaY * vz - this.omegaZ * vy);
      ay += -2.0 * (this.omegaZ * vx - this.omegaX * vz);
      az += -2.0 * (this.omegaX * vy - this.omegaY * vx);
    }

    const dSpin = this.trackSpin ? -this.spinDecayK * vrel * spin : 0;
    return [vx, vy, vz, ax, ay, az, dSpin];
  }

  rk4Step(state, dt) {
    const k1 = this.derivatives(state);
    const s2 = new Array(7);
    for (let i = 0; i < 7; i++) s2[i] = state[i] + 0.5 * dt * k1[i];
    const k2 = this.derivatives(s2);
    const s3 = new Array(7);
    for (let i = 0; i < 7; i++) s3[i] = state[i] + 0.5 * dt * k2[i];
    const k3 = this.derivatives(s3);
    const s4 = new Array(7);
    for (let i = 0; i < 7; i++) s4[i] = state[i] + dt * k3[i];
    const k4 = this.derivatives(s4);
    const next = new Array(7);
    for (let i = 0; i < 7; i++) next[i] = state[i] + (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    return next;
  }
}

/**
 * Integrate one shot and sample it at the given increasing distances along the line of sight.
 * launch: { boreAngle, cantRad, jumpRad, sightH, mv }. Returns { rows, maxOrdinateM, mach12RangeM, mach10RangeM }.
 * Each row holds the raw state (no spin drift) linearly interpolated at the exact distance.
 */
function fly(core, launch, distances) {
  const { boreAngle, cantRad, jumpRad, sightH, mv } = launch;
  // Bore direction: angle boreAngle above the rifle's "up" axis, which the cant rotates about the line of sight
  let vx = mv * Math.cos(boreAngle);
  let vy = mv * Math.sin(boreAngle) * Math.cos(cantRad);
  const vz = mv * Math.sin(boreAngle) * Math.sin(cantRad);
  if (jumpRad) {
    const c = Math.cos(jumpRad);
    const s = Math.sin(jumpRad);
    [vx, vy] = [vx * c - vy * s, vx * s + vy * c];
  }
  // The bore sits sightH below the sight along the rifle's (canted) up axis
  let state = [0, -sightH * Math.cos(cantRad), -sightH * Math.sin(cantRad), vx, vy, vz, core.spin0];
  let t = 0;
  const rows = [];
  let j = 0;
  let maxOrdinateM = state[1];
  let mach12RangeM = 0;
  let mach10RangeM = 0;

  const sample = (s, tt) => ({ x: s[0], y: s[1], z: s[2], vx: s[3], vy: s[4], vz: s[5], spin: s[6], t: tt });
  while (j < distances.length && distances[j] <= 0) {
    rows.push(sample(state, 0));
    j++;
  }

  while (j < distances.length && t < MAX_TIME_S) {
    const next = core.rk4Step(state, DT);
    const tNext = t + DT;
    while (j < distances.length && next[0] >= distances[j]) {
      const f = (distances[j] - state[0]) / (next[0] - state[0]);
      const s = state.map((v, i) => v + f * (next[i] - v));
      s[0] = distances[j];
      rows.push(sample(s, t + f * DT));
      j++;
    }
    state = next;
    t = tNext;
    if (state[1] > maxOrdinateM) maxOrdinateM = state[1];
    const speed = Math.sqrt(state[3] * state[3] + state[4] * state[4] + state[5] * state[5]);
    const mach = speed / core.sos;
    if (mach >= 1.2) mach12RangeM = state[0];
    if (mach >= 1.0) mach10RangeM = state[0];
    // Stop if the bullet has stalled or fallen absurdly far below the line of sight
    if (state[1] < -1000 || speed < 30 || !(state[3] > 0)) break;
  }
  return { rows, maxOrdinateM, mach12RangeM, mach10RangeM };
}

/**
 * Solve for the bore angle (radians above the line of sight) that zeroes the rifle at
 * profile.zeroDistanceM. Solved level, with no wind, cant, Coriolis or aerodynamic jump, in the given
 * atmosphere, with the drag model of `algorithm` (default: the bullet's drag model) and the powder
 * temperature corrected muzzle velocity.
 * @returns {number} Bore angle in radians
 */
export function solveZeroAngle(profile, environment, airDensity, speedOfSound, algorithm = null) {
  const env = environment || {};
  const alg = algorithm || normalizeDragModel(profile.bullet?.dragModel);
  const zeroEnv = { ...env, windSpeedMs: 0, windZones: [], inclinationDeg: 0, cantDeg: 0 };
  const mv = effectiveMuzzleVelocity(profile, env);
  const core = new TrajectorySolverCore({
    profile, environment: zeroEnv, airDensity, speedOfSound, algorithm: alg, includeCoriolis: false, muzzleVelocityMs: mv,
  });
  const rZero = positiveOr(profile.zeroDistanceM, 100);
  const sightH = finiteOr(profile.sightHeightM, 0.048);

  const yAtZero = (theta) => {
    const row = fly(core, { boreAngle: theta, cantRad: 0, jumpRad: 0, sightH, mv }, [rZero]).rows[0];
    return row ? row.y : NaN;
  };

  // Secant iteration: y(theta) is almost linear, so this converges in 2-3 steps
  let t0 = sightH / rZero;
  let y0 = yAtZero(t0);
  let t1 = t0 + 0.001;
  let y1 = yAtZero(t1);
  for (let iter = 0; iter < 20; iter++) {
    if (!Number.isFinite(y1) || !Number.isFinite(y0)) break;
    if (Math.abs(y1) < 1e-9 || y1 === y0) break;
    const t2 = t1 - (y1 * (t1 - t0)) / (y1 - y0);
    t0 = t1;
    y0 = y1;
    t1 = t2;
    y1 = yAtZero(t1);
  }
  return Number.isFinite(t1) ? t1 : sightH / rZero;
}

/**
 * Interpolate a trajectory table (rows with distanceM) at an exact distance.
 * Returns a row-shaped object (all numeric fields interpolated linearly), or null beyond the table.
 */
export function pointAtDistance(trajectory, distanceM) {
  if (!Array.isArray(trajectory) || trajectory.length === 0 || !Number.isFinite(distanceM)) return null;
  if (distanceM <= trajectory[0].distanceM) return { ...trajectory[0] };
  for (let i = 0; i < trajectory.length - 1; i++) {
    const a = trajectory[i];
    const b = trajectory[i + 1];
    if (distanceM >= a.distanceM && distanceM <= b.distanceM) {
      const f = b.distanceM === a.distanceM ? 0 : (distanceM - a.distanceM) / (b.distanceM - a.distanceM);
      const out = {};
      for (const key of Object.keys(a)) {
        out[key] = typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] + f * (b[key] - a[key]) : a[key];
      }
      out.distanceM = distanceM;
      return out;
    }
  }
  const last = trajectory[trajectory.length - 1];
  return Math.abs(distanceM - last.distanceM) < 1e-6 ? { ...last } : null;
}

/**
 * Generate the trajectory table from 0 to maxRangeM in stepM steps.
 * Optional: includeSpinDrift / includeCoriolis / includeAerodynamicJump (MPM and 4DOF only),
 * targetHeightM for the danger space column (default 0.5 m).
 */
export function solveTrajectory({
  profile,
  environment,
  airDensity,
  speedOfSound,
  algorithm = 'G7',
  stepM: rawStepM = 25,
  maxRangeM: rawMaxRangeM = 1200,
  includeSpinDrift = true,
  includeCoriolis = true,
  includeAerodynamicJump = true,
  targetHeightM = 0.5,
}) {
  // Guard the table loop: a zero, negative or tiny step (e.g. from bad saved data) would never
  // finish. At most 2,000 rows over at most 5 km.
  const maxRangeM = Number.isFinite(rawMaxRangeM) ? Math.min(5000, Math.max(50, rawMaxRangeM)) : 1200;
  const stepM = Number.isFinite(rawStepM) && rawStepM > 0 ? Math.max(rawStepM, maxRangeM / 2000) : 25;
  const env = environment || {};
  const heightM = positiveOr(targetHeightM, 0.5);
  const extended = isExtendedModel(algorithm);

  const mv = effectiveMuzzleVelocity(profile, env);
  let boreAngle = profile.zeroAngleRad;
  if (!Number.isFinite(boreAngle)) {
    boreAngle = solveZeroAngle(profile, env, airDensity, speedOfSound, algorithm);
  }

  const core = new TrajectorySolverCore({
    profile, environment: env, airDensity, speedOfSound, algorithm,
    includeCoriolis: includeCoriolis && extended, muzzleVelocityMs: mv,
  });
  const bullet = profile.bullet;
  const { sg, estimated: sgEstimated } = muzzleStability(bullet, profile, mv, airDensity);
  const lengthCal = bullet.lengthIn / bullet.diameterIn;

  // Aerodynamic jump (Litz). Right-hand twist: a wind from the left (wz > 0) throws the bullet up.
  let jumpRad = 0;
  if (includeAerodynamicJump && extended && Number.isFinite(lengthCal) && lengthCal > 0) {
    const crosswindMph = getWindAtDistance(0, env).wz * MS_TO_MPH;
    const moaPerMph = 0.01 * sg - 0.0024 * lengthCal + 0.032;
    jumpRad = moaPerMph * crosswindMph * MOA_RAD * core.twistSign;
  }
  const applySpinDrift = includeSpinDrift && extended;

  const distances = [];
  for (let d = 0; d <= maxRangeM + 1e-9; d += stepM) distances.push(Number(d.toFixed(6)));

  const sightH = finiteOr(profile.sightHeightM, 0.048);
  const flight = fly(core, { boreAngle, cantRad: core.cantRad, jumpRad, sightH, mv }, distances);
  const clickRad = positiveOr(profile.optic?.clickValueRad, 0.0001);
  const cosC = Math.cos(core.cantRad);
  const sinC = Math.sin(core.cantRad);
  const RAD_TO_MOA = (180.0 * 60.0) / Math.PI;

  const trajectory = flight.rows.map((r) => {
    let z = r.z;
    if (applySpinDrift && r.t > 0) {
      z += core.twistSign * 1.25 * (sg + 1.2) * Math.pow(r.t, 1.83) * INCH_M;
    }
    // Correction needed in level axes (up, right), then rotated into the canted turret axes
    let elRad = 0;
    let windRad = 0;
    if (r.x > 0) {
      const u = -r.y / r.x;
      const v = -z / r.x;
      elRad = u * cosC + v * sinC;
      windRad = -u * sinC + v * cosC;
    }
    const vMag = Math.sqrt(r.vx * r.vx + r.vy * r.vy + r.vz * r.vz);
    // Danger space: depth over which the bullet stays within the target height
    const flightPathAngle = Math.atan2(Math.abs(r.vy), r.vx);
    const dangerSpace = Math.min(250, flightPathAngle > 1e-4 ? heightM / Math.tan(flightPathAngle) : 250);
    return {
      distanceM: r.x,
      dropM: r.y,
      elevationRad: elRad,
      elevationMrad: elRad * 1000.0,
      elevationMoa: elRad * RAD_TO_MOA,
      elevationClicks: Math.round(elRad / clickRad),
      driftM: z,
      windageRad: windRad,
      windageMrad: windRad * 1000.0,
      windageMoa: windRad * RAD_TO_MOA,
      windageClicks: Math.round(windRad / clickRad),
      velocityMs: vMag,
      mach: vMag / speedOfSound,
      energyJ: 0.5 * core.massKg * vMag * vMag,
      tofS: r.t,
      spinRateRpm: Math.abs(Math.round((r.spin * 60) / (2 * Math.PI))),
      dangerSpaceM: r.x > 0 ? dangerSpace : 0,
    };
  });

  return {
    trajectory,
    telemetry: {
      zeroDistanceM: profile.zeroDistanceM,
      boreAngleRad: boreAngle,
      boreAngleMrad: boreAngle * 1000.0,
      boreAngleMoa: boreAngle * RAD_TO_MOA,
      maxOrdinateM: flight.maxOrdinateM,
      supersonicRangeM: Math.round(flight.mach12RangeM), // last distance at Mach 1.2 or faster
      transonicRangeM: Math.round(flight.mach10RangeM), // last distance at Mach 1.0 or faster
      muzzleVelocityMs: mv, // after the powder temperature correction
      baseMuzzleVelocityMs: profile.muzzleVelocityMs,
      airDensityKgM3: airDensity,
      speedOfSoundMs: speedOfSound,
      algorithm,
      dragModel: core.drag.table,
      bcUsed: core.drag.bc,
      bcEstimated: core.drag.bcEstimated,
      sg,
      sgEstimated,
      aerodynamicJumpMrad: jumpRad * 1000.0,
      spinDriftApplied: applySpinDrift,
      coriolisApplied: core.useCoriolis,
      cantDeg: (core.cantRad * 180) / Math.PI,
      targetHeightM: heightM,
    },
  };
}
