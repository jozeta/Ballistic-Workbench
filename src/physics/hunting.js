/**
 * Ballistic Workbench - hunting helpers
 *
 * - maxPointBlankRange: the zero that keeps the bullet within a vital zone from the muzzle out as far
 *   as possible, so the hunter can hold dead on without dialling. The bullet may rise at most half the
 *   zone above the line of sight (at the top of its path) and the point-blank range ends where it has
 *   fallen half the zone below it.
 * - rangeLimits: the last distance at which the bullet still carries a minimum energy and a minimum
 *   impact velocity (the velocity a hunting bullet needs to expand reliably).
 *
 * Point mass with the bullet's drag table, level, no wind: point-blank range is about holding dead on
 * vertically. SI units throughout.
 */

import { solveTrajectory } from './solvers.js';

/** Distance at which a quantity crosses `level` between two rows (linear interpolation). */
function crossing(a, b, key, level) {
  const f = (level - a[key]) / (b[key] - a[key]);
  return a.distanceM + Math.min(1, Math.max(0, f)) * (b.distanceM - a.distanceM);
}

/**
 * @param {object} args
 * @param {object} args.profile Rifle profile (sight height, bullet, muzzle velocity)
 * @param {object} args.environment Atmosphere (wind, inclination and cant are ignored)
 * @param {number} args.airDensity kg/m³
 * @param {number} args.speedOfSound m/s
 * @param {number} args.vitalZoneM Diameter of the vital zone (m), e.g. 0.20
 * @param {string} [args.algorithm] 'G1' | 'G7' (MPM is solved as point mass with the bullet's table)
 * @param {number} [args.maxRangeM] Furthest distance searched (m)
 * @returns {null | { boreAngleRad, nearM, farZeroM, apexM, mpbrM, mpbrBeyond, heightAt100M, maxRangeM }}
 *   nearM: where the bullet first enters the zone (0 when the sight height is inside it);
 *   farZeroM: the zero distance to set; apexM: top of the path (+half the zone);
 *   mpbrM: maximum point-blank range (null with mpbrBeyond when it is beyond maxRangeM);
 *   heightAt100M: how high the rifle shoots at 100 m with this zero (m, + is high).
 */
export function maxPointBlankRange({ profile, environment, airDensity, speedOfSound, vitalZoneM, algorithm = null, maxRangeM = 800 }) {
  if (!(vitalZoneM > 0) || !profile?.bullet) return null;
  const half = vitalZoneM / 2;
  const alg = algorithm === 'G1' || algorithm === 'G7' ? algorithm : profile.bullet.dragModel === 'G1' ? 'G1' : 'G7';
  const env = { ...environment, windSpeedMs: 0, windZones: [], inclinationDeg: 0, cantDeg: 0 };
  const path = (theta, stepM = 2) => solveTrajectory({
    profile: { ...profile, zeroAngleRad: theta },
    environment: env,
    airDensity,
    speedOfSound,
    algorithm: alg,
    stepM,
    maxRangeM,
    includeSpinDrift: false,
    includeCoriolis: false,
    includeAerodynamicJump: false,
  }).trajectory;
  const apex = (rows) => rows.reduce((best, r) => (r.distanceM > 0 && r.dropM > best.dropM ? r : best), { dropM: -Infinity });

  // The height of the top of the path rises steadily with the bore angle: bisect for +half
  let lo = 0;
  let hi = 0.02;
  if (apex(path(hi)).dropM < half) return null; // cannot even reach the zone (absurd inputs)
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (apex(path(mid)).dropM > half) hi = mid;
    else lo = mid;
  }
  const theta = (lo + hi) / 2;
  const rows = path(theta, 1);
  const top = apex(rows);

  let nearM = rows[0].dropM >= -half ? 0 : null;
  let farZeroM = null;
  let mpbrM = null;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (nearM === null && a.dropM < -half && b.dropM >= -half) nearM = crossing(a, b, 'dropM', -half);
    if (b.distanceM > top.distanceM) {
      if (farZeroM === null && a.dropM >= 0 && b.dropM < 0) farZeroM = crossing(a, b, 'dropM', 0);
      if (a.dropM >= -half && b.dropM < -half) {
        mpbrM = crossing(a, b, 'dropM', -half);
        break;
      }
    }
  }
  const at100 = rows.find((r) => Math.abs(r.distanceM - 100) < 0.51);
  return {
    boreAngleRad: theta,
    nearM: nearM ?? 0,
    farZeroM,
    apexM: top.distanceM,
    mpbrM,
    mpbrBeyond: mpbrM === null,
    heightAt100M: at100 ? at100.dropM : null,
    maxRangeM,
  };
}

/**
 * The last distances where the bullet still has minEnergyJ and minVelocityMs. A limit is null when
 * the bullet keeps the minimum to the end of the trajectory (it is beyond the table), and 0 when it
 * never has it.
 * @returns {{ energyLimitM, velocityLimitM, limitM, limitedBy: 'energy'|'velocity'|null, beyond: boolean }}
 */
export function rangeLimits(trajectory, { minEnergyJ = 0, minVelocityMs = 0 } = {}) {
  const limit = (key, min) => {
    if (!(min > 0) || !trajectory?.length) return null;
    if (trajectory[0][key] < min) return 0;
    for (let i = 1; i < trajectory.length; i++) {
      if (trajectory[i][key] < min) return crossing(trajectory[i - 1], trajectory[i], key, min);
    }
    return null;
  };
  const energyLimitM = limit('energyJ', minEnergyJ);
  const velocityLimitM = limit('velocityMs', minVelocityMs);
  let limitM = null;
  let limitedBy = null;
  if (energyLimitM !== null && (velocityLimitM === null || energyLimitM <= velocityLimitM)) {
    limitM = energyLimitM;
    limitedBy = 'energy';
  } else if (velocityLimitM !== null) {
    limitM = velocityLimitM;
    limitedBy = 'velocity';
  }
  return { energyLimitM, velocityLimitM, limitM, limitedBy, beyond: limitM === null };
}
