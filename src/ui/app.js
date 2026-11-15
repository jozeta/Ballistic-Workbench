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

    const initialHash = (typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '') || 'workspace';
    const validViews = ['workspace', 'solverLab', 'dopeStudio', 'tools', 'libraryManager'];
    this.switchView(validViews.includes(initialHash) ? initialHash : 'workspace');

    // Subscribe to unit changes to refresh header toggle label
    appState.subscribe((state, changeKey) => {
      if (changeKey === 'units') {
        this.updateUnitsToggleLabel();
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

    const envSelect = document.getElementById('env-quick-select');
    envSelect?.addEventListener('change', (e) => {
      appState.setActiveEnvironment(e.target.value);
    });

    this.updateUnitsToggleLabel();
  }

  updateUnitsToggleLabel() {
    const unitsToggle = document.getElementById('btn-units-toggle');
    if (unitsToggle) {
      const isMetric = appState.state.systemUnits === 'metric';
      unitsToggle.innerHTML = isMetric
        ? `<span class="unit-badge">SI</span> Metric (m · MRAD)`
        : `<span class="unit-badge">IMP</span> Imperial (yd · MOA)`;
    }
  }

  initTheme() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ballistic_theme') : null;
    this.theme = saved || 'dark';
    this.applyTheme(this.theme, false);

    const themeToggle = document.getElementById('btn-theme-toggle');
    themeToggle?.addEventListener('click', () => {
      const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(nextTheme, true);
    });
  }

  applyTheme(theme, notify = true) {
    this.theme = theme;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ballistic_theme', theme);
    }
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const iconEl = document.getElementById('theme-toggle-icon');
    const labelEl = document.getElementById('theme-toggle-label');
    if (iconEl) iconEl.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (labelEl) labelEl.textContent = theme === 'dark' ? 'Sunlight' : 'Night Ops';

    if (notify && this.currentViewInstance) {
      if (this.currentViewInstance.render) {
        this.currentViewInstance.render();
      }
      if (this.currentViewInstance.initVisualizers) {
        this.currentViewInstance.initVisualizers();
      }
      if (this.currentViewInstance.recompute) {
        this.currentViewInstance.recompute();
      }
    }
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
      link.classList.toggle('active', link.dataset.view === viewName);
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

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggleCommandPalette();
      }
      if (e.key === 'Escape') {
        this.closeCommandPalette();
      }
    });
  }

  initCommandPalette() {
    const palette = document.getElementById('command-palette-modal');
    const input = document.getElementById('palette-search-input');
    const trigger = document.getElementById('btn-cmd-palette-trigger');

    trigger?.addEventListener('click', () => this.toggleCommandPalette());
    palette?.querySelector('.palette-backdrop')?.addEventListener('click', () => this.closeCommandPalette());

    input?.addEventListener('input', (e) => this.filterPaletteCommands(e.target.value));

    // Initial render of commands
    this.filterPaletteCommands('');
  }

  toggleCommandPalette() {
    const palette = document.getElementById('command-palette-modal');
    if (!palette) return;
    const isOpen = palette.classList.contains('open');
    if (isOpen) {
      this.closeCommandPalette();
    } else {
      palette.classList.add('open');
      const input = document.getElementById('palette-search-input');
      if (input) {
        input.value = '';
        input.focus();
        this.filterPaletteCommands('');
      }
    }
  }

  closeCommandPalette() {
    const palette = document.getElementById('command-palette-modal');
    palette?.classList.remove('open');
  }

  getCommandList() {
    return [
      { id: 'view-workspace', title: 'Go to Command Center', category: 'Navigation', icon: '🎯', action: () => this.switchView('workspace') },
      { id: 'view-lab', title: 'Open Algorithm Comparison Lab', category: 'Navigation', icon: '🔬', action: () => this.switchView('solverLab') },
      { id: 'view-dope', title: 'Open DOPE & Range Card Studio', category: 'Navigation', icon: '🖨️', action: () => this.switchView('dopeStudio') },
      { id: 'view-tools', title: 'Open Ballistic Tools & Chrono', category: 'Navigation', icon: '🛠️', action: () => this.switchView('tools') },
      { id: 'tool-wez', title: 'Run WEZ 1,000-Shot Monte Carlo Hit Probability', category: 'Tools', icon: '🎲', action: () => { this.switchView('tools'); if (this.currentViewInstance?.setTool) this.currentViewInstance.setTool('wez'); } },
      { id: 'tool-group', title: 'Analyze Target Group (ES & Mean Radius)', category: 'Tools', icon: '📐', action: () => { this.switchView('tools'); if (this.currentViewInstance?.setTool) this.currentViewInstance.setTool('group'); } },
      { id: 'tool-chrono', title: 'Open Chronograph SD/ES Calculator', category: 'Tools', icon: '⏱️', action: () => { this.switchView('tools'); if (this.currentViewInstance?.setTool) this.currentViewInstance.setTool('chrono'); } },
      { id: 'view-lib', title: 'Open Projectile & Rifle Library', category: 'Navigation', icon: '📦', action: () => this.switchView('libraryManager') },

      { id: 'unit-metric', title: 'Set Units to Metric (m, m/s, MRAD, cm)', category: 'Settings', icon: '📐', action: () => appState.setSystemUnits('metric') },
      { id: 'unit-imperial', title: 'Set Units to Imperial (yd, fps, MOA, in)', category: 'Settings', icon: '🇺🇸', action: () => appState.setSystemUnits('imperial') },
      { id: 'theme-toggle', title: 'Toggle Dark Nordic / High-Contrast Sunlight Theme', category: 'Settings', icon: '☀️', action: () => this.applyTheme(this.theme === 'dark' ? 'light' : 'dark', true) },
      { id: 'theme-light', title: 'Set Theme: High-Contrast Range Sunlight Mode', category: 'Settings', icon: '☀️', action: () => this.applyTheme('light', true) },
      { id: 'theme-dark', title: 'Set Theme: Dark Nordic Tactical Mode', category: 'Settings', icon: '🌙', action: () => this.applyTheme('dark', true) },

      { id: 'alg-g7', title: 'Set Solver Algorithm to G7 Boat-tail', category: 'Solver', icon: '⚡', action: () => appState.updateSolverConfig({ activeAlgorithm: 'G7' }) },
      { id: 'alg-mpm', title: 'Set Solver Algorithm to Modified Point-Mass (MPM)', category: 'Solver', icon: '🌀', action: () => appState.updateSolverConfig({ activeAlgorithm: 'MPM' }) },
      { id: 'alg-4dof', title: 'Set Solver Algorithm to 4DOF Dynamic', category: 'Solver', icon: '🚀', action: () => appState.updateSolverConfig({ activeAlgorithm: '4DOF' }) },
      { id: 'alg-g1', title: 'Set Solver Algorithm to G1 Gavre', category: 'Solver', icon: '📜', action: () => appState.updateSolverConfig({ activeAlgorithm: 'G1' }) },

      { id: 'prof-65', title: 'Load Profile: Bergara 6.5 Creedmoor PRS', category: 'Equipment', icon: '🎯', action: () => appState.setActiveProfile('profile-65cm-prs') },
      { id: 'prof-300', title: 'Load Profile: AI AXSR .300 PRC ELR', category: 'Equipment', icon: '🔭', action: () => appState.setActiveProfile('profile-300prc-elr') },
      { id: 'prof-308', title: 'Load Profile: Tikka T3x .308 Tactical', category: 'Equipment', icon: '🛡️', action: () => appState.setActiveProfile('profile-308-tactical') },
      { id: 'prof-223', title: 'Load Profile: Remington 700 .223 Match', category: 'Equipment', icon: '🦊', action: () => appState.setActiveProfile('profile-223-match') },
    ];
  }

  filterPaletteCommands(query) {
    const listContainer = document.getElementById('palette-results-list');
    if (!listContainer) return;

    const q = (query || '').toLowerCase().trim();
    const commands = this.getCommandList().filter((c) =>
      !q || c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );

    if (commands.length === 0) {
      listContainer.innerHTML = `<div class="palette-empty">No matching commands found</div>`;
      return;
    }

    listContainer.innerHTML = commands
      .map(
        (cmd, index) => `
          <div class="palette-item ${index === 0 ? 'selected' : ''}" data-cmd-id="${cmd.id}">
            <span class="palette-icon">${cmd.icon}</span>
            <div class="palette-text">
              <span class="palette-title">${cmd.title}</span>
              <span class="palette-category">${cmd.category}</span>
            </div>
          </div>
        `
      )
      .join('');

    // Bind item click
    listContainer.querySelectorAll('.palette-item').forEach((item) => {
      item.addEventListener('click', () => {
        const cmd = commands.find((c) => c.id === item.dataset.cmdId);
        if (cmd) {
          cmd.action();
          this.closeCommandPalette();
        }
      });
    });
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new BallisticWorkbenchApp();
});
