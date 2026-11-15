/**
 * Ballistic Workbench - Central Reactive State Store & Persistence
 * Manages active ballistic parameters, profiles library, history,
 * and event subscription with localStorage sync and JSON/CSV import/export.
 */

import { DEFAULT_PROFILES, DEFAULT_ENVIRONMENTS } from '../data/defaultProfiles.js';
import { PROJECTILES } from '../data/projectiles.js';
import { UnitConverter } from './units.js';

const STORAGE_KEY = 'ballistic_workbench_state_v1';

export class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = this._loadInitialState();
  }

  _loadInitialState() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure default structure exists
        return {
          systemUnits: parsed.systemUnits || 'metric', // 'metric' | 'imperial'
          profiles: parsed.profiles?.length ? parsed.profiles : DEFAULT_PROFILES,
          activeProfileId: parsed.activeProfileId || DEFAULT_PROFILES[0].id,
          environments: parsed.environments?.length ? parsed.environments : DEFAULT_ENVIRONMENTS,
          activeEnvironmentId: parsed.activeEnvironmentId || DEFAULT_ENVIRONMENTS[0].id,
          projectilesLibrary: (() => {
            if (!parsed.projectilesLibrary || !Array.isArray(parsed.projectilesLibrary) || parsed.projectilesLibrary.length === 0) {
              return [...PROJECTILES];
            }
            // Retain custom bullets created by user while ensuring factory projectiles are canonical & up to date
            const factoryIds = new Set(PROJECTILES.map((p) => p.id));
            const customBullets = parsed.projectilesLibrary.filter((p) => !factoryIds.has(p.id));
            return [...PROJECTILES, ...customBullets];
          })(),
          target: parsed.target || {
            distanceM: 600,
            targetSizeWidthCm: 45, // 18 inches ~ 45 cm standard IPSC width
            targetSizeHeightCm: 75, // 30 inches ~ 75 cm standard IPSC torso
            targetShape: 'ipsc', // 'ipsc' | 'circle' | 'square' | 'nato-e'
            targetSpeedKmh: 0,
            targetDirectionDeg: 90, // moving right
          },
          solverConfig: parsed.solverConfig || {
            activeAlgorithm: 'G7', // 'G1' | 'G7' | 'MPM' | '4DOF'
            stepM: 25,
            maxRangeM: 1200,
            includeSpinDrift: true,
            includeCoriolis: true,
            includeAerodynamicJump: true,
          },
          displayUnits: parsed.displayUnits || UnitConverter.getSystemDefaults('metric'),
        };
      } catch (e) {
        console.warn('Failed to parse saved state, loading defaults', e);
      }
    }

    return {
      systemUnits: 'metric',
      profiles: [...DEFAULT_PROFILES],
      activeProfileId: DEFAULT_PROFILES[0].id,
      environments: [...DEFAULT_ENVIRONMENTS],
      activeEnvironmentId: DEFAULT_ENVIRONMENTS[0].id,
      projectilesLibrary: [...PROJECTILES],
      target: {
        distanceM: 600,
        targetSizeWidthCm: 45,
        targetSizeHeightCm: 75,
        targetShape: 'ipsc',
        targetSpeedKmh: 0,
        targetDirectionDeg: 90,
      },
      solverConfig: {
        activeAlgorithm: 'G7',
        stepM: 25,
        maxRangeM: 1200,
        includeSpinDrift: true,
        includeCoriolis: true,
        includeAerodynamicJump: true,
      },
      displayUnits: UnitConverter.getSystemDefaults('metric'),
    };
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

  importJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
          this.state.profiles = parsed.profiles;
          if (!this.state.profiles.some((p) => p.id === this.state.activeProfileId)) {
            this.state.activeProfileId = this.state.profiles[0].id;
          }
        }
        if (Array.isArray(parsed.environments) && parsed.environments.length > 0) {
          this.state.environments = parsed.environments;
          if (!this.state.environments.some((e) => e.id === this.state.activeEnvironmentId)) {
            this.state.activeEnvironmentId = this.state.environments[0].id;
          }
        }
        if (Array.isArray(parsed.projectilesLibrary) && parsed.projectilesLibrary.length > 0) {
          const factoryIds = new Set(PROJECTILES.map((p) => p.id));
          const customBullets = parsed.projectilesLibrary.filter((p) => !factoryIds.has(p.id));
          this.state.projectilesLibrary = [...PROJECTILES, ...customBullets];
        }
        if (parsed.solverConfig && typeof parsed.solverConfig === 'object') {
          Object.assign(this.state.solverConfig, parsed.solverConfig);
        }
        if (parsed.target && typeof parsed.target === 'object') {
          Object.assign(this.state.target, parsed.target);
        }
        if (parsed.systemUnits === 'metric' || parsed.systemUnits === 'imperial') {
          this.state.systemUnits = parsed.systemUnits;
          this.state.displayUnits = UnitConverter.getSystemDefaults(parsed.systemUnits);
        }
        this.notify('import');
        return true;
      }
    } catch (e) {
      console.error('Invalid profile JSON', e);
    }
    return false;
  }
}

export const appState = new StateStore();
