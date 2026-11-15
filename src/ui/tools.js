/**
 * Ballistic Workbench - Ballistic Utilities & Tools Suite
 * Implements:
 * 1. Truing Wizard (Newton-Raphson Supersonic MV & Transonic DSF calibration)
 * 2. Target Group Grid Analyzer (ES, Mean Radius, POI Offset, Dispersion Ellipse)
 * 3. Chronograph SD/ES Statistical Engine
 * 4. Tactical Milling & Optical Range Estimation
 * 5. Free Recoil Energy & Impulse Dynamics Calculator
 */

import { appState } from '../core/state.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { trueMuzzleVelocity, trueDropScaleFactor } from '../physics/truing.js';
import { runWezSimulation } from '../physics/wez.js';

export class ToolsView {
  constructor(containerElement) {
    this.container = containerElement;
    this.activeTool = 'truing'; // 'truing' | 'wez' | 'group' | 'chrono' | 'milling' | 'recoil'
    this.wezData = null;

    // Target Group Analyzer State
    this.groupShots = [
      { x: 0, y: 0 },
      { x: 8, y: -6 },
      { x: -5, y: 10 },
      { x: -12, y: -4 },
      { x: 6, y: 12 },
    ]; // Coordinates in mm from aim point
    this.targetGridScale = 2.0; // pixels per mm
    this.aimPointMm = { x: 0, y: 0 };
    this.selectedCaliberMm = 6.7; // default 6.5mm / .264
    this.cvSensitivity = 55; // default 55%
    this.targetImage = null; // Image or Canvas
    this.isCalibratingScale = false;
    this.scaleCalibPoints = [];
    this.scaleRefLengthMm = 25.4; // 1 inch
    this.draggedShotIdx = -1;
    this.isDraggingAimPoint = false;

    this.render();
  }

  destroy() {
    // cleanup
  }

  setTool(toolId) {
    this.activeTool = toolId;
    this.render();
    if (toolId === 'group') {
      this.initGroupCanvas();
    } else if (toolId === 'wez') {
      this.initWez();
    }
  }

  // --- 1. TRUING WIZARD ---
  renderTruingWizard() {
    const profile = appState.getActiveProfile();

    return `
      <div class="tool-card">
        <h3>Ballistic Truing Wizard</h3>
        <p class="tool-desc">Calibrate modeled muzzle velocity and transonic drag scale factor using recorded target impacts.</p>

        <div class="field-grid-2">
          <!-- Step 1: Supersonic MV Truing -->
          <div class="truing-step-box">
            <h4 class="text-cyan">Step 1: Supersonic MV Truing (500m - 800m)</h4>
            <p class="text-muted text-sm">Fire at a known supersonic distance and record the exact elevation dial needed to hit center.</p>

            <div class="field-row mt-2">
              <label>Target Distance (m)</label>
              <input type="number" id="true-mv-dist" class="form-input" min="300" max="900" step="50" value="600" />
            </div>
            <div class="field-row">
              <label>Actual Observed Dial (MRAD)</label>
              <input type="number" id="true-mv-dial" class="form-input" min="0.5" max="15.0" step="0.1" value="3.6" />
            </div>
            <button id="btn-calc-trued-mv" class="btn-primary mt-3">Calculate Trued MV</button>

            <div id="trued-mv-result" class="truing-output mt-3"></div>
          </div>

          <!-- Step 2: Transonic DSF Truing -->
          <div class="truing-step-box">
            <h4 class="text-amber">Step 2: Transonic Drop Scale Factor (1000m+)</h4>
            <p class="text-muted text-sm">After MV is trued, test at transonic distance to scale drag coefficient for boundary layer effects.</p>

            <div class="field-row mt-2">
              <label>Transonic Distance (m)</label>
              <input type="number" id="true-dsf-dist" class="form-input" min="800" max="1500" step="50" value="1050" />
            </div>
            <div class="field-row">
              <label>Actual Observed Dial (MRAD)</label>
              <input type="number" id="true-dsf-dial" class="form-input" min="5.0" max="30.0" step="0.1" value="11.2" />
            </div>
            <button id="btn-calc-trued-dsf" class="btn-primary mt-3">Calculate Trued DSF</button>

            <div id="trued-dsf-result" class="truing-output mt-3"></div>
          </div>
        </div>
      </div>
    `;
  }

  // --- 2. WEZ MONTE CARLO HIT PROBABILITY & DISPERSION ENGINE ---
  renderWez() {
    const target = appState.state.target;
    return `
      <div class="tool-card">
        <h3>Weapon Employment Zone (WEZ) & Monte Carlo Simulation</h3>
        <p class="tool-desc">1,000-shot stochastic simulation evaluating Hit Probability, Circular Error Probable (CEP), R95, and 4-factor sensitivity breakdown.</p>

        <div class="wez-layout">
          <!-- Simulation Parameters -->
          <div class="wez-form-column">
            <h4 class="text-cyan mb-2">Target & Simulation Setup</h4>
            <div class="field-row">
              <label>Target Distance (m)</label>
              <input type="number" id="wez-dist" class="form-input" min="100" max="1500" step="50" value="${target.distanceM}" />
            </div>
            <div class="field-grid-2">
              <div>
                <label>Target Shape</label>
                <select id="wez-shape" class="form-select">
                  <option value="ipsc" ${target.targetShape === 'ipsc' ? 'selected' : ''}>IPSC Torso (45x75 cm)</option>
                  <option value="circle" ${target.targetShape === 'circle' ? 'selected' : ''}>Round Gong (30 cm)</option>
                  <option value="square" ${target.targetShape === 'square' ? 'selected' : ''}>Square Plate (30x30 cm)</option>
                  <option value="nato-e" ${target.targetShape === 'nato-e' ? 'selected' : ''}>NATO E-Type (50x100 cm)</option>
                </select>
              </div>
              <div>
                <label>Number of Shots</label>
                <select id="wez-shots" class="form-select">
                  <option value="1000" selected>1,000 Shots (High Precision)</option>
                  <option value="500">500 Shots</option>
                  <option value="2000">2,000 Shots</option>
                </select>
              </div>
            </div>

            <h4 class="text-amber mt-3 mb-2">Uncertainty Budget (Standard Deviations)</h4>
            <div class="field-grid-2">
              <div>
                <label>Muzzle Velocity SD (m/s)</label>
                <input type="number" id="wez-mv-sd" class="form-input" min="0.5" max="15" step="0.5" value="3.0" />
              </div>
              <div>
                <label>Rangefinder Error SD (m)</label>
                <input type="number" id="wez-range-sd" class="form-input" min="0" max="25" step="1" value="5.0" />
              </div>
            </div>
            <div class="field-grid-2">
              <div>
                <label>Wind Speed SD (m/s)</label>
                <input type="number" id="wez-wind-sd" class="form-input" min="0" max="10" step="0.5" value="1.0" />
              </div>
              <div>
                <label>Wind Direction SD (°)</label>
                <input type="number" id="wez-dir-sd" class="form-input" min="0" max="45" step="1" value="12.0" />
              </div>
            </div>
            <div class="field-row">
              <label>Rifle + Shooter Dispersion (MOA)</label>
              <input type="number" id="wez-shooter-moa" class="form-input" min="0.1" max="3.0" step="0.1" value="0.5" />
            </div>

            <button id="btn-run-wez" class="btn-primary mt-3">⚡ Run 1,000-Shot Monte Carlo WEZ</button>
          </div>

          <!-- High-DPI Dispersion Plot Canvas & Results -->
          <div class="wez-results-column">
            <div class="wez-canvas-wrapper">
              <canvas id="wez-canvas" width="460" height="460"></canvas>
              <div class="wez-canvas-legend">
                <span class="legend-item"><span class="legend-dot dot-hit"></span> Hit</span>
                <span class="legend-item"><span class="legend-dot dot-miss"></span> Miss</span>
                <span class="legend-item"><span class="legend-ring ring-cep"></span> CEP 50%</span>
                <span class="legend-item"><span class="legend-ring ring-r95"></span> R95 95%</span>
              </div>
            </div>

            <div id="wez-metrics-container" class="metrics-summary-grid mt-3"></div>

            <div id="wez-sensitivity-container" class="wez-sensitivity-box mt-3"></div>
          </div>
        </div>
      </div>
    `;
  }

