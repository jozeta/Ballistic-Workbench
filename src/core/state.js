/**
 * Ballistic Workbench - Central Reactive State Store & Persistence
 * Manages active ballistic parameters, profiles library, history,
 * and event subscription with localStorage sync and JSON/CSV import/export.
 */

import { DEFAULT_PROFILES, DEFAULT_ENVIRONMENTS } from '../data/defaultProfiles.js';
import { PROJECTILES } from '../data/projectiles.js';
import { UnitConverter } from './units.js';
import {
  sanitizeProfiles,
  sanitizeEnvironments,
  sanitizeBullets,
  sanitizeSolverConfig,
  sanitizeTarget,
  sanitizeMatches,
  sanitizeLogbook,
  sanitizeHunting,
  HUNTING_DEFAULTS,
  MAX_IMPORT_BYTES,
} from './sanitize.js';

const STORAGE_KEY = 'ballistic_workbench_state_v1';

const DEFAULT_TARGET = {
  distanceM: 600,
  targetSizeWidthCm: 45, // IPSC torso width
  targetSizeHeightCm: 75, // IPSC torso height
  targetShape: 'ipsc', // 'ipsc' | 'circle' | 'square' | 'nato-e'
  targetSpeedKmh: 0,
  targetDirectionDeg: 90, // moving right
};

const DEFAULT_SOLVER_CONFIG = {
  activeAlgorithm: 'G7', // 'G1' | 'G7' | 'MPM'
  stepM: 25,
  maxRangeM: 1200,
  includeSpinDrift: true,
  includeCoriolis: true,
  includeAerodynamicJump: true,
};

