/**
 * Ballistic Workbench - Hit probability (WEZ) Monte Carlo simulation
 * Simulates many shots (1,000 by default) to estimate:
 * - Hit Probability on steel & tactical targets
 * - CEP (Circular Error Probable - 50% radius) and R95 (95% radius)
 * - Sensitivity analysis (variance contribution of MV, Wind, Range, and Shooter dispersion)
 * - Dispersion scatter coordinates for high-DPI visual canvas rendering
 */

import { solveTrajectory, solveZeroAngle, pointAtDistance } from './solvers.js';

/**
 * Standard Gaussian random generator using Box-Muller transform
 */
function randomGaussian(mean = 0, stdDev = 1) {
  let u1 = 0;
  let u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

/**
 * Check if a shot at coordinate (xCm, yCm) relative to target center hits the target
 */
export function isTargetHit(xCm, yCm, target) {
  const shape = target.targetShape || 'ipsc';
  const halfW = (target.targetSizeWidthCm || 45) / 2.0;
  const halfH = (target.targetSizeHeightCm || 75) / 2.0;

  switch (shape) {
    case 'circle': {
      const radius = halfW; // width is diameter
      return xCm * xCm + yCm * yCm <= radius * radius;
    }
    case 'square': {
      return Math.abs(xCm) <= halfW && Math.abs(yCm) <= halfH;
    }
    case 'nato-e': {
      // NATO E-type: 49.5 x 100 cm with tapered head
      if (Math.abs(xCm) > halfW || Math.abs(yCm) > halfH) return false;
      if (yCm > halfH * 0.6) {
        // Upper head taper
        const headHalfW = halfW * 0.5;
        return Math.abs(xCm) <= headHalfW;
      }
      return true;
    }
    case 'ipsc':
    default: {
      // IPSC Torso: 45 x 75 cm with 15x15 cm head box and angled shoulders
      if (Math.abs(xCm) > halfW || Math.abs(yCm) > halfH) return false;
      const headBottom = halfH * 0.6; // head starts at top 20%
      if (yCm > headBottom) {
        const headHalfW = 15.0 / 2.0;
        return Math.abs(xCm) <= headHalfW;
      }
      return true;
    }
  }
}

const DEFAULT_UNCERTAINTIES = {
  mvSdMs: 3.0, // Muzzle velocity SD (m/s)
  rangeSdM: 5.0, // Rangefinder error SD (m)
  windSpeedSdMs: 1.0, // Wind speed reading SD (m/s)
  windDirSdDeg: 12.0, // Wind angle estimation SD (deg)
  shooterPrecisionRad: 0.000145, // 0.5 MOA / 0.145 MRAD rifle+shooter dispersion
};

/** The same environment with every wind reading (main wind and zones) changed by fn. */
function shiftWind(environment, fn) {
  const base = fn({ speedMs: environment.windSpeedMs ?? 0, directionDeg: environment.windDirectionDeg ?? 90 });
  return {
    ...environment,
    windSpeedMs: base.speedMs,
    windDirectionDeg: base.directionDeg,
    windZones: (environment.windZones || []).map((z) => ({ ...z, ...fn({ speedMs: z.speedMs, directionDeg: z.directionDeg }) })),
  };
}

/**
 * Run a Monte Carlo hit-probability (WEZ) simulation.
 *
 * Each error source is turned into a miss distance at the target with a first-order sensitivity,
 * computed from full trajectory solves that all use the same fixed zero angle and are interpolated
 * at the exact target distance:
 * - MV: change in drop per m/s of muzzle velocity (the zero does not move shot to shot),
 * - range: the shooter dials the elevation for the distance they measured, so a ranging error δ
 *   gives a vertical miss of R · dE/dR · δ (= (Y/R − dY/dR) · δ for drop Y below the line of sight),
 * - wind speed and direction: change in drift per m/s and per degree (all wind zones shifted together),
 * - shooter/rifle: angular dispersion times distance.
 */
export function runWezSimulation({
  profile,
  environment,
  airDensity,
  speedOfSound,
  target,
  numShots: rawNumShots = 1000,
  algorithm = null,
  uncertainties: rawUncertainties = {},
}) {
  const targetDistM = target.distanceM > 0 ? target.distanceM : 600;
  const numShots = Math.max(1, Math.round(Number.isFinite(rawNumShots) ? rawNumShots : 1000));
  const uncertainties = { ...DEFAULT_UNCERTAINTIES };
  for (const [k, v] of Object.entries(rawUncertainties || {})) {
    if (Number.isFinite(v) && v >= 0) uncertainties[k] = v;
  }
  const alg = algorithm || (profile.bullet.dragModel === 'G1' ? 'G1' : 'G7');

  // 1. One zero for every solve, so shot-to-shot changes are not hidden by a re-zero
  const zeroAngleRad = Number.isFinite(profile.zeroAngleRad)
    ? profile.zeroAngleRad
    : solveZeroAngle(profile, environment, airDensity, speedOfSound, alg);
  const fixedProfile = { ...profile, zeroAngleRad };
  const rangeStepM = 10;
  const solveAt = (prof, env) => {
    const sol = solveTrajectory({
      profile: prof,
      environment: env,
      airDensity,
      speedOfSound,
      algorithm: alg,
      stepM: 5,
      maxRangeM: targetDistM + rangeStepM + 10,
    });
    return (d) => pointAtDistance(sol.trajectory, d);
  };

  const nominal = solveAt(fixedProfile, environment);
  const nominalPoint = nominal(targetDistM);

  // 2. Sensitivities
  const mvPerturb = 2.0;
  const mvPlus = solveAt({ ...fixedProfile, muzzleVelocityMs: profile.muzzleVelocityMs + mvPerturb }, environment);
  const dYdMv = (mvPlus(targetDistM).dropM - nominalPoint.dropM) / mvPerturb; // m per m/s

  const dEdR = (nominal(targetDistM + rangeStepM).elevationRad - nominal(targetDistM - rangeStepM).elevationRad) / (2 * rangeStepM);
  const dYdRange = targetDistM * dEdR; // m of vertical miss per m of ranging error

  const windPerturb = 1.0;
  const windPlus = solveAt(fixedProfile, shiftWind(environment, (w) => ({ speedMs: w.speedMs + windPerturb, directionDeg: w.directionDeg })));
  const dZdWind = (windPlus(targetDistM).driftM - nominalPoint.driftM) / windPerturb; // m per m/s

  const dirPerturbDeg = 5.0;
  const dirPlus = solveAt(fixedProfile, shiftWind(environment, (w) => ({ speedMs: w.speedMs, directionDeg: w.directionDeg + dirPerturbDeg })));
  const dirMinus = solveAt(fixedProfile, shiftWind(environment, (w) => ({ speedMs: w.speedMs, directionDeg: w.directionDeg - dirPerturbDeg })));
  const dZdDir = (dirPlus(targetDistM).driftM - dirMinus(targetDistM).driftM) / (2 * dirPerturbDeg); // m per degree

  // 3. Monte Carlo Loop
  let hits = 0;
  const shotCoords = []; // in cm for target coordinate space (x = lateral, y = vertical)
  const distancesFromCenter = [];

  for (let i = 0; i < numShots; i++) {
    const deltaMv = randomGaussian(0, uncertainties.mvSdMs);
    const deltaRange = randomGaussian(0, uncertainties.rangeSdM);
    const deltaWind = randomGaussian(0, uncertainties.windSpeedSdMs);
    const deltaDir = randomGaussian(0, uncertainties.windDirSdDeg);

    // Rifle & shooter angular jitter
    const shooterXm = randomGaussian(0, uncertainties.shooterPrecisionRad) * targetDistM;
    const shooterYm = randomGaussian(0, uncertainties.shooterPrecisionRad) * targetDistM;

    // Perturbation linear offset (in meters)
    const yOffsetM = dYdMv * deltaMv + dYdRange * deltaRange + shooterYm;
    const zOffsetM = dZdWind * deltaWind + dZdDir * deltaDir + shooterXm;

    // Convert to target face in centimeters:
    // x = lateral deflection (+z is right), y = vertical (+y is up)
    const xCm = zOffsetM * 100.0;
    const yCm = yOffsetM * 100.0;

    const hit = isTargetHit(xCm, yCm, target);
    if (hit) hits++;

    const distFromCenter = Math.sqrt(xCm * xCm + yCm * yCm);
    distancesFromCenter.push(distFromCenter);

    // Keep first 250 shots for high-fidelity canvas scatter
    if (i < 250) {
      shotCoords.push({ xCm: Number(xCm.toFixed(1)), yCm: Number(yCm.toFixed(1)), hit });
    }
  }

  // 4. Calculate statistical metrics
  distancesFromCenter.sort((a, b) => a - b);
  const cepCm = distancesFromCenter[Math.floor(numShots * 0.50)];
  const r95Cm = distancesFromCenter[Math.floor(numShots * 0.95)];
  const meanRadiusCm = distancesFromCenter.reduce((s, v) => s + v, 0) / numShots;
  const hitProbabilityPercent = (hits / numShots) * 100.0;

  // 5. Sensitivity variance breakdown
  const varY_Mv = Math.pow(dYdMv * uncertainties.mvSdMs * 100, 2);
  const varY_Range = Math.pow(dYdRange * uncertainties.rangeSdM * 100, 2);
  const varY_Shooter = Math.pow(uncertainties.shooterPrecisionRad * targetDistM * 100, 2);
  const varTotalY = varY_Mv + varY_Range + varY_Shooter;

  const varZ_Wind = Math.pow(dZdWind * uncertainties.windSpeedSdMs * 100, 2) + Math.pow(dZdDir * uncertainties.windDirSdDeg * 100, 2);
  const varZ_Shooter = varY_Shooter;
  const varTotalZ = varZ_Wind + varZ_Shooter;

  // Guard against a 0/0 when every error source is zero
  const varTotal = varTotalY + varTotalZ > 0 ? varTotalY + varTotalZ : 1;

  const sensitivity = [
    { factor: 'Wind Uncertainty', variancePercent: Number(((varZ_Wind / varTotal) * 100).toFixed(1)), category: 'Wind' },
    { factor: 'Muzzle Velocity Variation (SD)', variancePercent: Number(((varY_Mv / varTotal) * 100).toFixed(1)), category: 'Ammo' },
    { factor: 'Shooter & Rifle Dispersion', variancePercent: Number((((varY_Shooter + varZ_Shooter) / varTotal) * 100).toFixed(1)), category: 'Precision' },
    { factor: 'Range Estimation Error', variancePercent: Number(((varY_Range / varTotal) * 100).toFixed(1)), category: 'Ranging' },
  ].sort((a, b) => b.variancePercent - a.variancePercent);

  return {
    numShots,
    targetDistM,
    hitProbabilityPercent: Number(hitProbabilityPercent.toFixed(1)),
    cepCm: Number(cepCm.toFixed(1)),
    cepMoa: Number(((cepCm * 0.01) / targetDistM * ((180 * 60) / Math.PI)).toFixed(2)),
    cepMrad: Number(((cepCm * 0.01) / targetDistM * 1000).toFixed(2)),
    r95Cm: Number(r95Cm.toFixed(1)),
    meanRadiusCm: Number(meanRadiusCm.toFixed(1)),
    sensitivity,
    shotCoords,
    // First-order sensitivities used for the simulation (SI: m per m/s, m per m, m per degree)
    derivatives: { dYdMv, dYdRange, dZdWind, dZdDir },
    zeroAngleRad,
    algorithm: alg,
  };
}
