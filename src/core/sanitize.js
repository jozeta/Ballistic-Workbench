/**
 * Ballistic Workbench - validation of stored and imported data.
 *
 * Everything that comes from localStorage or an imported JSON file passes through here before it
 * reaches the app state. Each object is rebuilt from a template of known keys: numbers must be
 * finite and are clamped to physically sensible ranges, strings are capped, ids must match a safe
 * pattern, and unknown keys (including "__proto__") are dropped. Bad entries fall back to defaults
 * instead of crashing the app or hanging the solver.
 */

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_TEXT = 200;
const MAX_ITEMS = 500;

/** Numeric ranges per key (SI units). Keys not listed only need to be finite. */
const RANGES = {
  muzzleVelocityMs: [50, 2000],
  powderTempSensitivity: [0, 10],
  powderRefTempC: [-60, 70],
  sightHeightM: [0, 0.5],
  zeroDistanceM: [10, 1000],
  twistRateIn: [3, 40],
  rifleWeightKg: [0.5, 50],
  weightGr: [1, 2000],
  diameterIn: [0.1, 1.0],
  lengthIn: [0.1, 4],
  bcG1: [0.01, 2],
  bcG7: [0.01, 1.5],
  factoryVelocityFps: [100, 6000],
  factoryVelocityMs: [30, 1900],
  clickValueRad: [0.00001, 0.01],
  currentMagnification: [1, 100],
  minMagnification: [1, 100],
  maxMagnification: [1, 100],
  zeroElevationClicks: [-2000, 2000],
  zeroWindageClicks: [-2000, 2000],
  altitudeM: [-500, 9000],
  temperatureC: [-60, 70],
  pressureHpa: [300, 1200],
  humidityPercent: [0, 100],
  windSpeedMs: [0, 60],
  windDirectionDeg: [0, 360],
  directionDeg: [0, 360],
  speedMs: [0, 60],
  startM: [0, 5000],
  endM: [0, 5000],
  inclinationDeg: [-89, 89],
  cantDeg: [-90, 90],
  latitudeDeg: [-90, 90],
  shootingAzimuthDeg: [0, 360],
  distanceM: [10, 5000],
  targetSizeWidthCm: [1, 500],
  targetSizeHeightCm: [1, 500],
  targetSpeedKmh: [0, 100],
  targetDirectionDeg: [0, 360],
  maxRangeM: [100, 3000],
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clampNumber(key, value, fallback) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const range = RANGES[key];
  return range ? Math.min(range[1], Math.max(range[0], n)) : n;
}

function cleanText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  // Drop control characters; cap the length
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT);
}

/**
 * Rebuilds `value` in the shape of `template`. Keys missing from the template are dropped; keys
 * missing from `value` take the template's value. Arrays of objects use the first template item as
 * the shape of every item.
 */
export function shapeLike(value, template) {
  const src = isPlainObject(value) ? value : {};
  const out = {};
  for (const key of Object.keys(template)) {
    const t = template[key];
    const v = Object.prototype.hasOwnProperty.call(src, key) ? src[key] : undefined;
    if (key === 'id') out[key] = typeof v === 'string' && ID_RE.test(v) ? v : t;
    else if (typeof t === 'number') out[key] = clampNumber(key, v, t);
    else if (typeof t === 'string') out[key] = cleanText(v, t);
    else if (typeof t === 'boolean') out[key] = typeof v === 'boolean' ? v : t;
    else if (t === null) out[key] = v === null || v === undefined ? null : clampNumber(key, v, null);
    else if (Array.isArray(t)) {
      out[key] = Array.isArray(v) && t.length > 0 && isPlainObject(t[0])
        ? v.slice(0, MAX_ITEMS).filter(isPlainObject).map((item) => shapeLike(item, t[0]))
        : Array.isArray(v) ? v.slice(0, MAX_ITEMS).filter((x) => typeof x === 'number' && Number.isFinite(x)) : t;
    } else if (isPlainObject(t)) out[key] = shapeLike(v, t);
    else out[key] = t;
  }
  return out;
}

