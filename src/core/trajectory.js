/**
 * Ballistic Workbench - trajectory helpers shared by views.
 */

const LINEAR_FIELDS = ['dropM', 'driftM', 'velocityMs', 'mach', 'energyJ', 'tofS', 'dangerSpaceM'];
const RAD_TO_MOA = (180 * 60) / Math.PI;

/**
 * The trajectory point at an exact distance. Drop, drift, speed, energy and time are interpolated
 * between the two table rows around it (they change smoothly with distance). The angles are then
 * computed from drop and drift at that distance, the same way the solver does (−drop ÷ distance,
 * rotated by the cant), instead of being interpolated: an angle interpolated from the 0 m row is
 * badly wrong at short range (e.g. 10 m with a 50 m table step).
 */
export function interpolateAt(trajectory, distanceM, cantDeg = 0) {
  if (!trajectory?.length || !Number.isFinite(distanceM)) return null;
  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  let out;
  if (distanceM <= first.distanceM) out = { ...first };
  else if (distanceM >= last.distanceM) out = { ...last };
  else {
    let i = 0;
    while (i < trajectory.length - 2 && trajectory[i + 1].distanceM < distanceM) i++;
    const p0 = trajectory[i];
    const p1 = trajectory[i + 1];
    const f = (distanceM - p0.distanceM) / Math.max(1e-9, p1.distanceM - p0.distanceM);
    out = { ...p0, distanceM };
    for (const k of LINEAR_FIELDS) {
      if (typeof p0[k] === 'number' && typeof p1[k] === 'number') out[k] = p0[k] + f * (p1[k] - p0[k]);
    }
  }
  if (out.distanceM > 0 && typeof out.dropM === 'number' && typeof out.driftM === 'number') {
    const c = (cantDeg * Math.PI) / 180;
    const u = -out.dropM / out.distanceM;
    const v = -out.driftM / out.distanceM;
    out.elevationRad = u * Math.cos(c) + v * Math.sin(c);
    out.windageRad = -u * Math.sin(c) + v * Math.cos(c);
    out.elevationMrad = out.elevationRad * 1000;
    out.windageMrad = out.windageRad * 1000;
    out.elevationMoa = out.elevationRad * RAD_TO_MOA;
    out.windageMoa = out.windageRad * RAD_TO_MOA;
  }
  return out;
}
