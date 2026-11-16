/**
 * Ballistic Workbench - DOPE cards view.
 *
 * Builds printable range cards from the active rifle and conditions: a scope cap insert, a 3 x 5 in
 * wrist card, a stock tape, a turret tape, a match stage card (with a stage builder) and a full-page
 * data sheet. Every card is laid out in physical units (mm, in, pt) so it prints at its exact size;
 * on screen the preview is scaled to fit with CSS zoom (reset to 1 in styles/print.css).
 *
 * Layout: format tabs, then a settings column and a preview "desk" with the paper card on it. The
 * stage card adds a target editor below. All events are delegated from the view container (it is
 * shared with the other views, so destroy() removes them again).
 */

import { appState } from '../core/state.js';
import { esc, num } from '../core/escape.js';
import { shapeLike } from '../core/sanitize.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory, solveZeroAngle } from '../physics/solvers.js';
import { icon } from './icons.js';
import { toast } from './notify.js';
import { bindNumber, setFieldError } from './fields.js';

const PRS_STAGE_STORAGE_KEY = 'ballistic_workbench_prs_stage_v2';
const SETTINGS_KEY = 'ballistic_workbench_dope_settings_v1';

const PX_PER_MM = 96 / 25.4;
const RAD_TO_MOA = 10800 / Math.PI;
const M_PER_YD = 0.9144;
const MS_PER_MPH = 0.44704;

const SHAPES = {
  gong: 'Round gong',
  ipsc: 'IPSC torso',
  square: 'Square plate',
  diamond: 'Diamond plate',
  kyl: 'KYL rack (shrinking plates)',
};

const CARD_THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'green', label: 'Green' },
];
const LEGACY_THEMES = { 'tactical-night': 'dark', 'milspec-od': 'green', 'match-day': 'light' };

const STAGE_SIZES = [
  { id: 'portrait-3x5', label: '3 × 5 in portrait', short: '3 × 5 in', sub: 'portrait', widthMm: 76.2, maxZoom: 1.7 },
  { id: 'landscape-5x3', label: '5 × 3 in landscape', short: '5 × 3 in', sub: 'landscape', widthMm: 127, maxZoom: 1.35 },
  { id: 'full-page', label: 'Full page', short: 'Full page', sub: 'A4 or Letter', widthMm: 190, maxZoom: 1.05 },
];

const WIND_DIRECTIONS = [
  { deg: 90, label: 'From the right (3:00)' },
  { deg: 45, label: 'Front right (1:30)' },
  { deg: 135, label: 'Rear right (4:30)' },
  { deg: 0, label: 'Headwind (12:00)' },
  { deg: 180, label: 'Tailwind (6:00)' },
  { deg: 315, label: 'Front left (10:30)' },
  { deg: 225, label: 'Rear left (7:30)' },
  { deg: 270, label: 'From the left (9:00)' },
];

const SCOPE_CAP_PRESETS = [
  { mm: 39.9, label: 'Butler Creek #13 (39.9 mm)' },
  { mm: 42.2, label: 'Butler Creek #15 (42.2 mm)' },
  { mm: 43.9, label: 'Butler Creek #19 (43.9 mm)' },
  { mm: 45.7, label: 'Butler Creek #25 (45.7 mm)' },
  { mm: 49.8, label: 'Butler Creek #30 (49.8 mm)' },
  { mm: 50.7, label: 'Butler Creek #31 (50.7 mm)' },
  { mm: 53.3, label: 'Butler Creek #34 (53.3 mm)' },
  { mm: 58.7, label: 'Butler Creek #43 (58.7 mm)' },
];

const TURRET_PRESETS = [
  { circ: 94.2, label: '30 mm turret (94.2 mm around)' },
  { circ: 100.5, label: '32 mm turret (100.5 mm around)' },
  { circ: 106.8, label: '34 mm turret (106.8 mm around)' },
  { circ: 110.0, label: '35 mm turret (110.0 mm around)' },
];

/**
 * The six formats. maxRanges limits how many distances a card shows so the text stays legible;
 * widthMm / maxZoom size the on-screen preview.
 */
const FORMATS = [
  {
    id: 'scope-cap', label: 'Scope cap', hint: 'Round insert', icon: 'scope-cap', maxRanges: 12, maxZoom: 3.2,
    title: 'Scope cap insert',
    desc: 'A round card for the inside of a clear flip-up scope cap. Distance on the outer ring, elevation in the middle, clicks on the inner ring.',
  },
  {
    id: 'wrist-coach', label: 'Wrist card', hint: '3 × 5 in', icon: 'watch', maxRanges: 20, widthMm: 76.2, maxZoom: 1.6,
    title: 'Wrist card',
    desc: 'A 3 × 5 in table for a wrist sleeve: elevation, clicks, wind holds for three wind speeds and bullet speed.',
  },
  {
    id: 'stock-tape', label: 'Stock tape', hint: '180 × 32 mm', icon: 'tape', maxRanges: 11, widthMm: 180, maxZoom: 1.2,
    title: 'Stock tape',
    desc: 'A strip for the side of the stock: one column per distance with elevation, clicks and two wind holds.',
  },
  {
    id: 'turret-tape', label: 'Turret tape', hint: 'Wraps the turret', icon: 'turret', maxRanges: 16, maxZoom: 2.2,
    title: 'Turret tape',
    desc: 'A strip that wraps around the elevation turret, with each distance marked at the click it needs.',
  },
  {
    id: 'prs-stage', label: 'Stage card', hint: 'Match stage plan', icon: 'stage', maxRanges: 0,
    title: 'Stage card',
    desc: 'A plan for one match stage: targets in order, elevation and wind holds for lull, base and gust wind.',
  },
  {
    id: 'a4-sheet', label: 'Full page', hint: 'A4 or Letter', icon: 'file', maxRanges: 50, widthMm: 190, maxZoom: 1.05,
    title: 'Full page data sheet',
    desc: 'The full table on one page with drop, elevation, wind holds, speed and energy, plus reticle holds and space for notes.',
  },
];
const FORMAT_IDS = FORMATS.map((f) => f.id);
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

// Scope cap text styles as SVG presentation attributes (the CSP blocks <style> elements), so a
// saved SVG file looks the same as the preview
const CAP_TEXT = {
  'cap-dist': 'font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="900" fill="#111111"',
  'cap-elev': 'font-family="ui-monospace, Menlo, monospace" font-size="22" font-weight="800" fill="#0b4f8a"',
  'cap-clicks': 'font-family="ui-monospace, Menlo, monospace" font-size="15" font-weight="700" fill="#8a3b0b"',
};
const CAP_CENTER = 'font-family="system-ui, -apple-system, sans-serif" fill="#111111"';

/** A number with fixed decimals, or "—" when it is not finite (never prints NaN or Infinity). */
function fmt(val, dec = 1) {
  const n = Number(val);
  if (val === null || val === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < Math.pow(10, -dec) / 2) return (0).toFixed(dec);
  return n.toFixed(dec);
}
const fmtInt = (val) => fmt(val, 0);
/** Trims a number to at most `dec` decimals without trailing zeros (140 -> "140", 147.5 -> "147.5"). */
const fmtTrim = (val, dec = 1) => (Number.isFinite(Number(val)) ? String(Number(Number(val).toFixed(dec))) : '—');

