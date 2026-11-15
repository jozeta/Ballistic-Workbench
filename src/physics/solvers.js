/**
 * Ballistic Workbench - High-Precision RK4 Trajectory & Zero Solvers
 * Implements:
 * 1. RK4 Zero Solver (Newton-Raphson convergence for exact bore elevation angle)
 * 2. G1 Point-Mass Solver (Gavre standard drag)
 * 3. G7 Point-Mass Solver (Modern boat-tail drag)
 * 4. Modified Point-Mass (MPM) Solver (G7 + Aerodynamic Jump + Gyroscopic Spin Drift + Coriolis)
 * 5. 4DOF Solver (Translational degrees + axial spin decay + dynamic yaw of repose lift)
 * 6. Multi-Zone Wind Interpolator
 *
 * All inputs and internal integrations are strictly in canonical SI units:
 * [m, m/s, kg, Pa, K, rad, s]
 */

import { getCd } from '../data/dragTables.js';
import { BC_LB_IN2_TO_KG_M2 } from '../core/units.js';
import { calculateStability } from '../data/projectiles.js';

// Earth rotation constant (rad/s)
const EARTH_OMEGA = 7.292115e-5;
const GRAVITY = 9.80665;

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
 * Trajectory State Vector:
 * [x, y, z, vx, vy, vz, spinRateRadS]
 */
class TrajectorySolverCore {
  constructor({
    profile,
    environment,
    airDensity,
    speedOfSound,
    algorithm = 'G7',
    includeSpinDrift = true,
    includeCoriolis = true,
    includeAerodynamicJump = true,
  }) {
    this.profile = profile;
    this.bullet = profile.bullet;
    this.environment = environment;
    this.rho = airDensity;
    this.sos = speedOfSound;
    this.algorithm = algorithm;
    this.includeSpinDrift = includeSpinDrift;
    this.includeCoriolis = includeCoriolis;
    this.includeAerodynamicJump = includeAerodynamicJump;

    // Bullet physical parameters
    this.massKg = this.bullet.weightGr * 0.00006479891;
    this.diameterM = this.bullet.diameterIn * 0.0254;
    this.lengthM = this.bullet.lengthIn * 0.0254;
    this.areaM2 = (Math.PI * Math.pow(this.diameterM, 2)) / 4.0;
    this.twistM = (profile.twistRateIn * 0.0254);
    this.isRightTwist = (profile.twistDirection || 'right') === 'right';

    // Imperial to SI Ballistic Coefficient
    const rawBc = algorithm === 'G1' ? (this.bullet.bcG1 || this.bullet.bcG7 * 1.95) : (this.bullet.bcG7 || this.bullet.bcG1 * 0.51);
    this.bcSI = Math.max(0.01, rawBc) * BC_LB_IN2_TO_KG_M2;
    this.dragTable = algorithm === 'G1' ? 'G1' : (this.bullet.dragModel === 'DOPPLER' ? 'DOPPLER' : 'G7');

    // Inclination and Cant
    this.incRad = ((environment.inclinationDeg || 0) * Math.PI) / 180.0;
    this.cantRad = ((environment.cantDeg || 0) * Math.PI) / 180.0;

    // Coriolis parameters
    const latRad = ((environment.latitudeDeg || 45) * Math.PI) / 180.0;
    const azRad = ((environment.shootingAzimuthDeg || 0) * Math.PI) / 180.0;
    // Omega components in shooter's coordinate system (x downrange, y up, z right)
    this.omegaX = EARTH_OMEGA * Math.cos(latRad) * Math.cos(azRad);
    this.omegaY = EARTH_OMEGA * Math.sin(latRad);
    this.omegaZ = -EARTH_OMEGA * Math.cos(latRad) * Math.sin(azRad);

    // Initial spin rate (rad/s)
    this.v0 = profile.muzzleVelocityMs;
    this.spin0 = (2.0 * Math.PI * this.v0) / this.twistM * (this.isRightTwist ? 1 : -1);

    // Axial moment of inertia Ix approx 0.5 * m * r^2
    const r = this.diameterM / 2.0;
    this.Ix = 0.5 * this.massKg * Math.pow(r, 2);
    // Transverse moment of inertia Iy approx m * (3*r^2 + L^2) / 12
    this.Iy = this.massKg * (3.0 * Math.pow(r, 2) + Math.pow(this.lengthM, 2)) / 12.0;

    // Aerodynamic stability estimate
    const stab = calculateStability(
      this.bullet.weightGr,
      this.bullet.diameterIn,
      this.bullet.lengthIn,
      this.profile.twistRateIn,
      this.v0 * 3.28084
    );
    this.sg = stab.sg || 1.5;
  }

