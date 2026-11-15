/**
 * Ballistic Workbench - Main Application Bootstrapper & Router
 * Manages view routing, header bar, unit switching, and Command Palette (Ctrl+K).
 */

import { appState } from '../core/state.js';
import { WorkspaceView } from './workspace.js';
import { SolverLabView } from './solverLab.js';
import { DopeStudioView } from './dopeStudio.js';
import { ToolsView } from './tools.js';
import { LibraryManagerView } from './libraryManager.js';

const THEME_KEY = 'ballistic_theme_pref';
const THEME_PREFS = ['system', 'light', 'dark'];

class BallisticWorkbenchApp {
  constructor() {
    this.currentViewInstance = null;
    this.activeView = 'workspace'; // 'workspace' | 'solverLab' | 'dopeStudio' | 'tools' | 'libraryManager'

    this.initHeader();
    this.initTheme();
    this.initServiceWorker();
    this.initRouter();
    this.initCommandPalette();
    this.initVersion();
    this.initPrintButtons();

    const initialHash = (typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '') || 'workspace';
    const validViews = ['workspace', 'solverLab', 'dopeStudio', 'tools', 'libraryManager'];
    this.switchView(validViews.includes(initialHash) ? initialHash : 'workspace');

    // Subscribe to unit changes to refresh header toggle label
    appState.subscribe((state, changeKey) => {
      if (changeKey === 'units') {
        this.updateUnitsToggleLabel();
      }
      // Rifle commands come from the profile list
      if (changeKey === 'profiles' || changeKey === 'import') {
        this.palette?.setCommands(this.getCommandList().map((c) => ({ group: c.category, label: c.title, keywords: c.keywords || [], run: c.action })));
      }
    });
  }

