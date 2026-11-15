/**
 * Ballistic Workbench - DOPE Studio & Tactical Range Card Generator
 * Produces 5 print-ready tactical ballistic cards:
 * 1. Scope Cap Insert (Circular SVG with caliber & elevation dial ticks)
 * 2. Tactical Wrist Coach (Arm board for PRS / NRL competition)
 * 3. Stock Tape (Cheekpiece adhesive strip)
 * 4. Authentic Tactical Wrist Coach / Arm Board PRS Match Stage Card & Interactive Stage Builder
 * 5. Comprehensive A4 Master Precision Rifle Data Sheet
 */

import { appState } from '../core/state.js';
import { esc } from '../core/escape.js';
import { shapeLike } from '../core/sanitize.js';
import { UnitConverter } from '../core/units.js';
import { getAtmosphericConditions } from '../physics/atmosphere.js';
import { solveTrajectory, solveZeroAngle } from '../physics/solvers.js';

const PRS_STAGE_STORAGE_KEY = 'ballistic_workbench_prs_stage_v2';

function formatDec(val, dec = 1) {
  if (val === undefined || val === null || isNaN(val)) return (0).toFixed(dec);
  const threshold = Math.pow(10, -dec) / 2;
  if (Math.abs(val) < threshold) {
    return (0).toFixed(dec);
  }
  return Number(val).toFixed(dec);
}