  /**
   * Compute state derivatives [dx/dt, dy/dt, dz/dt, dvx/dt, dvy/dt, dvz/dt, dspin/dt]
   */
  derivatives(t, state) {
    const [x, y, z, vx, vy, vz, spin] = state;

    // Get wind vector at current x
    const wind = getWindAtDistance(x, this.environment);
    const vrelX = vx - wind.wx;
    const vrelY = vy - wind.wy;
    const vrelZ = vz - wind.wz;
    const vrel = Math.sqrt(vrelX * vrelX + vrelY * vrelY + vrelZ * vrelZ);

    const mach = vrel / this.sos;
    const cd = getCd(this.dragTable, mach);

    // Standard exterior ballistics drag deceleration:
    // F_d = 0.5 * rho * vrel^2 * (pi * d^2 / 4) * Cd
    // a_d = F_d / m = (pi * rho * Cd) / (8 * BC_SI) * vrel^2
    const dragDecel = (Math.PI * this.rho * cd) / (8.0 * this.bcSI) * vrel;
    let ax = -dragDecel * vrelX;
    let ay = -dragDecel * vrelY;
    let az = -dragDecel * vrelZ;

    // Gravity in line of sight coordinate system
    ax += -GRAVITY * Math.sin(this.incRad);
    ay += -GRAVITY * Math.cos(this.incRad);

    // Coriolis Acceleration: a_coriolis = -2 * (Omega x v)
    if (this.includeCoriolis && (this.algorithm === 'MPM' || this.algorithm === '4DOF')) {
      const corX = -2.0 * (this.omegaY * vz - this.omegaZ * vy);
      const corY = -2.0 * (this.omegaZ * vx - this.omegaX * vz);
      const corZ = -2.0 * (this.omegaX * vy - this.omegaY * vx);
      ax += corX;
      ay += corY;
      az += corZ;
    }

    // Spin Drift & Aerodynamic Jump
    let dSpin = 0.0;
    if (this.algorithm === 'MPM') {
      if (this.includeSpinDrift) {
        // Bryan Litz / McCoy empirical spin drift acceleration:
        // Z_drift(t) = 1.25 * (Sg + 1.2) * t^1.83 (in inches)
        // d^2(Z)/dt^2 in SI units (m/s^2):
        const tSec = Math.max(0.001, t);
        const driftInPerSec2 = 1.25 * (this.sg + 1.2) * 1.83 * 0.83 * Math.pow(tSec, -0.17);
        const driftAccM = driftInPerSec2 * 0.0254 * (this.isRightTwist ? 1.0 : -1.0);
        az += driftAccM;
      }
    } else if (this.algorithm === '4DOF') {
      // 4DOF: axial spin decay via surface skin friction
      // d(spin)/dt = - (rho * Area * d^2 / (2 * Ix)) * Cspin * vrel * spin
      const cSpin = 0.018; // spin decay coefficient
      dSpin = -((this.rho * this.areaM2 * Math.pow(this.diameterM, 2)) / (2.0 * this.Ix)) * cSpin * vrel * spin;

      if (this.includeSpinDrift) {
        // Dynamic Yaw of Repose: alpha_e = (2 * Ix * spin * g) / (Iy * rho * v^3 * Cma)
        // Yielding lift acceleration perpendicular to trajectory
        const cmAlpha = 3.5; // pitching moment derivative
        const denom = this.Iy * this.rho * Math.pow(Math.max(10, vrel), 3) * cmAlpha;
        const yawOfRepose = (2.0 * this.Ix * spin * GRAVITY) / Math.max(1e-5, denom);

        // Lift acceleration: a_lift = 0.5 * rho * Area * vrel^2 * ClAlpha * yaw / mass
        const clAlpha = 2.0;
        const aLift = (0.5 * this.rho * this.areaM2 * Math.pow(vrel, 2) * clAlpha * yawOfRepose) / this.massKg;
        az += aLift * (this.isRightTwist ? 1.0 : -1.0);
      }
    }

    return [vx, vy, vz, ax, ay, az, dSpin];
  }

