/**
 * Ballistic Workbench - Tools view.
 * Six small calculators, each with a clear input -> result flow:
 * 1. True your data (muzzle velocity from a mid-range elevation, then drag from a long-range one)
 * 2. Hit probability (Monte Carlo simulation of the error sources, src/physics/wez.js)
 * 3. Group analysis (photo or manual shots: extreme spread, mean radius, SD, dispersion ellipse)
 * 4. Chronograph statistics (average, SD, ES)
 * 5. Range estimation (distance from a known size and its size in the reticle)
 * 6. Free recoil energy and velocity
 *
 * Physics runs in SI. Inputs and results follow the unit settings (appState.state.systemUnits and
 * displayUnits). Every string from the user, storage or imports goes through esc().
 */

import { appState } from '../core/state.js';
import { UnitConverter, CONVERSIONS } from '../core/units.js';
import { esc } from '../core/escape.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { trueMuzzleVelocity, trueDropScaleFactor } from '../physics/truing.js';
import { runWezSimulation } from '../physics/wez.js';
import { solveTrajectory } from '../physics/solvers.js';
import { interpolateAt } from '../core/trajectory.js';
import { icon } from './icons.js';
import { bindNumber, parseNumber } from './fields.js';
import { toast } from './notify.js';

const TOOLS = [
  { id: 'truing', label: 'True your data', icon: 'turret' },
  { id: 'wez', label: 'Hit probability', icon: 'dice' },
  { id: 'group', label: 'Group analysis', icon: 'group' },
  { id: 'chrono', label: 'Chronograph', icon: 'chrono' },
  { id: 'milling', label: 'Range estimation', icon: 'ranging' },
  { id: 'recoil', label: 'Recoil', icon: 'recoil' },
];

/** Group canvas: logical size in CSS pixels (the bitmap is scaled by devicePixelRatio). */
const GW = 520;
const SAMPLE_SHOTS = [
  { x: 0, y: 0 },
  { x: 8, y: -6 },
  { x: -5, y: 10 },
  { x: -12, y: -4 },
  { x: 6, y: 12 },
];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const WEZ_TARGETS = {
  ipsc: { label: 'IPSC target', w: 45, h: 75 },
  circle: { label: 'Round plate', w: 30, h: 30 },
  square: { label: 'Square plate', w: 30, h: 30 },
  'nato-e': { label: 'NATO E-type', w: 50, h: 100 },
};

const RANGE_PRESETS = [
  { id: 'ipsc-w', label: 'IPSC target, width', cm: 45 },
  { id: 'ipsc-h', label: 'IPSC target, height', cm: 75 },
  { id: 'nato-e', label: 'NATO E-type, height', cm: 100 },
  { id: 'plate', label: 'Steel plate', cm: 30 },
  { id: 'wheel', label: 'Car wheel', cm: 70 },
];

const CALIBERS = [
  { mm: 5.7, label: '.224 / 5.56 mm' },
  { mm: 6.2, label: '.243 / 6 mm' },
  { mm: 6.7, label: '.264 / 6.5 mm' },
  { mm: 7.8, label: '.308 / 7.62 mm' },
  { mm: 8.6, label: '.338 / 8.6 mm' },
  { mm: 9.0, label: '9 mm Luger' },
];

const SENSITIVITY_TEXT = {
  Wind: { name: 'Wind reading', advice: 'Better wind calls or shooting in lulls would help most.' },
  Ammo: { name: 'Muzzle velocity variation', advice: 'More consistent ammunition (lower MV SD) would help most.' },
  Precision: { name: 'Rifle and shooter precision', advice: 'A steadier position or a more precise rifle would help most.' },
  Ranging: { name: 'Distance error', advice: 'A more accurate distance reading would help most.' },
};

// ---- small helpers -------------------------------------------------------------------------

