/**
 * Ballistic Workbench - trajectory helpers shared by views.
 */

const LINEAR_FIELDS = [
  'dropM', 'elevationRad', 'elevationMrad', 'elevationMoa', 'elevationClicks', 'driftM', 'windageRad', 'windageMrad',
  'windageMoa', 'windageClicks', 'velocityMs', 'mach', 'energyJ', 'tofS', 'dangerSpaceM',
];

/**
 * The trajectory point at an exact distance, linearly interpolated between the two table rows
 * around it (the table is solved every few metres, the target can be anywhere). Clicks are
 * recomputed by the caller from the interpolated angle; here they are rounded.
 */
export function interpolateAt(trajectory, distanceM) {
  if (!trajectory?.length) return null;
  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  if (distanceM <= first.distanceM) return { ...first };
  if (distanceM >= last.distanceM) return { ...last };
  let i = 0;
  while (i < trajectory.length - 2 && trajectory[i + 1].distanceM < distanceM) i++;
  const p0 = trajectory[i];
  const p1 = trajectory[i + 1];
  const f = (distanceM - p0.distanceM) / Math.max(1e-9, p1.distanceM - p0.distanceM);
  const out = { ...p0, distanceM };
  for (const k of LINEAR_FIELDS) {
    if (typeof p0[k] === 'number' && typeof p1[k] === 'number') out[k] = p0[k] + f * (p1[k] - p0[k]);
  }
  return out;
}
