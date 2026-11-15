/**
 * Ballistic Workbench - Algorithm Comparison Lab
 * Side-by-side solver divergence analysis:
 * - G1 Point-Mass vs G7 Point-Mass vs Modified PM vs 4DOF
 * - Multi-curve high-DPI canvas graph
 * - Delta difference tables (Elevation delta, Spin drift, ToF delta)
 */

import { appState } from '../core/state.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory, solveZeroAngle } from '../physics/solvers.js';

export class SolverLabView {
  constructor(containerElement) {
    this.container = containerElement;
    this.canvas = null;
    this.ctx = null;
    this.comparisonData = null;

    this.render();
    this.initCanvas();
    this.runComparison();
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  initCanvas() {
    this.canvas = this.container.querySelector('#solver-lab-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resizeCanvas();

    if (!this._hasWindowResize) {
      window.addEventListener('resize', () => this.resizeCanvas());
      this._hasWindowResize = true;
    }

    if (window.ResizeObserver && this.canvas.parentElement) {
      if (this.resizeObserver) this.resizeObserver.disconnect();
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(400, Math.floor(rect.width || 600));
    const h = Math.max(500, Math.floor(rect.height || 530));

    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.w = w;
    this.h = h;

    this.drawDivergenceChart();
  }

  runComparison() {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();

    const atmos = getAtmosphericConditions({
      pressurePa: env.pressureHpa * 100,
      tempK: env.temperatureC + 273.15,
      relativeHumidity: env.humidityPercent / 100,
      altitudeM: env.altitudeM,
    });

    const zeroG7 = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs, 'G7');
    const zeroG1 = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs, 'G1');
    const zeroMpm = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs, 'MPM');
    const zero4dof = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs, '4DOF');

    const maxR = 1200;
    const step = 50;

    const solG7 = solveTrajectory({ profile: { ...profile, zeroAngleRad: zeroG7 }, environment: env, airDensity: atmos.densityKgM3, speedOfSound: atmos.speedOfSoundMs, algorithm: 'G7', stepM: step, maxRangeM: maxR });
    const solG1 = solveTrajectory({ profile: { ...profile, zeroAngleRad: zeroG1 }, environment: env, airDensity: atmos.densityKgM3, speedOfSound: atmos.speedOfSoundMs, algorithm: 'G1', stepM: step, maxRangeM: maxR });
    const solMpm = solveTrajectory({ profile: { ...profile, zeroAngleRad: zeroMpm }, environment: env, airDensity: atmos.densityKgM3, speedOfSound: atmos.speedOfSoundMs, algorithm: 'MPM', stepM: step, maxRangeM: maxR });
    const sol4dof = solveTrajectory({ profile: { ...profile, zeroAngleRad: zero4dof }, environment: env, airDensity: atmos.densityKgM3, speedOfSound: atmos.speedOfSoundMs, algorithm: '4DOF', stepM: step, maxRangeM: maxR });

    this.comparisonData = {
      g7: solG7.trajectory,
      g1: solG1.trajectory,
      mpm: solMpm.trajectory,
      dof4: sol4dof.trajectory,
    };