/** Ensures ids are unique within a list (later duplicates get a suffix). */
function uniqueIds(list) {
  const seen = new Set();
  return list.map((item) => {
    let id = item.id;
    for (let n = 2; seen.has(id); n++) id = `${item.id}-${n}`.slice(0, 64);
    seen.add(id);
    return id === item.id ? item : { ...item, id };
  });
}

export function sanitizeProfiles(list, defaults) {
  if (!Array.isArray(list)) return null;
  const template = defaults[0];
  const out = list.slice(0, MAX_ITEMS).filter(isPlainObject).map((p) => {
    const clean = shapeLike(p, template);
    // A missing or bad id must not collide with the template's id
    if (!(typeof p.id === 'string' && ID_RE.test(p.id))) clean.id = `profile-${Math.random().toString(36).slice(2, 10)}`;
    if (!['G1', 'G7'].includes(clean.bullet.dragModel)) clean.bullet.dragModel = 'G7';
    if (!['FFP', 'SFP'].includes(clean.optic.focalPlane)) clean.optic.focalPlane = 'FFP';
    if (!['left', 'right'].includes(clean.twistDirection)) clean.twistDirection = 'right';
    clean.optic.minMagnification = Math.min(clean.optic.minMagnification, clean.optic.maxMagnification);
    clean.optic.currentMagnification = Math.min(clean.optic.maxMagnification, Math.max(clean.optic.minMagnification, clean.optic.currentMagnification));
    return clean;
  });
  return out.length ? uniqueIds(out) : null;
}

export function sanitizeEnvironments(list, defaults) {
  if (!Array.isArray(list)) return null;
  const out = list.slice(0, MAX_ITEMS).filter(isPlainObject).map((e) => {
    const clean = shapeLike(e, defaults[0]);
    if (!(typeof e.id === 'string' && ID_RE.test(e.id))) clean.id = `env-${Math.random().toString(36).slice(2, 10)}`;
    // Older versions saved one full-range zone next to the single wind values and kept it when the
    // wind was edited, so it went stale. One zone says nothing the single values don't: drop it.
    if (clean.windZones.length === 1) clean.windZones = [];
    return clean;
  });
  return out.length ? uniqueIds(out) : null;
}

/** Custom bullets: known string and number fields only, and a name, caliber and BC are required. */
const BULLET_TEXT = ['caliber', 'manufacturer', 'name', 'type', 'velocityRangeFps', 'recommendedTwist'];
const BULLET_NUM = ['weightGr', 'diameterIn', 'lengthIn', 'bcG1', 'bcG7', 'factoryVelocityFps', 'factoryVelocityMs'];

export function sanitizeBullets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const b of list.slice(0, MAX_ITEMS)) {
    if (!isPlainObject(b) || typeof b.id !== 'string' || !ID_RE.test(b.id)) continue;
    const clean = { id: b.id };
    for (const k of BULLET_TEXT) clean[k] = cleanText(b[k], '');
    for (const k of BULLET_NUM) {
      const n = clampNumber(k, b[k], null);
      if (n !== null) clean[k] = n;
    }
    clean.dragModel = b.dragModel === 'G1' ? 'G1' : 'G7';
    if (!clean.name || !(clean.bcG7 || clean.bcG1) || !clean.weightGr) continue;
    if (b.isCustom === true) clean.isCustom = true;
    out.push(clean);
  }
  return uniqueIds(out);
}

const STEPS = [10, 25, 50, 100];
const ALGORITHMS = ['G1', 'G7', 'MPM', '4DOF'];
const SHAPES = ['ipsc', 'circle', 'square', 'nato-e'];

export function sanitizeSolverConfig(value, defaults) {
  const clean = shapeLike(value, defaults);
  if (!STEPS.includes(clean.stepM)) clean.stepM = defaults.stepM;
  if (!ALGORITHMS.includes(clean.activeAlgorithm)) clean.activeAlgorithm = defaults.activeAlgorithm;
  return clean;
}

export function sanitizeTarget(value, defaults) {
  const clean = shapeLike(value, defaults);
  if (!SHAPES.includes(clean.targetShape)) clean.targetShape = defaults.targetShape;
  return clean;
}

/** Imported or stored JSON over this size is refused before parsing. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
