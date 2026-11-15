/**
 * Ballistic Workbench - Compare models view.
 * Solves the active rifle and atmosphere with each solver model (point mass with G1 or G7 drag,
 * modified point mass), each zeroed on its own, and shows how far they differ:
 *   - a Låda Glass line chart (SVG): elevation difference from G7 (default; the curves would
 *     otherwise lie on top of each other), drift difference from G7, or elevation by model,
 *     with a checkbox per model to hide lines (the chart legend names the lines shown)
 *   - a table of the differences from G7, in the user's units
 *   - "About the models", each with "Use in Solver"
 * MPM flies the bullet's own drag table (G1 or G7, from the rifle's bullet), so its elevation is
 * explained against the point-mass line with that same table.
 * Recalculates whenever the rifle, atmosphere, units or solver settings change. Trajectories can end
 * early (very slow or draggy bullets), so every comparison only uses the distances all models reach,
 * and a failed solve shows a message instead of breaking the view.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { esc } from '../core/escape.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { pointAtDistance, solveTrajectory, solveZeroAngle } from '../physics/solvers.js';
import { icon } from './icons.js';
import { toast } from './notify.js';

const MODELS = [
  {
    id: 'G7', key: 'g7', label: 'G7', name: 'Point mass, G7 drag',
    about: 'Reference drag shape for modern boat-tail bullets; usually the better fit for long-range match bullets.',
  },
  {
    id: 'G1', key: 'g1', label: 'G1', name: 'Point mass, G1 drag',
    about: 'Reference drag shape for flat-base bullets. With boat-tail match bullets it drifts from reality, mostly past ~600 m and through transonic.',
  },
  {
    id: 'MPM', key: 'mpm', label: 'MPM', name: 'Modified point mass',
    about: (table) => `Point mass with this bullet's own drag model (${table}), plus spin drift, aerodynamic jump from crosswind, and Coriolis. In calm air its elevation matches the ${table} line; the difference shows in drift.`,
  },
];
const ABBR = {
  MPM: '<abbr title="Modified point mass">MPM</abbr>',
};
// Chart modes: what is plotted for each model
const MODES = [
  { id: 'diff', button: 'Elevation difference', title: 'Elevation difference from G7', field: 'diff', unit: 'angle', signed: true },
  { id: 'drift', button: 'Drift difference', title: 'Drift difference from G7', field: 'dDrift', unit: 'drift', signed: true },
  { id: 'elev', button: 'Elevation', title: 'Elevation by model', field: 'elev', unit: 'angle', signed: false },
];

/** Elevation of a trajectory row in radians, or NaN when the row is missing. */
function elevRad(p) {
  if (!p) return NaN;
  const r = p.elevationRad ?? p.elevationMrad / 1000;
  return Number.isFinite(r) ? r : NaN;
}

