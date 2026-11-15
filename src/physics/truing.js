/**
 * Ballistic Workbench - Truing (calibrating the model to observed elevations)
 * 1. Muzzle velocity truing: find the MV that reproduces an elevation observed at a supersonic distance.
 * 2. Drag scale factor (DSF): find one factor that scales the bullet's drag (equivalently, divides its
 *    BC) so the model reproduces an elevation observed at long range. Note: this is a UNIFORM scale of
 *    the BC over the whole trajectory, not a Mach-dependent drop scale table. It changes the
 *    prediction at every distance, most at long range.
 *
 * Both solve at the exact observed distance (the trajectory is interpolated, not snapped to the
 * nearest table row) and re-zero for every trial value, as the rifle is zeroed by shooting.
 */

import { solveTrajectory, pointAtDistance } from './solvers.js';

const defaultAlgorithm = (profile) => (profile.bullet.dragModel === 'G1' ? 'G1' : 'G7');

/** Elevation (mrad) the model predicts at an exact distance, re-zeroed for the test profile. */
function elevationAt(profile, environment, airDensity, speedOfSound, algorithm, distanceM) {
  const sol = solveTrajectory({
    profile: { ...profile, zeroAngleRad: null },
    environment,
    airDensity,
    speedOfSound,
    algorithm,
    stepM: 10,
    maxRangeM: distanceM + 20,
  });
  const point = pointAtDistance(sol.trajectory, distanceM);
  return point ? point.elevationMrad : NaN;
}

/**
 * True Muzzle Velocity based on observed supersonic drop
 * @param {object} profile Base rifle/ammo profile
 * @param {object} environment Current atmospheric environment
 * @param {number} airDensity Air density in kg/m^3
 * @param {number} speedOfSound Speed of sound in m/s
 * @param {number} observedDistanceM Target distance where impacts were recorded (m)
 * @param {number} observedDropMrad Observed elevation hold / dial in MRAD (or converted from MOA/cm)
 * @param {string} [algorithm] Solver model (default: the bullet's drag model, G1 or G7)
 * @returns {object} { originalMv, calibratedMv, deltaMv, iterations, converged, message }
 *   calibratedMv is the velocity at the profile's reference powder temperature (the same meaning as
 *   profile.muzzleVelocityMs), so it can be saved into the profile directly.
 */
export function trueMuzzleVelocity({
  profile,
  environment,
  airDensity,
  speedOfSound,
  observedDistanceM,
  observedDropMrad,
  algorithm = null,
}) {
  const alg = algorithm || defaultAlgorithm(profile);
  const originalMv = profile.muzzleVelocityMs;
  let mv = originalMv;
  const maxIters = 15;
  const toleranceMrad = 0.002;

  const evaluateDial = (testMv) =>
    elevationAt({ ...profile, muzzleVelocityMs: testMv }, environment, airDensity, speedOfSound, alg, observedDistanceM);

  let converged = false;
  let iters = 0;

  for (iters = 0; iters < maxIters; iters++) {
    const simDial = evaluateDial(mv);
    const residual = simDial - observedDropMrad;
    if (!Number.isFinite(residual)) break;

    if (Math.abs(residual) < toleranceMrad) {
      converged = true;
      break;
    }

    // Finite difference derivative: d(Dial)/d(MV)
    const dMv = 1.0; // 1 m/s perturbation
    const dDialDmv = (evaluateDial(mv + dMv) - simDial) / dMv;
    if (!Number.isFinite(dDialDmv) || Math.abs(dDialDmv) < 1e-6) break;

    // Damp large steps to prevent divergence, and stay within realistic rifle velocities
    const step = Math.max(-50, Math.min(50, residual / dDialDmv));
    mv = Math.max(200, Math.min(1500, mv - step));
  }

  const calibratedMv = Number(mv.toFixed(1));
  const deltaMv = Number((calibratedMv - originalMv).toFixed(1));

  return {
    originalMv,
    calibratedMv,
    deltaMv,
    iterations: iters,
    converged,
    algorithm: alg,
    message: converged
      ? `Trued muzzle velocity: ${calibratedMv} m/s (${deltaMv > 0 ? '+' : ''}${deltaMv} m/s)`
      : `Truing stopped after ${iters} iterations (muzzle velocity ${calibratedMv} m/s)`,
  };
}

/**
 * True the drag with one uniform scale factor (DSF)
 * effective BC = BC / DSF over the whole trajectory (DSF > 1 means more drag than the BC says).
 * @param {object} profile Base rifle/ammo profile with already-trued MV
 * @param {object} environment Current atmospheric environment
 * @param {number} airDensity Air density in kg/m^3
 * @param {number} speedOfSound Speed of sound in m/s
 * @param {number} observedDistanceM Long-range distance where impacts were recorded (m)
 * @param {number} observedDropMrad Observed elevation hold / dial in MRAD
 * @param {string} [algorithm] Solver model (default: the bullet's drag model, G1 or G7)
 * @returns {object} { calibratedDsf, deltaPercent, calibratedBc, originalBc, dragModel, scope, iterations, converged, message }
 */
export function trueDropScaleFactor({
  profile,
  environment,
  airDensity,
  speedOfSound,
  observedDistanceM,
  observedDropMrad,
  algorithm = null,
}) {
  const alg = algorithm || defaultAlgorithm(profile);
  const usesG1 = alg === 'G1' || (alg !== 'G7' && profile.bullet.dragModel === 'G1');
  const originalBc = usesG1 ? profile.bullet.bcG1 : profile.bullet.bcG7;
  let dsf = 1.0;
  const maxIters = 15;
  const toleranceMrad = 0.005;

  const bulletWithDsf = (testDsf) => {
    const effectiveBc = originalBc / Math.max(0.2, testDsf);
    return usesG1 ? { ...profile.bullet, bcG1: effectiveBc } : { ...profile.bullet, bcG7: effectiveBc };
  };
  const evaluateDialWithDsf = (testDsf) =>
    elevationAt({ ...profile, bullet: bulletWithDsf(testDsf) }, environment, airDensity, speedOfSound, alg, observedDistanceM);

  let converged = false;
  let iters = 0;

  for (iters = 0; iters < maxIters; iters++) {
    const simDial = evaluateDialWithDsf(dsf);
    const residual = simDial - observedDropMrad;
    if (!Number.isFinite(residual)) break;

    if (Math.abs(residual) < toleranceMrad) {
      converged = true;
      break;
    }

    const dDsf = 0.02;
    const slope = (evaluateDialWithDsf(dsf + dDsf) - simDial) / dDsf;
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-5) break;

    const step = Math.max(-0.15, Math.min(0.15, residual / slope));
    dsf = Math.max(0.6, Math.min(1.5, dsf - step));
  }

  const calibratedDsf = Number(dsf.toFixed(3));
  const deltaPercent = Number(((calibratedDsf - 1.0) * 100).toFixed(1));
  const calibratedBc = Number((originalBc / dsf).toFixed(4));
  const dragModel = usesG1 ? 'G1' : 'G7';

  return {
    calibratedDsf,
    deltaPercent,
    originalBc,
    calibratedBc,
    dragModel,
    scope: 'whole-trajectory', // one BC scale for every distance, not a Mach-dependent table
    iterations: iters,
    converged,
    algorithm: alg,
    message: converged
      ? `Drag scale factor ${calibratedDsf} (${deltaPercent > 0 ? '+' : ''}${deltaPercent}% drag): ${dragModel} BC ${originalBc} becomes ${calibratedBc} for the whole trajectory`
      : `Drag truing stopped at a factor of ${calibratedDsf} (${dragModel} BC ${calibratedBc})`,
  };
}