  initHeader() {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = link.dataset.view;
        this.switchView(targetView);
      });
    });

    const unitsToggle = document.getElementById('btn-units-toggle');
    unitsToggle?.addEventListener('click', () => {
      const next = appState.state.systemUnits === 'metric' ? 'imperial' : 'metric';
      appState.setSystemUnits(next);
      this.updateUnitsToggleLabel();
    });

    this.updateUnitsToggleLabel();
  }

  updateUnitsToggleLabel() {
    const unitsToggle = document.getElementById('btn-units-toggle');
    if (unitsToggle) {
      const isMetric = appState.state.systemUnits === 'metric';
      const badge = document.createElement('span');
      badge.className = 'unit-badge';
      badge.textContent = isMetric ? 'SI' : 'IMP';
      unitsToggle.replaceChildren(badge, document.createTextNode(isMetric ? ' Metric' : ' Imperial'));
      unitsToggle.setAttribute('aria-label', isMetric ? 'Units: metric (m, MRAD). Switch to imperial' : 'Units: imperial (yd, MOA). Switch to metric');
    }
  }

  /**
   * Theme preference: 'system' (default, follows the OS), 'light' or 'dark'. The resolved theme is
   * always written to <html data-theme>, because the canvases read it to pick their colours.
   */
  initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      // Storage blocked (private mode): fall back to the system theme
    }
    this.themePref = THEME_PREFS.includes(saved) ? saved : 'system';
    this.systemDark = window.matchMedia?.('(prefers-color-scheme: dark)');
    this.systemDark?.addEventListener?.('change', () => {
      if (this.themePref === 'system') this.applyTheme('system', true);
    });
    this.applyTheme(this.themePref, false);

    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      const next = THEME_PREFS[(THEME_PREFS.indexOf(this.themePref) + 1) % THEME_PREFS.length];
      this.applyTheme(next, true);
    });
  }

  resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return this.systemDark && !this.systemDark.matches ? 'light' : 'dark';
  }

  applyTheme(pref, notify = true) {
    this.themePref = pref;
    try {
      localStorage.setItem(THEME_KEY, pref);
    } catch {
      // Not persisted; the choice still applies for this session
    }
    const resolved = this.resolveTheme(pref);
    const changed = document.documentElement.getAttribute('data-theme') !== resolved;
    this.theme = resolved;
    document.documentElement.setAttribute('data-theme', resolved);

    const labels = { system: 'System', light: 'Light', dark: 'Dark' };
    const icons = { system: './assets/icons.svg#contrast', light: './assets/icons.svg#sun', dark: './assets/icons.svg#moon' };
    const labelEl = document.getElementById('theme-toggle-label');
    const iconEl = document.getElementById('theme-toggle-icon');
    if (labelEl) labelEl.textContent = labels[pref];
    iconEl?.setAttribute('href', icons[pref]);
    document.getElementById('btn-theme-toggle')?.setAttribute('aria-label', `Theme: ${labels[pref]}. Change theme`);

    // Canvases draw with theme colours, so redraw the current view when the resolved theme changed
    if (notify && changed) this.rerenderCurrentView();
  }

  /**
   * View contract: every view class takes its container, renders itself, and implements
   * refresh() (rebuild everything, e.g. after a theme change: canvases redraw with new colours)
   * and destroy() (remove subscriptions, observers and window/document listeners).
   */
  rerenderCurrentView() {
    this.currentViewInstance?.refresh?.();
  }

  /** Shows the app version in the footer; manifest.json is the single source of the version. */
  initVersion() {
    const el = document.getElementById('app-version');
    if (!el || typeof fetch === 'undefined') return;
    fetch('./manifest.json')
      .then((r) => r.json())
      .then((m) => {
        if (typeof m.version === 'string') el.textContent = `v${m.version}`;
      })
      .catch(() => {
        // Offline without a cached manifest: the footer simply shows no version
      });
  }

  /** One delegated handler for every view's print buttons (inline onclick is blocked by the CSP). */
  initPrintButtons() {
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('.btn-print')) window.print();
    });
  }

  initServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {
          // Silent fallback for non-supported or sandboxed test runs
        });
      });
    }
  }

  switchView(viewName) {
    if (this.currentViewInstance?.destroy) {
      this.currentViewInstance.destroy();
    }

    this.activeView = viewName;
    if (typeof window !== 'undefined' && window.location.hash !== `#${viewName}`) {
      window.location.hash = `#${viewName}`;
    }
    const viewContainer = document.getElementById('app-main-content');
    if (!viewContainer) return;

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach((link) => {
      const active = link.dataset.view === viewName;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    switch (viewName) {
      case 'solverLab':
        this.currentViewInstance = new SolverLabView(viewContainer);
        break;
      case 'dopeStudio':
        this.currentViewInstance = new DopeStudioView(viewContainer);
        break;
      case 'tools':
        this.currentViewInstance = new ToolsView(viewContainer);
        break;
      case 'libraryManager':
        this.currentViewInstance = new LibraryManagerView(viewContainer);
        break;
      case 'workspace':
      default:
        this.currentViewInstance = new WorkspaceView(viewContainer);
        break;
    }
  }

  initRouter() {
    // Hash routing support #workspace, #solverLab, etc.
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (['workspace', 'solverLab', 'dopeStudio', 'tools', 'libraryManager'].includes(hash)) {
        if (this.activeView !== hash) {
          this.switchView(hash);
        }
      }
    });

    // Custom view navigation event
    window.addEventListener('navigate-view', (e) => {
      if (e.detail && e.detail.view) {
        this.switchView(e.detail.view);
      }
    });
  }

  /** Command palette (⌘K / Ctrl+K) from Låda Glass: fuzzy search, arrow keys, Enter, Esc. */
  initCommandPalette() {
    if (typeof LadaGlass === 'undefined') return;
    this.palette = LadaGlass.palette({
      placeholder: 'Search commands: views, units, theme, solver, rifle…',
      commands: this.getCommandList().map((c) => ({ group: c.category, label: c.title, keywords: c.keywords || [], run: c.action })),
    });
    document.getElementById('btn-cmd-palette-trigger')?.addEventListener('click', () => this.palette.open());
  }

  getCommandList() {
    const openTool = (tool) => () => {
      this.switchView('tools');
      this.currentViewInstance?.setTool?.(tool);
    };
    return [
      { title: 'Go to Solver', category: 'Go to', keywords: ['workspace', 'command center', 'dope table', 'reticle'], action: () => this.switchView('workspace') },
      { title: 'Go to Compare models', category: 'Go to', keywords: ['algorithm', 'lab', 'g1', 'g7', '4dof'], action: () => this.switchView('solverLab') },
      { title: 'Go to DOPE cards', category: 'Go to', keywords: ['print', 'range card', 'wrist coach', 'scope cap'], action: () => this.switchView('dopeStudio') },
      { title: 'Go to Tools', category: 'Go to', keywords: ['chrono', 'truing', 'wez'], action: () => this.switchView('tools') },
      { title: 'Go to Library', category: 'Go to', keywords: ['bullets', 'projectiles', 'rifles', 'profiles', 'import', 'export'], action: () => this.switchView('libraryManager') },

      { title: 'True muzzle velocity and drag', category: 'Tools', keywords: ['truing', 'calibrate', 'dsf'], action: openTool('truing') },
      { title: 'Hit probability (WEZ simulation)', category: 'Tools', keywords: ['wez', 'monte carlo'], action: openTool('wez') },
      { title: 'Analyze a shot group', category: 'Tools', keywords: ['group', 'extreme spread', 'mean radius', 'photo'], action: openTool('group') },
      { title: 'Chronograph statistics (SD, ES)', category: 'Tools', keywords: ['chrono', 'velocity', 'sd', 'es'], action: openTool('chrono') },
      { title: 'Estimate range with the reticle', category: 'Tools', keywords: ['milling', 'ranging'], action: openTool('milling') },
      { title: 'Free recoil energy', category: 'Tools', keywords: ['recoil'], action: openTool('recoil') },

      { title: 'Units: metric (m, m/s, MRAD, cm)', category: 'Settings', keywords: ['si', 'meters'], action: () => appState.setSystemUnits('metric') },
      { title: 'Units: imperial (yd, fps, MOA, in)', category: 'Settings', keywords: ['yards', 'feet'], action: () => appState.setSystemUnits('imperial') },
      { title: 'Theme: follow system', category: 'Settings', keywords: ['auto', 'appearance'], action: () => this.applyTheme('system', true) },
      { title: 'Theme: light', category: 'Settings', keywords: ['sunlight', 'day', 'appearance'], action: () => this.applyTheme('light', true) },
      { title: 'Theme: dark', category: 'Settings', keywords: ['night', 'appearance'], action: () => this.applyTheme('dark', true) },

      { title: 'Drag model: G7 (boat-tail)', category: 'Solver', keywords: ['algorithm'], action: () => appState.updateSolverConfig({ activeAlgorithm: 'G7' }) },
      { title: 'Drag model: G1 (flat-base)', category: 'Solver', keywords: ['algorithm'], action: () => appState.updateSolverConfig({ activeAlgorithm: 'G1' }) },
      { title: 'Model: modified point mass (MPM)', category: 'Solver', keywords: ['algorithm'], action: () => appState.updateSolverConfig({ activeAlgorithm: 'MPM' }) },
      { title: 'Model: 4DOF', category: 'Solver', keywords: ['algorithm'], action: () => appState.updateSolverConfig({ activeAlgorithm: '4DOF' }) },

      ...appState.state.profiles.map((p) => ({
        title: `Rifle: ${p.name}`,
        category: 'Rifle',
        keywords: [p.caliber || '', 'profile', 'load'],
        action: () => appState.setActiveProfile(p.id),
      })),
    ];
  }

}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new BallisticWorkbenchApp();
});