  /**
   * Runge-Kutta 4th order single step
   */
  rk4Step(t, state, dt) {
    const k1 = this.derivatives(t, state);

    const s2 = state.map((v, i) => v + 0.5 * dt * k1[i]);
    const k2 = this.derivatives(t + 0.5 * dt, s2);

    const s3 = state.map((v, i) => v + 0.5 * dt * k2[i]);
    const k3 = this.derivatives(t + 0.5 * dt, s3);

    const s4 = state.map((v, i) => v + dt * k3[i]);
    const k4 = this.derivatives(t + dt, s4);

    const nextState = state.map(
      (v, i) => v + (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i])
    );
    return nextState;
  }
}

/**
 * Solve for Bore Angle theta0 required to zero at R_zero distance
 * Uses Newton-Raphson method
 * @returns {number} Bore angle in radians
 */
export function solveZeroAngle(profile, environment, airDensity, speedOfSound, algorithm = null) {
  const rZero = profile.zeroDistanceM || 100.0;
  const sightH = profile.sightHeightM || 0.048;
  const v0 = profile.muzzleVelocityMs;
  const zeroAlgorithm = algorithm || (profile.bullet?.dragModel === 'G1' ? 'G1' : 'G7');

  let theta = 0.001; // Initial guess: ~1 mrad upwards
  const maxIters = 12;
  const tolerance = 1e-6; // 1 micrometer precision at zero range

  const simulateToZero = (boreAngle) => {
    const solver = new TrajectorySolverCore({
      profile: { ...profile, zeroAngleRad: boreAngle },
      environment,
      airDensity,
      speedOfSound,
      algorithm: zeroAlgorithm,
    });

    // Aerodynamic Jump correction at muzzle for right-hand twist and crosswind
    const initialWind = getWindAtDistance(0, environment);
    let aeroJumpRad = 0;
    if (solver.algorithm === 'MPM' || solver.algorithm === '4DOF') {
      // Bryan Litz / McCoy crosswind jump formula:
      // Jump = 0.00004 * crosswind(m/s) * (twist/d) rad
      const crosswind = initialWind.wz;
      const twistCal = profile.twistRateIn / profile.bullet.diameterIn;
      aeroJumpRad = 0.00004 * crosswind * twistCal * (solver.isRightTwist ? 1 : -1);
    }

    const effectivePitch = boreAngle + aeroJumpRad;
    const vx0 = v0 * Math.cos(effectivePitch);
    const vy0 = v0 * Math.sin(effectivePitch);
    const vz0 = 0.0;

    // Sight offset rotated by cant
    const y0 = -sightH * Math.cos(solver.cantRad);
    const z0 = -sightH * Math.sin(solver.cantRad);

    let state = [0, y0, z0, vx0, vy0, vz0, solver.spin0];
    let t = 0;
    const dt = 0.002; // 2 ms step

    while (state[0] < rZero && t < 2.0) {
      const next = solver.rk4Step(t, state, dt);
      if (next[0] >= rZero) {
        // Linear interpolation to exact rZero
        const fraction = (rZero - state[0]) / (next[0] - state[0]);
        const yAtZero = state[1] + fraction * (next[1] - state[1]);
        return yAtZero;
      }
      state = next;
      t += dt;
    }
    return state[1];
  };

  for (let iter = 0; iter < maxIters; iter++) {
    const yVal = simulateToZero(theta);
    if (Math.abs(yVal) < tolerance) {
      break;
    }
    // Finite difference derivative
    const dTheta = 1e-5;
    const yValPlus = simulateToZero(theta + dTheta);
    const slope = (yValPlus - yVal) / dTheta;
    if (Math.abs(slope) < 1e-9) break;

    const step = yVal / slope;
    theta -= step;
  }

  return theta;
}