export class DopeStudioView {
  constructor(containerElement) {
    this.container = containerElement;
    this.activeFormat = 'scope-cap'; // 'scope-cap' | 'wrist-coach' | 'stock-tape' | 'prs-stage' | 'a4-sheet'
    this.scopeCapDiameterMm = 43.9; // Standard Butler Creek #19 size
    this.printOrientation = 'portrait-3x5'; // 'portrait-3x5' | 'landscape-5x3' | 'full-page'
    this.builderCollapsed = false;
    this.cardTheme = 'tactical-night'; // 'tactical-night' | 'milspec-od' | 'match-day'
    this.highlightedTargetIdx = null;

    // Standard Match Stage Presets
    this.presets = {
      'rooftop-barricade': {
        id: 'rooftop-barricade',
        name: 'Stage 4: Rooftop & Barricade',
        timeLimitSec: 90,
        propsDescription: 'Pos 1: Tank Trap (2) ➔ Pos 2: Cable Spool (2) ➔ Pos 3: Barricade (3) ➔ Pos 4: Rooftop (3)',
        windBaseMs: 4.0,
        windLullMs: 2.0,
        windGustMs: 6.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'T1 - Center Gong', shape: 'gong', distanceM: 380, widthCm: 30, heightCm: 30, rounds: 2, prop: 'Pos 1: Tank Trap', notes: 'Center hold', offsetM: 0 },
          { id: 't2', name: 'T2 - IPSC Left', shape: 'ipsc', distanceM: 520, widthCm: 45, heightCm: 75, rounds: 2, prop: 'Pos 2: Spool', notes: 'Left edge if gusting', offsetM: -18 },
          { id: 't3', name: 'T3 - Diamond Popper', shape: 'diamond', distanceM: 640, widthCm: 30, heightCm: 30, rounds: 3, prop: 'Pos 3: Barricade', notes: 'Small plate - steady bag', offsetM: 15 },
          { id: 't4', name: 'T4 - Far Gong', shape: 'gong', distanceM: 780, widthCm: 40, heightCm: 40, rounds: 3, prop: 'Pos 4: Rooftop', notes: 'Watch mirage / splash', offsetM: 5 },
        ],
      },
      'troop-line': {
        id: 'troop-line',
        name: 'Stage 2: Troop Line',
        timeLimitSec: 90,
        propsDescription: 'Prone from Mat: 2 rounds each near to far (10 rnds total)',
        windBaseMs: 4.0,
        windLullMs: 2.0,
        windGustMs: 6.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'T1 - 300m Gong', shape: 'gong', distanceM: 300, widthCm: 30, heightCm: 30, rounds: 2, prop: 'Prone Mat', notes: 'Fast cadence', offsetM: -12 },
          { id: 't2', name: 'T2 - 400m Gong', shape: 'gong', distanceM: 400, widthCm: 35, heightCm: 35, rounds: 2, prop: 'Prone Mat', notes: 'Smooth trigger squeeze', offsetM: -6 },
          { id: 't3', name: 'T3 - 500m Gong', shape: 'gong', distanceM: 500, widthCm: 40, heightCm: 40, rounds: 2, prop: 'Prone Mat', notes: 'Check wind flag', offsetM: 0 },
          { id: 't4', name: 'T4 - 600m Gong', shape: 'gong', distanceM: 600, widthCm: 45, heightCm: 45, rounds: 2, prop: 'Prone Mat', notes: 'Steady follow-through', offsetM: 8 },
          { id: 't5', name: 'T5 - 700m Gong', shape: 'gong', distanceM: 700, widthCm: 50, heightCm: 50, rounds: 2, prop: 'Prone Mat', notes: 'Watch bullet trace', offsetM: 16 },
        ],
      },
      'kyl-rack': {
        id: 'kyl-rack',
        name: 'Stage 5: KYL Rack (Know Your Limits)',
        timeLimitSec: 90,
        propsDescription: 'Pos 1: Modified Prone - 2 shots per circle, decreasing size, stop on miss',
        windBaseMs: 3.5,
        windLullMs: 1.5,
        windGustMs: 5.5,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'T1 - 30cm (12") KYL', shape: 'kyl', distanceM: 400, widthCm: 30, heightCm: 30, rounds: 2, prop: 'Mod Prone', notes: '10 pts - free hit', offsetM: -16 },
          { id: 't2', name: 'T2 - 25cm (10") KYL', shape: 'kyl', distanceM: 400, widthCm: 25, heightCm: 25, rounds: 2, prop: 'Mod Prone', notes: '20 pts - center hold', offsetM: -8 },
          { id: 't3', name: 'T3 - 20cm (8") KYL', shape: 'kyl', distanceM: 400, widthCm: 20, heightCm: 20, rounds: 2, prop: 'Mod Prone', notes: '30 pts - steady rear bag', offsetM: 0 },
          { id: 't4', name: 'T4 - 15cm (6") KYL', shape: 'kyl', distanceM: 400, widthCm: 15, heightCm: 15, rounds: 2, prop: 'Mod Prone', notes: '40 pts - wait on lull', offsetM: 8 },
          { id: 't5', name: 'T5 - 10cm (4") KYL', shape: 'kyl', distanceM: 400, widthCm: 10, heightCm: 10, rounds: 2, prop: 'Mod Prone', notes: '50 pts - risk/reward bank', offsetM: 16 },
        ],
      },
      'far-to-near': {
        id: 'far-to-near',
        name: 'Stage 3: Far-to-Near Barricade',
        timeLimitSec: 105,
        propsDescription: 'Pos 1: Tank Trap (2) ➔ Pos 2: Spool (2) ➔ Pos 3: Barricade (3) ➔ Pos 4: Rooftop (3)',
        windBaseMs: 4.5,
        windLullMs: 2.0,
        windGustMs: 7.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'T1 - Far IPSC Torso', shape: 'ipsc', distanceM: 750, widthCm: 45, heightCm: 75, rounds: 2, prop: 'Pos 1: Tank Trap', notes: 'Engage first before mirage kicks', offsetM: 14 },
          { id: 't2', name: 'T2 - Mid Diamond', shape: 'diamond', distanceM: 620, widthCm: 35, heightCm: 35, rounds: 2, prop: 'Pos 2: Spool', notes: 'Lock support elbow', offsetM: -18 },
          { id: 't3', name: 'T3 - Mid Square', shape: 'square', distanceM: 480, widthCm: 30, heightCm: 30, rounds: 3, prop: 'Pos 3: Barricade', notes: 'Quick dial, firm grip', offsetM: 8 },
          { id: 't4', name: 'T4 - Near Gong', shape: 'gong', distanceM: 350, widthCm: 25, heightCm: 25, rounds: 3, prop: 'Pos 4: Rooftop', notes: 'Sprint finish, rapid splits', offsetM: -10 },
        ],
      },
      'skills-stage': {
        id: 'skills-stage',
        name: 'PRS Skills Stage 1',
        timeLimitSec: 90,
        propsDescription: '2 Steel Targets: Low Barricade (3) ➔ Mid Barricade (4) ➔ High Barricade (3)',
        windBaseMs: 4.0,
        windLullMs: 2.0,
        windGustMs: 6.0,
        windDirectionDeg: 90,
        targets: [
          { id: 't1', name: 'T1 - Near Steel', shape: 'gong', distanceM: 380, widthCm: 30, heightCm: 30, rounds: 5, prop: 'Low/Mid/High Barricade', notes: 'Primary target (5 rnds)', offsetM: -12 },
          { id: 't2', name: 'T2 - Far IPSC', shape: 'ipsc', distanceM: 580, widthCm: 45, heightCm: 75, rounds: 5, prop: 'Low/Mid/High Barricade', notes: 'Secondary target (5 rnds)', offsetM: 16 },
        ],
      },
    };

    // Load active stage state
    this.prsStage = this._loadStageState();

    // Subscribe to central state updates (units, profile, atmosphere)
    this.unsubscribe = appState.subscribe((state, changeKey) => {
      if (changeKey === 'units' || changeKey === 'profile' || changeKey === 'environment' || changeKey === 'displayUnits') {
        this.render();
      }
    });

    this.render();
  }

  // Backward compatibility getter/setter for prsTargets
  get prsTargets() {
    return this.prsStage.targets;
  }
  set prsTargets(val) {
    if (this.prsStage) this.prsStage.targets = val;
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
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
            stage.targets = parsed.targets.slice(0, 30).map((t, i) => {
              const clean = shapeLike(t, { ...template.targets[0], id: `t${i + 1}`, offsetM: (i % 2 === 0 ? -1 : 1) * 12 });
              if (!['gong', 'ipsc', 'square', 'diamond', 'kyl'].includes(clean.shape)) clean.shape = 'gong';
              clean.rounds = Math.max(1, Math.min(20, Math.round(clean.rounds)));
              return clean;
            });
            return stage;
          }
        }
      } catch (e) {
        console.warn('Failed to parse saved PRS stage state:', e);
      }
    }
    // Deep clone default preset
    return JSON.parse(JSON.stringify(this.presets['rooftop-barricade']));
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
    this.activeFormat = format;
    this.render();
  }

  setPrintOrientation(orientation) {
    this.printOrientation = orientation;
    this.render();
  }

  setTheme(theme) {
    this.cardTheme = theme;
    this.render();
  }

  loadPreset(presetKey) {
    if (this.presets[presetKey]) {
      this.prsStage = JSON.parse(JSON.stringify(this.presets[presetKey]));
      this._saveStageState();
      this.render();
    }
  }

  /**
   * High-accuracy trajectory solver with custom wind override
   */
  computeDope(stepM = 10, maxRangeM = 1200, customWindSpeedMs = null, customWindDirDeg = null) {
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const atmos = getAtmosphericConditions({
      pressurePa: env.pressureHpa * 100,
      tempK: env.temperatureC + 273.15,
      relativeHumidity: env.humidityPercent / 100,
      altitudeM: env.altitudeM,
    });

    const zeroAngle = solveZeroAngle(profile, env, atmos.densityKgM3, atmos.speedOfSoundMs);
    const testProfile = { ...profile, zeroAngleRad: zeroAngle };

    const effectiveWindSpeed = customWindSpeedMs !== null ? customWindSpeedMs : (env.windSpeedMs || 4.0);
    const effectiveWindDir = customWindDirDeg !== null ? customWindDirDeg : (env.windDirectionDeg || 90.0);

    const testEnv = {
      ...env,
      windSpeedMs: effectiveWindSpeed,
      windDirectionDeg: effectiveWindDir,
      windZones: [
        { startM: 0, endM: 2500, speedMs: effectiveWindSpeed, directionDeg: effectiveWindDir },
      ],
    };

    const sol = solveTrajectory({
      profile: testProfile,
      environment: testEnv,
      airDensity: atmos.densityKgM3,
      speedOfSound: atmos.speedOfSoundMs,
      algorithm: profile.bullet.dragModel === 'G1' ? 'G1' : 'G7',
      stepM,
      maxRangeM,
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
   * Interpolate trajectory point at exact distance
   */
  interpolateTrajectory(traj, distanceM) {
    if (!traj || traj.length === 0) return null;
    if (distanceM <= traj[0].distanceM) return traj[0];
    if (distanceM >= traj[traj.length - 1].distanceM) return traj[traj.length - 1];

    let p0 = traj[0];
    let p1 = traj[traj.length - 1];

    for (let i = 0; i < traj.length - 1; i++) {
      if (traj[i].distanceM <= distanceM && traj[i + 1].distanceM >= distanceM) {
        p0 = traj[i];
        p1 = traj[i + 1];
        break;
      }
    }

    const span = Math.max(0.0001, p1.distanceM - p0.distanceM);
    const frac = Math.max(0, Math.min(1, (distanceM - p0.distanceM) / span));

    return {
      distanceM,
      dropM: p0.dropM + frac * (p1.dropM - p0.dropM),
      elevationRad: p0.elevationRad + frac * (p1.elevationRad - p0.elevationRad),
      elevationMrad: p0.elevationMrad + frac * (p1.elevationMrad - p0.elevationMrad),
      elevationMoa: p0.elevationMoa + frac * (p1.elevationMoa - p0.elevationMoa),
      elevationClicks: Math.round(p0.elevationClicks + frac * (p1.elevationClicks - p0.elevationClicks)),
      driftM: p0.driftM + frac * (p1.driftM - p0.driftM),
      windageRad: p0.windageRad + frac * (p1.windageRad - p0.windageRad),
      windageMrad: p0.windageMrad + frac * (p1.windageMrad - p0.windageMrad),
      windageMoa: p0.windageMoa + frac * (p1.windageMoa - p0.windageMoa),
      windageClicks: Math.round(p0.windageClicks + frac * (p1.windageClicks - p0.windageClicks)),
      velocityMs: p0.velocityMs + frac * (p1.velocityMs - p0.velocityMs),
      mach: p0.mach + frac * (p1.mach - p0.mach),
      energyJ: p0.energyJ + frac * (p1.energyJ - p0.energyJ),
      tofS: p0.tofS + frac * (p1.tofS - p0.tofS),
      dangerSpaceM: p0.dangerSpaceM + frac * (p1.dangerSpaceM - p0.dangerSpaceM),
    };
  }

  /**
   * Compute comprehensive ballistics for each target across Base, Lull, and Gust winds
   */
  computeStageBallistics(stage, baseDope, lullDope, gustDope, profile, isImperial) {
    const opticClickValRad = profile.optic?.clickValueRad || (isImperial ? 0.000072722 : 0.0001);
    const isOpticMoa = profile.optic?.clickName?.includes('MOA') || (isImperial && !profile.optic?.clickName?.includes('MRAD'));

    return stage.targets.map((t, idx) => {
      const pBase = this.interpolateTrajectory(baseDope.trajectory, t.distanceM);
      const pLull = this.interpolateTrajectory(lullDope.trajectory, t.distanceM);
      const pGust = this.interpolateTrajectory(gustDope.trajectory, t.distanceM);

      // Clicks calculation
      const dialClicks = Math.round(pBase.elevationRad / opticClickValRad);

      // Danger Space calculation based on exact target vertical height
      // Danger Space = TargetHeight / flightAngle. Larger target height -> larger danger space window.
      const targetHeightM = Math.max(0.05, (t.heightCm || t.widthCm || 30) / 100);
      const flightAngle = Math.max(0.0015, Math.abs(pBase.dropM) / Math.max(1, t.distanceM));
      const dangerSpaceM = Math.min(250, targetHeightM / flightAngle);
      const dangerSpaceDisplay = isImperial ? Math.round(UnitConverter.convert(dangerSpaceM, 'm', 'yd')) : Math.round(dangerSpaceM);

      // 3-Way Wind holds (MRAD and MOA)
      const lullHold = isOpticMoa ? Math.abs(pLull.windageMoa) : Math.abs(pLull.windageMrad);
      const baseHold = isOpticMoa ? Math.abs(pBase.windageMoa) : Math.abs(pBase.windageMrad);
      const gustHold = isOpticMoa ? Math.abs(pGust.windageMoa) : Math.abs(pGust.windageMrad);

      // Hold direction indicator (L / R)
      // If wind is from 90° (from right), bullet drifts left, so hold into wind is RIGHT (R / ▶)
      const isHoldRight = pBase.windageRad >= 0;
      const holdDirLabel = isHoldRight ? 'R' : 'L';
      const holdArrow = isHoldRight ? '▶' : '◀';

      // Dial value formatted
      const dialFormatted = isOpticMoa ? formatDec(pBase.elevationMoa, 1) : formatDec(pBase.elevationMrad, 1);
      const dialUnit = isOpticMoa ? 'MOA' : 'MRAD';

      // Display distance
      const displayDistance = isImperial ? Math.round(UnitConverter.convert(t.distanceM, 'm', 'yd')) : Math.round(t.distanceM);
      const displayDistUnit = isImperial ? 'yd' : 'm';

      // Display target size
      const displayWidth = isImperial ? Math.round(t.widthCm / 2.54) : t.widthCm;
      const displayHeight = isImperial ? Math.round(t.heightCm / 2.54) : t.heightCm;
      const displaySizeUnit = isImperial ? '"' : 'cm';

      // Angular Target Size in MIL and MOA
      const widthM = (t.widthCm || 30) / 100;
      const heightM = (t.heightCm || 30) / 100;
      const distM = Math.max(1, t.distanceM);
      const mradW = (widthM / distM) * 1000;
      const mradH = (heightM / distM) * 1000;
      const angularSizeDisplay = isOpticMoa
        ? `${(mradW * 3.43775).toFixed(1)}×${(mradH * 3.43775).toFixed(1)} MOA`
        : `${mradW.toFixed(1)}×${mradH.toFixed(1)} MIL`;

      // Display velocity and energy
      const displayVel = isImperial ? Math.round(UnitConverter.convert(pBase.velocityMs, 'm/s', 'fps')) : Math.round(pBase.velocityMs);
      const displayVelUnit = isImperial ? 'fps' : 'm/s';
      const displayEnergy = isImperial ? Math.round(UnitConverter.convert(pBase.energyJ, 'J', 'ft-lb')) : Math.round(pBase.energyJ);
      const displayEnergyUnit = isImperial ? 'ft-lb' : 'J';

      return {
        ...t,
        index: idx + 1,
        displayDistance,
        displayDistUnit,
        displayWidth,
        displayHeight,
        displaySizeUnit,
        angularSizeDisplay,
        elevationRad: pBase.elevationRad,
        dialValue: dialFormatted,
        dialUnit,
        clicks: dialClicks,
        dangerSpaceDisplay,
        dangerSpaceM,
        lullHold: lullHold.toFixed(1),
        baseHold: baseHold.toFixed(1),
        gustHold: gustHold.toFixed(1),
        holdDirLabel,
        holdArrow,
        tofS: pBase.tofS.toFixed(3),
        velocity: displayVel,
        velocityUnit: displayVelUnit,
        energy: displayEnergy,
        energyUnit: displayEnergyUnit,
      };
    });
  }

  /**
   * Render vector SVG silhouette for target shapes
   */
  renderTargetSilhouetteSvg(shape, size = 24, color = 'currentColor') {
    switch (shape) {
      case 'ipsc':
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 44" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" class="silhouette-svg silhouette-ipsc">
          <polygon points="12,3 24,3 24,10 33,16 33,41 3,41 3,16 12,10" fill="${color}" fill-opacity="0.25" />
          <rect x="11" y="16" width="14" height="18" rx="1" stroke-width="1.2" stroke-dasharray="2,2" />
        </svg>`;
      case 'square':
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="${color}" stroke-width="2" class="silhouette-svg silhouette-square">
          <rect x="6" y="9" width="24" height="24" rx="2" fill="${color}" fill-opacity="0.25" />
          <circle cx="11" cy="14" r="1.5" fill="${color}" />
          <circle cx="25" cy="14" r="1.5" fill="${color}" />
          <line x1="11" y1="2" x2="11" y2="9" stroke="${color}" stroke-width="1.5" />
          <line x1="25" y1="2" x2="25" y2="9" stroke="${color}" stroke-width="1.5" />
        </svg>`;
      case 'diamond':
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="${color}" stroke-width="2" class="silhouette-svg silhouette-diamond">
          <polygon points="18,5 31,18 18,31 5,18" fill="${color}" fill-opacity="0.25" />
          <circle cx="18" cy="9" r="1.5" fill="${color}" />
          <line x1="18" y1="1" x2="18" y2="6" stroke="${color}" stroke-width="1.5" />
        </svg>`;
      case 'kyl':
        return `<svg width="${size}" height="${size * 0.75}" viewBox="0 0 44 32" fill="none" stroke="${color}" stroke-width="1.8" class="silhouette-svg silhouette-kyl">
          <line x1="2" y1="4" x2="42" y2="4" stroke-width="2.5" stroke="${color}" />
          <line x1="7" y1="4" x2="7" y2="10" stroke-width="1.5" />
          <circle cx="7" cy="18" r="7" fill="${color}" fill-opacity="0.25" />
          <line x1="19" y1="4" x2="19" y2="12" stroke-width="1.5" />
          <circle cx="19" cy="18" r="5.5" fill="${color}" fill-opacity="0.25" />
          <line x1="29" y1="4" x2="29" y2="14" stroke-width="1.5" />
          <circle cx="29" cy="18" r="4" fill="${color}" fill-opacity="0.25" />
          <line x1="37" y1="4" x2="37" y2="16" stroke-width="1.5" />
          <circle cx="37" cy="18" r="2.5" fill="${color}" fill-opacity="0.25" />
        </svg>`;
      case 'gong':
      default:
        return `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="${color}" stroke-width="2" class="silhouette-svg silhouette-gong">
          <circle cx="18" cy="20" r="13" fill="${color}" fill-opacity="0.25" />
          <rect x="10" y="3" width="3.5" height="5" rx="0.8" fill="${color}" />
          <rect x="22.5" y="3" width="3.5" height="5" rx="0.8" fill="${color}" />
          <line x1="11.75" y1="1" x2="11.75" y2="4" stroke="${color}" stroke-width="1.5" />
          <line x1="24.25" y1="1" x2="24.25" y2="4" stroke="${color}" stroke-width="1.5" />
        </svg>`;
    }
  }

  /**
   * Render inline SVG node silhouette for downrange schematic map
   */
  _renderSchematicNodeSilhouette(shape) {
    switch (shape) {
      case 'ipsc':
        return `<polygon points="-4,-7 4,-7 4,-3 7,0 7,9 -7,9 -7,0 -4,-3" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1.2" />`;
      case 'square':
        return `<rect x="-6" y="-4" width="12" height="12" rx="1.5" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1.2" />
                <line x1="-4" y1="-7" x2="-4" y2="-4" stroke="#38bdf8" stroke-width="1" />
                <line x1="4" y1="-7" x2="4" y2="-4" stroke="#38bdf8" stroke-width="1" />`;
      case 'diamond':
        return `<polygon points="0,-7 7,0 0,7 -7,0" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1.2" />`;
      case 'kyl':
        return `<line x1="-8" y1="-6" x2="8" y2="-6" stroke="#38bdf8" stroke-width="1.6" />
                <circle cx="-5" cy="0" r="3.2" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1" />
                <circle cx="0" cy="1" r="2.4" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1" />
                <circle cx="4.5" cy="1.6" r="1.6" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1" />`;
      case 'gong':
      default:
        return `<circle cx="0" cy="1" r="6.5" fill="#38bdf8" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1.2" />
                <line x1="-3" y1="-6" x2="-3" y2="-2" stroke="#38bdf8" stroke-width="1" />
                <line x1="3" y1="-6" x2="3" y2="-2" stroke="#38bdf8" stroke-width="1" />`;
    }
  }

  /**
   * Render Visual Target Sequence Schematic SVG Map with shape silhouettes and collision avoidance
   */
  renderStageSchematicSvg(stage, targetsWithBallistics, dope, isImperial) {
    if (!targetsWithBallistics || targetsWithBallistics.length === 0) return '';

    const distUnit = isImperial ? 'yd' : 'm';
    const distances = targetsWithBallistics.map((t) => t.distanceM);
    const minD = Math.max(0, Math.min(...distances) - 50);
    const maxD = Math.max(...distances) + 50;
    const spanD = Math.max(100, maxD - minD);

    const isAllSameDist = Math.max(...distances) - Math.min(...distances) < 15;
    const staggerOffsets = [220, 340, 180, 390, 260, 310, 190, 370];

    const points = targetsWithBallistics.map((t, idx) => {
      const norm = (t.distanceM - minD) / spanD;
      const y = Math.round(145 - norm * 105);
      let x;
      if (isAllSameDist) {
        // KYL rack or single-distance stages: space plates comfortably across corridor (170px to 370px)
        const count = targetsWithBallistics.length;
        const spacing = Math.min(50, 240 / Math.max(1, count - 1));
        const startX = 270 - ((count - 1) * spacing) / 2;
        x = Math.round(startX + idx * spacing);
      } else if (t.offsetM !== undefined) {
        x = Math.round(270 + t.offsetM * 4.5);
      } else {
        x = staggerOffsets[idx % staggerOffsets.length];
      }
      x = Math.max(70, Math.min(460, x));
      return { ...t, x, y };
    });

    // Sequence connection path (T1 ➔ T2 ➔ T3...)
    const pathD = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    // Range grid lines
    const stepGrid = spanD > 450 ? 100 : 50;
    const firstGrid = Math.ceil(minD / stepGrid) * stepGrid;
    let gridSvg = '';
    for (let g = firstGrid; g <= maxD; g += stepGrid) {
      const gy = Math.round(145 - ((g - minD) / spanD) * 105);
      const displayGridDist = isImperial ? Math.round(g * 1.09361) : g;
      gridSvg += `
        <line x1="45" y1="${gy}" x2="520" y2="${gy}" stroke="rgba(148, 163, 184, 0.16)" stroke-dasharray="3,3" />
        <text x="12" y="${gy + 3}" font-family="monospace" font-size="8.5" fill="#64748b" text-anchor="start">${displayGridDist}${distUnit}</text>
      `;
    }

    // KYL Rack Crossbar (if KYL targets share same range)
    let kylBarSvg = '';
    if (isAllSameDist && points.length > 1 && points[0].shape === 'kyl') {
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const yRack = points[0].y;
      kylBarSvg = `<line x1="${minX - 14}" y1="${yRack - 8}" x2="${maxX + 14}" y2="${yRack - 8}" stroke="#475569" stroke-width="2.5" stroke-linecap="round" />`;
    }

    // Target nodes and collision-free callout badges
    const isHighVis = this.cardTheme === 'match-day';
    let targetsSvg = '';
    points.forEach((p, idx) => {
      // Alternate callouts above/below and left/right for collision avoidance
      const isTop = idx % 2 === 0;
      let calloutY = isTop ? p.y - 28 : p.y + 16;
      if (p.y < 38) calloutY = p.y + 16;
      if (p.y > 132) calloutY = p.y - 28;

      const isLeft = (idx % 2 === 0) || (p.offsetM !== undefined && p.offsetM < 0);
      let calloutX = isLeft ? p.x - 92 : p.x + 14;
      // Avoid top-right wind HUD collision (x: 440-520, y: 10-60)
      if (calloutX > 380 && calloutY < 65) {
        calloutX = p.x - 92;
      }
      calloutX = Math.max(15, Math.min(435, calloutX));

      targetsSvg += `
        <g class="schematic-node ${this.highlightedTargetIdx === idx ? 'highlighted' : ''}" data-target-idx="${idx}" data-target-id="${esc(p.id)}">
          <!-- Node Center Glow & Silhouetted Shape -->
          <g transform="translate(${p.x}, ${p.y})">
            <circle cx="0" cy="0" r="14" fill="${isHighVis ? '#ffffff' : '#0b111e'}" stroke="${isHighVis ? '#0284c7' : '#1e293b'}" stroke-width="2" />
            ${this._renderSchematicNodeSilhouette(p.shape)}
            <!-- Target Number Badge -->
            <rect x="-9" y="8" width="18" height="10" rx="2" fill="${isHighVis ? '#0284c7' : '#0f172a'}" stroke="${isHighVis ? '#0284c7' : '#38bdf8'}" stroke-width="0.8" />
            <text x="0" y="16" font-family="monospace" font-size="7" font-weight="bold" fill="${isHighVis ? '#ffffff' : '#38bdf8'}" text-anchor="middle">T${p.index}</text>
          </g>

          <!-- Node Callout Pill (Distance + Dial Value) -->
          <g transform="translate(${calloutX}, ${calloutY})">
            <rect x="0" y="0" width="88" height="18" rx="3" fill="${isHighVis ? '#ffffff' : 'rgba(15, 23, 42, 0.94)'}" stroke="${isHighVis ? '#cbd5e1' : '#334155'}" stroke-width="1" />
            <text x="44" y="12" font-family="monospace" font-size="7.5" font-weight="bold" fill="${isHighVis ? '#0f172a' : '#f8fafc'}" text-anchor="middle">
              ${p.displayDistance}${p.displayDistUnit} • <tspan fill="${isHighVis ? '#b45309' : '#f59e0b'}">${p.dialValue} ${p.dialUnit}</tspan>
            </text>
          </g>
        </g>
      `;
    });

    // Wind direction arrow & HUD
    const windDeg = stage.windDirectionDeg !== undefined ? stage.windDirectionDeg : 90;
    const windRad = (windDeg * Math.PI) / 180;
    const windX1 = 490 - Math.cos(windRad) * 11;
    const windY1 = 26 - Math.sin(windRad) * 11;
    const windX2 = 490 + Math.cos(windRad) * 11;
    const windY2 = 26 + Math.sin(windRad) * 11;

    const windSpeedDisplay = isImperial ? Math.round(UnitConverter.convert(stage.windBaseMs, 'm/s', 'mph')) : stage.windBaseMs;
    const windSpeedUnit = isImperial ? 'mph' : 'm/s';
    const clockHour = Math.round(windDeg / 30) || 12;

    return `
      <div class="stage-schematic-container">
        <svg viewBox="0 0 540 180" width="100%" class="stage-schematic-svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
            </marker>
          </defs>

          <!-- Range Corridor Backdrop -->
          <rect x="5" y="5" width="530" height="170" rx="6" fill="${isHighVis ? '#f8fafc' : '#070c16'}" stroke="${isHighVis ? '#cbd5e1' : '#1e293b'}" stroke-width="1" />

          <!-- Center Corridor Azimuth Baseline -->
          <line x1="270" y1="20" x2="270" y2="155" stroke="${isHighVis ? 'rgba(2, 132, 199, 0.15)' : 'rgba(56, 189, 248, 0.08)'}" stroke-dasharray="4,4" />

          <!-- Range Distance Grid Lines -->
          ${gridSvg}

          <!-- KYL Rack Bar (if applicable) -->
          ${kylBarSvg}

          <!-- Sequence Polyline connecting targets -->
          <path d="${pathD}" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="4,3" marker-mid="url(#seq-arrow)" opacity="0.9" />

          <!-- Target Nodes -->
          ${targetsSvg}

          <!-- Firing Line at Bottom with Prop Indicators -->
          <line x1="45" y1="162" x2="520" y2="162" stroke="${isHighVis ? '#0284c7' : '#38bdf8'}" stroke-width="2" />
          <circle cx="270" cy="162" r="3.5" fill="${isHighVis ? '#0284c7' : '#38bdf8'}" />
          <text x="270" y="174" font-family="sans-serif" font-size="7.5" font-weight="bold" fill="${isHighVis ? '#475569' : '#94a3b8'}" text-anchor="middle" letter-spacing="1">FIRING LINE • PROP POSITIONS</text>

          <!-- Wind Vector HUD Indicator in Top Right -->
          <g class="schematic-wind-hud" transform="translate(488, 26)">
            <circle cx="0" cy="0" r="16" fill="${isHighVis ? '#ffffff' : 'rgba(15, 23, 42, 0.9)'}" stroke="${isHighVis ? '#cbd5e1' : '#334155'}" stroke-width="1" />
            <!-- Wind vector arrow line -->
            <line x1="${(windX1 - 490).toFixed(1)}" y1="${(windY1 - 26).toFixed(1)}" x2="${(windX2 - 490).toFixed(1)}" y2="${(windY2 - 26).toFixed(1)}" stroke="${isHighVis ? '#059669' : '#10b981'}" stroke-width="2" stroke-linecap="round" />
            <polygon points="${(windX2 - 490).toFixed(1)},${(windY2 - 26).toFixed(1)} ${((windX2 - 490) - 4).toFixed(1)},${((windY2 - 26) - 3).toFixed(1)} ${((windX2 - 490) - 4).toFixed(1)},${((windY2 - 26) + 3).toFixed(1)}" fill="${isHighVis ? '#059669' : '#10b981'}" />
            <text x="0" y="-19" font-family="sans-serif" font-size="7" font-weight="bold" fill="${isHighVis ? '#059669' : '#10b981'}" text-anchor="middle">WIND ${windSpeedDisplay}${windSpeedUnit}</text>
            <text x="0" y="25" font-family="sans-serif" font-size="6.5" fill="${isHighVis ? '#475569' : '#94a3b8'}" text-anchor="middle">${windDeg}° (${clockHour}:00)</text>
          </g>
        </svg>
      </div>
    `;
  }

  /**
   * Render Par Time Pacing Breakdown Bar for PRS stages
   */
  _renderParTimeFlow(stage, totalRounds, timeLimitSec) {
    if (!stage.targets || stage.targets.length === 0 || totalRounds <= 0) return '';

    // Group target rounds by distinct props
    const propGroups = [];
    stage.targets.forEach((t) => {
      const propName = t.prop || 'Position';
      const existing = propGroups.find((g) => g.prop === propName);
      if (existing) {
        existing.rounds += (Number(t.rounds) || 2);
        existing.targets.push(t.name);
      } else {
        propGroups.push({ prop: propName, rounds: Number(t.rounds) || 2, targets: [t.name] });
      }
    });

    const secPerRound = timeLimitSec / totalRounds;
    let accumulatedSec = 0;

    const splits = propGroups.map((g) => {
      const startSec = Math.round(accumulatedSec);
      accumulatedSec += g.rounds * secPerRound;
      const endSec = Math.round(accumulatedSec);
      return `<div class="pace-split-pill">
        <span class="split-prop-name">${esc(g.prop)}</span>
        <span class="split-time">${startSec}s–${endSec}s <span class="split-rnds">(${g.rounds}r)</span></span>
      </div>`;
    }).join('<span class="split-arrow">➔</span>');

    return `
      <div class="par-time-flow-bar">
        <span class="flow-tag">PAR PACING:</span>
        <div class="pace-splits-container">${splits}</div>
      </div>
    `;
  }

  /**
   * Render Visual Tactical Wrist Coach / Arm Board PRS Match Stage Card & Interactive Builder
   */
  renderPrsStage(dope) {
    const isImperial = appState.state.systemUnits === 'imperial';
    const profile = dope.profile;
    const stage = this.prsStage;

    const windDir = stage.windDirectionDeg !== undefined ? stage.windDirectionDeg : 90;

    // Run Trajectories for Base, Lull, and Gust winds
    const baseDope = this.computeDope(10, 1200, stage.windBaseMs, windDir);
    const lullDope = this.computeDope(10, 1200, stage.windLullMs, windDir);
    const gustDope = this.computeDope(10, 1200, stage.windGustMs, windDir);

    // Compute ballistics for each target
    const targetsWithBallistics = this.computeStageBallistics(stage, baseDope, lullDope, gustDope, profile, isImperial);

    // Summary calculations
    const totalRounds = stage.targets.reduce((sum, t) => sum + (Number(t.rounds) || 0), 0);
    const targetCount = stage.targets.length;
    const timeLimitSec = Number(stage.timeLimitSec) || 90;
    const paceSecPerShot = totalRounds > 0 ? (timeLimitSec / totalRounds).toFixed(1) : '--';
    const minDistanceM = Math.min(...stage.targets.map((t) => t.distanceM));
    const maxDistanceM = Math.max(...stage.targets.map((t) => t.distanceM));
    const distSpan = isImperial
      ? `${Math.round(UnitConverter.convert(minDistanceM, 'm', 'yd'))} - ${Math.round(UnitConverter.convert(maxDistanceM, 'm', 'yd'))} yd`
      : `${minDistanceM} - ${maxDistanceM} m`;

    const opticDialUnit = profile.optic?.clickName?.includes('MOA') || (isImperial && !profile.optic?.clickName?.includes('MRAD')) ? 'MOA' : 'MRAD';
    const daFormatted = Math.round(dope.atmos.densityAltitudeM);

    const windUnit = isImperial ? 'mph' : 'm/s';
    const windBaseDisplay = isImperial ? Math.round(UnitConverter.convert(stage.windBaseMs, 'm/s', 'mph')) : stage.windBaseMs;
    const windLullDisplay = isImperial ? Math.round(UnitConverter.convert(stage.windLullMs, 'm/s', 'mph')) : stage.windLullMs;
    const windGustDisplay = isImperial ? Math.round(UnitConverter.convert(stage.windGustMs, 'm/s', 'mph')) : stage.windGustMs;

    return `
      <div class="prs-stage-workspace">
        <!-- TOP TOOLBAR & QUICK ACTIONS -->
        <div class="card-meta-bar no-print">
          <div class="meta-left">
            <span class="meta-title">🎯 Tactical Wrist Coach / Arm Board Card</span>
            <span class="meta-badge">${targetCount} Targets • ${totalRounds} Rnds • ${timeLimitSec}s</span>
          </div>

          <div class="meta-center">
            <!-- Orientation Switcher -->
            <div class="orientation-toggle-group">
              <button class="btn-orientation ${this.printOrientation === 'portrait-3x5' ? 'active' : ''}" data-orientation="portrait-3x5" title="Standard 3x5 inch forearm sleeve format">3"x5" Wrist</button>
              <button class="btn-orientation ${this.printOrientation === 'landscape-5x3' ? 'active' : ''}" data-orientation="landscape-5x3" title="5x3 inch horizontal arm board format">5"x3" Board</button>
              <button class="btn-orientation ${this.printOrientation === 'full-page' ? 'active' : ''}" data-orientation="full-page" title="Full size clipboard match sheet">Full Page</button>
            </div>

            <!-- Card Theme Switcher -->
            <div class="theme-toggle-group">
              <button class="btn-theme-swatch ${this.cardTheme === 'tactical-night' ? 'active' : ''}" data-theme="tactical-night" title="Tactical Night Theme (OLED Black)">🌑 Night</button>
              <button class="btn-theme-swatch ${this.cardTheme === 'milspec-od' ? 'active' : ''}" data-theme="milspec-od" title="Mil-Spec OD Green Theme">🌲 Mil-Spec</button>
              <button class="btn-theme-swatch ${this.cardTheme === 'match-day' ? 'active' : ''}" data-theme="match-day" title="Match Day High-Vis White Theme">☀️ High-Vis</button>
            </div>
          </div>

          <div class="meta-right">
            <button id="btn-toggle-builder" class="btn-secondary-sm">
              ${this.builderCollapsed ? '⚙️ Open Stage Builder' : '🔼 Hide Builder'}
            </button>
            <button class="btn-secondary-sm" id="btn-copy-prs-brief" title="Copy text brief to clipboard">📋 Copy Brief</button>
            <button class="btn-secondary-sm" id="btn-export-prs-png" title="Export card as PNG image for phone">💾 Save PNG</button>
            <button class="btn-print">🖨️ Print Arm Card</button>
          </div>
        </div>

        <!-- INTERACTIVE STAGE BUILDER PANEL -->
        <div class="prs-builder-panel no-print ${this.builderCollapsed ? 'collapsed' : ''}" id="prs-builder-panel">
          <div class="builder-header">
            <div class="builder-title-group">
              <span class="builder-badge">STAGE BUILDER</span>
              <h3>Interactive Match Stage & Barricade Configurator</h3>
            </div>
            <div class="preset-pill-group">
              <span class="preset-label">1-Click Presets:</span>
              <button class="btn-preset ${stage.name.includes('Troop') ? 'active' : ''}" data-preset="troop-line">🎯 Troop Line (300-700m)</button>
              <button class="btn-preset ${stage.name.includes('KYL') ? 'active' : ''}" data-preset="kyl-rack">🎯 KYL Rack (400m)</button>
              <button class="btn-preset ${stage.name.includes('Far-to-Near') ? 'active' : ''}" data-preset="far-to-near">🎯 Far-to-Near Barricade</button>
              <button class="btn-preset ${stage.name.includes('Skills') ? 'active' : ''}" data-preset="skills-stage">🎯 PRS Skills Stage</button>
              <button class="btn-preset ${stage.name.includes('Rooftop') ? 'active' : ''}" data-preset="rooftop-barricade">🎯 Rooftop & Barricade</button>
            </div>
          </div>

          <!-- Stage Metadata Form Inputs -->
          <div class="builder-config-grid">
            <div class="input-field">
              <label for="input-stage-name">Stage Name / Title</label>
              <input type="text" id="input-stage-name" class="stage-form-input" value="${esc(stage.name)}" placeholder="e.g. Stage 4: Rooftop & Barricade" />
            </div>

            <div class="input-field input-field-sm">
              <label for="input-stage-timer">Stage Timer (s)</label>
              <input type="number" id="input-stage-timer" class="stage-form-input mono-num" value="${stage.timeLimitSec}" min="30" max="300" step="5" />
            </div>

            <div class="input-field input-field-sm">
              <label for="input-wind-direction">Wind Dir (°)</label>
              <input type="number" id="input-wind-direction" class="stage-form-input mono-num" value="${stage.windDirectionDeg !== undefined ? stage.windDirectionDeg : 90}" min="0" max="359" step="15" title="Wind direction in degrees (0 = Headwind, 90 = Right, 270 = Left)" />
            </div>

            <div class="input-field input-field-sm">
              <label for="input-wind-base">Base Wind (${windUnit})</label>
              <input type="number" id="input-wind-base" class="stage-form-input mono-num" value="${windBaseDisplay}" step="0.5" />
            </div>

            <div class="input-field input-field-sm">
              <label for="input-wind-lull">Lull Wind (${windUnit})</label>
              <input type="number" id="input-wind-lull" class="stage-form-input mono-num" value="${windLullDisplay}" step="0.5" />
            </div>

            <div class="input-field input-field-sm">
              <label for="input-wind-gust">Gust Wind (${windUnit})</label>
              <input type="number" id="input-wind-gust" class="stage-form-input mono-num" value="${windGustDisplay}" step="0.5" />
            </div>

            <!-- Wind Clock Angle Quick Presets -->
            <div class="input-field input-field-full">
              <div class="wind-dir-presets-row">
                <span class="preset-label">Quick Wind Angle:</span>
                <button class="btn-wind-dir-pill ${windDir === 90 ? 'active' : ''}" data-dir="90">90° (3:00 Right)</button>
                <button class="btn-wind-dir-pill ${windDir === 45 ? 'active' : ''}" data-dir="45">45° (1:30 Quarter)</button>
                <button class="btn-wind-dir-pill ${windDir === 0 ? 'active' : ''}" data-dir="0">0° (12:00 Head)</button>
                <button class="btn-wind-dir-pill ${windDir === 270 ? 'active' : ''}" data-dir="270">270° (9:00 Left)</button>
                <button class="btn-wind-dir-pill ${windDir === 180 ? 'active' : ''}" data-dir="180">180° (6:00 Tail)</button>
              </div>
            </div>

            <!-- Barricade Flow & Quick Prop Inserter -->
            <div class="input-field input-field-full">
              <label for="input-stage-props">Barricade Flow & Round Allocation</label>
              <input type="text" id="input-stage-props" class="stage-form-input" value="${esc(stage.propsDescription)}" placeholder="Pos 1: Tank Trap (2) ➔ Pos 2: Spool (2) ➔ Pos 3: Barricade (2)..." />
              <div class="quick-prop-tags-row">
                <span class="preset-label">Quick Insert:</span>
                <button class="btn-prop-tag" data-prop="Tank Trap">+ Tank Trap</button>
                <button class="btn-prop-tag" data-prop="Cable Spool">+ Cable Spool</button>
                <button class="btn-prop-tag" data-prop="Rooftop">+ Rooftop</button>
                <button class="btn-prop-tag" data-prop="Barricade">+ Barricade</button>
                <button class="btn-prop-tag" data-prop="Prone Mat">+ Prone Mat</button>
                <button class="btn-prop-tag" data-prop="Tires">+ Tires</button>
              </div>
            </div>
          </div>

          <!-- Target Sequence Editor Table -->
          <div class="builder-target-list-wrapper">
            <div class="builder-table-header-bar">
              <h4>Target Sequence Downrange (${targetCount} Targets, ${totalRounds} Rounds)</h4>
              <div class="builder-stats-pill">
                <span>Pace: <strong>${paceSecPerShot}s / shot</strong></span>
                <span>Span: <strong>${distSpan}</strong></span>
              </div>
            </div>

            <table class="builder-target-table">
              <thead>
                <tr>
                  <th class="w-45px">TGT</th>
                  <th class="w-95px">SHAPE</th>
                  <th>TARGET NAME</th>
                  <th class="w-85px">DIST (${isImperial ? 'yd' : 'm'})</th>
                  <th class="w-75px">SIZE (${isImperial ? 'in' : 'cm'})</th>
                  <th class="w-85px">OFFSET (m)</th>
                  <th class="w-55px">RNDS</th>
                  <th>PROP / BARRICADE</th>
                  <th>HOLD NOTES</th>
                  <th class="w-125px text-center">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                ${stage.targets.map((t, idx) => `
                  <tr data-target-idx="${idx}">
                    <td class="font-bold text-center">T${idx + 1}</td>
                    <td>
                      <select class="target-field-select target-shape-select" data-field="shape">
                        <option value="gong" ${t.shape === 'gong' ? 'selected' : ''}>Gong (Circle)</option>
                        <option value="ipsc" ${t.shape === 'ipsc' ? 'selected' : ''}>IPSC Torso</option>
                        <option value="square" ${t.shape === 'square' ? 'selected' : ''}>Square Plate</option>
                        <option value="diamond" ${t.shape === 'diamond' ? 'selected' : ''}>Diamond</option>
                        <option value="kyl" ${t.shape === 'kyl' ? 'selected' : ''}>KYL Rack</option>
                      </select>
                    </td>
                    <td>
                      <input type="text" class="target-field-input" data-field="name" value="${esc(t.name)}" />
                    </td>
                    <td>
                      <input type="number" class="target-field-input mono-num" data-field="distanceM" value="${isImperial ? Math.round(UnitConverter.convert(t.distanceM, 'm', 'yd')) : t.distanceM}" step="5" />
                    </td>
                    <td>
                      <input type="number" class="target-field-input mono-num" data-field="widthCm" value="${isImperial ? Math.round(t.widthCm / 2.54) : t.widthCm}" step="1" title="Width/Diameter" />
                    </td>
                    <td>
                      <input type="number" class="target-field-input mono-num" data-field="offsetM" value="${t.offsetM !== undefined ? t.offsetM : 0}" step="2" title="Lateral corridor offset in meters (- left, + right)" />
                    </td>
                    <td>
                      <input type="number" class="target-field-input mono-num text-center" data-field="rounds" value="${t.rounds || 2}" min="1" max="10" />
                    </td>
                    <td>
                      <input type="text" class="target-field-input" data-field="prop" value="${esc(t.prop || `Pos ${idx + 1}`)}" placeholder="e.g. Pos 1: Tank Trap" />
                    </td>
                    <td>
                      <input type="text" class="target-field-input" data-field="notes" value="${esc(t.notes || '')}" placeholder="Hold / Order note" />
                    </td>
                    <td class="text-center action-btn-cell">
                      <button class="btn-action-icon btn-move-up" data-idx="${idx}" title="Move Target Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                      <button class="btn-action-icon btn-move-down" data-idx="${idx}" title="Move Target Down" ${idx === stage.targets.length - 1 ? 'disabled' : ''}>▼</button>
                      <button class="btn-action-icon btn-clone-target" data-idx="${idx}" title="Duplicate Target">📋</button>
                      <button class="btn-action-icon btn-delete-target" data-idx="${idx}" title="Delete Target" ${stage.targets.length <= 1 ? 'disabled' : ''}>🗑️</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div class="builder-actions-bottom">
              <button class="btn-secondary-sm" id="btn-add-target">➕ Add Target Downrange</button>
              <button class="btn-secondary-sm" id="btn-reset-stage">🔄 Reset to Preset Default</button>
            </div>
          </div>
        </div>

        <!-- AUTHENTIC TACTICAL WRIST COACH SLEEVE FRAME -->
        <div class="arm-board-sleeve-frame ${this.printOrientation}">
          <div class="sleeve-strap-accent top"></div>

          <!-- THE AUTHENTIC ARM BOARD CARD (3"x5" / 5"x3" SLEEVE READY) -->
          <div class="prs-arm-board-card print-sheet ${this.printOrientation} theme-${this.cardTheme}" id="prs-arm-board-card">
            <!-- CORNER CROP MARKS FOR WATERPROOF SLEEVE TRIMMING -->
            <div class="card-crop-corner crop-tl">┌</div>
            <div class="card-crop-corner crop-tr">┐</div>
            <div class="card-crop-corner crop-bl">└</div>
            <div class="card-crop-corner crop-br">┘</div>

            <!-- WATERPROOF LAMINATION SEAM GUIDE -->
            <div class="lamination-guide-border">
              <!-- 1. HIGH-CONTRAST TACTICAL HEADER -->
              <div class="card-tactical-header">
                <div class="header-main-banner">
                  <div class="banner-title-block">
                    <span class="badge-stage-tag">PRS / NRL MATCH BRIEF</span>
                    <h2 class="stage-title-text">${esc(stage.name)}</h2>
                  </div>
                  <div class="tactical-pills-row">
                    <span class="tactical-pill pill-timer">⏱️ <strong>${timeLimitSec}s</strong></span>
                    <span class="tactical-pill pill-rounds">🎯 <strong>${totalRounds} RNDS</strong></span>
                    <span class="tactical-pill pill-targets">📍 <strong>${targetCount} TGTS</strong></span>
                    <span class="tactical-pill pill-pace">⚡ <strong>${paceSecPerShot}s/shot</strong></span>
                    <span class="tactical-pill pill-wind">💨 <strong>${windLullDisplay}/${windBaseDisplay}/${windGustDisplay} ${windUnit}</strong></span>
                  </div>
                </div>

                <!-- Rifle & Atmospheric Baseline Sub-Bar -->
                <div class="header-sub-meta">
                  <div class="meta-profile-str">
                    <strong>RIFLE:</strong> ${esc(profile.name)} • ${profile.bullet.weightGr}gr ${esc(profile.caliber)} (${profile.muzzleVelocityMs} m/s)
                  </div>
                  <div class="meta-atmos-str">
                    <strong>BASELINE:</strong> DA: ${daFormatted}m • ${dope.env.temperatureC}°C • ${dope.env.pressureHpa}hPa • Zero: ${profile.zeroDistanceM}m
                  </div>
                </div>

                <!-- Barricade / Prop Flow Sequence Bar -->
                <div class="barricade-flow-bar">
                  <span class="flow-tag">PROP FLOW:</span>
                  <span class="flow-desc">${esc(stage.propsDescription)}</span>
                </div>

                <!-- Suggested Stage Par Time Breakdown Bar -->
                ${this._renderParTimeFlow(stage, totalRounds, timeLimitSec)}
              </div>

              <!-- 2. DOWNRANGE TARGET SEQUENCE SCHEMATIC MAP WITH SHAPE SILHOUETTES -->
              ${this.renderStageSchematicSvg(stage, targetsWithBallistics, dope, isImperial)}

              <!-- 3. HIGH-CONTRAST TARGET MATRIX -->
              <table class="prs-target-matrix">
                <thead>
                  <tr>
                    <th class="col-tgt">TGT</th>
                    <th class="col-prop">PROP / ALLOC</th>
                    <th class="col-range">RANGE / SIZE</th>
                    <th class="col-elev">ELEVATION DIAL</th>
                    <th class="col-wind">WIND BRACKET (◀ LULL | BASE | GUST ▶)</th>
                    <th class="col-ballistics">TOF / VEL</th>
                    <th class="col-notes">NOTES / ORDER</th>
                  </tr>
                </thead>
                <tbody>
                  ${targetsWithBallistics.map((t, idx) => `
                    <tr class="matrix-row ${this.highlightedTargetIdx === idx ? 'highlighted' : ''}" data-target-idx="${idx}">
                      <!-- Target ID & Silhouette -->
                      <td class="cell-tgt">
                        <div class="tgt-badge-wrap">
                          <span class="tgt-num-badge">T${t.index}</span>
                          <div class="tgt-silhouette-icon">
                            ${this.renderTargetSilhouetteSvg(t.shape, 20)}
                          </div>
                        </div>
                        <div class="tgt-name-sub">${esc(t.name)}</div>
                      </td>

                      <!-- Prop Position & Shot Count -->
                      <td class="cell-prop">
                        <div class="prop-badge-pill">${esc(t.prop || `Pos ${t.index}`)}</div>
                        <div class="rounds-alloc-tag">⚡ <strong>${t.rounds}</strong> ${t.rounds > 1 ? 'shots' : 'shot'}</div>
                      </td>

                      <!-- Distance, Dimensions & Angular Size -->
                      <td class="cell-range">
                        <div class="dist-large-val">${t.displayDistance}<span class="dist-unit-sub">${t.displayDistUnit}</span></div>
                        <div class="size-sub-dim">${t.displayWidth}×${t.displayHeight}${t.displaySizeUnit}</div>
                        <div class="angular-size-dim">${t.angularSizeDisplay}</div>
                      </td>

                      <!-- Elevation Dial (Bold + Clicks + Danger Space) -->
                      <td class="cell-elev">
                        <div class="elev-dial-card">
                          <div class="dial-primary-num">${t.dialValue} <span class="dial-unit-lbl">${t.dialUnit}</span></div>
                          <div class="dial-sub-meta">
                            <span class="clicks-chip">[${t.clicks} clk]</span>
                            <span class="danger-space-chip" title="Danger Space range forgiveness">±${Math.round(t.dangerSpaceDisplay / 2)}${t.displayDistUnit}</span>
                          </div>
                        </div>
                      </td>

                      <!-- 3-Way Wind Brackets -->
                      <td class="cell-wind">
                        <div class="wind-bracket-pill">
                          <div class="wind-segment wind-lull">
                            <span class="wind-bracket-arrow">◀</span>
                            <span class="wind-val">${t.lullHold}</span>
                          </div>
                          <div class="wind-segment wind-base">
                            <span class="wind-dir-chip">${t.holdDirLabel}</span>
                            <span class="wind-val-bold">${t.baseHold}</span>
                          </div>
                          <div class="wind-segment wind-gust">
                            <span class="wind-val">${t.gustHold}</span>
                            <span class="wind-bracket-arrow">▶</span>
                          </div>
                        </div>
                        <div class="wind-unit-caption">${opticDialUnit} Hold into Wind (${windLullDisplay}/${windBaseDisplay}/${windGustDisplay} ${windUnit})</div>
                      </td>

                      <!-- Ballistics (TOF & Velocity) -->
                      <td class="cell-ballistics">
                        <div class="tof-val">${t.tofS}s</div>
                        <div class="vel-val">${t.velocity} ${t.velocityUnit}</div>
                      </td>

                      <!-- Prop & Shooter Hold Notes -->
                      <td class="cell-notes">
                        <div class="note-text-display">${esc(t.notes || '—')}</div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <!-- 4. TACTICAL FOOTER & SAFETY RULE REMINDERS -->
              <div class="card-tactical-footer">
                <div class="footer-callout">
                  <span>⚠️ CONFIRM ZERO BEFORE STAGE • CALL WIND AT SHOT BREAK • BOLT BACK ON TRANSITIONS</span>
                </div>
                <div class="footer-spec">
                  <span>3"x5" (75x125mm) WRIST COACH SLEEVE • BALLISTIC WORKBENCH</span>
                </div>
              </div>
            </div>
          </div>

          <div class="sleeve-strap-accent bottom"></div>
        </div>
        <p class="print-instructions no-print">Cut along the outer solid border and insert inside standard 3"x5" tactical wrist coach sleeve or stock pouch.</p>
      </div>
    `;
  }

  renderScopeCapSvg(dope) {
    const isImp = (dope?.sysUnits || appState.state.systemUnits) === 'imperial';
    const isMrad = (dope?.dispUnits || appState.state.displayUnits).elevationAngle === 'MRAD';
    const d = this.scopeCapDiameterMm;
    const radius = 245; // viewBox 0 0 500 500 (cx=250, cy=250)
    const customRanges = appState.state.customDopeRanges;
    let sample = customRanges && customRanges.length > 0
      ? dope.trajectory.filter((p) => customRanges.includes(p.distanceM))
      : dope.trajectory.filter((p) => p.distanceM >= 100 && p.distanceM <= 1000 && p.distanceM % 100 === 0);

    if (!sample || sample.length === 0) {
      sample = dope.trajectory.filter((p) => p.distanceM >= 100 && p.distanceM <= 1000 && p.distanceM % 100 === 0);
    }
    if (!sample || sample.length === 0) {
      sample = dope.trajectory.slice(0, 10);
    }

    let labelsSvg = '';
    const numPoints = sample.length;

    sample.forEach((pt, idx) => {
      // Position around 280-degree circular arc (from -140 deg to +140 deg)
      const angleDeg = -140 + (idx / Math.max(1, numPoints - 1)) * 280;
      const angleRad = (angleDeg * Math.PI) / 180;

      // Distance label radius (track centered at r=210)
      const rDist = 210;
      const xDist = 250 + rDist * Math.cos(angleRad);
      const yDist = 250 + rDist * Math.sin(angleRad);

      // Elevation label radius (track centered at r=170)
      const rElev = 170;
      const xElev = 250 + rElev * Math.cos(angleRad);
      const yElev = 250 + rElev * Math.sin(angleRad);

      // Turret click label radius (track centered at r=134)
      const rClk = 134;
      const xClk = 250 + rClk * Math.cos(angleRad);
      const yClk = 250 + rClk * Math.sin(angleRad);

      // Major radial tick mark (from r=241 down to r=228, 13px length)
      const xTick1 = 250 + 241 * Math.cos(angleRad);
      const yTick1 = 250 + 241 * Math.sin(angleRad);
      const xTick2 = 250 + 228 * Math.cos(angleRad);
      const yTick2 = 250 + 228 * Math.sin(angleRad);

      const dispDist = isImp ? Math.round(pt.distanceM * 1.09361) : pt.distanceM;
      const rawElev = isMrad ? pt.elevationMrad : pt.elevationMoa;
      const dispElev = formatDec(rawElev, 1);
      const clkVal = pt.elevationClicks !== undefined ? pt.elevationClicks : Math.round(isMrad ? pt.elevationMrad * 10 : pt.elevationMoa * 4);

      // Tangential angle along circle tangent with upright flip
      let rot = angleDeg + 90;
      if (rot > 90 && rot < 270) {
        rot -= 180;
      }

      labelsSvg += `
        <!-- Range Tick & Dial Labels for ${dispDist} -->
        <line x1="${xTick1.toFixed(1)}" y1="${yTick1.toFixed(1)}" x2="${xTick2.toFixed(1)}" y2="${yTick2.toFixed(1)}" stroke="#0f172a" stroke-width="3" stroke-linecap="round" />
        <g transform="translate(${xDist.toFixed(1)}, ${yDist.toFixed(1)}) rotate(${rot.toFixed(1)})">
          <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="900" fill="#0f172a" text-anchor="middle" dominant-baseline="central">${dispDist}</text>
        </g>
        <g transform="translate(${xElev.toFixed(1)}, ${yElev.toFixed(1)}) rotate(${rot.toFixed(1)})">
          <text x="0" y="0" font-family="monospace" font-size="21" font-weight="900" fill="#0284c7" text-anchor="middle" dominant-baseline="central">${dispElev}</text>
        </g>
        <g transform="translate(${xClk.toFixed(1)}, ${yClk.toFixed(1)}) rotate(${rot.toFixed(1)})">
          <text x="0" y="0" font-family="monospace" font-size="14" font-weight="800" fill="#b45309" text-anchor="middle" dominant-baseline="central">${clkVal}c</text>
        </g>
      `;

      // Minor intermediate tick mark (between points)
      if (idx < numPoints - 1) {
        const nextAngleDeg = -140 + ((idx + 0.5) / Math.max(1, numPoints - 1)) * 280;
        const nextAngleRad = (nextAngleDeg * Math.PI) / 180;
        const xm1 = 250 + 241 * Math.cos(nextAngleRad);
        const ym1 = 250 + 241 * Math.sin(nextAngleRad);
        const xm2 = 250 + 233 * Math.cos(nextAngleRad);
        const ym2 = 250 + 233 * Math.sin(nextAngleRad);
        labelsSvg += `
          <line x1="${xm1.toFixed(1)}" y1="${ym1.toFixed(1)}" x2="${xm2.toFixed(1)}" y2="${ym2.toFixed(1)}" stroke="#475569" stroke-width="2" stroke-linecap="round" />
        `;
      }
    });

    const daVal = Math.round(isImp ? dope.atmos.densityAltitudeM * 3.28084 : dope.atmos.densityAltitudeM);
    const daUnit = isImp ? 'ft' : 'm';
    const zeroVal = isImp ? Math.round(dope.profile.zeroDistanceM * 1.09361) : dope.profile.zeroDistanceM;
    const distUnit = isImp ? 'yd' : 'm';
    const mvVal = isImp ? Math.round(dope.profile.muzzleVelocityMs * 3.28084) : dope.profile.muzzleVelocityMs;
    const mvUnit = isImp ? 'fps' : 'm/s';

    const presets = [
      { id: '13', mm: 39.9, label: 'Butler Creek #13 (39.9mm)' },
      { id: '15', mm: 42.2, label: 'Butler Creek #15 (42.2mm)' },
      { id: '19', mm: 43.9, label: 'Butler Creek #19 (43.9mm)' },
      { id: '25', mm: 45.7, label: 'Butler Creek #25 (45.7mm)' },
      { id: '30', mm: 49.8, label: 'Butler Creek #30 (49.8mm)' },
      { id: '31', mm: 50.7, label: 'Butler Creek #31 (50.7mm)' },
      { id: '34', mm: 53.3, label: 'Butler Creek #34 (53.3mm)' },
      { id: '43', mm: 58.7, label: 'Butler Creek #43 (58.7mm)' },
    ];
    const isCustom = !presets.some((p) => Math.abs(p.mm - d) < 0.2);

    return `
      <div class="print-preview-card">
        <div class="card-meta-bar no-print">
          <div class="meta-left">
            <span class="meta-title">Scope Cap Disk</span>
            <span class="meta-badge">Diameter: ${d}mm</span>
            <label class="tape-ctrl-label ml-10px">
              Preset:
              <select id="scope-cap-preset-select" class="form-select-sm">
                ${presets.map((p) => `<option value="${p.mm}" ${Math.abs(p.mm - d) < 0.2 ? 'selected' : ''}>${p.label}</option>`).join('')}
                <option value="custom" ${isCustom ? 'selected' : ''}>Custom mm</option>
              </select>
            </label>
            <label class="tape-ctrl-label">
              Size (mm):
              <input type="number" id="scope-cap-diameter-input" min="25" max="85" step="0.1" value="${d}" class="form-input-sm w-65px" />
            </label>
          </div>
          <div class="meta-right">
            <button class="btn-print">🖨️ Print Scope Cap (${d}mm)</button>
          </div>
        </div>

        <div class="scope-cap-preview-wrapper">
          <div class="scope-cap-print-container" data-cap-diameter-mm="${d}">
            <svg viewBox="0 0 500 500" width="100%" height="100%" class="scope-cap-svg">
              <!-- Cutout Boundary Circle -->
              <circle cx="250" cy="250" r="246" fill="#ffffff" stroke="#000000" stroke-width="2.5" stroke-dasharray="6,4" />
              <!-- Outer Solid High-Contrast Ring -->
              <circle cx="250" cy="250" r="243" fill="none" stroke="#0f172a" stroke-width="3" />
              <!-- Distance Track Divider -->
              <circle cx="250" cy="250" r="190" fill="none" stroke="#cbd5e1" stroke-width="1.2" />
              <!-- Elevation Track Divider -->
              <circle cx="250" cy="250" r="150" fill="none" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,2" />
              <!-- Center Rifle Info Circle -->
              <circle cx="250" cy="250" r="116" fill="#ffffff" stroke="#94a3b8" stroke-width="2" />

              <!-- Caliber & Profile Header in Center -->
              <text x="250" y="178" font-family="system-ui, -apple-system, sans-serif" font-size="21" font-weight="900" fill="#0f172a" text-anchor="middle" letter-spacing="0.04em">${esc(dope.profile.caliber)}</text>
              <text x="250" y="204" font-family="system-ui, -apple-system, sans-serif" font-size="15.5" font-weight="800" fill="#334155" text-anchor="middle">${dope.profile.bullet.weightGr}gr | ${mvVal}${mvUnit}</text>
              <text x="250" y="228" font-family="monospace" font-size="13.5" font-weight="700" fill="#475569" text-anchor="middle">DA: ${daVal}${daUnit} | ${zeroVal}${distUnit} Zero</text>

              <!-- Pill Badge for Dial Unit -->
              <rect x="155" y="244" width="190" height="28" rx="14" fill="#0284c7" />
              <text x="250" y="259" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="800" fill="#ffffff" text-anchor="middle" dominant-baseline="central" letter-spacing="0.05em">${isMrad ? 'MRAD (0.1 MIL)' : 'MOA (1/4 MOA)'}</text>

              <!-- Physical Spec Footnote -->
              <text x="250" y="293" font-family="monospace" font-size="12.5" font-weight="800" fill="#475569" text-anchor="middle">Ø ${d}mm • BUTLER CREEK</text>

              <!-- Radial Distance & Dial Labels -->
              ${labelsSvg}
            </svg>
          </div>

          <!-- 1:1 SCALE PRINT CALIBRATION RULER -->
          <div class="calibration-ruler-strip">
            <span class="ruler-title">1:1 PRINT CALIBRATION CHECK RULER (50mm EXACT)</span>
            <svg width="50mm" height="9mm" viewBox="0 0 200 36" xmlns="http://www.w3.org/2000/svg" class="calibration-svg">
              <rect x="0" y="0" width="200" height="36" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5" rx="2" />
              ${[0, 10, 20, 30, 40, 50].map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="36" stroke="#0f172a" stroke-width="1.5" />
                <text x="${mm * 4 + 2}" y="28" font-family="monospace" font-size="10" font-weight="700" fill="#0f172a">${mm}</text>
              `).join('')}
              ${[5, 15, 25, 35, 45].map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="20" stroke="#475569" stroke-width="1.2" />
              `).join('')}
              ${Array.from({ length: 51 }, (_, i) => i).filter((i) => i % 5 !== 0).map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="10" stroke="#94a3b8" stroke-width="0.8" />
              `).join('')}
            </svg>
            <span class="ruler-subtitle no-print">Verify with physical metric ruler after printing before cutting</span>
          </div>
        </div>

        <p class="print-instructions no-print">Cut precisely along the dotted perimeter circle (Ø ${d}mm) and place inside transparent flip-up scope cap.</p>
      </div>
    `;
  }

  renderWristCoach(dope) {
    const isImp = (dope?.sysUnits || appState.state.systemUnits) === 'imperial';
    const isMrad = (dope?.dispUnits || appState.state.displayUnits).elevationAngle === 'MRAD';
    const distUnit = isImp ? 'yd' : 'm';
    const velUnit = isImp ? 'fps' : 'm/s';
    const customRanges = appState.state.customDopeRanges;
    const rows = customRanges && customRanges.length > 0
      ? dope.trajectory.filter((p) => customRanges.includes(p.distanceM))
      : dope.trajectory.filter((p) => p.distanceM >= 100 && p.distanceM <= 1100 && p.distanceM % 50 === 0);

    const mvVal = isImp ? Math.round(dope.profile.muzzleVelocityMs * 3.28084) : dope.profile.muzzleVelocityMs;
    const daVal = Math.round(isImp ? dope.atmos.densityAltitudeM * 3.28084 : dope.atmos.densityAltitudeM);
    const daUnit = isImp ? 'ft' : 'm';
    const zeroVal = isImp ? Math.round(dope.profile.zeroDistanceM * 1.09361) : dope.profile.zeroDistanceM;

    return `
      <div class="print-preview-card">
        <div class="card-meta-bar no-print">
          <div class="meta-left">
            <span class="meta-title">Wrist Coach Card</span>
            <span class="meta-badge">Standard 3"×5" (75×125mm) Sleeve</span>
            ${customRanges && customRanges.length > 0 ? `<span class="meta-badge">${customRanges.length} custom ranges</span>` : ''}
          </div>
          <div class="meta-right">
            <button class="btn-print">🖨️ Print Wrist Coach (3"×5")</button>
          </div>
        </div>

        <div class="wrist-coach-card print-sheet">
          <!-- Crop Corner Marks for Sleeve Trimming -->
          <div class="card-crop-corner crop-tl">┌</div>
          <div class="card-crop-corner crop-tr">┐</div>
          <div class="card-crop-corner crop-bl">└</div>
          <div class="card-crop-corner crop-br">┘</div>

          <div class="lamination-guide-border">
            <div class="coach-header">
              <div class="coach-title-block">
                <span class="coach-title">${esc(dope.profile.name)}</span>
                <span class="coach-spec">${dope.profile.bullet.weightGr}gr ${esc(dope.profile.caliber)}</span>
              </div>
              <div class="coach-meta">
                <span>MV: ${mvVal}${velUnit}</span>
                <span>DA: ${daVal}${daUnit}</span>
                <span>Zero: ${zeroVal}${distUnit}</span>
              </div>
            </div>

            <table class="coach-table">
              <thead>
                <tr>
                  <th class="col-rng">RNG</th>
                  <th class="col-elev">ELEV</th>
                  <th class="col-clk">CLK</th>
                  <th class="col-w2">W ${isImp ? '5' : '2'}</th>
                  <th class="col-w4">W ${isImp ? '10' : '4'}</th>
                  <th class="col-w6">W ${isImp ? '15' : '6'}</th>
                  <th class="col-vel">VEL</th>
                </tr>
                <tr class="sub-header-row">
                  <th class="col-rng">${distUnit}</th>
                  <th class="col-elev">${isMrad ? 'MIL' : 'MOA'}</th>
                  <th class="col-clk">clk</th>
                  <th class="col-w2">${isImp ? 'mph' : 'm/s'}</th>
                  <th class="col-w4">${isImp ? 'mph' : 'm/s'}</th>
                  <th class="col-w6">${isImp ? 'mph' : 'm/s'}</th>
                  <th class="col-vel">${velUnit}</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((r) => {
                  const dispDist = isImp ? Math.round(r.distanceM * 1.09361) : r.distanceM;
                  const rawElev = isMrad ? r.elevationMrad : r.elevationMoa;
                  const dispElev = formatDec(rawElev, 1);
                  const windBase = isMrad ? Math.abs(r.windageMrad) : Math.abs(r.windageMoa);
                  const wind2 = formatDec(windBase * 0.5, 1);
                  const wind4 = formatDec(windBase, 1);
                  const wind6 = formatDec(windBase * 1.5, 1);
                  const dispVel = isImp ? Math.round(r.velocityMs * 3.28084) : Math.round(r.velocityMs);
                  return `
                    <tr>
                      <td class="cell-dist col-rng">${dispDist}</td>
                      <td class="cell-elev col-elev">${dispElev}</td>
                      <td class="cell-clk col-clk">${r.elevationClicks}</td>
                      <td class="col-w2">${wind2}</td>
                      <td class="cell-wind col-w4">${wind4}</td>
                      <td class="col-w6">${wind6}</td>
                      <td class="cell-vel col-vel">${dispVel}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>

            <div class="coach-footer-note no-print">
              <span>3"×5" (75×125mm) FOREARM SLEEVE FORMAT • ${isMrad ? '0.1 MRAD' : '1/4 MOA'}</span>
            </div>
          </div>
        </div>
        <p class="print-instructions no-print">Cut precisely along the outer border to fit standard 3"×5" (75mm×125mm) forearm tactical wrist sleeve.</p>
      </div>
    `;
  }

  renderStockTape(dope) {
    const isImp = (dope?.sysUnits || appState.state.systemUnits) === 'imperial';
    const isMrad = (dope?.dispUnits || appState.state.displayUnits).elevationAngle === 'MRAD';
    const distUnit = isImp ? 'yd' : 'm';
    const velUnit = isImp ? 'fps' : 'm/s';
    const customRanges = appState.state.customDopeRanges;
    const rows = customRanges && customRanges.length > 0
      ? dope.trajectory.filter((p) => customRanges.includes(p.distanceM))
      : dope.trajectory.filter((p) => p.distanceM >= 200 && p.distanceM <= 1000 && p.distanceM % 100 === 0);

    const mvVal = isImp ? Math.round(dope.profile.muzzleVelocityMs * 3.28084) : dope.profile.muzzleVelocityMs;
    const mvUnit = isImp ? 'fps' : 'm/s';
    const zeroVal = isImp ? Math.round(dope.profile.zeroDistanceM * 1.09361) : dope.profile.zeroDistanceM;
    const daVal = Math.round(isImp ? dope.atmos.densityAltitudeM * 3.28084 : dope.atmos.densityAltitudeM);
    const daUnit = isImp ? 'ft' : 'm';

    return `
      <div class="print-preview-card">
        <div class="card-meta-bar no-print">
          <div class="meta-left">
            <span class="meta-title">Rifle Stock Adhesive Tape</span>
            <span class="meta-badge">180mm × 32mm Chassis Strip</span>
            ${customRanges && customRanges.length > 0 ? `<span class="meta-badge">${customRanges.length} custom ranges</span>` : ''}
          </div>
          <div class="meta-right">
            <button class="btn-print">🖨️ Print Stock Tape (180mm × 32mm)</button>
          </div>
        </div>

        <div class="stock-tape-wrapper">
          <div class="stock-tape-strip print-sheet">
            <div class="tape-header">
              <span class="tape-header-weapon"><strong>${dope.profile.bullet.weightGr}gr ${esc(dope.profile.caliber)}</strong></span>
              <span class="tape-header-meta">MV: ${mvVal}${velUnit} | ZERO: ${zeroVal}${distUnit} | DA: ${daVal}${daUnit} | ${isMrad ? 'MRAD (0.1)' : 'MOA (1/4)'}</span>
            </div>

            <!-- Authentic Chassis Tape Grid (5 Aligned Rows: RNG, ELEV, CLK, WIND 4m/s, GUST 10m/s) -->
            <table class="tape-matrix-table">
              <thead>
                <tr>
                  <th class="tape-label-col">RNG</th>
                  ${rows.map((r) => {
                    const dispDist = isImp ? Math.round(r.distanceM * 1.09361) : r.distanceM;
                    return `<th class="tape-data-col">${dispDist}</th>`;
                  }).join('')}
                </tr>
              </thead>
              <tbody>
                <tr class="tape-row-elev">
                  <td class="tape-label-col">ELEV</td>
                  ${rows.map((r) => {
                    const rawElev = isMrad ? r.elevationMrad : r.elevationMoa;
                    const dispElev = formatDec(rawElev, 1);
                    return `<td class="tape-cell-elev">${dispElev}</td>`;
                  }).join('')}
                </tr>
                <tr class="tape-row-clk">
                  <td class="tape-label-col">CLK</td>
                  ${rows.map((r) => {
                    return `<td class="tape-cell-clk">${r.elevationClicks}</td>`;
                  }).join('')}
                </tr>
                <tr class="tape-row-wind">
                  <td class="tape-label-col">W ${isImp ? '10' : '4'}</td>
                  ${rows.map((r) => {
                    const windBase = isMrad ? Math.abs(r.windageMrad) : Math.abs(r.windageMoa);
                    return `<td>${formatDec(windBase, 1)}</td>`;
                  }).join('')}
                </tr>
                <tr class="tape-row-gust">
                  <td class="tape-label-col">G ${isImp ? '20' : '10'}</td>
                  ${rows.map((r) => {
                    const windBase = isMrad ? Math.abs(r.windageMrad) : Math.abs(r.windageMoa);
                    const windGust = isImp ? windBase * 2.0 : windBase * 2.5;
                    return `<td>${formatDec(windGust, 1)}</td>`;
                  }).join('')}
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 1:1 Scale Print Calibration Ruler -->
          <div class="calibration-ruler-strip">
            <span class="ruler-title">1:1 PRINT CALIBRATION CHECK RULER (50mm EXACT)</span>
            <svg width="50mm" height="9mm" viewBox="0 0 200 36" xmlns="http://www.w3.org/2000/svg" class="calibration-svg">
              <rect x="0" y="0" width="200" height="36" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5" rx="2" />
              ${[0, 10, 20, 30, 40, 50].map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="36" stroke="#0f172a" stroke-width="1.5" />
                <text x="${mm * 4 + 2}" y="28" font-family="monospace" font-size="10" font-weight="700" fill="#0f172a">${mm}</text>
              `).join('')}
              ${[5, 15, 25, 35, 45].map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="20" stroke="#475569" stroke-width="1.2" />
              `).join('')}
              ${Array.from({ length: 51 }, (_, i) => i).filter((i) => i % 5 !== 0).map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="10" stroke="#94a3b8" stroke-width="0.8" />
              `).join('')}
            </svg>
            <span class="ruler-subtitle no-print">Verify exactly 50mm before cutting and applying 180mm × 32mm strip to rifle chassis</span>
          </div>
        </div>
        <p class="print-instructions no-print">Cut precisely along the dotted perimeter border (180mm × 32mm) and affix to rifle chassis rail with clear protective laminate.</p>
      </div>
    `;
  }

  renderTurretTape(dope) {
    const isImp = (dope?.sysUnits || appState.state.systemUnits) === 'imperial';
    const isMrad = (dope?.dispUnits || appState.state.displayUnits).elevationAngle === 'MRAD';
    const circMm = this.turretCircumferenceMm || 94.2; // default 30mm diameter turret (94.2mm circ)
    const heightMm = this.turretTapeHeightMm || 14;
    const totalClicks = 100;
    const pxPerMm = 4;
    const svgW = circMm * pxPerMm;
    const svgH = heightMm * pxPerMm;

    // Presets including 30mm diameter (94.2mm circumference)
    const presets = [
      { id: '30mm', circ: 94.2, label: '30mm Diameter (94.2mm wrap)' },
      { id: '32mm', circ: 100.5, label: '32mm Diameter (100.5mm wrap)' },
      { id: '34mm', circ: 106.8, label: '34mm Diameter (106.8mm wrap)' },
      { id: '35mm', circ: 110.0, label: '35mm Diameter (110.0mm wrap)' },
    ];
    const isCustom = !presets.some((p) => Math.abs(p.circ - circMm) < 0.3);

    // Use custom selected ranges from workspace if present, or standard 100m - 1000m
    const customRanges = appState.state.customDopeRanges;
    const targetDistances = customRanges && customRanges.length > 0
      ? customRanges
      : [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

    // Find elevation clicks for each distance
    const rangeMarks = targetDistances.map((dist) => {
      const match = dope.trajectory.reduce((prev, curr) =>
        Math.abs(curr.distanceM - dist) < Math.abs(prev.distanceM - dist) ? curr : prev
      );
      const clicks = match ? Math.round(match.elevationClicks) : 0;
      const dispDist = isImp ? Math.round(dist * 1.09361) : dist;
      return { dist, dispDist, clicks, elev: isMrad ? match?.elevationMrad : match?.elevationMoa };
    }).filter((m) => m.clicks >= 0 && m.clicks <= totalClicks);

    // Graduation ticks
    let ticksSvg = '';
    for (let c = 0; c <= totalClicks; c++) {
      const x = (c / totalClicks) * svgW;
      const isMajor = c % 10 === 0;
      const isMedium = c % 5 === 0 && !isMajor;
      const tickH = isMajor ? svgH * 0.42 : isMedium ? svgH * 0.28 : svgH * 0.16;
      const y1 = svgH;
      const y2 = svgH - tickH;

      ticksSvg += `<line x1="${x.toFixed(1)}" y1="${y1}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${isMajor ? '#f8fafc' : isMedium ? '#cbd5e1' : '#64748b'}" stroke-width="${isMajor ? 1.5 : 1}" />`;

      if (isMajor && c > 0 && c < totalClicks) {
        ticksSvg += `<text x="${x.toFixed(1)}" y="${(svgH - tickH - 3).toFixed(1)}" font-family="monospace" font-size="9" font-weight="bold" fill="#94a3b8" text-anchor="middle">${c / 10}</text>`;
      }
    }

    // Prominent Red ZERO indicator at 0 clicks
    const zeroMarkerSvg = `
      <g class="turret-zero-marker">
        <line x1="1" y1="0" x2="1" y2="${svgH}" stroke="#ef4444" stroke-width="2.5" />
        <rect x="2" y="${(svgH - 14).toFixed(1)}" width="28" height="12" rx="2" fill="#ef4444" />
        <text x="16" y="${(svgH - 5).toFixed(1)}" font-family="monospace" font-size="8" font-weight="900" fill="#ffffff" text-anchor="middle">ZERO</text>
      </g>
    `;

    // Prominent Direction Arrow "UP ▲" positioned at top-right clear of range marks
    const arrowX = Math.max(svgW - 58, 10);
    const dirArrowSvg = `
      <g class="turret-dir-arrow-group" transform="translate(${arrowX.toFixed(1)}, 3)">
        <rect x="0" y="0" width="54" height="13" rx="2" fill="#064e3b" stroke="#10b981" stroke-width="0.8" />
        <path d="M 5,6.5 L 17,6.5 M 14,3.5 L 17,6.5 L 14,9.5" fill="none" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <text x="21" y="9.5" font-family="system-ui, -apple-system, sans-serif" font-size="8.5" font-weight="900" fill="#34d399" letter-spacing="0.05em">UP ▲</text>
      </g>
    `;

    // Calibrated Range Overlays along top edge
    let rangeMarkersSvg = '';
    rangeMarks.forEach((m) => {
      if (m.clicks === 0) return;
      const x = (m.clicks / totalClicks) * svgW;
      const distForLabel = isImp ? m.dispDist : m.dist;
      const label = distForLabel >= 1000 ? `${(distForLabel / 100).toFixed(0)}` : `${Math.round(distForLabel / 100)}`;
      rangeMarkersSvg += `
        <g class="turret-range-tag">
          <line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${(svgH * 0.45).toFixed(1)}" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="2,2" />
          <rect x="${(x - 9).toFixed(1)}" y="2" width="18" height="12" rx="2" fill="#0284c7" />
          <text x="${x.toFixed(1)}" y="11" font-family="monospace" font-size="9" font-weight="bold" fill="#ffffff" text-anchor="middle">${label}</text>
        </g>
      `;
    });

    return `
      <div class="print-preview-card">
        <div class="card-meta-bar no-print">
          <div class="meta-left">
            <span class="meta-title">🎯 Calibrated Turret Tape / Wrap</span>
            <span class="meta-badge">${esc(dope.profile.name)}</span>
            <label class="tape-ctrl-label ml-10px">Preset:
              <select id="turret-tape-preset-select" class="form-select-sm">
                ${presets.map((p) => `<option value="${p.circ}" ${Math.abs(p.circ - circMm) < 0.3 ? 'selected' : ''}>${p.label}</option>`).join('')}
                <option value="custom" ${isCustom ? 'selected' : ''}>Custom mm</option>
              </select>
            </label>
            <label class="tape-ctrl-label">Circumference (mm):
              <input type="number" id="tape-circ-input" class="form-input-sm w-65px" min="60" max="180" step="0.1" value="${circMm}" />
            </label>
            <label class="tape-ctrl-label">Height (mm):
              <input type="number" id="tape-height-input" class="form-input-sm w-55px" min="8" max="25" value="${heightMm}" />
            </label>
          </div>
          <div class="meta-right">
            <button id="btn-download-tape-svg" class="btn-secondary-sm">📥 Download SVG</button>
            <button class="btn-print">🖨️ Print 1:1 Scale Wrap</button>
          </div>
        </div>

        <div class="turret-tape-preview-wrapper print-sheet" data-tape-circ-mm="${circMm}" data-tape-height-mm="${heightMm}">
          <div class="turret-tape-label-bar no-print">
            <span>Cut along perimeter border. Calibrated for <strong>${circMm}mm</strong> circumference (~${(circMm / Math.PI).toFixed(1)}mm turret diameter) with UP ▲ dial direction.</span>
          </div>

          <!-- THE MILLIMETER-CALIBRATED SVG STRIP -->
          <div class="turret-tape-svg-box">
            <svg id="turret-tape-svg" width="${circMm}mm" height="${heightMm}mm" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
              <rect class="tape-bg" x="0" y="0" width="${svgW}" height="${svgH}" fill="#05070a" stroke="#38bdf8" stroke-width="1" />
              <!-- Graduation Ticks -->
              ${ticksSvg}
              <!-- Zero Marker -->
              ${zeroMarkerSvg}
              <!-- Direction Arrow UP -->
              ${dirArrowSvg}
              <!-- Range Number Badges -->
              ${rangeMarkersSvg}
              <!-- Cut guides -->
              <line x1="0" y1="0" x2="0" y2="${svgH}" stroke="#ef4444" stroke-width="1.5" />
              <line x1="${svgW}" y1="0" x2="${svgW}" y2="${svgH}" stroke="#ef4444" stroke-width="1.5" />
            </svg>
          </div>
              <!-- Graduation Ticks -->
              ${ticksSvg}
              <!-- Direction Arrow UP -->
              ${dirArrowSvg}
              <!-- Range Number Badges -->
              ${rangeMarkersSvg}
              <!-- Cut guides -->
              <line x1="0" y1="0" x2="0" y2="${svgH}" stroke="#ef4444" stroke-width="1.5" />
              <line x1="${svgW}" y1="0" x2="${svgW}" y2="${svgH}" stroke="#ef4444" stroke-width="1.5" />
            </svg>
          </div>

          <!-- 1:1 SCALE PRINT CALIBRATION RULER -->
          <div class="calibration-ruler-strip">
            <span class="ruler-title">1:1 PRINT CALIBRATION CHECK RULER (50mm EXACT)</span>
            <svg width="50mm" height="9mm" viewBox="0 0 200 36" xmlns="http://www.w3.org/2000/svg" class="calibration-svg">
              <rect x="0" y="0" width="200" height="36" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5" rx="2" />
              ${[0, 10, 20, 30, 40, 50].map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="36" stroke="#0f172a" stroke-width="1.5" />
                <text x="${mm * 4 + 2}" y="28" font-family="monospace" font-size="10" font-weight="700" fill="#0f172a">${mm}</text>
              `).join('')}
              ${[5, 15, 25, 35, 45].map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="20" stroke="#475569" stroke-width="1.2" />
              `).join('')}
              ${Array.from({ length: 51 }, (_, i) => i).filter((i) => i % 5 !== 0).map((mm) => `
                <line x1="${mm * 4}" y1="0" x2="${mm * 4}" y2="10" stroke="#94a3b8" stroke-width="0.8" />
              `).join('')}
            </svg>
            <span class="ruler-subtitle no-print">Measure with calipers after printing. Verify exactly 50mm before applying wrap.</span>
          </div>
        </div>
      </div>
    `;
  }

  renderA4ReticleHoldReference(dope, isImp, isMrad) {
    const distUnit = isImp ? 'yd' : 'm';
    const holdDistances = [200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const holdPoints = holdDistances.map((dist) => {
      const match = dope.trajectory.reduce((prev, curr) =>
        Math.abs(curr.distanceM - dist) < Math.abs(prev.distanceM - dist) ? curr : prev
      );
      const dispDist = isImp ? Math.round(dist * 1.09361) : dist;
      const elev = isMrad ? formatDec(match?.elevationMrad, 1) : formatDec(match?.elevationMoa, 1);
      const wind4 = isMrad ? formatDec(Math.abs(match?.windageMrad), 1) : formatDec(Math.abs(match?.windageMoa), 1);
      return { dist: dispDist, elev, wind4 };
    });

    return `
      <div class="a4-reticle-hold-section">
        <h3 class="a4-section-title">OPTIC RETICLE HOLDOVER REFERENCE TREE (${isMrad ? 'MRAD' : 'MOA'})</h3>
        <div class="reticle-tree-grid">
          ${holdPoints.map((hp) => `
            <div class="reticle-tree-node">
              <span class="node-dist">${hp.dist}${distUnit}</span>
              <span class="node-elev">▲ ${hp.elev} ${isMrad ? 'MIL' : 'MOA'}</span>
              <span class="node-wind">◀▶ ${hp.wind4} (4m/s)</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderA4ShooterNotesGrid() {
    return `
      <div class="a4-notes-section">
        <h3 class="a4-section-title">FIELD SHOOTER LOG & TARGET ENGAGEMENT NOTES</h3>
        <div class="a4-notes-grid">
          <div class="notes-box">
            <span class="notes-box-title">COLD BORE & ZERO CONFIRMATION</span>
            <div class="notes-line-entry">Date/Time: ___________________ Temp / DA: ___________________</div>
            <div class="notes-line-entry">Target: 100m Impact: [ X: _______mm | Y: _______mm ] ES: _______</div>
            <div class="notes-line-entry">Optic Dial Check: [ Elevation: _______ | Windage: _______ ]</div>
          </div>
          <div class="notes-box">
            <span class="notes-box-title">CHRONOGRAPH VELOCITY STRING</span>
            <div class="notes-line-entry">1: ______ 2: ______ 3: ______ 4: ______ 5: ______</div>
            <div class="notes-line-entry">6: ______ 7: ______ 8: ______ 9: ______ 10: _____</div>
            <div class="notes-line-entry">Avg MV: ________ m/s | SD: ________ | ES: ________</div>
          </div>
          <div class="notes-box">
            <span class="notes-box-title">MIRAGE & SQUAD WIND CALLS</span>
            <div class="notes-line-entry">Base Mirage Angle: _________° | Speed Est: _________ m/s</div>
            <div class="notes-line-entry">Lull Bracket: _________ | Gust Bracket: _________</div>
            <div class="notes-line-entry">Terrain Drift / Canyon Updraft Notes: __________________</div>
          </div>
          <div class="notes-box">
            <span class="notes-box-title">STAGE BARRICADE & PROP NOTES</span>
            <div class="notes-line-entry">Position 1: _____________________________________________</div>
            <div class="notes-line-entry">Position 2: _____________________________________________</div>
            <div class="notes-line-entry">Target Order: ___________________________________________</div>
          </div>
        </div>
      </div>
    `;
  }

  renderA4DataSheet(dope) {
    const isImp = (dope?.sysUnits || appState.state.systemUnits) === 'imperial';
    const isMrad = (dope?.dispUnits || appState.state.displayUnits).elevationAngle === 'MRAD';
    const distUnit = isImp ? 'yd' : 'm';
    const dropUnit = isImp ? 'in' : 'cm';
    const dropFactor = isImp ? 39.3701 : 100;
    const velUnit = isImp ? 'fps' : 'm/s';
    const energyUnit = isImp ? 'ft-lb' : 'J';
    const customRanges = appState.state.customDopeRanges;
    const fullRows = customRanges && customRanges.length > 0
      ? dope.trajectory.filter((p) => customRanges.includes(p.distanceM))
      : dope.trajectory.filter((p) => p.distanceM % 50 === 0);

    const mvVal = isImp ? Math.round(dope.profile.muzzleVelocityMs * 3.28084) : dope.profile.muzzleVelocityMs;
    const zeroVal = isImp ? Math.round(dope.profile.zeroDistanceM * 1.09361) : dope.profile.zeroDistanceM;
    const shVal = isImp ? (dope.profile.sightHeightM * 39.3701).toFixed(2) : (dope.profile.sightHeightM * 100).toFixed(1);
    const shUnit = isImp ? 'in' : 'cm';
    const daVal = Math.round(isImp ? dope.atmos.densityAltitudeM * 3.28084 : dope.atmos.densityAltitudeM);
    const daUnit = isImp ? 'ft' : 'm';
    const pressVal = isImp ? (dope.env.pressureHpa * 0.02953).toFixed(2) : dope.env.pressureHpa;
    const pressUnit = isImp ? 'inHg' : 'hPa';
    const tempVal = isImp ? Math.round((dope.env.temperatureC * 9) / 5 + 32) : dope.env.temperatureC;
    const tempUnit = isImp ? '°F' : '°C';

    return `
      <div class="print-preview-card">
        <div class="card-meta-bar no-print">
          <div class="meta-left">
            <span class="meta-title">Master Precision Rifle Data Sheet (A4 / Letter)</span>
            ${customRanges && customRanges.length > 0 ? `<span class="meta-badge">${customRanges.length} custom ranges</span>` : ''}
          </div>
          <div class="meta-right">
            <button class="btn-print">🖨️ Print A4 Data Sheet</button>
          </div>
        </div>
        <div class="a4-data-sheet print-sheet">
          <div class="sheet-title-banner">
            <h1>BALLISTIC DATA SHEET - PRECISION RIFLE</h1>
            <div class="sheet-meta-grid">
              <div><strong>Weapon:</strong> ${esc(dope.profile.name)}</div>
              <div><strong>Caliber:</strong> ${esc(dope.profile.caliber)}</div>
              <div><strong>Optic:</strong> ${esc(dope.profile.optic?.model)}</div>
              <div><strong>Zero:</strong> ${zeroVal}${distUnit} (${shVal}${shUnit} SH)</div>
              <div><strong>Bullet:</strong> ${esc(dope.profile.bullet.name)} (${dope.profile.bullet.weightGr}gr)</div>
              <div><strong>Muzzle Velocity:</strong> ${mvVal} ${velUnit}</div>
              <div><strong>Atmosphere:</strong> ${tempVal}${tempUnit}, ${pressVal} ${pressUnit}, DA ${daVal}${daUnit}</div>
              <div><strong>Twist:</strong> 1:${dope.profile.twistRateIn}" (${dope.profile.twistDirection})</div>
            </div>
          </div>

          <table class="a4-table">
            <thead>
              <tr>
                <th>Range (${distUnit})</th>
                <th>Drop (${dropUnit})</th>
                <th>Elev (${isMrad ? 'MRAD' : 'MOA'})</th>
                <th>Clicks</th>
                <th>Drift (${dropUnit})</th>
                <th>Wind ${isImp ? '5mph' : '2m/s'}</th>
                <th>Wind ${isImp ? '10mph' : '4m/s'}</th>
                <th>Wind ${isImp ? '15mph' : '6m/s'}</th>
                <th>Velocity (${velUnit})</th>
                <th>Mach</th>
                <th>Energy (${energyUnit})</th>
                <th>ToF (s)</th>
              </tr>
            </thead>
            <tbody>
              ${fullRows.map((r) => {
                const dispDist = isImp ? Math.round(r.distanceM * 1.09361) : r.distanceM;
                const dropLin = formatDec(r.dropM * dropFactor, 1);
                const dispElev = isMrad ? formatDec(r.elevationMrad, 2) : formatDec(r.elevationMoa, 2);
                const driftLin = formatDec(Math.abs(r.driftM) * dropFactor, 1);
                const windBase = isMrad ? Math.abs(r.windageMrad) : Math.abs(r.windageMoa);
                const wind2 = formatDec(windBase * 0.5, 2);
                const wind4 = formatDec(windBase, 2);
                const wind6 = formatDec(windBase * 1.5, 2);
                const velVal = isImp ? Math.round(r.velocityMs * 3.28084) : Math.round(r.velocityMs);
                const energyVal = isImp ? Math.round(r.energyJ * 0.737562) : Math.round(r.energyJ);

                return `
                  <tr>
                    <td class="font-bold">${dispDist}${distUnit}</td>
                    <td>${dropLin}</td>
                    <td class="cell-elev">${dispElev}</td>
                    <td>${r.elevationClicks}</td>
                    <td>${driftLin}</td>
                    <td>${wind2}</td>
                    <td class="cell-wind">${wind4}</td>
                    <td>${wind6}</td>
                    <td>${velVal}</td>
                    <td>${r.mach.toFixed(2)}</td>
                    <td>${energyVal}</td>
                    <td>${r.tofS.toFixed(3)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>

          <!-- RETICLE HOLDOVER REFERENCE -->
          ${this.renderA4ReticleHoldReference(dope, isImp, isMrad)}

          <!-- SHOOTER NOTES GRID -->
          ${this.renderA4ShooterNotesGrid()}
        </div>
      </div>
    `;
  }

  bindPrsEvents() {
    const isImperial = appState.state.systemUnits === 'imperial';

    // 1. Preset Buttons
    const presetBtns = this.container.querySelectorAll('.btn-preset');
    presetBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.loadPreset(btn.dataset.preset);
      });
    });

    // 2. Orientation Switcher
    const orientBtns = this.container.querySelectorAll('.btn-orientation');
    orientBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setPrintOrientation(btn.dataset.orientation);
      });
    });

    // 3. Theme Switcher
    const themeBtns = this.container.querySelectorAll('.btn-theme-swatch');
    themeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTheme(btn.dataset.theme);
      });
    });

    // 4. Toggle Stage Builder Drawer
    const toggleBuilderBtn = this.container.querySelector('#btn-toggle-builder');
    if (toggleBuilderBtn) {
      toggleBuilderBtn.addEventListener('click', () => {
        this.builderCollapsed = !this.builderCollapsed;
        const panel = this.container.querySelector('#prs-builder-panel');
        if (panel) {
          panel.classList.toggle('collapsed', this.builderCollapsed);
          toggleBuilderBtn.textContent = this.builderCollapsed ? '⚙️ Open Stage Builder' : '🔼 Hide Builder';
        }
      });
    }

    // 5. Stage Configuration Inputs
    const stageNameInput = this.container.querySelector('#input-stage-name');
    if (stageNameInput) {
      stageNameInput.addEventListener('change', (e) => {
        this.prsStage.name = e.target.value.trim() || 'PRS Match Stage';
        this._saveStageState();
        this.render();
      });
    }

    const stageTimerInput = this.container.querySelector('#input-stage-timer');
    if (stageTimerInput) {
      stageTimerInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        this.prsStage.timeLimitSec = isNaN(val) ? 90 : Math.max(10, val);
        this._saveStageState();
        this.render();
      });
    }

    const windDirInput = this.container.querySelector('#input-wind-direction');
    if (windDirInput) {
      windDirInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) {
          this.prsStage.windDirectionDeg = ((val % 360) + 360) % 360;
          this._saveStageState();
          this.render();
        }
      });
    }

    // Quick Wind Direction Pills
    this.container.querySelectorAll('.btn-wind-dir-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const deg = parseFloat(btn.dataset.dir);
        if (!isNaN(deg)) {
          this.prsStage.windDirectionDeg = deg;
          this._saveStageState();
          this.render();
        }
      });
    });

    // Wind Speeds (converting from mph if Imperial)
    const windBaseInput = this.container.querySelector('#input-wind-base');
    if (windBaseInput) {
      windBaseInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) {
          this.prsStage.windBaseMs = isImperial ? UnitConverter.convert(val, 'mph', 'm/s') : val;
          this._saveStageState();
          this.render();
        }
      });
    }

    const windLullInput = this.container.querySelector('#input-wind-lull');
    if (windLullInput) {
      windLullInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) {
          this.prsStage.windLullMs = isImperial ? UnitConverter.convert(val, 'mph', 'm/s') : val;
          this._saveStageState();
          this.render();
        }
      });
    }

    const windGustInput = this.container.querySelector('#input-wind-gust');
    if (windGustInput) {
      windGustInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) {
          this.prsStage.windGustMs = isImperial ? UnitConverter.convert(val, 'mph', 'm/s') : val;
          this._saveStageState();
          this.render();
        }
      });
    }

    const stagePropsInput = this.container.querySelector('#input-stage-props');
    if (stagePropsInput) {
      stagePropsInput.addEventListener('change', (e) => {
        this.prsStage.propsDescription = e.target.value.trim();
        this._saveStageState();
        this.render();
      });
    }

    // Quick Prop Inserter Tags
    this.container.querySelectorAll('.btn-prop-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.prop;
        const current = this.prsStage.propsDescription ? this.prsStage.propsDescription.trim() : '';
        const addition = `Pos ${this.prsStage.targets.length}: ${propName} (2)`;
        this.prsStage.propsDescription = current ? `${current} ➔ ${addition}` : addition;
        this._saveStageState();
        this.render();
      });
    });

    // 6. Target Field Inputs inside the Builder Table
    const targetRows = this.container.querySelectorAll('.builder-target-table tbody tr');
    targetRows.forEach((row) => {
      const idx = parseInt(row.dataset.targetIdx, 10);
      if (isNaN(idx) || !this.prsStage.targets[idx]) return;

      const target = this.prsStage.targets[idx];

      // Shape select
      const shapeSel = row.querySelector('.target-shape-select');
      if (shapeSel) {
        shapeSel.addEventListener('change', (e) => {
          target.shape = e.target.value;
          this._saveStageState();
          this.render();
        });
      }

      // Text and number inputs
      row.querySelectorAll('.target-field-input').forEach((input) => {
        input.addEventListener('change', (e) => {
          const field = input.dataset.field;
          const val = e.target.value.trim();

          if (field === 'distanceM') {
            const num = parseFloat(val);
            if (!isNaN(num) && num > 0) {
              target.distanceM = isImperial ? Math.round(UnitConverter.convert(num, 'yd', 'm')) : num;
            }
          } else if (field === 'widthCm') {
            const num = parseFloat(val);
            if (!isNaN(num) && num > 0) {
              const cm = isImperial ? Math.round(num * 2.54) : num;
              target.widthCm = cm;
              if (!target.heightCm || target.heightCm === target.widthCm) {
                target.heightCm = cm;
              }
            }
          } else if (field === 'offsetM') {
            const num = parseFloat(val);
            target.offsetM = isNaN(num) ? 0 : Math.max(-40, Math.min(40, num));
          } else if (field === 'rounds') {
            const num = parseInt(val, 10);
            target.rounds = isNaN(num) ? 2 : Math.max(1, num);
          } else if (field === 'name') {
            target.name = val || `T${idx + 1}`;
          } else if (field === 'prop') {
            target.prop = val;
          } else if (field === 'notes') {
            target.notes = val;
          }

          this._saveStageState();
          this.render();
        });
      });
    });

    // 7. Target Action Buttons (Move Up, Move Down, Clone, Delete)
    this.container.querySelectorAll('.btn-move-up').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx > 0) {
          const temp = this.prsStage.targets[idx];
          this.prsStage.targets[idx] = this.prsStage.targets[idx - 1];
          this.prsStage.targets[idx - 1] = temp;
          this._saveStageState();
          this.render();
        }
      });
    });

    this.container.querySelectorAll('.btn-move-down').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (idx < this.prsStage.targets.length - 1) {
          const temp = this.prsStage.targets[idx];
          this.prsStage.targets[idx] = this.prsStage.targets[idx + 1];
          this.prsStage.targets[idx + 1] = temp;
          this._saveStageState();
          this.render();
        }
      });
    });

    this.container.querySelectorAll('.btn-clone-target').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (this.prsStage.targets[idx]) {
          const cloned = JSON.parse(JSON.stringify(this.prsStage.targets[idx]));
          cloned.id = `t${Date.now()}`;
          cloned.name = `${cloned.name} (Copy)`;
          this.prsStage.targets.splice(idx + 1, 0, cloned);
          this._saveStageState();
          this.render();
        }
      });
    });

    this.container.querySelectorAll('.btn-delete-target').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (this.prsStage.targets.length > 1) {
          this.prsStage.targets.splice(idx, 1);
          this._saveStageState();
          this.render();
        }
      });
    });

    // 8. Add Target Button
    const addTargetBtn = this.container.querySelector('#btn-add-target');
    if (addTargetBtn) {
      addTargetBtn.addEventListener('click', () => {
        const count = this.prsStage.targets.length;
        const lastDist = count > 0 ? this.prsStage.targets[count - 1].distanceM : 300;
        const newDist = Math.min(1000, lastDist + 80);
        const newTarget = {
          id: `t${Date.now()}`,
          name: `T${count + 1} - Target`,
          shape: 'gong',
          distanceM: newDist,
          widthCm: 30,
          heightCm: 30,
          rounds: 2,
          prop: `Pos ${count + 1}`,
          notes: '',
          offsetM: (count % 2 === 0 ? 1 : -1) * 12,
        };
        this.prsStage.targets.push(newTarget);
        this._saveStageState();
        this.render();
      });
    }

    // 9. Reset to Default Preset Button
    const resetStageBtn = this.container.querySelector('#btn-reset-stage');
    if (resetStageBtn) {
      resetStageBtn.addEventListener('click', () => {
        this.prsStage = JSON.parse(JSON.stringify(this.presets['rooftop-barricade']));
        this._saveStageState();
        this.render();
      });
    }

    // 10. Copy Match Brief text to clipboard
    const copyBriefBtn = this.container.querySelector('#btn-copy-prs-brief');
    if (copyBriefBtn) {
      copyBriefBtn.addEventListener('click', () => {
        const windUnit = isImperial ? 'mph' : 'm/s';
        const windBaseDisplay = isImperial ? Math.round(UnitConverter.convert(this.prsStage.windBaseMs, 'm/s', 'mph')) : this.prsStage.windBaseMs;
        const windLullDisplay = isImperial ? Math.round(UnitConverter.convert(this.prsStage.windLullMs, 'm/s', 'mph')) : this.prsStage.windLullMs;
        const windGustDisplay = isImperial ? Math.round(UnitConverter.convert(this.prsStage.windGustMs, 'm/s', 'mph')) : this.prsStage.windGustMs;
        const lines = [
          `=== ${this.prsStage.name.toUpperCase()} ===`,
          `Time: ${this.prsStage.timeLimitSec}s | Prop Flow: ${this.prsStage.propsDescription}`,
          `Wind Baseline: Lull ${windLullDisplay} | Base ${windBaseDisplay} | Gust ${windGustDisplay} ${windUnit} @ ${this.prsStage.windDirectionDeg || 90}°`,
          `----------------------------------------------------`,
        ];
        this.prsStage.targets.forEach((t, i) => {
          const distDisp = isImperial ? Math.round(UnitConverter.convert(t.distanceM, 'm', 'yd')) : t.distanceM;
          const distU = isImperial ? 'yd' : 'm';
          const sizeDisp = isImperial ? Math.round(t.widthCm / 2.54) : t.widthCm;
          const sizeU = isImperial ? '"' : 'cm';
          lines.push(`T${i + 1}: ${t.name} @ ${distDisp}${distU} (${sizeDisp}${sizeU} ${t.shape}) - ${t.rounds} rnds [${t.prop}]`);
        });
        navigator.clipboard?.writeText(lines.join('\n')).then(() => {
          copyBriefBtn.textContent = '✅ Copied!';
          setTimeout(() => {
            copyBriefBtn.textContent = '📋 Copy Brief';
          }, 1800);
        }).catch(() => {
          // fallback
        });
      });
    }

    // 11. Export Card Image as PNG (Canvas rasterization)
    const exportPngBtn = this.container.querySelector('#btn-export-prs-png');
    if (exportPngBtn) {
      exportPngBtn.addEventListener('click', () => {
        this._exportCardAsPng();
      });
    }

    // 12. Interactive Target Highlighting Sync (Table Rows <-> Schematic Nodes)
    const matrixRows = this.container.querySelectorAll('.prs-target-matrix .matrix-row');
    const schematicNodes = this.container.querySelectorAll('.schematic-node');

    matrixRows.forEach((row) => {
      row.addEventListener('mouseenter', () => {
        const idx = row.dataset.targetIdx;
        schematicNodes.forEach((n) => n.classList.toggle('highlighted', n.dataset.targetIdx === idx));
      });
      row.addEventListener('mouseleave', () => {
        schematicNodes.forEach((n) => n.classList.remove('highlighted'));
      });
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.targetIdx, 10);
        this.highlightedTargetIdx = this.highlightedTargetIdx === idx ? null : idx;
        matrixRows.forEach((r) => r.classList.toggle('highlighted', parseInt(r.dataset.targetIdx, 10) === this.highlightedTargetIdx));
        schematicNodes.forEach((n) => n.classList.toggle('highlighted', parseInt(n.dataset.targetIdx, 10) === this.highlightedTargetIdx));
      });
    });

    schematicNodes.forEach((node) => {
      node.addEventListener('mouseenter', () => {
        const idx = node.dataset.targetIdx;
        matrixRows.forEach((r) => r.classList.toggle('highlighted', r.dataset.targetIdx === idx));
      });
      node.addEventListener('mouseleave', () => {
        matrixRows.forEach((r) => r.classList.remove('highlighted'));
      });
      node.addEventListener('click', () => {
        const idx = parseInt(node.dataset.targetIdx, 10);
        this.highlightedTargetIdx = this.highlightedTargetIdx === idx ? null : idx;
        matrixRows.forEach((r) => r.classList.toggle('highlighted', parseInt(r.dataset.targetIdx, 10) === this.highlightedTargetIdx));
        schematicNodes.forEach((n) => n.classList.toggle('highlighted', parseInt(n.dataset.targetIdx, 10) === this.highlightedTargetIdx));
      });
    });
  }

  /**
   * Export tactical arm board card as a high-resolution PNG image
   */
  _exportCardAsPng() {
    const cardEl = this.container.querySelector('#prs-arm-board-card');
    if (!cardEl) return;

    try {
      const svgSchematic = cardEl.querySelector('.stage-schematic-svg');
      let svgXml = '';
      if (svgSchematic) {
        svgXml = new XMLSerializer().serializeToString(svgSchematic);
      }

      // Create a canvas with 2x retina density
      const canvas = document.createElement('canvas');
      const w = cardEl.offsetWidth || 440;
      const h = cardEl.offsetHeight || 650;
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);

      // Render dark tactical card background
      ctx.fillStyle = this.cardTheme === 'match-day' ? '#ffffff' : (this.cardTheme === 'milspec-od' ? '#182417' : '#070b13');
      ctx.fillRect(0, 0, w, h);

      // Draw border
      ctx.strokeStyle = this.cardTheme === 'match-day' ? '#0f172a' : '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, w - 8, h - 8);

      // Draw header text
      ctx.fillStyle = this.cardTheme === 'match-day' ? '#0284c7' : '#f59e0b';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('PRS / NRL MATCH BRIEF', 14, 20);

      ctx.fillStyle = this.cardTheme === 'match-day' ? '#0f172a' : '#f8fafc';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(this.prsStage.name, 14, 40);

      // Draw summary pills
      ctx.font = '10px monospace';
      ctx.fillStyle = this.cardTheme === 'match-day' ? '#334155' : '#94a3b8';
      ctx.fillText(`⏱️ ${this.prsStage.timeLimitSec}s  |  🎯 ${this.prsStage.targets.reduce((s, t) => s + (t.rounds || 2), 0)} RNDS  |  📍 ${this.prsStage.targets.length} TGTS`, 14, 58);

      // Draw targets summary rows
      let y = 85;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(14, 70);
      ctx.lineTo(w - 14, 70);
      ctx.stroke();

      this.prsStage.targets.forEach((t, i) => {
        ctx.fillStyle = this.cardTheme === 'match-day' ? '#0284c7' : '#38bdf8';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`T${i + 1}`, 14, y);

        ctx.fillStyle = this.cardTheme === 'match-day' ? '#0f172a' : '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(t.name.substring(0, 20), 40, y);

        ctx.fillStyle = this.cardTheme === 'match-day' ? '#0284c7' : '#38bdf8';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${t.distanceM}m`, w - 160, y);

        ctx.fillStyle = '#f59e0b';
        ctx.fillText(`(${t.rounds || 2} rnds)`, w - 90, y);

        ctx.fillStyle = this.cardTheme === 'match-day' ? '#475569' : '#94a3b8';
        ctx.font = '9px sans-serif';
        ctx.fillText(t.prop || `Pos ${i + 1}`, 40, y + 13);
        ctx.fillText(t.notes || '', w - 160, y + 13);

        y += 32;
      });

      // Footer
      ctx.fillStyle = this.cardTheme === 'match-day' ? '#64748b' : '#64748b';
      ctx.font = '7.5px monospace';
      ctx.fillText('3"x5" WRIST COACH • BALLISTIC WORKBENCH', 14, h - 14);

      // Trigger download
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${this.prsStage.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Wrist_Card.png`;
      a.click();
    } catch (e) {
      console.warn('Canvas PNG export notice:', e);
    }
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

  render() {
    const dope = this.computeDope(25, 1200);

    let contentHtml = '';
    switch (this.activeFormat) {
      case 'wrist-coach':
        contentHtml = this.renderWristCoach(dope);
        break;
      case 'stock-tape':
        contentHtml = this.renderStockTape(dope);
        break;
      case 'turret-tape':
        contentHtml = this.renderTurretTape(dope);
        break;
      case 'prs-stage':
        contentHtml = this.renderPrsStage(dope);
        break;
      case 'a4-sheet':
        contentHtml = this.renderA4DataSheet(dope);
        break;
      case 'scope-cap':
      default:
        contentHtml = this.renderScopeCapSvg(dope);
        break;
    }

    this.container.innerHTML = `
      <div class="dope-studio-header no-print">
        <div>
          <h2>Visual DOPE Card & Tactical Range Studio</h2>
          <p class="subtitle">Generate precision print-ready scope cap inserts, tactical wrist coaches, adhesive stock tapes, and PRS match stage cards</p>
        </div>
        <div class="format-button-group">
          <button class="btn-format ${this.activeFormat === 'scope-cap' ? 'active' : ''}" data-format="scope-cap">🔍 Scope Cap (SVG)</button>
          <button class="btn-format ${this.activeFormat === 'wrist-coach' ? 'active' : ''}" data-format="wrist-coach">⌚ Wrist Coach</button>
          <button class="btn-format ${this.activeFormat === 'stock-tape' ? 'active' : ''}" data-format="stock-tape">📏 Stock Tape</button>
          <button class="btn-format ${this.activeFormat === 'turret-tape' ? 'active' : ''}" data-format="turret-tape">🎯 Turret Tape / Wrap</button>
          <button class="btn-format ${this.activeFormat === 'prs-stage' ? 'active' : ''}" data-format="prs-stage">🎯 PRS Stage Card</button>
          <button class="btn-format ${this.activeFormat === 'a4-sheet' ? 'active' : ''}" data-format="a4-sheet">📄 A4 Data Sheet</button>
        </div>
      </div>

      <div class="dope-canvas-workspace">
        ${contentHtml}
      </div>
    `;

    this.applyDynamicStyles();

    // Bind format switcher
    const formatBtns = this.container.querySelectorAll('.btn-format');
    formatBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setFormat(btn.dataset.format);
      });
    });

    // If PRS stage is active, bind stage builder events
    if (this.activeFormat === 'prs-stage') {
      this.bindPrsEvents();
    }

    // If Scope Cap is active, bind diameter preset & input events
    if (this.activeFormat === 'scope-cap') {
      const presetSelect = this.container.querySelector('#scope-cap-preset-select');
      presetSelect?.addEventListener('change', (e) => {
        if (e.target.value !== 'custom') {
          this.scopeCapDiameterMm = parseFloat(e.target.value);
          this.render();
        }
      });

      const diamInput = this.container.querySelector('#scope-cap-diameter-input');
      diamInput?.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 20 && val <= 100) {
          this.scopeCapDiameterMm = val;
          this.render();
        }
      });
    }

    // If Turret Tape is active, bind tape configuration events
    if (this.activeFormat === 'turret-tape') {
      const presetSelect = this.container.querySelector('#turret-tape-preset-select');
      presetSelect?.addEventListener('change', (e) => {
        if (e.target.value !== 'custom') {
          this.turretCircumferenceMm = parseFloat(e.target.value);
          this.render();
        }
      });

      const circInput = this.container.querySelector('#tape-circ-input');
      circInput?.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 60 && val <= 180) {
          this.turretCircumferenceMm = val;
          this.render();
        }
      });

      const heightInput = this.container.querySelector('#tape-height-input');
      heightInput?.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (val >= 8 && val <= 30) {
          this.turretTapeHeightMm = val;
          this.render();
        }
      });

      const downloadBtn = this.container.querySelector('#btn-download-tape-svg');
      downloadBtn?.addEventListener('click', () => {
        const svgEl = this.container.querySelector('#turret-tape-svg');
        if (svgEl) {
          const svgContent = svgEl.outerHTML;
          const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `turret_tape_${this.turretCircumferenceMm || 110}mm_${Date.now()}.svg`;
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    }
  }
}
