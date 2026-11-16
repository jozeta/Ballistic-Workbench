/**
 * Ballistic Workbench - multi-point truing (fit the model to a logbook of impacts)
 *
 * Each logbook entry is one distance where the shooter found the elevation that centred the group,
 * with the conditions on that day. fitLogbook finds the muzzle velocity, and with enough spread in
 * distance also a drag scale factor (BC ÷ factor, as in truing.js), that make the model's elevations
 * match all entries at once in the least-squares sense (Levenberg-Marquardt, numeric Jacobian).
 *
 * Every prediction re-zeroes the rifle in that entry's conditions (zeroAngleRad null), the same way
 * the rest of the app solves. Muzzle velocity is the profile value at the reference powder
 * temperature, so the result can be saved into the profile directly.
 */

import { solveTrajectory, pointAtDistance } from './solvers.js';
import { getAtmosphericConditions } from './atmosphere.js';

/** Drag is only fitted when the entries reach this far and span this ratio of distances. */
export const DRAG_FIT_MIN_RANGE_M = 500;
export const DRAG_FIT_MIN_SPAN = 1.5;

const atmosOf = (env) => getAtmosphericConditions({
  pressurePa: env.pressureHpa * 100,
  tempK: env.temperatureC + 273.15,
  relativeHumidity: (env.humidityPercent ?? 50) / 100,
  altitudeM: env.altitudeM ?? 0,
});

/** Can the entries tell drag apart from muzzle velocity? */
export function canFitDrag(entries) {
  const d = (entries || []).map((e) => e.distanceM).filter((x) => x > 0);
  if (d.length < 2) return false;
  const max = Math.max(...d);
  const min = Math.min(...d);
  return max >= DRAG_FIT_MIN_RANGE_M && max / min >= DRAG_FIT_MIN_SPAN;
}

/**
 * @param {object} args
 * @param {object} args.profile Rifle profile
 * @param {Array<{distanceM:number, observedElevationRad:number, environment:object}>} args.entries
 * @param {string} [args.algorithm] Solver model (default: the bullet's drag table)
 * @param {boolean|'auto'} [args.fitDrag] Fit drag too (auto: when canFitDrag)
 * @returns {null | { muzzleVelocityMs, dsf, dragModel, originalBc, bc, fittedDrag, before, after, rmsBeforeMrad, rmsAfterMrad, iterations }}
 *   before/after: per entry { distanceM, observedMrad, predictedMrad, residualMrad } (predicted − observed).
 */
