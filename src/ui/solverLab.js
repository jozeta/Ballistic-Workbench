/**
 * Ballistic Workbench - Compare models view.
 * Solves the active rifle and atmosphere with each solver model (point mass with G1 or G7 drag,
 * modified point mass), each zeroed on its own, and shows how far they differ:
 *   - a Låda Glass line chart (SVG): elevation difference from G7 (default; the curves would
 *     otherwise lie on top of each other), drift difference from G7, or elevation by model,
 *     with a checkbox per model to hide lines (the chart legend names the lines shown)
 *   - a table of the differences from G7, in the user's units
 *   - "About the models", each with "Use in Solver"
 * Recalculates whenever the rifle, atmosphere, units or solver settings change.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { esc } from '../core/escape.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory, solveZeroAngle } from '../physics/solvers.js';
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
    about: 'G7 point mass plus spin drift, aerodynamic jump from crosswind, and Coriolis. In calm air the elevation matches G7; the difference shows in drift.',
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

/** Formats a signed difference; values that round to zero show as 0.00, never −0.00. */
function signed(v, decimals) {
  const r = Number(v.toFixed(decimals));
  if (!Number.isFinite(r) || r === 0) return (0).toFixed(decimals);
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals)}`;
}

export class SolverLabView {
  constructor(containerElement) {
    this.container = containerElement;
    this.chart = null;
    this.data = null;
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

    this.data = {};
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
      this.data[m.key] = sol.trajectory || [];
    }

    this.drawChart();
    this.renderTable();
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
    for (let i = 0; i < base.length && i < pts.length; i++) {
      const elev = this._angle(pts[i].elevationRad ?? pts[i].elevationMrad / 1000);
      const elevG7 = this._angle(base[i].elevationRad ?? base[i].elevationMrad / 1000);
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
    for (const s of series) for (const p of s.points) span = Math.max(span, Math.abs(p[1]));
    const dec = span < 0.5 ? 2 : span < 10 ? 1 : 0;
    const fmtY = mode.signed ? (v) => `${signed(v, dec)} ${unit}` : (v) => `${(Math.abs(v) < 0.5 * 10 ** -dec ? 0 : v).toFixed(dec)} ${unit}`;
    return {
      label: `${mode.title} (${unit})`,
      series,
      x: { type: 'linear', format: (v) => `${Math.round(v).toLocaleString('en-US')} ${u.dist}` },
      y: { format: fmtY },
    };
  }

  /** One plain sentence on why the lines differ, from the numbers on screen. */
  _explain() {
    const el = this.container.querySelector('#lab-explain');
    const { g7, g1, mpm } = this.data || {};
    if (!el || !g7?.length) return;
    const u = this._units();
    const last = g7.length - 1;
    const ang = (p) => this._angle(p.elevationRad ?? p.elevationMrad / 1000);
    const dist = (p) => Math.round(UnitConverter.fromSI(p.distanceM, u.dist));
    const parts = [];
    const g1Diff = ang(g1[last]) - ang(g7[last]);
    parts.push(Math.abs(g1Diff) < (u.angle === 'MOA' ? 0.35 : 0.1)
      ? `G1 and G7 agree within ${Math.abs(g1Diff).toFixed(2)} ${u.angle} out to ${dist(g7[last])} ${u.dist}: both BCs were measured for this bullet, so they predict nearly the same path.`
      : `G1 needs ${Math.abs(g1Diff).toFixed(2)} ${u.angle} ${g1Diff > 0 ? 'more' : 'less'} than G7 at ${dist(g7[last])} ${u.dist}; for boat-tail bullets G7 is usually closer to reality.`);
    const mid = Math.min(last, Math.round(last / 2));
    const jump = ang(mpm[mid]) - ang(g7[mid]);
    if (Math.abs(jump) >= 0.005) {
      parts.push(`MPM sits a steady ${jump > 0 ? '+' : ''}${jump.toFixed(2)} ${u.angle} from G7: that is aerodynamic jump from the crosswind, an angle set at the muzzle, so it is the same at every distance.`);
    } else {
      parts.push('In calm air MPM needs the same elevation as G7; its difference is drift.');
    }
    const driftCm = (mpm[last].driftM - g7[last].driftM) * 100;
    parts.push(`MPM drifts ${Math.abs(UnitConverter.fromSI(driftCm / 100, u.drift)).toFixed(1)} ${u.drift} ${driftCm >= 0 ? 'right' : 'left'} of G7 at ${dist(g7[last])} ${u.dist} from spin drift and Coriolis.`);
    el.textContent = parts.join(' ');
  }

  drawChart() {
    const host = this.container.querySelector('#lab-chart');
    if (!host || !this.data?.g7?.length || typeof LadaGlass === 'undefined' || !LadaGlass.chart?.line) return;
    const data = this._chartData();
    if (this.chart && this.chart.host === host) {
      this.chart.update(data);
    } else {
      this._destroyChart();
      this.chart = LadaGlass.chart.line(host, data);
      this.chart.host = host;
    }
    this._explain();
  }

  // ---- table ----------------------------------------------------------------------------------

  renderTable() {
    const tbody = this.container.querySelector('#lab-delta-tbody');
    if (!tbody || !this.data?.g7) return;
    const u = this._units();
    const unitM = u.dist === 'yd' ? 0.9144 : 1;
    const { g7, g1, mpm } = this.data;
    const dec = 2;
    const dDec = 1;
    const ang = (p) => this._angle(p.elevationRad ?? p.elevationMrad / 1000);
    const drift = (p) => UnitConverter.fromSI(p.driftM, u.drift);

    let html = '';
    for (let i = 0; i < g7.length; i++) {
      const d = Math.round(g7[i].distanceM / unitM);
      if (d === 0 || d % 100 !== 0) continue;
      const b = g7[i];
      const row = [g1[i], mpm[i]];
      const diffs = row.map((p) => (p ? signed(ang(p) - ang(b), dec) : '–'));
      const big = row[0] && Math.abs(ang(row[0]) - ang(b)) > (u.angle === 'MOA' ? 1.7 : 0.5);
      html += `
        <tr>
          <th scope="row">${d}</th>
          <td class="lg-num">${(Math.abs(ang(b)) < 0.005 ? 0 : ang(b)).toFixed(dec)}</td>
          <td class="lg-num lab-col-group${big ? ' lab-big' : ''}">${diffs[0]}</td>
          <td class="lg-num">${diffs[1]}</td>
          <td class="lg-num lab-col-group">${mpm[i] ? signed(drift(mpm[i]) - drift(b), dDec) : '–'}</td>
          <td class="lg-num lab-col-group">${b.tofS.toFixed(2)}</td>
        </tr>`;
    }
    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers and constants only
    tbody.innerHTML = html;
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
            <p class="lg-muted">${esc(m.about)}</p>
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
            <div class="lab-chart" id="lab-chart"></div>
            <p class="lg-small lg-muted lab-note">Each model is zeroed on its own, so all lines meet at the zero distance. Hover or focus the chart and use the arrow keys to read values.</p>
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
          <div class="lg-table-wrap">
            <table class="lg-table lab-table">
              <caption class="lg-sr-only">Elevation and drift of each model compared with G7, by range</caption>
              <thead>
                <tr>
                  <th scope="col" rowspan="2" class="lab-th-range">Range (${u.dist})</th>
                  <th scope="col" rowspan="2" class="lg-num">G7 elevation (${u.angle})</th>
                  <th scope="colgroup" colspan="2" class="lab-col-group lab-th-group">Elevation − G7 (${u.angle})</th>
                  <th scope="col" rowspan="2" class="lg-num lab-col-group">MPM drift − G7 (${u.drift})</th>
                  <th scope="col" rowspan="2" class="lg-num lab-col-group">Time of flight (s)</th>
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
