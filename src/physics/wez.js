/**
 * Ballistic Workbench - Weapon Employment Zone (WEZ) & Monte Carlo Engine
 * Runs 1,000-shot stochastic simulations to determine:
 * - Hit Probability on steel & tactical targets
 * - CEP (Circular Error Probable - 50% radius) and R95 (95% radius)
 * - Sensitivity analysis (variance contribution of MV, Wind, Range, and Shooter dispersion)
 * - Dispersion scatter coordinates for high-DPI visual canvas rendering
 */

import { solveTrajectory } from './solvers.js';

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

/**
 * Run 1,000-shot Monte Carlo WEZ simulation
 */
export function runWezSimulation({
  profile,
  environment,
  airDensity,
  speedOfSound,
  target,
  numShots = 1000,
  uncertainties = {
    mvSdMs: 3.0, // Muzzle velocity SD (m/s)
    rangeSdM: 5.0, // Rangefinder error SD (m)
    windSpeedSdMs: 1.0, // Wind speed reading SD (m/s)
    windDirSdDeg: 12.0, // Wind angle estimation SD (deg)
    shooterPrecisionRad: 0.000145, // 0.5 MOA / 0.145 MRAD rifle+shooter dispersion
  },
}) {
  const targetDistM = target.distanceM || 600;

  // 1. Nominal trajectory integration around target range
  const baselineSol = solveTrajectory({
    profile,
    environment,
    airDensity,
    speedOfSound,
    algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
    stepM: 10,
    maxRangeM: targetDistM + 50,
  });

  const getInterpolatedPoint = (dist) => {
    const traj = baselineSol.trajectory;
    for (let i = 0; i < traj.length - 1; i++) {
      if (dist >= traj[i].distanceM && dist <= traj[i + 1].distanceM) {
        const f = (dist - traj[i].distanceM) / (traj[i + 1].distanceM - traj[i].distanceM);
        return {
          dropM: traj[i].dropM + f * (traj[i + 1].dropM - traj[i].dropM),
          driftM: traj[i].driftM + f * (traj[i + 1].driftM - traj[i].driftM),
          velocityMs: traj[i].velocityMs + f * (traj[i + 1].velocityMs - traj[i].velocityMs),
        };
      }
    }
    return traj[traj.length - 1];
  };

  const nominalPoint = getInterpolatedPoint(targetDistM);

  // 2. Sensitivity derivatives via finite perturbation
  // dY/dMV
  const mvPerturb = 2.0;
  const solMvPlus = solveTrajectory({
    profile: { ...profile, muzzleVelocityMs: profile.muzzleVelocityMs + mvPerturb },
    environment,
    airDensity,
    speedOfSound,
    algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
    stepM: 25,
    maxRangeM: targetDistM + 50,
  });
  const pointMvPlus = solMvPlus.trajectory.reduce((p, c) =>
    Math.abs(c.distanceM - targetDistM) < Math.abs(p.distanceM - targetDistM) ? c : p
  );
  const dYdMv = (pointMvPlus.dropM - nominalPoint.dropM) / mvPerturb; // m per m/s

  // dY/dRange (trajectory angle at target)
  const rangePerturb = 10.0;
  const pointRangePlus = getInterpolatedPoint(targetDistM + rangePerturb);
  const dYdRange = (pointRangePlus.dropM - nominalPoint.dropM) / rangePerturb; // m per m

  // dZ/dWindSpeed
  const windPerturb = 1.0;
  const solWindPlus = solveTrajectory({
    profile,
    environment: { ...environment, windSpeedMs: (environment.windSpeedMs || 4.0) + windPerturb },
    airDensity,
    speedOfSound,
    algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
    stepM: 25,
    maxRangeM: targetDistM + 50,
  });
  const pointWindPlus = solWindPlus.trajectory.reduce((p, c) =>
    Math.abs(c.distanceM - targetDistM) < Math.abs(p.distanceM - targetDistM) ? c : p
  );
  const dZdWind = (pointWindPlus.driftM - nominalPoint.driftM) / windPerturb; // m per m/s

  // dZ/dWindDir
  const dirPerturbDeg = 10.0;
  const solDirPlus = solveTrajectory({
    profile,
    environment: { ...environment, windDirectionDeg: (environment.windDirectionDeg || 90.0) + dirPerturbDeg },
    airDensity,
    speedOfSound,
    algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
    stepM: 25,
    maxRangeM: targetDistM + 50,
  });
  const pointDirPlus = solDirPlus.trajectory.reduce((p, c) =>
    Math.abs(c.distanceM - targetDistM) < Math.abs(p.distanceM - targetDistM) ? c : p
  );
  const dZdDir = (pointDirPlus.driftM - nominalPoint.driftM) / dirPerturbDeg;

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

  const varTotal = varTotalY + varTotalZ;

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
  };
}