  initWez() {
    const canvas = this.container.querySelector('#wez-canvas');
    if (!canvas) return;
    const btn = this.container.querySelector('#btn-run-wez');
    btn?.addEventListener('click', () => this.runWez());
    this.runWez();
  }

  runWez() {
    const canvas = this.container.querySelector('#wez-canvas');
    if (!canvas) return;

    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const atmos = getAtmosphericConditions({
      pressurePa: env.pressureHpa * 100,
      tempK: env.temperatureC + 273.15,
      relativeHumidity: env.humidityPercent / 100,
      altitudeM: env.altitudeM,
    });

    const distM = parseFloat(this.container.querySelector('#wez-dist')?.value || 600);
    const shape = this.container.querySelector('#wez-shape')?.value || 'ipsc';
    const numShots = parseInt(this.container.querySelector('#wez-shots')?.value || 1000, 10);
    const mvSdMs = parseFloat(this.container.querySelector('#wez-mv-sd')?.value || 3.0);
    const rangeSdM = parseFloat(this.container.querySelector('#wez-range-sd')?.value || 5.0);
    const windSpeedSdMs = parseFloat(this.container.querySelector('#wez-wind-sd')?.value || 1.0);
    const windDirSdDeg = parseFloat(this.container.querySelector('#wez-dir-sd')?.value || 12.0);
    const shooterMoa = parseFloat(this.container.querySelector('#wez-shooter-moa')?.value || 0.5);
    const shooterPrecisionRad = shooterMoa * ((Math.PI / 180.0) / 60.0);

    let targetW = 45;
    let targetH = 75;
    if (shape === 'circle' || shape === 'square') {
      targetW = 30;
      targetH = 30;
    } else if (shape === 'nato-e') {
      targetW = 50;
      targetH = 100;
    }

    const target = {
      distanceM: distM,
      targetShape: shape,
      targetSizeWidthCm: targetW,
      targetSizeHeightCm: targetH,
    };

    const result = runWezSimulation({
      profile,
      environment: env,
      airDensity: atmos.densityKgM3,
      speedOfSound: atmos.speedOfSoundMs,
      target,
      numShots,
      uncertainties: {
        mvSdMs,
        rangeSdM,
        windSpeedSdMs,
        windDirSdDeg,
        shooterPrecisionRad,
      },
    });

    this.wezData = result;
    this.drawWezDispersion(result, target);
    this.renderWezMetrics(result);
  }

