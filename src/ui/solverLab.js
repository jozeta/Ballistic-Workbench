/**
 * Ballistic Workbench - Compare models view.
 * Solves the active rifle and atmosphere with each solver model (point mass with G1 or G7 drag,
 * modified point mass, 4DOF), each zeroed on its own, and shows how far they differ:
 *   - a chart: "Difference from G7" (default; the curves would otherwise lie on top of each other)
 *     or "Elevation by model", with a toggle per model (the toggles are the legend)
 *   - a table of the differences from G7, in the user's units
 *   - "About the models", each with "Use in Solver"
 * Recalculates whenever the rifle, atmosphere, units or solver settings change.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { esc } from '../core/escape.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory, solveZeroAngle } from '../physics/solvers.js';
import { getPalette } from '../canvas/palette.js';
import { icon } from './icons.js';
import { toast } from './notify.js';

const MODELS = [
  {
    id: 'G7', key: 'g7', label: 'G7', name: 'Point mass, G7 drag', color: 'accent', dash: [],
    about: 'Reference drag shape for modern boat-tail bullets; usually the better fit for long-range match bullets.',
  },
  {
    id: 'G1', key: 'g1', label: 'G1', name: 'Point mass, G1 drag', color: 'warn', dash: [8, 5],
    about: 'Reference drag shape for flat-base bullets. With boat-tail match bullets it drifts from reality, mostly past ~600 m and through transonic.',
  },
  {
    id: 'MPM', key: 'mpm', label: 'MPM', name: 'Modified point mass', color: 'ok', dash: [2, 4],
    about: 'Adds spin drift, aerodynamic jump from crosswind, and Coriolis.',
  },
  {
    id: '4DOF', key: 'dof4', label: '4DOF', name: 'Four degrees of freedom', color: 'accent2', dash: [12, 4, 2, 4],
    about: 'Modified point mass plus an estimate of how the bullet\'s spin slows down over the flight.',
  },
];
const ABBR = {
  MPM: '<abbr title="Modified point mass">MPM</abbr>',
  '4DOF': '<abbr title="Four degrees of freedom">4DOF</abbr>',
};
// Chart modes: what is plotted for each model
const MODES = [
  { id: 'diff', button: 'Elevation difference', title: 'Elevation difference from G7', field: 'diff', unit: 'angle', axis: 'Difference from G7' },
  { id: 'drift', button: 'Drift difference', title: 'Drift difference from G7', field: 'dDrift', unit: 'drift', axis: 'Drift difference from G7' },
  { id: 'elev', button: 'Elevation', title: 'Elevation by model', field: 'elev', unit: 'angle', axis: 'Elevation' },
];
const SVG_DASH = { g7: '', g1: '8 5', mpm: '2 4', dof4: '12 4 2 4' };

/** Formats a signed difference; values that round to zero show as 0.00, never −0.00. */
function signed(v, decimals) {
  const r = Number(v.toFixed(decimals));
  if (!Number.isFinite(r) || r === 0) return (0).toFixed(decimals);
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals)}`;
}

export class SolverLabView {
  constructor(containerElement) {
    this.container = containerElement;
    this.canvas = null;
    this.ctx = null;
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
    const base = this.data.g7;
    const pts = this.data[key] || [];
    const out = [];
    for (let i = 0; i < base.length && i < pts.length; i++) {
      const elev = this._angle(pts[i].elevationRad ?? pts[i].elevationMrad / 1000);
      const elevG7 = this._angle(base[i].elevationRad ?? base[i].elevationMrad / 1000);
      const dDrift = UnitConverter.fromSI(pts[i].driftM - base[i].driftM, u.drift);
      out.push({ d: pts[i].distanceM / unitM, elev, diff: elev - elevG7, dDrift });
    }
    return out;
  }

  // ---- chart ----------------------------------------------------------------------------------

  _initCanvas() {
    this.canvas = this.container.querySelector('#solver-lab-canvas');
    this.ctx = this.canvas?.getContext('2d') || null;
    this.resizeObserver?.disconnect();
    if (this.canvas && window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.drawChart());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  drawChart() {
    if (!this.ctx || !this.data?.g7?.length) return;
    const canvas = this.canvas;
    const w = Math.max(240, Math.floor(canvas.clientWidth));
    const h = Math.max(220, Math.floor(canvas.clientHeight));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pal = getPalette();
    const u = this._units();
    const narrow = w < 480;
    const pad = { top: 14, right: narrow ? 10 : 18, bottom: 40, left: narrow ? 48 : 62 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const mode = this._mode();
    const field = mode.field;
    const isDiff = mode.id !== 'elev';
    const axisUnit = mode.unit === 'drift' ? u.drift : u.angle;

    const shown = MODELS.filter((m) => this.visible.has(m.key));
    const series = shown.map((m) => ({ m, pts: this._series(m.key) }));
    let lo = 0;
    let hi = 0;
    for (const s of series) for (const p of s.pts) {
      lo = Math.min(lo, p[field]);
      hi = Math.max(hi, p[field]);
    }
    if (hi - lo < 0.2) {
      hi += 0.1;
      lo -= isDiff ? 0.1 : 0;
    }
    // Nice tick step
    const raw = (hi - lo) / (narrow ? 4 : 6);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || 10 * mag;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;

    const maxD = this.maxDisp;
    const x = (d) => pad.left + (d / maxD) * plotW;
    const y = (v) => pad.top + plotH - ((v - lo) / (hi - lo)) * plotH;

    ctx.font = `12px ${pal.font}`;
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal.line;
    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, yy);
      ctx.lineTo(pad.left + plotW, yy);
      ctx.stroke();
      const t = Math.abs(v) < step / 1000 ? (0).toFixed(decimals) : v.toFixed(decimals);
      ctx.fillText(t, pad.left - 6, yy);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xStep = narrow ? 400 : 200;
    for (let d = 0; d <= maxD; d += xStep) {
      const xx = Math.round(x(d)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xx, pad.top);
      ctx.lineTo(xx, pad.top + plotH);
      ctx.stroke();
      ctx.fillText(String(d), xx, pad.top + plotH + 6);
    }
    ctx.fillText(`Distance (${u.dist})`, pad.left + plotW / 2, pad.top + plotH + 22);

    // Zero line in difference mode
    if (isDiff && lo < 0 && hi > 0) {
      ctx.strokeStyle = pal.line2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad.left, y(0));
      ctx.lineTo(pad.left + plotW, y(0));
      ctx.stroke();
    }

    // Y-axis title
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pal.muted;
    ctx.fillText(`${mode.axis} (${axisUnit})`, 0, 0);
    ctx.restore();

    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (const s of series) {
      ctx.strokeStyle = pal[s.m.color] || pal.accent;
      ctx.setLineDash(s.m.dash);
      ctx.beginPath();
      s.pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(x(p.d), y(p[field]));
        else ctx.lineTo(x(p.d), y(p[field]));
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Text equivalent for screen readers
    const last = Object.fromEntries(MODELS.map((m) => [m.key, this._series(m.key).at(-1)]));
    const end = last.g7 ? Math.round(last.g7.d) : maxD;
    const sumField = mode.id === 'drift' ? 'dDrift' : 'diff';
    const parts = MODELS.filter((m) => m.key !== 'g7').map((m) => `${m.label} ${signed(last[m.key]?.[sumField] ?? 0, mode.id === 'drift' ? 1 : 2)}`);
    canvas.setAttribute('aria-label', `Chart: ${mode.title}. At ${end} ${u.dist}, ${mode.id === 'drift' ? 'drift' : 'elevation'} compared with G7: ${parts.join(', ')} ${axisUnit}. The table below has every value.`);
  }

  // ---- table ----------------------------------------------------------------------------------

  renderTable() {
    const tbody = this.container.querySelector('#lab-delta-tbody');
    if (!tbody || !this.data?.g7) return;
    const u = this._units();
    const unitM = u.dist === 'yd' ? 0.9144 : 1;
    const { g7, g1, mpm, dof4 } = this.data;
    const dec = 2;
    const dDec = 1;
    const ang = (p) => this._angle(p.elevationRad ?? p.elevationMrad / 1000);
    const drift = (p) => UnitConverter.fromSI(p.driftM, u.drift);

    let html = '';
    for (let i = 0; i < g7.length; i++) {
      const d = Math.round(g7[i].distanceM / unitM);
      if (d === 0 || d % 100 !== 0) continue;
      const b = g7[i];
      const row = [g1[i], mpm[i], dof4[i]];
      const diffs = row.map((p) => (p ? signed(ang(p) - ang(b), dec) : '–'));
      const big = row[0] && Math.abs(ang(row[0]) - ang(b)) > (u.angle === 'MOA' ? 1.7 : 0.5);
      html += `
        <tr>
          <th scope="row">${d}</th>
          <td>${(Math.abs(ang(b)) < 0.005 ? 0 : ang(b)).toFixed(dec)}</td>
          <td class="${big ? 'lab-big' : ''}">${diffs[0]}</td>
          <td>${diffs[1]}</td>
          <td>${diffs[2]}</td>
          <td>${mpm[i] ? signed(drift(mpm[i]) - drift(b), dDec) : '–'}</td>
          <td>${dof4[i] ? signed(drift(dof4[i]) - drift(b), dDec) : '–'}</td>
          <td>${b.tofS.toFixed(2)}</td>
        </tr>`;
    }
    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    tbody.innerHTML = html;
  }

  // ---- render ---------------------------------------------------------------------------------

  render() {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const active = appState.state.solverConfig?.activeAlgorithm || 'G7';
    const u = this._units();

    const toggles = MODELS.map((m) => `
      <button type="button" class="tab-btn lab-series lab-series-${m.key}" data-series="${m.key}" aria-pressed="${this.visible.has(m.key)}">
        <svg class="lab-swatch" viewBox="0 0 28 8" aria-hidden="true" focusable="false"><line x1="1" y1="4" x2="27" y2="4" stroke="currentColor" stroke-width="2.5" stroke-linecap="butt" ${SVG_DASH[m.key] ? `stroke-dasharray="${SVG_DASH[m.key]}"` : ''} /></svg>
        ${ABBR[m.id] || m.label}
      </button>`).join('');

    const cards = MODELS.map((m) => {
      const inUse = m.id === active;
      return `
        <article class="lab-model lab-model-${m.key}" aria-labelledby="lab-model-${m.key}">
          <div class="lab-model-head">
            <svg class="lab-swatch" viewBox="0 0 28 8" aria-hidden="true" focusable="false"><line x1="1" y1="4" x2="27" y2="4" stroke="currentColor" stroke-width="2.5" ${SVG_DASH[m.key] ? `stroke-dasharray="${SVG_DASH[m.key]}"` : ''} /></svg>
            <h3 id="lab-model-${m.key}">${esc(m.name)}${m.id === 'MPM' || m.id === '4DOF' ? ` (${ABBR[m.id]})` : ''}</h3>
          </div>
          <p>${esc(m.about)}</p>
          ${inUse
            ? `<span class="badge badge-ok">${icon('check')} Used in Solver</span>`
            : `<button type="button" class="btn-secondary-sm" data-use="${m.id}">Use in Solver</button>`}
        </article>`;
    }).join('');

    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    this.container.innerHTML = `
      <section class="lab-view" aria-labelledby="lab-title">
        <header class="view-header">
          <div>
            <h1 id="lab-title">Compare models</h1>
            <p>How G1, G7, modified point mass and 4DOF differ for your rifle and conditions.</p>
          </div>
          <p class="lab-context">${icon('rifle')} ${esc(profile.name)} <span class="lg-muted">·</span> ${icon('thermometer')} ${esc(env.name)}</p>
        </header>

        <div class="lab-grid">
          <section class="panel lab-chart-panel" aria-labelledby="lab-chart-title">
            <div class="panel-header">
              <h2 id="lab-chart-title">${this._mode().title}</h2>
              <div class="lg-tabs lab-mode" role="group" aria-label="What the chart shows">
                ${MODES.map((m) => `<button type="button" class="lg-tab" data-mode="${m.id}" aria-pressed="${this.mode === m.id}">${m.button}</button>`).join('')}
              </div>
            </div>
            <div class="lab-series-bar" role="group" aria-label="Show models">${toggles}</div>
            <div class="lab-chart-container">
              <canvas id="solver-lab-canvas" role="img" aria-label="Chart comparing the models"></canvas>
            </div>
            <p class="field-hint lab-chart-hint">Each model is zeroed on its own, so all lines meet at the zero distance. In the drift difference, G1 differs because wind acts on its different drag; MPM and 4DOF add spin drift, jump and Coriolis. Select a model above to hide or show its line.</p>
          </section>

          <section class="panel lab-about-panel" aria-labelledby="lab-about-title">
            <div class="panel-header"><h2 id="lab-about-title">About the models</h2></div>
            <div class="lab-about-body">${cards}</div>
          </section>
        </div>

        <section class="panel lab-table-panel" aria-labelledby="lab-table-title">
          <div class="panel-header">
            <h2 id="lab-table-title">Difference from G7</h2>
            <p class="field-hint">Positive means the model needs more elevation (or drifts further right) than G7.</p>
          </div>
          <div class="table-scrollable">
            <table class="dope-table lab-table">
              <caption class="lg-sr-only">Elevation and drift of each model compared with G7, by range</caption>
              <thead>
                <tr>
                  <th scope="col">Range (${u.dist})</th>
                  <th scope="col">G7 elevation (${u.angle})</th>
                  <th scope="col">G1 − G7 (${u.angle})</th>
                  <th scope="col">MPM − G7 (${u.angle})</th>
                  <th scope="col">4DOF − G7 (${u.angle})</th>
                  <th scope="col">MPM − G7 drift (${u.drift})</th>
                  <th scope="col">4DOF − G7 drift (${u.drift})</th>
                  <th scope="col">G7 time of flight (s)</th>
                </tr>
              </thead>
              <tbody id="lab-delta-tbody" aria-live="polite"></tbody>
            </table>
          </div>
        </section>
      </section>
    `;

    this._initCanvas();
    this._bind();
  }

  _bind() {
    this.container.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.mode === btn.dataset.mode) return;
        this.mode = btn.dataset.mode;
        this.container.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)));
        const title = this.container.querySelector('#lab-chart-title');
        if (title) title.textContent = this._mode().title;
        this.drawChart();
      });
    });
    this.container.querySelectorAll('[data-series]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.series;
        if (this.visible.has(key)) {
          if (this.visible.size === 1) return; // keep at least one line
          this.visible.delete(key);
        } else {
          this.visible.add(key);
        }
        btn.setAttribute('aria-pressed', String(this.visible.has(key)));
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
        this.container.querySelector(`.lab-model-${m.key} .badge`)?.setAttribute('tabindex', '-1');
        this.container.querySelector(`.lab-model-${m.key} .badge`)?.focus();
      });
    });
  }
}
