/**
 * Ballistic Workbench - Workspace Module (Ballistic Command Center)
 * Implements the 3-panel command center with real-time recalculation,
 * Reticle simulator, Interactive Turret Knob, Multi-Tab chart,
 * and Configurable DOPE Trajectory table.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory } from '../physics/solvers.js';
import { BallisticChart } from '../canvas/charts.js';
import { ReticleRenderer } from '../canvas/reticle.js';
import { TurretKnob } from '../canvas/turret.js';
import { WindRoseVisualizer } from '../canvas/windRose.js';
import { RifleBuilderModal } from './rifleBuilderModal.js';

export class WorkspaceView {
  constructor(containerElement) {
    this.container = containerElement;
    this.chart = null;
    this.reticle = null;
    this.turret = null;
    this.windRose = null;
    this.activeSolution = null;

    // Configurable table columns
    this.visibleColumns = new Set([
      'range',
      'drop',
      'elevation',
      'elevClicks',
      'drift',
      'wind',
      'windClicks',
      'velocity',
      'mach',
      'energy',
      'tof',
      'danger',
    ]);

    // Selected ranges for transfer to DOPE Studio
    this.selectedRanges = new Set();

    this.render();
    this.initVisualizers();
    this.recompute();

    // Subscribe to state updates
    this.unsubscribe = appState.subscribe((state, changeKey) => {
      if (
        changeKey === 'units' ||
        changeKey === 'displayUnits' ||
        changeKey === 'profiles' ||
        changeKey === 'activeProfile' ||
        changeKey === 'activeEnvironment'
      ) {
        this.render();
        this.initVisualizers();
        if (this.reticle?.bindEvents) this.reticle.bindEvents();
      }
      this.recompute();
    });
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.chart?.destroy) this.chart.destroy();
    if (this.reticle?.destroy) this.reticle.destroy();
    if (this.turret?.destroy) this.turret.destroy();
  }

  initVisualizers() {
    const chartCanvas = this.container.querySelector('#chart-canvas');
    if (chartCanvas) {
      this.chart = new BallisticChart(chartCanvas, {
        activeTab: 'drop',
        systemUnits: appState.state.systemUnits,
        displayUnits: appState.state.displayUnits,
        onHover: (distM) => this._handleChartHover(distM),
      });
    }

    const reticleCanvas = this.container.querySelector('#reticle-canvas');
    if (reticleCanvas) {
      const profile = appState.getActiveProfile();
      this.reticle = new ReticleRenderer(reticleCanvas, {
        reticleType: profile.optic?.reticle || 'EBR-8 MRAD',
        focalPlane: profile.optic?.focalPlane || 'FFP',
        magnification: profile.optic?.currentMagnification || 15,
        targetDistanceM: appState.state.target.distanceM,
        targetShape: appState.state.target.targetShape,
        targetWidthCm: appState.state.target.targetSizeWidthCm,
        targetHeightCm: appState.state.target.targetSizeHeightCm,
      });
    }

    const turretCanvas = this.container.querySelector('#turret-canvas');
    if (turretCanvas) {
      const profile = appState.getActiveProfile();
      const isMrad = appState.state.displayUnits.elevationAngle === 'MRAD';
      this.turret = new TurretKnob(turretCanvas, {
        clicks: profile.optic?.zeroElevationClicks || 0,
        clickValueRad: profile.optic?.clickValueRad || 0.0001,
        clickName: profile.optic?.clickName || '0.1 MRAD',
        isMrad,
        onChange: (dialClicks) => {
          if (profile.optic) {
            profile.optic.zeroElevationClicks = dialClicks;
          }
          if (this.reticle) {
            this.reticle.update({ elevationDialClicks: dialClicks });
          }
          this._updateTurretReadout(dialClicks);
        },
      });
    }

    const windCanvas = this.container.querySelector('#wind-clock-canvas');
    if (windCanvas) {
      const env = appState.getActiveEnvironment();
      this.windRose = new WindRoseVisualizer(windCanvas, {
        windSpeedMs: env.windSpeedMs,
        windDirectionDeg: env.windDirectionDeg,
        windSpeedUnit: appState.state.displayUnits.windSpeed,
        onChange: ({ windDirectionDeg, windSpeedMs }) => {
          appState.updateActiveEnvironment({ windDirectionDeg, windSpeedMs });
        },
      });
    }
  }

  _handleChartHover(distM) {
    if (distM === null) {
      const rows = this.container.querySelectorAll('.traj-row');
      rows.forEach((r) => r.classList.remove('highlight-row'));
      return;
    }
    const rows = this.container.querySelectorAll('.traj-row');
    let closestRow = null;
    let minDiff = Infinity;
    rows.forEach((row) => {
      const rowDist = parseFloat(row.dataset.dist);
      const diff = Math.abs(rowDist - distM);
      if (diff < minDiff) {
        minDiff = diff;
        closestRow = row;
      }
      row.classList.remove('highlight-row');
    });
    if (closestRow && minDiff < 50) {
      closestRow.classList.add('highlight-row');
    }
  }

  _updateTurretReadout(dialClicks) {
    const profile = appState.getActiveProfile();
    const isMrad = appState.state.displayUnits.elevationAngle === 'MRAD';
    const clickValRad = profile.optic?.clickValueRad || 0.0001;

    const dialedMrad = dialClicks * clickValRad * 1000;
    const dialedVal = isMrad ? dialedMrad : dialedMrad * ((180 * 60) / (Math.PI * 1000));

    const valEl = this.container.querySelector('#turret-dialed-val');
    const clicksEl = this.container.querySelector('#turret-dialed-clicks');
    const unitEl = this.container.querySelector('#turret-dialed-unit');

    if (valEl) valEl.textContent = dialedVal.toFixed(1);
    if (clicksEl) clicksEl.textContent = `(${dialClicks} clicks)`;
    if (unitEl) unitEl.textContent = isMrad ? 'MRAD' : 'MOA';
  }

  recompute() {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const target = appState.state.target;
    const config = appState.state.solverConfig;
    const sysUnits = appState.state.systemUnits;
    const dispUnits = appState.state.displayUnits;
    const isMrad = dispUnits.elevationAngle === 'MRAD';

    // 1. Atmosphere
    const atmos = getAtmosphericConditions({
      pressurePa: env.pressureHpa * 100,
      tempK: env.temperatureC + 273.15,
      relativeHumidity: env.humidityPercent / 100,
      altitudeM: env.altitudeM,
    });

    // 2. Trajectory Integration
    const solution = solveTrajectory({
      profile,
      environment: env,
      airDensity: atmos.densityKgM3,
      speedOfSound: atmos.speedOfSoundMs,
      algorithm: config.activeAlgorithm,
      stepM: config.stepM,
      maxRangeM: config.maxRangeM,
    });
    this.activeSolution = solution;

    // 3. Find target point
    const targetPoint = solution.trajectory.reduce((prev, curr) =>
      Math.abs(curr.distanceM - target.distanceM) < Math.abs(prev.distanceM - target.distanceM) ? curr : prev
    );

    // 4. Update Telemetry HUD
    this._updateTelemetryHud(solution, targetPoint, atmos, sysUnits, dispUnits);

    // 5. Update Reticle Visualizer
    if (this.reticle) {
      this.reticle.update({
        reticleType: profile.optic?.reticle || 'EBR-8 MRAD',
        focalPlane: profile.optic?.focalPlane || 'FFP',
        magnification: profile.optic?.currentMagnification || 15,
        targetDistanceM: target.distanceM,
        targetShape: target.targetShape,
        targetWidthCm: target.targetSizeWidthCm,
        targetHeightCm: target.targetSizeHeightCm,
        elevationHoldMrad: targetPoint.elevationMrad,
        windageHoldMrad: targetPoint.windageMrad,
        elevationDialClicks: profile.optic?.zeroElevationClicks || 0,
        windageDialClicks: profile.optic?.zeroWindageClicks || 0,
        clickValueRad: profile.optic?.clickValueRad || 0.0001,
        isMrad,
      });
    }

    // 6. Update Turret Knob
    if (this.turret) {
      this.turret.update({
        clicks: profile.optic?.zeroElevationClicks || 0,
        clickValueRad: profile.optic?.clickValueRad || 0.0001,
        clickName: profile.optic?.clickName || '0.1 MRAD',
        isMrad,
        targetClicks: targetPoint.elevationClicks,
      });
      this._updateTurretReadout(profile.optic?.zeroElevationClicks || 0);

      const targetNeededEl = this.container.querySelector('#turret-target-needed');
      const targetUnitEl = this.container.querySelector('#turret-target-unit');
      if (targetNeededEl) {
        const elVal = isMrad ? targetPoint.elevationMrad : targetPoint.elevationMoa;
        targetNeededEl.textContent = `${elVal.toFixed(1)} (${targetPoint.elevationClicks} clicks)`;
      }
      if (targetUnitEl) targetUnitEl.textContent = isMrad ? 'MRAD' : 'MOA';
    }

    // 7. Update Chart
    if (this.chart) {
      this.chart.setUnits(sysUnits, dispUnits);
      this.chart.setData(solution.trajectory, {
        ...solution.telemetry,
        zeroDistanceM: profile.zeroDistanceM,
      });
    }

    // 8. Update Wind Clock
    if (this.windRose) {
      this.windRose.update({
        windSpeedMs: env.windSpeedMs,
        windDirectionDeg: env.windDirectionDeg,
        windSpeedUnit: dispUnits.windSpeed,
      });
    }

    // 9. Render Trajectory Table
    this._renderTrajectoryTable(solution.trajectory, target.distanceM, sysUnits, dispUnits);
  }

  _updateTelemetryHud(solution, targetPoint, atmos, sysUnits, dispUnits) {
    const hud = this.container.querySelector('#telemetry-hud');
    if (!hud) return;

    const isMetric = sysUnits === 'metric';
    const isMrad = dispUnits.elevationAngle === 'MRAD';

    const elVal = isMrad ? targetPoint.elevationMrad : targetPoint.elevationMoa;
    const elUnit = isMrad ? 'MRAD' : 'MOA';

    const windVal = isMrad ? Math.abs(targetPoint.windageMrad) : Math.abs(targetPoint.windageMoa);
    const windUnit = isMrad ? 'MRAD' : 'MOA';
    const windDirSign = targetPoint.windageMrad >= 0 ? '▶ R' : '◀ L';

    const velVal = isMetric ? targetPoint.velocityMs : targetPoint.velocityMs * 3.28084;
    const velUnit = isMetric ? 'm/s' : 'fps';

    const energyVal = isMetric ? targetPoint.energyJ : targetPoint.energyJ * 0.737562;
    const energyUnit = isMetric ? 'J' : 'ft-lb';

    const distVal = dispUnits.distance === 'yd' ? Math.round(targetPoint.distanceM * 1.09361) : targetPoint.distanceM;
    const distUnit = dispUnits.distance;

    hud.innerHTML = `
      <div class="telemetry-card highlight-cyan">
        <div class="card-label">TARGET ELEVATION</div>
        <div class="card-value">${elVal.toFixed(2)} <span class="card-unit">${elUnit}</span></div>
        <div class="card-subtext">${targetPoint.elevationClicks} clicks (${dispUnits.clickName || '0.1 MRAD'})</div>
      </div>
      <div class="telemetry-card highlight-amber">
        <div class="card-label">WINDAGE CORRECTION</div>
        <div class="card-value">${windVal.toFixed(2)} <span class="card-unit">${windUnit} ${windDirSign}</span></div>
        <div class="card-subtext">${Math.abs(targetPoint.windageClicks)} clicks into wind</div>
      </div>
      <div class="telemetry-card">
        <div class="card-label">VELOCITY @ ${distVal}${distUnit}</div>
        <div class="card-value">${Math.round(velVal)} <span class="card-unit">${velUnit}</span></div>
        <div class="card-subtext">Mach ${targetPoint.mach.toFixed(2)} (${targetPoint.mach >= 1.2 ? 'Supersonic' : targetPoint.mach >= 1.0 ? 'Transonic' : 'Subsonic'})</div>
      </div>
      <div class="telemetry-card">
        <div class="card-label">FLIGHT TIME & ENERGY</div>
        <div class="card-value">${targetPoint.tofS.toFixed(3)} <span class="card-unit">s</span></div>
        <div class="card-subtext">${Math.round(energyVal)} ${energyUnit} kinetic energy</div>
      </div>
      <div class="telemetry-card">
        <div class="card-label">SUPERSONIC BOUNDARY</div>
        <div class="card-value">${dispUnits.distance === 'yd' ? Math.round(solution.telemetry.supersonicRangeM * 1.09361) : solution.telemetry.supersonicRangeM} <span class="card-unit">${distUnit}</span></div>
        <div class="card-subtext">Transonic limit: ${dispUnits.distance === 'yd' ? Math.round(solution.telemetry.transonicRangeM * 1.09361) : solution.telemetry.transonicRangeM} ${distUnit}</div>
      </div>
      <div class="telemetry-card">
        <div class="card-label">DENSITY ALTITUDE (DA)</div>
        <div class="card-value">${Math.round(dispUnits.distance === 'yd' ? atmos.densityAltitudeM * 3.28084 : atmos.densityAltitudeM)} <span class="card-unit">${dispUnits.distance === 'yd' ? 'ft' : 'm'}</span></div>
        <div class="card-subtext">Air density: ${atmos.densityKgM3.toFixed(3)} kg/m³</div>
      </div>
    `;
  }

  _renderTrajectoryTable(trajectory, targetDistM, sysUnits, dispUnits) {
    const thead = this.container.querySelector('#trajectory-thead');
    const cols = this.visibleColumns;

    if (thead) {
      let thHtml = '<tr>';
      if (cols.has('range')) thHtml += `<th><input type="checkbox" id="chk-select-all-ranges" title="Select all ranges" ${this.selectedRanges.size >= trajectory.length ? 'checked' : ''} /> Range (${dispUnits.distance})</th>`;
      if (cols.has('drop')) thHtml += `<th>Drop (${dispUnits.dropOffset})</th>`;
      if (cols.has('elevation')) thHtml += `<th>Elev (${dispUnits.elevationAngle})</th>`;
      if (cols.has('elevClicks')) thHtml += `<th>Clicks</th>`;
      if (cols.has('drift')) thHtml += `<th>Drift (${dispUnits.windDriftOffset})</th>`;
      if (cols.has('wind')) thHtml += `<th>Wind (${dispUnits.windageAngle})</th>`;
      if (cols.has('windClicks')) thHtml += `<th>Clicks</th>`;
      if (cols.has('velocity')) thHtml += `<th>Vel (${dispUnits.velocity})</th>`;
      if (cols.has('mach')) thHtml += `<th>Mach</th>`;
      if (cols.has('energy')) thHtml += `<th>Energy (${dispUnits.energy})</th>`;
      if (cols.has('tof')) thHtml += `<th>ToF</th>`;
      if (cols.has('danger')) thHtml += `<th>Danger (${dispUnits.distance})</th>`;
      thHtml += '</tr>';
      thead.innerHTML = thHtml;
    }

    const tbody = this.container.querySelector('#trajectory-tbody');
    if (!tbody) return;

    const isMetric = sysUnits === 'metric';
    const distUnit = dispUnits.distance;
    const isMrad = dispUnits.elevationAngle === 'MRAD';

    // If selected ranges is empty initially, select all ranges by default
    if (this.selectedRanges.size === 0) {
      trajectory.forEach((p) => this.selectedRanges.add(p.distanceM));
    }

    let html = '';
    for (const pt of trajectory) {
      const isTarget = Math.abs(pt.distanceM - targetDistM) < 12.5;
      const isZero = pt.distanceM === appState.getActiveProfile().zeroDistanceM;
      const isChecked = this.selectedRanges.has(pt.distanceM);

      const rowClass = isTarget ? 'traj-row target-row' : isZero ? 'traj-row zero-row' : 'traj-row';

      const dispDist = distUnit === 'yd' ? Math.round(pt.distanceM * 1.09361) : pt.distanceM;
      const dropLin = isMetric ? (pt.dropM * 100).toFixed(1) : (pt.dropM * 39.3701).toFixed(1);

      const elAngle = isMrad ? pt.elevationMrad.toFixed(2) : pt.elevationMoa.toFixed(2);
      const windAngle = isMrad ? Math.abs(pt.windageMrad).toFixed(2) : Math.abs(pt.windageMoa).toFixed(2);
      const windLin = isMetric ? (Math.abs(pt.driftM) * 100).toFixed(1) : (Math.abs(pt.driftM) * 39.3701).toFixed(1);

      const vel = isMetric ? Math.round(pt.velocityMs) : Math.round(pt.velocityMs * 3.28084);
      const energy = isMetric ? Math.round(pt.energyJ) : Math.round(pt.energyJ * 0.737562);
      const dangerSpace = distUnit === 'yd' ? Math.round(pt.dangerSpaceM * 1.09361) : Math.round(pt.dangerSpaceM);

      const machClass =
        pt.mach >= 1.2 ? 'badge-mach-supersonic' : pt.mach >= 1.0 ? 'badge-mach-transonic' : 'badge-mach-subsonic';

      html += `<tr class="${rowClass}" data-dist="${pt.distanceM}">`;
      if (cols.has('range')) html += `<td class="font-bold"><input type="checkbox" class="chk-range-select" data-dist="${pt.distanceM}" ${isChecked ? 'checked' : ''} /> ${dispDist} ${isZero ? '🎯' : isTarget ? '📍' : ''}</td>`;
      if (cols.has('drop')) html += `<td>${dropLin}</td>`;
      if (cols.has('elevation')) html += `<td class="font-semibold text-cyan">${elAngle}</td>`;
      if (cols.has('elevClicks')) html += `<td>${pt.elevationClicks}</td>`;
      if (cols.has('drift')) html += `<td>${windLin}</td>`;
      if (cols.has('wind')) html += `<td class="font-semibold text-amber">${windAngle}</td>`;
      if (cols.has('windClicks')) html += `<td>${Math.abs(pt.windageClicks)}</td>`;
      if (cols.has('velocity')) html += `<td>${vel}</td>`;
      if (cols.has('mach')) html += `<td><span class="badge ${machClass}">${pt.mach.toFixed(2)}</span></td>`;
      if (cols.has('energy')) html += `<td>${energy}</td>`;
      if (cols.has('tof')) html += `<td>${pt.tofS.toFixed(3)}s</td>`;
      if (cols.has('danger')) html += `<td>${dangerSpace}</td>`;
      html += '</tr>';
    }
    tbody.innerHTML = html;

    this._bindTableSelectionEvents(trajectory);
  }

  _bindTableSelectionEvents(trajectory) {
    // Select All Checkbox
    const chkAll = this.container.querySelector('#chk-select-all-ranges');
    chkAll?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      this.selectedRanges.clear();
      if (checked) {
        trajectory.forEach((p) => this.selectedRanges.add(p.distanceM));
      }
      const itemChecks = this.container.querySelectorAll('.chk-range-select');
      itemChecks.forEach((chk) => (chk.checked = checked));
      this._updateSelectedRangesCount();
    });

    // Individual Range Checkboxes
    const itemChecks = this.container.querySelectorAll('.chk-range-select');
    itemChecks.forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const dist = parseFloat(chk.dataset.dist);
        if (e.target.checked) {
          this.selectedRanges.add(dist);
        } else {
          this.selectedRanges.delete(dist);
        }
        if (chkAll) {
          chkAll.checked = this.selectedRanges.size >= trajectory.length;
        }
        this._updateSelectedRangesCount();
      });
    });

    this._updateSelectedRangesCount();
  }

  _updateSelectedRangesCount() {
    const countEl = this.container.querySelector('#selected-ranges-count');
    if (countEl) countEl.textContent = `${this.selectedRanges.size}`;
  }

  exportCsv() {
    if (!this.activeSolution) return;
    const traj = this.activeSolution.trajectory;
    const headers = [
      'Distance (m)',
      'Drop (m)',
      'Elevation (MRAD)',
      'Elevation Clicks',
      'Wind Drift (m)',
      'Windage (MRAD)',
      'Windage Clicks',
      'Velocity (m/s)',
      'Mach',
      'Energy (J)',
      'ToF (s)',
      'Danger Space (m)',
    ];
    const rows = traj.map((p) => [
      p.distanceM,
      p.dropM.toFixed(3),
      p.elevationMrad.toFixed(2),
      p.elevationClicks,
      p.driftM.toFixed(3),
      p.windageMrad.toFixed(2),
      p.windageClicks,
      p.velocityMs.toFixed(1),
      p.mach.toFixed(2),
      p.energyJ.toFixed(0),
      p.tofS.toFixed(3),
      p.dangerSpaceM.toFixed(1),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ballistic_trajectory_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  render() {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const target = appState.state.target;
    const config = appState.state.solverConfig;
    const isImp = appState.state.systemUnits === 'imperial';
    const isMrad = appState.state.displayUnits.elevationAngle === 'MRAD';
    const clickUnitName = isMrad ? '0.1' : '0.25';

    // Display formatted values according to active units
    const targetDistDisp = isImp ? Math.round(target.distanceM * 1.09361) : target.distanceM;
    const targetDistUnit = isImp ? 'yd' : 'm';
    const mvDisp = isImp ? Math.round(profile.muzzleVelocityMs * 3.28084) : Math.round(profile.muzzleVelocityMs);
    const mvUnit = isImp ? 'fps' : 'm/s';
    const shDisp = isImp ? (profile.sightHeightM * 39.3701).toFixed(2) : (profile.sightHeightM * 100).toFixed(1);
    const shUnit = isImp ? 'in' : 'cm';
    const zeroDisp = isImp ? Math.round(profile.zeroDistanceM * 1.09361) : profile.zeroDistanceM;
    const zeroUnit = isImp ? 'yd' : 'm';
    const tempDisp = isImp ? Math.round((env.temperatureC * 9) / 5 + 32) : env.temperatureC;
    const tempUnit = isImp ? '°F' : '°C';
    const pressDisp = isImp ? (env.pressureHpa * 0.02953).toFixed(2) : env.pressureHpa;
    const pressUnit = isImp ? 'inHg' : 'hPa';
    const altDisp = isImp ? Math.round(env.altitudeM * 3.28084) : env.altitudeM;
    const altUnit = isImp ? 'ft' : 'm';
    const windSpeedDisp = isImp ? (env.windSpeedMs * 2.23694).toFixed(1) : env.windSpeedMs;
    const windSpeedUnit = isImp ? 'mph' : 'm/s';

    this.container.innerHTML = `
      <!-- TOP TELEMETRY HUD -->
      <section id="telemetry-hud" class="telemetry-grid"></section>

      <!-- 3-PANEL COMMAND CENTER LAYOUT -->
      <div class="workspace-grid">
        <!-- LEFT PANEL: CONTROLS & PARAMETERS -->
        <aside class="panel workspace-sidebar">
          <div class="panel-header">
            <h3>Rifle & Environment Setup</h3>
            <div class="panel-actions">
              <select id="profile-select" class="form-select-sm" title="Active Rifle Setup">
                ${appState.state.profiles.map((p) => `<option value="${p.id}" ${p.id === profile.id ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
              <button id="btn-quick-add-rifle" class="btn-accent-sm" title="Build & Save New Rifle Rig">➕ New</button>
            </div>
          </div>

          <div class="sidebar-scrollable">
            <!-- Target Card -->
            <fieldset class="param-card">
              <legend>Target Solution Range</legend>
              <div class="field-row">
                <label>Target Range</label>
                <div class="range-slider-group">
                  <input type="range" id="target-range-slider" min="${isImp ? 50 : 50}" max="${isImp ? 1600 : 1500}" step="${isImp ? 25 : 25}" value="${targetDistDisp}" />
                  <span id="target-range-display" class="badge-value">${targetDistDisp} ${targetDistUnit}</span>
                </div>
              </div>
              <div class="field-grid-2">
                <div>
                  <label>Target Shape</label>
                  <select id="target-shape-select" class="form-select">
                    <option value="ipsc" ${target.targetShape === 'ipsc' ? 'selected' : ''}>IPSC Torso (45x75cm)</option>
                    <option value="circle" ${target.targetShape === 'circle' ? 'selected' : ''}>Round Gong (30cm)</option>
                    <option value="square" ${target.targetShape === 'square' ? 'selected' : ''}>Square Plate (30x30cm)</option>
                    <option value="nato-e" ${target.targetShape === 'nato-e' ? 'selected' : ''}>NATO E-Type Silhouette</option>
                  </select>
                </div>
                <div>
                  <label>Target Speed</label>
                  <input type="number" id="target-speed-input" class="form-input" min="0" max="60" value="${target.targetSpeedKmh || 0}" placeholder="km/h" />
                </div>
              </div>
            </fieldset>

            <!-- Ammo & Projectile Card -->
            <fieldset class="param-card">
              <legend>Ammo & Ballistics</legend>
              <div class="field-row">
                <label>Muzzle Velocity (${mvUnit})</label>
                <input type="number" id="mv-input" class="form-input" min="${isImp ? 600 : 200}" max="${isImp ? 4500 : 1500}" step="1" value="${mvDisp}" />
              </div>
              <div class="field-grid-2">
                <div>
                  <label>Bullet Weight (gr)</label>
                  <input type="number" id="weight-input" class="form-input" min="20" max="1000" value="${profile.bullet.weightGr}" />
                </div>
                <div>
                  <label>Ballistic Coeff (${profile.bullet.dragModel})</label>
                  <input type="number" id="bc-input" class="form-input" min="0.05" max="1.5" step="0.005" value="${profile.bullet.dragModel === 'G1' ? profile.bullet.bcG1 : profile.bullet.bcG7}" />
                </div>
              </div>
              <div class="field-grid-2">
                <div>
                  <label>Sight Height (${shUnit})</label>
                  <input type="number" id="sh-input" class="form-input" min="${isImp ? 0.5 : 1}" max="${isImp ? 6 : 15}" step="${isImp ? 0.05 : 0.1}" value="${shDisp}" />
                </div>
                <div>
                  <label>Zero Distance (${zeroUnit})</label>
                  <input type="number" id="zero-input" class="form-input" min="${isImp ? 25 : 25}" max="${isImp ? 350 : 300}" step="${isImp ? 25 : 25}" value="${zeroDisp}" />
                </div>
              </div>
              <div class="field-grid-2">
                <div>
                  <label>Twist Rate (1 in X")</label>
                  <input type="number" id="twist-input" class="form-input" min="5" max="18" step="0.5" value="${profile.twistRateIn}" />
                </div>
                <div>
                  <label>Drag Model</label>
                  <select id="drag-model-select" class="form-select">
                    <option value="G7" ${profile.bullet.dragModel === 'G7' ? 'selected' : ''}>G7 (Boat-tail)</option>
                    <option value="G1" ${profile.bullet.dragModel === 'G1' ? 'selected' : ''}>G1 (Flat-base)</option>
                    <option value="DOPPLER" ${profile.bullet.dragModel === 'DOPPLER' ? 'selected' : ''}>Custom Doppler Radar</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <!-- Atmosphere Card -->
            <fieldset class="param-card">
              <legend>Atmospheric Environment</legend>
              <div class="field-grid-2">
                <div>
                  <label>Temperature (${tempUnit})</label>
                  <input type="number" id="temp-input" class="form-input" min="${isImp ? -40 : -40}" max="${isImp ? 140 : 60}" step="1" value="${tempDisp}" />
                </div>
                <div>
                  <label>Pressure (${pressUnit})</label>
                  <input type="number" id="press-input" class="form-input" min="${isImp ? 20 : 700}" max="${isImp ? 33 : 1100}" step="${isImp ? 0.01 : 1}" value="${pressDisp}" />
                </div>
              </div>
              <div class="field-grid-2">
                <div>
                  <label>Altitude (${altUnit})</label>
                  <input type="number" id="alt-input" class="form-input" min="0" max="${isImp ? 16000 : 5000}" step="${isImp ? 100 : 50}" value="${altDisp}" />
                </div>
                <div>
                  <label>Humidity (%)</label>
                  <input type="number" id="hum-input" class="form-input" min="0" max="100" step="5" value="${env.humidityPercent}" />
                </div>
              </div>
              <div class="field-grid-2">
                <div>
                  <label>Inclination (°)</label>
                  <input type="number" id="inc-input" class="form-input" min="-60" max="60" step="1" value="${env.inclinationDeg || 0}" />
                </div>
                <div>
                  <label>Rifle Cant (°)</label>
                  <input type="number" id="cant-input" class="form-input" min="-45" max="45" step="1" value="${env.cantDeg || 0}" />
                </div>
              </div>
            </fieldset>

            <!-- Wind Clock Card -->
            <fieldset class="param-card">
              <legend>Tactical Wind Clock</legend>
              <div class="wind-clock-wrapper">
                <canvas id="wind-clock-canvas" width="220" height="220"></canvas>
              </div>
              <div class="field-grid-2 mt-2">
                <div>
                  <label>Wind Speed (${windSpeedUnit})</label>
                  <input type="number" id="wind-speed-input" class="form-input" min="0" max="${isImp ? 65 : 30}" step="${isImp ? 1 : 0.5}" value="${windSpeedDisp}" />
                </div>
                <div>
                  <label>Wind Angle (°)</label>
                  <input type="number" id="wind-dir-input" class="form-input" min="0" max="360" step="5" value="${env.windDirectionDeg}" />
                </div>
              </div>
            </fieldset>
          </div>
        </aside>

        <!-- CENTER PANEL: RETICLE & MULTI-TAB CHART VISUALIZER -->
        <main class="panel workspace-center">
          <div class="center-subgrid">
            <!-- Reticle Simulator + Turret Knob Card -->
            <div class="subcard reticle-card">
              <div class="subcard-header">
                <h4>Scope Reticle Holdover Simulation & Elevation Turret</h4>
                <div class="reticle-controls">
                  <select id="reticle-type-select" class="form-select-sm" title="Reticle Pattern">
                    <option value="EBR-8 MRAD" ${profile.optic?.reticle === 'EBR-8 MRAD' ? 'selected' : ''}>Vortex EBR-8 MRAD</option>
                    <option value="Kahles SKMR4" ${profile.optic?.reticle === 'Kahles SKMR4' ? 'selected' : ''}>Kahles SKMR4 (PRS)</option>
                    <option value="Leupold PR2-MIL" ${profile.optic?.reticle === 'Leupold PR2-MIL' ? 'selected' : ''}>Leupold PR2-MIL</option>
                    <option value="Mil-XT" ${profile.optic?.reticle === 'Mil-XT' ? 'selected' : ''}>Nightforce Mil-XT</option>
                    <option value="Tremor3" ${profile.optic?.reticle === 'Tremor3' ? 'selected' : ''}>Horus Tremor3</option>
                    <option value="Mil-Dot" ${profile.optic?.reticle === 'Mil-Dot' ? 'selected' : ''}>USMC / Army Mil-Dot</option>
                    <option value="EBR-2C MOA" ${profile.optic?.reticle === 'EBR-2C MOA' ? 'selected' : ''}>Vortex EBR-2C MOA</option>
                    <option value="German #4" ${profile.optic?.reticle === 'German #4' ? 'selected' : ''}>German #4 Hunting</option>
                    <option value="ACSS DMR" ${profile.optic?.reticle === 'ACSS DMR' ? 'selected' : ''}>Primary Arms ACSS DMR</option>
                  </select>
                  <select id="focal-plane-select" class="form-select-sm" title="Focal Plane">
                    <option value="FFP" ${profile.optic?.focalPlane === 'FFP' ? 'selected' : ''}>FFP</option>
                    <option value="SFP" ${profile.optic?.focalPlane === 'SFP' ? 'selected' : ''}>SFP</option>
                  </select>
                  <label class="btn-toggle">
                    <input type="checkbox" id="illum-check" ${this.reticle?.options.illuminated ? 'checked' : ''} />
                    <span>Illum</span>
                  </label>
                </div>
              </div>

              <div class="reticle-workspace-layout reticle-turret-split">
                <div class="reticle-canvas-container">
                  <canvas id="reticle-canvas"></canvas>
                </div>

                <!-- Interactive Turret Knob Panel -->
                <div class="turret-knob-container">
                  <div class="turret-header">
                    <span class="turret-title">ELEVATION TURRET</span>
                    <span class="turret-resolution" id="turret-resolution-label">${profile.optic?.clickName || '0.1 MRAD'}</span>
                  </div>
                  <div class="turret-canvas-wrapper">
                    <canvas id="turret-canvas"></canvas>
                  </div>
                  <div class="turret-controls">
                    <div class="turret-readout">
                      <span id="turret-dialed-val">0.0</span> <span id="turret-dialed-unit">MRAD</span>
                      <span id="turret-dialed-clicks" class="turret-subtext">(0 clicks)</span>
                    </div>
                    <div class="turret-btn-row">
                      <button id="btn-turret-minus-major" class="btn-turret" title="-1.0 ${isMrad ? 'MRAD' : 'MOA'}">-1.0</button>
                      <button id="btn-turret-minus" class="btn-turret" title="-1 Click">-${clickUnitName}</button>
                      <button id="btn-turret-zero" class="btn-turret btn-turret-accent" title="Reset Turret to Zero">ZERO</button>
                      <button id="btn-turret-plus" class="btn-turret" title="+1 Click">+${clickUnitName}</button>
                      <button id="btn-turret-plus-major" class="btn-turret" title="+1.0 ${isMrad ? 'MRAD' : 'MOA'}">+1.0</button>
                    </div>
                    <button id="btn-turret-match-target" class="btn-turret-full" title="Dial directly to match target elevation">
                      🎯 Dial to Target (<span id="turret-target-needed">0.0</span>)
                    </button>
                  </div>
                </div>
              </div>

              <div class="magnification-slider-bar">
                <label>Magnification: <strong id="mag-display">${profile.optic?.currentMagnification || 15}X</strong></label>
                <input type="range" id="mag-slider" min="${profile.optic?.minMagnification || 4}" max="${profile.optic?.maxMagnification || 36}" step="1" value="${profile.optic?.currentMagnification || 15}" />
              </div>
            </div>

            <!-- Multi-Tab Chart Engine -->
            <div class="subcard chart-card">
              <div class="subcard-header">
                <div class="chart-tab-bar">
                  <button class="tab-btn active" data-tab="drop">🎯 Bullet Drop & Path</button>
                  <button class="tab-btn" data-tab="velocity">⚡ Velocity & Mach</button>
                  <button class="tab-btn" data-tab="wind">💨 Wind Drift</button>
                  <button class="tab-btn" data-tab="lead">⏱️ Time of Flight</button>
                  <button class="tab-btn" data-tab="energy">💥 Kinetic Energy</button>
                </div>
              </div>
              <div class="chart-canvas-container">
                <canvas id="chart-canvas"></canvas>
              </div>
            </div>
          </div>
        </main>

        <!-- RIGHT PANEL: CONFIGURABLE TRAJECTORY TABLE -->
        <aside class="panel workspace-table-panel">
          <div class="panel-header">
            <h3>DOPE Trajectory Table</h3>
            <div class="table-actions">
              <details class="column-visibility-dropdown" id="col-picker-details">
                <summary class="btn-secondary-sm" title="Toggle Visible Columns">Columns ⚙️</summary>
                <div class="column-picker-menu">
                  <label><input type="checkbox" data-col="drop" ${this.visibleColumns.has('drop') ? 'checked' : ''} /> Drop (cm/in)</label>
                  <label><input type="checkbox" data-col="elevation" ${this.visibleColumns.has('elevation') ? 'checked' : ''} /> Elevation Angle</label>
                  <label><input type="checkbox" data-col="elevClicks" ${this.visibleColumns.has('elevClicks') ? 'checked' : ''} /> Elev Clicks</label>
                  <label><input type="checkbox" data-col="drift" ${this.visibleColumns.has('drift') ? 'checked' : ''} /> Wind Drift</label>
                  <label><input type="checkbox" data-col="wind" ${this.visibleColumns.has('wind') ? 'checked' : ''} /> Wind Angle</label>
                  <label><input type="checkbox" data-col="windClicks" ${this.visibleColumns.has('windClicks') ? 'checked' : ''} /> Wind Clicks</label>
                  <label><input type="checkbox" data-col="velocity" ${this.visibleColumns.has('velocity') ? 'checked' : ''} /> Velocity</label>
                  <label><input type="checkbox" data-col="mach" ${this.visibleColumns.has('mach') ? 'checked' : ''} /> Mach</label>
                  <label><input type="checkbox" data-col="energy" ${this.visibleColumns.has('energy') ? 'checked' : ''} /> Energy</label>
                  <label><input type="checkbox" data-col="tof" ${this.visibleColumns.has('tof') ? 'checked' : ''} /> ToF</label>
                  <label><input type="checkbox" data-col="danger" ${this.visibleColumns.has('danger') ? 'checked' : ''} /> Danger Space</label>
                </div>
              </details>
              <select id="step-select" class="form-select-sm" title="Integration Step Distance">
                <option value="10" ${config.stepM === 10 ? 'selected' : ''}>10m</option>
                <option value="25" ${config.stepM === 25 ? 'selected' : ''}>25m</option>
                <option value="50" ${config.stepM === 50 ? 'selected' : ''}>50m</option>
                <option value="100" ${config.stepM === 100 ? 'selected' : ''}>100m</option>
              </select>
              <button id="btn-send-to-dope" class="btn-primary-sm" title="Send selected ranges to DOPE Studio">
                📤 DOPE Studio (<span id="selected-ranges-count">0</span>)
              </button>
              <button id="export-csv-btn" class="btn-secondary-sm" title="Export CSV">📥 CSV</button>
            </div>
          </div>

          <div class="table-scrollable">
            <table class="dope-table">
              <thead id="trajectory-thead"></thead>
              <tbody id="trajectory-tbody"></tbody>
            </table>
          </div>
        </aside>
      </div>
    `;

    this._bindFormEvents();
  }

  _bindFormEvents() {
    const isImp = appState.state.systemUnits === 'imperial';

    // Profile Switcher
    const profSel = this.container.querySelector('#profile-select');
    profSel?.addEventListener('change', (e) => {
      appState.setActiveProfile(e.target.value);
      this.render();
      this.initVisualizers();
      if (this.reticle?.bindEvents) this.reticle.bindEvents();
      this.recompute();
    });

    // Quick Add New Rifle Modal Trigger
    const quickAddBtn = this.container.querySelector('#btn-quick-add-rifle');
    quickAddBtn?.addEventListener('click', () => {
      new RifleBuilderModal(() => {
        this.render();
        this.initVisualizers();
        this.recompute();
      }).open();
    });

    // Target Range Slider
    const rangeSlider = this.container.querySelector('#target-range-slider');
    const rangeDisp = this.container.querySelector('#target-range-display');
    rangeSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      rangeDisp.textContent = `${val} ${isImp ? 'yd' : 'm'}`;
      const distM = isImp ? Math.round(val * 0.9144) : val;
      appState.updateTarget({ distanceM: distM });
    });

    // Target Shape & Speed
    const shapeSel = this.container.querySelector('#target-shape-select');
    shapeSel?.addEventListener('change', (e) => {
      appState.updateTarget({ targetShape: e.target.value });
    });
    const speedInput = this.container.querySelector('#target-speed-input');
    speedInput?.addEventListener('input', (e) => {
      appState.updateTarget({ targetSpeedKmh: Number(e.target.value) });
    });

    // Muzzle Velocity
    const mvInput = this.container.querySelector('#mv-input');
    mvInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const mvMs = isImp ? val / 3.28084 : val;
      if (mvMs > 100) appState.updateActiveProfile({ muzzleVelocityMs: Number(mvMs.toFixed(1)), zeroAngleRad: null });
    });

    // Bullet weight & BC
    const wtInput = this.container.querySelector('#weight-input');
    wtInput?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      p.bullet.weightGr = Number(e.target.value);
      appState.notify('profile');
    });
    const bcInput = this.container.querySelector('#bc-input');
    bcInput?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      const val = Number(e.target.value);
      if (p.bullet.dragModel === 'G1') p.bullet.bcG1 = val;
      else p.bullet.bcG7 = val;
      appState.notify('profile');
    });

    // Sight Height & Zero Distance
    const shInput = this.container.querySelector('#sh-input');
    shInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const shM = isImp ? val * 0.0254 : val / 100.0;
      appState.updateActiveProfile({ sightHeightM: shM, zeroAngleRad: null });
    });
    const zeroInput = this.container.querySelector('#zero-input');
    zeroInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const zeroM = isImp ? Math.round(val * 0.9144) : val;
      appState.updateActiveProfile({ zeroDistanceM: zeroM, zeroAngleRad: null });
    });

    // Drag model
    const dragSel = this.container.querySelector('#drag-model-select');
    dragSel?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      p.bullet.dragModel = e.target.value;
      appState.updateSolverConfig({ activeAlgorithm: e.target.value });
    });

    // Atmospheric inputs
    const tempInput = this.container.querySelector('#temp-input');
    tempInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const tempC = isImp ? ((val - 32) * 5) / 9 : val;
      appState.updateActiveEnvironment({ temperatureC: Number(tempC.toFixed(1)) });
    });
    const pressInput = this.container.querySelector('#press-input');
    pressInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const pressHpa = isImp ? val / 0.02953 : val;
      appState.updateActiveEnvironment({ pressureHpa: Number(pressHpa.toFixed(1)) });
    });
    const altInput = this.container.querySelector('#alt-input');
    altInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const altM = isImp ? Math.round(val / 3.28084) : val;
      appState.updateActiveEnvironment({ altitudeM: altM });
    });
    const humInput = this.container.querySelector('#hum-input');
    humInput?.addEventListener('change', (e) => {
      appState.updateActiveEnvironment({ humidityPercent: Number(e.target.value) });
    });
    const incInput = this.container.querySelector('#inc-input');
    incInput?.addEventListener('change', (e) => {
      appState.updateActiveEnvironment({ inclinationDeg: Number(e.target.value) });
    });
    const cantInput = this.container.querySelector('#cant-input');
    cantInput?.addEventListener('change', (e) => {
      appState.updateActiveEnvironment({ cantDeg: Number(e.target.value) });
    });

    // Wind inputs
    const windSpeedInput = this.container.querySelector('#wind-speed-input');
    windSpeedInput?.addEventListener('change', (e) => {
      const val = Number(e.target.value);
      const windMs = isImp ? val / 2.23694 : val;
      appState.updateActiveEnvironment({ windSpeedMs: Number(windMs.toFixed(1)) });
    });
    const windDirInput = this.container.querySelector('#wind-dir-input');
    windDirInput?.addEventListener('change', (e) => {
      appState.updateActiveEnvironment({ windDirectionDeg: Number(e.target.value) });
    });

    // Reticle Controls
    const retTypeSel = this.container.querySelector('#reticle-type-select');
    retTypeSel?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      if (p.optic) p.optic.reticle = e.target.value;
      this.reticle?.update({ reticleType: e.target.value });
    });
    const fpSel = this.container.querySelector('#focal-plane-select');
    fpSel?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      if (p.optic) p.optic.focalPlane = e.target.value;
      this.reticle?.update({ focalPlane: e.target.value });
    });
    const illumCheck = this.container.querySelector('#illum-check');
    illumCheck?.addEventListener('change', (e) => {
      this.reticle?.update({ illuminated: e.target.checked });
    });
    const magSlider = this.container.querySelector('#mag-slider');
    const magDisp = this.container.querySelector('#mag-display');
    magSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      magDisp.textContent = `${val}X`;
      const p = appState.getActiveProfile();
      if (p.optic) p.optic.currentMagnification = val;
      this.reticle?.update({ magnification: val });
    });

    // Turret Controls Buttons
    const btnTurretZero = this.container.querySelector('#btn-turret-zero');
    btnTurretZero?.addEventListener('click', () => {
      this.turret?.setClicks(0);
    });
    const btnTurretPlus = this.container.querySelector('#btn-turret-plus');
    btnTurretPlus?.addEventListener('click', () => {
      this.turret?.adjustClicks(1);
    });
    const btnTurretMinus = this.container.querySelector('#btn-turret-minus');
    btnTurretMinus?.addEventListener('click', () => {
      this.turret?.adjustClicks(-1);
    });
    const profile = appState.getActiveProfile();
    const isMrad = appState.state.displayUnits.elevationAngle === 'MRAD';
    const clickValRad = profile.optic?.clickValueRad || 0.0001;
    // 1.0 MRAD or 1.0 MOA worth of clicks
    const majorClicks = isMrad
      ? Math.max(1, Math.round(0.001 / clickValRad))
      : Math.max(1, Math.round((Math.PI / (180 * 60)) / clickValRad));

    const btnTurretPlusMajor = this.container.querySelector('#btn-turret-plus-major');
    btnTurretPlusMajor?.addEventListener('click', () => {
      this.turret?.adjustClicks(majorClicks);
    });
    const btnTurretMinusMajor = this.container.querySelector('#btn-turret-minus-major');
    btnTurretMinusMajor?.addEventListener('click', () => {
      this.turret?.adjustClicks(-majorClicks);
    });
    const btnTurretMatch = this.container.querySelector('#btn-turret-match-target');
    btnTurretMatch?.addEventListener('click', () => {
      if (this.turret?.options?.targetClicks !== undefined) {
        this.turret.setClicks(this.turret.options.targetClicks);
      }
    });

    // Chart Tabs
    const tabBtns = this.container.querySelectorAll('.tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.chart?.setTab(btn.dataset.tab);
      });
    });

    // Step Selector
    const stepSel = this.container.querySelector('#step-select');
    stepSel?.addEventListener('change', (e) => {
      appState.updateSolverConfig({ stepM: Number(e.target.value) });
    });

    // Column Picker Checkboxes
    const colPickerMenu = this.container.querySelector('.column-picker-menu');
    colPickerMenu?.addEventListener('change', (e) => {
      if (e.target && e.target.dataset.col) {
        const col = e.target.dataset.col;
        if (e.target.checked) {
          this.visibleColumns.add(col);
        } else {
          this.visibleColumns.delete(col);
        }
        if (this.activeSolution) {
          this._renderTrajectoryTable(
            this.activeSolution.trajectory,
            appState.state.target.distanceM,
            appState.state.systemUnits,
            appState.state.displayUnits
          );
        }
      }
    });

    // Send Selected Ranges to DOPE Studio
    const sendDopeBtn = this.container.querySelector('#btn-send-to-dope');
    sendDopeBtn?.addEventListener('click', () => {
      const selected = Array.from(this.selectedRanges).sort((a, b) => a - b);
      if (selected.length > 0) {
        appState.state.customDopeRanges = selected;
      }
      window.dispatchEvent(new CustomEvent('navigate-view', { detail: { view: 'dopeStudio' } }));
      window.location.hash = '#dopeStudio';
    });

    // Export CSV
    const csvBtn = this.container.querySelector('#export-csv-btn');
    csvBtn?.addEventListener('click', () => this.exportCsv());
  }
}