  drawWezDispersion(res, target) {
    const canvas = this.container.querySelector('#wez-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width || 460));
    const h = w;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const cx = w / 2;
    const cy = h / 2;

    // Dark background
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, w, h);

    // Compute plot scale (pixels per cm)
    const maxExtentCm = Math.max(50, res.r95Cm * 1.3, (target.targetSizeHeightCm || 75) * 0.7);
    const scale = (w * 0.42) / maxExtentCm;

    // 1. Draw Distance Rings & Grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let ringCm = 10; ringCm <= maxExtentCm; ringCm += 10) {
      ctx.beginPath();
      ctx.arc(cx, cy, ringCm * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Grid crosshairs
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // 2. Draw Target Silhouette
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;

    const halfW = (target.targetSizeWidthCm / 2) * scale;
    const halfH = (target.targetSizeHeightCm / 2) * scale;

    if (target.targetShape === 'circle') {
      ctx.beginPath();
      ctx.arc(cx, cy, halfW, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (target.targetShape === 'square') {
      ctx.fillRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
      ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
    } else if (target.targetShape === 'nato-e') {
      const headHalfW = halfW * 0.5;
      const headBottomY = cy - halfH * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx - halfW, cy + halfH);
      ctx.lineTo(cx + halfW, cy + halfH);
      ctx.lineTo(cx + halfW, headBottomY);
      ctx.lineTo(cx + headHalfW, headBottomY);
      ctx.lineTo(cx + headHalfW, cy - halfH);
      ctx.lineTo(cx - headHalfW, cy - halfH);
      ctx.lineTo(cx - headHalfW, headBottomY);
      ctx.lineTo(cx - halfW, headBottomY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // IPSC Torso: 45 x 75 cm
      const headHalfW = (15 / 2) * scale;
      const headBottomY = cy - (halfH * 0.4);
      ctx.beginPath();
      ctx.moveTo(cx - halfW, cy + halfH);
      ctx.lineTo(cx + halfW, cy + halfH);
      ctx.lineTo(cx + halfW, headBottomY);
      ctx.lineTo(cx + headHalfW, headBottomY);
      ctx.lineTo(cx + headHalfW, cy - halfH);
      ctx.lineTo(cx - headHalfW, cy - halfH);
      ctx.lineTo(cx - headHalfW, headBottomY);
      ctx.lineTo(cx - halfW, headBottomY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // 3. Draw R95 & CEP Probability Circles
    // R95 Circle (Purple dashed)
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, res.r95Cm * scale, 0, Math.PI * 2);
    ctx.stroke();

    // CEP Circle (Cyan dashed)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, res.cepCm * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Draw Individual Shot Dispersion Points
    for (const pt of res.shotCoords) {
      const px = cx + pt.xCm * scale;
      const py = cy - pt.yCm * scale;

      ctx.fillStyle = pt.hit ? '#10b981' : '#f43f5e';
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Center Aim Crosshair
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();

    // 6. Scale Indicator
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Grid Rings: 10cm | Range: ${target.distanceM}m`, 12, h - 12);
  }

  renderWezMetrics(res) {
    const metricsDiv = this.container.querySelector('#wez-metrics-container');
    const sensDiv = this.container.querySelector('#wez-sensitivity-container');
    if (!metricsDiv || !sensDiv) return;

    let hitBadgeClass = 'text-emerald';
    let hitBadgeText = 'Excellent Precision';
    if (res.hitProbabilityPercent < 75) {
      hitBadgeClass = 'text-amber';
      hitBadgeText = 'Marginal / High Dispersal';
    } else if (res.hitProbabilityPercent < 90) {
      hitBadgeClass = 'text-cyan';
      hitBadgeText = 'Combat Effective';
    }

    metricsDiv.innerHTML = `
      <div class="stat-card highlight-cyan">
        <span class="stat-label">HIT PROBABILITY</span>
        <span class="stat-val ${hitBadgeClass}">${res.hitProbabilityPercent}%</span>
        <span class="stat-sub">${hitBadgeText}</span>
      </div>
      <div class="stat-card highlight-amber">
        <span class="stat-label">CIRCULAR ERROR PROBABLE (CEP 50%)</span>
        <span class="stat-val">${res.cepCm} cm</span>
        <span class="stat-sub">${(res.cepCm / 2.54).toFixed(1)}" (${res.cepMoa} MOA / ${res.cepMrad} MRAD)</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">R95 (95% PROBABILITY RADIUS)</span>
        <span class="stat-val">${res.r95Cm} cm</span>
        <span class="stat-sub">${(res.r95Cm / 2.54).toFixed(1)}" (${((res.r95Cm * 0.01) / res.targetDistM * (180 * 60 / Math.PI)).toFixed(2)} MOA)</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MEAN RADIUS</span>
        <span class="stat-val">${res.meanRadiusCm} cm</span>
        <span class="stat-sub">${(res.meanRadiusCm / 2.54).toFixed(1)}" dispersion</span>
      </div>
    `;

    const topFactor = res.sensitivity[0];
    sensDiv.innerHTML = `
      <h4>Sensitivity Variance Breakdown (Impact Dispersion Drivers)</h4>
      <div class="sensitivity-bars mt-2">
        ${res.sensitivity.map((s) => `
          <div class="sens-row">
            <div class="sens-header">
              <span class="sens-name">${s.factor}</span>
              <span class="sens-val">${s.variancePercent}%</span>
            </div>
            <div class="sens-bar-track">
              <div class="sens-bar-fill bar-${s.category.toLowerCase()}" data-width-pct="${Math.min(100, Math.max(2, s.variancePercent))}"></div>
            </div>
          </div>
        `).join('')}
      </div>
      <p class="wez-advice mt-2">
        💡 <strong>Tactical Insight:</strong> Primary error contributor is <strong>${topFactor.factor} (${topFactor.variancePercent}%)</strong>.
        ${topFactor.category === 'Wind' ? 'Upgrading wind reading resolution or firing in calm windows yields maximum hit rate gain.' : topFactor.category === 'Ammo' ? 'Improving powder charge uniformity to reduce MV SD below 2.0 m/s will significantly tighten vertical dispersion.' : 'Focus on rifle stability, trigger control, and natural point of aim to reduce angular dispersion.'}
      </p>
    `;
    // Bar widths via the CSSOM: the CSP blocks inline style attributes in rendered HTML.
    sensDiv.querySelectorAll('[data-width-pct]').forEach((bar) => {
      bar.style.width = `${parseFloat(bar.dataset.widthPct)}%`;
    });
  }

  // --- 3. TARGET GROUP ANALYZER & COMPUTER VISION DETECTOR ---
  renderGroupAnalyzer() {
    return `
      <div class="tool-card">
        <div class="tool-card-header">
          <h3>Target Group Photo & Computer Vision Analyzer</h3>
          <p class="tool-desc">Upload a photo of your paper target or plot shot impacts interactively. Pure client-side computer vision automatically identifies dark bullet hole punctures and computes Extreme Spread, Mean Radius, CEP 50%, and POI bias.</p>
        </div>

        <div class="cv-toolbar-bar">
          <div class="cv-toolbar-group">
            <input type="file" id="group-file-input" accept="image/*" hidden />
            <button id="btn-upload-photo" class="btn-primary-sm">📷 Upload Target Photo</button>
            <button id="btn-load-sample-photo" class="btn-secondary-sm">🎯 Load Sample Target</button>
            <button id="btn-calibrate-scale" class="btn-secondary-sm">📐 Calibrate Scale</button>
            <select id="cv-scale-unit-select" class="form-select-sm" title="Scale Reference Unit">
              <option value="25.4" ${Math.abs(this.scaleRefLengthMm - 25.4) < 0.1 ? 'selected' : ''}>1 inch (25.4mm)</option>
              <option value="10.0" ${Math.abs(this.scaleRefLengthMm - 10.0) < 0.1 ? 'selected' : ''}>1 cm (10mm)</option>
            </select>
          </div>

          <div class="cv-toolbar-group">
            <label class="cv-label-inline">
              Caliber:
              <select id="group-caliber-select" class="form-select-sm">
                <option value="5.7" ${Math.abs(this.selectedCaliberMm - 5.7) < 0.2 ? 'selected' : ''}>.224 / 5.56mm</option>
                <option value="6.2" ${Math.abs(this.selectedCaliberMm - 6.2) < 0.2 ? 'selected' : ''}>6mm / .243</option>
                <option value="6.7" ${Math.abs(this.selectedCaliberMm - 6.7) < 0.2 ? 'selected' : ''}>6.5mm / .264</option>
                <option value="7.8" ${Math.abs(this.selectedCaliberMm - 7.8) < 0.2 ? 'selected' : ''}>.308 / 7.62mm</option>
                <option value="8.6" ${Math.abs(this.selectedCaliberMm - 8.6) < 0.2 ? 'selected' : ''}>.338 / 8.6mm</option>
                <option value="9.0" ${Math.abs(this.selectedCaliberMm - 9.0) < 0.2 ? 'selected' : ''}>9mm Luger</option>
              </select>
            </label>

            <label class="cv-label-inline">
              Sensitivity: <span id="cv-sens-val">${this.cvSensitivity}%</span>
              <input type="range" id="cv-sensitivity-slider" min="15" max="95" value="${this.cvSensitivity}" step="1" class="cv-range-slider" />
            </label>

            <label class="cv-label-inline">
              Distance:
              <input type="number" id="group-distance" class="form-input-sm w-70px" min="25" max="1500" step="25" value="100" /> m
            </label>
          </div>
        </div>

        <div class="group-analyzer-layout">
          <div class="target-canvas-box">
            <canvas id="group-canvas" width="520" height="520"></canvas>
            <div class="canvas-controls-hint">
              <span id="cv-status-hint">Click to add shot • Drag shot to adjust • Right-click to delete • Red diamond = Aim Point</span>
            </div>
          </div>

          <div class="group-stats-box">
            <div id="group-metrics-summary" class="metrics-summary-grid"></div>

            <div class="button-row mt-3">
              <button id="btn-run-cv" class="btn-primary-sm">🔍 Detect Bullet Holes</button>
              <button id="btn-reset-aim-point" class="btn-secondary-sm">📍 Center Aim Point</button>
              <button id="btn-clear-group" class="btn-secondary-sm">Clear All Shots</button>
              <button id="btn-reset-sample-group" class="btn-secondary-sm">Reset Sample Shots</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  initGroupCanvas() {
    const canvas = this.container.querySelector('#group-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const distInput = this.container.querySelector('#group-distance');
    const fileInput = this.container.querySelector('#group-file-input');
    const uploadBtn = this.container.querySelector('#btn-upload-photo');
    const samplePhotoBtn = this.container.querySelector('#btn-load-sample-photo');
    const calibScaleBtn = this.container.querySelector('#btn-calibrate-scale');
    const scaleUnitSelect = this.container.querySelector('#cv-scale-unit-select');
    const caliberSelect = this.container.querySelector('#group-caliber-select');
    const sensSlider = this.container.querySelector('#cv-sensitivity-slider');
    const sensValSpan = this.container.querySelector('#cv-sens-val');
    const runCvBtn = this.container.querySelector('#btn-run-cv');
    const resetAimBtn = this.container.querySelector('#btn-reset-aim-point');
    const clearBtn = this.container.querySelector('#btn-clear-group');
    const sampleShotsBtn = this.container.querySelector('#btn-reset-sample-group');
    const hintSpan = this.container.querySelector('#cv-status-hint');

    let isDragging = false;
    let dragTarget = null; // { type: 'shot', idx: 0 } | { type: 'aim' }
    let hasMoved = false;

    // Helper: Screen pixel coordinates from physical mm offset from aim point
    const mmToPixel = (xMm, yMm) => {
      const cx = canvas.width / 2 + this.aimPointMm.x * this.targetGridScale;
      const cy = canvas.height / 2 - this.aimPointMm.y * this.targetGridScale;
      return {
        x: cx + xMm * this.targetGridScale,
        y: cy - yMm * this.targetGridScale,
      };
    };

    // Helper: Physical mm coordinates from screen pixel coordinates
    const pixelToMm = (px, py) => {
      const cx = canvas.width / 2 + this.aimPointMm.x * this.targetGridScale;
      const cy = canvas.height / 2 - this.aimPointMm.y * this.targetGridScale;
      return {
        x: (px - cx) / this.targetGridScale,
        y: -(py - cy) / this.targetGridScale,
      };
    };

    const redraw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2 + this.aimPointMm.x * this.targetGridScale;
      const cy = h / 2 - this.aimPointMm.y * this.targetGridScale;
      const scale = this.targetGridScale; // px per mm

      ctx.clearRect(0, 0, w, h);

      if (this.targetImage) {
        // Draw background target photo centered
        const img = this.targetImage;
        const imgAspect = img.width / img.height;
        const canvasAspect = w / h;
        let drawW = w;
        let drawH = h;
        let drawX = 0;
        let drawY = 0;

        if (imgAspect > canvasAspect) {
          drawH = w / imgAspect;
          drawY = (h - drawH) / 2;
        } else {
          drawW = h * imgAspect;
          drawX = (w - drawW) / 2;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        // Faint measurement grid overlay
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.lineWidth = 0.8;
        for (let x = -250; x <= 250; x += 10) {
          ctx.beginPath();
          ctx.moveTo(cx + x * scale, 0);
          ctx.lineTo(cx + x * scale, h);
          ctx.stroke();
        }
        for (let y = -250; y <= 250; y += 10) {
          ctx.beginPath();
          ctx.moveTo(0, cy - y * scale);
          ctx.lineTo(w, cy - y * scale);
          ctx.stroke();
        }
      } else {
        // High-Contrast Tactical Range Dark Grid
        ctx.fillStyle = '#090e17';
        ctx.fillRect(0, 0, w, h);

        // Grid lines: 10mm (1 cm) lines & 25.4mm (1 inch) lines
        ctx.strokeStyle = '#142036';
        ctx.lineWidth = 1;
        for (let x = -250; x <= 250; x += 10) {
          ctx.beginPath();
          ctx.moveTo(cx + x * scale, 0);
          ctx.lineTo(cx + x * scale, h);
          ctx.stroke();
        }
        for (let y = -250; y <= 250; y += 10) {
          ctx.beginPath();
          ctx.moveTo(0, cy - y * scale);
          ctx.lineTo(w, cy - y * scale);
          ctx.stroke();
        }

        // 1-Inch and 2-Inch target rings
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 25.4 * scale, 0, Math.PI * 2);
        ctx.arc(cx, cy, 50.8 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw Aim Point (Red Diamond Bullseye)
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx + 7, cy);
      ctx.lineTo(cx, cy + 7);
      ctx.lineTo(cx - 7, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('AIM', cx + 9, cy + 3);

      const shots = this.groupShots;
      if (shots.length === 0) {
        this.updateGroupMetrics(0, 0, 0, 0, 0, Number(distInput?.value || 100), 0);
        return;
      }

      // Mean Center of Impact (POI)
      const meanX = shots.reduce((s, p) => s + p.x, 0) / shots.length;
      const meanY = shots.reduce((s, p) => s + p.y, 0) / shots.length;
      const poiPx = mmToPixel(meanX, meanY);

      // Extreme Spread (Maximum distance between any pair)
      let maxDistMm = 0;
      let p1 = shots[0];
      let p2 = shots[0];

      for (let i = 0; i < shots.length; i++) {
        for (let j = i + 1; j < shots.length; j++) {
          const dx = shots[i].x - shots[j].x;
          const dy = shots[i].y - shots[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > maxDistMm) {
            maxDistMm = d;
            p1 = shots[i];
            p2 = shots[j];
          }
        }
      }

      // Mean Radius
      const meanRadiusMm = shots.reduce((s, p) => {
        const dx = p.x - meanX;
        const dy = p.y - meanY;
        return s + Math.sqrt(dx * dx + dy * dy);
      }, 0) / shots.length;

      // CEP 50% (Median distance from POI)
      const radii = shots.map((p) => Math.sqrt((p.x - meanX) ** 2 + (p.y - meanY) ** 2)).sort((a, b) => a - b);
      const mid = Math.floor(radii.length / 2);
      const cep50Mm = radii.length % 2 === 0 ? (radii[mid - 1] + radii[mid]) / 2 : radii[mid];

      // Draw Extreme Spread Line
      if (shots.length >= 2) {
        const p1Px = mmToPixel(p1.x, p1.y);
        const p2Px = mmToPixel(p2.x, p2.y);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(p1Px.x, p1Px.y);
        ctx.lineTo(p2Px.x, p2Px.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Mean Radius Circle (dashed cyan circle around POI)
      if (shots.length >= 2 && meanRadiusMm > 0) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(poiPx.x, poiPx.y, meanRadiusMm * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Center of Impact (POI crosshair in sky blue)
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(poiPx.x - 9, poiPx.y);
      ctx.lineTo(poiPx.x + 9, poiPx.y);
      ctx.moveTo(poiPx.x, poiPx.y - 9);
      ctx.lineTo(poiPx.x, poiPx.y + 9);
      ctx.stroke();

      // Draw Shots (Caliber circle with glowing border & number)
      const caliberRadiusPx = Math.max(3, (this.selectedCaliberMm / 2) * scale);
      shots.forEach((pt, idx) => {
        const shotPx = mmToPixel(pt.x, pt.y);

        // Caliber bullet hole circle
        ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
        ctx.beginPath();
        ctx.arc(shotPx.x, shotPx.y, caliberRadiusPx, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        // Outer glow indicator
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(shotPx.x, shotPx.y, caliberRadiusPx + 2.5, 0, Math.PI * 2);
        ctx.stroke();

        // Shot number tag
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px monospace';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 3;
        ctx.fillText(`${idx + 1}`, shotPx.x + caliberRadiusPx + 3, shotPx.y - 3);
        ctx.shadowBlur = 0;
      });

      // Draw Calibration Line if in progress
      if (this.isCalibratingScale && this.scaleCalibPoints.length === 1) {
        const pt1 = this.scaleCalibPoints[0];
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt1.x, pt1.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      const distM = Number(distInput?.value || 100);
      this.updateGroupMetrics(shots.length, maxDistMm, meanRadiusMm, meanX, meanY, distM, cep50Mm);
    };

    // Client-Side Computer Vision Target Hole Detection Engine
    this.detectBulletHolesFromImage = (sourceCanvasOrImg) => {
      const w = canvas.width;
      const h = canvas.height;

      // Draw source image onto an offscreen canvas for getImageData processing
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext('2d');

      const imgAspect = sourceCanvasOrImg.width / sourceCanvasOrImg.height;
      const canvasAspect = w / h;
      let drawW = w;
      let drawH = h;
      let drawX = 0;
      let drawY = 0;

      if (imgAspect > canvasAspect) {
        drawH = w / imgAspect;
        drawY = (h - drawH) / 2;
      } else {
        drawW = h * imgAspect;
        drawX = (w - drawW) / 2;
      }
      offCtx.drawImage(sourceCanvasOrImg, drawX, drawY, drawW, drawH);

      const imgData = offCtx.getImageData(0, 0, w, h);
      const data = imgData.data;

      // 1. Grayscale Conversion (Standard luminance coefficients)
      const gray = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      }

      // 2. 5x5 Separable Gaussian Smoothing
      const blurred = new Uint8Array(w * h);
      const temp = new Uint8Array(w * h);

      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - 2);
          const x1 = Math.max(0, x - 1);
          const x2 = x;
          const x3 = Math.min(w - 1, x + 1);
          const x4 = Math.min(w - 1, x + 2);
          temp[row + x] = (
            gray[row + x0] +
            gray[row + x1] * 4 +
            gray[row + x2] * 6 +
            gray[row + x3] * 4 +
            gray[row + x4]
          ) >> 4;
        }
      }

      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - 2) * w;
        const y1 = Math.max(0, y - 1) * w;
        const y2 = y * w;
        const y3 = Math.min(h - 1, y + 1) * w;
        const y4 = Math.min(h - 1, y + 2) * w;
        const row = y * w;
        for (let x = 0; x < w; x++) {
          blurred[row + x] = (
            temp[y0 + x] +
            temp[y1 + x] * 4 +
            temp[y2 + x] * 6 +
            temp[y3 + x] * 4 +
            temp[y4 + x]
          ) >> 4;
        }
      }

      // 3. Sobel Edge & Gradient Thresholding
      const gx = new Int16Array(w * h);
      const gy = new Int16Array(w * h);
      const mag = new Float32Array(w * h);

      for (let y = 1; y < h - 1; y++) {
        const ym1 = (y - 1) * w;
        const y0 = y * w;
        const yp1 = (y + 1) * w;
        for (let x = 1; x < w - 1; x++) {
          const valGx =
            blurred[ym1 + x + 1] + 2 * blurred[y0 + x + 1] + blurred[yp1 + x + 1] -
            (blurred[ym1 + x - 1] + 2 * blurred[y0 + x - 1] + blurred[yp1 + x - 1]);
          const valGy =
            blurred[yp1 + x - 1] + 2 * blurred[yp1 + x] + blurred[yp1 + x + 1] -
            (blurred[ym1 + x - 1] + 2 * blurred[ym1 + x] + blurred[ym1 + x + 1]);

          const idx = y0 + x;
          gx[idx] = valGx;
          gy[idx] = valGy;
          mag[idx] = Math.sqrt(valGx * valGx + valGy * valGy);
        }
      }

      // 4. Circular Hough / Radial Symmetry Dark Blob Accumulator
      const expectedRadius = Math.max(3, (this.selectedCaliberMm / 2) * this.targetGridScale);
      const minRadius = Math.max(2, Math.round(expectedRadius * 0.7));
      const maxRadius = Math.max(4, Math.round(expectedRadius * 1.35));
      const accum = new Float32Array(w * h);

      for (let y = 5; y < h - 5; y++) {
        const row = y * w;
        for (let x = 5; x < w - 5; x++) {
          const idx = row + x;
          const gMag = mag[idx];
          if (gMag < 35) continue; // Skip weak gradient noise

          const ux = gx[idx] / gMag;
          const uy = gy[idx] / gMag;

          // For bullet holes on paper, gradient points outward from dark interior to light paper.
          // Center lies in inward direction (-ux, -uy).
          for (let r = minRadius; r <= maxRadius; r++) {
            const cx = Math.round(x - r * ux);
            const cy = Math.round(y - r * uy);
            if (cx >= 5 && cx < w - 5 && cy >= 5 && cy < h - 5) {
              accum[cy * w + cx] += gMag * (1.0 / r);
            }
          }
        }
      }

      // 5. Radial Darkness Symmetry Scoring & Non-Maximum Suppression (NMS)
      const candidates = [];
      const sens = this.cvSensitivity / 100;

      // Find max vote
      let maxVote = 0;
      for (let i = 0; i < accum.length; i++) {
        if (accum[i] > maxVote) maxVote = accum[i];
      }
      const voteThreshold = maxVote * (1.0 - sens * 0.75);

      for (let y = 8; y < h - 8; y++) {
        const row = y * w;
        for (let x = 8; x < w - 8; x++) {
          const idx = row + x;
          const vote = accum[idx];
          if (vote < voteThreshold || vote < 20) continue;

          // Check if dark inside radius compared to outside paper ring
          let innerSum = 0;
          let innerCount = 0;
          let outerSum = 0;
          let outerCount = 0;
          const rInt = Math.round(expectedRadius);

          for (let dy = -rInt * 2; dy <= rInt * 2; dy++) {
            for (let dx = -rInt * 2; dx <= rInt * 2; dx++) {
              const d2 = dx * dx + dy * dy;
              const val = gray[(y + dy) * w + (x + dx)];
              if (d2 <= (rInt * 0.8) ** 2) {
                innerSum += val;
                innerCount++;
              } else if (d2 >= (rInt * 1.1) ** 2 && d2 <= (rInt * 1.8) ** 2) {
                outerSum += val;
                outerCount++;
              }
            }
          }

          const innerAvg = innerCount > 0 ? innerSum / innerCount : 255;
          const outerAvg = outerCount > 0 ? outerSum / outerCount : 0;
          const contrast = outerAvg - innerAvg;

          // Must be darker inside the hole than the surrounding paper
          if (contrast > 12) {
            candidates.push({
              px: x,
              py: y,
              score: vote * Math.sqrt(contrast),
            });
          }
        }
      }

      // Sort candidates by score descending
      candidates.sort((a, b) => b.score - a.score);

      // Non-Maximum Suppression (NMS)
      const detected = [];
      const minDistancePx = expectedRadius * 1.35;

      for (const cand of candidates) {
        let isOverlap = false;
        for (const existing of detected) {
          const dist = Math.hypot(cand.px - existing.px, cand.py - existing.py);
          if (dist < minDistancePx) {
            isOverlap = true;
            break;
          }
        }
        if (!isOverlap) {
          detected.push(cand);
          if (detected.length >= 25) break; // Maximum realistic group count
        }
      }

      if (detected.length > 0) {
        // Convert detected pixels to mm coordinates from Aim Point
        this.groupShots = detected.map((d) => {
          const ptMm = pixelToMm(d.px, d.py);
          return {
            x: Number(ptMm.x.toFixed(1)),
            y: Number(ptMm.y.toFixed(1)),
          };
        });
        if (hintSpan) {
          hintSpan.textContent = `🎯 CV Detected ${detected.length} bullet hole punctures! Click or drag to adjust.`;
        }
      } else {
        if (hintSpan) {
          hintSpan.textContent = '⚠️ No holes detected with current sensitivity. Try adjusting sensitivity slider or click to place shots manually.';
        }
      }

      redraw();
    };

    // Synthetic Sample Target Generator
    const generateSampleTargetPhoto = () => {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 520;
      sampleCanvas.height = 520;
      const sCtx = sampleCanvas.getContext('2d');
      const w = 520;
      const h = 520;
      const cx = w / 2;
      const cy = h / 2;
      const scale = this.targetGridScale;

      // Realistic off-white / light tan target paper
      sCtx.fillStyle = '#f5efe3';
      sCtx.fillRect(0, 0, w, h);

      // Subtle paper fibers / texture
      sCtx.fillStyle = 'rgba(180, 160, 140, 0.08)';
      for (let i = 0; i < 400; i++) {
        const rx = Math.random() * w;
        const ry = Math.random() * h;
        sCtx.fillRect(rx, ry, 2, 2);
      }

      // 1-Inch Grid Lines (25.4mm * 2 = 50.8px)
      sCtx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      sCtx.lineWidth = 1;
      for (let x = -200; x <= 200; x += 25.4) {
        sCtx.beginPath();
        sCtx.moveTo(cx + x * scale, 0);
        sCtx.lineTo(cx + x * scale, h);
        sCtx.stroke();
      }
      for (let y = -200; y <= 200; y += 25.4) {
        sCtx.beginPath();
        sCtx.moveTo(0, cy + y * scale);
        sCtx.lineTo(w, cy + y * scale);
        sCtx.stroke();
      }

      // Target Rings (1-inch, 2-inch, 3-inch, 4-inch rings)
      [25.4, 50.8, 76.2, 101.6].forEach((rMm, idx) => {
        sCtx.strokeStyle = idx === 1 ? 'rgba(15, 23, 42, 0.7)' : 'rgba(100, 116, 139, 0.5)';
        sCtx.lineWidth = idx === 1 ? 2 : 1.2;
        sCtx.beginPath();
        sCtx.arc(cx, cy, rMm * scale, 0, Math.PI * 2);
        sCtx.stroke();
      });

      // Red Diamond Bullseye
      sCtx.fillStyle = '#dc2626';
      sCtx.beginPath();
      sCtx.moveTo(cx, cy - 8);
      sCtx.lineTo(cx + 8, cy);
      sCtx.lineTo(cx, cy + 8);
      sCtx.lineTo(cx - 8, cy);
      sCtx.closePath();
      sCtx.fill();

      // Sample 5-shot impacts on paper with dark punctures & powder burns
      const sampleHoles = [
        { x: 0, y: 0 },
        { x: 8, y: -6 },
        { x: -5, y: 10 },
        { x: -12, y: -4 },
        { x: 6, y: 12 },
      ];

      const rPx = (this.selectedCaliberMm / 2) * scale;
      sampleHoles.forEach((sh) => {
        const hx = cx + sh.x * scale;
        const hy = cy - sh.y * scale;

        // Paper tear halo
        sCtx.fillStyle = '#ded6c6';
        sCtx.beginPath();
        sCtx.arc(hx, hy, rPx + 2.5, 0, Math.PI * 2);
        sCtx.fill();

        // Powder burn ring
        sCtx.fillStyle = '#0a0a0c';
        sCtx.beginPath();
        sCtx.arc(hx, hy, rPx + 0.8, 0, Math.PI * 2);
        sCtx.fill();

        // Deep puncture center
        sCtx.fillStyle = '#1c1917';
        sCtx.beginPath();
        sCtx.arc(hx, hy, rPx, 0, Math.PI * 2);
        sCtx.fill();
      });

      this.targetImage = sampleCanvas;
      this.detectBulletHolesFromImage(sampleCanvas);
    };

    // Event Bindings
    uploadBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          this.targetImage = img;
          this.detectBulletHolesFromImage(img);
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });

    samplePhotoBtn?.addEventListener('click', () => generateSampleTargetPhoto());

    runCvBtn?.addEventListener('click', () => {
      if (this.targetImage) {
        this.detectBulletHolesFromImage(this.targetImage);
      } else {
        generateSampleTargetPhoto();
      }
    });

    scaleUnitSelect?.addEventListener('change', (e) => {
      this.scaleRefLengthMm = parseFloat(e.target.value) || 25.4;
      const unitText = Math.abs(this.scaleRefLengthMm - 10.0) < 0.1 ? '1 cm (10mm)' : '1 inch (25.4mm)';
      if (hintSpan) hintSpan.textContent = `Scale calibration reference set to ${unitText}. Click "Calibrate Scale" then 2 points on target.`;
    });

    calibScaleBtn?.addEventListener('click', () => {
      this.isCalibratingScale = !this.isCalibratingScale;
      this.scaleCalibPoints = [];
      if (this.isCalibratingScale) {
        calibScaleBtn.classList.add('active');
        const unitName = Math.abs(this.scaleRefLengthMm - 10.0) < 0.1 ? '1 cm (10mm)' : '1 inch (25.4mm)';
        if (hintSpan) hintSpan.textContent = `📐 Scale Calibration Mode: Click Point 1 of ${unitName} reference line`;
      } else {
        calibScaleBtn.classList.remove('active');
        if (hintSpan) hintSpan.textContent = 'Click to add shot • Drag shot to adjust • Right-click to delete';
      }
      redraw();
    });

    caliberSelect?.addEventListener('change', (e) => {
      this.selectedCaliberMm = parseFloat(e.target.value);
      if (this.targetImage) {
        this.detectBulletHolesFromImage(this.targetImage);
      } else {
        redraw();
      }
    });

    sensSlider?.addEventListener('input', (e) => {
      this.cvSensitivity = parseInt(e.target.value, 10);
      if (sensValSpan) sensValSpan.textContent = `${this.cvSensitivity}%`;
      if (this.targetImage) {
        this.detectBulletHolesFromImage(this.targetImage);
      }
    });

    resetAimBtn?.addEventListener('click', () => {
      this.aimPointMm = { x: 0, y: 0 };
      redraw();
    });

    clearBtn?.addEventListener('click', () => {
      this.groupShots = [];
      this.targetImage = null;
      if (hintSpan) hintSpan.textContent = 'Shots cleared. Upload a photo or click on grid to add shots.';
      redraw();
    });

    sampleShotsBtn?.addEventListener('click', () => {
      this.groupShots = [
        { x: 0, y: 0 },
        { x: 8, y: -6 },
        { x: -5, y: 10 },
        { x: -12, y: -4 },
        { x: 6, y: 12 },
      ];
      this.targetImage = null;
      redraw();
    });

    distInput?.addEventListener('input', () => redraw());

    // Interactive Dragging & Click Handlers on Canvas
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || canvas.width);
      const scaleY = canvas.height / (rect.height || canvas.height);
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      hasMoved = false;

      // Handle scale calibration clicks
      if (this.isCalibratingScale) {
        this.scaleCalibPoints.push({ x: mouseX, y: mouseY });
        if (this.scaleCalibPoints.length === 1) {
          const unitName = Math.abs(this.scaleRefLengthMm - 10.0) < 0.1 ? '1 cm = 10mm' : '1 inch = 25.4mm';
          if (hintSpan) hintSpan.textContent = `Point 1 recorded! Now click Point 2 (${unitName})`;
          redraw();
        } else if (this.scaleCalibPoints.length === 2) {
          const pt1 = this.scaleCalibPoints[0];
          const pt2 = this.scaleCalibPoints[1];
          const distPx = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);
          if (distPx > 5) {
            this.targetGridScale = distPx / this.scaleRefLengthMm;
            this.isCalibratingScale = false;
            calibScaleBtn?.classList.remove('active');
            const unitName = Math.abs(this.scaleRefLengthMm - 10.0) < 0.1 ? '1 cm' : '1 inch';
            if (hintSpan) hintSpan.textContent = `✅ Calibrated scale: ${distPx.toFixed(1)}px for ${unitName} (${this.targetGridScale.toFixed(2)} px/mm)`;
          }
          this.scaleCalibPoints = [];
          redraw();
        }
        return;
      }

      // Check if clicking near aim point diamond
      const aimPx = mmToPixel(0, 0);
      if (Math.hypot(mouseX - aimPx.x, mouseY - aimPx.y) <= 12) {
        isDragging = true;
        dragTarget = { type: 'aim' };
        canvas.style.cursor = 'grabbing';
        return;
      }

      // Check if clicking near any existing shot point
      const caliberRadius = Math.max(8, (this.selectedCaliberMm / 2) * this.targetGridScale + 4);
      for (let i = this.groupShots.length - 1; i >= 0; i--) {
        const shotPx = mmToPixel(this.groupShots[i].x, this.groupShots[i].y);
        if (Math.hypot(mouseX - shotPx.x, mouseY - shotPx.y) <= caliberRadius) {
          isDragging = true;
          dragTarget = { type: 'shot', idx: i };
          canvas.style.cursor = 'grabbing';
          return;
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || canvas.width);
      const scaleY = canvas.height / (rect.height || canvas.height);
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      if (isDragging && dragTarget) {
        hasMoved = true;
        if (dragTarget.type === 'shot') {
          const ptMm = pixelToMm(mouseX, mouseY);
          this.groupShots[dragTarget.idx] = {
            x: Number(ptMm.x.toFixed(1)),
            y: Number(ptMm.y.toFixed(1)),
          };
          redraw();
        } else if (dragTarget.type === 'aim') {
          this.aimPointMm = {
            x: Number(((mouseX - canvas.width / 2) / this.targetGridScale).toFixed(1)),
            y: Number((-(mouseY - canvas.height / 2) / this.targetGridScale).toFixed(1)),
          };
          redraw();
        }
        return;
      }

      // Hover cursor management
      if (!this.isCalibratingScale) {
        let hovering = false;
        const aimPx = mmToPixel(0, 0);
        if (Math.hypot(mouseX - aimPx.x, mouseY - aimPx.y) <= 12) {
          hovering = true;
        } else {
          const caliberRadius = Math.max(8, (this.selectedCaliberMm / 2) * this.targetGridScale + 4);
          for (const s of this.groupShots) {
            const shotPx = mmToPixel(s.x, s.y);
            if (Math.hypot(mouseX - shotPx.x, mouseY - shotPx.y) <= caliberRadius) {
              hovering = true;
              break;
            }
          }
        }
        canvas.style.cursor = hovering ? 'grab' : 'crosshair';
      }
    });

    canvas.addEventListener('mouseup', () => {
      isDragging = false;
      dragTarget = null;
      canvas.style.cursor = 'crosshair';
    });

    canvas.addEventListener('click', (e) => {
      if (this.isCalibratingScale || hasMoved) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || canvas.width);
      const scaleY = canvas.height / (rect.height || canvas.height);
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      // Ensure click is not on existing shot
      const caliberRadius = Math.max(8, (this.selectedCaliberMm / 2) * this.targetGridScale + 4);
      for (const s of this.groupShots) {
        const shotPx = mmToPixel(s.x, s.y);
        if (Math.hypot(clickX - shotPx.x, clickY - shotPx.y) <= caliberRadius) {
          return;
        }
      }

      const ptMm = pixelToMm(clickX, clickY);
      this.groupShots.push({ x: Number(ptMm.x.toFixed(1)), y: Number(ptMm.y.toFixed(1)) });
      redraw();
    });

    // Right-click to remove a shot
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || canvas.width);
      const scaleY = canvas.height / (rect.height || canvas.height);
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      const caliberRadius = Math.max(10, (this.selectedCaliberMm / 2) * this.targetGridScale + 6);
      for (let i = this.groupShots.length - 1; i >= 0; i--) {
        const shotPx = mmToPixel(this.groupShots[i].x, this.groupShots[i].y);
        if (Math.hypot(clickX - shotPx.x, clickY - shotPx.y) <= caliberRadius) {
          this.groupShots.splice(i, 1);
          redraw();
          return;
        }
      }
    });

    redraw();
  }

  updateGroupMetrics(numShots, esMm, meanRadiusMm, meanX, meanY, distM = 100, cep50Mm = 0) {
    const summary = this.container.querySelector('#group-metrics-summary');
    if (!summary) return;

    if (numShots === 0) {
      summary.innerHTML = `<p class="text-muted">No shots plotted yet. Upload a photo or click on canvas to add shots.</p>`;
      return;
    }

    // Angular conversions:
    // MOA = (Size_mm / (distM * 1000)) * (180 * 60 / pi)
    const esMoa = ((esMm / (distM * 1000)) * (180 * 60 / Math.PI)).toFixed(2);
    const esMrad = ((esMm / (distM * 1000)) * 1000).toFixed(2);
    const esIn = (esMm / 25.4).toFixed(2);

    const mrMoa = ((meanRadiusMm / (distM * 1000)) * (180 * 60 / Math.PI)).toFixed(2);
    const mrMrad = ((meanRadiusMm / (distM * 1000)) * 1000).toFixed(2);
    const mrIn = (meanRadiusMm / 25.4).toFixed(2);

    const cepMoa = ((cep50Mm / (distM * 1000)) * (180 * 60 / Math.PI)).toFixed(2);
    const cepMrad = ((cep50Mm / (distM * 1000)) * 1000).toFixed(2);
    const cepIn = (cep50Mm / 25.4).toFixed(2);

    // POI bias angular conversions
    const poiXMoa = ((Math.abs(meanX) / (distM * 1000)) * (180 * 60 / Math.PI)).toFixed(2);
    const poiYMoa = ((Math.abs(meanY) / (distM * 1000)) * (180 * 60 / Math.PI)).toFixed(2);
    const poiDirX = meanX >= 0 ? 'R' : 'L';
    const poiDirY = meanY >= 0 ? 'HIGH' : 'LOW';

    summary.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">SHOT COUNT</span>
        <span class="stat-val">${numShots} shots</span>
        <span class="stat-sub">Distance: ${distM} m</span>
      </div>
      <div class="stat-card highlight-amber">
        <span class="stat-label">EXTREME SPREAD (ES)</span>
        <span class="stat-val">${esMoa} MOA</span>
        <span class="stat-sub">${esMm.toFixed(1)} mm / ${esIn}" (${esMrad} MRAD)</span>
      </div>
      <div class="stat-card highlight-cyan">
        <span class="stat-label">MEAN RADIUS (MR)</span>
        <span class="stat-val">${mrMoa} MOA</span>
        <span class="stat-sub">${meanRadiusMm.toFixed(1)} mm / ${mrIn}" (${mrMrad} MRAD)</span>
      </div>
      <div class="stat-card highlight-emerald">
        <span class="stat-label">CEP 50% PROBABILITY</span>
        <span class="stat-val">${cepMoa} MOA</span>
        <span class="stat-sub">${cep50Mm.toFixed(1)} mm / ${cepIn}" (${cepMrad} MRAD)</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CENTER OF IMPACT (POI)</span>
        <span class="stat-val">${Math.abs(meanX).toFixed(1)}mm ${poiDirX} • ${Math.abs(meanY).toFixed(1)}mm ${poiDirY}</span>
        <span class="stat-sub">${poiXMoa} MOA ${poiDirX} • ${poiYMoa} MOA ${poiDirY}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">CALIBER PRIOR</span>
        <span class="stat-val">${this.selectedCaliberMm} mm</span>
        <span class="stat-sub">Scale: ${this.targetGridScale.toFixed(2)} px/mm</span>
      </div>
    `;
  }

  // --- 3. CHRONOGRAPH CALCULATOR ---
  renderChrono() {
    return `
      <div class="tool-card">
        <h3>Chronograph SD & ES Statistics Engine</h3>
        <p class="tool-desc">Paste or type your chronograph velocity readings separated by commas or spaces.</p>

        <div class="field-row mt-2">
          <label>Muzzle Velocities (m/s or fps)</label>
          <textarea id="chrono-input" class="form-textarea" rows="4">825.4, 827.1, 824.8, 826.5, 825.9, 824.2, 827.8, 825.0, 826.2, 825.8</textarea>
        </div>

        <button id="btn-calc-chrono" class="btn-primary mt-2">Analyze Shot String</button>
        <div id="chrono-results" class="metrics-summary-grid mt-4"></div>
      </div>
    `;
  }

  calcChrono() {
    const raw = this.container.querySelector('#chrono-input')?.value || '';
    const numbers = raw
      .split(/[,\s\n\r]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n) && n > 0);

    const out = this.container.querySelector('#chrono-results');
    if (!out || numbers.length < 2) {
      if (out) out.innerHTML = `<p class="text-amber">Enter at least 2 valid velocities.</p>`;
      return;
    }

    const n = numbers.length;
    const mean = numbers.reduce((s, v) => s + v, 0) / n;
    const variance = numbers.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
    const sd = Math.sqrt(variance);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const es = max - min;

    const sorted = [...numbers].sort((a, b) => a - b);
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

    out.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">SHOT STRING COUNT</span>
        <span class="stat-val">${n} shots</span>
      </div>
      <div class="stat-card highlight-cyan">
        <span class="stat-label">AVERAGE (MEAN) MV</span>
        <span class="stat-val">${mean.toFixed(1)} m/s</span>
      </div>
      <div class="stat-card highlight-amber">
        <span class="stat-label">STANDARD DEVIATION (SD)</span>
        <span class="stat-val">${sd.toFixed(2)} m/s</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">EXTREME SPREAD (ES)</span>
        <span class="stat-val">${es.toFixed(1)} m/s</span>
        <span class="stat-sub">Min: ${min.toFixed(1)} | Max: ${max.toFixed(1)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MEDIAN VELOCITY</span>
        <span class="stat-val">${median.toFixed(1)} m/s</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">ONE-CLICK APPLY</span>
        <button id="btn-apply-chrono-mv" class="btn-primary-sm mt-1" data-mv="${mean.toFixed(1)}">Apply to Active Profile</button>
      </div>
    `;

    this.container.querySelector('#btn-apply-chrono-mv')?.addEventListener('click', (e) => {
      const val = parseFloat(e.target.dataset.mv);
      appState.updateActiveProfile({ muzzleVelocityMs: val, zeroAngleRad: null });
      alert(`Updated active profile muzzle velocity to ${val} m/s!`);
    });
  }

  // --- 4. MILLING & RANGE ESTIMATION ---
  renderMilling() {
    return `
      <div class="tool-card">
        <h3>Milling & Optical Range Estimation</h3>
        <p class="tool-desc">Estimate target distance from reticle subtension readings using the Mil-Relation formula.</p>

        <div class="field-grid-2">
          <div>
            <div class="field-row">
              <label>Target Dimension Preset</label>
              <select id="milling-preset" class="form-select">
                <option value="450">IPSC Torso Width (450 mm / 17.7")</option>
                <option value="750">IPSC Torso Height (750 mm / 29.5")</option>
                <option value="1000">NATO E-Type Height (1000 mm / 39.4")</option>
                <option value="300">Standard Steel Gong (300 mm / 11.8")</option>
                <option value="700">Vehicle Wheel (700 mm / 27.5")</option>
              </select>
            </div>
            <div class="field-row">
              <label>Custom Target Size (mm)</label>
              <input type="number" id="milling-size-mm" class="form-input" min="50" max="3000" value="450" />
            </div>
            <div class="field-row">
              <label>Observed Reticle Reading (MRAD)</label>
              <input type="number" id="milling-mils" class="form-input" min="0.1" max="15.0" step="0.05" value="0.75" />
            </div>
          </div>

          <div class="milling-result-panel">
            <h4>Estimated Target Range</h4>
            <div class="milling-range-display" id="milling-range-result">600 m</div>
            <div class="text-muted text-sm" id="milling-range-yd">656 yards</div>
            <div class="formula-box mt-3">
              <code>Range(m) = Size(mm) / Mils</code>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  calcMilling() {
    const sizeMm = parseFloat(this.container.querySelector('#milling-size-mm')?.value || 450);
    const mils = parseFloat(this.container.querySelector('#milling-mils')?.value || 0.75);

    if (mils > 0) {
      const rangeM = Math.round(sizeMm / mils);
      const rangeYd = Math.round(rangeM * 1.09361);
      const resM = this.container.querySelector('#milling-range-result');
      const resYd = this.container.querySelector('#milling-range-yd');
      if (resM) resM.textContent = `${rangeM} m`;
      if (resYd) resYd.textContent = `${rangeYd} yards`;
    }
  }

  // --- 5. FREE RECOIL CALCULATOR ---
  renderRecoil() {
    return `
      <div class="tool-card">
        <h3>Firearm Free Recoil Energy & Impulse Dynamics</h3>
        <p class="tool-desc">Calculate physical free recoil energy, recoil velocity, and felt recoil severity.</p>

        <div class="field-grid-2">
          <div>
            <div class="field-row">
              <label>Rifle System Weight (kg / with optic & bipod)</label>
              <input type="number" id="recoil-rifle-kg" class="form-input" min="2.0" max="25.0" step="0.1" value="6.8" />
            </div>
            <div class="field-row">
              <label>Bullet Weight (gr)</label>
              <input type="number" id="recoil-bullet-gr" class="form-input" min="20" max="1000" value="140" />
            </div>
            <div class="field-row">
              <label>Powder Charge Weight (gr)</label>
              <input type="number" id="recoil-powder-gr" class="form-input" min="10" max="250" value="41.5" />
            </div>
            <div class="field-row">
              <label>Muzzle Velocity (m/s)</label>
              <input type="number" id="recoil-mv-ms" class="form-input" min="200" max="1500" value="825" />
            </div>
            <button id="btn-calc-recoil" class="btn-primary mt-2">Compute Recoil</button>
          </div>

          <div id="recoil-results" class="metrics-summary-grid"></div>
        </div>
      </div>
    `;
  }

  calcRecoil() {
    const rifleKg = parseFloat(this.container.querySelector('#recoil-rifle-kg')?.value || 6.8);
    const bulletGr = parseFloat(this.container.querySelector('#recoil-bullet-gr')?.value || 140);
    const powderGr = parseFloat(this.container.querySelector('#recoil-powder-gr')?.value || 41.5);
    const mvMs = parseFloat(this.container.querySelector('#recoil-mv-ms')?.value || 825);

    // SI Masses
    const bulletKg = bulletGr * 0.00006479891;
    const powderKg = powderGr * 0.00006479891;
    const gasVelocityMs = mvMs * 1.5; // Standard gas exit velocity approx 1.5x MV

    // Total Recoil Impulse: I = m_bullet * v + m_powder * v_gas
    const impulseNs = bulletKg * mvMs + powderKg * gasVelocityMs;

    // Recoil Velocity: V_r = I / M_rifle
    const recoilVelMs = impulseNs / rifleKg;
    const recoilVelFps = recoilVelMs * 3.28084;

    // Free Recoil Energy: E = 0.5 * M_rifle * V_r^2
    const recoilEnergyJ = 0.5 * rifleKg * Math.pow(recoilVelMs, 2);
    const recoilEnergyFtLb = recoilEnergyJ * 0.737562;

    let severity = 'Mild / Moderate (PRS Match Standard)';
    let badgeClass = 'text-cyan';
    if (recoilEnergyFtLb > 35) {
      severity = 'Heavy Magnum / Punishing';
      badgeClass = 'text-amber';
    } else if (recoilEnergyFtLb < 10) {
      severity = 'Very Light / Varmint';
      badgeClass = 'text-emerald';
    }

    const out = this.container.querySelector('#recoil-results');
    if (!out) return;

    out.innerHTML = `
      <div class="stat-card highlight-cyan">
        <span class="stat-label">FREE RECOIL ENERGY</span>
        <span class="stat-val">${recoilEnergyJ.toFixed(1)} Joules</span>
        <span class="stat-sub">${recoilEnergyFtLb.toFixed(1)} ft-lb</span>
      </div>
      <div class="stat-card highlight-amber">
        <span class="stat-label">RECOIL VELOCITY</span>
        <span class="stat-val">${recoilVelMs.toFixed(2)} m/s</span>
        <span class="stat-sub">${recoilVelFps.toFixed(2)} fps</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">MOMENTUM IMPULSE</span>
        <span class="stat-val">${impulseNs.toFixed(2)} N·s</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">SEVERITY RATING</span>
        <span class="stat-val ${badgeClass}">${severity}</span>
      </div>
    `;
  }

  render() {
    let toolHtml = '';
    switch (this.activeTool) {
      case 'wez':
        toolHtml = this.renderWez();
        break;
      case 'group':
        toolHtml = this.renderGroupAnalyzer();
        break;
      case 'chrono':
        toolHtml = this.renderChrono();
        break;
      case 'milling':
        toolHtml = this.renderMilling();
        break;
      case 'recoil':
        toolHtml = this.renderRecoil();
        break;
      case 'truing':
      default:
        toolHtml = this.renderTruingWizard();
        break;
    }

    this.container.innerHTML = `
      <div class="tools-header">
        <div>
          <h2>Precision Ballistic Tools & Utilities</h2>
          <p class="subtitle">Calibration solvers, chronograph statistics, optical range estimation, and target dispersion analysis</p>
        </div>
        <div class="format-button-group">
          <button class="btn-tool ${this.activeTool === 'truing' ? 'active' : ''}" data-tool="truing">🎯 Truing Wizard</button>
          <button class="btn-tool ${this.activeTool === 'wez' ? 'active' : ''}" data-tool="wez">🎲 WEZ Monte Carlo</button>
          <button class="btn-tool ${this.activeTool === 'group' ? 'active' : ''}" data-tool="group">📐 Target Group Analyzer</button>
          <button class="btn-tool ${this.activeTool === 'chrono' ? 'active' : ''}" data-tool="chrono">⏱️ Chronograph SD/ES</button>
          <button class="btn-tool ${this.activeTool === 'milling' ? 'active' : ''}" data-tool="milling">🔭 Milling / Ranging</button>
          <button class="btn-tool ${this.activeTool === 'recoil' ? 'active' : ''}" data-tool="recoil">💥 Free Recoil Energy</button>
        </div>
      </div>

      <div class="tool-content-area">
        ${toolHtml}
      </div>
    `;

    // Tool switcher buttons
    const toolBtns = this.container.querySelectorAll('.btn-tool');
    toolBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTool(btn.dataset.tool);
      });
    });

    if (this.activeTool === 'wez') {
      this.initWez();
    } else if (this.activeTool === 'group') {
      this.initGroupCanvas();
    }

    // Truing Wizard events
    const calcMvBtn = this.container.querySelector('#btn-calc-trued-mv');
    calcMvBtn?.addEventListener('click', () => {
      const dist = parseFloat(this.container.querySelector('#true-mv-dist').value);
      const dial = parseFloat(this.container.querySelector('#true-mv-dial').value);
      const profile = appState.getActiveProfile();
      const env = appState.getActiveEnvironment();
      const atmos = getAtmosphericConditions({
        pressurePa: env.pressureHpa * 100,
        tempK: env.temperatureC + 273.15,
        relativeHumidity: env.humidityPercent / 100,
        altitudeM: env.altitudeM,
      });

      const res = trueMuzzleVelocity({
        profile,
        environment: env,
        airDensity: atmos.densityKgM3,
        speedOfSound: atmos.speedOfSoundMs,
        observedDistanceM: dist,
        observedDropMrad: dial,
      });

      const out = this.container.querySelector('#trued-mv-result');
      if (out) {
        out.innerHTML = `
          <div class="callout-box">
            <strong>${res.message}</strong>
            <p>Original: ${res.originalMv} m/s | Calibrated: <span class="text-cyan">${res.calibratedMv} m/s</span></p>
            <button id="btn-apply-trued-mv" class="btn-primary-sm mt-2" data-mv="${res.calibratedMv}">Apply Calibrated MV to Profile</button>
          </div>
        `;
        out.querySelector('#btn-apply-trued-mv')?.addEventListener('click', () => {
          appState.updateActiveProfile({ muzzleVelocityMs: res.calibratedMv, zeroAngleRad: null });
          alert(`Applied calibrated MV of ${res.calibratedMv} m/s to active profile!`);
        });
      }
    });

    const calcDsfBtn = this.container.querySelector('#btn-calc-trued-dsf');
    calcDsfBtn?.addEventListener('click', () => {
      const dist = parseFloat(this.container.querySelector('#true-dsf-dist').value);
      const dial = parseFloat(this.container.querySelector('#true-dsf-dial').value);
      const profile = appState.getActiveProfile();
      const env = appState.getActiveEnvironment();
      const atmos = getAtmosphericConditions({
        pressurePa: env.pressureHpa * 100,
        tempK: env.temperatureC + 273.15,
        relativeHumidity: env.humidityPercent / 100,
        altitudeM: env.altitudeM,
      });

      const res = trueDropScaleFactor({
        profile,
        environment: env,
        airDensity: atmos.densityKgM3,
        speedOfSound: atmos.speedOfSoundMs,
        observedDistanceM: dist,
        observedDropMrad: dial,
      });

      const out = this.container.querySelector('#trued-dsf-result');
      if (out) {
        out.innerHTML = `
          <div class="callout-box">
            <strong>${res.message}</strong>
            <p>Drop Scale Factor: <span class="text-amber">${res.calibratedDsf}</span> (${res.deltaPercent > 0 ? '+' : ''}${res.deltaPercent}%)</p>
          </div>
        `;
      }
    });

    // Chrono events
    this.container.querySelector('#btn-calc-chrono')?.addEventListener('click', () => this.calcChrono());

    // Milling events
    const millPreset = this.container.querySelector('#milling-preset');
    const millSize = this.container.querySelector('#milling-size-mm');
    const millMils = this.container.querySelector('#milling-mils');

    millPreset?.addEventListener('change', (e) => {
      if (millSize) millSize.value = e.target.value;
      this.calcMilling();
    });
    millSize?.addEventListener('input', () => this.calcMilling());
    millMils?.addEventListener('input', () => this.calcMilling());

    // Recoil events
    this.container.querySelector('#btn-calc-recoil')?.addEventListener('click', () => this.calcRecoil());
    if (this.activeTool === 'recoil') this.calcRecoil();
  }
}
