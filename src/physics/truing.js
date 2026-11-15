/**
 * Ballistic Workbench - Ballistic Calibration & Truing Engine
 * Implements:
 * 1. Supersonic Muzzle Velocity (MV) Truing (Newton-Raphson)
 * 2. Transonic & Subsonic Drop Scale Factor (DSF) Solver
 * 3. Ballistic Coefficient (BC) Truing
 */

import { solveTrajectory, solveZeroAngle } from './solvers.js';

/**
 * True Muzzle Velocity based on observed supersonic drop
 * @param {object} profile Base rifle/ammo profile
 * @param {object} environment Current atmospheric environment
 * @param {number} airDensity Air density in kg/m^3
 * @param {number} speedOfSound Speed of sound in m/s
 * @param {number} observedDistanceM Target distance where impacts were recorded (m)
 * @param {number} observedDropMrad Observed elevation hold / dial in MRAD (or converted from MOA/cm)
 * @returns {object} { originalMv, calibratedMv, deltaMv, iterations, converged, message }
 */
export function trueMuzzleVelocity({
  profile,
  environment,
  airDensity,
  speedOfSound,
  observedDistanceM,
  observedDropMrad,
}) {
  const originalMv = profile.muzzleVelocityMs;
  let mv = originalMv;
  const maxIters = 15;
  const toleranceMrad = 0.01; // 0.01 MRAD precision (~1 click = 0.1 mrad)

  const evaluateDial = (testMv) => {
    const testProfile = {
      ...profile,
      muzzleVelocityMs: testMv,
      zeroAngleRad: null, // Re-zero at 100m with this MV
    };
    const zeroAngle = solveZeroAngle(testProfile, environment, airDensity, speedOfSound);
    testProfile.zeroAngleRad = zeroAngle;

    const sol = solveTrajectory({
      profile: testProfile,
      environment,
      airDensity,
      speedOfSound,
      algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
      stepM: 10,
      maxRangeM: observedDistanceM + 20,
    });

    // Find point nearest to observed distance
    const point = sol.trajectory.reduce((prev, curr) =>
      Math.abs(curr.distanceM - observedDistanceM) < Math.abs(prev.distanceM - observedDistanceM) ? curr : prev
    );

    return point.elevationMrad;
  };

  let converged = false;
  let iters = 0;

  for (iters = 0; iters < maxIters; iters++) {
    const simDial = evaluateDial(mv);
    const residual = simDial - observedDropMrad;

    if (Math.abs(residual) < toleranceMrad) {
      converged = true;
      break;
    }

    // Finite difference derivative: d(Dial)/d(MV)
    const dMv = 1.0; // 1 m/s perturbation
    const simDialPlus = evaluateDial(mv + dMv);
    const dDialDmv = (simDialPlus - simDial) / dMv;

    if (Math.abs(dDialDmv) < 1e-6) {
      break;
    }

    const step = residual / dDialDmv;
    // Dampen large steps to prevent divergence
    const clampedStep = Math.max(-50, Math.min(50, step));
    mv -= clampedStep;

    // Safety bounds for realistic rifle velocities
    mv = Math.max(200, Math.min(1500, mv));
  }

  const calibratedMv = Number(mv.toFixed(1));
  const deltaMv = Number((calibratedMv - originalMv).toFixed(1));

  return {
    originalMv,
    calibratedMv,
    deltaMv,
    iterations: iters,
    converged,
    message: converged
      ? `Successfully trued MV to ${calibratedMv} m/s (${deltaMv > 0 ? '+' : ''}${deltaMv} m/s adjustment)`
      : `Truing stopped after ${iters} iterations (calibrated MV: ${calibratedMv} m/s)`,
  };
}

/**
 * True Transonic Drop Scale Factor (DSF)
 * Scales drag in the transonic/subsonic regime to match extreme-distance recorded elevation
 * @param {object} profile Base rifle/ammo profile with already-trued MV
 * @param {object} environment Current atmospheric environment
 * @param {number} airDensity Air density in kg/m^3
 * @param {number} speedOfSound Speed of sound in m/s
 * @param {number} observedDistanceM Target distance in transonic zone (m)
 * @param {number} observedDropMrad Observed elevation hold / dial in MRAD
 * @returns {object} { calibratedDsf, deltaPercent, iterations, converged, message }
 */
export function trueDropScaleFactor({
  profile,
  environment,
  airDensity,
  speedOfSound,
  observedDistanceM,
  observedDropMrad,
}) {
  let dsf = 1.0;
  const maxIters = 12;
  const toleranceMrad = 0.02;

  const originalBc = profile.bullet.dragModel === 'G1' ? profile.bullet.bcG1 : profile.bullet.bcG7;

  const evaluateDialWithDsf = (testDsf) => {
    // Scaling drag coefficient Cd by testDsf is equivalent to dividing BC by testDsf
    const effectiveBc = originalBc / Math.max(0.2, testDsf);
    const testProfile = {
      ...profile,
      bullet: {
        ...profile.bullet,
        bcG7: profile.bullet.dragModel === 'G1' ? profile.bullet.bcG7 : effectiveBc,
        bcG1: profile.bullet.dragModel === 'G1' ? effectiveBc : profile.bullet.bcG1,
      },
    };

    const sol = solveTrajectory({
      profile: testProfile,
      environment,
      airDensity,
      speedOfSound,
      algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
      stepM: 10,
      maxRangeM: observedDistanceM + 20,
    });

    const point = sol.trajectory.reduce((prev, curr) =>
      Math.abs(curr.distanceM - observedDistanceM) < Math.abs(prev.distanceM - observedDistanceM) ? curr : prev
    );

    return point.elevationMrad;
  };

  let converged = false;
  let iters = 0;

  for (iters = 0; iters < maxIters; iters++) {
    const simDial = evaluateDialWithDsf(dsf);
    const residual = simDial - observedDropMrad;

    if (Math.abs(residual) < toleranceMrad) {
      converged = true;
      break;
    }

    const dDsf = 0.02;
    const simDialPlus = evaluateDialWithDsf(dsf + dDsf);
    const slope = (simDialPlus - simDial) / dDsf;

    if (Math.abs(slope) < 1e-5) break;

    const step = residual / slope;
    const clampedStep = Math.max(-0.15, Math.min(0.15, step));
    dsf -= clampedStep;
    dsf = Math.max(0.6, Math.min(1.5, dsf));
  }

  const calibratedDsf = Number(dsf.toFixed(3));
  const deltaPercent = Number(((calibratedDsf - 1.0) * 100).toFixed(1));

  return {
    calibratedDsf,
    deltaPercent,
    iterations: iters,
    converged,
    message: converged
      ? `Calibrated Drop Scale Factor (DSF): ${calibratedDsf} (${deltaPercent > 0 ? '+' : ''}${deltaPercent}%)`
      : `DSF solver reached limit: ${calibratedDsf}`,
  };
}
