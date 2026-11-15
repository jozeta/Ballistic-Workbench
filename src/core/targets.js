/**
 * Ballistic Workbench - target catalogue shared by the Solver, the reticle view and Tools.
 * Sizes in cm (width × height; a round plate's width is its diameter). The shapes match the hit
 * geometry in src/physics/wez.js isTargetHit(): IPSC = 45 cm body with a 15 cm head over the top
 * 20 %; NATO E-type = 50 cm body with a half-width head over the top 20 %.
 */

export const TARGETS = {
  ipsc: { label: 'IPSC torso', w: 45, h: 75 },
  'nato-e': { label: 'NATO E-type silhouette', w: 50, h: 100 },
  circle: { label: 'Round plate', w: 30, h: 30 },
  square: { label: 'Square plate', w: 30, h: 30 },
};

export const targetOf = (shape) => TARGETS[shape] || TARGETS.ipsc;
