/**
 * Ballistic Workbench - one firing solution at an exact distance, shared by Field mode, Match and
 * Logbook (the Solver view does the same with its range table).
 */

import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory } from '../physics/solvers.js';

/** Air density, speed of sound and density altitude for an environment. */
export function atmosphereOf(env) {
  return getAtmosphericConditions({
    pressurePa: env.pressureHpa * 100,
    tempK: env.temperatureC + 273.15,
    relativeHumidity: (env.humidityPercent ?? 50) / 100,
    altitudeM: env.altitudeM ?? 0,
  });
}

/**
 * The solution at exactly `distanceM`: the solver's step lands on the distance, so the answer never
 * depends on a table step. Adds elevationClicks / windageClicks from the scope's click value.
 * @returns {object|null} a trajectory row (dropM, elevationRad, windageRad, velocityMs, energyJ, mach, tofS …)
 */
export function solveExact({ profile, env, config = {}, algorithm, distanceM, targetHeightM = 0.5, atmos = null }) {
  if (!(distanceM > 0) || !profile) return null;
  const a = atmos || atmosphereOf(env);
  const sol = solveTrajectory({
    profile,
    environment: env,
    airDensity: a.densityKgM3,
    speedOfSound: a.speedOfSoundMs,
    algorithm,
    stepM: distanceM,
    maxRangeM: distanceM,
    includeSpinDrift: config.includeSpinDrift ?? true,
    includeCoriolis: config.includeCoriolis ?? true,
    includeAerodynamicJump: config.includeAerodynamicJump ?? true,
    targetHeightM,
  });
  const p = sol.trajectory.find((r) => Math.abs(r.distanceM - distanceM) < 1e-6);
  if (!p) return null;
  const clickRad = profile.optic?.clickValueRad > 0 ? profile.optic.clickValueRad : 0.0001;
  return {
    ...p,
    elevationClicks: Math.round(p.elevationRad / clickRad),
    windageClicks: Math.round(p.windageRad / clickRad),
    supersonicRangeM: sol.telemetry.supersonicRangeM,
    transonicRangeM: sol.telemetry.transonicRangeM,
  };
}

/** Clock position (1–12) for a wind direction in degrees (0 = 12 o'clock, 90 = 3 o'clock). */
export function clockOf(deg) {
  const h = Math.round((((deg % 360) + 360) % 360) / 30) % 12;
  return h === 0 ? 12 : h;
}
