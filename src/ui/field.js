/**
 * Ballistic Workbench - Field mode
 *
 * A full-screen, one-handed view for the firing line: the solution in big type and large steppers
 * for distance, wind speed and wind direction, all within thumb reach at the bottom. Night mode
 * turns everything dim red (keeps night vision); "Keep screen on" holds a screen wake lock while
 * the view is open. Changes go straight into the shared state, so the Solver shows the same.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { esc } from '../core/escape.js';
import { solveExact, atmosphereOf, clockOf } from '../core/solve.js';
import { icon } from './icons.js';
import { parseNumber } from './fields.js';

const PREFS_KEY = 'ballistic_workbench_field_v1';
const WIND_STEP = { 'm/s': 0.5, mph: 1, 'km/h': 2, knots: 1 };
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 90;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { night: p.night === true, awake: p.awake !== false };
  } catch {
    return { night: false, awake: true };
  }
}

/** Decimals that show one click of the scope (0.1 → 1, 0.05 → 2, 1/4 MOA → 2, 1/8 MOA → 3). */
function clickDecimals(clickInUnit) {
  for (let d = 0; d <= 3; d++) if (Math.abs(clickInUnit * 10 ** d - Math.round(clickInUnit * 10 ** d)) < 1e-6) return d;
  return 3;
}