const UNIT_LABELS = { 'ft-lb': 'ft·lb' };
const unitLabel = (u) => UNIT_LABELS[u] || u;
const fixed = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '–');
const DECIMALS = { m: 0, yd: 0, 'm/s': 1, fps: 0, MRAD: 2, MOA: 2, cm: 1, in: 2, mm: 0, kg: 2, lb: 1, mph: 1, 'km/h': 1, knots: 1, J: 1, 'ft-lb': 1 };
const toUnit = (si, unit) => (unit ? UnitConverter.fromSI(si, unit) : si);
const fromUnit = (v, unit) => (unit ? UnitConverter.toSI(v, unit) : v);
/** A value in SI formatted in a display unit, e.g. fmtU(825, 'fps') -> "2707 fps". */
const fmtU = (si, unit, dec = DECIMALS[unit] ?? 1) => `${fixed(toUnit(si, unit), dec)} ${unitLabel(unit)}`;
const signed = (n, d) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`;
const grouped = (n) => Math.round(n).toLocaleString('en-US');

/** The display units the Tools view uses, from the unit settings. */
function units() {
  const s = appState.state;
  const d = s.displayUnits || {};
  const imp = s.systemUnits === 'imperial';
  return {
    imp,
    dist: d.distance === 'yd' ? 'yd' : 'm',
    ang: d.elevationAngle === 'MOA' ? 'MOA' : 'MRAD',
    vel: d.velocity === 'fps' ? 'fps' : 'm/s',
    wind: ['m/s', 'mph', 'km/h', 'knots'].includes(d.windSpeed) ? d.windSpeed : imp ? 'mph' : 'm/s',
    size: imp ? 'in' : 'cm',
    energy: d.energy === 'ft-lb' ? 'ft-lb' : 'J',
    mass: imp ? 'lb' : 'kg',
  };
}

/** Angle subtended by a linear size at a distance (radians). */
const subtends = (sizeM, distM) => Math.atan2(sizeM, distM);

/** Current atmosphere for the active environment. */
function atmosphere(env) {
  return getAtmosphericConditions({
    pressurePa: env.pressureHpa * 100,
    tempK: env.temperatureC + 273.15,
    relativeHumidity: env.humidityPercent / 100,
    altitudeM: env.altitudeM,
  });
}

/** Colours for canvases, read from the Låda Glass tokens so both themes work. */
function themeColors() {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  const g = (name, fallback) => (cs?.getPropertyValue(name).trim()) || fallback;
  return {
    text: g('--lg-text', 'white'),
    muted: g('--lg-muted', 'gray'),
    line: g('--lg-line', 'rgba(128,128,128,.25)'),
    line2: g('--lg-line-2', 'rgba(128,128,128,.4)'),
    accent: g('--lg-accent', 'steelblue'),
    accent2: g('--lg-accent-2', 'orchid'),
    ok: g('--lg-ok', 'seagreen'),
    warn: g('--lg-warn', 'orange'),
    bad: g('--lg-bad', 'crimson'),
    bg: g('--lg-elevated', 'black'),
  };
}

function toneBadge(tone, text) {
  return `<span class="lg-badge lg-badge-${tone}">${esc(text)}</span>`;
}

export class ToolsView {
  constructor(containerElement) {
    this.container = containerElement;
    this.activeTool = 'truing';
    this.wezData = null;

    const u = appState.state;
    const profile = appState.getActiveProfile();

    // Input values per tool, kept in SI so they survive tool switches and unit changes
    this.values = {
      // Elevations start at the model's own prediction (filled in on first render)
      truing: { mvDistM: 600, mvElevRad: null, dsfDistM: 1050, dsfElevRad: null },
      wez: {
        distM: u.target?.distanceM || 600,
        shape: WEZ_TARGETS[u.target?.targetShape] ? u.target.targetShape : 'ipsc',
        shots: 1000,
        mvSdMs: 3,
        rangeSdM: 5,
        windSdMs: 1,
        dirSdDeg: 12,
        precisionRad: 0.5 * CONVERSIONS.MOA,
      },
      chrono: { text: '825.4 827.1 824.8 826.5 825.9 824.2 827.8 825.0 826.2 825.8', unit: null },
      milling: { preset: 'ipsc-w', sizeM: 0.45, angleRad: 0.00075 },
      recoil: this._recoilDefaults(profile),
    };
    this.results = { mv: null, dsf: null, chrono: null };

    // Group analysis state. Shots and the aim point are in mm from the canvas centre ("sheet"
    // coordinates, right and up positive); statistics are measured from the aim point.
    this.groupShots = SAMPLE_SHOTS.map((s) => ({ ...s }));
    this.aimPointMm = { x: 0, y: 0 };
    this.targetGridScale = 5.0; // canvas px per mm (the canvas shows about 10 cm)
    this.selectedCaliberMm = 6.7;
    this.cvSensitivity = 55;
    this.targetImage = null;
    this.isCalibratingScale = false;
    this.scaleCalibPoints = [];
    this.scaleRefLengthMm = 25.4;
    this.groupDistM = 100;

    this._onResize = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        if (this.activeTool === 'wez' && this.wezData) this.drawWezDispersion(this.wezData, this._wezTarget);
        if (this.activeTool === 'group') this._drawGroup();
      }, 120);
    };
    window.addEventListener('resize', this._onResize);

    this.unsubscribe = appState.subscribe((state, key) => {
      if (key === 'profile' && this._ownChange) {
        this._ownChange = false;
        return;
      }
      if (['activeProfile', 'profiles', 'import'].includes(key)) {
        this.values.recoil = this._recoilDefaults(appState.getActiveProfile());
        this.values.truing.mvElevRad = null;
        this.values.truing.dsfElevRad = null;
        this.results = { mv: null, dsf: null, chrono: this.results.chrono };
      }
      if (key === 'units') this.values.chrono.unit = null;
      if (['units', 'displayUnits', 'profile', 'profiles', 'activeProfile', 'environment', 'activeEnvironment', 'import'].includes(key)) {
        this.render();
      }
    });

    this.render();
  }

  /** Full rebuild (after a theme change): canvases redraw with the new colours. */
  refresh() {
    this.render();
  }

  destroy() {
    this.unsubscribe?.();
    window.removeEventListener('resize', this._onResize);
    clearTimeout(this._resizeTimer);
    clearTimeout(this._lpTimer);
  }

  setTool(toolId) {
    if (!TOOLS.some((t) => t.id === toolId)) return;
    this.activeTool = toolId;
    this.render();
  }

  _recoilDefaults(profile) {
    return {
      rifleKg: profile?.rifleWeightKg > 0 ? profile.rifleWeightKg : 6.8,
      bulletGr: profile?.bullet?.weightGr > 0 ? profile.bullet.weightGr : 140,
      powderGr: 41.5,
      mvMs: profile?.muzzleVelocityMs > 0 ? profile.muzzleVelocityMs : 825,
    };
  }

  // ---- shared building blocks -----------------------------------------------------------------

  /**
   * A validated number field. `si` is the value in SI (or raw when unit is null); min/max are in
   * SI too and are converted to the display unit. `set(valueSI)` runs for valid values only.
   */
  _numField({ id, label, unit = null, si, min, max, dec, step, hint = '', set, live = false, unitText }) {
    this.fieldDefs ||= new Map();
    const d = dec ?? DECIMALS[unit] ?? 1;
    const p = 10 ** d;
    const lo = Math.floor(toUnit(min, unit) * p) / p;
    const hi = Math.ceil(toUnit(max, unit) * p) / p;
    const value = Number(toUnit(si, unit).toFixed(d));
    this.fieldDefs.set(id, { unit, set, live });
    const u = unitText ?? (unit ? unitLabel(unit) : '');
    return `
      <div class="field-row">
        <label class="field-label" for="${id}">${esc(label)}${u ? ` (${esc(u)})` : ''}</label>
        <input type="text" inputmode="decimal" autocomplete="off" id="${id}" class="form-input" min="${lo}" max="${hi}" ${step ? `step="${step}"` : ''} value="${value}"${hint ? ` aria-describedby="${id}-hint"` : ''} />
        ${hint ? `<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
      </div>`;
  }

  _bindFields() {
    for (const [id, def] of this.fieldDefs || []) {
      const input = this.container.querySelector(`#${id}`);
      bindNumber(input, (v) => def.set(fromUnit(v, def.unit)), def.live ? 'input' : 'change');
      if (def.live) {
        // Also validate on change, so an invalid value left in the field keeps its message
        bindNumber(input, () => {}, 'change');
      }
    }
  }

  _context(items) {
    return `<p class="tool-context">${items.map((t) => `<span>${t}</span>`).join('')}</p>`;
  }

  _intro(tool, title, desc) {
    return `
      <div class="tool-intro">
        <h2 id="tool-title">${icon(tool.icon)} ${esc(title)}</h2>
        <p>${desc}</p>
      </div>`;
  }

  // ---- 1. True your data ------------------------------------------------------------------------

  renderTruingWizard() {
    const u = units();
    const v = this.values.truing;
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const model = profile.bullet?.dragModel === 'G1' ? 'G1' : 'G7';
    const bc = model === 'G1' ? profile.bullet?.bcG1 : profile.bullet?.bcG7;
    const band = (m) => Math.round(toUnit(m, u.dist) / 25) * 25;
    const odd = !['G1', 'G7'].includes(profile.bullet?.dragModel);
    const start = (distM) => {
      const rad = this._predictElevRad(distM);
      return Number.isFinite(rad) && rad > 0 ? Math.round(rad * 10000) / 10000 : 0.004;
    };
    if (v.mvElevRad == null) v.mvElevRad = start(v.mvDistM);
    if (v.dsfElevRad == null) v.dsfElevRad = start(v.dsfDistM);

    return `
      ${this._intro(TOOLS[0], 'True your data', 'Match the model to your real drops: first true the muzzle velocity, then the drag at long range.')}
      ${this._context([
        `${icon('rifle')} <strong>${esc(profile.name)}</strong>`,
        `MV ${fmtU(profile.muzzleVelocityMs, u.vel)}`,
        `BC ${model} ${fixed(bc, 3)}`,
        `Zero ${fmtU(profile.zeroDistanceM, u.dist)}`,
        `${icon('thermometer')} ${esc(env.name || 'Current atmosphere')}`,
      ])}
      <div class="truing-steps">
        <section class="panel truing-step" aria-labelledby="truing-mv-title">
          <div class="panel-header"><h3 id="truing-mv-title"><span class="step-num" aria-hidden="true">1</span> True muzzle velocity (${band(500)}–${band(800)} ${u.dist})</h3></div>
          <div class="panel-body">
            <p class="step-desc">Shoot at a known distance and enter the elevation that centred your group.</p>
            <div class="field-grid-2">
              ${this._numField({ id: 'true-mv-dist', label: 'Distance', unit: u.dist, si: v.mvDistM, min: 200, max: 1200, set: (x) => { v.mvDistM = x; this._updatePrediction('true-mv-dial', x); } })}
              ${this._numField({ id: 'true-mv-dial', label: 'Elevation that hit', unit: u.ang, si: v.mvElevRad, min: 0.0001, max: 0.03, step: u.ang === 'MRAD' ? 0.1 : 0.25, set: (x) => (v.mvElevRad = x), hint: this._predictionText(v.mvDistM) })}
            </div>
            <button type="button" id="btn-calc-trued-mv" class="btn-primary">${icon('refresh')} Calculate muzzle velocity</button>
            <div id="trued-mv-result" class="truing-output" aria-live="polite">${this._mvResultHtml()}</div>
          </div>
        </section>

        <section class="panel truing-step" aria-labelledby="truing-dsf-title">
          <div class="panel-header"><h3 id="truing-dsf-title"><span class="step-num" aria-hidden="true">2</span> True drag at long range (${grouped(band(1000))} ${u.dist}+)</h3></div>
          <div class="panel-body">
            <p class="step-desc">After step 1, shoot where the bullet slows towards the speed of sound and enter the elevation that hit. This adjusts the BC.</p>
            <div class="field-grid-2">
              ${this._numField({ id: 'true-dsf-dist', label: 'Distance', unit: u.dist, si: v.dsfDistM, min: 600, max: 2500, set: (x) => { v.dsfDistM = x; this._updatePrediction('true-dsf-dial', x); } })}
              ${this._numField({ id: 'true-dsf-dial', label: 'Elevation that hit', unit: u.ang, si: v.dsfElevRad, min: 0.001, max: 0.06, step: u.ang === 'MRAD' ? 0.1 : 0.25, set: (x) => (v.dsfElevRad = x), hint: this._predictionText(v.dsfDistM) })}
            </div>
            ${odd ? `<p class="field-hint">${icon('info')} This rifle uses the ${esc(profile.bullet?.dragModel)} drag model. Truing adjusts its G7 BC.</p>` : ''}
            <button type="button" id="btn-calc-trued-dsf" class="btn-primary">${icon('refresh')} Calculate drag</button>
            <div id="trued-dsf-result" class="truing-output" aria-live="polite">${this._dsfResultHtml()}</div>
          </div>
        </section>
      </div>
      <p class="tool-footnote">${icon('info')} Elevation is what you dialled or held above your zero. Both steps use the atmosphere and zero from the Solver.</p>`;
  }

  /** The elevation the current model predicts at a distance (radians), for comparison. */
  _predictElevRad(distM) {
    try {
      const profile = appState.getActiveProfile();
      const env = appState.getActiveEnvironment();
      const a = atmosphere(env);
      const sol = solveTrajectory({
        profile,
        environment: env,
        airDensity: a.densityKgM3,
        speedOfSound: a.speedOfSoundMs,
        algorithm: profile.bullet?.dragModel === 'G1' ? 'G1' : 'G7',
        stepM: 10,
        maxRangeM: distM + 20,
      });
      const p = interpolateAt(sol.trajectory, distM);
      return p ? p.elevationMrad / 1000 : NaN;
    } catch {
      return NaN;
    }
  }

  _predictionText(distM) {
    const u = units();
    const rad = this._predictElevRad(distM);
    return Number.isFinite(rad) ? `The model now predicts ${fmtU(rad, u.ang)} at ${fmtU(distM, u.dist)}.` : '';
  }

  _updatePrediction(id, distM) {
    const el = this.container.querySelector(`#${id}-hint`);
    if (el) el.textContent = this._predictionText(distM);
  }

  _mvResultHtml() {
    const r = this.results.mv;
    if (!r) return '';
    const u = units();
    const name = esc(appState.getActiveProfile().name);
    const delta = r.calibratedMv - r.originalMv;
    const big = Math.abs(delta) > 60;
    const tone = !r.converged || big ? 'warn' : 'ok';
    const note = !r.converged
      ? 'The model could not match this elevation exactly. Check the distance and the elevation, then try again.'
      : big
        ? 'That is a big change. Check the distance, the elevation and your zero before you apply it.'
        : 'Apply it, then check the new elevation at your next distance.';
    return `
      <div class="tool-verdict tone-${tone}">
        <span class="verdict-label">Trued muzzle velocity</span>
        <span class="verdict-value">${fmtU(r.calibratedMv, u.vel)}</span>
        <span class="verdict-text">Muzzle velocity ${fixed(toUnit(r.originalMv, u.vel), DECIMALS[u.vel])} → ${fmtU(r.calibratedMv, u.vel)} (${signed(toUnit(delta, u.vel), DECIMALS[u.vel])} ${unitLabel(u.vel)})</span>
        <span class="verdict-note">${note}</span>
      </div>
      ${r.applied
        ? `<p class="applied-note">${icon('check-circle')} Applied to ${name}</p>`
        : `<button type="button" id="btn-apply-trued-mv" class="btn-secondary-sm">${icon('check')} Apply to ${name}</button>`}`;
  }

  _dsfResultHtml() {
    const r = this.results.dsf;
    if (!r) return '';
    const name = esc(appState.getActiveProfile().name);
    const pct = (r.dsf - 1) * 100;
    const tone = !r.converged || Math.abs(pct) > 25 ? 'warn' : 'ok';
    const what = Math.abs(pct) < 0.5
      ? 'Drag matches the BC.'
      : `Drag is ${fixed(Math.abs(pct), 1)}% ${pct > 0 ? 'higher' : 'lower'} than the BC predicts.`;
    const note = !r.converged
      ? 'The model could not match this elevation within the allowed range (drag factor 0.6–1.5). Check the distance and true the muzzle velocity first.'
      : 'Applying changes the BC so the model matches your elevation at this distance.';
    return `
      <div class="tool-verdict tone-${tone}">
        <span class="verdict-label">Drag factor</span>
        <span class="verdict-value">${fixed(r.dsf, 3)}</span>
        <span class="verdict-text">${what} BC (${r.model}) ${fixed(r.oldBc, 3)} → ${fixed(r.newBc, 3)}</span>
        <span class="verdict-note">${note}</span>
      </div>
      ${r.applied
        ? `<p class="applied-note">${icon('check-circle')} Applied to ${name}</p>`
        : `<button type="button" id="btn-apply-trued-dsf" class="btn-secondary-sm">${icon('check')} Apply BC to ${name}</button>`}`;
  }

  _initTruing() {
    const q = (s) => this.container.querySelector(s);
    const solveInputs = () => {
      const profile = appState.getActiveProfile();
      const env = appState.getActiveEnvironment();
      const atmos = atmosphere(env);
      return { profile, environment: env, airDensity: atmos.densityKgM3, speedOfSound: atmos.speedOfSoundMs };
    };
    const valid = (...ids) => ids.every((id) => q(id)?.getAttribute('aria-invalid') !== 'true');

    q('#btn-calc-trued-mv')?.addEventListener('click', () => {
      if (!valid('#true-mv-dist', '#true-mv-dial')) return toast('Check the highlighted fields', 'bad');
      const v = this.values.truing;
      const base = solveInputs();
      const res = trueMuzzleVelocity({ ...base, observedDistanceM: v.mvDistM, observedDropMrad: v.mvElevRad * 1000 });
      this.results.mv = {
        originalMv: Number.isFinite(res.originalMv) ? res.originalMv : base.profile.muzzleVelocityMs,
        calibratedMv: res.calibratedMv,
        converged: res.converged !== false,
        applied: false,
      };
      this._updateTruingResults();
    });

    q('#btn-calc-trued-dsf')?.addEventListener('click', () => {
      if (!valid('#true-dsf-dist', '#true-dsf-dial')) return toast('Check the highlighted fields', 'bad');
      const v = this.values.truing;
      const base = solveInputs();
      const res = trueDropScaleFactor({ ...base, observedDistanceM: v.dsfDistM, observedDropMrad: v.dsfElevRad * 1000 });
      const model = base.profile.bullet?.dragModel === 'G1' ? 'G1' : 'G7';
      const oldBc = model === 'G1' ? base.profile.bullet.bcG1 : base.profile.bullet.bcG7;
      const dsf = res.calibratedDsf;
      // truing.js scales drag by the factor, which is the same as dividing the BC by it
      this.results.dsf = { dsf, model, oldBc, newBc: oldBc / dsf, converged: res.converged !== false, applied: false };
      this._updateTruingResults();
    });
  }

  _updateTruingResults() {
    const mv = this.container.querySelector('#trued-mv-result');
    const dsf = this.container.querySelector('#trued-dsf-result');
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    if (mv) mv.innerHTML = this._mvResultHtml();
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    if (dsf) dsf.innerHTML = this._dsfResultHtml();
    const u = units();

    this.container.querySelector('#btn-apply-trued-mv')?.addEventListener('click', () => {
      const r = this.results.mv;
      const name = appState.getActiveProfile().name;
      this._ownChange = true;
      appState.updateActiveProfile({ muzzleVelocityMs: r.calibratedMv, zeroAngleRad: null });
      r.applied = true;
      toast('Muzzle velocity updated', 'ok', `${name}: ${fixed(toUnit(r.originalMv, u.vel), DECIMALS[u.vel])} → ${fmtU(r.calibratedMv, u.vel)}`);
      this.render();
    });

    this.container.querySelector('#btn-apply-trued-dsf')?.addEventListener('click', () => {
      const r = this.results.dsf;
      const profile = appState.getActiveProfile();
      const key = r.model === 'G1' ? 'bcG1' : 'bcG7';
      this._ownChange = true;
      appState.updateActiveProfile({ bullet: { ...profile.bullet, [key]: Number(r.newBc.toFixed(4)) }, zeroAngleRad: null });
      r.applied = true;
      toast('BC updated', 'ok', `${profile.name}: BC (${r.model}) ${fixed(r.oldBc, 3)} → ${fixed(r.newBc, 3)}`);
      this.render();
    });
  }

  // ---- 2. Hit probability -----------------------------------------------------------------------

  renderWez() {
    const u = units();
    const v = this.values.wez;
    const env = appState.getActiveEnvironment();
    const sizeTxt = (cm) => fixed(toUnit(cm / 100, u.size), u.imp ? 1 : 0);
    const shapeOpt = (key) => {
      const t = WEZ_TARGETS[key];
      const dims = key === 'circle' ? `${sizeTxt(t.w)} ${u.size}` : `${sizeTxt(t.w)} × ${sizeTxt(t.h)} ${u.size}`;
      return `<option value="${key}" ${v.shape === key ? 'selected' : ''}>${t.label} (${dims})</option>`;
    };
    const ring = u.imp ? '5 in' : '10 cm';

    return `
      ${this._intro(TOOLS[1], 'Hit probability', `Simulates ${grouped(v.shots)} shots with your error sources to estimate how often you hit.`)}
      ${this._context([
        `${icon('rifle')} <strong>${esc(appState.getActiveProfile().name)}</strong>`,
        `${icon('wind')} Wind from the Solver: ${fmtU(env.windSpeedMs || 0, u.wind)} at ${fixed(env.windDirectionDeg || 0, 0)}°`,
      ])}
      <div class="tool-layout">
        <section class="panel tool-inputs" aria-labelledby="wez-setup-title">
          <div class="panel-header"><h3 id="wez-setup-title">Target and error sources</h3></div>
          <div class="panel-body">
            <div class="field-row">
              <label class="field-label" for="wez-shape">Target</label>
              <select id="wez-shape" class="form-select">${Object.keys(WEZ_TARGETS).map(shapeOpt).join('')}</select>
            </div>
            <div class="field-grid-2">
              ${this._numField({ id: 'wez-dist', label: 'Distance', unit: u.dist, si: v.distM, min: 50, max: 2500, set: (x) => { v.distM = x; this.runWez(); } })}
              <div class="field-row">
                <label class="field-label" for="wez-shots">Simulated shots</label>
                <select id="wez-shots" class="form-select">
                  ${[500, 1000, 2000].map((n) => `<option value="${n}" ${v.shots === n ? 'selected' : ''}>${grouped(n)}</option>`).join('')}
                </select>
              </div>
            </div>
            <h4 class="sub-heading">Error sources (1 SD)</h4>
            <p class="field-hint sub-hint">One standard deviation: about two out of three shots fall within this much of the average.</p>
            <div class="field-grid-2">
              ${this._numField({ id: 'wez-mv-sd', label: 'Muzzle velocity SD', unit: u.vel, si: v.mvSdMs, min: 0, max: 30, set: (x) => { v.mvSdMs = x; this.runWez(); } })}
              ${this._numField({ id: 'wez-range-sd', label: 'Distance error', unit: u.dist, si: v.rangeSdM, min: 0, max: 50, dec: 1, set: (x) => { v.rangeSdM = x; this.runWez(); } })}
              ${this._numField({ id: 'wez-wind-sd', label: 'Wind speed error', unit: u.wind, si: v.windSdMs, min: 0, max: 10, set: (x) => { v.windSdMs = x; this.runWez(); } })}
              ${this._numField({ id: 'wez-dir-sd', label: 'Wind direction error', unitText: '°', si: v.dirSdDeg, min: 0, max: 90, dec: 0, set: (x) => { v.dirSdDeg = x; this.runWez(); } })}
            </div>
            ${this._numField({ id: 'wez-shooter-moa', label: 'Rifle and shooter precision', unitText: `1 SD, ${u.ang}`, unit: u.ang, si: v.precisionRad, min: 0.00001, max: 0.003, set: (x) => { v.precisionRad = x; this.runWez(); }, hint: 'How much your shots spread around the aim point on a calm day, in each direction. 0.5 MOA (0.15 MRAD) is a good precision rifle and shooter.' })}
            <button type="button" id="btn-run-wez" class="btn-primary btn-block">${icon('dice')} Simulate again</button>
          </div>
        </section>

        <section class="panel tool-results" aria-labelledby="wez-result-title">
          <div class="panel-header"><h3 id="wez-result-title">Result</h3></div>
          <div class="panel-body">
            <div id="wez-metrics-container" aria-live="polite"></div>
            <figure class="wez-figure">
              <canvas id="wez-canvas" role="img" aria-label="Simulated impacts on the target"></canvas>
              <figcaption class="wez-canvas-legend">
                <span class="legend-item"><span class="legend-dot dot-hit"></span>Hit</span>
                <span class="legend-item"><span class="legend-dot dot-miss"></span>Miss</span>
                <span class="legend-item"><span class="legend-ring ring-cep"></span>Half of shots</span>
                <span class="legend-item"><span class="legend-ring ring-r95"></span>95% of shots</span>
                <span class="legend-item legend-scale">Rings every ${ring}</span>
              </figcaption>
            </figure>
            <div id="wez-sensitivity-container" class="wez-sensitivity"></div>
          </div>
        </section>
      </div>`;
  }

  initWez() {
    const q = (s) => this.container.querySelector(s);
    const v = this.values.wez;
    q('#btn-run-wez')?.addEventListener('click', () => this.runWez());
    q('#wez-shape')?.addEventListener('change', (e) => {
      v.shape = WEZ_TARGETS[e.target.value] ? e.target.value : 'ipsc';
      this.runWez();
    });
    q('#wez-shots')?.addEventListener('change', (e) => {
      v.shots = [500, 1000, 2000].includes(Number(e.target.value)) ? Number(e.target.value) : 1000;
      const p = this.container.querySelector('.tool-intro p');
      if (p) p.textContent = `Simulates ${grouped(v.shots)} shots with your error sources to estimate how often you hit.`;
      this.runWez();
    });
    this.runWez();
  }

  runWez() {
    const canvas = this.container.querySelector('#wez-canvas');
    if (!canvas) return;
    const v = this.values.wez;
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const atmos = atmosphere(env);
    const t = WEZ_TARGETS[v.shape] || WEZ_TARGETS.ipsc;
    const target = { distanceM: v.distM, targetShape: v.shape, targetSizeWidthCm: t.w, targetSizeHeightCm: t.h };

    let result;
    try {
      result = runWezSimulation({
        profile,
        environment: env,
        airDensity: atmos.densityKgM3,
        speedOfSound: atmos.speedOfSoundMs,
        target,
        numShots: v.shots,
        uncertainties: {
          mvSdMs: v.mvSdMs,
          rangeSdM: v.rangeSdM,
          windSpeedSdMs: v.windSdMs,
          windDirSdDeg: v.dirSdDeg,
          shooterPrecisionRad: v.precisionRad,
        },
      });
    } catch (err) {
      console.error('Hit probability simulation failed', err);
      toast('Could not run the simulation', 'bad', 'Check the distance and the rifle settings.');
      return;
    }

    this.wezData = result;
    this._wezTarget = target;
    this.drawWezDispersion(result, target);
    this.renderWezMetrics(result);
  }

  drawWezDispersion(res, target) {
    const canvas = this.container.querySelector('#wez-canvas');
    if (!canvas || !res) return;
    const ctx = canvas.getContext('2d');
    const c = themeColors();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(240, Math.floor(canvas.clientWidth || 420));
    const h = w;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);

    const maxExtentCm = Math.max(50, (res.r95Cm || 0) * 1.3, (target.targetSizeHeightCm || 75) * 0.7);
    const scale = (w * 0.45) / maxExtentCm; // px per cm

    // Distance rings (every 10 cm, or every 5 in)
    const ringCm = units().imp ? 12.7 : 10;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    for (let r = ringCm; r * scale <= w * 0.75; r += ringCm) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = c.line2;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // Target silhouette
    const halfW = (target.targetSizeWidthCm / 2) * scale;
    const halfH = (target.targetSizeHeightCm / 2) * scale;
    ctx.beginPath();
    if (target.targetShape === 'circle') {
      ctx.arc(cx, cy, halfW, 0, Math.PI * 2);
    } else if (target.targetShape === 'square') {
      ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
    } else {
      const headHalfW = target.targetShape === 'nato-e' ? halfW * 0.5 : 7.5 * scale;
      const headBottomY = cy - halfH * 0.6;
      ctx.moveTo(cx - halfW, cy + halfH);
      ctx.lineTo(cx + halfW, cy + halfH);
      ctx.lineTo(cx + halfW, headBottomY);
      ctx.lineTo(cx + headHalfW, headBottomY);
      ctx.lineTo(cx + headHalfW, cy - halfH);
      ctx.lineTo(cx - headHalfW, cy - halfH);
      ctx.lineTo(cx - headHalfW, headBottomY);
      ctx.lineTo(cx - halfW, headBottomY);
      ctx.closePath();
    }
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = c.text;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 95% and 50% circles
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = c.accent2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, (res.r95Cm || 0) * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, (res.cepCm || 0) * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Shots
    for (const pt of res.shotCoords || []) {
      ctx.fillStyle = pt.hit ? c.ok : c.bad;
      ctx.beginPath();
      ctx.arc(cx + pt.xCm * scale, cy - pt.yCm * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Aim point
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();

    const u = units();
    canvas.setAttribute(
      'aria-label',
      `Simulated impacts on the target at ${fmtU(target.distanceM, u.dist)}: ${fixed(res.hitProbabilityPercent, 0)}% hit. Half of the shots land within ${fmtU((res.cepCm || 0) / 100, u.size)} of the aim point.`
    );
  }

  renderWezMetrics(res) {
    const metricsDiv = this.container.querySelector('#wez-metrics-container');
    const sensDiv = this.container.querySelector('#wez-sensitivity-container');
    if (!metricsDiv || !sensDiv) return;
    const u = units();
    const p = Number(res.hitProbabilityPercent) || 0;
    const inTen = Math.round(p / 10);
    const verdict = p >= 99.5 ? 'Nearly every shot hits'
      : p < 5 ? 'Fewer than 1 in 20 shots hit'
        : inTen >= 10 ? 'About 10 in 10 shots hit'
          : `About ${Math.max(1, inTen)} in 10 shots hit`;
    const [tone, chance] = p >= 80 ? ['ok', 'Good chance'] : p >= 50 ? ['warn', 'Fair chance'] : ['bad', 'Low chance'];
    const angle = (cm) => fmtU(subtends(cm / 100, res.targetDistM || this.values.wez.distM), u.ang);

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    metricsDiv.innerHTML = `
      <div class="tool-verdict tone-${tone}">
        <span class="verdict-label">Hit probability ${toneBadge(tone, chance)}</span>
        <span class="verdict-value stat-val">${fixed(p, 0)}%</span>
        <span class="verdict-text">${verdict} at ${fmtU(res.targetDistM || this.values.wez.distM, u.dist)}.</span>
      </div>
      <dl class="result-stats">
        <div><dt>Half of shots within</dt><dd>${fmtU((res.cepCm || 0) / 100, u.size)} <span class="dd-sub">${angle(res.cepCm || 0)}</span></dd></div>
        <div><dt>95% of shots within</dt><dd>${fmtU((res.r95Cm || 0) / 100, u.size)} <span class="dd-sub">${angle(res.r95Cm || 0)}</span></dd></div>
        <div><dt>Average miss distance</dt><dd>${fmtU((res.meanRadiusCm || 0) / 100, u.size)} <span class="dd-sub">from the aim point</span></dd></div>
      </dl>`;

    const rows = (res.sensitivity || []).filter((s) => Number.isFinite(Number(s.variancePercent)));
    const top = rows[0];
    const label = (s) => SENSITIVITY_TEXT[s.category]?.name || s.factor;
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    sensDiv.innerHTML = `
      <h4 class="sub-heading">What causes misses</h4>
      <div class="sensitivity-bars">
        ${rows.map((s) => `
          <div class="sens-row">
            <div class="sens-header"><span>${esc(label(s))}</span><span class="sens-val">${fixed(Number(s.variancePercent), 0)}%</span></div>
            <div class="sens-bar-track"><div class="sens-bar-fill bar-${esc(String(s.category).toLowerCase())}" data-width-pct="${Math.min(100, Math.max(1, Number(s.variancePercent)))}"></div></div>
          </div>`).join('')}
      </div>
      ${top ? `<p class="wez-advice">${icon('bulb')}<span><strong>Biggest factor: ${esc(label(top))}.</strong> ${esc(SENSITIVITY_TEXT[top.category]?.advice || '')}</span></p>` : ''}`;
    // Bar widths via the CSSOM: the CSP blocks inline style attributes
    sensDiv.querySelectorAll('[data-width-pct]').forEach((bar) => {
      bar.style.width = `${parseFloat(bar.dataset.widthPct)}%`;
    });
  }

  // ---- 3. Group analysis ------------------------------------------------------------------------

  renderGroupAnalyzer() {
    const u = units();
    const ref = this.scaleRefLengthMm ?? 25.4;
    const cal = this.selectedCaliberMm ?? 6.7;
    const sens = this.cvSensitivity ?? 55;
    const dist = this.groupDistM ?? 100;
    const calibrating = !!this.isCalibratingScale;

    return `
      ${this._intro(TOOLS[2], 'Group analysis', 'Upload a photo of your target or click to mark hits. The photo stays on your device.')}
      <div class="tool-layout group-layout">
        <section class="panel tool-inputs" aria-labelledby="group-target-title">
          <div class="panel-header">
            <h3 id="group-target-title">Target</h3>
            <div class="panel-actions">
              <input type="file" id="group-file-input" accept="image/png,image/jpeg,image/webp" hidden />
              <button type="button" id="btn-upload-photo" class="btn-primary-sm">${icon('upload')} Upload photo</button>
              <button type="button" id="btn-load-sample-photo" class="btn-secondary-sm">${icon('target')} Sample target</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="group-settings">
              ${this._numField({ id: 'group-distance', label: 'Distance', unit: u.dist, si: dist, min: 10, max: 2500, set: (x) => { this.groupDistM = x; this._drawGroup(); } })}
              <div class="field-row">
                <label class="field-label" for="group-caliber-select">Bullet diameter</label>
                <select id="group-caliber-select" class="form-select">
                  ${CALIBERS.map((c) => `<option value="${c.mm}" ${Math.abs(cal - c.mm) < 0.2 ? 'selected' : ''}>${c.label}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="group-canvas-box">
              <canvas id="group-canvas" class="${calibrating ? 'is-calibrating' : ''}" role="img" aria-label="Target with marked shots. Use the shot list to add or edit shots with the keyboard."></canvas>
            </div>
            <p class="canvas-hint" id="cv-status-hint" aria-live="polite">${calibrating ? 'Click the first end of the reference line.' : 'Click the target to add a shot. Drag a shot or the aim point to move it. Right-click or long-press a shot to delete it.'}</p>
            <div class="group-legend" aria-hidden="true">
              <span class="legend-item"><span class="legend-dot dot-aim"></span>Aim point</span>
              <span class="legend-item"><span class="legend-dot dot-shot"></span>Shot</span>
              <span class="legend-item"><span class="legend-cross"></span>Group centre</span>
              <span class="legend-item"><span class="legend-ring ring-ellipse"></span>Spread (1 SD)</span>
            </div>

            <div class="group-tools">
              <div class="group-tool-row">
                <span class="group-tool-label">Photo</span>
                <button type="button" id="btn-run-cv" class="btn-secondary-sm">${icon('search')} Find holes</button>
                <label class="field-inline" for="cv-sensitivity-slider">Sensitivity <span id="cv-sens-val">${sens}%</span></label>
                <input type="range" id="cv-sensitivity-slider" min="15" max="95" value="${sens}" step="1" class="cv-range-slider" />
              </div>
              <div class="group-tool-row">
                <span class="group-tool-label">Scale</span>
                <label class="lg-sr-only" for="cv-scale-unit-select">Reference length</label>
                <select id="cv-scale-unit-select" class="form-select-sm">
                  <option value="25.4" ${Math.abs(ref - 25.4) < 0.1 ? 'selected' : ''}>1 inch (25.4 mm)</option>
                  <option value="10.0" ${Math.abs(ref - 10.0) < 0.1 ? 'selected' : ''}>1 cm (10 mm)</option>
                </select>
                <button type="button" id="btn-calibrate-scale" class="btn-secondary-sm" aria-pressed="${calibrating}">${icon('ruler')} Set scale</button>
              </div>
              <div class="group-tool-row">
                <span class="group-tool-label">Shots</span>
                <button type="button" id="btn-reset-aim-point" class="btn-secondary-sm">${icon('crosshair')} Centre aim point</button>
                <button type="button" id="btn-reset-sample-group" class="btn-secondary-sm">${icon('refresh')} Sample shots</button>
                <button type="button" id="btn-clear-group" class="btn-secondary-sm btn-danger-sm">${icon('trash')} Clear</button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel tool-results" aria-labelledby="group-result-title">
          <div class="panel-header"><h3 id="group-result-title">Result</h3></div>
          <div class="panel-body">
            <div id="group-metrics-summary" aria-live="polite"></div>
            <div class="shot-list-block">
              <div class="shot-list-head">
                <h4 class="sub-heading">Shots</h4>
                <button type="button" id="btn-add-shot" class="btn-secondary-sm">${icon('plus')} Add shot</button>
              </div>
              <p class="field-hint">Measured from the aim point in ${u.size}. Right and up are positive.</p>
              <div id="shot-list"></div>
            </div>
          </div>
        </section>
      </div>`;
  }

  initGroupCanvas() {
    const canvas = this.container.querySelector('#group-canvas');
    if (!canvas) return;
    const q = (s) => this.container.querySelector(s);
    const fileInput = q('#group-file-input');

    q('#btn-upload-photo')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) this._loadPhoto(file);
    });
    q('#btn-load-sample-photo')?.addEventListener('click', () => this._loadSampleTarget());
    q('#btn-run-cv')?.addEventListener('click', () => {
      if (this.targetImage) this._detect(this.targetImage);
      else this._loadSampleTarget();
    });
    q('#cv-scale-unit-select')?.addEventListener('change', (e) => {
      this.scaleRefLengthMm = parseFloat(e.target.value) === 10 ? 10.0 : 25.4;
      this._hint(`Reference set to ${this._refName()}. Choose Set scale, then click both ends of a ${this._refName()} line on the target.`);
    });
    q('#btn-calibrate-scale')?.addEventListener('click', () => this._setCalibrating(!this.isCalibratingScale));
    q('#group-caliber-select')?.addEventListener('change', (e) => {
      const mm = parseFloat(e.target.value);
      this.selectedCaliberMm = CALIBERS.some((c) => c.mm === mm) ? mm : 6.7;
      if (this.targetImage) this._detect(this.targetImage);
      else this._drawGroup();
    });
    const slider = q('#cv-sensitivity-slider');
    slider?.addEventListener('input', () => {
      this.cvSensitivity = Math.min(95, Math.max(15, parseInt(slider.value, 10) || 55));
      const span = q('#cv-sens-val');
      if (span) span.textContent = `${this.cvSensitivity}%`;
    });
    slider?.addEventListener('change', () => {
      if (this.targetImage) this._detect(this.targetImage);
    });
    q('#btn-reset-aim-point')?.addEventListener('click', () => {
      this.aimPointMm = { x: 0, y: 0 };
      this._groupChanged(true);
    });
    q('#btn-clear-group')?.addEventListener('click', () => {
      this.groupShots = [];
      this.targetImage = null;
      this.photoNeedsScale = false;
      this._hint('Shots cleared. Upload a photo, click the target or use Add shot.');
      this._groupChanged(true);
    });
    q('#btn-reset-sample-group')?.addEventListener('click', () => {
      this.groupShots = SAMPLE_SHOTS.map((s) => ({ ...s }));
      this.aimPointMm = { x: 0, y: 0 };
      this.targetGridScale = 5.0;
      this.targetImage = null;
      this.photoNeedsScale = false;
      this._groupChanged(true);
    });
    q('#btn-add-shot')?.addEventListener('click', () => {
      if (this.groupShots.length >= 50) return toast('A group can have at most 50 shots', 'info');
      this.groupShots.push({ x: this.aimPointMm.x, y: this.aimPointMm.y });
      this._groupChanged(true);
      const inputs = this.container.querySelectorAll('#shot-list .shot-input');
      inputs[inputs.length - 2]?.focus();
    });

    this._bindCanvasPointer(canvas);
    this._groupChanged(true);
  }

  _refName() {
    return Math.abs(this.scaleRefLengthMm - 10) < 0.1 ? '1 cm' : '1 inch';
  }

  _hint(text) {
    const el = this.container.querySelector('#cv-status-hint');
    if (el) el.textContent = text;
  }

  _setCalibrating(on) {
    this.isCalibratingScale = on;
    this.scaleCalibPoints = [];
    const btn = this.container.querySelector('#btn-calibrate-scale');
    btn?.setAttribute('aria-pressed', String(on));
    this.container.querySelector('#group-canvas')?.classList.toggle('is-calibrating', on);
    this._hint(on
      ? `Set scale: click one end of a ${this._refName()} line on the target.`
      : 'Click the target to add a shot. Drag a shot or the aim point to move it. Right-click or long-press a shot to delete it.');
    this._drawGroup();
  }

  _loadPhoto(file) {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('Choose a PNG, JPEG or WebP photo', 'bad', `${file.name} is not a supported image.`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('Photo is too large', 'bad', 'Use a photo smaller than 25 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      this.targetImage = img;
      this.photoNeedsScale = true;
      this.aimPointMm = { x: 0, y: 0 };
      this._detect(img);
      toast('Photo loaded', 'ok', `Set the scale for accurate sizes: choose Set scale and click both ends of a ${this._refName()} line.`);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('Could not open the photo', 'bad', 'The file may be damaged. Try another photo.');
    };
    img.src = url;
  }

  /** Canvas pointer handling: click to add, drag to move, right-click or long-press to delete. */
  _bindCanvasPointer(canvas) {
    let drag = null; // { type: 'shot', idx } | { type: 'aim' }
    let down = null;
    let moved = false;
    let longPressed = false;

    const toLogical = (e) => {
      const rect = canvas.getBoundingClientRect();
      const s = GW / (rect.width || GW);
      return { x: (e.clientX - rect.left) * s, y: (e.clientY - rect.top) * s };
    };
    const hitRadius = () => Math.max(10, (this.selectedCaliberMm / 2) * this.targetGridScale + 6);
    const shotAt = (pt) => {
      for (let i = this.groupShots.length - 1; i >= 0; i--) {
        const p = this._toPx(this.groupShots[i]);
        if (Math.hypot(pt.x - p.x, pt.y - p.y) <= hitRadius()) return i;
      }
      return -1;
    };
    const aimAt = (pt) => {
      const p = this._toPx(this.aimPointMm);
      return Math.hypot(pt.x - p.x, pt.y - p.y) <= 14;
    };
    const deleteShot = (idx) => {
      if (idx < 0) return;
      this.groupShots.splice(idx, 1);
      this._hint(`Shot ${idx + 1} deleted.`);
      this._groupChanged(true);
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const pt = toLogical(e);
      down = pt;
      moved = false;
      longPressed = false;
      if (this.isCalibratingScale) return;
      if (aimAt(pt)) drag = { type: 'aim' };
      else {
        const idx = shotAt(pt);
        if (idx >= 0) drag = { type: 'shot', idx };
      }
      if (drag) {
        canvas.setPointerCapture?.(e.pointerId);
        canvas.classList.add('is-dragging');
      }
      if (drag?.type === 'shot' && e.pointerType !== 'mouse') {
        clearTimeout(this._lpTimer);
        this._lpTimer = setTimeout(() => {
          if (moved || !drag) return;
          longPressed = true;
          deleteShot(drag.idx);
          drag = null;
        }, 550);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!down || !drag) return;
      const pt = toLogical(e);
      if (!moved && Math.hypot(pt.x - down.x, pt.y - down.y) < 4) return;
      moved = true;
      clearTimeout(this._lpTimer);
      const mm = this._toMm(pt);
      if (drag.type === 'shot' && this.groupShots[drag.idx]) this.groupShots[drag.idx] = mm;
      else if (drag.type === 'aim') this.aimPointMm = mm;
      this._groupChanged(false);
    });

    const end = (e) => {
      clearTimeout(this._lpTimer);
      if (!down) return;
      const pt = toLogical(e);
      const wasDrag = drag;
      drag = null;
      down = null;
      canvas.classList.remove('is-dragging');
      if (longPressed) return;
      if (this.isCalibratingScale) return this._calibrationClick(pt);
      if (wasDrag) {
        if (moved) this._groupChanged(true);
        return;
      }
      if (e.type === 'pointercancel' || moved) return;
      if (this.groupShots.length >= 50) return toast('A group can have at most 50 shots', 'info');
      this.groupShots.push(this._toMm(pt));
      this._groupChanged(true);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (longPressed) return; // the long-press timer already deleted it
      clearTimeout(this._lpTimer);
      const idx = shotAt(toLogical(e));
      if (idx >= 0) {
        if (down) longPressed = true; // touch long-press: don't also add a shot on pointerup
        drag = null;
        deleteShot(idx);
      }
    });
  }

  _calibrationClick(pt) {
    this.scaleCalibPoints.push(pt);
    if (this.scaleCalibPoints.length === 1) {
      this._hint(`Now click the other end of the ${this._refName()} line.`);
      this._drawGroup();
      return;
    }
    const [a, b] = this.scaleCalibPoints;
    const distPx = Math.hypot(b.x - a.x, b.y - a.y);
    if (distPx < 5) {
      this.scaleCalibPoints = [];
      this._hint('The two points are too close. Click one end of the reference line again.');
      this._drawGroup();
      return;
    }
    const newScale = distPx / this.scaleRefLengthMm;
    // Keep shots and the aim point where they are on the photo: rescale their mm positions
    const k = this.targetGridScale / newScale;
    this.groupShots = this.groupShots.map((s) => ({ x: s.x * k, y: s.y * k }));
    this.aimPointMm = { x: this.aimPointMm.x * k, y: this.aimPointMm.y * k };
    this.targetGridScale = newScale;
    this.photoNeedsScale = false;
    this._setCalibrating(false);
    this._hint(`Scale set: ${this._refName()} = ${distPx.toFixed(0)} px.`);
    this._groupChanged(true);
  }

  _toPx(mm) {
    return { x: GW / 2 + mm.x * this.targetGridScale, y: GW / 2 - mm.y * this.targetGridScale };
  }

  _toMm(px) {
    return {
      x: Number(((px.x - GW / 2) / this.targetGridScale).toFixed(1)),
      y: Number((-(px.y - GW / 2) / this.targetGridScale).toFixed(1)),
    };
  }

  /** Shots relative to the aim point (mm, right and up positive). */
  _relShots() {
    return this.groupShots.map((s) => ({ x: s.x - this.aimPointMm.x, y: s.y - this.aimPointMm.y }));
  }

  _groupStats() {
    const pts = this._relShots();
    const n = pts.length;
    if (n === 0) return { n };
    const meanX = pts.reduce((s, p) => s + p.x, 0) / n;
    const meanY = pts.reduce((s, p) => s + p.y, 0) / n;
    let es = 0;
    let pair = [pts[0], pts[0]];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d > es) {
          es = d;
          pair = [pts[i], pts[j]];
        }
      }
    }
    const radii = pts.map((p) => Math.hypot(p.x - meanX, p.y - meanY));
    const meanRadius = radii.reduce((s, r) => s + r, 0) / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    if (n >= 2) {
      for (const p of pts) {
        sxx += (p.x - meanX) ** 2;
        syy += (p.y - meanY) ** 2;
        sxy += (p.x - meanX) * (p.y - meanY);
      }
      sxx /= n - 1;
      syy /= n - 1;
      sxy /= n - 1;
    }
    // Covariance ellipse (1 SD): eigenvalues are the variances along the principal axes
    const tr = (sxx + syy) / 2;
    const disc = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
    const ellipse = n >= 3 ? { a: Math.sqrt(Math.max(0, tr + disc)), b: Math.sqrt(Math.max(0, tr - disc)), angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) } : null;
    return { n, meanX, meanY, es, pair, meanRadius, sdX: Math.sqrt(sxx), sdY: Math.sqrt(syy), ellipse };
  }

  /** Redraws, updates the result, and (when `list` is true) rebuilds the shot list. */
  _groupChanged(list) {
    const stats = this._drawGroup();
    this._renderGroupMetrics(stats);
    if (list) this._renderShotList();
  }

  _drawGroup() {
    const canvas = this.container.querySelector('#group-canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const c = themeColors();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(GW * dpr)) {
      canvas.width = Math.round(GW * dpr);
      canvas.height = Math.round(GW * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = this.targetGridScale;
    const aim = this._toPx(this.aimPointMm);
    const imp = units().imp;

    ctx.clearRect(0, 0, GW, GW);
    if (this.targetImage) {
      const r = this._fitRect(this.targetImage);
      ctx.drawImage(this.targetImage, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, GW, GW);
    }

    // Measurement grid (1 cm, or 1/2 in) centred on the aim point
    const stepMm = imp ? 12.7 : 10;
    ctx.save();
    ctx.globalAlpha = this.targetImage ? 0.35 : 1;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -60; k <= 60; k++) {
      const x = aim.x + k * stepMm * scale;
      const y = aim.y + k * stepMm * scale;
      if (x >= 0 && x <= GW) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, GW);
      }
      if (y >= 0 && y <= GW) {
        ctx.moveTo(0, y);
        ctx.lineTo(GW, y);
      }
    }
    ctx.stroke();
    if (!this.targetImage) {
      ctx.strokeStyle = c.line2;
      ctx.lineWidth = 1.5;
      for (const rMm of imp ? [25.4, 50.8] : [25, 50]) {
        ctx.beginPath();
        ctx.arc(aim.x, aim.y, rMm * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    const stats = this._groupStats();
    const toPxRel = (p) => this._toPx({ x: p.x + this.aimPointMm.x, y: p.y + this.aimPointMm.y });

    if (stats.n >= 2) {
      // Extreme spread line
      const a = toPxRel(stats.pair[0]);
      const b = toPxRel(stats.pair[1]);
      ctx.strokeStyle = c.warn;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const centre = stats.n ? toPxRel({ x: stats.meanX, y: stats.meanY }) : null;
    if (stats.ellipse && stats.ellipse.a > 0) {
      ctx.strokeStyle = c.accent2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Canvas y points down, so the rotation is mirrored
      ctx.ellipse(centre.x, centre.y, stats.ellipse.a * scale, Math.max(0.5, stats.ellipse.b * scale), -stats.ellipse.angle, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Aim point (diamond)
    ctx.fillStyle = c.bad;
    ctx.strokeStyle = c.bg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(aim.x, aim.y - 8);
    ctx.lineTo(aim.x + 8, aim.y);
    ctx.lineTo(aim.x, aim.y + 8);
    ctx.lineTo(aim.x - 8, aim.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Shots
    const rPx = Math.max(3, (this.selectedCaliberMm / 2) * scale);
    ctx.font = '600 12px system-ui, sans-serif';
    this.groupShots.forEach((s, idx) => {
      const p = this._toPx(s);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = c.warn;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = c.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = c.bg;
      ctx.strokeText(String(idx + 1), p.x + rPx + 3, p.y - 3);
      ctx.fillStyle = c.text;
      ctx.fillText(String(idx + 1), p.x + rPx + 3, p.y - 3);
    });

    // Group centre
    if (centre) {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(centre.x - 9, centre.y);
      ctx.lineTo(centre.x + 9, centre.y);
      ctx.moveTo(centre.x, centre.y - 9);
      ctx.lineTo(centre.x, centre.y + 9);
      ctx.stroke();
    }

    // Scale calibration: first point
    if (this.isCalibratingScale && this.scaleCalibPoints.length === 1) {
      const p = this.scaleCalibPoints[0];
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    canvas.setAttribute('aria-label', stats.n
      ? `Target with ${stats.n} marked shot${stats.n === 1 ? '' : 's'}. Use the shot list to add or edit shots with the keyboard.`
      : 'Empty target. Click to add shots, or use Add shot in the shot list.');
    return stats;
  }

  _fitRect(img) {
    const aspect = img.width / img.height;
    if (aspect > 1) {
      const h = GW / aspect;
      return { x: 0, y: (GW - h) / 2, w: GW, h };
    }
    const w = GW * aspect;
    return { x: (GW - w) / 2, y: 0, w, h: GW };
  }

  _renderGroupMetrics(stats) {
    const summary = this.container.querySelector('#group-metrics-summary');
    if (!summary || !stats) return;
    if (stats.n === 0) {
      // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
      summary.innerHTML = `<p class="empty-state">${icon('target')} No shots yet. Click the target, upload a photo or use Add shot.</p>`;
      return;
    }
    const u = units();
    const distM = this.groupDistM || 100;
    const mm = (v) => fmtU(v / 1000, u.size);
    const ang = (v) => fmtU(subtends(v / 1000, distM), u.ang);
    const profile = appState.getActiveProfile();
    const clickRad = profile.optic?.clickValueRad || 0.0001;
    const corr = (v, pos, neg) => {
      const rad = subtends(Math.abs(v) / 1000, distM);
      const clicks = Math.round(rad / clickRad);
      if (clicks === 0) return null;
      return `${v < 0 ? pos : neg} ${fmtU(rad, u.ang)} (${clicks} click${clicks === 1 ? '' : 's'})`;
    };
    const fix = [corr(stats.meanY, 'up', 'down'), corr(stats.meanX, 'right', 'left')].filter(Boolean);
    const offset = (v, pos, neg) => (Math.abs(v) < 0.05 ? `0 ${u.size}` : `${mm(Math.abs(v))} ${v >= 0 ? pos : neg}`);
    const groupAng = subtends(stats.es / 1000, distM) / CONVERSIONS.MOA;
    const [tone, label] = stats.n < 3 ? ['warn', 'Add more shots'] : groupAng <= 1 ? ['ok', 'Under 1 MOA'] : groupAng <= 2 ? ['warn', '1–2 MOA'] : ['bad', 'Over 2 MOA'];

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    summary.innerHTML = `
      <div class="tool-verdict tone-${tone}">
        <span class="verdict-label">Group size (extreme spread) ${toneBadge(tone, label)}</span>
        <span class="verdict-value">${ang(stats.es)}</span>
        <span class="verdict-text">${stats.n} shot${stats.n === 1 ? '' : 's'} at ${fmtU(distM, u.dist)}: ${mm(stats.es)} centre to centre.</span>
      </div>
      <dl class="result-stats">
        <div><dt>Mean radius</dt><dd>${mm(stats.meanRadius)} <span class="dd-sub">${ang(stats.meanRadius)}</span></dd></div>
        <div><dt>Vertical SD</dt><dd>${stats.n >= 2 ? mm(stats.sdY) : '–'} <span class="dd-sub">${stats.n >= 2 ? ang(stats.sdY) : ''}</span></dd></div>
        <div><dt>Horizontal SD</dt><dd>${stats.n >= 2 ? mm(stats.sdX) : '–'} <span class="dd-sub">${stats.n >= 2 ? ang(stats.sdX) : ''}</span></dd></div>
        <div><dt>Group centre</dt><dd>${offset(stats.meanY, 'high', 'low')}, ${offset(stats.meanX, 'right', 'left')}</dd></div>
      </dl>
      <p class="result-note">${icon('turret')}<span>${fix.length ? `To centre the group, dial ${fix.join(' and ')}.` : 'The group is centred on the aim point.'} Clicks use ${esc(profile.optic?.clickName || '0.1 MRAD')}.</span></p>
      <p class="field-hint">Mean radius is the average distance of the shots from the group centre. SD is the standard deviation (n − 1).${this.photoNeedsScale ? ' <strong>Set the scale for real sizes.</strong>' : ''}</p>`;
  }

  _renderShotList() {
    const host = this.container.querySelector('#shot-list');
    if (!host) return;
    const u = units();
    const rel = this._relShots();
    const dec = u.imp ? 2 : 1;
    const limit = u.imp ? 20 : 50; // in / cm
    if (!rel.length) {
      host.innerHTML = '<p class="text-muted shot-empty">No shots.</p>';
      return;
    }
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    host.innerHTML = `
      <div class="shot-row shot-row-head" aria-hidden="true"><span>#</span><span>Right (${u.size})</span><span>Up (${u.size})</span><span></span></div>
      <ol class="shot-list">
        ${rel.map((p, i) => `
          <li class="shot-row">
            <span class="shot-num">${i + 1}</span>
            <input type="text" inputmode="decimal" autocomplete="off" class="form-input-sm shot-input" id="shot-x-${i}" data-idx="${i}" data-axis="x" min="${-limit}" max="${limit}" value="${fixed(toUnit(p.x / 1000, u.size), dec)}" aria-label="Shot ${i + 1}, right (${u.size})" />
            <input type="text" inputmode="decimal" autocomplete="off" class="form-input-sm shot-input" id="shot-y-${i}" data-idx="${i}" data-axis="y" min="${-limit}" max="${limit}" value="${fixed(toUnit(p.y / 1000, u.size), dec)}" aria-label="Shot ${i + 1}, up (${u.size})" />
            <button type="button" class="btn-ghost-sm btn-icon-only btn-del-shot" data-idx="${i}" aria-label="Delete shot ${i + 1}">${icon('trash')}</button>
          </li>`).join('')}
      </ol>`;

    host.querySelectorAll('.shot-input').forEach((input) => {
      bindNumber(input, (v) => {
        const idx = Number(input.dataset.idx);
        const shot = this.groupShots[idx];
        if (!shot) return;
        const mmVal = fromUnit(v, u.size) * 1000;
        shot[input.dataset.axis] = this.aimPointMm[input.dataset.axis] + mmVal;
        this._groupChanged(false);
      });
    });
    host.querySelectorAll('.btn-del-shot').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        this.groupShots.splice(idx, 1);
        this._groupChanged(true);
        const btns = this.container.querySelectorAll('.btn-del-shot');
        (btns[Math.min(idx, btns.length - 1)] || this.container.querySelector('#btn-add-shot'))?.focus();
      });
    });
  }

  /** Client-side bullet hole detection (grayscale, blur, Sobel, radial-symmetry vote, NMS). */
  _detect(source) {
    const w = GW;
    const h = GW;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    const r = this._fitRect(source);
    offCtx.drawImage(source, r.x, r.y, r.w, r.h);
    const data = offCtx.getImageData(0, 0, w, h).data;

    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }

    // 5x5 separable Gaussian blur
    const blurred = new Uint8Array(w * h);
    const temp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        temp[row + x] = (gray[row + Math.max(0, x - 2)] + gray[row + Math.max(0, x - 1)] * 4 + gray[row + x] * 6 + gray[row + Math.min(w - 1, x + 1)] * 4 + gray[row + Math.min(w - 1, x + 2)]) >> 4;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 2) * w;
      const y1 = Math.max(0, y - 1) * w;
      const y3 = Math.min(h - 1, y + 1) * w;
      const y4 = Math.min(h - 1, y + 2) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        blurred[row + x] = (temp[y0 + x] + temp[y1 + x] * 4 + temp[row + x] * 6 + temp[y3 + x] * 4 + temp[y4 + x]) >> 4;
      }
    }

    // Sobel gradients
    const gx = new Int16Array(w * h);
    const gy = new Int16Array(w * h);
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      const ym1 = (y - 1) * w;
      const y0 = y * w;
      const yp1 = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const vx = blurred[ym1 + x + 1] + 2 * blurred[y0 + x + 1] + blurred[yp1 + x + 1] - (blurred[ym1 + x - 1] + 2 * blurred[y0 + x - 1] + blurred[yp1 + x - 1]);
        const vy = blurred[yp1 + x - 1] + 2 * blurred[yp1 + x] + blurred[yp1 + x + 1] - (blurred[ym1 + x - 1] + 2 * blurred[ym1 + x] + blurred[ym1 + x + 1]);
        const idx = y0 + x;
        gx[idx] = vx;
        gy[idx] = vy;
        mag[idx] = Math.sqrt(vx * vx + vy * vy);
      }
    }

    // Radial symmetry vote: gradients on a dark hole point outward, so the centre lies inward
    const expectedRadius = Math.max(3, (this.selectedCaliberMm / 2) * this.targetGridScale);
    const minRadius = Math.max(2, Math.round(expectedRadius * 0.7));
    const maxRadius = Math.max(4, Math.round(expectedRadius * 1.35));
    const accum = new Float32Array(w * h);
    for (let y = 5; y < h - 5; y++) {
      const row = y * w;
      for (let x = 5; x < w - 5; x++) {
        const idx = row + x;
        const g = mag[idx];
        if (g < 35) continue;
        const ux = gx[idx] / g;
        const uy = gy[idx] / g;
        for (let rr = minRadius; rr <= maxRadius; rr++) {
          const cx = Math.round(x - rr * ux);
          const cy = Math.round(y - rr * uy);
          if (cx >= 5 && cx < w - 5 && cy >= 5 && cy < h - 5) accum[cy * w + cx] += g / rr;
        }
      }
    }

    let maxVote = 0;
    for (let i = 0; i < accum.length; i++) if (accum[i] > maxVote) maxVote = accum[i];
    const voteThreshold = maxVote * (1.0 - (this.cvSensitivity / 100) * 0.75);
    const rInt = Math.round(expectedRadius);
    const margin = Math.max(8, rInt * 2);
    const candidates = [];
    for (let y = margin; y < h - margin; y++) {
      const row = y * w;
      for (let x = margin; x < w - margin; x++) {
        const vote = accum[row + x];
        if (vote < voteThreshold || vote < 20) continue;
        let inSum = 0;
        let inN = 0;
        let outSum = 0;
        let outN = 0;
        for (let dy = -rInt * 2; dy <= rInt * 2; dy++) {
          for (let dx = -rInt * 2; dx <= rInt * 2; dx++) {
            const d2 = dx * dx + dy * dy;
            const val = gray[(y + dy) * w + (x + dx)];
            if (d2 <= (rInt * 0.8) ** 2) {
              inSum += val;
              inN++;
            } else if (d2 >= (rInt * 1.1) ** 2 && d2 <= (rInt * 1.8) ** 2) {
              outSum += val;
              outN++;
            }
          }
        }
        const contrast = (outN ? outSum / outN : 0) - (inN ? inSum / inN : 255);
        if (contrast > 12) candidates.push({ px: x, py: y, score: vote * Math.sqrt(contrast) });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const detected = [];
    const minDist = expectedRadius * 1.35;
    for (const cand of candidates) {
      if (detected.every((d) => Math.hypot(cand.px - d.px, cand.py - d.py) >= minDist)) {
        detected.push(cand);
        if (detected.length >= 25) break;
      }
    }

    if (detected.length) {
      this.groupShots = detected.map((d) => this._toMm({ x: d.px, y: d.py }));
      this._hint(`Found ${detected.length} hole${detected.length === 1 ? '' : 's'}. Drag to adjust, or right-click or long-press to delete.`);
    } else {
      this._hint('No holes found. Try a higher sensitivity, set the scale, or click to mark shots yourself.');
    }
    this._groupChanged(true);
  }

  /** Draws a synthetic paper target with five holes and runs detection on it. */
  _loadSampleTarget() {
    this.targetGridScale = 5.0;
    this.photoNeedsScale = false;
    this.aimPointMm = { x: 0, y: 0 };
    const s = document.createElement('canvas');
    s.width = GW;
    s.height = GW;
    const g = s.getContext('2d');
    const cx = GW / 2;
    const cy = GW / 2;
    const scale = this.targetGridScale;
    // Paper colours are part of the simulated photo, not the UI theme
    g.fillStyle = '#f5efe3';
    g.fillRect(0, 0, GW, GW);
    g.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    g.lineWidth = 1;
    for (let k = -200; k <= 200; k += 25.4) {
      g.beginPath();
      g.moveTo(cx + k * scale, 0);
      g.lineTo(cx + k * scale, GW);
      g.moveTo(0, cy + k * scale);
      g.lineTo(GW, cy + k * scale);
      g.stroke();
    }
    [25.4, 50.8, 76.2, 101.6].forEach((rMm, idx) => {
      g.strokeStyle = idx === 1 ? 'rgba(15, 23, 42, 0.7)' : 'rgba(100, 116, 139, 0.5)';
      g.lineWidth = idx === 1 ? 2 : 1.2;
      g.beginPath();
      g.arc(cx, cy, rMm * scale, 0, Math.PI * 2);
      g.stroke();
    });
    g.fillStyle = '#dc2626';
    g.beginPath();
    g.moveTo(cx, cy - 8);
    g.lineTo(cx + 8, cy);
    g.lineTo(cx, cy + 8);
    g.lineTo(cx - 8, cy);
    g.closePath();
    g.fill();
    const rPx = (this.selectedCaliberMm / 2) * scale;
    for (const sh of SAMPLE_SHOTS) {
      const hx = cx + sh.x * scale;
      const hy = cy - sh.y * scale;
      g.fillStyle = '#ded6c6';
      g.beginPath();
      g.arc(hx, hy, rPx + 2.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0a0a0c';
      g.beginPath();
      g.arc(hx, hy, rPx + 0.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1c1917';
      g.beginPath();
      g.arc(hx, hy, rPx, 0, Math.PI * 2);
      g.fill();
    }
    this.targetImage = s;
    this._detect(s);
  }

  // ---- 4. Chronograph ---------------------------------------------------------------------------

  /** Parses chronograph text. Separators: spaces, new lines, semicolons and commas followed by a
   * space or at a word end. A comma between two digits is a decimal mark (825,4 = 825.4). */
  static parseVelocities(text) {
    const normalised = String(text || '').replace(/(\d),(\d)/g, '$1.$2');
    const tokens = normalised.split(/[\s;,]+/).filter(Boolean);
    const values = [];
    const ignored = [];
    for (const t of tokens) {
      const n = parseNumber(t);
      if (Number.isFinite(n) && n > 0) values.push(n);
      else ignored.push(t);
    }
    return { values, ignored };
  }

  renderChrono() {
    const u = units();
    const v = this.values.chrono;
    const unit = v.unit || u.vel;
    return `
      ${this._intro(TOOLS[3], 'Chronograph statistics', 'Paste your chronograph readings to get the average muzzle velocity and how consistent the load is.')}
      <div class="tool-layout">
        <section class="panel tool-inputs" aria-labelledby="chrono-in-title">
          <div class="panel-header"><h3 id="chrono-in-title">Readings</h3></div>
          <div class="panel-body">
            <div class="field-row">
              <span class="field-label" id="chrono-unit-label">Velocity unit</span>
              <div class="lg-tabs unit-toggle" role="group" aria-labelledby="chrono-unit-label">
                ${['m/s', 'fps'].map((x) => `<button type="button" class="tab-btn" data-unit="${x}" aria-pressed="${unit === x}">${x}</button>`).join('')}
              </div>
            </div>
            <div class="field-row">
              <label class="field-label" for="chrono-input">Velocities (${unit})</label>
              <textarea id="chrono-input" class="form-textarea" rows="6" spellcheck="false" aria-describedby="chrono-hint">${esc(v.text)}</textarea>
              <p class="field-hint" id="chrono-hint">One reading per line, or separated by spaces or semicolons. A comma between digits is a decimal mark (825,4 = 825.4).</p>
            </div>
            <button type="button" id="btn-calc-chrono" class="btn-primary btn-block">${icon('chart')} Calculate</button>
          </div>
        </section>
        <section class="panel tool-results" aria-labelledby="chrono-out-title">
          <div class="panel-header"><h3 id="chrono-out-title">Result</h3></div>
          <div class="panel-body" id="chrono-results" aria-live="polite"></div>
        </section>
      </div>`;
  }

  _initChrono() {
    const q = (s) => this.container.querySelector(s);
    const ta = q('#chrono-input');
    ta?.addEventListener('input', () => (this.values.chrono.text = ta.value.slice(0, 20000)));
    q('#btn-calc-chrono')?.addEventListener('click', () => this.calcChrono());
    this.container.querySelectorAll('.unit-toggle .tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.values.chrono.unit = btn.dataset.unit === 'fps' ? 'fps' : 'm/s';
        this.container.querySelectorAll('.unit-toggle .tab-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const label = this.container.querySelector('label[for="chrono-input"]');
        if (label) label.textContent = `Velocities (${this.values.chrono.unit})`;
        this.calcChrono();
      });
    });
    this.calcChrono();
  }

  calcChrono() {
    const out = this.container.querySelector('#chrono-results');
    if (!out) return;
    const v = this.values.chrono;
    const unit = v.unit || units().vel;
    const { values, ignored } = ToolsView.parseVelocities(v.text);
    const toSI = (x) => fromUnit(x, unit);
    const [lo, hi] = unit === 'fps' ? [300, 5000] : [100, 1500];
    const outOfRange = values.filter((x) => x < lo || x > hi);
    const good = values.filter((x) => x >= lo && x <= hi);
    const problems = [
      ignored.length ? `Ignored ${ignored.length} entr${ignored.length === 1 ? 'y' : 'ies'} that ${ignored.length === 1 ? 'is' : 'are'} not a number: ${esc(ignored.slice(0, 5).join(', '))}${ignored.length > 5 ? '…' : ''}.` : '',
      outOfRange.length ? `Ignored ${outOfRange.length} reading${outOfRange.length === 1 ? '' : 's'} outside ${lo}–${hi} ${unit}: ${outOfRange.slice(0, 5).join(', ')}. Is the unit right?` : '',
    ].filter(Boolean);
    const problemHtml = problems.length ? `<p class="result-note tone-warn-text">${icon('alert')}<span>${problems.join(' ')}</span></p>` : '';

    if (good.length < 2) {
      // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
      out.innerHTML = `<p class="empty-state">${icon('chrono')} Enter at least 2 velocities.</p>${problemHtml}`;
      return;
    }

    const n = good.length;
    const mean = good.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(good.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
    const min = Math.min(...good);
    const max = Math.max(...good);
    const sorted = [...good].sort((a, b) => a - b);
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
    const sdMs = toSI(sd);
    const [tone, verdict] = sdMs < 3 ? ['ok', 'Very consistent: good for long range.'] : sdMs < 5 ? ['warn', 'Usable. Expect some vertical spread at long range.'] : ['bad', 'Large spread: expect vertical stringing at long range.'];
    const d = unit === 'fps' ? 0 : 1;
    const profile = appState.getActiveProfile();
    const meanSI = Number(toSI(mean).toFixed(2));
    const shown = `${mean.toFixed(d)} ${unit}`;

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    out.innerHTML = `
      <div class="tool-verdict tone-${tone}">
        <span class="verdict-label">Average muzzle velocity ${toneBadge(tone, `SD ${sd.toFixed(d === 0 ? 1 : 2)} ${unit}`)}</span>
        <span class="verdict-value">${shown}</span>
        <span class="verdict-text">${verdict}</span>
      </div>
      <dl class="result-stats">
        <div><dt>Shots</dt><dd>${n}</dd></div>
        <div><dt><abbr title="Standard deviation (n − 1)">SD</abbr></dt><dd>${sd.toFixed(2)} ${unit}</dd></div>
        <div><dt><abbr title="Extreme spread: fastest minus slowest">ES</abbr></dt><dd>${(max - min).toFixed(d)} ${unit}</dd></div>
        <div><dt>Slowest / fastest</dt><dd>${min.toFixed(d)} / ${max.toFixed(d)}</dd></div>
        <div><dt>Median</dt><dd>${median.toFixed(d)} ${unit}</dd></div>
      </dl>
      ${problemHtml}
      <button type="button" id="btn-apply-chrono-mv" class="btn-primary btn-block">${icon('check')} Use ${shown} as muzzle velocity for ${esc(profile.name)}</button>`;

    out.querySelector('#btn-apply-chrono-mv')?.addEventListener('click', () => {
      const before = profile.muzzleVelocityMs;
      this._ownChange = true;
      appState.updateActiveProfile({ muzzleVelocityMs: meanSI, zeroAngleRad: null });
      const u = units();
      toast('Muzzle velocity updated', 'ok', `${profile.name}: ${fixed(toUnit(before, u.vel), DECIMALS[u.vel])} → ${fmtU(meanSI, u.vel)}`);
      const btn = out.querySelector('#btn-apply-chrono-mv');
      // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
      if (btn) btn.outerHTML = `<p class="applied-note">${icon('check-circle')} Applied to ${esc(profile.name)}</p>`;
    });
  }

  // ---- 5. Range estimation ----------------------------------------------------------------------

  renderMilling() {
    const u = units();
    const v = this.values.milling;
    const sizeTxt = (cm) => `${fixed(toUnit(cm / 100, u.size), u.imp ? 1 : 0)} ${u.size}`;
    return `
      ${this._intro(TOOLS[4], 'Range estimation', 'Estimate distance from a target\'s known size and its size in your reticle.')}
      <div class="tool-layout">
        <section class="panel tool-inputs" aria-labelledby="mill-in-title">
          <div class="panel-header"><h3 id="mill-in-title">Target and reading</h3></div>
          <div class="panel-body">
            <div class="field-row">
              <label class="field-label" for="milling-preset">Known size</label>
              <select id="milling-preset" class="form-select">
                ${RANGE_PRESETS.map((p) => `<option value="${p.id}" ${v.preset === p.id ? 'selected' : ''}>${p.label} (${sizeTxt(p.cm)})</option>`).join('')}
                <option value="custom" ${v.preset === 'custom' ? 'selected' : ''}>Custom size</option>
              </select>
            </div>
            ${this._numField({ id: 'milling-size-mm', label: 'Target size', unit: u.size, si: v.sizeM, min: 0.05, max: 10, live: true, set: (x) => { v.sizeM = x; this._syncPreset(); this.calcMilling(); } })}
            ${this._numField({ id: 'milling-mils', label: 'Size in reticle', unit: u.ang, si: v.angleRad, min: 0.00005, max: 0.05, step: u.ang === 'MRAD' ? 0.05 : 0.25, live: true, set: (x) => { v.angleRad = x; this.calcMilling(); }, hint: 'Read it in the same direction as the size: a width across, a height up and down. In a second focal plane scope, read at the magnification the reticle is calibrated for.' })}
          </div>
        </section>
        <section class="panel tool-results" aria-labelledby="mill-out-title">
          <div class="panel-header"><h3 id="mill-out-title">Estimated distance</h3></div>
          <div class="panel-body" id="milling-out" aria-live="polite"></div>
        </section>
      </div>`;
  }

  _syncPreset() {
    const v = this.values.milling;
    const match = RANGE_PRESETS.find((p) => Math.abs(p.cm / 100 - v.sizeM) < 0.0005);
    v.preset = match ? match.id : 'custom';
    const sel = this.container.querySelector('#milling-preset');
    if (sel) sel.value = v.preset;
  }

  _initMilling() {
    const sel = this.container.querySelector('#milling-preset');
    sel?.addEventListener('change', () => {
      const v = this.values.milling;
      const p = RANGE_PRESETS.find((x) => x.id === sel.value);
      v.preset = p ? p.id : 'custom';
      if (p) {
        v.sizeM = p.cm / 100;
        const input = this.container.querySelector('#milling-size-mm');
        const u = units();
        if (input) {
          input.value = String(Number(toUnit(v.sizeM, u.size).toFixed(DECIMALS[u.size])));
          input.dispatchEvent(new Event('change'));
        }
      } else {
        this.container.querySelector('#milling-size-mm')?.focus();
      }
      this.calcMilling();
    });
    this.calcMilling();
  }

  calcMilling() {
    const out = this.container.querySelector('#milling-out');
    if (!out) return;
    const u = units();
    const v = this.values.milling;
    const range = (a) => v.sizeM / Math.tan(a);
    const distM = range(v.angleRad);
    const other = u.dist === 'm' ? 'yd' : 'm';
    const err = u.ang === 'MRAD' ? 0.0001 : 0.25 * CONVERSIONS.MOA;
    const near = range(v.angleRad + err);
    const far = v.angleRad - err > 0 ? range(v.angleRad - err) : Infinity;
    const errTxt = u.ang === 'MRAD' ? '0.1 MRAD' : '0.25 MOA';
    const formula = u.ang === 'MRAD'
      ? 'Distance (m) = size (mm) ÷ reading (MRAD)'
      : 'Distance (yd) ≈ size (in) × 95.5 ÷ reading (MOA)';
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    out.innerHTML = `
      <div class="tool-verdict tone-accent">
        <span class="verdict-label">About</span>
        <span class="verdict-value" id="milling-range-result">${grouped(toUnit(distM, u.dist))} ${u.dist}</span>
        <span class="verdict-text" id="milling-range-yd">${grouped(toUnit(distM, other))} ${other}</span>
      </div>
      <p class="result-note">${icon('info')}<span>A reading ${errTxt} off gives ${grouped(toUnit(near, u.dist))}–${Number.isFinite(far) ? grouped(toUnit(far, u.dist)) : 'very far'} ${u.dist}. Confirm with a rangefinder when you can.</span></p>
      <p class="formula-box"><code>${formula}</code></p>`;
  }

  // ---- 6. Recoil --------------------------------------------------------------------------------

  renderRecoil() {
    const u = units();
    const v = this.values.recoil;
    return `
      ${this._intro(TOOLS[5], 'Recoil', 'Free recoil energy and velocity: how hard the rifle pushes back if nothing holds it.')}
      ${this._context([`${icon('rifle')} Filled in from <strong>${esc(appState.getActiveProfile().name)}</strong>`])}
      <div class="tool-layout">
        <section class="panel tool-inputs" aria-labelledby="recoil-in-title">
          <div class="panel-header"><h3 id="recoil-in-title">Rifle and load</h3></div>
          <div class="panel-body">
            ${this._numField({ id: 'recoil-rifle-kg', label: 'Rifle weight incl. scope and bipod', unit: u.mass, si: v.rifleKg, min: 1, max: 30, live: true, set: (x) => { v.rifleKg = x; this.calcRecoil(); } })}
            <div class="field-grid-2">
              ${this._numField({ id: 'recoil-bullet-gr', label: 'Bullet weight', unitText: 'gr', si: v.bulletGr, min: 20, max: 1000, dec: 1, live: true, set: (x) => { v.bulletGr = x; this.calcRecoil(); } })}
              ${this._numField({ id: 'recoil-powder-gr', label: 'Powder charge', unitText: 'gr', si: v.powderGr, min: 1, max: 300, dec: 1, live: true, set: (x) => { v.powderGr = x; this.calcRecoil(); } })}
            </div>
            ${this._numField({ id: 'recoil-mv-ms', label: 'Muzzle velocity', unit: u.vel, si: v.mvMs, min: 150, max: 1500, live: true, set: (x) => { v.mvMs = x; this.calcRecoil(); }, hint: 'Powder gas is assumed to leave the muzzle at 1.5 × muzzle velocity, a common rule of thumb. Muzzle brakes and suppressors are not included.' })}
          </div>
        </section>
        <section class="panel tool-results" aria-labelledby="recoil-out-title">
          <div class="panel-header"><h3 id="recoil-out-title">Result</h3></div>
          <div class="panel-body" id="recoil-results" aria-live="polite"></div>
        </section>
      </div>`;
  }

  calcRecoil() {
    const out = this.container.querySelector('#recoil-results');
    if (!out) return;
    const u = units();
    const v = this.values.recoil;
    if (!(v.rifleKg > 0) || !(v.mvMs > 0)) return;
    const bulletKg = v.bulletGr * CONVERSIONS.gr;
    const powderKg = v.powderGr * CONVERSIONS.gr;
    const impulseNs = bulletKg * v.mvMs + powderKg * v.mvMs * 1.5;
    const recoilVelMs = impulseNs / v.rifleKg;
    const energyJ = 0.5 * v.rifleKg * recoilVelMs ** 2;
    const ftlb = UnitConverter.fromSI(energyJ, 'ft-lb');
    const [tone, level, text] = ftlb > 15
      ? ['bad', 'Heavy', 'Like a hunting magnum. Hard to spot your own hits.']
      : ftlb >= 5
        ? ['warn', 'Moderate', 'Typical for PRS rifles.']
        : ['ok', 'Light', 'Easy to spot your own hits through the scope.'];
    const velUnit = u.imp ? 'fps' : 'm/s';
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    out.innerHTML = `
      <div class="tool-verdict tone-${tone}">
        <span class="verdict-label">Free recoil energy ${toneBadge(tone, level)}</span>
        <span class="verdict-value">${fmtU(energyJ, u.energy)}</span>
        <span class="verdict-text">${text}</span>
      </div>
      <dl class="result-stats">
        <div><dt>Recoil velocity</dt><dd>${fixed(toUnit(recoilVelMs, velUnit), 2)} ${velUnit}</dd></div>
        <div><dt>Recoil impulse</dt><dd>${impulseNs.toFixed(2)} N·s</dd></div>
      </dl>
      <div class="recoil-scale" aria-hidden="true">
        <div class="recoil-track"><span class="recoil-marker" data-pos="${Math.min(100, (ftlb / 30) * 100).toFixed(1)}"></span></div>
        <div class="recoil-ticks"><span>Light</span><span>Moderate</span><span>Heavy</span></div>
      </div>
      <p class="field-hint">Levels: light under 5 ft·lb (6.8 J), moderate 5–15 ft·lb, heavy above 15 ft·lb (20 J).</p>`;
    out.querySelectorAll('[data-pos]').forEach((el) => el.style.setProperty('--pos', `${el.dataset.pos}%`));
  }

  // ---- view shell -------------------------------------------------------------------------------

  render() {
    this.fieldDefs = new Map();
    const active = TOOLS.find((t) => t.id === this.activeTool) || TOOLS[0];
    this.activeTool = active.id;
    const body = {
      truing: () => this.renderTruingWizard(),
      wez: () => this.renderWez(),
      group: () => this.renderGroupAnalyzer(),
      chrono: () => this.renderChrono(),
      milling: () => this.renderMilling(),
      recoil: () => this.renderRecoil(),
    }[active.id]();
    const hadFocus = this.container.querySelector('.tool-tab:focus');

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    this.container.innerHTML = `
      <div class="tools-view">
        <div class="view-header">
          <div>
            <h1>Tools</h1>
            <p>True your data, check loads and groups, and estimate distance and recoil.</p>
          </div>
        </div>
        <div class="tools-tabs lg-tabs" role="tablist" aria-label="Tools">
          ${TOOLS.map((t) => `<button type="button" role="tab" class="lg-tab tool-tab" id="tool-tab-${t.id}" data-tool="${t.id}" aria-controls="tool-panel" aria-selected="${t.id === active.id}" tabindex="${t.id === active.id ? 0 : -1}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
        </div>
        <section class="tool-panel" id="tool-panel" role="tabpanel" aria-labelledby="tool-tab-${active.id}">
          ${body}
        </section>
      </div>`;

    const tabs = Array.from(this.container.querySelectorAll('.tool-tab'));
    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tool !== this.activeTool) this.setTool(tab.dataset.tool);
      });
      tab.addEventListener('keydown', (e) => {
        const keys = { ArrowRight: idx + 1, ArrowLeft: idx - 1, Home: 0, End: tabs.length - 1 };
        if (!(e.key in keys)) return;
        e.preventDefault();
        const next = tabs[(keys[e.key] + tabs.length) % tabs.length];
        this.setTool(next.dataset.tool);
        this.container.querySelector(`#tool-tab-${next.dataset.tool}`)?.focus();
      });
    });
    if (hadFocus) this.container.querySelector(`#tool-tab-${active.id}`)?.focus();

    this._bindFields();
    switch (active.id) {
      case 'truing':
        this._initTruing();
        this._updateTruingResults();
        break;
      case 'wez':
        this.initWez();
        break;
      case 'group':
        this.initGroupCanvas();
        break;
      case 'chrono':
        this._initChrono();
        break;
      case 'milling':
        this._initMilling();
        break;
      case 'recoil':
        this.calcRecoil();
        break;
    }
  }
}