/** Formats a signed difference; values that round to zero show as 0.00, never −0.00. */
function signed(v, decimals) {
  if (!Number.isFinite(v)) return '–';
  const r = Number(v.toFixed(decimals));
  if (!Number.isFinite(r) || r === 0) return (0).toFixed(decimals);
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals)}`;
}

export class SolverLabView {
  constructor(containerElement) {
    this.container = containerElement;
    this.chart = null;
    this.data = null;
    this.meta = {}; // per model: { table, bcEstimated } from the solver telemetry
    this.error = null;
    this.mode = 'diff'; // MODES id
    this.visible = new Set(MODELS.map((m) => m.key));

    this.render();
    this.runComparison();

    this.unsubscribe = appState.subscribe((state, key) => {
      if (['activeProfile', 'activeEnvironment', 'profile', 'profiles', 'environment', 'units', 'displayUnits', 'solverConfig', 'import'].includes(key)) {
        this.render();
        this.runComparison();
      }
    });
  }

  /** Full rebuild (theme change): the chart redraws with the new colours. */
  refresh() {
    this.render();
    this.runComparison();
  }

  destroy() {
    this.unsubscribe?.();
    this._destroyChart();
    this._wrapObserver?.disconnect();
    this._wrapObserver = null;
  }

  _destroyChart() {
    this.chart?.destroy?.();
    this.chart = null;
  }

  _units() {
    const du = appState.state.displayUnits || {};
    const isImp = appState.state.systemUnits === 'imperial';
    return {
      dist: du.distance === 'yd' ? 'yd' : du.distance === 'm' ? 'm' : isImp ? 'yd' : 'm',
      angle: du.elevationAngle === 'MOA' ? 'MOA' : 'MRAD',
      drift: du.windDriftOffset === 'in' ? 'in' : du.windDriftOffset === 'cm' ? 'cm' : isImp ? 'in' : 'cm',
    };
  }

  _angle(rad) {
    return UnitConverter.fromSI(rad, this._units().angle);
  }

  // ---- data -----------------------------------------------------------------------------------

  runComparison() {
    try {
      this._solveAll();
      this.error = null;
    } catch (err) {
      this.data = null;
      this.error = err;
    }
    this.drawChart();
    this.renderTable();
    this._renderStatus();
  }

  /** Shown instead of the chart and table when the models can't be solved for this rifle. */
  _renderStatus() {
    const box = this.container.querySelector('#lab-status');
    if (!box) return;
    const ok = !this.error && this.data?.g7?.length > 1;
    box.hidden = ok;
    box.textContent = ok ? '' : "These models couldn't be compared for this rifle. Check its muzzle velocity, bullet weight, BC and zero distance in the Library.";
    this.container.querySelector('#lab-chart')?.toggleAttribute('hidden', !ok);
  }

  _solveAll() {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const cfg = appState.state.solverConfig || {};
    const u = this._units();

    const atmos = getAtmosphericConditions({
      pressurePa: env.pressureHpa * 100,
      tempK: env.temperatureC + 273.15,
      relativeHumidity: env.humidityPercent / 100,
      altitudeM: env.altitudeM,
    });

    // Steps and length in the user's distance unit, so table rows land on round numbers
    const unitM = u.dist === 'yd' ? 0.9144 : 1;
    const stepM = 50 * unitM;
    this.maxDisp = u.dist === 'yd' ? 1300 : 1200;
    const maxRangeM = this.maxDisp * unitM;

    const data = {};
    const meta = {};
    for (const m of MODELS) {
      const zero = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs, m.id);
      const sol = solveTrajectory({
        profile: { ...profile, zeroAngleRad: zero },
        environment: env,
        airDensity: atmos.densityKgM3,
        speedOfSound: atmos.speedOfSoundMs,
        algorithm: m.id,
        stepM,
        maxRangeM: maxRangeM + 0.01,
        includeSpinDrift: cfg.includeSpinDrift !== false,
        includeCoriolis: cfg.includeCoriolis !== false,
        includeAerodynamicJump: cfg.includeAerodynamicJump !== false,
      });
      data[m.key] = Array.isArray(sol?.trajectory) ? sol.trajectory : [];
      meta[m.key] = { table: sol?.telemetry?.dragModel === 'G1' ? 'G1' : 'G7', bcEstimated: sol?.telemetry?.bcEstimated === true };
    }
    this.data = data;
    this.meta = meta;
  }

  /** Rows the G7 reference has (the chart and table are built on its distances). */
  _rows() {
    return this.data?.g7?.length || 0;
  }

  /** Rows both models reach (trajectories of slow or draggy bullets can end early). */
  _common(a, b) {
    return Math.min(this.data?.[a]?.length || 0, this.data?.[b]?.length || 0);
  }

  /** Data key of the point-mass model with MPM's drag table. */
  _mpmRef() {
    return this.meta?.mpm?.table === 'G1' ? 'g1' : 'g7';
  }

  _mode() {
    return MODES.find((m) => m.id === this.mode) || MODES[0];
  }

  /** Points of a model at the G7 distances: d (display units), elev and diff (angle units), dDrift (drift units). */
  _series(key) {
    const u = this._units();
    const unitM = u.dist === 'yd' ? 0.9144 : 1;
    const base = this.data?.g7 || [];
    const pts = this.data?.[key] || [];
    const out = [];
    const n = Math.min(base.length, pts.length);
    for (let i = 0; i < n; i++) {
      // Lines start at the first table row: at the muzzle there is no elevation to compare
      if (!(pts[i]?.distanceM > 0)) continue;
      const elev = this._angle(elevRad(pts[i]));
      const elevG7 = this._angle(elevRad(base[i]));
      const dDrift = UnitConverter.fromSI(pts[i].driftM - base[i].driftM, u.drift);
      out.push({ d: Math.round(pts[i].distanceM / unitM), elev, diff: elev - elevG7, dDrift });
    }
    return out;
  }

  // ---- chart (LadaGlass.chart.line) ------------------------------------------------------------

  _chartData() {
    const u = this._units();
    const mode = this._mode();
    const unit = mode.unit === 'drift' ? u.drift : u.angle;
    const shown = MODELS.filter((m) => this.visible.has(m.key));
    const series = shown.map((m) => ({
      name: m.key === 'g7' && mode.signed ? 'G7 (reference)' : m.label,
      points: this._series(m.key).map((p) => [p.d, p[mode.field]]).filter((p) => Number.isFinite(p[1])),
    }));
    // Decimals from the size of the values shown, so small differences don't all read 0.0
    let span = 0;
    for (const s of series) for (const p of s.points) if (Number.isFinite(p[1])) span = Math.max(span, Math.abs(p[1]));
    const dec = span < 0.5 ? 2 : span < 10 ? 1 : 0;
    const fmtY = mode.signed ? (v) => `${signed(v, dec)} ${unit}` : (v) => `${(Math.abs(v) < 0.5 * 10 ** -dec ? 0 : v).toFixed(dec)} ${unit}`;
    return {
      label: `${mode.title} (${unit})`,
      series,
      x: { type: 'linear', format: (v) => `${Math.round(v).toLocaleString('en-US')} ${u.dist}` },
      y: { format: fmtY },
    };
  }

  /** A few plain sentences on why the lines differ, from the numbers on screen. */
  _explain() {
    const el = this.container.querySelector('#lab-explain');
    if (!el) return;
    if (this._rows() < 2) {
      el.textContent = '';
      return;
    }
    const { g7, g1, mpm } = this.data;
    const refKey = this._mpmRef();
    const ref = this.data[refKey];
    const table = this.meta?.mpm?.table || 'G7';
    const u = this._units();
    const ang = (p) => this._angle(elevRad(p));
    const dist = (p) => Math.round(UnitConverter.fromSI(p.distanceM, u.dist));
    const profile = appState.getActiveProfile();
    const estimated = profile?.bullet?.bcG7Estimated === true || this.meta?.g7?.bcEstimated || this.meta?.g1?.bcEstimated;
    const parts = [];
    const short = (label, rows) => {
      const reach = rows > 1 ? ` past ${dist(g7[rows - 1])} ${u.dist}` : '';
      parts.push(`${label} couldn't be solved${reach} for this rifle, so its line ${rows > 1 ? 'stops early' : 'is missing'}. Check the bullet's weight, length, BC and the barrel twist.`);
    };

    const endM = g7[g7.length - 1].distanceM;
    if (endM < this.maxDisp * (u.dist === 'yd' ? 0.9144 : 1) - 1) {
      parts.push(`The G7 path ends at ${dist(g7[g7.length - 1])} ${u.dist}: the bullet slows down too much to go further.`);
    }
    const n1 = this._common('g7', 'g1');
    let last = n1 - 1;
    const g1Diff = n1 > 1 ? ang(g1[last]) - ang(g7[last]) : NaN;
    if (n1 < this._rows()) short('G1', n1);
    if (Number.isFinite(g1Diff)) {
      const close = Math.abs(g1Diff) < (u.angle === 'MOA' ? 0.35 : 0.1);
      if (close) {
        parts.push(estimated
          ? `G1 and G7 agree within ${Math.abs(g1Diff).toFixed(2)} ${u.angle} out to ${dist(g7[last])} ${u.dist}. One of the two BCs is estimated from the other, so this doesn't show which model fits the bullet better.`
          : `G1 and G7 agree within ${Math.abs(g1Diff).toFixed(2)} ${u.angle} out to ${dist(g7[last])} ${u.dist}: both BCs were measured for this bullet, so they predict nearly the same path.`);
      } else {
        parts.push(`G1 needs ${Math.abs(g1Diff).toFixed(2)} ${u.angle} ${g1Diff > 0 ? 'more' : 'less'} than G7 at ${dist(g7[last])} ${u.dist}; for boat-tail bullets G7 is usually closer to reality.${estimated ? ' One of the two BCs is estimated from the other, so part of this gap comes from that estimate.' : ''}`);
      }
    }

    // MPM against the point-mass line with its own drag table: what is left is jump (and Coriolis)
    const nm = this._common('mpm', refKey);
    if (nm < this._rows()) short('MPM', nm);
    if (nm < 2) {
      el.textContent = parts.join(' ');
      return;
    }
    last = nm - 1;
    const mid = Math.max(1, Math.min(last, Math.round(last / 2)));
    const jump = ang(mpm[mid]) - ang(ref[mid]);
    const tableNote = table === 'G1'
      ? "MPM uses this bullet's G1 drag table, so its elevation follows the G1 line, not G7. "
      : '';
    if (Number.isFinite(jump) && Math.abs(jump) >= 0.005) {
      parts.push(`${tableNote}MPM sits a steady ${jump > 0 ? '+' : '−'}${Math.abs(jump).toFixed(2)} ${u.angle} from the ${table} line: that is aerodynamic jump from the crosswind, an angle set at the muzzle, so it is about the same at every distance.`);
    } else if (Number.isFinite(jump)) {
      parts.push(`${tableNote}In calm air MPM needs the same elevation as the ${table} line; its difference is drift.`);
    }
    const dDrift = UnitConverter.fromSI(mpm[last].driftM - ref[last].driftM, u.drift);
    if (Number.isFinite(dDrift)) {
      parts.push(`MPM drifts ${Math.abs(dDrift).toFixed(1)} ${u.drift} ${dDrift >= 0 ? 'right' : 'left'} of the ${table} line at ${dist(mpm[last])} ${u.dist} from spin drift and Coriolis.`);
    }
    el.textContent = parts.join(' ');
  }

  /** The note under the chart: where the lines meet, and MPM's offset at the zero (jump). */
  _note() {
    const el = this.container.querySelector('#lab-note');
    if (!el) return;
    const u = this._units();
    const profile = appState.getActiveProfile();
    const zeroM = Number(profile?.zeroDistanceM) > 0 ? Number(profile.zeroDistanceM) : 100;
    const zeroDisp = Math.round(UnitConverter.fromSI(zeroM, u.dist));
    const table = this.meta?.mpm?.table || 'G7';
    const a = pointAtDistance(this.data?.mpm, zeroM);
    const b = pointAtDistance(this.data?.[this._mpmRef()], zeroM);
    const off = a && b ? this._angle(elevRad(a)) - this._angle(elevRad(b)) : NaN;
    let text = `Each model is zeroed on its own in calm air, so the G1 and G7 lines meet at the zero distance (${zeroDisp} ${u.dist}).`;
    if (Number.isFinite(off) && Math.abs(off) >= 0.005) {
      text += ` MPM sits ${off > 0 ? '+' : '−'}${Math.abs(off).toFixed(2)} ${u.angle} off the ${table} line there: aerodynamic jump from the crosswind, which the zero doesn't include.`;
    }
    text += ' Lines start at the first table row. Hover or focus the chart and use the arrow keys to read values.';
    el.textContent = text;
  }

  drawChart() {
    const host = this.container.querySelector('#lab-chart');
    if (!host) return;
    if (this._rows() < 2 || typeof LadaGlass === 'undefined' || !LadaGlass.chart?.line) {
      this._destroyChart();
      this._explain();
      this._note();
      return;
    }
    const data = this._chartData();
    if (this.chart && this.chart.host === host) {
      this.chart.update(data);
    } else {
      this._destroyChart();
      this.chart = LadaGlass.chart.line(host, data);
      this.chart.host = host;
    }
    this._explain();
    this._note();
  }

  // ---- table ----------------------------------------------------------------------------------

  renderTable() {
    const tbody = this.container.querySelector('#lab-delta-tbody');
    if (!tbody) return;
    if (this._rows() < 1) {
      tbody.replaceChildren();
      return;
    }
    const u = this._units();
    const unitM = u.dist === 'yd' ? 0.9144 : 1;
    const { g7, g1, mpm } = this.data;
    const dec = 2;
    const dDec = 1;
    const ang = (p) => this._angle(elevRad(p));
    const drift = (p) => (p ? UnitConverter.fromSI(p.driftM, u.drift) : NaN);
    const fixed = (v, d) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d) : '–');

    let html = '';
    for (let i = 0; i < g7.length; i++) {
      const b = g7[i];
      if (!b || !Number.isFinite(b.distanceM)) continue;
      const d = Math.round(b.distanceM / unitM);
      if (d === 0 || d % 100 !== 0) continue;
      const row = [g1[i], mpm[i]];
      const diffs = row.map((p) => (p ? signed(ang(p) - ang(b), dec) : '–'));
      const big = row[0] && Math.abs(ang(row[0]) - ang(b)) > (u.angle === 'MOA' ? 1.7 : 0.5);
      html += `
        <tr>
          <th scope="row">${d}</th>
          <td class="lg-num">${fixed(ang(b), dec)}</td>
          <td class="lg-num lab-col-group${big ? ' lab-big' : ''}">${diffs[0]}</td>
          <td class="lg-num">${diffs[1]}</td>
          <td class="lg-num lab-col-group">${mpm[i] ? signed(drift(mpm[i]) - drift(b), dDec) : '–'}</td>
          <td class="lg-num lab-col-group">${fixed(b.tofS, 2)}</td>
        </tr>`;
    }
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers and constants only
    tbody.innerHTML = html;
    this._syncScrollHint();
  }

  /** The table scrolls sideways inside its card on narrow screens: say so, and let keyboards scroll it. */
  _syncScrollHint() {
    const wrap = this.container.querySelector('#lab-table-wrap');
    const hint = this.container.querySelector('#lab-scroll-hint');
    if (!wrap || !hint) return;
    const scrolls = wrap.scrollWidth > wrap.clientWidth + 1;
    hint.hidden = !scrolls;
    if (scrolls) {
      wrap.setAttribute('tabindex', '0');
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-labelledby', 'lab-table-title');
      wrap.setAttribute('aria-describedby', 'lab-scroll-hint');
    } else {
      ['tabindex', 'role', 'aria-labelledby', 'aria-describedby'].forEach((a) => wrap.removeAttribute(a));
    }
  }

  // ---- render ---------------------------------------------------------------------------------

  render() {
    this._destroyChart(); // its host is replaced below
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const active = appState.state.solverConfig?.activeAlgorithm || 'G7';
    const u = this._units();
    const mode = this._mode();
    const onlyOne = this.visible.size === 1;
    const mpmTable = profile?.bullet?.dragModel === 'G1' ? 'G1' : 'G7';
    const unit = (x) => `<span class="lab-unit">(${x})</span>`;

    const modeRadios = MODES.map((m) => `
      <input type="radio" name="lab-mode" id="lab-mode-${m.id}" value="${m.id}" ${this.mode === m.id ? 'checked' : ''} />
      <label for="lab-mode-${m.id}">${m.button}</label>`).join('');

    const toggles = MODELS.map((m) => {
      const on = this.visible.has(m.key);
      const locked = on && onlyOne;
      return `
        <label class="lab-show" for="lab-show-${m.key}">
          <input type="checkbox" class="lg-check" id="lab-show-${m.key}" data-series="${m.key}" ${on ? 'checked' : ''} ${locked ? 'disabled aria-describedby="lab-show-hint"' : ''} />
          ${ABBR[m.id] || m.label}
        </label>`;
    }).join('');

    const models = MODELS.map((m) => {
      const inUse = m.id === active;
      return `
        <li class="lab-model" aria-labelledby="lab-model-${m.key}">
          <div class="lab-model-text">
            <h3 class="lab-model-name" id="lab-model-${m.key}">${esc(m.name)}${m.id === 'MPM' ? ` (${ABBR[m.id]})` : ''}</h3>
            <p class="lg-muted">${esc(typeof m.about === 'function' ? m.about(mpmTable) : m.about)}</p>
          </div>
          <div class="lab-model-action">
            ${inUse
              ? `<span class="lg-badge lg-badge-ok lab-in-use" tabindex="-1">${icon('check')} In use</span>`
              : `<button type="button" class="lg-btn" data-use="${m.id}" aria-label="Use ${esc(m.name)} in the Solver">Use in Solver</button>`}
          </div>
        </li>`;
    }).join('');

    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    this.container.innerHTML = `
      <section class="lab-view lg-stack" aria-labelledby="lab-title">
        <header class="lg-header view-header">
          <div>
            <h1 class="lg-title" id="lab-title">Compare models</h1>
            <p class="lg-muted">How the G1 and G7 drag models and modified point mass (spin drift, jump and Coriolis) differ for your rifle and conditions.</p>
          </div>
          <ul class="lab-context" aria-label="Compared for">
            <li class="lg-chip lg-plain" title="Rifle: ${esc(profile.name)}">${icon('rifle')}<span>${esc(profile.name)}</span></li>
            <li class="lg-chip lg-plain" title="Atmosphere: ${esc(env.name)}">${icon('thermometer')}<span>${esc(env.name)}</span></li>
          </ul>
        </header>

        <div class="lab-grid">
          <section class="lg-card lab-chart-card" aria-labelledby="lab-chart-title">
            <div class="lab-card-head">
              <h2 class="lg-label" id="lab-chart-title">${mode.title} (${mode.unit === 'drift' ? u.drift : u.angle})</h2>
              <div class="lg-segmented lab-mode" role="radiogroup" aria-label="What the chart shows">${modeRadios}</div>
            </div>
            <fieldset class="lab-shows">
              <legend class="lg-small lg-muted">Models</legend>
              ${toggles}
            </fieldset>
            <p class="lg-sr-only" id="lab-show-hint">At least one model stays on the chart.</p>
            <p class="lg-alert lg-alert-warn lab-status" id="lab-status" role="status" hidden></p>
            <div class="lab-chart" id="lab-chart"></div>
            <p class="lg-small lg-muted lab-note" id="lab-note"></p>
            <p class="lg-small lab-explain" id="lab-explain" aria-live="polite"></p>
          </section>

          <section class="lg-card lab-about-card" aria-labelledby="lab-about-title">
            <h2 class="lg-label" id="lab-about-title">About the models</h2>
            <ul class="lab-models">${models}</ul>
          </section>
        </div>

        <section class="lg-card lab-table-card" aria-labelledby="lab-table-title">
          <div class="lab-card-head">
            <h2 class="lg-label" id="lab-table-title">Difference from G7</h2>
            <p class="lg-small lg-muted lab-table-hint">Positive: the model needs more elevation, or drifts further right, than G7.</p>
          </div>
          <p class="lg-small lg-muted lab-scroll-hint" id="lab-scroll-hint" hidden>${icon('arrow-right')} Scroll the table sideways to see every column.</p>
          <div class="lg-table-wrap" id="lab-table-wrap">
            <table class="lg-table lab-table">
              <caption class="lg-sr-only">Elevation and drift of each model compared with G7, by range</caption>
              <thead>
                <tr>
                  <th scope="col" rowspan="2" class="lab-th-range">Range ${unit(u.dist)}</th>
                  <th scope="col" rowspan="2" class="lg-num">G7 elevation ${unit(u.angle)}</th>
                  <th scope="colgroup" colspan="2" class="lab-col-group lab-th-group">Elevation − G7 ${unit(u.angle)}</th>
                  <th scope="col" rowspan="2" class="lg-num lab-col-group">MPM drift − G7 ${unit(u.drift)}</th>
                  <th scope="col" rowspan="2" class="lg-num lab-col-group">Time of flight ${unit('s')}</th>
                </tr>
                <tr>
                  <th scope="col" class="lg-num lab-col-group">G1</th>
                  <th scope="col" class="lg-num">MPM</th>
                </tr>
              </thead>
              <tbody id="lab-delta-tbody"></tbody>
            </table>
          </div>
        </section>
      </section>
    `;

    this._bind();
    this._wrapObserver?.disconnect();
    const wrap = this.container.querySelector('#lab-table-wrap');
    if (wrap && typeof ResizeObserver === 'function') {
      this._wrapObserver = new ResizeObserver(() => this._syncScrollHint());
      this._wrapObserver.observe(wrap);
    }
  }

  _bind() {
    this.container.querySelectorAll('input[name="lab-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked || this.mode === radio.value) return;
        this.mode = radio.value;
        const mode = this._mode();
        const u = this._units();
        const title = this.container.querySelector('#lab-chart-title');
        if (title) title.textContent = `${mode.title} (${mode.unit === 'drift' ? u.drift : u.angle})`;
        this.drawChart();
      });
    });
    this.container.querySelectorAll('input[data-series]').forEach((box) => {
      box.addEventListener('change', () => {
        const key = box.dataset.series;
        if (box.checked) this.visible.add(key);
        else if (this.visible.size > 1) this.visible.delete(key);
        else box.checked = true; // keep at least one line
        this._syncToggles();
        this.drawChart();
      });
    });
    this.container.querySelectorAll('[data-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.use;
        const m = MODELS.find((x) => x.id === id);
        if (!m) return;
        toast('Solver model changed', 'ok', `The Solver now uses ${m.name}.`);
        appState.updateSolverConfig({ activeAlgorithm: id }); // re-renders through the subscription
        this.container.querySelector(`#lab-model-${m.key}`)?.closest('.lab-model')?.querySelector('.lab-in-use')?.focus();
      });
    });
  }

  /** The last model left on the chart can't be switched off. */
  _syncToggles() {
    const only = this.visible.size === 1;
    this.container.querySelectorAll('input[data-series]').forEach((box) => {
      const locked = only && this.visible.has(box.dataset.series);
      box.disabled = locked;
      if (locked) box.setAttribute('aria-describedby', 'lab-show-hint');
      else box.removeAttribute('aria-describedby');
    });
  }
}