export class FieldView {
  constructor(container) {
    this.container = container;
    this.prefs = loadPrefs();
    this.wakeLock = null;
    this._timers = [];
    this._onVisible = () => {
      if (document.visibilityState === 'visible' && this.prefs.awake) this._requestWake();
    };
    this._onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) this.exit();
    };
    this._onFullscreen = () => this._syncToggles();
    document.addEventListener('visibilitychange', this._onVisible);
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('fullscreenchange', this._onFullscreen);
    document.body.classList.add('is-field-mode');

    this.render();
    if (this.prefs.awake) this._requestWake();
    this.unsubscribe = appState.subscribe((state, key) => {
      if (this._ownChange) return;
      if (['units', 'displayUnits', 'profiles', 'activeProfile', 'import'].includes(key)) this.render();
      else this.update();
    });
  }

  refresh() {
    this.render();
  }

  destroy() {
    this.unsubscribe?.();
    this._stopRepeat();
    document.removeEventListener('visibilitychange', this._onVisible);
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('fullscreenchange', this._onFullscreen);
    document.body.classList.remove('is-field-mode');
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  exit() {
    window.dispatchEvent(new CustomEvent('navigate-view', { detail: { view: 'workspace' } }));
  }

  _savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Not remembered; the choice still applies now
    }
  }

  // ---- units -------------------------------------------------------------------------------------

  _u() {
    const d = appState.state.displayUnits;
    const profile = appState.getActiveProfile();
    const ang = d.elevationAngle === 'MOA' ? 'MOA' : 'MRAD';
    const clickRad = profile.optic?.clickValueRad > 0 ? profile.optic.clickValueRad : 0.0001;
    const wind = WIND_STEP[d.windSpeed] ? d.windSpeed : 'm/s';
    return {
      dist: d.distance === 'yd' ? 'yd' : 'm',
      ang,
      wind,
      vel: d.velocity === 'fps' ? 'fps' : 'm/s',
      energy: d.energy === 'ft-lb' ? 'ft-lb' : 'J',
      clickRad,
      angDec: clickDecimals(UnitConverter.fromSI(clickRad, ang)),
    };
  }

  // ---- render --------------------------------------------------------------------------------------

  render() {
    const u = this._u();
    const s = appState.state;
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const distVal = Math.round(UnitConverter.fromSI(s.target.distanceM, u.dist));
    const canFull = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    const canWake = 'wakeLock' in navigator;
    const stepper = (id, label, minus, plus, valueHtml, small = null) => `
      <div class="field-stepper" role="group" aria-labelledby="${id}-label">
        <span class="field-stepper-label lg-label" id="${id}-label">${label}</span>
        <div class="field-stepper-row">
          ${small ? `<button type="button" class="lg-btn field-step field-step-small" data-step="${id}" data-by="${-small}" aria-label="${label}: minus ${small}">−${small}</button>` : ''}
          <button type="button" class="lg-btn field-step" data-step="${id}" data-by="${-minus}" aria-label="${label}: minus ${minus}">${icon('minus')}</button>
          <div class="field-stepper-value">${valueHtml}</div>
          <button type="button" class="lg-btn field-step" data-step="${id}" data-by="${plus}" aria-label="${label}: plus ${plus}">${icon('plus')}</button>
          ${small ? `<button type="button" class="lg-btn field-step field-step-small" data-step="${id}" data-by="${small}" aria-label="${label}: plus ${small}">+${small}</button>` : ''}
        </div>
      </div>`;

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d names only
    this.container.innerHTML = `
      <div class="field-view ${this.prefs.night ? 'is-night' : ''}" ${this.prefs.night ? 'data-theme="dark"' : ''}>
        <h1 class="lg-sr-only">Field mode</h1>
        <header class="field-bar">
          <button type="button" class="lg-btn field-exit" id="field-exit">${icon('arrow-left')}<span>Exit</span></button>
          <select class="lg-select field-rifle" id="field-rifle" aria-label="Rifle">
            ${s.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === profile.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
          <div class="field-toggles">
            <button type="button" class="lg-btn field-toggle" id="field-night" aria-pressed="${this.prefs.night}" title="Night mode: dim red display">${icon('moon')}<span>Night</span></button>
            <button type="button" class="lg-btn field-toggle" id="field-awake" aria-pressed="${this.prefs.awake && canWake}" ${canWake ? '' : 'disabled'} title="${canWake ? 'Keep the screen on while Field mode is open' : 'This browser cannot keep the screen on'}">${icon('sun')}<span>Screen on</span></button>
            ${canFull ? `<button type="button" class="lg-btn field-toggle" id="field-full" aria-pressed="false" title="Full screen">${icon('eye')}<span>Full screen</span></button>` : ''}
          </div>
        </header>

        <section class="field-readout" aria-label="Firing solution" aria-live="polite">
          <div class="field-big" id="field-elev">
            <span class="field-big-label lg-label">Elevation</span>
            <span class="field-big-value"><span class="field-dir" id="field-elev-dir"></span><span id="field-elev-val"></span></span>
            <span class="field-big-sub" id="field-elev-sub"></span>
          </div>
          <div class="field-big" id="field-wind">
            <span class="field-big-label lg-label">Wind</span>
            <span class="field-big-value"><span class="field-dir" id="field-wind-dir"></span><span id="field-wind-val"></span></span>
            <span class="field-big-sub" id="field-wind-sub"></span>
          </div>
          <p class="field-meta" id="field-meta"></p>
          <p class="field-warn" id="field-warn" hidden></p>
        </section>

        <section class="field-controls" aria-label="Distance and wind">
          ${stepper('field-dist', `Distance (${u.dist})`, 5, 5, `<input type="text" inputmode="numeric" autocomplete="off" class="lg-input field-dist-input" id="field-dist-input" aria-label="Distance in ${u.dist}" value="${distVal}" />`, 25)}
          <div class="field-controls-row">
            ${stepper('field-wind-speed', `Wind (${u.wind})`, WIND_STEP[u.wind], WIND_STEP[u.wind], '<output class="field-out" id="field-wind-speed-out"></output>')}
            ${stepper('field-wind-dir', 'From (o\'clock)', 1, 1, '<output class="field-out" id="field-wind-dir-out"></output>')}
          </div>
          <p class="field-env lg-small" id="field-env">${esc(env.name)}</p>
        </section>
      </div>`;
    this._bind();
    this._syncToggles();
    this.update();
  }

  /** Updates the numbers without rebuilding the controls (keeps focus and a running auto-repeat). */
  update() {
    const q = (sel) => this.container.querySelector(sel);
    if (!q('.field-view')) return;
    const u = this._u();
    const s = appState.state;
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const atmos = atmosphereOf(env);
    const p = solveExact({
      profile,
      env,
      config: s.solverConfig,
      algorithm: appState.solverAlgorithm(),
      distanceM: s.target.distanceM,
      targetHeightM: (s.target.targetSizeHeightCm || 50) / 100,
      atmos,
    });
    if (!p) return;
    const fmtAng = (clicks) => UnitConverter.fromSI(Math.abs(clicks) * u.clickRad, u.ang).toFixed(u.angDec);
    const clicks = (n) => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'click' : 'clicks'}`;

    q('#field-elev-dir').textContent = p.elevationClicks === 0 ? '' : p.elevationClicks > 0 ? 'U' : 'D';
    q('#field-elev-val').textContent = fmtAng(p.elevationClicks);
    q('#field-elev-sub').textContent = `${u.ang} · ${clicks(p.elevationClicks)} ${p.elevationClicks >= 0 ? 'up' : 'down'}`;
    q('#field-elev').setAttribute('aria-label', `Elevation ${p.elevationClicks >= 0 ? 'up' : 'down'} ${fmtAng(p.elevationClicks)} ${u.ang}, ${clicks(p.elevationClicks)}`);

    const wc = p.windageClicks;
    q('#field-wind-dir').textContent = wc === 0 ? '' : wc > 0 ? 'R' : 'L';
    q('#field-wind-val').textContent = fmtAng(wc);
    q('#field-wind-sub').textContent = wc === 0 ? `${u.ang} · no correction` : `${u.ang} · ${clicks(wc)} ${wc > 0 ? 'right' : 'left'} (dial or hold)`;
    q('#field-wind').setAttribute('aria-label', wc === 0 ? 'Wind: no correction' : `Wind ${wc > 0 ? 'right' : 'left'} ${fmtAng(wc)} ${u.ang}, ${clicks(wc)}`);

    const vel = UnitConverter.fromSI(p.velocityMs, u.vel);
    const en = UnitConverter.fromSI(p.energyJ, u.energy);
    q('#field-meta').textContent = `${Math.round(vel).toLocaleString('en-US')} ${u.vel} · Mach ${p.mach.toFixed(2)} · ${p.tofS.toFixed(2)} s · ${Math.round(en).toLocaleString('en-US')} ${u.energy === 'ft-lb' ? 'ft·lb' : 'J'}`;

    // Warnings: transonic or subsonic at the target, and the hunting minimums when switched on
    const warns = [];
    if (p.mach < 1.0) warns.push('Subsonic at the target: expect poor accuracy.');
    else if (p.mach < 1.2) warns.push('Transonic at the target: the bullet may be unstable.');
    const h = s.hunting;
    if (h?.showInSolver) {
      if (h.minEnergyJ > 0 && p.energyJ < h.minEnergyJ) warns.push('Below your minimum hunting energy.');
      if (h.minVelocityMs > 0 && p.velocityMs < h.minVelocityMs) warns.push('Below the bullet\'s minimum expansion velocity.');
    }
    const warn = q('#field-warn');
    warn.hidden = warns.length === 0;
    warn.textContent = warns.join(' ');

    const input = q('#field-dist-input');
    if (input && document.activeElement !== input) input.value = String(Math.round(UnitConverter.fromSI(s.target.distanceM, u.dist)));
    const ws = UnitConverter.fromSI(env.windSpeedMs ?? 0, u.wind);
    q('#field-wind-speed-out').textContent = ws.toFixed(WIND_STEP[u.wind] < 1 ? 1 : 0);
    q('#field-wind-dir-out').textContent = String(clockOf(env.windDirectionDeg ?? 90));
    q('#field-env').textContent = env.name;
  }

  // ---- input -------------------------------------------------------------------------------------

  _apply(id, by) {
    const u = this._u();
    const s = appState.state;
    const env = appState.getActiveEnvironment();
    this._ownChange = true;
    try {
      if (id === 'field-dist') {
        const cur = UnitConverter.fromSI(s.target.distanceM, u.dist);
        // Steps land on round numbers: 603 + 5 → 605, 603 − 25 → 575
        const next = by > 0 ? Math.floor(cur / by + 1e-9) * by + by : Math.ceil(cur / -by - 1e-9) * -by + by;
        const m = Math.min(3000, Math.max(10, UnitConverter.toSI(next, u.dist)));
        appState.updateTarget({ distanceM: m });
      } else if (id === 'field-wind-speed') {
        const cur = UnitConverter.fromSI(env.windSpeedMs ?? 0, u.wind);
        const next = Math.max(0, Math.round((cur + by) / Math.abs(by)) * Math.abs(by));
        appState.updateActiveEnvironment({ windSpeedMs: Math.min(40, UnitConverter.toSI(next, u.wind)) });
      } else if (id === 'field-wind-dir') {
        const h = clockOf(env.windDirectionDeg ?? 90);
        const nextH = ((h + by + 11) % 12) + 1;
        appState.updateActiveEnvironment({ windDirectionDeg: (nextH % 12) * 30 });
      }
    } finally {
      this._ownChange = false;
    }
    this.update();
  }

  _stopRepeat() {
    this._timers.forEach((t) => clearTimeout(t));
    this._timers = [];
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    q('#field-exit')?.addEventListener('click', () => this.exit());
    q('#field-rifle')?.addEventListener('change', (e) => appState.setActiveProfile(e.target.value));
    q('#field-night')?.addEventListener('click', () => {
      this.prefs.night = !this.prefs.night;
      this._savePrefs();
      this.render();
      this.container.querySelector('#field-night')?.focus();
    });
    q('#field-awake')?.addEventListener('click', () => {
      this.prefs.awake = !this.prefs.awake;
      this._savePrefs();
      if (this.prefs.awake) this._requestWake();
      else {
        this.wakeLock?.release?.().catch(() => {});
        this.wakeLock = null;
      }
      this._syncToggles();
    });
    q('#field-full')?.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    });

    // Steppers: a press steps once; holding repeats. Keyboard (Enter/Space) steps once per press.
    this.container.querySelectorAll('.field-step').forEach((btn) => {
      const run = () => this._apply(btn.dataset.step, Number(btn.dataset.by));
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this._stopRepeat();
        run();
        const loop = () => {
          run();
          this._timers = [setTimeout(loop, REPEAT_EVERY_MS)];
        };
        this._timers = [setTimeout(loop, REPEAT_DELAY_MS)];
      });
      const stop = () => this._stopRepeat();
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('pointercancel', stop);
      // A pointer press already stepped on pointerdown; keyboard clicks (detail 0) step here
      btn.addEventListener('click', (e) => {
        if (e.detail === 0) run();
      });
    });

    const input = q('#field-dist-input');
    const commit = () => {
      const u = this._u();
      const v = parseNumber(input.value);
      const m = Number.isFinite(v) ? UnitConverter.toSI(v, u.dist) : NaN;
      if (Number.isFinite(m) && m >= 10 && m <= 3000) {
        input.removeAttribute('aria-invalid');
        this._ownChange = true;
        appState.updateTarget({ distanceM: m });
        this._ownChange = false;
        this.update();
      } else {
        input.setAttribute('aria-invalid', 'true');
      }
    };
    input?.addEventListener('change', commit);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit();
        input.select();
      }
    });
    input?.addEventListener('focus', () => input.select());
  }

  _syncToggles() {
    const set = (id, on) => this.container.querySelector(id)?.setAttribute('aria-pressed', String(Boolean(on)));
    set('#field-night', this.prefs.night);
    set('#field-awake', this.prefs.awake && 'wakeLock' in navigator);
    set('#field-full', Boolean(document.fullscreenElement));
  }

  async _requestWake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Refused (battery saver, permissions): the screen simply follows its normal timeout
      this.wakeLock = null;
    }
  }
}