    this.drawDivergenceChart();
    this.renderDeltaTable();
  }

  drawDivergenceChart() {
    if (!this.ctx || !this.comparisonData || !this.w || !this.h) return;
    const ctx = this.ctx;
    const { w, h } = this;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    const padding = { top: 45, right: 35, bottom: 60, left: 100 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    ctx.fillStyle = isLight ? '#ffffff' : '#0b0f17';
    ctx.fillRect(0, 0, w, h);

    const data = this.comparisonData;
    const maxDist = 1200;
    // Find maximum elevation dial across all series
    const allElevs = [
      ...data.g7.map((p) => p.elevationMrad),
      ...data.g1.map((p) => p.elevationMrad),
      ...data.mpm.map((p) => p.elevationMrad),
      ...data.dof4.map((p) => p.elevationMrad),
    ];
    const maxElev = Math.max(12, Math.ceil(Math.max(...allElevs) * 1.15));

    const getX = (dist) => padding.left + (dist / maxDist) * plotW;
    const getY = (val) => padding.top + plotH - (val / maxElev) * plotH;

    // Grid lines & Axis Labels
    ctx.strokeStyle = isLight ? '#e2e8f0' : '#1e293b';
    ctx.lineWidth = 1;
    ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
    ctx.font = 'bold 12px monospace';

    const elStep = maxElev > 20 ? 4 : maxElev > 12 ? 3 : 2;
    for (let el = 0; el <= maxElev; el += elStep) {
      const y = getY(el);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillText(`${el.toFixed(1)} MIL`, padding.left - 12, y + 4);
    }

    for (let d = 0; d <= maxDist; d += 200) {
      const x = getX(d);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillText(`${d}m`, x, padding.top + plotH + 22);
    }

    // Prominent Axis Titles with zero-collision positioning
    ctx.save();
    ctx.fillStyle = isLight ? '#0f172a' : '#cbd5e1';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.translate(22, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ELEVATION HOLD (MRAD)', 0, 0);
    ctx.restore();

    ctx.fillStyle = isLight ? '#0f172a' : '#cbd5e1';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DOWNRANGE DISTANCE (METERS)', padding.left + plotW / 2, padding.top + plotH + 45);

    // Draw Algorithms (Bold Multi-Solver Curves)
    const seriesConfig = [
      { name: 'G1 Gavre Standard', pts: data.g1, color: '#f59e0b', dash: [6, 4] },
      { name: 'G7 Standard (Baseline)', pts: data.g7, color: '#38bdf8', dash: [] },
      { name: 'Modified Point-Mass (MPM)', pts: data.mpm, color: '#10b981', dash: [4, 3] },
      { name: '4DOF (Spin + Dynamic Lift)', pts: data.dof4, color: '#a855f7', dash: [] },
    ];

    seriesConfig.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3.5;
      ctx.setLineDash(s.dash);
      ctx.beginPath();

      s.pts.forEach((pt, idx) => {
        const px = getX(pt.distanceM);
        const py = getY(pt.elevationMrad);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Chart Legend with responsive wrap
    let legX = padding.left + 10;
    let legY = padding.top + 16;
    ctx.font = 'bold 12px monospace';

    seriesConfig.forEach((s) => {
      const itemW = ctx.measureText(s.name).width + 36;
      if (legX + itemW > w - padding.right && legX > padding.left + 20) {
        legX = padding.left + 10;
        legY += 20;
      }
      ctx.fillStyle = s.color;
      ctx.fillRect(legX, legY - 3, 16, 4);
      ctx.fillStyle = isLight ? '#1e293b' : '#cbd5e1';
      ctx.textAlign = 'left';
      ctx.fillText(s.name, legX + 22, legY + 2);
      legX += itemW;
    });
  }

  renderDeltaTable() {
    const tbody = this.container.querySelector('#lab-delta-tbody');
    if (!tbody || !this.comparisonData) return;

    const { g7, g1, mpm, dof4 } = this.comparisonData;
    let html = '';

    for (let i = 0; i < g7.length; i++) {
      const pG7 = g7[i];
      const pG1 = g1[i] || pG7;
      const pMpm = mpm[i] || pG7;
      const p4d = dof4[i] || pG7;

      const deltaG1Elev = (pG1.elevationMrad - pG7.elevationMrad).toFixed(2);
      const deltaMpmElev = (pMpm.elevationMrad - pG7.elevationMrad).toFixed(2);
      const delta4dElev = (p4d.elevationMrad - pG7.elevationMrad).toFixed(2);

      const deltaMpmDrift = ((pMpm.driftM - pG7.driftM) * 100).toFixed(1); // cm
      const delta4dDrift = ((p4d.driftM - pG7.driftM) * 100).toFixed(1); // cm

      const g1Class = Math.abs(parseFloat(deltaG1Elev)) > 0.5 ? 'text-amber' : '';

      html += `
        <tr>
          <td class="font-bold">${pG7.distanceM}m</td>
          <td class="text-cyan font-semibold">${pG7.elevationMrad.toFixed(2)} MRAD</td>
          <td class="${g1Class}">${deltaG1Elev > 0 ? '+' : ''}${deltaG1Elev}</td>
          <td>${deltaMpmElev > 0 ? '+' : ''}${deltaMpmElev}</td>
          <td class="text-emerald">${delta4dElev > 0 ? '+' : ''}${delta4dElev}</td>
          <td>${pG7.driftM.toFixed(2)}m</td>
          <td>${deltaMpmDrift > 0 ? '+' : ''}${deltaMpmDrift} cm</td>
          <td class="text-purple">${delta4dDrift > 0 ? '+' : ''}${delta4dDrift} cm</td>
          <td>${pG7.tofS.toFixed(3)}s</td>
          <td>${(p4d.tofS - pG7.tofS).toFixed(4)}s</td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
  }

  render() {
    this.container.innerHTML = `
      <div class="solver-lab-header">
        <div>
          <h2>Ballistic Algorithm Comparison Lab</h2>
          <p class="subtitle">Benchmarking G1 Standard vs G7 Boat-tail vs Modified Point-Mass vs 4DOF Dynamics</p>
        </div>
        <button id="rerun-lab-btn" class="btn-primary-sm">🔄 Recalculate Solvers</button>
      </div>

      <div class="lab-grid">
        <div class="panel lab-chart-panel">
          <div class="panel-header">
            <h3>Trajectory Divergence Curve (Elevation MRAD vs Range)</h3>
          </div>
          <div class="chart-canvas-container lab-chart-container">
            <canvas id="solver-lab-canvas"></canvas>
          </div>
        </div>

        <div class="panel lab-analysis-panel">
          <div class="panel-header">
            <h3>Physics Model Analysis & Guidance</h3>
          </div>
          <div class="analysis-body">
            <div class="analysis-card">
              <h4 class="text-cyan">G7 Boat-tail Standard</h4>
              <p>The standard benchmark for modern long-range tangent/secant ogive bullets with boat-tails. Drag coefficient tracks boat-tail wave drag accurately across supersonic flight.</p>
            </div>
            <div class="analysis-card">
              <h4 class="text-amber">G1 Gavre Standard</h4>
              <p>Developed in 1881 for blunt flat-base artillery shells with a 2-caliber ogive. Under-predicts drag in the transonic regime (Mach 0.9 - 1.2), leading to drastic elevation errors beyond 600m when used for match bullets.</p>
            </div>
            <div class="analysis-card">
              <h4 class="text-emerald">Modified Point-Mass (MPM)</h4>
              <p>Adds Aerodynamic Jump (crosswind induced vertical deflection), Gyroscopic Spin Drift (rightward yaw of repose deflection), and full Earth Coriolis acceleration vectors.</p>
            </div>
            <div class="analysis-card">
              <h4 class="text-purple">4DOF Dynamic Model</h4>
              <p>Integrates 3 translational degrees + axial bullet spin decay. Spin drift is generated directly from physical lift force produced by the yaw of repose rather than empirical tables.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="panel mt-4">
        <div class="panel-header">
          <h3>Algorithm Delta Comparison Table (Relative to G7 Baseline)</h3>
        </div>
        <div class="table-scrollable">
          <table class="dope-table">
            <thead>
              <tr>
                <th>Range</th>
                <th>G7 Elev (Base)</th>
                <th>Δ G1 Elev</th>
                <th>Δ MPM Elev</th>
                <th>Δ 4DOF Elev</th>
                <th>G7 Drift</th>
                <th>Δ MPM Drift</th>
                <th>Δ 4DOF Drift</th>
                <th>G7 ToF</th>
                <th>Δ 4DOF ToF</th>
              </tr>
            </thead>
            <tbody id="lab-delta-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const rerunBtn = this.container.querySelector('#rerun-lab-btn');
    rerunBtn?.addEventListener('click', () => this.runComparison());
  }
}
