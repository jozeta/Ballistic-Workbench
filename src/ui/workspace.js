/**
 * Ballistic Workbench - Workspace Module (Ballistic Command Center)
 * Implements the 3-panel command center with real-time recalculation,
 * Reticle simulator, Interactive Turret Knob, Multi-Tab chart,
 * and Configurable DOPE Trajectory table.
 */

import { appState } from '../core/state.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory } from '../physics/solvers.js';
import { ReticleRenderer } from '../canvas/reticle.js';
import { TurretKnob } from '../canvas/turret.js';
import { WindRoseVisualizer } from '../canvas/windRose.js';
import { RifleBuilderModal } from './rifleBuilderModal.js';
import { esc } from '../core/escape.js';
import { interpolateAt } from '../core/trajectory.js';
import { TARGETS, targetOf } from '../core/targets.js';
import { icon } from './icons.js';
import { bindNumber, rangeError, setFieldError, parseNumber } from './fields.js';

const UI_PREFS_KEY = 'ballistic_workbench_solver_ui_v1';

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


    // Ranges ticked for DOPE cards. null = not chosen yet (defaults to every 100 m on first solve)
    this.selectedRanges = null;
    this.illuminated = false;
    this.chartMetric = 'drop';
    // 'auto': the turret follows the solution (target centred, only the wind hold shows);
    // 'manual': the turret stays where the user set it and the reticle shows the remaining hold
    this.turretMode = 'auto';

    // Remembered across re-renders (unit or profile changes rebuild the view)
    this.openSections = new Set(['target', 'load', 'wind']);
    this.activePanel = 'reticle';
    this._loadUiPrefs();

    this.render();
    this.initVisualizers();
    this.recompute();

    // Subscribe to state updates
    this.unsubscribe = appState.subscribe((state, changeKey) => {
      // Table rows move with the units (round metres vs round yards): start the selection afresh
      if (changeKey === 'units') this.selectedRanges = null;
      if (
        changeKey === 'units' ||
        changeKey === 'displayUnits' ||
        changeKey === 'profiles' ||
        changeKey === 'activeProfile' ||
        changeKey === 'activeEnvironment'
      ) {
        this.render();
        this.initVisualizers();
      }
      this.recompute();
    });
  }

  /** Full rebuild (theme change): canvases redraw with the new colours. */
  refresh() {
    this.render();
    this.initVisualizers();
    this.recompute();
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
    this._destroyVisualizers();
  }

  _destroyVisualizers() {
    for (const key of ['chart', 'reticle', 'turret', 'windRose']) {
      this[key]?.destroy?.();
      this[key] = null;
    }
  }

  initVisualizers() {
    // Old instances hold window listeners and observers: release them before building new ones
    this._destroyVisualizers();
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
        illuminated: this.illuminated,
        distanceUnit: appState.state.displayUnits.distance,
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
          if (this._settingTurret) return; // our own update, not the user turning it
          if (this.turretMode !== 'manual') this._setTurretMode('manual', false);
          if (profile.optic) {
            profile.optic.zeroElevationClicks = dialClicks;
            appState.save();
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

  _updateTurretReadout(dialClicks) {
    // In the scope's own unit (MRAD or MOA), so it matches the numbers on the turret
    const profile = appState.getActiveProfile();
    const clickValRad = profile.optic?.clickValueRad || 0.0001;
    const opticIsMoa = /moa/i.test(profile.optic?.clickName || '');
    const rad = dialClicks * clickValRad;
    const dialedVal = opticIsMoa ? rad * ((180 * 60) / Math.PI) : rad * 1000;
    const valEl = this.container.querySelector('#turret-dialed-val');
    const clicksEl = this.container.querySelector('#turret-dialed-clicks');
    const unitEl = this.container.querySelector('#turret-dialed-unit');
    if (valEl) valEl.textContent = dialedVal.toFixed(opticIsMoa ? 2 : 1);
    if (clicksEl) clicksEl.textContent = `(${dialClicks} clicks)`;
    if (unitEl) unitEl.textContent = opticIsMoa ? 'MOA' : 'MRAD';
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
      algorithm: appState.solverAlgorithm(),
      // The step is in the display unit, so imperial rows land on round yards (25 yd = 22.86 m)
      stepM: config.stepM * (dispUnits.distance === 'yd' ? 0.9144 : 1),
      // Always solve at least a little past the target, so the solution is never clipped
      maxRangeM: Math.max(config.maxRangeM * (dispUnits.distance === 'yd' ? 0.9144 : 1) + 0.01, Math.ceil((target.distanceM + config.stepM) / 100) * 100),
      includeSpinDrift: config.includeSpinDrift,
      includeCoriolis: config.includeCoriolis,
      includeAerodynamicJump: config.includeAerodynamicJump,
      targetHeightM: (target.targetSizeHeightCm || 50) / 100,
    });
    this.activeSolution = solution;

    // 3. The solution at the exact target distance (interpolated between table rows), with clicks
    //    from the optic's click value
    const clickRad = profile.optic?.clickValueRad || 0.0001;
    // A second, small solve whose step lands exactly on the target: the table step must never change
    // the answer (straight-line interpolation between table rows is off at short range)
    let targetPoint = null;
    if (target.distanceM >= 1) {
      const exact = solveTrajectory({
        profile,
        environment: env,
        airDensity: atmos.densityKgM3,
        speedOfSound: atmos.speedOfSoundMs,
        algorithm: appState.solverAlgorithm(),
        stepM: target.distanceM,
        maxRangeM: target.distanceM,
        includeSpinDrift: config.includeSpinDrift,
        includeCoriolis: config.includeCoriolis,
        includeAerodynamicJump: config.includeAerodynamicJump,
        targetHeightM: (target.targetSizeHeightCm || 50) / 100,
      });
      targetPoint = exact.trajectory.find((p) => Math.abs(p.distanceM - target.distanceM) < 1e-6) || null;
    }
    targetPoint = targetPoint ? { ...targetPoint } : interpolateAt(solution.trajectory, target.distanceM, env.cantDeg || 0);
    targetPoint.elevationClicks = Math.round(targetPoint.elevationRad / clickRad);
    targetPoint.windageClicks = Math.round(targetPoint.windageRad / clickRad);

    this._syncControls(profile, env, config);

    // 4. Update Telemetry HUD
    this._updateTelemetryHud(solution, targetPoint, atmos, sysUnits, dispUnits);

    // The turret either follows the solution or stays where the user dialed it
    const dialed = this.turretMode === 'auto' ? targetPoint.elevationClicks : profile.optic?.zeroElevationClicks || 0;
    this._lastTargetClicks = targetPoint.elevationClicks;

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
        elevationDialClicks: dialed,
        windageDialClicks: profile.optic?.zeroWindageClicks || 0,
        clickValueRad: profile.optic?.clickValueRad || 0.0001,
        isMrad,
        distanceUnit: dispUnits.distance,
      });
    }

    // 6. Update Turret Knob
    if (this.turret) {
      this._settingTurret = true;
      this.turret.update({
        clicks: dialed,
        clickValueRad: profile.optic?.clickValueRad || 0.0001,
        clickName: profile.optic?.clickName || '0.1 MRAD',
        isMrad,
        targetClicks: targetPoint.elevationClicks,
      });
      this._settingTurret = false;
      this._updateTurretReadout(dialed);

      const targetNeededEl = this.container.querySelector('#turret-target-needed');
        if (targetNeededEl) {
        const elVal = isMrad ? targetPoint.elevationMrad : targetPoint.elevationMoa;
        targetNeededEl.textContent = `${elVal.toFixed(1)} ${isMrad ? 'MRAD' : 'MOA'} (${targetPoint.elevationClicks} clicks)`;
      }
    }

    // 7. Update Chart
    this._renderChart(solution, target.distanceM);

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
    const angUnit = isMrad ? 'MRAD' : 'MOA';
    const yd = dispUnits.distance === 'yd';
    const dist = (m) => Math.round(yd ? m * 1.09361 : m);

    const elVal = isMrad ? targetPoint.elevationMrad : targetPoint.elevationMoa;
    const windVal = isMrad ? targetPoint.windageMrad : targetPoint.windageMoa;
    const elClicks = targetPoint.elevationClicks;
    const windClicks = Math.abs(targetPoint.windageClicks);
    const elDir = elClicks >= 0 ? 'Up' : 'Down';
    const windDir = Math.abs(windVal) < 0.005 ? '' : windVal > 0 ? 'Right' : 'Left';

    const velVal = isMetric ? targetPoint.velocityMs : targetPoint.velocityMs * 3.28084;
    const energyVal = isMetric ? targetPoint.energyJ : targetPoint.energyJ * 0.737562;
    const regime = targetPoint.mach >= 1.2 ? 'supersonic' : targetPoint.mach >= 1.0 ? 'transonic' : 'subsonic';
    const regimeClass = { supersonic: 'ok', transonic: 'warn', subsonic: 'bad' }[regime];
    const clickName = esc(appState.getActiveProfile().optic?.clickName || (isMrad ? '0.1 MRAD' : '1/4 MOA'));

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants and esc()'d strings only
    hud.innerHTML = `
      <div class="solution-head">
        <h2 id="solution-heading" class="solution-title">${icon('crosshair')} Firing solution</h2>
        <span class="solution-range"><span class="solution-range-value">${dist(targetPoint.distanceM)}</span> ${esc(dispUnits.distance)}</span>
      </div>
      <div class="solution-holds">
        <div class="hold hold-elev">
          <span class="hold-label">Elevation</span>
          <span class="hold-value">${Math.abs(elVal).toFixed(isMrad ? 1 : 2)}<span class="hold-unit">${angUnit}</span></span>
          <span class="hold-clicks">${elDir} ${Math.abs(elClicks)} clicks <span class="lg-muted">(${clickName})</span></span>
        </div>
        <div class="hold hold-wind">
          <span class="hold-label">Windage</span>
          <span class="hold-value">${Math.abs(windVal).toFixed(isMrad ? 1 : 2)}<span class="hold-unit">${angUnit}</span></span>
          <span class="hold-clicks">${windDir ? `${windDir} ${windClicks} clicks` : 'No wind correction'}</span>
        </div>
      </div>
      <dl class="solution-stats">
        <div><dt>${icon('speed')} Velocity</dt><dd>${Math.round(velVal)} ${isMetric ? 'm/s' : 'fps'} <span class="lg-badge lg-badge-${regimeClass}">Mach ${targetPoint.mach.toFixed(2)}</span></dd></div>
        <div><dt>${icon('clock')} Time of flight</dt><dd>${targetPoint.tofS.toFixed(2)} s</dd></div>
        <div><dt>${icon('energy')} Energy</dt><dd>${Math.round(energyVal)} ${isMetric ? 'J' : 'ft·lb'}</dd></div>
        <div><dt>${icon('trajectory')} Supersonic to</dt><dd>${solution.telemetry.transonicRangeM <= 0 ? 'Subsonic from the muzzle' : `${solution.telemetry.transonicRangeM >= solution.trajectory[solution.trajectory.length - 1].distanceM ? 'beyond ' : ''}${dist(solution.telemetry.transonicRangeM)} ${esc(dispUnits.distance)}`}</dd></div>
      </dl>
    `;

    const derived = this.container.querySelector('#atmos-derived');
    if (derived) {
      const da = Math.round(yd ? atmos.densityAltitudeM * 3.28084 : atmos.densityAltitudeM);
      derived.textContent = `Density altitude ${da.toLocaleString('en-US')} ${yd ? 'ft' : 'm'} · air density ${atmos.densityKgM3.toFixed(3)} kg/m³`;
    }
  }

  /**
   * The trajectory chart: a Låda Glass line chart (SVG) of the chosen quantity against distance,
   * in the display units. Reference lines (speed of sound) are extra dashed series.
   */
  _renderChart(solution, targetDistM) {
    const host = this.container.querySelector('#trajectory-chart');
    if (!host || typeof LadaGlass === 'undefined') return;
    const { systemUnits, displayUnits } = appState.state;
    const f = this._formatters(systemUnits, displayUnits);
    const u = f.units;
    const rows = solution.trajectory.filter((p) => p.distanceM > 0);
    const x = (p) => f.dist(p.distanceM);
    const fmtN = (d) => (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
    const metrics = {
      drop: { title: `Drop below line of sight (${u.lin})`, unit: u.lin, series: [{ name: 'Drop', points: rows.map((p) => [x(p), Number(f.lin(p.dropM).toFixed(1))]) }], d: 0 },
      velocity: {
        title: `Velocity (${u.vel})`,
        unit: u.vel,
        series: [
          { name: 'Velocity', points: rows.map((p) => [x(p), Math.round(f.vel(p.velocityMs))]) },
          { name: 'Speed of sound', points: rows.map((p) => [x(p), Math.round(f.vel(p.mach > 0 ? p.velocityMs / p.mach : 0))]) },
        ],
        d: 0,
      },
      wind: { title: `Wind drift (${u.lin})`, unit: u.lin, series: [{ name: 'Wind drift', points: rows.map((p) => [x(p), Number(f.lin(Math.abs(p.driftM)).toFixed(1))]) }], d: 0 },
      tof: { title: 'Time of flight (s)', unit: 's', series: [{ name: 'Time of flight', points: rows.map((p) => [x(p), Number(p.tofS.toFixed(3))]) }], d: 2 },
      energy: { title: `Energy (${u.energy})`, unit: u.energy, series: [{ name: 'Energy', points: rows.map((p) => [x(p), Math.round(f.energy(p.energyJ))]) }], d: 0, area: true },
    };
    const m = metrics[this.chartMetric] || metrics.drop;
    const title = this.container.querySelector('#chart-title');
    if (title) title.textContent = m.title;
    const note = this.container.querySelector('#chart-note');
    if (note) {
      note.textContent = `Distance in ${u.dist}. Target at ${f.dist(targetDistM)} ${u.dist}. Hover or focus the chart and use the arrow keys to read values.`;
    }
    const data = {
      label: m.title,
      series: m.series,
      area: !!m.area,
      x: { type: 'linear', format: (v) => `${fmtN(0)(v)} ${u.dist}` },
      y: { format: (v) => `${fmtN(m.d)(v)} ${m.unit}` },
    };
    if (this.chart && this.chart.host === host) this.chart.update(data);
    else {
      this.chart?.destroy?.();
      this.chart = LadaGlass.chart.line(host, data);
      this.chart.host = host;
    }
  }

  /** Display conversions for the table and CSV (physics is SI; the table follows the units setting). */
  _formatters(sysUnits, dispUnits) {
    const isMetric = sysUnits === 'metric';
    const yd = dispUnits.distance === 'yd';
    const isMrad = dispUnits.elevationAngle === 'MRAD';
    return {
      dist: (m) => (yd ? Math.round(m * 1.09361) : Math.round(m)),
      lin: (m) => (isMetric ? m * 100 : m * 39.3701),
      ang: (p, key) => (isMrad ? p[`${key}Mrad`] : p[`${key}Moa`]),
      vel: (ms) => (isMetric ? ms : ms * 3.28084),
      energy: (j) => (isMetric ? j : j * 0.737562),
      units: {
        dist: dispUnits.distance,
        lin: isMetric ? 'cm' : 'in',
        ang: isMrad ? 'MRAD' : 'MOA',
        vel: isMetric ? 'm/s' : 'fps',
        energy: isMetric ? 'J' : 'ft·lb',
      },
    };
  }

  _renderTrajectoryTable(trajectory, targetDistM, sysUnits, dispUnits) {
    const thead = this.container.querySelector('#trajectory-thead');
    const tbody = this.container.querySelector('#trajectory-tbody');
    if (!thead || !tbody) return;
    const cols = this.visibleColumns;
    const f = this._formatters(sysUnits, dispUnits);
    const u = f.units;
    const clickRad = appState.getActiveProfile().optic?.clickValueRad || 0.0001;
    const zeroM = appState.getActiveProfile().zeroDistanceM;
    const rows = trajectory.filter((p) => p.distanceM > 0);

    // First solve: tick every 100 m. Afterwards keep the user's choice, pruned to rows that exist.
    if (this.selectedRanges === null && this._savedRanges) {
      // Restore the saved choice (matched to this table's rows within 1 cm)
      const saved = this._savedRanges;
      this._savedRanges = null;
      this.selectedRanges = new Set(rows.filter((p) => saved.some((d) => Math.abs(d - p.distanceM) < 0.01)).map((p) => p.distanceM));
    }
    if (this.selectedRanges === null) {
      this.selectedRanges = new Set(rows.filter((p) => f.dist(p.distanceM) % 100 === 0).map((p) => p.distanceM));
    } else {
      const present = new Set(rows.map((p) => p.distanceM));
      this.selectedRanges = new Set([...this.selectedRanges].filter((d) => present.has(d)));
    }

    // The single row nearest the target gets the "Target" tag
    const targetRow = rows.reduce((best, p) => (Math.abs(p.distanceM - targetDistM) < Math.abs(best.distanceM - targetDistM) ? p : best), rows[0]);

    const allChecked = rows.length > 0 && rows.every((p) => this.selectedRanges.has(p.distanceM));
    const head = [
      `<th scope="col"><label class="check-inline"><input type="checkbox" class="lg-check" id="chk-select-all-ranges" ${allChecked ? 'checked' : ''} aria-label="Include all ranges on DOPE cards" /> Range (${u.dist})</label></th>`,
    ];
    const colDefs = [
      ['drop', `Drop (${u.lin})`],
      ['elevation', `Elevation (${u.ang})`],
      ['elevClicks', 'Clicks'],
      ['drift', `Wind drift (${u.lin})`],
      ['wind', `Windage (${u.ang})`],
      ['windClicks', 'Clicks'],
      ['velocity', `Velocity (${u.vel})`],
      ['mach', 'Mach'],
      ['energy', `Energy (${u.energy})`],
      ['tof', 'Time (s)'],
      ['danger', `Danger space (${u.dist})`],
    ];
    for (const [key, label] of colDefs) if (cols.has(key)) head.push(`<th scope="col">${label}</th>`);
    // eslint-disable-next-line no-unsanitized/property -- reviewed: unit labels are constants
    thead.innerHTML = `<tr>${head.join('')}</tr>`;

    const signed = (v, d) => {
      const r = Number(v.toFixed(d));
      return (r === 0 ? 0 : r).toFixed(d); // no "-0.00"
    };

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers and constant tags only
    tbody.innerHTML = rows
      .map((p) => {
        const isTarget = p === targetRow;
        const isZero = Math.abs(p.distanceM - zeroM) < 0.5;
        const dist = f.dist(p.distanceM);
        const elevClicks = Math.round(p.elevationRad / clickRad);
        const windClicks = Math.round(p.windageRad / clickRad);
        const machClass = p.mach >= 1.2 ? 'lg-badge-ok' : p.mach >= 1.0 ? 'lg-badge-warn' : 'lg-badge-bad';
        const cells = [
          `<th scope="row"><label class="check-inline"><input type="checkbox" class="lg-check chk-range-select" data-dist="${p.distanceM}" ${this.selectedRanges.has(p.distanceM) ? 'checked' : ''} aria-label="Include ${dist} ${u.dist} on DOPE cards" /> ${dist}</label>${isZero ? '<span class="row-tag row-tag-zero">Zero</span>' : ''}${isTarget ? '<span class="row-tag row-tag-target">Target</span>' : ''}</th>`,
        ];
        if (cols.has('drop')) cells.push(`<td>${signed(f.lin(p.dropM), 1)}</td>`);
        if (cols.has('elevation')) cells.push(`<td class="num-strong">${signed(f.ang(p, 'elevation'), 2)}</td>`);
        if (cols.has('elevClicks')) cells.push(`<td>${elevClicks === 0 ? 0 : elevClicks}</td>`);
        if (cols.has('drift')) cells.push(`<td>${signed(f.lin(Math.abs(p.driftM)), 1)}</td>`);
        if (cols.has('wind')) {
          const w = f.ang(p, 'windage');
          cells.push(`<td>${signed(Math.abs(w), 2)}${Math.abs(w) >= 0.005 ? `<span class="dir-tag">${w > 0 ? 'R' : 'L'}</span>` : ''}</td>`);
        }
        if (cols.has('windClicks')) cells.push(`<td>${Math.abs(windClicks)}</td>`);
        if (cols.has('velocity')) cells.push(`<td>${Math.round(f.vel(p.velocityMs))}</td>`);
        if (cols.has('mach')) cells.push(`<td><span class="lg-badge ${machClass}">${p.mach.toFixed(2)}</span></td>`);
        if (cols.has('energy')) cells.push(`<td>${Math.round(f.energy(p.energyJ))}</td>`);
        if (cols.has('tof')) cells.push(`<td>${p.tofS.toFixed(3)}</td>`);
        if (cols.has('danger')) cells.push(`<td>${f.dist(p.dangerSpaceM)}</td>`);
        return `<tr class="traj-row${isTarget ? ' target-row' : ''}${isZero ? ' zero-row' : ''}" data-dist="${p.distanceM}">${cells.join('')}</tr>`;
      })
      .join('');

    this._bindTableSelectionEvents(rows);
  }

  _bindTableSelectionEvents(rows) {
    const chkAll = this.container.querySelector('#chk-select-all-ranges');
    chkAll?.addEventListener('change', (e) => {
      this.selectedRanges = new Set(e.target.checked ? rows.map((p) => p.distanceM) : []);
      this.container.querySelectorAll('.chk-range-select').forEach((chk) => (chk.checked = e.target.checked));
      this._updateSelectedRangesCount();
    });
    this.container.querySelectorAll('.chk-range-select').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const dist = parseFloat(chk.dataset.dist);
        if (e.target.checked) this.selectedRanges.add(dist);
        else this.selectedRanges.delete(dist);
        if (chkAll) chkAll.checked = rows.every((p) => this.selectedRanges.has(p.distanceM));
        this._updateSelectedRangesCount();
      });
    });
    this._updateSelectedRangesCount();
  }

  _updateSelectedRangesCount() {
    const n = this.selectedRanges?.size || 0;
    this._saveUiPrefs();
    const countEl = this.container.querySelector('#selected-ranges-count');
    if (countEl) countEl.textContent = `${n}`;
    const btn = this.container.querySelector('#btn-send-to-dope');
    if (btn) btn.disabled = n === 0;
  }

  exportCsv() {
    if (!this.activeSolution) return;
    const { systemUnits, displayUnits } = appState.state;
    const f = this._formatters(systemUnits, displayUnits);
    const u = f.units;
    const clickRad = appState.getActiveProfile().optic?.clickValueRad || 0.0001;
    const headers = [
      `Range (${u.dist})`, `Drop (${u.lin})`, `Elevation (${u.ang})`, 'Elevation clicks', `Wind drift (${u.lin})`,
      `Windage (${u.ang})`, 'Windage clicks', `Velocity (${u.vel})`, 'Mach', `Energy (${u.energy})`, 'Time of flight (s)',
      `Danger space (${u.dist})`,
    ];
    const rows = this.activeSolution.trajectory
      .filter((p) => p.distanceM > 0)
      .map((p) => [
        f.dist(p.distanceM),
        f.lin(p.dropM).toFixed(1),
        f.ang(p, 'elevation').toFixed(2),
        Math.round(p.elevationRad / clickRad),
        f.lin(p.driftM).toFixed(1),
        f.ang(p, 'windage').toFixed(2),
        Math.round(p.windageRad / clickRad),
        f.vel(p.velocityMs).toFixed(0),
        p.mach.toFixed(2),
        f.energy(p.energyJ).toFixed(0),
        p.tofS.toFixed(3),
        f.dist(p.dangerSpaceM),
      ]);
    // Only numbers and fixed headers go into the file, so no spreadsheet formula injection
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ballistic-table-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Switches between the turret following the solution and manual dialing. */
  _setTurretMode(mode, recompute = true) {
    this.turretMode = mode;
    this.container.querySelectorAll('#turret-mode [data-turret-mode]').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.turretMode === mode));
    });
    const dialBtn = this.container.querySelector('#btn-turret-match-target');
    if (dialBtn) dialBtn.hidden = mode === 'auto';
    if (mode === 'manual') {
      const optic = appState.getActiveProfile().optic;
      if (optic && this.turret) optic.zeroElevationClicks = this.turret.options.clicks ?? this._lastTargetClicks ?? 0;
    }
    if (recompute) this.recompute();
  }

  /**
   * Keeps the setup summaries and controls in step with the state after every change, including
   * changes made elsewhere (wind clock drag, command palette). Fields being edited are left alone.
   */
  _syncControls(profile, env, config) {
    const isImp = appState.state.systemUnits === 'imperial';
    const q = (sel) => this.container.querySelector(sel);
    const setText = (sel, text) => {
      const e = q(sel);
      if (e && e.textContent !== text) e.textContent = text;
    };
    const setVal = (sel, val) => {
      const e = q(sel);
      if (e && document.activeElement !== e && e.getAttribute('aria-invalid') !== 'true' && e.value !== String(val)) e.value = String(val);
    };
    const mv = Math.round(isImp ? profile.muzzleVelocityMs * 3.28084 : profile.muzzleVelocityMs);
    const temp = isImp ? Math.round((env.temperatureC * 9) / 5 + 32) : Number(env.temperatureC.toFixed(1));
    const press = isImp ? (env.pressureHpa * 0.02953).toFixed(2) : Number(env.pressureHpa.toFixed(1));
    const wind = isImp ? Number((env.windSpeedMs * 2.23694).toFixed(1)) : Number(env.windSpeedMs.toFixed(1));
    const dir = Math.round(env.windDirectionDeg);
    setText('#sum-load', `${mv} ${isImp ? 'fps' : 'm/s'}`);
    setText('#sum-atmos', `${temp} ${isImp ? '°F' : '°C'} · ${press} ${isImp ? 'inHg' : 'hPa'}`);
    setText('#sum-wind', `${wind} ${isImp ? 'mph' : 'm/s'} · from ${dir}°`);
    setText('#sum-angle', `${env.inclinationDeg || 0}° · ${env.cantDeg || 0}°`);
    setVal('#wind-dir-input', dir);
    setVal('#wind-speed-input', wind);
    setVal('#algorithm-select', config.activeAlgorithm === 'MPM' ? 'MPM' : 'G7');
    setVal('#step-select', config.stepM);
    const t = appState.state.target;
    const toUnit = (cm) => (isImp ? (cm / 2.54).toFixed(1) : String(Math.round(cm)));
    setVal('#target-w-input', toUnit(t.targetSizeWidthCm));
    setVal('#target-h-input', toUnit(t.targetSizeHeightCm));
  }

  /**
   * View preferences that should survive reloads and view switches: the open tab, the open setup
   * sections and the ranges ticked for DOPE cards (per unit system, as display distances).
   */
  _loadUiPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}');
      if (['reticle', 'chart', 'table'].includes(raw.panel)) this.activePanel = raw.panel;
      if (Array.isArray(raw.sections)) this.openSections = new Set(raw.sections.filter((x) => typeof x === 'string').slice(0, 10));
      if (['drop', 'velocity', 'wind', 'tof', 'energy'].includes(raw.metric)) this.chartMetric = raw.metric;
      const ranges = raw.ranges?.[appState.state.systemUnits];
      if (Array.isArray(ranges)) {
        const toM = appState.state.systemUnits === 'imperial' ? 0.9144 : 1;
        this._savedRanges = ranges.filter((d) => Number.isFinite(d) && d > 0 && d < 10000).slice(0, 400).map((d) => d * toM);
      }
    } catch {
      // Unreadable or blocked storage: keep the defaults
    }
  }

  _saveUiPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}');
      const toDisp = appState.state.systemUnits === 'imperial' ? 1 / 0.9144 : 1;
      const ranges = { ...(raw.ranges || {}) };
      if (this.selectedRanges) ranges[appState.state.systemUnits] = [...this.selectedRanges].map((d) => Math.round(d * toDisp * 100) / 100);
      localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ panel: this.activePanel, sections: [...this.openSections], metric: this.chartMetric, ranges }));
    } catch {
      // Not saved; fine for this session
    }
  }

  /** Shows one of the result panels (reticle, chart, table); the choice survives re-renders. */
  _showResultPanel(name) {
    this.activePanel = name;
    this._saveUiPrefs();
    this.container.querySelectorAll('.result-tabs .lg-tab').forEach((tab) => {
      const on = tab.dataset.panel === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    this.container.querySelectorAll('.result-panel').forEach((panel) => {
      panel.hidden = panel.id !== `panel-${name}`;
    });
  }

  render() {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const target = appState.state.target;
    const config = appState.state.solverConfig;
    const isImp = appState.state.systemUnits === 'imperial';
    // Turret steps follow the optic (its click value and angular unit), not the display units
    const opticUnit = /moa/i.test(profile.optic?.clickName || '') ? 'MOA' : 'MRAD';

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

    const openSections = this.openSections;
    const sec = (id) => (openSections.has(id) ? 'open' : '');
    const envOptions = appState.state.environments
      .map((e) => `<option value="${esc(e.id)}" ${e.id === env.id ? 'selected' : ''}>${esc(e.name)}</option>`)
      .join('');

    // eslint-disable-next-line no-unsanitized/property -- reviewed: profile/env names go through esc(); the rest are numbers and constants
    this.container.innerHTML = `
      <header class="lg-header view-header solver-header">
        <div>
          <h1>Solver</h1>
          <p>Set the rifle, distance and conditions; the firing solution shows what to dial and hold.</p>
        </div>
      </header>
      <div class="solver-layout">
        <!-- SETUP: everything that drives the solution -->
        <section class="solver-setup" aria-label="Setup">

          <div class="setup-rifle lg-card">
            <label class="field-label" for="profile-select">${icon('rifle')} Rifle</label>
            <div class="rifle-row">
              <select id="profile-select" class="lg-select">
                ${appState.state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === profile.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
              <button id="btn-quick-add-rifle" class="lg-btn lg-btn-icon" type="button" title="Add a rifle" aria-label="Add a rifle">${icon('plus')}</button>
            </div>
            <p class="rifle-summary">${esc(profile.caliber || '')}${profile.bullet?.name ? ` · ${esc(profile.bullet.name)}` : ''}</p>
          </div>

          <details class="setup-section lg-card" data-section="target" ${sec('target')}>
            <summary>${icon('target')}<span>Target</span><span class="section-summary" id="sum-target">${targetDistDisp} ${targetDistUnit}</span></summary>
            <div class="section-body">
              <label class="field-label" for="target-range-input">Distance (${targetDistUnit})</label>
              <div class="range-slider-group">
                <input type="range" class="lg-slider" id="target-range-slider" aria-label="Target distance" min="50" max="${isImp ? 1600 : 1500}" step="25" value="${targetDistDisp}" />
                <input type="number" id="target-range-input" class="lg-input range-number" min="10" max="${isImp ? 2200 : 2000}" step="1" value="${targetDistDisp}" />
              </div>
              <div class="field-grid-2">
                <div class="field-span-2">
                  <label class="field-label" for="target-shape-select">Target</label>
                  <select id="target-shape-select" class="lg-select">
                    ${Object.entries(TARGETS).map(([k, t]) => `<option value="${k}" ${target.targetShape === k ? 'selected' : ''}>${t.label} (${isImp ? `${(t.w / 2.54).toFixed(0)}${k === 'circle' ? '' : ` × ${(t.h / 2.54).toFixed(0)}`} in` : `${t.w}${k === 'circle' ? '' : ` × ${t.h}`} cm`})</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="field-label" for="target-w-input">${target.targetShape === 'circle' ? 'Diameter' : 'Width'} (${isImp ? 'in' : 'cm'})</label>
                  <input type="number" id="target-w-input" class="lg-input" min="${isImp ? 1 : 2}" max="${isImp ? 120 : 300}" step="${isImp ? 0.5 : 1}" value="${isImp ? (target.targetSizeWidthCm / 2.54).toFixed(1) : Math.round(target.targetSizeWidthCm)}" />
                </div>
                <div ${target.targetShape === 'circle' ? 'hidden' : ''}>
                  <label class="field-label" for="target-h-input">Height (${isImp ? 'in' : 'cm'})</label>
                  <input type="number" id="target-h-input" class="lg-input" min="${isImp ? 1 : 2}" max="${isImp ? 120 : 300}" step="${isImp ? 0.5 : 1}" value="${isImp ? (target.targetSizeHeightCm / 2.54).toFixed(1) : Math.round(target.targetSizeHeightCm)}" />
                </div>
              </div>
            </div>
          </details>

          <details class="setup-section lg-card" data-section="load" ${sec('load')}>
            <summary>${icon('bullet')}<span>Load and rifle</span><span class="section-summary" id="sum-load">${mvDisp} ${mvUnit}</span></summary>
            <div class="section-body">
              <div class="field-grid-2">
                <div>
                  <label class="field-label" for="mv-input">Muzzle velocity (${mvUnit})</label>
                  <input type="number" id="mv-input" class="lg-input" min="${isImp ? 600 : 200}" max="${isImp ? 4500 : 1500}" step="1" value="${mvDisp}" />
                </div>
                <div>
                  <label class="field-label" for="weight-input">Bullet weight (gr)</label>
                  <input type="number" id="weight-input" class="lg-input" min="20" max="1000" step="0.1" value="${profile.bullet.weightGr}" />
                </div>
                <div>
                  <label class="field-label" for="drag-model-select">Drag model</label>
                  <select id="drag-model-select" class="lg-select">
                    <option value="G7" ${profile.bullet.dragModel === 'G7' ? 'selected' : ''}>G7 (boat-tail)</option>
                    <option value="G1" ${profile.bullet.dragModel === 'G1' ? 'selected' : ''}>G1 (flat-base)</option>
                  </select>
                </div>
                <div>
                  <label class="field-label" for="bc-input">BC (${esc(profile.bullet.dragModel === 'G1' ? 'G1' : 'G7')})</label>
                  <input type="number" id="bc-input" class="lg-input" min="0.05" max="1.5" step="0.001" value="${profile.bullet.dragModel === 'G1' ? profile.bullet.bcG1 : profile.bullet.bcG7}" />
                </div>
                <div class="field-span-2">
                  <label class="field-label" for="algorithm-select">Solver model</label>
                  <select id="algorithm-select" class="lg-select">
                    <option value="G7" ${config.activeAlgorithm !== 'MPM' ? 'selected' : ''}>Point mass (uses the drag model above)</option>
                    <option value="MPM" ${config.activeAlgorithm === 'MPM' ? 'selected' : ''}>Modified point mass (adds spin drift, jump, Coriolis)</option>
                  </select>
                </div>
                <div>
                  <label class="field-label" for="sh-input">Sight height (${shUnit})</label>
                  <input type="number" id="sh-input" class="lg-input" min="${isImp ? 0.5 : 1}" max="${isImp ? 6 : 15}" step="${isImp ? 0.05 : 0.1}" value="${shDisp}" />
                </div>
                <div>
                  <label class="field-label" for="zero-input">Zero distance (${zeroUnit})</label>
                  <input type="number" id="zero-input" class="lg-input" min="25" max="${isImp ? 350 : 300}" step="1" value="${zeroDisp}" />
                </div>
                <div>
                  <label class="field-label" for="twist-input">Twist rate (1 in … in)</label>
                  <input type="number" id="twist-input" class="lg-input" min="5" max="18" step="0.25" value="${profile.twistRateIn}" />
                </div>
              </div>
            </div>
          </details>

          <details class="setup-section lg-card" data-section="atmosphere" ${sec('atmosphere')}>
            <summary>${icon('thermometer')}<span>Atmosphere</span><span class="section-summary" id="sum-atmos">${tempDisp} ${tempUnit} · ${pressDisp} ${pressUnit}</span></summary>
            <div class="section-body">
              <label class="field-label" for="env-select">Preset</label>
              <select id="env-select" class="lg-select">${envOptions}</select>
              <div class="field-grid-2">
                <div>
                  <label class="field-label" for="temp-input">Temperature (${tempUnit})</label>
                  <input type="number" id="temp-input" class="lg-input" min="-40" max="${isImp ? 140 : 60}" step="1" value="${tempDisp}" />
                </div>
                <div>
                  <label class="field-label" for="press-input">Station pressure (${pressUnit})</label>
                  <input type="number" id="press-input" class="lg-input" min="${isImp ? 20 : 700}" max="${isImp ? 33 : 1100}" step="${isImp ? 0.01 : 1}" value="${pressDisp}" />
                </div>
                <div>
                  <label class="field-label" for="alt-input">Altitude (${altUnit})</label>
                  <input type="number" id="alt-input" class="lg-input" min="-400" max="${isImp ? 16000 : 5000}" step="${isImp ? 100 : 10}" value="${altDisp}" />
                </div>
                <div>
                  <label class="field-label" for="hum-input">Humidity (%)</label>
                  <input type="number" id="hum-input" class="lg-input" min="0" max="100" step="1" value="${env.humidityPercent}" />
                </div>
              </div>
              <p class="field-hint" id="atmos-derived"></p>
            </div>
          </details>

          <details class="setup-section lg-card" data-section="wind" ${sec('wind')}>
            <summary>${icon('wind')}<span>Wind</span><span class="section-summary" id="sum-wind">${windSpeedDisp} ${windSpeedUnit} · ${env.windDirectionDeg}°</span></summary>
            <div class="section-body">
              <div class="wind-clock-wrapper">
                <canvas id="wind-clock-canvas" width="200" height="200" aria-label="Wind direction"></canvas>
              </div>
              <div class="field-grid-2">
                <div>
                  <label class="field-label" for="wind-speed-input">Speed (${windSpeedUnit})</label>
                  <input type="number" id="wind-speed-input" class="lg-input" min="0" max="${isImp ? 65 : 30}" step="${isImp ? 1 : 0.5}" value="${windSpeedDisp}" />
                </div>
                <div>
                  <label class="field-label" for="wind-dir-input">From (° clock, 90 = from right)</label>
                  <input type="number" id="wind-dir-input" class="lg-input" min="0" max="359" step="5" value="${env.windDirectionDeg}" />
                </div>
              </div>
            </div>
          </details>

          <details class="setup-section lg-card" data-section="angle" ${sec('angle')}>
            <summary>${icon('altitude')}<span>Shot angle and cant</span><span class="section-summary" id="sum-angle">${env.inclinationDeg || 0}° · ${env.cantDeg || 0}°</span></summary>
            <div class="section-body">
              <div class="field-grid-2">
                <div>
                  <label class="field-label" for="inc-input">Inclination (°, + uphill)</label>
                  <input type="number" id="inc-input" class="lg-input" min="-60" max="60" step="1" value="${env.inclinationDeg || 0}" />
                </div>
                <div>
                  <label class="field-label" for="cant-input">Rifle cant (°, + right)</label>
                  <input type="number" id="cant-input" class="lg-input" min="-45" max="45" step="1" value="${env.cantDeg || 0}" />
                </div>
              </div>
            </div>
          </details>
        </section>

        <!-- RESULT: the firing solution, then details in tabs -->
        <section class="solver-result" aria-labelledby="solution-heading">
          <div class="solution-card lg-card" id="telemetry-hud" aria-live="polite"></div>

          <div class="result-tabs lg-tabs" role="tablist" aria-label="Solution details">
            <button class="lg-tab" role="tab" type="button" id="tab-reticle" aria-controls="panel-reticle" data-panel="reticle">${icon('reticle')} Reticle and turret</button>
            <button class="lg-tab" role="tab" type="button" id="tab-chart" aria-controls="panel-chart" data-panel="chart">${icon('trajectory')} Trajectory chart</button>
            <button class="lg-tab" role="tab" type="button" id="tab-table" aria-controls="panel-table" data-panel="table">${icon('list')} Range table</button>
          </div>

          <div class="result-panel lg-card" role="tabpanel" id="panel-reticle" aria-labelledby="tab-reticle">
            <div class="panel-toolbar">
              <label class="lg-sr-only" for="reticle-type-select">Reticle</label>
              <select id="reticle-type-select" class="lg-select lg-select-sm">
<option value="EBR-8 MRAD" ${profile.optic?.reticle === 'EBR-8 MRAD' ? 'selected' : ''}>Vortex EBR-8 (MRAD)</option>
                <option value="Kahles SKMR4" ${profile.optic?.reticle === 'Kahles SKMR4' ? 'selected' : ''}>Kahles SKMR4 (MRAD)</option>
                <option value="Leupold PR2-MIL" ${profile.optic?.reticle === 'Leupold PR2-MIL' ? 'selected' : ''}>Leupold PR2-MIL (MRAD)</option>
                <option value="Mil-XT" ${profile.optic?.reticle === 'Mil-XT' ? 'selected' : ''}>Nightforce Mil-XT (MRAD)</option>
                <option value="Tremor3" ${profile.optic?.reticle === 'Tremor3' ? 'selected' : ''}>Horus Tremor3 (MRAD)</option>
                <option value="Mil-Dot" ${profile.optic?.reticle === 'Mil-Dot' ? 'selected' : ''}>Mil-Dot (MRAD)</option>
                <option value="EBR-2C MOA" ${profile.optic?.reticle === 'EBR-2C MOA' ? 'selected' : ''}>Vortex EBR-2C (MOA)</option>
                <option value="German #4" ${profile.optic?.reticle === 'German #4' ? 'selected' : ''}>German #4 (hunting)</option>
                <option value="ACSS DMR" ${profile.optic?.reticle === 'ACSS DMR' ? 'selected' : ''}>Primary Arms ACSS DMR</option>
              </select>
              <label class="lg-sr-only" for="focal-plane-select">Focal plane</label>
              <select id="focal-plane-select" class="lg-select lg-select-sm">
                <option value="FFP" ${profile.optic?.focalPlane === 'FFP' ? 'selected' : ''}>First focal plane</option>
                <option value="SFP" ${profile.optic?.focalPlane === 'SFP' ? 'selected' : ''}>Second focal plane</option>
              </select>
              <label class="check-inline"><input type="checkbox" class="lg-check" id="illum-check" ${this.illuminated ? 'checked' : ''} /> Illuminated</label>
              <label class="mag-control" for="mag-slider">Magnification <strong id="mag-display">${profile.optic?.currentMagnification || 15}×</strong>
                <input type="range" class="lg-slider" id="mag-slider" min="${profile.optic?.minMagnification || 4}" max="${profile.optic?.maxMagnification || 36}" step="1" value="${profile.optic?.currentMagnification || 15}" />
              </label>
            </div>
            <div class="reticle-turret-split">
              <div class="reticle-canvas-container">
                <canvas id="reticle-canvas" role="img" aria-label="Reticle view showing the hold for the target"></canvas>
              </div>
              <div class="turret-knob-container">
                <div class="lg-tabs turret-mode" role="tablist" aria-label="Turret" id="turret-mode">
                  <button class="lg-tab" role="tab" type="button" data-turret-mode="auto" aria-selected="${this.turretMode === 'auto'}">Follow solution</button>
                  <button class="lg-tab" role="tab" type="button" data-turret-mode="manual" aria-selected="${this.turretMode === 'manual'}">Manual</button>
                </div>
                <div class="turret-header">
                  <p class="lg-label turret-title">Elevation turret</p>
                  <span class="turret-resolution" id="turret-resolution-label">${esc(profile.optic?.clickName || '0.1 MRAD')} per click</span>
                </div>
                <div class="turret-canvas-wrapper">
                  <canvas id="turret-canvas" aria-label="Elevation turret"></canvas>
                </div>
                <div class="turret-readout" aria-live="polite">
                  Dialed <strong><span id="turret-dialed-val">0.0</span> <span id="turret-dialed-unit">MRAD</span></strong>
                  <span id="turret-dialed-clicks" class="turret-subtext">(0 clicks)</span>
                </div>
                <div class="turret-btn-row">
                  <button id="btn-turret-minus-major" class="lg-btn turret-btn" type="button" aria-label="Down 1 ${opticUnit}" title="Down 1 ${opticUnit}">−1</button>
                  <button id="btn-turret-minus" class="lg-btn turret-btn" type="button" aria-label="Down one click" title="Down one click">−1c</button>
                  <button id="btn-turret-zero" class="lg-btn turret-btn" type="button" aria-label="Back to zero" title="Back to zero">0</button>
                  <button id="btn-turret-plus" class="lg-btn turret-btn" type="button" aria-label="Up one click" title="Up one click">+1c</button>
                  <button id="btn-turret-plus-major" class="lg-btn turret-btn" type="button" aria-label="Up 1 ${opticUnit}" title="Up 1 ${opticUnit}">+1</button>
                </div>
                <button id="btn-turret-match-target" class="lg-btn lg-btn-primary btn-block" type="button" ${this.turretMode === 'auto' ? 'hidden' : ''}>
                  ${icon('turret')} Dial <span id="turret-target-needed">0.0</span>
                </button>
              </div>
            </div>
          </div>

          <div class="result-panel lg-card" role="tabpanel" id="panel-chart" aria-labelledby="tab-chart" hidden>
            <div class="panel-toolbar">
              <p class="lg-label chart-title" id="chart-title">Drop</p>
              <span class="toolbar-spacer"></span>
              <div class="lg-tabs chart-metric" role="tablist" aria-label="Chart">
                ${[['drop', 'Drop'], ['velocity', 'Velocity'], ['wind', 'Wind drift'], ['tof', 'Time of flight'], ['energy', 'Energy']]
                  .map(([k, l]) => `<button class="lg-tab" role="tab" type="button" data-metric="${k}" aria-selected="${this.chartMetric === k}">${l}</button>`).join('')}
              </div>
            </div>
            <div class="chart-host" id="trajectory-chart"></div>
            <p class="chart-note lg-small lg-muted" id="chart-note"></p>
          </div>

          <div class="result-panel lg-card" role="tabpanel" id="panel-table" aria-labelledby="tab-table" hidden>
            <div class="panel-toolbar">
              <label class="field-inline" for="step-select">Every
                <select id="step-select" class="lg-select lg-select-sm">
                  ${[10, 25, 50, 100].map((v) => `<option value="${v}" ${config.stepM === v ? 'selected' : ''}>${v} ${isImp ? 'yd' : 'm'}</option>`).join('')}
                </select>
              </label>
              <details class="column-visibility-dropdown" id="col-picker-details">
                <summary class="lg-btn">${icon('settings')} Columns</summary>
                <div class="column-picker-menu">
                  ${[['drop', 'Drop'], ['elevation', 'Elevation'], ['elevClicks', 'Elevation clicks'], ['drift', 'Wind drift'], ['wind', 'Windage'], ['windClicks', 'Windage clicks'], ['velocity', 'Velocity'], ['mach', 'Mach'], ['energy', 'Energy'], ['tof', 'Time of flight'], ['danger', 'Danger space']]
                    .map(([k, l]) => `<label><input type="checkbox" data-col="${k}" ${this.visibleColumns.has(k) ? 'checked' : ''} /> ${l}</label>`).join('')}
                </div>
              </details>
              <span class="toolbar-spacer"></span>
              <button id="export-csv-btn" class="lg-btn" type="button">${icon('download')} CSV</button>
              <button id="btn-send-to-dope" class="lg-btn lg-btn-primary" type="button">${icon('card')}<span>Make DOPE card (<span id="selected-ranges-count">0</span> ranges)</span></button>
            </div>
            <div class="lg-table-wrap lg-table-sticky range-table-wrap">
              <table class="lg-table range-table">
                <caption class="lg-sr-only">Range table: drop, holds and velocity at each distance</caption>
                <thead id="trajectory-thead"></thead>
                <tbody id="trajectory-tbody"></tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    `;

    this._showResultPanel(this.activePanel);
    this._bindFormEvents();
  }

  _bindFormEvents() {
    const isImp = appState.state.systemUnits === 'imperial';

    // Profile Switcher
    const profSel = this.container.querySelector('#profile-select');
    profSel?.addEventListener('change', (e) => {
      appState.setActiveProfile(e.target.value); // the subscription re-renders
    });

    // Quick Add New Rifle Modal Trigger
    const quickAddBtn = this.container.querySelector('#btn-quick-add-rifle');
    quickAddBtn?.addEventListener('click', () => {
      new RifleBuilderModal().open(); // the 'profiles' change re-renders this view
    });

    // Target Range Slider
    const rangeSlider = this.container.querySelector('#target-range-slider');
    const rangeNumber = this.container.querySelector('#target-range-input');
    const setDistance = (val) => {
      if (!Number.isFinite(val) || val <= 0) return;
      const distM = isImp ? Math.round(val * 0.9144) : Math.round(val);
      const sum = this.container.querySelector('#sum-target');
      if (sum) sum.textContent = `${Math.round(val)} ${isImp ? 'yd' : 'm'}`;
      appState.updateTarget({ distanceM: distM });
    };
    rangeSlider?.addEventListener('input', (e) => {
      if (rangeNumber) rangeNumber.value = e.target.value;
      setDistance(Number(e.target.value));
    });
    rangeNumber?.addEventListener('change', (e) => {
      const val = parseNumber(e.target.value);
      const error = rangeError(e.target, val);
      setFieldError(e.target, error);
      if (error) return;
      if (rangeSlider) rangeSlider.value = String(val);
      setDistance(val);
    });

    // Atmosphere preset (moved here from the header: it is a solver input)
    this.container.querySelector('#env-select')?.addEventListener('change', (e) => {
      appState.setActiveEnvironment(e.target.value);
    });

    // Remember which setup sections are open across re-renders
    this.container.querySelectorAll('.setup-section').forEach((d) => {
      d.addEventListener('toggle', () => {
        if (d.open) this.openSections.add(d.dataset.section);
        else this.openSections.delete(d.dataset.section);
        this._saveUiPrefs();
      });
    });

    // Result tabs (Reticle / Chart / Table) with arrow-key support
    const resultTabs = Array.from(this.container.querySelectorAll('.result-tabs .lg-tab'));
    resultTabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => this._showResultPanel(tab.dataset.panel));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = resultTabs[(idx + (e.key === 'ArrowRight' ? 1 : resultTabs.length - 1)) % resultTabs.length];
        this._showResultPanel(next.dataset.panel);
        next.focus();
      });
    });

    // Target Shape & Speed
    const shapeSel = this.container.querySelector('#target-shape-select');
    // Choosing a target also sets its standard size (editable below it)
    shapeSel?.addEventListener('change', (e) => {
      const t = targetOf(e.target.value);
      appState.updateTarget({ targetShape: e.target.value, targetSizeWidthCm: t.w, targetSizeHeightCm: t.h });
      this.render();
      this.initVisualizers();
      this.recompute();
    });
    const toCm = (v) => (isImp ? v * 2.54 : v);
    bindNumber(this.container.querySelector('#target-w-input'), (v) => {
      const cm = toCm(v);
      appState.updateTarget(appState.state.target.targetShape === 'circle' ? { targetSizeWidthCm: cm, targetSizeHeightCm: cm } : { targetSizeWidthCm: cm });
    });
    bindNumber(this.container.querySelector('#target-h-input'), (v) => appState.updateTarget({ targetSizeHeightCm: toCm(v) }));
    // Load and rifle (validated: out-of-range values show an inline message and are not applied)
    const q = (id) => this.container.querySelector(id);
    bindNumber(q('#mv-input'), (val) => {
      appState.updateActiveProfile({ muzzleVelocityMs: Number((isImp ? val / 3.28084 : val).toFixed(1)), zeroAngleRad: null });
    });
    bindNumber(q('#weight-input'), (val) => {
      appState.getActiveProfile().bullet.weightGr = val;
      appState.updateActiveProfile({ zeroAngleRad: null });
    });
    bindNumber(q('#bc-input'), (val) => {
      const p = appState.getActiveProfile();
      if (p.bullet.dragModel === 'G1') p.bullet.bcG1 = val;
      else p.bullet.bcG7 = val;
      appState.updateActiveProfile({ zeroAngleRad: null });
    });
    bindNumber(q('#sh-input'), (val) => {
      appState.updateActiveProfile({ sightHeightM: isImp ? val * 0.0254 : val / 100, zeroAngleRad: null });
    });
    bindNumber(q('#zero-input'), (val) => {
      appState.updateActiveProfile({ zeroDistanceM: isImp ? Math.round(val * 0.9144) : val, zeroAngleRad: null });
    });
    bindNumber(q('#twist-input'), (val) => {
      appState.updateActiveProfile({ twistRateIn: val });
    });
    // Drag model is a property of the bullet; the solver model is chosen separately
    q('#drag-model-select')?.addEventListener('change', (e) => {
      appState.getActiveProfile().bullet.dragModel = e.target.value;
      appState.updateActiveProfile({ zeroAngleRad: null });
      this.render();
      this.initVisualizers();
      this.recompute();
    });
    q('#algorithm-select')?.addEventListener('change', (e) => {
      appState.updateActiveProfile({ zeroAngleRad: null });
      appState.updateSolverConfig({ activeAlgorithm: e.target.value });
    });

    // Atmosphere
    bindNumber(q('#temp-input'), (val) => {
      appState.updateActiveEnvironment({ temperatureC: Number((isImp ? ((val - 32) * 5) / 9 : val).toFixed(1)) });
    });
    bindNumber(q('#press-input'), (val) => {
      appState.updateActiveEnvironment({ pressureHpa: Number((isImp ? val / 0.02953 : val).toFixed(1)) });
    });
    bindNumber(q('#alt-input'), (val) => {
      appState.updateActiveEnvironment({ altitudeM: isImp ? Math.round(val / 3.28084) : val });
    });
    bindNumber(q('#hum-input'), (val) => appState.updateActiveEnvironment({ humidityPercent: val }));
    bindNumber(q('#inc-input'), (val) => appState.updateActiveEnvironment({ inclinationDeg: val }));
    bindNumber(q('#cant-input'), (val) => appState.updateActiveEnvironment({ cantDeg: val }));

    // Wind
    bindNumber(q('#wind-speed-input'), (val) => {
      appState.updateActiveEnvironment({ windSpeedMs: Number((isImp ? val / 2.23694 : val).toFixed(2)) });
    });
    bindNumber(q('#wind-dir-input'), (val) => appState.updateActiveEnvironment({ windDirectionDeg: val % 360 }));

    // Reticle Controls
    const retTypeSel = this.container.querySelector('#reticle-type-select');
    retTypeSel?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      if (p.optic) p.optic.reticle = e.target.value;
      appState.save();
      this.reticle?.update({ reticleType: e.target.value });
    });
    const fpSel = this.container.querySelector('#focal-plane-select');
    fpSel?.addEventListener('change', (e) => {
      const p = appState.getActiveProfile();
      if (p.optic) p.optic.focalPlane = e.target.value;
      appState.save();
      this.reticle?.update({ focalPlane: e.target.value });
    });
    const illumCheck = this.container.querySelector('#illum-check');
    illumCheck?.addEventListener('change', (e) => {
      this.illuminated = e.target.checked;
      this.reticle?.update({ illuminated: e.target.checked });
    });
    const magSlider = this.container.querySelector('#mag-slider');
    const magDisp = this.container.querySelector('#mag-display');
    magSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      magDisp.textContent = `${val}×`;
      const p = appState.getActiveProfile();
      if (p.optic) p.optic.currentMagnification = val;
      appState.save();
      this.reticle?.update({ magnification: val });
    });

    // Turret Controls Buttons
    const btnTurretZero = this.container.querySelector('#btn-turret-zero');
    btnTurretZero?.addEventListener('click', () => {
      this._setTurretMode('manual', false);
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
    const clickValRad = profile.optic?.clickValueRad || 0.0001;
    // 1.0 MRAD or 1.0 MOA worth of clicks
    const opticIsMrad = !/moa/i.test(profile.optic?.clickName || '');
    const majorClicks = opticIsMrad
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
    btnTurretMatch?.addEventListener('click', () => this._setTurretMode('auto'));
    this.container.querySelector('#turret-mode')?.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-turret-mode]');
      if (tab) this._setTurretMode(tab.dataset.turretMode);
    });

    // Chart Tabs
    this.container.querySelector('.chart-metric')?.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-metric]');
      if (!tab) return;
      this.chartMetric = tab.dataset.metric;
      this._saveUiPrefs();
      this.container.querySelectorAll('.chart-metric [data-metric]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      if (this.activeSolution) this._renderChart(this.activeSolution, appState.state.target.distanceM);
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
      appState.state.customDopeRanges = Array.from(this.selectedRanges || []).sort((x, y) => x - y);
      appState.save();
      window.location.hash = '#dopeStudio';
    });

    // Export CSV
    const csvBtn = this.container.querySelector('#export-csv-btn');
    csvBtn?.addEventListener('click', () => this.exportCsv());
  }
}