/**
 * Generate full trajectory table up to maxRangeM with stepM intervals
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
}) {
  // Guard the table loop: a zero, negative or tiny step (e.g. from bad saved data) would never
  // finish. At most 2,000 rows over at most 5 km.
  const maxRangeM = Number.isFinite(rawMaxRangeM) ? Math.min(5000, Math.max(50, rawMaxRangeM)) : 1200;
  const stepM = Number.isFinite(rawStepM) && rawStepM > 0 ? Math.max(rawStepM, maxRangeM / 2000) : 25;
  // Ensure bore angle is calibrated
  let boreAngle = profile.zeroAngleRad;
  if (boreAngle === null || boreAngle === undefined) {
    boreAngle = solveZeroAngle(profile, environment, airDensity, speedOfSound, algorithm);
  }

  const solver = new TrajectorySolverCore({
    profile: { ...profile, zeroAngleRad: boreAngle },
    environment,
    airDensity,
    speedOfSound,
    algorithm,
    includeSpinDrift,
    includeCoriolis,
    includeAerodynamicJump,
  });

  const v0 = profile.muzzleVelocityMs;
  const sightH = profile.sightHeightM || 0.048;

  // Initial muzzle condition
  const initialWind = getWindAtDistance(0, environment);
  let aeroJumpRad = 0;
  if (includeAerodynamicJump && (algorithm === 'MPM' || algorithm === '4DOF')) {
    const crosswind = initialWind.wz;
    const twistCal = profile.twistRateIn / profile.bullet.diameterIn;
    aeroJumpRad = 0.00004 * crosswind * twistCal * (solver.isRightTwist ? 1 : -1);
  }

  const effectivePitch = boreAngle + aeroJumpRad;
  const vx0 = v0 * Math.cos(effectivePitch);
  const vy0 = v0 * Math.sin(effectivePitch);
  const vz0 = 0.0;

  const y0 = -sightH * Math.cos(solver.cantRad);
  const z0 = -sightH * Math.sin(solver.cantRad);

  let state = [0, y0, z0, vx0, vy0, vz0, solver.spin0];
  let t = 0;
  const dt = 0.001; // 1 ms integration step for sub-millimeter precision

  const trajectory = [];
  let nextTargetDistance = 0;

  // Record muzzle point (range 0)
  const initialSpeed = Math.sqrt(vx0 * vx0 + vy0 * vy0 + vz0 * vz0);
  const initialEnergy = 0.5 * solver.massKg * initialSpeed * initialSpeed;

  trajectory.push({
    distanceM: 0,
    dropM: y0,
    elevationRad: 0,
    elevationMrad: 0,
    elevationMoa: 0,
    elevationClicks: 0,
    driftM: z0,
    windageRad: 0,
    windageMrad: 0,
    windageMoa: 0,
    windageClicks: 0,
    velocityMs: initialSpeed,
    mach: initialSpeed / speedOfSound,
    energyJ: initialEnergy,
    tofS: 0,
    spinRateRpm: Math.abs(Math.round((solver.spin0 * 60) / (2 * Math.PI))),
    dangerSpaceM: 0,
  });
  nextTargetDistance += stepM;

  let maxOrdinateM = 0;
  let supersonicRangeM = 0;
  let transonicRangeM = 0;

  while (state[0] <= maxRangeM + stepM && t < 10.0) {
    const prevState = [...state];
    const prevT = t;

    state = solver.rk4Step(t, state, dt);
    t += dt;

    if (state[1] > maxOrdinateM) {
      maxOrdinateM = state[1];
    }

    const currentSpeed = Math.sqrt(state[3] * state[3] + state[4] * state[4] + state[5] * state[5]);
    const currentMach = currentSpeed / speedOfSound;

    if (currentMach >= 1.2) {
      supersonicRangeM = state[0];
    }
    if (currentMach >= 1.0) {
      transonicRangeM = state[0];
    }

    // Check if we stepped over next reporting distance
    while (state[0] >= nextTargetDistance && nextTargetDistance <= maxRangeM) {
      const frac = (nextTargetDistance - prevState[0]) / (state[0] - prevState[0]);
      const repY = prevState[1] + frac * (state[1] - prevState[1]);
      const repZ = prevState[2] + frac * (state[2] - prevState[2]);
      const repVx = prevState[3] + frac * (state[3] - prevState[3]);
      const repVy = prevState[4] + frac * (state[4] - prevState[4]);
      const repVz = prevState[5] + frac * (state[5] - prevState[5]);
      const repSpin = prevState[6] + frac * (state[6] - prevState[6]);
      const repT = prevT + frac * dt;

      const vMag = Math.sqrt(repVx * repVx + repVy * repVy + repVz * repVz);
      const machVal = vMag / speedOfSound;
      const energy = 0.5 * solver.massKg * vMag * vMag;

      // Angular elevations relative to line of sight
      // Elevation Dial: -y / distance (angle to dial UP to compensate for drop)
      const elRad = -repY / nextTargetDistance;
      const elMrad = elRad * 1000.0;
      const elMoa = elRad * ((180.0 * 60.0) / Math.PI);
      const elClicks = Math.round(elRad / (profile.optic?.clickValueRad || 0.0001));

      // Windage Dial: -z / distance (angle to dial into wind)
      const windRad = -repZ / nextTargetDistance;
      const windMrad = windRad * 1000.0;
      const windMoa = windRad * ((180.0 * 60.0) / Math.PI);
      const windClicks = Math.round(windRad / (profile.optic?.clickValueRad || 0.0001));

      // Danger space depth for 0.5m target (e.g. IPSC torso height)
      // Danger Space = targetHeight / |tan(flight_path_angle)|
      const flightPathAngle = Math.atan2(Math.abs(repVy), repVx);
      const dangerSpace = Math.min(250, flightPathAngle > 1e-4 ? 0.5 / Math.tan(flightPathAngle) : 250);

      trajectory.push({
        distanceM: nextTargetDistance,
        dropM: repY,
        elevationRad: elRad,
        elevationMrad: elMrad,
        elevationMoa: elMoa,
        elevationClicks: elClicks,
        driftM: repZ,
        windageRad: windRad,
        windageMrad: windMrad,
        windageMoa: windMoa,
        windageClicks: windClicks,
        velocityMs: vMag,
        mach: machVal,
        energyJ: energy,
        tofS: repT,
        spinRateRpm: Math.abs(Math.round((repSpin * 60) / (2 * Math.PI))),
        dangerSpaceM: dangerSpace,
      });

      nextTargetDistance += stepM;
    }

    // Safety abort if bullet has plunged underground or speed collapsed
    if (state[1] < -500 || currentSpeed < 50) {
      break;
    }
  }

  return {
    trajectory,
    telemetry: {
      zeroDistanceM: profile.zeroDistanceM,
      boreAngleRad: boreAngle,
      boreAngleMrad: boreAngle * 1000.0,
      boreAngleMoa: boreAngle * ((180.0 * 60.0) / Math.PI),
      maxOrdinateM,
      supersonicRangeM: Math.round(supersonicRangeM),
      transonicRangeM: Math.round(transonicRangeM),
      muzzleVelocityMs: v0,
      airDensityKgM3: airDensity,
      speedOfSoundMs: speedOfSound,
      algorithm,
    },
  };
}
