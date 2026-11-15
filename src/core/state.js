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
    const env = this.getActiveEnvironment();
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

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }

  /** Imports a backup made by exportJSON. Returns true when the file was a usable backup. */
  importJSON(jsonString) {
    if (typeof jsonString !== 'string' || jsonString.length > MAX_IMPORT_BYTES) return false;
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      const usable = ['profiles', 'environments', 'projectilesLibrary', 'target', 'solverConfig', 'systemUnits'].some((k) => k in parsed);
      if (!usable) return false;
      this.state = this._mergeValidated(this.state, parsed);
      this.notify('import');
      return true;
    } catch (e) {
      console.warn('Import failed: not valid JSON', e);
      return false;
    }
  }
}

export const appState = new StateStore();