export class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = this._loadInitialState();
  }

  _defaults() {
    return {
      systemUnits: 'metric',
      profiles: structuredClone(DEFAULT_PROFILES),
      activeProfileId: DEFAULT_PROFILES[0].id,
      environments: sanitizeEnvironments(DEFAULT_ENVIRONMENTS, DEFAULT_ENVIRONMENTS),
      activeEnvironmentId: DEFAULT_ENVIRONMENTS[0].id,
      projectilesLibrary: [...PROJECTILES],
      target: { ...DEFAULT_TARGET },
      solverConfig: { ...DEFAULT_SOLVER_CONFIG },
      displayUnits: UnitConverter.getSystemDefaults('metric'),
      matches: [],
      activeMatchId: null,
      logbook: [],
      hunting: { ...HUNTING_DEFAULTS },
    };
  }

  /**
   * Merges data from storage or an import into a state object. Every field is validated
   * (src/core/sanitize.js); anything missing or invalid keeps the value already in `base`.
   */
  _mergeValidated(base, parsed) {
    const profiles = sanitizeProfiles(parsed.profiles, DEFAULT_PROFILES);
    if (profiles) base.profiles = profiles;
    const envs = sanitizeEnvironments(parsed.environments, DEFAULT_ENVIRONMENTS);
    if (envs) base.environments = envs;
    if (Array.isArray(parsed.projectilesLibrary)) {
      // Factory bullets always come from the app; only custom ones are taken from the data
      const factoryIds = new Set(PROJECTILES.map((p) => p.id));
      const custom = sanitizeBullets(parsed.projectilesLibrary.filter((p) => p && !factoryIds.has(p.id)));
      const existingCustom = base.projectilesLibrary.filter((p) => !factoryIds.has(p.id) && !custom.some((c) => c.id === p.id));
      base.projectilesLibrary = [...PROJECTILES, ...existingCustom, ...custom];
    }
    if (parsed.target) base.target = sanitizeTarget(parsed.target, { ...DEFAULT_TARGET, ...base.target });
    if (parsed.solverConfig) base.solverConfig = sanitizeSolverConfig(parsed.solverConfig, { ...DEFAULT_SOLVER_CONFIG, ...base.solverConfig });
    if (parsed.systemUnits === 'metric' || parsed.systemUnits === 'imperial') {
      base.systemUnits = parsed.systemUnits;
      base.displayUnits = UnitConverter.getSystemDefaults(parsed.systemUnits);
    }
    if (typeof parsed.activeProfileId === 'string' && base.profiles.some((p) => p.id === parsed.activeProfileId)) {
      base.activeProfileId = parsed.activeProfileId;
    }
    if (!base.profiles.some((p) => p.id === base.activeProfileId)) base.activeProfileId = base.profiles[0].id;
    if (typeof parsed.activeEnvironmentId === 'string' && base.environments.some((e) => e.id === parsed.activeEnvironmentId)) {
      base.activeEnvironmentId = parsed.activeEnvironmentId;
    }
    if (!base.environments.some((e) => e.id === base.activeEnvironmentId)) base.activeEnvironmentId = base.environments[0].id;
    this._syncAngleUnits(base);
    if (Array.isArray(parsed.matches)) {
      // Matches from the data replace those with the same id; the rest are kept
      const incoming = sanitizeMatches(parsed.matches);
      const ids = new Set(incoming.map((m) => m.id));
      base.matches = [...(base.matches || []).filter((m) => !ids.has(m.id)), ...incoming].slice(0, 100);
    }
    if (typeof parsed.activeMatchId === 'string' && base.matches.some((m) => m.id === parsed.activeMatchId)) {
      base.activeMatchId = parsed.activeMatchId;
    }
    if (!base.matches.some((m) => m.id === base.activeMatchId)) base.activeMatchId = base.matches[0]?.id || null;
    if (Array.isArray(parsed.logbook)) {
      const incoming = sanitizeLogbook(parsed.logbook);
      const ids = new Set(incoming.map((e) => e.id));
      base.logbook = [...(base.logbook || []).filter((e) => !ids.has(e.id)), ...incoming].slice(-500);
    }
    if (parsed.hunting) base.hunting = sanitizeHunting(parsed.hunting);
    if (Array.isArray(parsed.customDopeRanges)) {
      base.customDopeRanges = parsed.customDopeRanges.filter((d) => Number.isFinite(d) && d > 0 && d <= 5000).slice(0, 200);
    }
    return base;
  }

  _loadInitialState() {
    const state = this._defaults();
    let saved = null;
    try {
      saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    } catch {
      // Storage blocked: start from defaults
    }
    if (saved && saved.length <= MAX_IMPORT_BYTES) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return this._mergeValidated(state, parsed);
      } catch (e) {
        console.warn('Saved settings could not be read; starting from defaults', e);
      }
    }
    return state;
  }

  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Failed to save state to localStorage', e);
    }
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  notify(changedKey = null) {
    // A rifle's scope may have changed (edit, add, import): keep the angle units in step
    if (changedKey === 'profile' || changedKey === 'profiles' || changedKey === 'activeProfile' || changedKey === 'import') this._syncAngleUnits();
    this.save();
    for (const listener of this.subscribers) {
      try {
        listener(this.state, changedKey);
      } catch (err) {
        console.error('Error in state subscriber:', err);
      }
    }
  }

  getState() {
    return this.state;
  }

  /**
   * Angles (MRAD or MOA) follow the active rifle's scope, not the distance units: a mil scope shows
   * MRAD even when distances are in yards. Clicks follow the scope too.
   */
  _syncAngleUnits(state = this.state) {
    const profile = state.profiles?.find((p) => p.id === state.activeProfileId) || state.profiles?.[0];
    const clickRad = profile?.optic?.clickValueRad;
    const moa = /moa/i.test(profile?.optic?.clickName || '') || (Number.isFinite(clickRad) && Math.abs(clickRad * 3437.75 - Math.round(clickRad * 3437.75 * 8) / 8) < 1e-3 && !/mrad|mil/i.test(profile?.optic?.clickName || ''));
    const unit = moa ? 'MOA' : 'MRAD';
    state.displayUnits = { ...state.displayUnits, elevationAngle: unit, windageAngle: unit, clickName: profile?.optic?.clickName || (moa ? '1/4 MOA' : '0.1 MRAD') };
  }

  /**
   * The algorithm to pass to the solver: modified point mass when chosen, otherwise point mass with
   * the active bullet's own drag table (G1 or G7). The drag table always comes from the bullet.
   */
  solverAlgorithm() {
    if (this.state.solverConfig.activeAlgorithm === 'MPM') return 'MPM';
    return this.getActiveProfile()?.bullet?.dragModel === 'G1' ? 'G1' : 'G7';
  }

  getActiveProfile() {
    return this.state.profiles.find((p) => p.id === this.state.activeProfileId) || this.state.profiles[0];
  }

  getActiveEnvironment() {
    return this.state.environments.find((e) => e.id === this.state.activeEnvironmentId) || this.state.environments[0];
  }

  setSystemUnits(system) {
    if (system !== 'metric' && system !== 'imperial') return;
    this.state.systemUnits = system;
    this.state.displayUnits = UnitConverter.getSystemDefaults(system);
    this._syncAngleUnits();
    this.notify('units');
  }

  setDisplayUnit(field, unit) {
    this.state.displayUnits[field] = unit;
    this.notify('displayUnits');
  }

  updateActiveProfile(updates) {
    const profile = this.getActiveProfile();
    Object.assign(profile, updates);
    this.notify('profile');
  }

  updateActiveEnvironment(updates) {
    // The built-in presets stay as they are: the first edit copies the preset into "Custom
    // conditions" (one shared custom set) and edits that
    if (DEFAULT_ENVIRONMENTS.some((d) => d.id === this.state.activeEnvironmentId)) {
      const base = this.getActiveEnvironment();
      const custom = { ...structuredClone(base), id: 'env-custom', name: `Custom (from ${base.name})`.slice(0, 120) };
      const i = this.state.environments.findIndex((e) => e.id === 'env-custom');
      if (i >= 0) this.state.environments[i] = custom;
      else this.state.environments.push(custom);
      this.state.activeEnvironmentId = 'env-custom';
    }
    const env = this.getActiveEnvironment();
    // Altitude without a new pressure: move the station pressure with the standard atmosphere, so
    // a change of altitude changes the air (density comes from station pressure and temperature)
    if ('altitudeM' in updates && !('pressureHpa' in updates) && Number.isFinite(env.altitudeM)) {
      const ratio = (h) => Math.pow(1 - 2.25577e-5 * h, 5.25588);
      const p = env.pressureHpa * (ratio(updates.altitudeM) / ratio(env.altitudeM));
      if (Number.isFinite(p)) updates = { ...updates, pressureHpa: Math.round(p * 10) / 10 };
    }
    // Editing the single wind speed/direction replaces any per-distance wind zones; otherwise the
    // zones would keep overriding what the user just entered.
    if (('windSpeedMs' in updates || 'windDirectionDeg' in updates) && !('windZones' in updates)) {
      env.windZones = [];
    }
    Object.assign(env, updates);
    this.notify('environment');
  }

  updateTarget(updates) {
    Object.assign(this.state.target, updates);
    this.notify('target');
  }

  updateSolverConfig(updates) {
    Object.assign(this.state.solverConfig, updates);
    this.notify('solverConfig');
  }

  setActiveProfile(profileId) {
    if (this.state.profiles.some((p) => p.id === profileId)) {
      this.state.activeProfileId = profileId;
      this._syncAngleUnits();
      this.notify('activeProfile');
    }
  }

  setActiveEnvironment(envId) {
    if (this.state.environments.some((e) => e.id === envId)) {
      this.state.activeEnvironmentId = envId;
      this.notify('activeEnvironment');
    }
  }

  addCustomBullet(bullet) {
    this.state.projectilesLibrary.unshift(bullet);
    this.notify('projectiles');
  }

  addProfile(profile) {
    this.state.profiles.push(profile);
    this.state.activeProfileId = profile.id;
    this.notify('profiles');
  }

  // ---- hunting, matches, logbook ----------------------------------------------------------------

  updateHunting(updates) {
    this.state.hunting = sanitizeHunting({ ...this.state.hunting, ...updates });
    this.notify('hunting');
  }

  getActiveMatch() {
    return this.state.matches.find((m) => m.id === this.state.activeMatchId) || this.state.matches[0] || null;
  }

  setActiveMatch(id) {
    if (!this.state.matches.some((m) => m.id === id)) return;
    this.state.activeMatchId = id;
    this.notify('matches');
  }

  /** Adds or replaces a match (validated). Returns the stored match. */
  saveMatch(match, { activate = true } = {}) {
    const [clean] = sanitizeMatches([match]);
    if (!clean) return null;
    const i = this.state.matches.findIndex((m) => m.id === clean.id);
    if (i >= 0) this.state.matches[i] = clean;
    else this.state.matches.push(clean);
    if (activate) this.state.activeMatchId = clean.id;
    this.notify('matches');
    return clean;
  }

  deleteMatch(id) {
    const i = this.state.matches.findIndex((m) => m.id === id);
    if (i < 0) return null;
    const [removed] = this.state.matches.splice(i, 1);
    if (this.state.activeMatchId === id) this.state.activeMatchId = this.state.matches[0]?.id || null;
    this.notify('matches');
    return { match: removed, index: i };
  }

  restoreMatch({ match, index }) {
    this.state.matches.splice(Math.min(index, this.state.matches.length), 0, match);
    this.state.activeMatchId = match.id;
    this.notify('matches');
  }

  /** Logbook entries of one rifle (default: the active rifle), oldest first by date. */
  logbookFor(profileId = this.state.activeProfileId) {
    return this.state.logbook.filter((e) => e.profileId === profileId);
  }

  addLogEntry(entry) {
    const [clean] = sanitizeLogbook([entry]);
    if (!clean) return null;
    this.state.logbook.push(clean);
    if (this.state.logbook.length > 500) this.state.logbook.shift();
    this.notify('logbook');
    return clean;
  }

  deleteLogEntry(id) {
    const i = this.state.logbook.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const [removed] = this.state.logbook.splice(i, 1);
    this.notify('logbook');
    return { entry: removed, index: i };
  }

  restoreLogEntry({ entry, index }) {
    this.state.logbook.splice(Math.min(index, this.state.logbook.length), 0, entry);
    this.notify('logbook');
  }

  /**
   * Adds a shared rifle or match (already decoded). Data is validated first. An identical item
   * already here is left alone; one with the same id but different content is added as a copy, so
   * nothing the user has is overwritten.
   * @returns {{ status: 'added'|'copy'|'same', name: string, id: string } | null}
   */
  importShared(kind, data) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const copyId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    if (kind === 'rifle') {
      const clean = sanitizeProfiles([data], DEFAULT_PROFILES)?.[0];
      if (!clean) return null;
      clean.zeroAngleRad = null;
      const existing = this.state.profiles.find((p) => p.id === clean.id);
      if (existing && same({ ...existing, zeroAngleRad: null }, clean)) {
        this.setActiveProfile(existing.id);
        return { status: 'same', name: existing.name, id: existing.id };
      }
      let status = 'added';
      if (existing) {
        clean.id = copyId('profile');
        clean.name = `${clean.name} (shared)`.slice(0, 200);
        status = 'copy';
      }
      this.addProfile(clean);
      return { status, name: clean.name, id: clean.id };
    }
    if (kind === 'match') {
      const [clean] = sanitizeMatches([data]);
      if (!clean) return null;
      const existing = this.state.matches.find((m) => m.id === clean.id);
      if (existing && same(existing, clean)) {
        this.setActiveMatch(existing.id);
        return { status: 'same', name: existing.name, id: existing.id };
      }
      let status = 'added';
      if (existing) {
        clean.id = copyId('match');
        clean.name = `${clean.name} (shared)`.slice(0, 200);
        status = 'copy';
      }
      this.saveMatch(clean);
      return { status, name: clean.name, id: clean.id };
    }
    return null;
  }

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }

  /** Imports a backup made by exportJSON. Returns true when the file was a usable backup. */
  importJSON(jsonString) {
    if (typeof jsonString !== 'string' || jsonString.length > MAX_IMPORT_BYTES) return false;
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      const usable = ['profiles', 'environments', 'projectilesLibrary', 'target', 'solverConfig', 'systemUnits', 'matches', 'logbook'].some((k) => k in parsed);
      if (!usable) return false;
      this.state = this._mergeValidated(this.state, parsed);
      this.notify('import');
      return true;
    } catch {
      return false; // not JSON: the caller tells the user
    }
  }
}

export const appState = new StateStore();