export function fitLogbook({ profile, entries, algorithm = null, fitDrag = 'auto' }) {
  const list = (entries || []).filter((e) => e.distanceM > 0 && Number.isFinite(e.observedElevationRad) && e.environment);
  if (!list.length || !profile?.bullet) return null;
  const alg = algorithm || (profile.bullet.dragModel === 'G1' ? 'G1' : 'G7');
  const usesG1 = alg === 'G1' || (alg !== 'G7' && profile.bullet.dragModel === 'G1');
  const bcKey = usesG1 ? 'bcG1' : 'bcG7';
  const originalBc = profile.bullet[bcKey];
  const withDrag = fitDrag === 'auto' ? canFitDrag(list) : Boolean(fitDrag);
  const atmos = list.map((e) => atmosOf(e.environment));
  const mv0 = profile.muzzleVelocityMs;

  const predict = (mv, dsf) => list.map((e, i) => {
    const prof = { ...profile, zeroAngleRad: null, muzzleVelocityMs: mv, bullet: { ...profile.bullet, [bcKey]: originalBc / dsf } };
    const sol = solveTrajectory({
      profile: prof,
      environment: e.environment,
      airDensity: atmos[i].densityKgM3,
      speedOfSound: atmos[i].speedOfSoundMs,
      algorithm: alg,
      stepM: 10,
      maxRangeM: e.distanceM + 20,
    });
    const p = pointAtDistance(sol.trajectory, e.distanceM);
    return p ? p.elevationRad * 1000 : NaN;
  });
  const observed = list.map((e) => e.observedElevationRad * 1000);
  const residuals = (pred) => pred.map((p, i) => p - observed[i]);
  const sse = (r) => r.reduce((s, x) => s + x * x, 0);
  const clampMv = (v) => Math.min(mv0 * 1.2, Math.max(mv0 * 0.8, v));
  const clampDsf = (v) => Math.min(1.5, Math.max(0.6, v));

  let mv = mv0;
  let dsf = 1;
  const beforePred = predict(mv, dsf);
  let r = residuals(beforePred);
  if (r.some((x) => !Number.isFinite(x))) return null;
  let cost = sse(r);
  let lambda = 1e-3;
  let iterations = 0;

  for (; iterations < 20; iterations++) {
    // Jacobian columns: d(residual)/d(mv) and d(residual)/d(dsf)
    const hMv = 1;
    const hDsf = 0.01;
    const jMv = residuals(predict(mv + hMv, dsf)).map((x, i) => (x - r[i]) / hMv);
    const jDsf = withDrag ? residuals(predict(mv, dsf + hDsf)).map((x, i) => (x - r[i]) / hDsf) : null;

    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      let dMv;
      let dDsf = 0;
      if (withDrag) {
        // Solve (JᵀJ + λ·diag(JᵀJ)) δ = −Jᵀr for two parameters
        const a = jMv.reduce((s, x) => s + x * x, 0);
        const b = jMv.reduce((s, x, i) => s + x * jDsf[i], 0);
        const c = jDsf.reduce((s, x) => s + x * x, 0);
        const g1 = jMv.reduce((s, x, i) => s + x * r[i], 0);
        const g2 = jDsf.reduce((s, x, i) => s + x * r[i], 0);
        const A = a * (1 + lambda);
        const C = c * (1 + lambda);
        const det = A * C - b * b;
        if (!(Math.abs(det) > 1e-18)) break;
        dMv = -(C * g1 - b * g2) / det;
        dDsf = -(A * g2 - b * g1) / det;
      } else {
        const a = jMv.reduce((s, x) => s + x * x, 0);
        const g1 = jMv.reduce((s, x, i) => s + x * r[i], 0);
        if (!(a > 1e-18)) break;
        dMv = -g1 / (a * (1 + lambda));
      }
      const nextMv = clampMv(mv + dMv);
      const nextDsf = withDrag ? clampDsf(dsf + dDsf) : 1;
      const nextR = residuals(predict(nextMv, nextDsf));
      const nextCost = sse(nextR);
      if (Number.isFinite(nextCost) && nextCost < cost) {
        const gain = cost - nextCost;
        mv = nextMv;
        dsf = nextDsf;
        r = nextR;
        cost = nextCost;
        lambda = Math.max(1e-6, lambda / 10);
        improved = true;
        if (gain < 1e-10) iterations = 99; // converged
      } else {
        lambda *= 10;
      }
    }
    if (!improved || iterations >= 99) break;
  }

  const rows = (pred) => list.map((e, i) => ({
    distanceM: e.distanceM,
    observedMrad: observed[i],
    predictedMrad: pred[i],
    residualMrad: pred[i] - observed[i],
  }));
  const rms = (res) => Math.sqrt(res.reduce((s, x) => s + x.residualMrad ** 2, 0) / res.length);
  const before = rows(beforePred);
  const after = rows(observed.map((o, i) => o + r[i]));
  return {
    muzzleVelocityMs: mv,
    dsf,
    dragModel: usesG1 ? 'G1' : 'G7',
    originalBc,
    bc: originalBc / dsf,
    fittedDrag: withDrag,
    before,
    after,
    rmsBeforeMrad: rms(before),
    rmsAfterMrad: rms(after),
    iterations: Math.min(iterations, 20),
    algorithm: alg,
  };
}