/** Evenly spread subset of `list` (keeps the first and last item). */
function pickSubset(list, max) {
  if (!max || list.length <= max) return list.slice();
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

/** "1 shot", "2 shots". */
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const deepClone = (o) => JSON.parse(JSON.stringify(o));

/** Clock position for a wind direction in degrees (90 -> "3:00", 45 -> "1:30"). */
function clockLabel(deg) {
  const hours = (((Number(deg) || 0) % 360) + 360) % 360 / 30;
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export class DopeStudioView {
  constructor(containerElement) {
    this.container = containerElement;

    const saved = this._loadSettings();
    this.activeFormat = saved.format;
    this.scopeCapDiameterMm = saved.capMm;
    this.turretCircumferenceMm = saved.tapeCircMm;
    this.turretTapeHeightMm = saved.tapeHeightMm;
    this.turretClicksPerTurn = saved.clicksPerTurn;
    this.printOrientation = saved.orientation;
    this.cardTheme = saved.theme;
    this._undo = null;

    // Match stage presets (plain text; positions are listed in shooting order)
    this.presets = {
      'rooftop-barricade': {
        id: 'rooftop-barricade',
        name: 'Stage 4: Rooftop and barricade',
        timeLimitSec: 90,
        propsDescription: 'Tank trap (2), then cable spool (2), then barricade (3), then rooftop (3)',
        windBaseMs: 4.0,
        windLullMs: 2.0,
        windGustMs: 6.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'Center gong', shape: 'gong', distanceM: 380, widthCm: 30, heightCm: 30, rounds: 2, prop: 'Tank trap', notes: 'Center hold', offsetM: 0 },
          { id: 't2', name: 'IPSC left', shape: 'ipsc', distanceM: 520, widthCm: 45, heightCm: 75, rounds: 2, prop: 'Cable spool', notes: 'Left edge if gusting', offsetM: -18 },
          { id: 't3', name: 'Diamond plate', shape: 'diamond', distanceM: 640, widthCm: 30, heightCm: 30, rounds: 3, prop: 'Barricade', notes: 'Small plate, steady bag', offsetM: 15 },
          { id: 't4', name: 'Far gong', shape: 'gong', distanceM: 780, widthCm: 40, heightCm: 40, rounds: 3, prop: 'Rooftop', notes: 'Watch mirage and splash', offsetM: 5 },
        ],
      },
      'troop-line': {
        id: 'troop-line',
        name: 'Stage 2: Troop line',
        timeLimitSec: 90,
        propsDescription: 'Prone from the mat: 2 shots on each target, near to far (10 shots)',
        windBaseMs: 4.0,
        windLullMs: 2.0,
        windGustMs: 6.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: '300 m gong', shape: 'gong', distanceM: 300, widthCm: 30, heightCm: 30, rounds: 2, prop: 'Prone mat', notes: 'Fast cadence', offsetM: -12 },
          { id: 't2', name: '400 m gong', shape: 'gong', distanceM: 400, widthCm: 35, heightCm: 35, rounds: 2, prop: 'Prone mat', notes: 'Smooth trigger press', offsetM: -6 },
          { id: 't3', name: '500 m gong', shape: 'gong', distanceM: 500, widthCm: 40, heightCm: 40, rounds: 2, prop: 'Prone mat', notes: 'Check the wind flag', offsetM: 0 },
          { id: 't4', name: '600 m gong', shape: 'gong', distanceM: 600, widthCm: 45, heightCm: 45, rounds: 2, prop: 'Prone mat', notes: 'Follow through', offsetM: 8 },
          { id: 't5', name: '700 m gong', shape: 'gong', distanceM: 700, widthCm: 50, heightCm: 50, rounds: 2, prop: 'Prone mat', notes: 'Watch the trace', offsetM: 16 },
        ],
      },
      'kyl-rack': {
        id: 'kyl-rack',
        name: 'Stage 5: KYL rack',
        timeLimitSec: 90,
        propsDescription: 'Modified prone: 2 shots per plate, biggest to smallest, stop at the first miss',
        windBaseMs: 3.5,
        windLullMs: 1.5,
        windGustMs: 5.5,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: '30 cm plate', shape: 'kyl', distanceM: 400, widthCm: 30, heightCm: 30, rounds: 2, prop: 'Modified prone', notes: '10 points', offsetM: -16 },
          { id: 't2', name: '25 cm plate', shape: 'kyl', distanceM: 400, widthCm: 25, heightCm: 25, rounds: 2, prop: 'Modified prone', notes: '20 points', offsetM: -8 },
          { id: 't3', name: '20 cm plate', shape: 'kyl', distanceM: 400, widthCm: 20, heightCm: 20, rounds: 2, prop: 'Modified prone', notes: '30 points', offsetM: 0 },
          { id: 't4', name: '15 cm plate', shape: 'kyl', distanceM: 400, widthCm: 15, heightCm: 15, rounds: 2, prop: 'Modified prone', notes: '40 points, wait for a lull', offsetM: 8 },
          { id: 't5', name: '10 cm plate', shape: 'kyl', distanceM: 400, widthCm: 10, heightCm: 10, rounds: 2, prop: 'Modified prone', notes: '50 points', offsetM: 16 },
        ],
      },
      'far-to-near': {
        id: 'far-to-near',
        name: 'Stage 3: Far to near',
        timeLimitSec: 105,
        propsDescription: 'Tank trap (2), then spool (2), then barricade (3), then rooftop (3)',
        windBaseMs: 4.5,
        windLullMs: 2.0,
        windGustMs: 7.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'Far IPSC', shape: 'ipsc', distanceM: 750, widthCm: 45, heightCm: 75, rounds: 2, prop: 'Tank trap', notes: 'Shoot first, before the mirage builds', offsetM: 14 },
          { id: 't2', name: 'Middle diamond', shape: 'diamond', distanceM: 620, widthCm: 35, heightCm: 35, rounds: 2, prop: 'Spool', notes: 'Lock the support elbow', offsetM: -18 },
          { id: 't3', name: 'Middle square', shape: 'square', distanceM: 480, widthCm: 30, heightCm: 30, rounds: 3, prop: 'Barricade', notes: 'Quick dial, firm grip', offsetM: 8 },
          { id: 't4', name: 'Near gong', shape: 'gong', distanceM: 350, widthCm: 25, heightCm: 25, rounds: 3, prop: 'Rooftop', notes: 'Fast finish', offsetM: -10 },
        ],
      },
      'skills-stage': {
        id: 'skills-stage',
        name: 'Skills stage 1',
        timeLimitSec: 90,
        propsDescription: '2 steel targets: low barricade (3), then middle (4), then high (3)',
        windBaseMs: 4.0,
        windLullMs: 2.0,
        windGustMs: 6.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'Near steel', shape: 'gong', distanceM: 380, widthCm: 30, heightCm: 30, rounds: 5, prop: 'Low, middle, high barricade', notes: 'Main target (5 shots)', offsetM: -12 },
          { id: 't2', name: 'Far IPSC', shape: 'ipsc', distanceM: 580, widthCm: 45, heightCm: 75, rounds: 5, prop: 'Low, middle, high barricade', notes: 'Second target (5 shots)', offsetM: 16 },
        ],
      },
    };
    this.presetLabels = {
      'troop-line': 'Troop line (300–700 m)',
      'kyl-rack': 'KYL rack (400 m)',
      'far-to-near': 'Far to near',
      'skills-stage': 'Skills stage',
      'rooftop-barricade': 'Rooftop and barricade',
    };

    this.prsStage = this._loadStageState();

    // Every change that affects the numbers on the cards re-renders the view
    const keys = new Set(['units', 'displayUnits', 'profile', 'profiles', 'activeProfile', 'environment', 'activeEnvironment', 'target', 'solverConfig', 'import', 'projectiles', 'dopeRanges']);
    this.unsubscribe = appState.subscribe((state, changeKey) => {
      if (keys.has(changeKey)) this.render();
    });

    this._onClick = (e) => this._handleClick(e);
    this._onChange = (e) => this._handleChange(e);
    this._onKeydown = (e) => this._handleKeydown(e);
    this._onPointerOver = (e) => this._handleHover(e, true);
    this._onPointerOut = (e) => this._handleHover(e, false);
    this._onPointerDown = () => { this._pointerHeld = true; };
    this._onPointerUp = () => {
      this._pointerHeld = false;
      if (this._renderPending) {
        this._renderPending = false;
        this._scheduleRender();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerdown', this._onPointerDown, true);
      document.addEventListener('pointerup', this._onPointerUp, true);
      document.addEventListener('pointercancel', this._onPointerUp, true);
    }
    if (typeof this.container.addEventListener === 'function') {
      this.container.addEventListener('click', this._onClick);
      this.container.addEventListener('change', this._onChange);
      this.container.addEventListener('keydown', this._onKeydown);
      this.container.addEventListener('pointerover', this._onPointerOver);
      this.container.addEventListener('pointerout', this._onPointerOut);
    }

    this.render();
  }

  // Backward compatibility getter/setter for prsTargets
  get prsTargets() {
    return this.prsStage.targets;
  }
  set prsTargets(val) {
    if (this.prsStage) this.prsStage.targets = val;
  }

  /** Full rebuild (used after a theme change). */
  refresh() {
    this.render();
  }

  destroy() {
    clearTimeout(this._renderTimer);
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    if (typeof this.container.removeEventListener === 'function') {
      this.container.removeEventListener('click', this._onClick);
      this.container.removeEventListener('change', this._onChange);
      this.container.removeEventListener('keydown', this._onKeydown);
      this.container.removeEventListener('pointerover', this._onPointerOver);
      this.container.removeEventListener('pointerout', this._onPointerOut);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', this._onPointerDown, true);
      document.removeEventListener('pointerup', this._onPointerUp, true);
      document.removeEventListener('pointercancel', this._onPointerUp, true);
    }
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._onWindowResize && typeof window !== 'undefined') window.removeEventListener('resize', this._onWindowResize);
  }

  // ---- persistence ------------------------------------------------------------------------------

  _loadSettings() {
    const defaults = { format: 'a4-sheet', capMm: 43.9, tapeCircMm: 94.2, tapeHeightMm: 14, clicksPerTurn: 100, orientation: 'portrait-3x5', theme: 'light' };
    let parsed = null;
    try {
      parsed = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') : null;
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object') return defaults;
    const n = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    const theme = LEGACY_THEMES[parsed.theme] || parsed.theme;
    return {
      format: FORMAT_IDS.includes(parsed.format) ? parsed.format : defaults.format,
      capMm: n(parsed.capMm, 25, 85, defaults.capMm),
      tapeCircMm: n(parsed.tapeCircMm, 60, 180, defaults.tapeCircMm),
      tapeHeightMm: n(parsed.tapeHeightMm, 8, 25, defaults.tapeHeightMm),
      clicksPerTurn: Math.round(n(parsed.clicksPerTurn, 40, 200, defaults.clicksPerTurn)),
      orientation: STAGE_SIZES.some((s) => s.id === parsed.orientation) ? parsed.orientation : defaults.orientation,
      theme: CARD_THEMES.some((t) => t.id === theme) ? theme : defaults.theme,
    };
  }

  _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        format: this.activeFormat,
        capMm: this.scopeCapDiameterMm,
        tapeCircMm: this.turretCircumferenceMm,
        tapeHeightMm: this.turretTapeHeightMm,
        clicksPerTurn: this.turretClicksPerTurn,
        orientation: this.printOrientation,
        theme: this.cardTheme,
      }));
    } catch {
      // Storage blocked: the settings simply last for this visit
    }
  }

  _loadStageState() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(PRS_STAGE_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && Array.isArray(parsed.targets) && parsed.targets.length > 0) {
            // Rebuild the stage from known fields only (numbers finite, text capped)
            const template = this.presets['rooftop-barricade'];
            const stage = shapeLike(parsed, { ...template, targets: [] });
            stage.timeLimitSec = clamp(stage.timeLimitSec, 10, 600);
            stage.windDirectionDeg = clamp(stage.windDirectionDeg, 0, 359);
            for (const k of ['windBaseMs', 'windLullMs', 'windGustMs']) stage[k] = clamp(stage[k], 0, 40);
            stage.targets = parsed.targets.slice(0, 30).map((t, i) => {
              const clean = shapeLike(t, { ...template.targets[0], id: `t${i + 1}`, offsetM: (i % 2 === 0 ? -1 : 1) * 12 });
              if (!Object.hasOwn(SHAPES, clean.shape)) clean.shape = 'gong';
              clean.rounds = Math.max(1, Math.min(20, Math.round(clean.rounds)));
              clean.distanceM = clamp(clean.distanceM, 10, 2500);
              clean.widthCm = clamp(clean.widthCm, 1, 500);
              clean.heightCm = clamp(clean.heightCm, 1, 500);
              clean.offsetM = clamp(clean.offsetM, -100, 100);
              return clean;
            });
            return stage;
          }
        }
      } catch (e) {
        console.warn('Failed to parse saved PRS stage state:', e);
      }
    }
    return deepClone(this.presets['rooftop-barricade']);
  }

  _saveStageState() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(PRS_STAGE_STORAGE_KEY, JSON.stringify(this.prsStage));
      } catch (e) {
        console.error('Failed to save PRS stage state:', e);
      }
    }
  }

  setFormat(format) {
    if (!FORMAT_IDS.includes(format)) return;
    this.activeFormat = format;
    this._saveSettings();
    this.render();
  }

  setPrintOrientation(orientation) {
    if (!STAGE_SIZES.some((s) => s.id === orientation)) return;
    this.printOrientation = orientation;
    this._saveSettings();
    this.render();
  }

  setTheme(theme) {
    const id = LEGACY_THEMES[theme] || theme;
    if (!CARD_THEMES.some((t) => t.id === id)) return;
    this.cardTheme = id;
    this._saveSettings();
    this.render();
  }

  loadPreset(presetKey) {
    if (!this.presets[presetKey]) return;
    this._remember(`Loaded the “${this.presetLabels[presetKey] || presetKey}” preset.`, 'settings');
    this.prsStage = deepClone(this.presets[presetKey]);
    this._saveStageState();
    this.render();
  }

  // ---- units ------------------------------------------------------------------------------------

  /** Display units for this render, from Settings (system units + display units). */
  _units() {
    const s = appState.state;
    const du = s.displayUnits || {};
    const imp = s.systemUnits === 'imperial';
    const yd = (du.distance || (imp ? 'yd' : 'm')) === 'yd';
    const mph = (du.windSpeed || (imp ? 'mph' : 'm/s')) === 'mph';
    const fps = (du.velocity || (imp ? 'fps' : 'm/s')) === 'fps';
    const inch = (du.dropOffset || (imp ? 'in' : 'cm')) === 'in';
    const ftlb = (du.energy || (imp ? 'ft-lb' : 'J')) === 'ft-lb';
    const degF = (du.temperature || (imp ? 'F' : 'C')) === 'F';
    const inHg = (du.pressure || (imp ? 'inHg' : 'hPa')) === 'inHg';
    const elevMoa = (du.elevationAngle || 'MRAD') === 'MOA';
    const windMoa = (du.windageAngle || du.elevationAngle || 'MRAD') === 'MOA';
    return {
      imp,
      dist: yd ? 'yd' : 'm',
      fromM: (m) => (yd ? m / M_PER_YD : m),
      toM: (d) => (yd ? d * M_PER_YD : d),
      size: inch ? 'in' : 'cm',
      fromCm: (cm) => (inch ? cm / 2.54 : cm),
      toCm: (v) => (inch ? v * 2.54 : v),
      vel: fps ? 'fps' : 'm/s',
      fromMs: (v) => (fps ? v / 0.3048 : v),
      wind: mph ? 'mph' : 'm/s',
      windFromMs: (v) => (mph ? v / MS_PER_MPH : v),
      windToMs: (v) => (mph ? v * MS_PER_MPH : v),
      windSpeeds: mph ? [5, 10, 15] : [2, 4, 6],
      tapeSpeeds: mph ? [10, 20] : [4, 8],
      energy: ftlb ? 'ft·lb' : 'J',
      fromJ: (j) => (ftlb ? j / 1.3558179483314 : j),
      alt: yd || imp ? 'ft' : 'm',
      fromAltM: (m) => (yd || imp ? m / 0.3048 : m),
      temp: degF ? '°F' : '°C',
      fromC: (c) => (degF ? (c * 9) / 5 + 32 : c),
      press: inHg ? 'inHg' : 'hPa',
      fromHpa: (h) => (inHg ? h / 33.863886666667 : h),
      pressDec: inHg ? 2 : 0,
      elev: elevMoa ? 'MOA' : 'MRAD',
      windAng: windMoa ? 'MOA' : 'MRAD',
      elevFromRad: (r) => (elevMoa ? r * RAD_TO_MOA : r * 1000),
      windFromRad: (r) => (windMoa ? r * RAD_TO_MOA : r * 1000),
    };
  }

  // ---- ballistics -------------------------------------------------------------------------------

  /**
   * Trajectory for the active rifle and environment. With windSpeedMs / windDirDeg the wind is
   * replaced by one uniform wind (used for the stage card's lull, base and gust and for the wind
   * hold columns); without them the active environment is used as it is.
   */
  computeDope(stepM = 10, maxRangeM = 1200, customWindSpeedMs = null, customWindDirDeg = null) {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const config = appState.state.solverConfig || {};
    const algorithm = typeof appState.solverAlgorithm === 'function' ? appState.solverAlgorithm() : (profile.bullet?.dragModel === 'G1' ? 'G1' : 'G7');
    const atmos = getAtmosphericConditions({
      pressurePa: env.pressureHpa * 100,
      tempK: env.temperatureC + 273.15,
      relativeHumidity: env.humidityPercent / 100,
      altitudeM: env.altitudeM,
    });

    const testEnv = customWindSpeedMs === null && customWindDirDeg === null
      ? env
      : {
        ...env,
        windSpeedMs: customWindSpeedMs ?? env.windSpeedMs ?? 0,
        windDirectionDeg: customWindDirDeg ?? env.windDirectionDeg ?? 90,
        windZones: [],
      };

    // One zero angle per rifle/atmosphere, shared by the lull/base/gust solves
    const zeroKey = `${profile.id}|${profile.zeroDistanceM}|${profile.muzzleVelocityMs}|${profile.sightHeightM}|${atmos.densityKgM3}|${algorithm}|${profile.bullet?.bcG7}|${profile.bullet?.bcG1}|${profile.bullet?.weightGr}`;
    if (this._zeroKey !== zeroKey) {
      this._zeroKey = zeroKey;
      this._zeroAngle = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs, algorithm);
    }

    const sol = solveTrajectory({
      profile: { ...profile, zeroAngleRad: this._zeroAngle },
      environment: testEnv,
      airDensity: atmos.densityKgM3,
      speedOfSound: atmos.speedOfSoundMs,
      algorithm,
      stepM,
      maxRangeM,
      includeSpinDrift: config.includeSpinDrift ?? true,
      includeCoriolis: config.includeCoriolis ?? true,
      includeAerodynamicJump: config.includeAerodynamicJump ?? true,
    });

    return {
      profile,
      env: testEnv,
      atmos,
      trajectory: sol.trajectory,
      sysUnits: appState.state.systemUnits,
      dispUnits: appState.state.displayUnits,
    };
  }

  /**
   * Trajectory values at an exact distance, interpolated linearly between the two nearest table
   * rows. Returns null outside the computed trajectory (e.g. the bullet stopped short).
   */
  interpolateTrajectory(traj, distanceM) {
    if (!Array.isArray(traj) || traj.length < 2 || !Number.isFinite(distanceM)) return null;
    const last = traj[traj.length - 1];
    if (distanceM < traj[0].distanceM || distanceM > last.distanceM + 1e-6) return null;
    let i = 0;
    while (i < traj.length - 2 && traj[i + 1].distanceM < distanceM) i++;
    const p0 = traj[i];
    const p1 = traj[i + 1];
    const span = p1.distanceM - p0.distanceM;
    const f = span > 0 ? clamp((distanceM - p0.distanceM) / span, 0, 1) : 0;
    const out = { distanceM };
    for (const key of Object.keys(p0)) {
      if (key === 'distanceM') continue;
      const a = p0[key];
      const b = p1[key];
      if (typeof a === 'number' && typeof b === 'number') out[key] = a + f * (b - a);
    }
    // Descent angle (slope of the path against the line of sight), used for danger space
    out.slope = span > 0 ? (p1.dropM - p0.dropM) / span : 0;
    return out;
  }

  /** Clicks for an angle, from the optic's click value (not the unit system). */
  _clicks(angleRad, profile) {
    const clickRad = num(profile.optic?.clickValueRad, 0.0001) || 0.0001;
    return Math.round(angleRad / clickRad);
  }

  /**
   * Rows for the range-based cards. Wind holds are wind-only (a 90° crosswind solve minus a calm
   * solve), so they scale cleanly to other wind speeds; drift with no wind is listed separately.
   */
  _rangeRows(distancesM) {
    const u = this._units();
    const maxNeeded = Math.max(300, ...distancesM, ...this._reticleDefaults(u)) + 20;
    const maxRangeM = Math.min(3000, maxNeeded);
    const refMs = 4;
    const base = this.computeDope(10, maxRangeM);
    const calm = this.computeDope(10, maxRangeM, 0, 90);
    const ref = this.computeDope(10, maxRangeM, refMs, 90);
    const profile = base.profile;

    const rowAt = (d) => {
      const p = this.interpolateTrajectory(base.trajectory, d);
      const c = this.interpolateTrajectory(calm.trajectory, d);
      const r = this.interpolateTrajectory(ref.trajectory, d);
      if (!p || !c || !r) return null;
      const windPerMsRad = Math.abs(r.windageRad - c.windageRad) / refMs;
      const windHold = (speedDisp) => u.windFromRad(windPerMsRad * u.windToMs(speedDisp));
      return {
        distanceM: d,
        dist: u.fromM(d),
        dropM: p.dropM,
        elevRad: p.elevationRad,
        elev: u.elevFromRad(p.elevationRad),
        clicks: this._clicks(p.elevationRad, profile),
        windHold,
        noWindDriftM: c.driftM,
        velocityMs: p.velocityMs,
        mach: p.mach,
        energyJ: p.energyJ,
        tofS: p.tofS,
      };
    };
    const rows = distancesM.map(rowAt).filter(Boolean);
    return { rows, rowAt, dope: base, skipped: distancesM.length - rows.length };
  }

  _reticleDefaults(u) {
    // Distances for the reticle holds on the full page (every 100 m / yd, 200-1000)
    return [200, 300, 400, 500, 600, 700, 800, 900, 1000].map((d) => u.toM(d));
  }

  /** Default distances (metres) for a format, in round numbers of the display unit. */
  _defaultRanges(formatId, u) {
    const grid = (from, to, step) => {
      const out = [];
      for (let d = from; d <= to + 1e-9; d += step) out.push(u.toM(d));
      return out;
    };
    switch (formatId) {
      case 'wrist-coach': return grid(100, 1000, 50);
      case 'stock-tape': return grid(200, 1000, 100);
      case 'turret-tape': return grid(100, 1500, 100);
      case 'a4-sheet': return grid(50, u.dist === 'yd' ? 1300 : 1200, 50);
      case 'scope-cap':
      default: return grid(100, 1000, 100);
    }
  }

  /** Which distances a format uses: the ones ticked in the Solver, or the defaults. */
  _rangesFor(fmtDef, u) {
    const raw = Array.isArray(appState.state.customDopeRanges) ? appState.state.customDopeRanges : [];
    const custom = [...new Set(raw.filter((d) => Number.isFinite(d) && d > 0 && d <= 5000))].sort((a, b) => a - b);
    const fromSolver = custom.length > 0;
    const all = fromSolver ? custom : this._defaultRanges(fmtDef.id, u);
    const shown = pickSubset(all, fmtDef.maxRanges);
    return { fromSolver, all, shown };
  }

  /**
   * Ballistics for each stage target across lull, base and gust wind.
   */
  computeStageBallistics(stage, baseDope, lullDope, gustDope, profile, isImperial) {
    const u = this._units();
    if (typeof isImperial === 'boolean' && isImperial !== u.imp) {
      // Callers may force a unit system (tests); keep distances and sizes consistent with it
      Object.assign(u, isImperial
        ? { dist: 'yd', fromM: (m) => m / M_PER_YD, size: 'in', fromCm: (cm) => cm / 2.54, vel: 'fps', fromMs: (v) => v / 0.3048, energy: 'ft·lb', fromJ: (j) => j / 1.3558179483314 }
        : { dist: 'm', fromM: (m) => m, size: 'cm', fromCm: (cm) => cm, vel: 'm/s', fromMs: (v) => v, energy: 'J', fromJ: (j) => j });
    }

    return stage.targets.map((t, idx) => {
      const pBase = this.interpolateTrajectory(baseDope.trajectory, t.distanceM);
      const pLull = this.interpolateTrajectory(lullDope.trajectory, t.distanceM);
      const pGust = this.interpolateTrajectory(gustDope.trajectory, t.distanceM);

      const widthCm = num(t.widthCm, 30);
      const heightCm = num(t.heightCm, widthCm);
      const distM = Math.max(1, num(t.distanceM, 100));

      // Danger space: how far the range estimate can be off and still hit, aiming at the centre.
      // Total depth = target height / descent angle (slope of the path at the target).
      const targetHeightM = Math.max(0.02, heightCm / 100);
      const slope = pBase ? Math.abs(pBase.slope) : NaN;
      const dangerSpaceM = Number.isFinite(slope) ? Math.min(1000, targetHeightM / Math.max(slope, 1e-4)) : NaN;

      const hold = (p) => (p ? Math.abs(u.windFromRad(p.windageRad)) : NaN);
      const isHoldRight = pBase ? pBase.windageRad >= 0 : true;

      const mradW = (widthCm / 100 / distM) * 1000;
      const mradH = (heightCm / 100 / distM) * 1000;
      const ang = (mrad) => (u.windAng === 'MOA' ? mrad * (RAD_TO_MOA / 1000) : mrad);

      return {
        ...t,
        index: idx + 1,
        displayDistance: Math.round(u.fromM(distM)),
        displayDistUnit: u.dist,
        displayWidth: fmtTrim(u.fromCm(widthCm), 1),
        displayHeight: fmtTrim(u.fromCm(heightCm), 1),
        displaySizeUnit: u.size,
        angularSizeDisplay: `${fmt(ang(mradW), 1)} × ${fmt(ang(mradH), 1)} ${u.windAng}`,
        elevationRad: pBase ? pBase.elevationRad : NaN,
        dialValue: pBase ? fmt(u.elevFromRad(pBase.elevationRad), 1) : '—',
        dialUnit: u.elev,
        clicks: pBase ? this._clicks(pBase.elevationRad, profile) : NaN,
        dangerSpaceDisplay: Math.round(u.fromM(dangerSpaceM)),
        dangerSpaceM,
        lullHold: fmt(hold(pLull), 1),
        baseHold: fmt(hold(pBase), 1),
        gustHold: fmt(hold(pGust), 1),
        holdDirLabel: isHoldRight ? 'R' : 'L',
        tofS: pBase ? fmt(pBase.tofS, 2) : '—',
        velocity: pBase ? fmtInt(u.fromMs(pBase.velocityMs)) : '—',
        velocityUnit: u.vel,
        energy: pBase ? fmtInt(u.fromJ(pBase.energyJ)) : '—',
        energyUnit: u.energy,
      };
    });
  }

  // ---- shared pieces ----------------------------------------------------------------------------

  /** Rifle and conditions summary, formatted and escaped. */
  _rifleInfo(dope, u) {
    const p = dope.profile;
    const env = dope.env;
    return {
      name: esc(p.name),
      caliber: esc(p.caliber),
      bullet: esc(p.bullet?.name || ''),
      weight: `${fmtTrim(num(p.bullet?.weightGr, NaN), 1)} gr`,
      mv: `${fmtInt(u.fromMs(num(p.muzzleVelocityMs, NaN)))} ${u.vel}`,
      zero: `${fmtInt(u.fromM(num(p.zeroDistanceM, NaN)))} ${u.dist}`,
      sight: `${fmt(u.fromCm(num(p.sightHeightM, NaN) * 100), u.size === 'in' ? 2 : 1)} ${u.size}`,
      da: `${fmtInt(u.fromAltM(num(dope.atmos?.densityAltitudeM, NaN)))} ${u.alt}`,
      temp: `${fmtInt(u.fromC(num(env.temperatureC, NaN)))} ${u.temp}`,
      press: `${fmt(u.fromHpa(num(env.pressureHpa, NaN)), u.pressDec)} ${u.press}`,
      optic: esc(p.optic?.model || '—'),
      click: esc(p.optic?.clickName || '0.1 MRAD'),
      twist: `1:${fmtTrim(num(p.twistRateIn, NaN), 1)} in${p.twistDirection ? `, ${esc(String(p.twistDirection).toLowerCase())}` : ''}`,
      envName: esc(env.name || ''),
    };
  }

  _ruler() {
    const ticks = [];
    for (let mm = 0; mm <= 50; mm++) {
      const len = mm % 10 === 0 ? 36 : mm % 5 === 0 ? 20 : 10;
      ticks.push(`<line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="${len}" />`);
    }
    const labels = [0, 10, 20, 30, 40, 50].map((mm) => `<text x="${mm === 50 ? mm * 4 - 2 : mm * 4 + 2}" y="31" text-anchor="${mm === 50 ? 'end' : 'start'}">${mm}</text>`).join('');
    return `
      <figure class="calibration-ruler-strip">
        <svg class="calibration-svg" width="50mm" height="9mm" viewBox="0 0 200 36" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="50 millimetre scale bar">
          <rect x="0.5" y="0.5" width="199" height="35" fill="#ffffff" stroke="#111111" stroke-width="1" />
          <g stroke="#111111" stroke-width="1">${ticks.join('')}</g>
          <g font-family="ui-monospace, Menlo, monospace" font-size="9" fill="#111111">${labels}</g>
        </svg>
        <figcaption class="ruler-title">Print scale check: this bar should measure 50 mm</figcaption>
      </figure>`;
  }

  _cropMarks() {
    return '<span class="card-crop-corner crop-tl" aria-hidden="true"></span><span class="card-crop-corner crop-tr" aria-hidden="true"></span><span class="card-crop-corner crop-bl" aria-hidden="true"></span><span class="card-crop-corner crop-br" aria-hidden="true"></span>';
  }

  /** Older callers (tests) pass just the dope object: fill in default rows and units. */
  _cardArgs(fmtId, rows, dope, u) {
    if (Array.isArray(rows)) return { rows, dope, u, rowAt: null };
    const units = this._units();
    const r = this._rangeRows(pickSubset(this._defaultRanges(fmtId, units), FORMATS.find((f) => f.id === fmtId)?.maxRanges));
    return { rows: r.rows, dope: r.dope, u: units, rowAt: r.rowAt };
  }

  // ---- scope cap --------------------------------------------------------------------------------

  renderScopeCapSvg(rowsIn, dopeIn, uIn) {
    const { rows, dope, u } = this._cardArgs('scope-cap', rowsIn, dopeIn, uIn);
    const d = this.scopeCapDiameterMm;
    const info = this._rifleInfo(dope, u);
    const n = rows.length;
    let labels = '';
    rows.forEach((r, idx) => {
      // Spread the labels over a 280° arc, starting upper left and running clockwise
      const angleDeg = n > 1 ? -140 + (idx / (n - 1)) * 280 : -90;
      const a = (angleDeg * Math.PI) / 180;
      const at = (rad) => [250 + rad * Math.cos(a), 250 + rad * Math.sin(a)];
      let rot = angleDeg + 90;
      if (rot > 90 && rot < 270) rot -= 180;
      const [t1x, t1y] = at(241);
      const [t2x, t2y] = at(228);
      const label = (rad, cls, text) => {
        const [x, y] = at(rad);
        return `<text ${CAP_TEXT[cls]} transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)})" text-anchor="middle" dominant-baseline="central">${text}</text>`;
      };
      labels += `<line x1="${t1x.toFixed(1)}" y1="${t1y.toFixed(1)}" x2="${t2x.toFixed(1)}" y2="${t2y.toFixed(1)}" stroke="#111111" stroke-width="3" stroke-linecap="round" />`;
      labels += label(210, 'cap-dist', fmtInt(r.dist));
      labels += label(170, 'cap-elev', fmt(r.elev, 1));
      labels += label(134, 'cap-clicks', fmtInt(r.clicks));
    });

    return `
      <div class="scope-cap-print-container paper" data-cap-diameter-mm="${d}">
        <svg viewBox="0 0 500 500" class="scope-cap-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Scope cap insert, ${d} millimetres across, ${n} distances">
          <circle cx="250" cy="250" r="247" fill="#ffffff" stroke="#111111" stroke-width="2" stroke-dasharray="7 5" />
          <circle cx="250" cy="250" r="241" fill="none" stroke="#111111" stroke-width="2.5" />
          <circle cx="250" cy="250" r="190" fill="none" stroke="#9aa3ad" stroke-width="1.2" />
          <circle cx="250" cy="250" r="152" fill="none" stroke="#c4cad1" stroke-width="1" stroke-dasharray="4 3" />
          <circle cx="250" cy="250" r="116" fill="#ffffff" stroke="#6b7480" stroke-width="2" />
          <text ${CAP_CENTER} x="250" y="176" text-anchor="middle" font-size="24" font-weight="900">${info.caliber}</text>
          <text ${CAP_CENTER} x="250" y="203" text-anchor="middle" font-size="16" font-weight="700">${info.weight} · ${info.mv}</text>
          <text ${CAP_CENTER} x="250" y="227" text-anchor="middle" font-size="15" font-weight="600">Zero ${info.zero}</text>
          <rect x="146" y="243" width="208" height="30" rx="15" fill="#0b4f8a" />
          <text x="250" y="258" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="14" font-weight="800" fill="#ffffff">${u.dist} · ${u.elev} · clicks</text>
          <text ${CAP_CENTER} x="250" y="294" text-anchor="middle" font-size="13" font-weight="600">${info.click} per click</text>
          <text ${CAP_CENTER} x="250" y="316" text-anchor="middle" font-size="13" font-weight="600">DA ${info.da} · Ø ${fmtTrim(d, 1)} mm</text>
          ${labels}
        </svg>
      </div>`;
  }

  // ---- wrist card -------------------------------------------------------------------------------

  renderWristCoach(rowsIn, dopeIn, uIn) {
    const { rows, dope, u } = this._cardArgs('wrist-coach', rowsIn, dopeIn, uIn);
    const info = this._rifleInfo(dope, u);
    const speeds = u.windSpeeds;
    return `
      <div class="wrist-coach-card print-sheet paper">
        ${this._cropMarks()}
        <div class="coach-header">
          <div class="coach-title-block">
            <span class="coach-title">${info.name}</span>
            <span class="coach-spec">${info.caliber} · ${info.weight} · ${info.mv}</span>
          </div>
          <div class="coach-meta">
            <span>Zero ${info.zero}</span>
            <span>DA ${info.da}</span>
          </div>
        </div>
        <table class="coach-table">
          <thead>
            <tr>
              <th scope="col">Range</th>
              <th scope="col">Elev.</th>
              <th scope="col">Clicks</th>
              <th scope="colgroup" colspan="${speeds.length}" class="coach-wind-head">Wind hold</th>
              <th scope="col">Speed</th>
            </tr>
            <tr class="sub-header-row">
              <th scope="col">${u.dist}</th>
              <th scope="col">${u.elev}</th>
              <th scope="col">${info.click}</th>
              ${speeds.map((s) => `<th scope="col">${s} ${u.wind}</th>`).join('')}
              <th scope="col">${u.vel}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td class="cell-dist">${fmtInt(r.dist)}</td>
                <td class="cell-elev">${fmt(r.elev, 1)}</td>
                <td class="cell-clk">${fmtInt(r.clicks)}</td>
                ${speeds.map((s, i) => `<td class="${i === 1 ? 'cell-wind' : ''}">${fmt(r.windHold(s), 1)}</td>`).join('')}
                <td class="cell-vel">${fmtInt(u.fromMs(r.velocityMs))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="coach-footer-note">Wind holds: full-value crosswind (3 or 9 o’clock), wind only. ${esc(info.envName)}</p>
      </div>`;
  }

  // ---- stock tape -------------------------------------------------------------------------------

  renderStockTape(rowsIn, dopeIn, uIn) {
    const { rows, dope, u } = this._cardArgs('stock-tape', rowsIn, dopeIn, uIn);
    const info = this._rifleInfo(dope, u);
    const [w1, w2] = u.tapeSpeeds;
    return `
      <div class="stock-tape-strip print-sheet paper">
        <div class="tape-header">
          <span class="tape-header-weapon">${info.caliber} · ${info.weight}</span>
          <span class="tape-header-meta">${info.mv} · Zero ${info.zero} · DA ${info.da} · ${u.elev}, clicks ${info.click}</span>
        </div>
        <table class="tape-matrix-table">
          <thead>
            <tr>
              <th scope="row" class="tape-label-col">Range ${u.dist}</th>
              ${rows.map((r) => `<th scope="col">${fmtInt(r.dist)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="tape-row-elev">
              <th scope="row" class="tape-label-col">Elev. ${u.elev}</th>
              ${rows.map((r) => `<td class="tape-cell-elev">${fmt(r.elev, 1)}</td>`).join('')}
            </tr>
            <tr class="tape-row-clk">
              <th scope="row" class="tape-label-col">Clicks</th>
              ${rows.map((r) => `<td class="tape-cell-clk">${fmtInt(r.clicks)}</td>`).join('')}
            </tr>
            <tr class="tape-row-wind">
              <th scope="row" class="tape-label-col">Wind ${w1} ${u.wind}</th>
              ${rows.map((r) => `<td>${fmt(r.windHold(w1), 1)}</td>`).join('')}
            </tr>
            <tr class="tape-row-gust">
              <th scope="row" class="tape-label-col">Wind ${w2} ${u.wind}</th>
              ${rows.map((r) => `<td>${fmt(r.windHold(w2), 1)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  // ---- turret tape ------------------------------------------------------------------------------

  /** Returns the tape markup; this._turretOffTurn counts distances that need more than one turn. */
  renderTurretTape(rowsIn, dopeIn, uIn) {
    const { rows, dope } = this._cardArgs('turret-tape', rowsIn, dopeIn, uIn);
    const circMm = this.turretCircumferenceMm;
    const heightMm = this.turretTapeHeightMm;
    const total = this.turretClicksPerTurn;
    const pxPerMm = 4;
    const W = circMm * pxPerMm;
    const H = heightMm * pxPerMm;
    const clickRad = num(dope.profile.optic?.clickValueRad, 0.0001) || 0.0001;
    const opticMoa = /moa/i.test(dope.profile.optic?.clickName || '');

    let ticks = '';
    let numbers = '';
    for (let c = 0; c <= total; c++) {
      const x = (c / total) * W;
      const major = c % 10 === 0;
      const medium = !major && c % 5 === 0;
      const len = H * (major ? 0.42 : medium ? 0.28 : 0.16);
      ticks += `<line x1="${x.toFixed(1)}" y1="${H}" x2="${x.toFixed(1)}" y2="${(H - len).toFixed(1)}" stroke-width="${major ? 1.6 : 1}" />`;
      if (major && c > 0 && c < total) {
        const ang = c * clickRad;
        const v = opticMoa ? ang * RAD_TO_MOA : ang * 1000;
        numbers += `<text x="${x.toFixed(1)}" y="${(H - len - 3).toFixed(1)}" text-anchor="middle">${fmtTrim(v, 1)}</text>`;
      }
    }

    // Range marks: distance in hundreds at the click it needs; two lanes avoid overlaps
    const tagW = 22;
    const lanes = [-Infinity, -Infinity];
    let marks = '';
    let offTurn = 0;
    rows.forEach((r) => {
      if (!(r.clicks > 0)) return;
      if (r.clicks > total) { offTurn++; return; }
      const x = (r.clicks / total) * W;
      const lane = x - lanes[0] >= tagW ? 0 : x - lanes[1] >= tagW ? 1 : -1;
      if (lane < 0) return;
      lanes[lane] = x;
      const y = 2 + lane * 15;
      marks += `
        <g class="turret-range-tag">
          <line x1="${x.toFixed(1)}" y1="${y + 12}" x2="${x.toFixed(1)}" y2="${(H * 0.55).toFixed(1)}" stroke="#0b4f8a" stroke-width="1" stroke-dasharray="2 2" />
          <rect x="${(x - tagW / 2 + 1).toFixed(1)}" y="${y}" width="${tagW - 2}" height="12" rx="2" fill="#0b4f8a" />
          <text x="${x.toFixed(1)}" y="${y + 9}" text-anchor="middle" fill="#ffffff" font-weight="700">${fmtTrim(r.dist / 100, 1)}</text>
        </g>`;
    });

    const html = `
      <div class="turret-tape-preview-wrapper print-sheet paper" data-tape-circ-mm="${circMm}" data-tape-height-mm="${heightMm}">
        <svg id="turret-tape-svg" width="${circMm}mm" height="${heightMm}mm" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Turret tape, ${circMm} millimetres long">
          <rect class="tape-bg" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="#ffffff" stroke="#111111" stroke-width="1" />
          <g stroke="#111111">${ticks}</g>
          <g font-family="ui-monospace, Menlo, monospace" font-size="9" font-weight="700" fill="#333333">${numbers}</g>
          <g class="turret-zero-marker">
            <line x1="1.5" y1="0" x2="1.5" y2="${H}" stroke="#b42318" stroke-width="2.5" />
            <rect x="3" y="${H - 14}" width="28" height="12" rx="2" fill="#b42318" />
            <text x="17" y="${H - 5}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="8" font-weight="800" fill="#ffffff">ZERO</text>
          </g>
          <g class="turret-dir-arrow-group" transform="translate(${Math.max(W - 50, 36).toFixed(1)} ${H - 16})">
            <rect x="0" y="0" width="46" height="13" rx="2" fill="#ffffff" stroke="#111111" stroke-width="0.8" />
            <text x="6" y="9.5" font-family="system-ui, sans-serif" font-size="8.5" font-weight="800" fill="#111111">UP</text>
            <path d="M 22 6.5 H 39 M 35 3 L 39 6.5 L 35 10" fill="none" stroke="#111111" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </g>
          <g font-family="ui-monospace, Menlo, monospace" font-size="9">${marks}</g>
        </svg>
      </div>`;
    this._turretOffTurn = offTurn;
    return html;
  }

  // ---- full page --------------------------------------------------------------------------------

  renderA4ReticleHoldReference(rowAt, u) {
    const ref = u.windSpeeds[1];
    const points = this._reticleDefaults(u).map(rowAt).filter(Boolean);
    return `
      <section class="a4-reticle-hold-section">
        <h3 class="a4-section-title">Reticle holds <span class="a4-section-note">elevation in ${u.elev}, wind in ${u.windAng} for a ${ref} ${u.wind} full-value crosswind</span></h3>
        <div class="reticle-tree-grid">
          ${points.map((r) => `
            <div class="reticle-tree-node">
              <span class="node-dist">${fmtInt(r.dist)} ${u.dist}</span>
              <span class="node-elev">Elev. ${fmt(r.elev, 1)}</span>
              <span class="node-wind">Wind ${fmt(r.windHold(ref), 1)}</span>
            </div>`).join('')}
        </div>
      </section>`;
  }

  renderA4ShooterNotesGrid(u, info) {
    const blank = '<span class="notes-blank"></span>';
    return `
      <section class="a4-notes-section">
        <h3 class="a4-section-title">Notes</h3>
        <div class="a4-notes-grid">
          <div class="notes-box">
            <span class="notes-box-title">Cold bore and zero check</span>
            <div class="notes-line-entry">Date and time ${blank}</div>
            <div class="notes-line-entry">Temperature / DA ${blank}</div>
            <div class="notes-line-entry">Zero group at ${info.zero}: up/down ${blank} left/right ${blank}</div>
          </div>
          <div class="notes-box">
            <span class="notes-box-title">Chronograph</span>
            <div class="notes-line-entry">1 ${blank} 2 ${blank} 3 ${blank} 4 ${blank} 5 ${blank}</div>
            <div class="notes-line-entry">6 ${blank} 7 ${blank} 8 ${blank} 9 ${blank} 10 ${blank}</div>
            <div class="notes-line-entry">Average ${blank} ${u.vel} · SD ${blank} · ES ${blank}</div>
          </div>
          <div class="notes-box">
            <span class="notes-box-title">Wind calls</span>
            <div class="notes-line-entry">Mirage angle ${blank} Speed ${blank} ${u.wind}</div>
            <div class="notes-line-entry">Lull ${blank} Gust ${blank}</div>
            <div class="notes-line-entry">Direction ${blank}</div>
          </div>
          <div class="notes-box">
            <span class="notes-box-title">Terrain and updraft notes</span>
            <div class="notes-line-entry">${blank}</div>
            <div class="notes-line-entry">${blank}</div>
            <div class="notes-line-entry">${blank}</div>
          </div>
        </div>
      </section>`;
  }

  renderA4DataSheet(rowsIn, rowAtIn, dopeIn, uIn) {
    const compat = Array.isArray(rowsIn) ? null : this._cardArgs('a4-sheet', null);
    const rows = compat ? compat.rows : rowsIn;
    const rowAt = compat ? compat.rowAt : rowAtIn;
    const dope = compat ? compat.dope : dopeIn;
    const u = compat ? compat.u : uIn;
    const info = this._rifleInfo(dope, u);
    const speeds = u.windSpeeds;
    const dropUnit = u.size;
    const dropDec = 1;
    // Drift with no wind is spin drift (and Coriolis); point-mass models have none, so the column is left out
    const showDrift = rows.some((r) => Math.abs(u.fromCm(r.noWindDriftM * 100)) >= 0.05);
    return `
      <div class="a4-data-sheet print-sheet paper">
        <header class="sheet-title-banner">
          <h2 class="sheet-title">Ballistic data sheet</h2>
          <dl class="sheet-meta-grid">
            <div><dt>Rifle:</dt><dd>${info.name}</dd></div>
            <div><dt>Caliber:</dt><dd>${info.caliber}</dd></div>
            <div><dt>Bullet:</dt><dd>${info.bullet} (${info.weight})</dd></div>
            <div><dt>Muzzle velocity:</dt><dd>${info.mv}</dd></div>
            <div><dt>Optic:</dt><dd>${info.optic || '—'}, ${info.click} per click</dd></div>
            <div><dt>Zero:</dt><dd>${info.zero}, sight height ${info.sight}</dd></div>
            <div><dt>Conditions:</dt><dd>${info.temp}, ${info.press}, DA ${info.da}</dd></div>
            <div><dt>Twist:</dt><dd>${info.twist}</dd></div>
          </dl>
        </header>

        <table class="a4-table">
          <thead>
            <tr>
              <th scope="col">Range<br />${u.dist}</th>
              <th scope="col">Drop<br />${dropUnit}</th>
              <th scope="col">Elevation<br />${u.elev}</th>
              <th scope="col">Clicks<br />${info.click}</th>
              ${speeds.map((s) => `<th scope="col">Wind ${s}<br />${u.windAng}</th>`).join('')}
              ${showDrift ? `<th scope="col" title="Where the bullet drifts with no wind: spin drift, plus Coriolis if it is turned on in the Solver">Drift, no wind<br />${dropUnit}</th>` : ''}
              <th scope="col">Speed<br />${u.vel}</th>
              <th scope="col">Mach</th>
              <th scope="col">Energy<br />${u.energy}</th>
              <th scope="col">Time<br />s</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const drift = u.fromCm(r.noWindDriftM * 100);
              const driftTxt = Math.abs(drift) < 0.05 ? fmt(0, 1) : `${fmt(Math.abs(drift), 1)} ${drift > 0 ? 'R' : 'L'}`;
              return `
              <tr>
                <th scope="row">${fmtInt(r.dist)}</th>
                <td>${fmt(u.fromCm(r.dropM * 100), dropDec)}</td>
                <td class="cell-elev">${fmt(r.elev, 2)}</td>
                <td>${fmtInt(r.clicks)}</td>
                ${speeds.map((s, i) => `<td class="${i === 1 ? 'cell-wind' : ''}">${fmt(r.windHold(s), 2)}</td>`).join('')}
                ${showDrift ? `<td>${driftTxt}</td>` : ''}
                <td>${fmtInt(u.fromMs(r.velocityMs))}</td>
                <td>${fmt(r.mach, 2)}</td>
                <td>${fmtInt(u.fromJ(r.energyJ))}</td>
                <td>${fmt(r.tofS, 2)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="a4-legend">Wind columns: hold for a full-value crosswind (3 or 9 o’clock) of that speed in ${u.wind}, wind only. Conditions: ${info.envName}.</p>

        ${this.renderA4ReticleHoldReference(rowAt, u)}
        ${this.renderA4ShooterNotesGrid(u, info)}
      </div>`;
  }

  // ---- stage card -------------------------------------------------------------------------------

  /** Target silhouette (decorative; colour from currentColor). */
  renderTargetSilhouetteSvg(shape, size = 24, color = 'currentColor') {
    const c = esc(color);
    switch (shape) {
      case 'ipsc':
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 44" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" class="silhouette-svg silhouette-ipsc" aria-hidden="true" focusable="false">
          <polygon points="12,3 24,3 24,10 33,16 33,41 3,41 3,16 12,10" fill="${c}" fill-opacity="0.25" />
          <rect x="11" y="16" width="14" height="18" rx="1" stroke-width="1.2" stroke-dasharray="2,2" />
        </svg>`;
      case 'square':
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="${c}" stroke-width="2" class="silhouette-svg silhouette-square" aria-hidden="true" focusable="false">
          <rect x="6" y="9" width="24" height="24" rx="2" fill="${c}" fill-opacity="0.25" />
          <line x1="11" y1="2" x2="11" y2="9" stroke-width="1.5" />
          <line x1="25" y1="2" x2="25" y2="9" stroke-width="1.5" />
        </svg>`;
      case 'diamond':
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="${c}" stroke-width="2" class="silhouette-svg silhouette-diamond" aria-hidden="true" focusable="false">
          <polygon points="18,5 31,18 18,31 5,18" fill="${c}" fill-opacity="0.25" />
          <line x1="18" y1="1" x2="18" y2="6" stroke-width="1.5" />
        </svg>`;
      case 'kyl':
        return `<svg width="${size}" height="${Math.round(size * 0.75)}" viewBox="0 0 44 32" fill="none" stroke="${c}" stroke-width="1.8" class="silhouette-svg silhouette-kyl" aria-hidden="true" focusable="false">
          <line x1="2" y1="4" x2="42" y2="4" stroke-width="2.5" />
          <circle cx="7" cy="18" r="7" fill="${c}" fill-opacity="0.25" />
          <circle cx="19" cy="18" r="5.5" fill="${c}" fill-opacity="0.25" />
          <circle cx="29" cy="18" r="4" fill="${c}" fill-opacity="0.25" />
          <circle cx="37" cy="18" r="2.5" fill="${c}" fill-opacity="0.25" />
        </svg>`;
      case 'gong':
      default:
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="${c}" stroke-width="2" class="silhouette-svg silhouette-gong" aria-hidden="true" focusable="false">
          <circle cx="18" cy="20" r="13" fill="${c}" fill-opacity="0.25" />
          <line x1="11.75" y1="1" x2="11.75" y2="7" stroke-width="1.5" />
          <line x1="24.25" y1="1" x2="24.25" y2="7" stroke-width="1.5" />
        </svg>`;
    }
  }

  _schematicShape(shape) {
    switch (shape) {
      case 'ipsc': return '<polygon class="sch-shape" points="-4,-7 4,-7 4,-3 7,0 7,9 -7,9 -7,0 -4,-3" />';
      case 'square': return '<rect class="sch-shape" x="-6" y="-5" width="12" height="12" rx="1.5" />';
      case 'diamond': return '<polygon class="sch-shape" points="0,-7 7,0 0,7 -7,0" />';
      case 'kyl': return '<circle class="sch-shape" cx="-5" cy="0" r="3.2" /><circle class="sch-shape" cx="0" cy="0.6" r="2.4" /><circle class="sch-shape" cx="4.5" cy="1.2" r="1.6" />';
      case 'gong':
      default: return '<circle class="sch-shape" cx="0" cy="1" r="6.5" />';
    }
  }

  /**
   * Top-down drawing of the stage: targets in shooting order (dashed path), distance grid, firing
   * line at the bottom and a wind arrow. Colours come from the card colour theme in dope.css.
   * The drawing is shorter on the 3 × 5 in card and taller on the full page when there are many
   * targets; grid labels are thinned so they never stack, and callouts that would overlap anything
   * are left out (the table below lists every target anyway).
   */
  renderStageSchematicSvg(stage, targetsWithBallistics, dope, isImperial) {
    if (!targetsWithBallistics || targetsWithBallistics.length === 0) return '';
    const u = this._units();
    const n = targetsWithBallistics.length;
    const portrait = this.printOrientation === 'portrait-3x5';
    const fullPage = this.printOrientation === 'full-page';
    // A narrower drawing on the portrait card keeps its text legible once printed
    const VW = portrait ? 360 : 540;
    const VH = portrait ? 146 : fullPage && n > 8 ? 250 : 182;
    const cx0 = VW / 2;
    const distUnit = isImperial ? 'yd' : 'm';
    const toDisp = (m) => (isImperial ? m / M_PER_YD : m);
    const distances = targetsWithBallistics.map((t) => num(t.distanceM, 0));
    const minD = Math.max(0, Math.min(...distances) - 50);
    const maxD = Math.max(...distances) + 50;
    const spanD = Math.max(100, maxD - minD);
    const sameDistance = Math.max(...distances) - Math.min(...distances) < 15;
    const yTop = portrait ? 36 : 40;
    const yBot = VH - 37;
    const yAt = (m) => Math.round(yBot - ((m - minD) / spanD) * (yBot - yTop));
    // Smaller target marks when the drawing is crowded
    const nodeScale = n > 16 ? 0.6 : n > 8 ? 0.78 : 1;

    const points = targetsWithBallistics.map((t, idx) => {
      let x;
      if (sameDistance) {
        const spacing = Math.min(50, (VW - 200) / Math.max(1, n - 1));
        x = Math.round(cx0 - ((n - 1) * spacing) / 2 + idx * spacing);
      } else {
        x = Math.round(cx0 + num(t.offsetM, 0) * (VW / 120));
      }
      return { ...t, x: clamp(x, 70, VW - 70), y: yAt(num(t.distanceM, 0)) };
    });
    const pathD = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    // Distance grid in round display units, with at least 16 px between labels
    const spanDisp = toDisp(spanD);
    const plotH = yBot - yTop;
    const stepDisp = [25, 50, 100, 200, 250, 500, 1000, 2000].find((s) => (s / spanDisp) * plotH >= 16) || 2000;
    let grid = '';
    for (let g = Math.ceil(toDisp(minD) / stepDisp) * stepDisp; g <= toDisp(maxD); g += stepDisp) {
      const gy = yAt(isImperial ? g * M_PER_YD : g);
      grid += `<line class="sch-grid" x1="52" y1="${gy}" x2="${VW - 14}" y2="${gy}" /><text class="sch-grid-label" x="10" y="${gy + 3}">${g} ${distUnit}</text>`;
    }

    let rack = '';
    if (sameDistance && points.length > 1 && points[0].shape === 'kyl') {
      const xs = points.map((p) => p.x);
      rack = `<line class="sch-rack" stroke-width="2.5" x1="${Math.min(...xs) - 14}" y1="${points[0].y - 9}" x2="${Math.max(...xs) + 14}" y2="${points[0].y - 9}" />`;
    }

    // Callouts (distance and elevation): try a few spots around each target and keep the first one
    // that overlaps no target, wind dial or earlier callout; a callout with no free spot is left out.
    // Targets at one distance (a rack) share a single callout.
    const CH = 19;
    const r = 15 * nodeScale;
    const boxes = points.map((p) => ({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2.3 * r }));
    boxes.push({ x: VW - 70, y: 4, w: 66, h: 58 });
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const labels = [];
    if (sameDistance && n > 1) {
      const xs = points.map((p) => p.x);
      const dials = new Set(points.map((p) => p.dialValue));
      const dial = dials.size === 1 ? points[0].dialValue : `${points[0].dialValue}–${points[n - 1].dialValue}`;
      labels.push({ text: `T1–T${n} ${points[0].displayDistance} ${points[0].displayDistUnit} · `, dial, ax: (Math.min(...xs) + Math.max(...xs)) / 2, ay: points[0].y, spread: (Math.max(...xs) - Math.min(...xs)) / 2 + r });
    } else {
      points.forEach((p) => labels.push({ text: `T${p.index} ${p.displayDistance} ${p.displayDistUnit} · `, dial: p.dialValue, ax: p.x, ay: p.y, spread: r }));
    }
    let callouts = '';
    labels.forEach((l) => {
      const CW = Math.round((l.text.length + String(l.dial).length) * 5.2 + 12);
      const g = l.spread + 3;
      const spots = [
        [l.ax + g, l.ay - 26], [l.ax - CW - g, l.ay - 26], [l.ax + g, l.ay + 4], [l.ax - CW - g, l.ay + 4],
        [l.ax - CW / 2, l.ay - r - CH - 6], [l.ax - CW / 2, l.ay + r + 8], [l.ax + g, l.ay - 11], [l.ax - CW - g, l.ay - 11],
      ].map(([x, y]) => ({ x: clamp(x, 54, VW - CW - 8), y: clamp(y, 8, VH - 32 - CH), w: CW, h: CH }));
      const best = spots.find((s) => boxes.every((b) => overlap(s, b) === 0));
      if (!best) return;
      boxes.push(best);
      callouts += `
        <g class="schematic-callout" transform="translate(${best.x} ${best.y})">
          <rect class="sch-callout" width="${CW}" height="${CH}" rx="3" />
          <text class="sch-callout-text" x="${CW / 2}" y="13" text-anchor="middle">${esc(l.text)}<tspan class="sch-callout-elev">${esc(l.dial)}</tspan></text>
        </g>`;
    });

    let nodes = '';
    points.forEach((p, idx) => {
      const bw = String(p.index).length > 1 ? 24 : 20;
      nodes += `
        <g class="schematic-node" data-target-idx="${idx}" transform="translate(${p.x} ${p.y})${nodeScale !== 1 ? ` scale(${nodeScale})` : ''}">
          <circle class="sch-node-bg" r="14" />
          ${this._schematicShape(p.shape)}
          <rect class="sch-badge" x="${-bw / 2}" y="8" width="${bw}" height="11" rx="2" />
          <text class="sch-badge-text" x="0" y="16.5" text-anchor="middle">T${p.index}</text>
        </g>`;
    });

    // Wind arrow: comes from the clock position of windDirectionDeg (0 = from downrange, 90 = from the right)
    const windDeg = num(stage.windDirectionDeg, 90);
    const wr = (windDeg * Math.PI) / 180;
    const sx = Math.sin(wr) * 11;
    const sy = -Math.cos(wr) * 11;
    const ex = -sx;
    const ey = -sy;
    const ux = (ex - sx) / 22;
    const uy = (ey - sy) / 22;
    const head = `${ex.toFixed(1)},${ey.toFixed(1)} ${(ex - ux * 5 - uy * 3.5).toFixed(1)},${(ey - uy * 5 + ux * 3.5).toFixed(1)} ${(ex - ux * 5 + uy * 3.5).toFixed(1)},${(ey - uy * 5 - ux * 3.5).toFixed(1)}`;
    const windSpeed = fmtTrim(u.windFromMs(num(stage.windBaseMs, 0)), 1);

    return `
      <div class="stage-schematic-container">
        <svg viewBox="0 0 ${VW} ${VH}" class="stage-schematic-svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Stage drawing: ${points.length} targets in shooting order, wind from ${clockLabel(windDeg)} o’clock">
          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path class="sch-arrow" d="M 0 1 L 9 5 L 0 9 z" />
            </marker>
          </defs>
          <rect class="sch-bg" x="3" y="3" width="${VW - 6}" height="${VH - 6}" rx="6" />
          <line class="sch-center" x1="${cx0}" y1="20" x2="${cx0}" y2="${VH - 26}" />
          ${grid}
          ${rack}
          <path class="sch-path" d="${pathD}" marker-mid="url(#seq-arrow)" />
          ${nodes}
          ${callouts}
          <line class="sch-firing" x1="52" y1="${VH - 20}" x2="${VW - 14}" y2="${VH - 20}" />
          <circle class="sch-firing-dot" cx="${cx0}" cy="${VH - 20}" r="3.5" />
          <text class="sch-firing-text" x="${cx0}" y="${VH - 7}" text-anchor="middle">FIRING LINE</text>
          <g transform="translate(${VW - 38} 30)">
            <circle class="sch-wind-bg" r="16" />
            <line class="sch-wind" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" />
            <polygon class="sch-wind-head" points="${head}" />
            <text class="sch-wind-text" x="0" y="-20" text-anchor="middle">WIND ${windSpeed} ${u.wind}</text>
            <text class="sch-wind-sub" x="0" y="28" text-anchor="middle">${clockLabel(windDeg)}</text>
          </g>
        </svg>
      </div>`;
  }

  /**
   * Suggested pace: the stage time split by shot count over the positions in shooting order.
   * Only neighbouring targets on the same position are merged; a target with no position is its
   * own step, named after the target.
   */
  _renderParTimeFlow(stage, totalRounds, timeLimitSec) {
    if (!stage.targets || stage.targets.length === 0 || totalRounds <= 0) return '';
    const groups = [];
    stage.targets.forEach((t, idx) => {
      const prop = String(t.prop || '').trim();
      const shots = Number(t.rounds) || 0;
      const last = groups[groups.length - 1];
      if (prop && last && last.prop === prop) last.rounds += shots;
      else groups.push({ prop, label: prop || `T${idx + 1}`, rounds: shots });
    });
    const perShot = timeLimitSec / totalRounds;
    let acc = 0;
    const splits = groups.map((g) => {
      const start = Math.round(acc);
      acc += g.rounds * perShot;
      return `<li class="pace-split-pill"><span class="split-prop-name">${esc(g.label)}</span> <span class="split-time">${start}–${Math.round(acc)} s (${g.rounds})</span></li>`;
    }).join('');
    return `
      <div class="par-time-flow-bar">
        <span class="flow-tag">Suggested pace</span>
        <ol class="pace-splits-container">${splits}</ol>
      </div>`;
  }

  _stageSummary(stage, u) {
    const totalRounds = stage.targets.reduce((sum, t) => sum + (Number(t.rounds) || 0), 0);
    const timeLimitSec = Number(stage.timeLimitSec) || 90;
    const ds = stage.targets.map((t) => num(t.distanceM, NaN)).filter(Number.isFinite);
    return {
      totalRounds,
      targetCount: stage.targets.length,
      timeLimitSec,
      pace: totalRounds > 0 ? fmt(timeLimitSec / totalRounds, 1) : '—',
      span: ds.length ? `${fmtInt(u.fromM(Math.min(...ds)))}–${fmtInt(u.fromM(Math.max(...ds)))} ${u.dist}` : '—',
      lull: fmtTrim(u.windFromMs(num(stage.windLullMs, 0)), 1),
      base: fmtTrim(u.windFromMs(num(stage.windBaseMs, 0)), 1),
      gust: fmtTrim(u.windFromMs(num(stage.windGustMs, 0)), 1),
      dir: num(stage.windDirectionDeg, 90),
    };
  }

  _stageData() {
    const stage = this.prsStage;
    const windDir = num(stage.windDirectionDeg, 90);
    const maxD = Math.max(300, ...stage.targets.map((t) => num(t.distanceM, 0))) + 50;
    const maxRangeM = Math.min(3000, maxD);
    const baseDope = this.computeDope(10, maxRangeM, num(stage.windBaseMs, 0), windDir);
    const lullDope = this.computeDope(10, maxRangeM, num(stage.windLullMs, 0), windDir);
    const gustDope = this.computeDope(10, maxRangeM, num(stage.windGustMs, 0), windDir);
    const targets = this.computeStageBallistics(stage, baseDope, lullDope, gustDope, baseDope.profile, appState.state.systemUnits === 'imperial');
    return { baseDope, targets };
  }

  renderPrsStageCard(data, u) {
    const stage = this.prsStage;
    const dope = data.baseDope;
    const info = this._rifleInfo(dope, u);
    const s = this._stageSummary(stage, u);
    const size = STAGE_SIZES.find((x) => x.id === this.printOrientation) || STAGE_SIZES[0];
    const sizeNote = size.id === 'full-page' ? 'Full page' : size.id === 'landscape-5x3' ? '5 × 3 in card' : '3 × 5 in card';

    return `
      <div class="prs-arm-board-card print-sheet paper ${size.id} card-theme-${this.cardTheme}" id="prs-arm-board-card">
        ${this._cropMarks()}
        <div class="lamination-guide-border">
          <header class="card-tactical-header">
            <div class="header-main-banner">
              <span class="badge-stage-tag">Stage card</span>
              <h2 class="stage-title-text">${esc(stage.name)}</h2>
            </div>
            <ul class="tactical-pills-row">
              <li class="tactical-pill">${s.timeLimitSec} s</li>
              <li class="tactical-pill">${plural(s.totalRounds, 'shot')}</li>
              <li class="tactical-pill">${plural(s.targetCount, 'target')}</li>
              <li class="tactical-pill">${s.pace} s per shot</li>
              <li class="tactical-pill">Wind ${s.lull} / ${s.base} / ${s.gust} ${u.wind} from ${clockLabel(s.dir)}</li>
            </ul>
            <div class="header-sub-meta">
              <span><strong>Rifle:</strong> ${info.name} · ${info.caliber} · ${info.weight} · ${info.mv}</span>
              <span><strong>Conditions:</strong> DA ${info.da} · ${info.temp} · ${info.press} · Zero ${info.zero}</span>
            </div>
            ${stage.propsDescription ? `<div class="barricade-flow-bar"><span class="flow-tag">Positions</span> <span class="flow-desc">${esc(stage.propsDescription)}</span></div>` : ''}
            ${this._renderParTimeFlow(stage, s.totalRounds, s.timeLimitSec)}
          </header>

          ${this.renderStageSchematicSvg(stage, data.targets, dope, u.dist === 'yd')}

          <table class="prs-target-matrix">
            <thead>
              <tr>
                <th scope="col" class="col-tgt">Target</th>
                <th scope="col" class="col-prop">Position</th>
                <th scope="col" class="col-range">Range</th>
                <th scope="col" class="col-elev">Elevation</th>
                <th scope="col" class="col-wind">Wind hold: lull / base / gust (${u.windAng})</th>
                <th scope="col" class="col-ballistics">Time / speed</th>
                <th scope="col" class="col-notes">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${data.targets.map((t, idx) => `
                <tr class="matrix-row" data-target-idx="${idx}">
                  <td class="cell-tgt">
                    <span class="tgt-badge-wrap"><span class="tgt-num-badge">T${t.index}</span><span class="tgt-silhouette-icon">${this.renderTargetSilhouetteSvg(t.shape, 20)}</span></span>
                    <span class="tgt-name-sub">${esc(t.name)}</span>
                  </td>
                  <td class="col-prop">
                    ${t.prop ? `<span class="prop-badge-pill">${esc(t.prop)}</span>` : ''}
                    <span class="rounds-alloc-tag">${fmtInt(t.rounds)} ${Number(t.rounds) === 1 ? 'shot' : 'shots'}</span>
                  </td>
                  <td class="cell-range">
                    <span class="dist-large-val">${t.displayDistance}<span class="dist-unit-sub"> ${esc(t.displayDistUnit)}</span></span>
                    <span class="size-sub-dim">${t.displayWidth} × ${t.displayHeight} ${esc(t.displaySizeUnit)}</span>
                    <span class="angular-size-dim">${esc(t.angularSizeDisplay)}</span>
                  </td>
                  <td class="cell-elev">
                    <span class="dial-primary-num">${esc(t.dialValue)}<span class="dial-unit-lbl"> ${esc(t.dialUnit)}</span></span>
                    <span class="dial-sub-meta"><span class="clicks-chip">${fmtInt(t.clicks)} clicks</span> <span class="danger-space-chip" title="Danger space: range error that still hits">±${Number.isFinite(t.dangerSpaceDisplay) ? Math.round(t.dangerSpaceDisplay / 2) : '—'} ${esc(t.displayDistUnit)}</span></span>
                  </td>
                  <td class="cell-wind">
                    <span class="wind-bracket-pill">
                      <span class="wind-segment wind-lull">${t.lullHold}</span>
                      <span class="wind-segment wind-base"><span class="wind-dir-chip">${t.holdDirLabel}</span> ${t.baseHold}</span>
                      <span class="wind-segment wind-gust">${t.gustHold}</span>
                    </span>
                  </td>
                  <td class="cell-ballistics">
                    <span class="tof-val">${t.tofS} s</span>
                    <span class="vel-val">${t.velocity} ${esc(t.velocityUnit)}</span>
                  </td>
                  <td class="cell-notes"><span class="note-text-display">${esc(t.notes || '—')}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>

          <footer class="card-tactical-footer">
            <span>R / L: hold right or left into the wind. ± is danger space: range error that still hits.</span>
            <span>${sizeNote} · Ballistic Workbench</span>
          </footer>
        </div>
      </div>`;
  }

  // ---- settings column --------------------------------------------------------------------------

  /** A Låda notice. tone: info | warn. text is trusted markup (constants and numbers only). */
  _alert(tone, text, { id = '', hidden = false } = {}) {
    return `<div class="lg-alert lg-alert-${tone} dope-alert"${id ? ` id="${id}"` : ''} role="status"${hidden ? ' hidden' : ''}>${icon(tone === 'warn' ? 'alert' : 'info')}<p>${text}</p></div>`;
  }

  /** The undo notice after a destructive stage change, shown where the change was made. */
  _undoHtml(where) {
    if (!this._undo || this._undo.where !== where) return '';
    return `
      <div class="lg-alert lg-alert-info dope-undo" role="status">
        ${icon('info')}
        <p>${esc(this._undo.label)}</p>
        <button type="button" class="lg-btn" id="btn-undo-${where}" data-action="undo">${icon('refresh')} Undo</button>
      </div>`;
  }

  /** A number field with − / + buttons (Låda stepper). The error line sits after the stepper. */
  _stepper(id, attrs, value, label) {
    return `
      <div class="lg-stepper dope-stepper">
        <button type="button" id="${id}-dec" data-lg-step="-1" aria-label="Less: ${label}">${icon('minus')}</button>
        <input type="number" id="${id}" ${attrs} value="${value}" />
        <button type="button" id="${id}-inc" data-lg-step="1" aria-label="More: ${label}">${icon('plus')}</button>
      </div>
      <p class="field-error" id="${id}-error" role="alert" hidden></p>`;
  }

  _rangeSourceHtml(ranges, u, skipped, extraNote = '') {
    const notes = [];
    if (ranges.shown.length < ranges.all.length) {
      notes.push(`This card has room for ${ranges.shown.length} distances, so it shows ${ranges.shown.length} of ${ranges.all.length}, spread evenly.`);
    }
    if (extraNote) notes.push(extraNote);
    const first = ranges.all.length ? fmtInt(u.fromM(ranges.all[0])) : '—';
    const last = ranges.all.length ? fmtInt(u.fromM(ranges.all[ranges.all.length - 1])) : '—';
    const count = `${ranges.all.length} ${ranges.all.length === 1 ? 'distance' : 'distances'}`;
    return `
      <div class="dope-block">
        <h3 class="lg-label">Distances</h3>
        ${ranges.fromSolver
          ? `<p>${count} from the Solver, ${first}–${last} ${u.dist}.</p>
             <button type="button" class="lg-btn dope-block-btn" id="btn-default-ranges" data-action="use-default-ranges">${icon('refresh')} Use the default distances</button>`
          : `<p>Default distances, ${first}–${last} ${u.dist}.</p>
             <p class="field-hint">To choose your own, tick rows in the Solver’s range table and press Make DOPE card.</p>`}
        ${notes.map((n) => `<p class="field-hint">${n}</p>`).join('')}
        ${skipped > 0 ? this._alert('warn', `${skipped} ${skipped === 1 ? 'distance is' : 'distances are'} past the end of the trajectory and left out.`) : ''}
      </div>`;
  }

  _sourceHtml(dope, u) {
    const info = this._rifleInfo(dope, u);
    return `
      <div class="dope-block">
        <h3 class="lg-label">Data from</h3>
        <dl class="dope-source-list">
          <div><dt>Rifle</dt><dd>${info.name}</dd></div>
          <div><dt>Conditions</dt><dd>${info.envName || '—'}</dd></div>
          <div><dt>Units</dt><dd>${u.dist}, ${u.elev}, wind in ${u.wind}</dd></div>
        </dl>
        <p class="field-hint">Change the rifle and conditions in the <a href="#workspace">Solver</a>, and the units in Settings (the cogwheel at the top right).</p>
      </div>`;
  }

  _scopeCapSettings() {
    const d = this.scopeCapDiameterMm;
    const isCustom = !SCOPE_CAP_PRESETS.some((p) => Math.abs(p.mm - d) < 0.05);
    return `
      <div class="dope-block">
        <h3 class="lg-label">Size</h3>
        <div class="field-row">
          <label class="field-label" for="scope-cap-preset-select">Scope cap</label>
          <select id="scope-cap-preset-select" class="lg-select">
            ${SCOPE_CAP_PRESETS.map((p) => `<option value="${p.mm}" ${Math.abs(p.mm - d) < 0.05 ? 'selected' : ''}>${p.label}</option>`).join('')}
            <option value="custom" ${isCustom ? 'selected' : ''}>Other size</option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label" for="scope-cap-diameter-input">Diameter (mm)</label>
          <input type="text" inputmode="decimal" autocomplete="off" id="scope-cap-diameter-input" class="lg-input" min="25" max="85" step="0.1" value="${d}" />
          <p class="field-hint">Measure the inside of the clear cap lid.</p>
        </div>
      </div>`;
  }

  _turretSettings(offTurn) {
    const circ = this.turretCircumferenceMm;
    const isCustom = !TURRET_PRESETS.some((p) => Math.abs(p.circ - circ) < 0.05);
    return `
      <div class="dope-block">
        <h3 class="lg-label">Size</h3>
        <div class="field-row">
          <label class="field-label" for="turret-tape-preset-select">Turret</label>
          <select id="turret-tape-preset-select" class="lg-select">
            ${TURRET_PRESETS.map((p) => `<option value="${p.circ}" ${Math.abs(p.circ - circ) < 0.05 ? 'selected' : ''}>${p.label}</option>`).join('')}
            <option value="custom" ${isCustom ? 'selected' : ''}>Other size</option>
          </select>
        </div>
        <div class="field-grid-2">
          <div>
            <label class="field-label" for="tape-circ-input">Length around (mm)</label>
            <input type="text" inputmode="decimal" autocomplete="off" id="tape-circ-input" class="lg-input" min="60" max="180" step="0.1" value="${circ}" />
          </div>
          <div>
            <label class="field-label" for="tape-height-input">Height (mm)</label>
            <input type="text" inputmode="decimal" autocomplete="off" id="tape-height-input" class="lg-input" min="8" max="25" step="0.5" value="${this.turretTapeHeightMm}" />
          </div>
          <div>
            <label class="field-label" for="tape-clicks-input">Clicks per turn</label>
            <input type="text" inputmode="numeric" autocomplete="off" id="tape-clicks-input" class="lg-input" min="40" max="200" step="1" value="${this.turretClicksPerTurn}" />
          </div>
        </div>
        <p class="field-hint">Wrap a strip of paper around the turret and measure it for the exact length. The distance marks show hundreds (3 = 300).</p>
        ${offTurn > 0 ? this._alert('warn', `${offTurn} ${offTurn === 1 ? 'distance needs' : 'distances need'} more than one turn and ${offTurn === 1 ? 'is' : 'are'} left out.`) : ''}
      </div>`;
  }

  _stageSettings(u) {
    const stage = this.prsStage;
    const s = this._stageSummary(stage, u);
    const windDir = num(stage.windDirectionDeg, 90);
    const known = WIND_DIRECTIONS.some((w) => w.deg === windDir);
    const windMax = u.wind === 'mph' ? 80 : 35;
    const windField = (key, label, ms) => `
      <div>
        <label class="field-label" for="input-wind-${key}">${label}</label>
        <input type="text" inputmode="decimal" autocomplete="off" id="input-wind-${key}" class="lg-input" min="0" max="${windMax}" step="0.5" value="${fmtTrim(u.windFromMs(num(ms, 0)), 1)}" />
      </div>`;
    return `
      <div class="dope-block">
        <h3 class="lg-label">Stage</h3>
        ${this._undoHtml('settings')}
        <div class="field-row">
          <label class="field-label" for="stage-preset-select">Start from a preset</label>
          <select id="stage-preset-select" class="lg-select">
            <option value="" selected>Choose a preset…</option>
            ${Object.keys(this.presets).map((k) => `<option value="${k}">${esc(this.presetLabels[k] || k)}</option>`).join('')}
          </select>
        </div>
        <div class="field-row">
          <label class="field-label" for="input-stage-name">Stage name</label>
          <input type="text" id="input-stage-name" class="lg-input" maxlength="80" value="${esc(stage.name)}" />
        </div>
        <div class="field-row">
          <label class="field-label" for="input-stage-timer">Time limit (s)</label>
          ${this._stepper('input-stage-timer', 'inputmode="numeric" min="10" max="600" step="5"', fmtInt(stage.timeLimitSec), 'time limit')}
        </div>
        <div class="field-row">
          <label class="field-label" for="input-stage-props">Positions, in order</label>
          <input type="text" id="input-stage-props" class="lg-input" maxlength="200" value="${esc(stage.propsDescription)}" placeholder="Tank trap (2), then barricade (3)" />
          <div class="dope-quick-add" role="group" aria-label="Add a position">
            ${['Tank trap', 'Cable spool', 'Barricade', 'Rooftop', 'Prone mat', 'Tires'].map((p) => `<button type="button" class="lg-btn lg-btn-ghost" data-action="add-prop" data-value="${p}">${icon('plus')} ${p}</button>`).join('')}
          </div>
        </div>
        <div class="dope-targets-link">
          <p>${plural(s.targetCount, 'target')}, ${plural(s.totalRounds, 'shot')}</p>
          <button type="button" class="lg-btn lg-btn-ghost" data-action="goto-targets">${icon('edit')} Edit targets</button>
        </div>
      </div>
      <div class="dope-block">
        <h3 class="lg-label">Wind</h3>
        <div class="dope-wind-dir">
          <div>
            <label class="field-label" for="wind-dir-select">Wind from</label>
            <select id="wind-dir-select" class="lg-select">
              ${WIND_DIRECTIONS.map((w) => `<option value="${w.deg}" ${w.deg === windDir ? 'selected' : ''}>${w.label}</option>`).join('')}
              ${known ? '' : `<option value="custom" selected>Other (${clockLabel(windDir)})</option>`}
            </select>
          </div>
          <div>
            <label class="field-label" for="input-wind-direction">Angle (°)</label>
            <input type="text" inputmode="numeric" autocomplete="off" id="input-wind-direction" class="lg-input" min="0" max="359" step="15" value="${fmtInt(windDir)}" />
          </div>
        </div>
        <fieldset class="dope-fieldset">
          <legend class="field-label">Wind speed (${u.wind})</legend>
          <div class="field-grid-3">
            ${windField('lull', 'Lull', stage.windLullMs)}
            ${windField('base', 'Base', stage.windBaseMs)}
            ${windField('gust', 'Gust', stage.windGustMs)}
          </div>
        </fieldset>
        <p class="field-hint">The card lists a wind hold for each of the three speeds.</p>
      </div>
      <div class="dope-block">
        <h3 class="lg-label">Card</h3>
        <fieldset class="dope-fieldset">
          <legend class="field-label">Size</legend>
          <div class="lg-segmented dope-segmented dope-segmented-size">
            ${STAGE_SIZES.map((sz) => `<input type="radio" name="stage-size" id="stage-size-${sz.id}" value="${sz.id}" ${this.printOrientation === sz.id ? 'checked' : ''} /><label for="stage-size-${sz.id}"><span class="seg-main">${sz.short}</span><span class="seg-sub">${sz.sub}</span></label>`).join('')}
          </div>
        </fieldset>
        <fieldset class="dope-fieldset">
          <legend class="field-label">Colour</legend>
          <div class="lg-segmented dope-segmented">
            ${CARD_THEMES.map((t) => `<input type="radio" name="card-theme" id="card-theme-${t.id}" value="${t.id}" ${this.cardTheme === t.id ? 'checked' : ''} /><label for="card-theme-${t.id}"><span class="swatch swatch-${t.id}" aria-hidden="true"></span>${t.label}</label>`).join('')}
          </div>
        </fieldset>
        ${this._alert('warn', 'The card is full and the last rows are cut off. Remove targets or choose a bigger size.', { id: 'stage-fit-warning', hidden: true })}
      </div>`;
  }

  // ---- stage target editor ----------------------------------------------------------------------

  _stageEditorHtml(u) {
    const stage = this.prsStage;
    const s = this._stageSummary(stage, u);
    const n = stage.targets.length;
    return `
      <section class="lg-card stage-targets no-print" id="stage-targets" aria-labelledby="stage-targets-heading">
        <div class="lg-header stage-targets-head">
          <div>
            <h2 class="lg-subtitle" id="stage-targets-heading" tabindex="-1">${icon('target')} Targets, in shooting order</h2>
            <p class="lg-muted stage-targets-stats">${plural(s.targetCount, 'target')} · ${plural(s.totalRounds, 'shot')} · ${s.pace} s per shot · ${s.span}</p>
          </div>
          <button type="button" class="lg-btn" id="btn-add-target-top" data-action="add-target" ${n >= 30 ? 'disabled' : ''}>${icon('plus')} Add target</button>
        </div>
        <p class="field-hint">Left / right places the target on the drawing: minus is left of centre, plus is right. The +/− button switches a target to the other side.</p>
        ${this._undoHtml('editor')}
        <ol class="target-list">
          ${stage.targets.map((t, idx) => this._targetEditorHtml(t, idx, n, u)).join('')}
        </ol>
        <div class="lg-row stage-targets-foot">
          <button type="button" class="lg-btn" id="btn-add-target" data-action="add-target" ${n >= 30 ? 'disabled' : ''}>${icon('plus')} Add target</button>
          <button type="button" class="lg-btn lg-btn-ghost" id="btn-reset-stage" data-action="reset-stage">${icon('refresh')} Start over from the default stage</button>
        </div>
      </section>`;
  }

  _targetEditorHtml(t, idx, n, u) {
    const id = (f) => `tgt-${idx}-${f}`;
    const tn = `T${idx + 1}`;
    const sr = `<span class="lg-sr-only">${tn} </span>`;
    const maxDist = Math.round(u.fromM(2500));
    const maxSize = Math.round(u.fromCm(500));
    const maxOff = Math.round(u.fromM(100));
    const field = (cls, key, label, control) => `<div class="tf tf-${cls}"><label class="field-label" for="${id(key)}">${sr}${label}</label>${control}</div>`;
    return `
      <li class="target-row" data-target-idx="${idx}">
        <div class="target-row-head">
          <span class="lg-badge target-num">${tn}</span>
          ${field('name', 'name', 'Name', `<input type="text" id="${id('name')}" class="lg-input" maxlength="60" data-target-field="name" value="${esc(t.name)}" />`)}
          <div class="target-row-actions" role="group" aria-label="${tn}">
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" id="${id('up')}" data-action="target-up" data-idx="${idx}" aria-label="Move ${tn} up" ${idx === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" id="${id('down')}" data-action="target-down" data-idx="${idx}" aria-label="Move ${tn} down" ${idx === n - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" id="${id('copy')}" data-action="target-copy" data-idx="${idx}" aria-label="Duplicate ${tn}" ${n >= 30 ? 'disabled' : ''}>${icon('copy')}</button>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon target-remove" id="${id('remove')}" data-action="target-delete" data-idx="${idx}" aria-label="Remove ${tn}" ${n <= 1 ? 'disabled' : ''}>${icon('trash')}</button>
          </div>
        </div>
        <div class="target-row-fields">
          ${field('shape', 'shape', 'Shape', `<select id="${id('shape')}" class="lg-select" data-target-field="shape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}" ${t.shape === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
          ${field('dist', 'distanceM', `Distance (${u.dist})`, `<input type="text" inputmode="numeric" autocomplete="off" id="${id('distanceM')}" class="lg-input" data-target-num="distanceM" min="${Math.ceil(u.fromM(10))}" max="${maxDist}" step="5" value="${fmtInt(u.fromM(num(t.distanceM, 300)))}" />`)}
          ${field('shots', 'rounds', 'Shots', this._stepper(id('rounds'), 'inputmode="numeric" data-target-num="rounds" min="1" max="20" step="1"', fmtInt(t.rounds), `${tn} shots`))}
          ${field('w', 'widthCm', `Width (${u.size})`, `<input type="text" inputmode="decimal" autocomplete="off" id="${id('widthCm')}" class="lg-input" data-target-num="widthCm" min="1" max="${maxSize}" step="1" value="${fmtTrim(u.fromCm(num(t.widthCm, 30)), 1)}" />`)}
          ${field('h', 'heightCm', `Height (${u.size})`, `<input type="text" inputmode="decimal" autocomplete="off" id="${id('heightCm')}" class="lg-input" data-target-num="heightCm" min="1" max="${maxSize}" step="1" value="${fmtTrim(u.fromCm(num(t.heightCm, num(t.widthCm, 30))), 1)}" />`)}
          ${field('off', 'offsetM', `Left / right (${u.dist})`, `<div class="dope-offset"><input type="text" inputmode="decimal" autocomplete="off" id="${id('offsetM')}" class="lg-input" data-target-num="offsetM" min="${-maxOff}" max="${maxOff}" step="1" value="${fmtInt(u.fromM(num(t.offsetM, 0)))}" /><button type="button" class="lg-btn dope-sign-btn" id="${id('sign')}" data-action="target-flip" data-idx="${idx}" aria-label="Switch ${tn} to the other side of centre">+/−</button></div><p class="field-error" id="${id('offsetM')}-error" role="alert" hidden></p>`)}
          ${field('pos', 'prop', 'Position', `<input type="text" id="${id('prop')}" class="lg-input" maxlength="60" data-target-field="prop" value="${esc(t.prop || '')}" placeholder="Barricade" />`)}
          ${field('note', 'notes', 'Note', `<input type="text" id="${id('notes')}" class="lg-input" maxlength="80" data-target-field="notes" value="${esc(t.notes || '')}" placeholder="Hold or order note" />`)}
        </div>
      </li>`;
  }

  // ---- main render ------------------------------------------------------------------------------

  render() {
    clearTimeout(this._renderTimer);
    this._renderTimer = 0;
    const fmtDef = FORMATS.find((f) => f.id === this.activeFormat) || FORMATS[0];
    const u = this._units();
    const focusId = this._focusLocator();

    let paperHtml = '';
    let settingsHtml = '';
    let withRuler = true;
    let cutHint = '';
    let badge = '';
    let editorHtml = '';
    let dope;

    if (fmtDef.id === 'prs-stage') {
      const data = this._stageData();
      dope = data.baseDope;
      paperHtml = this.renderPrsStageCard(data, u);
      settingsHtml = this._stageSettings(u);
      editorHtml = this._stageEditorHtml(u);
      withRuler = this.printOrientation !== 'full-page';
      badge = (STAGE_SIZES.find((x) => x.id === this.printOrientation) || STAGE_SIZES[0]).label;
      cutHint = this.printOrientation === 'full-page'
        ? 'Prints on one A4 or Letter page.'
        : 'Cut along the solid border and slide the card into a 3 × 5 in wrist sleeve.';
      this._stageTargets = data.targets;
    } else {
      const ranges = this._rangesFor(fmtDef, u);
      const { rows, rowAt, dope: base, skipped } = this._rangeRows(ranges.shown);
      dope = base;
      this._rows = rows;

      switch (fmtDef.id) {
        case 'wrist-coach':
          paperHtml = this.renderWristCoach(rows, dope, u);
          badge = '3 × 5 in';
          cutHint = 'Cut along the solid border and slide the card into a 3 × 5 in wrist sleeve.';
          break;
        case 'stock-tape':
          paperHtml = this.renderStockTape(rows, dope, u);
          badge = '180 × 32 mm';
          cutHint = 'Cut along the dashed border and stick the strip to the stock under clear tape.';
          break;
        case 'turret-tape': {
          paperHtml = this.renderTurretTape(rows, dope, u);
          badge = `${fmtTrim(this.turretCircumferenceMm, 1)} × ${fmtTrim(this.turretTapeHeightMm, 1)} mm`;
          cutHint = 'Cut along the border, wrap the strip around the elevation turret with ZERO at your zero mark, and cover it with clear tape.';
          settingsHtml = this._turretSettings(ranges.fromSolver ? this._turretOffTurn : 0);
          break;
        }
        case 'a4-sheet':
          paperHtml = this.renderA4DataSheet(rows, rowAt, dope, u);
          badge = 'A4 or Letter';
          cutHint = 'Prints on one A4 or Letter page.';
          withRuler = false;
          break;
        case 'scope-cap':
        default:
          paperHtml = this.renderScopeCapSvg(rows, dope, u);
          badge = `Ø ${fmtTrim(this.scopeCapDiameterMm, 1)} mm`;
          cutHint = `Cut along the dotted circle (Ø ${fmtTrim(this.scopeCapDiameterMm, 1)} mm) and place the insert inside a clear flip-up scope cap.`;
          settingsHtml = this._scopeCapSettings();
          break;
      }
      settingsHtml += this._rangeSourceHtml(ranges, u, skipped, fmtDef.id === 'turret-tape' && !ranges.fromSolver ? 'The tape shows the ones that fit on one turn of the turret.' : '');
    }
    settingsHtml += this._sourceHtml(dope, u);

    const tabs = FORMATS.map((f) => {
      const sel = f.id === fmtDef.id;
      return `<button type="button" role="tab" id="dope-tab-${f.id}" class="lg-tab" data-format="${f.id}" aria-selected="${sel}" aria-controls="dope-panel" tabindex="${sel ? '0' : '-1'}">${icon(f.icon)}<span>${f.label}</span></button>`;
    }).join('');
    const vector = fmtDef.id === 'scope-cap' || fmtDef.id === 'turret-tape';

    // eslint-disable-next-line no-unsanitized/property -- reviewed: rifle/stage strings are esc()'d at source (_rifleInfo, stage fields); the rest are numbers and constants
    this.container.innerHTML = `
      <div class="dope-view">
        <header class="lg-header view-header no-print">
          <div>
            <h1 class="lg-title">DOPE cards</h1>
            <p class="lg-muted">Print range cards for your scope cap, wrist, stock or a full page. <abbr title="Data On Previous Engagement">DOPE</abbr> is your elevation and wind holds for each distance.</p>
          </div>
        </header>

        <div class="lg-tabs dope-formats no-print" role="tablist" aria-label="Card format">${tabs}</div>

        <div class="dope-layout" id="dope-panel" role="tabpanel" aria-labelledby="dope-tab-${fmtDef.id}">
          <section class="lg-card dope-settings no-print" aria-labelledby="dope-settings-heading">
            <h2 class="lg-subtitle dope-settings-title" id="dope-settings-heading">${icon(fmtDef.icon)} ${fmtDef.title}</h2>
            <p class="lg-muted dope-format-desc">${fmtDef.desc}</p>
            ${settingsHtml}
          </section>

          <section class="lg-card dope-preview" aria-labelledby="dope-preview-heading">
            <div class="dope-preview-head no-print">
              <h2 class="lg-subtitle dope-preview-title" id="dope-preview-heading">Preview <span class="lg-chip lg-plain">${badge}</span></h2>
              <div class="dope-actions">
                <button type="button" class="lg-btn" data-action="toggle-zoom" id="btn-zoom" hidden>${icon('search')} ${this._zoomFull ? 'Fit to screen' : 'Zoom in'}</button>
                <button type="button" class="lg-btn" data-action="copy-text" id="btn-copy-text">${icon('copy')} Copy as text</button>
                <button type="button" class="lg-btn" data-action="save-image" id="btn-save-image">${icon('download')} ${vector ? 'Save SVG' : 'Save PNG'}</button>
                <button type="button" class="lg-btn lg-btn-primary btn-print" id="btn-print">${icon('print')} Print</button>
              </div>
            </div>
            <div class="desk-surface">
              <div class="print-area print-area-${fmtDef.id}">
                ${paperHtml}
                ${withRuler ? this._ruler() : ''}
              </div>
            </div>
            <p class="dope-cut-hint no-print">${icon('info')}<span>${cutHint} Print at 100% scale (turn off “fit to page”).</span></p>
          </section>
        </div>
        ${editorHtml}
      </div>`;

    this._afterRender(focusId);
  }

  _afterRender(focus) {
    this.applyDynamicStyles();
    this._bindNumberFields();
    this._fitPreview();
    this._observeDesk();
    this._restoreFocus(focus);
  }

  /** Where the keyboard focus is in the view: an id, a help button key, or a position. */
  _focusLocator() {
    if (typeof document === 'undefined') return null;
    const el = document.activeElement;
    if (!el || el === document.body || !this.container.contains?.(el)) return null;
    if (el.id) return { id: el.id };
    if (el.dataset?.help) return { help: el.dataset.help };
    const all = [...this.container.querySelectorAll(FOCUSABLE)];
    const index = all.indexOf(el);
    return index >= 0 ? { index } : null;
  }

  /**
   * Puts the focus back on the same control after a re-render. Runs after the help system has
   * added its "i" buttons to the new markup (its MutationObserver callback is queued first).
   */
  _restoreFocus(focus) {
    if (!focus || typeof document === 'undefined') return;
    const find = () => {
      if (focus.id) return document.getElementById(focus.id);
      if (focus.help) return this.container.querySelector(`[data-help="${CSS.escape(focus.help)}"]`);
      return this.container.querySelectorAll(FOCUSABLE)[focus.index];
    };
    const apply = () => {
      const active = document.activeElement;
      // Something else took the focus meanwhile (e.g. a click handler): leave it there
      if (active && active !== document.body && this.container.contains(active)) return;
      const el = find();
      if (el && this.container.contains(el)) el.focus({ preventScroll: true });
    };
    const el = focus.id ? find() : null;
    if (el && this.container.contains?.(el)) el.focus({ preventScroll: true });
    else Promise.resolve().then(apply);
  }

  /**
   * Card sizes come from user input, so they are set through the CSSOM after rendering:
   * the Content-Security-Policy blocks inline style attributes in rendered HTML.
   */
  applyDynamicStyles() {
    this.container.querySelectorAll('[data-cap-diameter-mm]').forEach((el) => {
      el.style.setProperty('--cap-diameter-mm', `${parseFloat(el.dataset.capDiameterMm)}mm`);
    });
    this.container.querySelectorAll('[data-tape-circ-mm]').forEach((el) => {
      el.style.setProperty('--tape-circ-mm', `${parseFloat(el.dataset.tapeCircMm)}mm`);
      el.style.setProperty('--tape-height-mm', `${parseFloat(el.dataset.tapeHeightMm)}mm`);
    });
  }

  /** Paper width in mm for the current format (for the preview zoom). */
  _paperWidthMm() {
    switch (this.activeFormat) {
      case 'scope-cap': return Math.max(this.scopeCapDiameterMm, 56);
      case 'turret-tape': return Math.max(this.turretCircumferenceMm + 4, 56);
      case 'prs-stage': return (STAGE_SIZES.find((s) => s.id === this.printOrientation) || STAGE_SIZES[0]).widthMm + 8;
      default: return (FORMATS.find((f) => f.id === this.activeFormat)?.widthMm || 190) + 8;
    }
  }

  /** Scales the paper preview to fit the desk (screen only; print uses the true size). */
  _fitPreview() {
    const area = this.container.querySelector('.print-area');
    const desk = this.container.querySelector('.desk-surface');
    if (!area || !desk) return;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(desk) : null;
    const pad = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 32;
    const avail = Math.max(120, desk.clientWidth - pad);
    const naturalPx = this._paperWidthMm() * PX_PER_MM;
    let maxZoom;
    if (this.activeFormat === 'scope-cap') maxZoom = 480 / (this.scopeCapDiameterMm * PX_PER_MM);
    else if (this.activeFormat === 'prs-stage') maxZoom = (STAGE_SIZES.find((s) => s.id === this.printOrientation) || STAGE_SIZES[0]).maxZoom;
    else maxZoom = FORMATS.find((f) => f.id === this.activeFormat)?.maxZoom || 1;
    const fitZoom = clamp(Math.min(maxZoom, avail / naturalPx), 0.3, 4);
    // On a narrow screen a wide card is too small to read: "Zoom in" shows it at true size (or
    // larger), and the desk scrolls sideways inside its own frame
    const small = fitZoom < 0.8;
    if (!small) this._zoomFull = false;
    const zoom = this._zoomFull ? Math.max(1, fitZoom) : fitZoom;
    const zoomBtn = this.container.querySelector('#btn-zoom');
    if (zoomBtn) zoomBtn.hidden = !small;
    desk.classList.toggle('is-zoomed', !!this._zoomFull);
    area.style.setProperty('--preview-zoom', zoom.toFixed(3));
    // The scale bar is shown near true size, whatever the card's preview zoom
    area.style.setProperty('--ruler-zoom', (Math.min(zoom, 1.25) / zoom).toFixed(3));
    // The settings column stays in view while scrolling, but only when it fits the window
    const settings = this.container.querySelector('.dope-settings');
    if (settings && typeof window !== 'undefined') settings.classList.toggle('is-sticky', settings.offsetHeight + 24 < window.innerHeight);
    this._checkStageFit();
  }

  _observeDesk() {
    const desk = this.container.querySelector('.desk-surface');
    if (!desk) return;
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver?.disconnect();
      this._resizeObserver = new ResizeObserver(() => this._fitPreview());
      this._resizeObserver.observe(desk);
      const settings = this.container.querySelector('.dope-settings');
      if (settings) this._resizeObserver.observe(settings);
    } else if (typeof window !== 'undefined' && !this._onWindowResize) {
      this._onWindowResize = () => this._fitPreview();
      window.addEventListener('resize', this._onWindowResize);
    }
  }

  /**
   * Keeps the 3 × 5 in / 5 × 3 in stage card inside its fixed height: when the content is taller,
   * the card text steps down (fit-1, fit-2); only when that is not enough is the warning shown.
   * Print lays text out about 2% taller than the screen, so the content must fit with that margin.
   */
  _checkStageFit() {
    const warn = this.container.querySelector('#stage-fit-warning');
    const card = this.container.querySelector('#prs-arm-board-card');
    if (!warn || !card || typeof getComputedStyle !== 'function') return;
    const inner = card.querySelector('.lamination-guide-border');
    card.classList.remove('fit-1', 'fit-2');
    if (this.printOrientation === 'full-page' || !inner) {
      warn.hidden = true;
      return;
    }
    const overflows = () => {
      const cs = getComputedStyle(card);
      const avail = card.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const gap = parseFloat(getComputedStyle(inner).rowGap) || 0;
      const kids = [...inner.children].filter((k) => k.offsetParent !== null || k.getClientRects().length);
      const content = kids.reduce((sum, k) => sum + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
      return content > avail * 0.98;
    };
    let level = 0;
    while (overflows() && level < 2) {
      if (level) card.classList.remove(`fit-${level}`);
      level++;
      card.classList.add(`fit-${level}`);
    }
    warn.hidden = !overflows();
  }

  /**
   * Re-renders after an edit, once the browser has finished moving focus (Tab) or the click that
   * blurred the field has run, so the focus lands on the same control in the new markup.
   */
  _scheduleRender() {
    if (typeof setTimeout !== 'function' || typeof document === 'undefined') {
      this.render();
      return;
    }
    clearTimeout(this._renderTimer);
    // A press that blurred the field: wait until it is released, so its click reaches the button
    if (this._pointerHeld) {
      this._renderPending = true;
      return;
    }
    this._renderTimer = setTimeout(() => {
      this._renderTimer = 0;
      this.render();
    }, 0);
  }

  _bindNumberFields() {
    const q = (sel) => this.container.querySelector(sel);
    const settingNum = (sel, apply) => bindNumber(q(sel), (v) => {
      apply(v);
      this._saveSettings();
      this._scheduleRender();
    });
    settingNum('#scope-cap-diameter-input', (v) => { this.scopeCapDiameterMm = Math.round(v * 10) / 10; });
    settingNum('#tape-circ-input', (v) => { this.turretCircumferenceMm = Math.round(v * 10) / 10; });
    settingNum('#tape-height-input', (v) => { this.turretTapeHeightMm = v; });
    settingNum('#tape-clicks-input', (v) => { this.turretClicksPerTurn = Math.round(v); });

    // Stage fields. apply() may return an error message to reject the value.
    const stageNum = (sel, apply) => {
      const input = q(sel);
      bindNumber(input, (v) => {
        const error = apply(v);
        if (error) {
          setFieldError(input, error);
          return;
        }
        this._undo = null;
        this._saveStageState();
        this._scheduleRender();
      });
    };
    const stage = () => this.prsStage;
    const u = () => this._units();
    const speed = (ms) => `${fmtTrim(u().windFromMs(ms), 1)} ${u().wind}`;
    stageNum('#input-stage-timer', (v) => { stage().timeLimitSec = Math.round(v); });
    stageNum('#input-wind-direction', (v) => { stage().windDirectionDeg = ((Math.round(v) % 360) + 360) % 360; });
    // Lull, base and gust must stay in order: lull <= base <= gust
    const lull = () => num(stage().windLullMs, 0);
    const base = () => num(stage().windBaseMs, 0);
    const gust = () => num(stage().windGustMs, 0);
    const EPS = 1e-6;
    stageNum('#input-wind-lull', (v) => {
      const ms = u().windToMs(v);
      if (ms > base() + EPS) return `The lull can’t be stronger than the base wind (${speed(base())})`;
      stage().windLullMs = ms;
      return '';
    });
    stageNum('#input-wind-base', (v) => {
      const ms = u().windToMs(v);
      if (ms < lull() - EPS) return `The base wind can’t be lighter than the lull (${speed(lull())})`;
      if (ms > gust() + EPS) return `The base wind can’t be stronger than the gust (${speed(gust())})`;
      stage().windBaseMs = ms;
      return '';
    });
    stageNum('#input-wind-gust', (v) => {
      const ms = u().windToMs(v);
      if (ms < base() - EPS) return `The gust can’t be lighter than the base wind (${speed(base())})`;
      stage().windGustMs = ms;
      return '';
    });

    this.container.querySelectorAll('[data-target-num]').forEach((input) => {
      const field = input.dataset.targetNum;
      bindNumber(input, (v) => {
        const idx = Number(input.closest?.('[data-target-idx]')?.dataset.targetIdx);
        const t = this.prsStage.targets[idx];
        if (!t) return;
        const units = this._units();
        this._undo = null;
        if (field === 'distanceM') t.distanceM = units.toM(v);
        else if (field === 'widthCm') t.widthCm = units.toCm(v);
        else if (field === 'heightCm') t.heightCm = units.toCm(v);
        else if (field === 'offsetM') t.offsetM = units.toM(v);
        else if (field === 'rounds') t.rounds = Math.round(v);
        this._saveStageState();
        this._scheduleRender();
      });
    });
  }

  // ---- events -----------------------------------------------------------------------------------

  /** Keeps the stage before a destructive change; `where` is the place the undo notice shows. */
  _remember(label, where = 'editor') {
    this._undo = { label, where, stage: deepClone(this.prsStage) };
  }

  _handleClick(e) {
    const tab = e.target.closest?.('[data-format]');
    if (tab && this.container.contains(tab)) {
      this.setFormat(tab.dataset.format);
      this.container.querySelector(`#dope-tab-${tab.dataset.format}`)?.focus();
      return;
    }
    const btn = e.target.closest?.('[data-action]');
    if (!btn || !this.container.contains(btn) || btn.disabled) return;
    const stage = this.prsStage;
    const idx = Number(btn.dataset.idx);
    switch (btn.dataset.action) {
      case 'copy-text':
        this._copyText();
        break;
      case 'toggle-zoom':
        this._zoomFull = !this._zoomFull;
        this.render();
        this.container.querySelector('#btn-zoom')?.focus();
        break;
      case 'save-image':
        this._saveImage();
        break;
      case 'use-default-ranges':
        appState.state.customDopeRanges = [];
        appState.notify('dopeRanges');
        toast('Using the default distances', 'ok');
        break;
      case 'goto-targets': {
        const heading = this.container.querySelector('#stage-targets-heading');
        heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        heading?.focus({ preventScroll: true });
        break;
      }
      case 'add-prop': {
        const current = (stage.propsDescription || '').trim();
        const addition = `${btn.dataset.value.toLowerCase()} (2)`;
        stage.propsDescription = current ? `${current}, then ${addition}` : addition.charAt(0).toUpperCase() + addition.slice(1);
        this._undo = null;
        this._saveStageState();
        this.render();
        break;
      }
      case 'target-up':
      case 'target-down': {
        const j = btn.dataset.action === 'target-up' ? idx - 1 : idx + 1;
        if (!stage.targets[idx] || !stage.targets[j]) return;
        [stage.targets[idx], stage.targets[j]] = [stage.targets[j], stage.targets[idx]];
        this._undo = null;
        this._saveStageState();
        this.render();
        // Keep focus on the same button of the moved target (or its other move button at the ends)
        const dir = btn.dataset.action === 'target-up' ? 'up' : 'down';
        const same = this.container.querySelector(`#tgt-${j}-${dir}`);
        (same && !same.disabled ? same : this.container.querySelector(`#tgt-${j}-${dir === 'up' ? 'down' : 'up'}`))?.focus();
        break;
      }
      case 'target-flip': {
        // Phone number keyboards often have no minus key: this switches the target to the other side
        const t = stage.targets[idx];
        if (!t) return;
        t.offsetM = -num(t.offsetM, 0);
        this._undo = null;
        this._saveStageState();
        this.render();
        this.container.querySelector(`#tgt-${idx}-sign`)?.focus();
        break;
      }
      case 'target-copy': {
        if (!stage.targets[idx] || stage.targets.length >= 30) return;
        const copy = deepClone(stage.targets[idx]);
        copy.id = `t${Date.now()}`;
        copy.name = `${copy.name} (copy)`.slice(0, 60);
        stage.targets.splice(idx + 1, 0, copy);
        this._undo = null;
        this._saveStageState();
        this.render();
        this.container.querySelector(`#tgt-${idx + 1}-name`)?.focus();
        break;
      }
      case 'target-delete': {
        if (!stage.targets[idx] || stage.targets.length <= 1) return;
        this._remember(`Removed T${idx + 1} (${stage.targets[idx].name}).`);
        stage.targets.splice(idx, 1);
        this._saveStageState();
        this.render();
        this.container.querySelector('[data-action="undo"]')?.focus();
        break;
      }
      case 'add-target': {
        if (stage.targets.length >= 30) {
          toast('A stage can have at most 30 targets', 'info');
          return;
        }
        const count = stage.targets.length;
        const lastDist = count > 0 ? num(stage.targets[count - 1].distanceM, 300) : 300;
        stage.targets.push({
          id: `t${Date.now()}`,
          name: `Target ${count + 1}`,
          shape: 'gong',
          distanceM: Math.min(1500, lastDist + 80),
          widthCm: 30,
          heightCm: 30,
          rounds: 2,
          prop: '',
          notes: '',
          offsetM: (count % 2 === 0 ? 1 : -1) * 12,
        });
        this._undo = null;
        this._saveStageState();
        this.render();
        this.container.querySelector(`#tgt-${count}-name`)?.focus();
        break;
      }
      case 'reset-stage':
        this._remember('Started over from the default stage.');
        this.prsStage = deepClone(this.presets['rooftop-barricade']);
        this._saveStageState();
        this.render();
        this.container.querySelector('[data-action="undo"]')?.focus();
        break;
      case 'undo':
        if (this._undo) {
          const where = this._undo.where;
          this.prsStage = this._undo.stage;
          this._undo = null;
          this._saveStageState();
          this.render();
          this.container.querySelector(where === 'settings' ? '#stage-preset-select' : '#stage-targets-heading')?.focus();
          toast('Undone', 'ok');
        }
        break;
      default:
        break;
    }
  }

  _handleChange(e) {
    const el = e.target;
    if (!el || !this.container.contains(el) || el.type === 'number' || el.dataset?.targetNum || el.inputMode === 'decimal' || el.inputMode === 'numeric') return;
    const stage = this.prsStage;
    if (el.name === 'stage-size') {
      this.setPrintOrientation(el.value);
      return;
    }
    if (el.name === 'card-theme') {
      this.setTheme(el.value);
      return;
    }
    switch (el.id) {
      case 'scope-cap-preset-select':
        if (el.value !== 'custom') {
          this.scopeCapDiameterMm = parseFloat(el.value);
          this._saveSettings();
          this.render();
        } else {
          this.container.querySelector('#scope-cap-diameter-input')?.focus();
        }
        return;
      case 'turret-tape-preset-select':
        if (el.value !== 'custom') {
          this.turretCircumferenceMm = parseFloat(el.value);
          this._saveSettings();
          this.render();
        } else {
          this.container.querySelector('#tape-circ-input')?.focus();
        }
        return;
      case 'stage-preset-select':
        if (el.value) this.loadPreset(el.value);
        return;
      case 'wind-dir-select':
        if (el.value !== 'custom') {
          this._undo = null;
          stage.windDirectionDeg = Number(el.value);
          this._saveStageState();
          this.render();
        }
        return;
      case 'input-stage-name':
        this._undo = null;
        stage.name = el.value.trim().slice(0, 80) || 'Match stage';
        this._saveStageState();
        this._scheduleRender();
        return;
      case 'input-stage-props':
        this._undo = null;
        stage.propsDescription = el.value.trim().slice(0, 200);
        this._saveStageState();
        this._scheduleRender();
        return;
      default:
        break;
    }
    const field = el.dataset?.targetField;
    if (field) {
      const idx = Number(el.closest('[data-target-idx]')?.dataset.targetIdx);
      const t = stage.targets[idx];
      if (!t) return;
      this._undo = null;
      const val = el.value.trim();
      if (field === 'shape') t.shape = Object.hasOwn(SHAPES, val) ? val : 'gong';
      else if (field === 'name') t.name = val.slice(0, 60) || `Target ${idx + 1}`;
      else if (field === 'prop') t.prop = val.slice(0, 60);
      else if (field === 'notes') t.notes = val.slice(0, 80);
      this._saveStageState();
      this._scheduleRender();
    }
  }

  /** Arrow keys, Home and End move between the format tabs. */
  _handleKeydown(e) {
    const tab = e.target.closest?.('[role="tab"][data-format]');
    if (!tab) return;
    const i = FORMAT_IDS.indexOf(tab.dataset.format);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % FORMAT_IDS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + FORMAT_IDS.length) % FORMAT_IDS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = FORMAT_IDS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    this.setFormat(FORMAT_IDS[next]);
    this.container.querySelector(`#dope-tab-${FORMAT_IDS[next]}`)?.focus();
  }

  /** Hovering a target row highlights it on the stage drawing (and the other way round). */
  _handleHover(e, entering) {
    const hit = e.target.closest?.('#prs-arm-board-card [data-target-idx]');
    if (!hit) return;
    const idx = entering ? hit.dataset.targetIdx : null;
    this.container.querySelectorAll('#prs-arm-board-card [data-target-idx]').forEach((n) => {
      n.classList.toggle('highlighted', idx !== null && n.dataset.targetIdx === idx);
    });
  }

  // ---- copy / save ------------------------------------------------------------------------------

  /** Plain-text version of the current card. */
  _textForFormat() {
    const u = this._units();
    if (this.activeFormat === 'prs-stage') {
      const stage = this.prsStage;
      const s = this._stageSummary(stage, u);
      const targets = this._stageTargets || [];
      const lines = [
        stage.name,
        `Time ${s.timeLimitSec} s · ${plural(s.totalRounds, 'shot')} · ${s.pace} s per shot`,
        `Wind lull / base / gust: ${s.lull} / ${s.base} / ${s.gust} ${u.wind} from ${clockLabel(s.dir)} (${fmtInt(s.dir)}°)`,
      ];
      if (stage.propsDescription) lines.push(`Positions: ${stage.propsDescription}`);
      lines.push('');
      targets.forEach((t) => {
        lines.push(`T${t.index} ${t.name}: ${t.displayDistance} ${t.displayDistUnit}, ${t.displayWidth} × ${t.displayHeight} ${t.displaySizeUnit}, ${plural(Number(t.rounds), 'shot')}${t.prop ? `, ${t.prop}` : ''}`);
        lines.push(`   Elevation ${t.dialValue} ${t.dialUnit} (${fmtInt(t.clicks)} clicks) · wind ${t.holdDirLabel} ${t.lullHold} / ${t.baseHold} / ${t.gustHold} ${u.windAng}${t.notes ? ` · ${t.notes}` : ''}`);
      });
      return lines.join('\n');
    }
    const rows = this._rows || [];
    const profile = appState.getActiveProfile();
    const speeds = this.activeFormat === 'stock-tape' ? u.tapeSpeeds : u.windSpeeds;
    const head = [`Range ${u.dist}`, `Elev ${u.elev}`, 'Clicks', ...speeds.map((s) => `Wind ${s} ${u.wind}`), `Speed ${u.vel}`];
    const body = rows.map((r) => [fmtInt(r.dist), fmt(r.elev, this.activeFormat === 'a4-sheet' ? 2 : 1), fmtInt(r.clicks), ...speeds.map((s) => fmt(r.windHold(s), 1)), fmtInt(u.fromMs(r.velocityMs))]);
    const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
    const line = (cells) => cells.map((c, i) => c.padStart(widths[i])).join('  ');
    return [
      `${profile.name} · ${profile.caliber}`,
      `Wind holds in ${u.windAng} for a full-value crosswind, wind only. Clicks: ${profile.optic?.clickName || '0.1 MRAD'}.`,
      '',
      line(head),
      ...body.map(line),
    ].join('\n');
  }

  _copyText() {
    const text = this._textForFormat();
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast('Copy is not available here', 'bad', 'The browser blocked clipboard access.');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => toast('Copied as text', 'ok'),
      () => toast('Could not copy', 'bad', 'The browser blocked clipboard access.'),
    );
  }

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _fileName(base, ext) {
    const name = String(base || 'card').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'card';
    return `${name}.${ext}`;
  }

  /** Scope cap and turret tape save as SVG (true size); the table cards save as PNG. */
  _saveImage() {
    const profile = appState.getActiveProfile();
    try {
      if (this.activeFormat === 'scope-cap' || this.activeFormat === 'turret-tape') {
        const svg = this.container.querySelector(this.activeFormat === 'scope-cap' ? '.scope-cap-svg' : '#turret-tape-svg');
        if (!svg) return;
        const clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (this.activeFormat === 'scope-cap') {
          clone.setAttribute('width', `${this.scopeCapDiameterMm}mm`);
          clone.setAttribute('height', `${this.scopeCapDiameterMm}mm`);
        }
        const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
        this._download(blob, this._fileName(`${profile.name}-${this.activeFormat}`, 'svg'));
        toast('Image saved', 'ok', 'An SVG at true size: print it at 100%.');
        return;
      }
      this._savePng();
    } catch (e) {
      console.warn('Saving the image failed', e);
      toast('Could not save the image', 'bad');
    }
  }

  _savePng() {
    const u = this._units();
    const profile = appState.getActiveProfile();
    let title;
    let subtitle;
    let headers;
    let rows;
    let theme = 'light';
    if (this.activeFormat === 'prs-stage') {
      const s = this._stageSummary(this.prsStage, u);
      title = this.prsStage.name;
      subtitle = `${s.timeLimitSec} s · ${plural(s.totalRounds, 'shot')} · wind ${s.lull}/${s.base}/${s.gust} ${u.wind} from ${clockLabel(s.dir)} · ${profile.name}`;
      headers = ['Target', `Range ${u.dist}`, `Elev ${u.elev}`, 'Clicks', `Wind lull/base/gust ${u.windAng}`, 'Shots', 'Note'];
      rows = (this._stageTargets || []).map((t) => [`T${t.index} ${t.name}`, String(t.displayDistance), t.dialValue, fmtInt(t.clicks), `${t.holdDirLabel} ${t.lullHold} / ${t.baseHold} / ${t.gustHold}`, fmtInt(t.rounds), t.notes || '']);
      theme = this.cardTheme;
    } else {
      const speeds = this.activeFormat === 'stock-tape' ? u.tapeSpeeds : u.windSpeeds;
      title = `${profile.name}`;
      subtitle = `${profile.caliber} · wind holds in ${u.windAng}, full-value crosswind · clicks ${profile.optic?.clickName || '0.1 MRAD'}`;
      headers = [`Range ${u.dist}`, `Elev ${u.elev}`, 'Clicks', ...speeds.map((sp) => `Wind ${sp} ${u.wind}`), `Speed ${u.vel}`];
      rows = (this._rows || []).map((r) => [fmtInt(r.dist), fmt(r.elev, 1), fmtInt(r.clicks), ...speeds.map((sp) => fmt(r.windHold(sp), 1)), fmtInt(u.fromMs(r.velocityMs))]);
    }

    const palettes = {
      light: { bg: '#ffffff', ink: '#111418', muted: '#4a525c', line: '#d5d9de', band: '#f2f4f6', accent: '#0b4f8a' },
      dark: { bg: '#0d1117', ink: '#eef1f4', muted: '#9aa4b0', line: '#2b333d', band: '#151b23', accent: '#7cc4f2' },
      green: { bg: '#1d2a1e', ink: '#eef2e6', muted: '#b6c3a9', line: '#3b4f3d', band: '#233225', accent: '#e6d28a' },
    };
    const pal = palettes[theme] || palettes.light;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.font = font(600, 14);
    const colW = headers.map((h, i) => Math.ceil(Math.max(ctx.measureText(h).width, ...rows.map((r) => ctx.measureText(String(r[i])).width)) + 22));
    const pad = 24;
    const rowH = 28;
    const W = Math.max(480, pad * 2 + colW.reduce((a, b) => a + b, 0));
    const H = pad * 2 + 30 + 22 + 16 + rowH * (rows.length + 1) + 24;
    const scale = 2;
    canvas.width = W * scale;
    canvas.height = H * scale;
    ctx.scale(scale, scale);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.ink;
    ctx.font = font(700, 20);
    ctx.fillText(title, pad, pad + 12);
    ctx.fillStyle = pal.muted;
    ctx.font = font(500, 13);
    ctx.fillText(subtitle, pad, pad + 40);
    let y = pad + 30 + 22 + 16;
    let x = pad;
    ctx.fillStyle = pal.band;
    ctx.fillRect(pad, y, W - pad * 2, rowH);
    ctx.fillStyle = pal.muted;
    ctx.font = font(700, 12);
    headers.forEach((h, i) => { ctx.fillText(h, x + 8, y + rowH / 2); x += colW[i]; });
    y += rowH;
    rows.forEach((r, ri) => {
      x = pad;
      if (ri % 2 === 1) { ctx.fillStyle = pal.band; ctx.fillRect(pad, y, W - pad * 2, rowH); }
      r.forEach((cell, i) => {
        ctx.fillStyle = i === 1 || i === 2 ? pal.accent : pal.ink;
        ctx.font = font(i === 2 ? 700 : 500, 14);
        ctx.fillText(String(cell), x + 8, y + rowH / 2);
        x += colW[i];
      });
      ctx.strokeStyle = pal.line;
      ctx.beginPath();
      ctx.moveTo(pad, y + rowH);
      ctx.lineTo(W - pad, y + rowH);
      ctx.stroke();
      y += rowH;
    });
    ctx.fillStyle = pal.muted;
    ctx.font = font(500, 11);
    ctx.fillText('Ballistic Workbench', pad, H - pad / 2 - 4);
    canvas.toBlob((blob) => {
      if (!blob) {
        toast('Could not save the image', 'bad');
        return;
      }
      this._download(blob, this._fileName(`${title}-${this.activeFormat}`, 'png'));
      toast('Image saved', 'ok', 'A PNG for your phone.');
    }, 'image/png');
  }
}
