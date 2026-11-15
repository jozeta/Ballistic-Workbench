/**
 * Ballistic Workbench - rifle dialog (new rifle and edit rifle).
 *
 *   new RifleBuilderModal(onSaved).open()          new rifle; it becomes the rifle in use
 *   new RifleBuilderModal(onSaved).open(profile)   edit that rifle in place (same id)
 *
 * A native <dialog> opened through LadaGlass.modal (focus trap, Esc, backdrop click, focus goes
 * back to the button that opened it), with a showModal() fallback. Every number is validated
 * against its min/max; Save is blocked with inline messages instead of swapping in defaults.
 * The dialog closes when the user switches view.
 */

import { appState } from '../core/state.js';
import { esc } from '../core/escape.js';
import { UnitConverter } from '../core/units.js';
import { icon } from './icons.js';
import { toast } from './notify.js';
import { parseNumber, rangeError, setFieldError } from './fields.js';

const MOA = Math.PI / 180 / 60;
const CLICKS = [
  { id: '0.1mrad', name: '0.1 MRAD', rad: 0.0001, unit: 'MRAD' },
  { id: '0.05mrad', name: '0.05 MRAD', rad: 0.00005, unit: 'MRAD' },
  { id: '0.25moa', name: '1/4 MOA', rad: MOA * 0.25, unit: 'MOA' },
  { id: '0.125moa', name: '1/8 MOA', rad: MOA * 0.125, unit: 'MOA' },
];
// unit: which click unit the reticle's marks are in ('any' = plain crosshair without hash marks)
const RETICLES = [
  { id: 'EBR-8 MRAD', name: 'Vortex EBR-8', unit: 'MRAD' },
  { id: 'Kahles SKMR4', name: 'Kahles SKMR4', unit: 'MRAD' },
  { id: 'Leupold PR2-MIL', name: 'Leupold PR2-MIL', unit: 'MRAD' },
  { id: 'Mil-XT', name: 'Nightforce Mil-XT', unit: 'MRAD' },
  { id: 'Tremor3', name: 'Horus Tremor3', unit: 'MRAD' },
  { id: 'Mil-Dot', name: 'Mil-Dot', unit: 'MRAD' },
  { id: 'ACSS DMR', name: 'Primary Arms ACSS DMR', unit: 'MRAD' },
  { id: 'EBR-2C MOA', name: 'Vortex EBR-2C MOA', unit: 'MOA' },
  { id: 'German #4', name: 'German #4 (no hold marks)', unit: 'any' },
];
const G1_PER_G7 = 1.95;

export class RifleBuilderModal {
  constructor(onSaved = null) {
    this.onSaved = onSaved;
    this.dialog = null;
    this.profile = null;
    this._onHash = () => this.close();
  }

  _units() {
    const isImp = appState.state.systemUnits === 'imperial';
    const du = appState.state.displayUnits || {};
    const vel = du.velocity === 'fps' || du.velocity === 'm/s' ? du.velocity : isImp ? 'fps' : 'm/s';
    const dist = du.distance === 'yd' || du.distance === 'm' ? du.distance : isImp ? 'yd' : 'm';
    const sh = du.sightHeight === 'in' || du.sightHeight === 'cm' ? du.sightHeight : isImp ? 'in' : 'cm';
    // Bullet diameter and length follow the same display units as "Add a bullet" in the Library
    const dia = du.bulletDiameter === 'mm' ? 'mm' : 'in';
    const len = du.bulletLength === 'mm' ? 'mm' : 'in';
    return { vel, dist, sh, dia, len };
  }

  _limits() {
    const u = this._units();
    return {
      mv: u.vel === 'fps' ? [600, 4500, 1] : [180, 1400, 0.1],
      sh: u.sh === 'in' ? [0.4, 6, 0.01] : [1, 15, 0.1],
      zero: u.dist === 'yd' ? [25, 1000, 1] : [25, 1000, 1],
      dia: u.dia === 'mm' ? [4.32, 25.4, 0.01] : [0.17, 1, 0.001],
      len: u.len === 'mm' ? [6.35, 101.6, 0.01] : [0.25, 4, 0.001],
    };
  }

  /** Inches to the display unit (mm or in), rounded for the field. */
  _fromIn(inches, unit) {
    return unit === 'mm' ? Number((inches * 25.4).toFixed(2)) : Number(Number(inches).toFixed(3));
  }

  _toIn(value, unit) {
    return unit === 'mm' ? Number((value / 25.4).toFixed(4)) : value;
  }

  /** open() for a new rifle, open(profile) to edit that rifle. */
  open(profile = null) {
    this.close();
    this.profile = profile && appState.state.profiles.includes(profile) ? profile : null;
    const editing = !!this.profile;
    const p = this.profile;
    const u = this._units();
    const lim = this._limits();
    const bullets = appState.state.projectilesLibrary || [];

    // Starting values (edit: the rifle; new: a sensible 6.5 Creedmoor-like start)
    const b = p?.bullet || {};
    const libBullet = p ? bullets.find((x) => x.id === b.id) : null;
    const mvMs = p ? p.muzzleVelocityMs : 825;
    const shM = p ? p.sightHeightM : 0.048;
    const zeroM = p ? p.zeroDistanceM : u.dist === 'yd' ? 91.44 : 100;
    const click = CLICKS.find((c) => Math.abs(c.rad - (p?.optic?.clickValueRad ?? (u.vel === 'fps' ? MOA * 0.25 : 0.0001))) < 1e-7) || CLICKS[0];
    const reticleId = p?.optic?.reticle || (click.unit === 'MOA' ? 'EBR-2C MOA' : 'EBR-8 MRAD');

    const round = (v, step) => {
      const d = String(step).includes('.') ? String(step).split('.')[1].length : 0;
      return Number(v.toFixed(d));
    };
    const mvDisp = round(UnitConverter.fromSI(mvMs, u.vel), lim.mv[2]);
    const shDisp = round(UnitConverter.fromSI(shM, u.sh), lim.sh[2]);
    const zeroDisp = Math.round(UnitConverter.fromSI(zeroM, u.dist));
    const diaIn = p ? b.diameterIn : 0.264;
    const lenIn = p ? b.lengthIn || b.diameterIn * 4.2 : 1.378;
    const diaDisp = this._fromIn(diaIn, u.dia);
    const lenDisp = this._fromIn(lenIn, u.len);

    // Bullet options grouped by caliber
    const groups = new Map();
    for (const x of bullets) {
      const key = x.caliber || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(x);
    }
    const bulletOptions = [...groups.entries()].map(([cal, list]) => `
      <optgroup label="${esc(cal)}">
        ${list.map((x) => `<option value="${esc(x.id)}" ${libBullet && libBullet.id === x.id ? 'selected' : ''}>${esc(x.name)} (${Number(x.weightGr)} gr)</option>`).join('')}
      </optgroup>`).join('');

    const dm = b.dragModel === 'G1' ? 'G1' : 'G7';
    const bcVal = p ? (dm === 'G1' ? b.bcG1 : b.bcG7) : 0.315;
    const title = editing ? 'Edit rifle' : 'New rifle';
    const v = (x) => esc(x ?? '');

    const html = `
      <dialog class="lg-modal lg-modal-lg rifle-dialog" aria-labelledby="rf-title" aria-describedby="rf-subtitle">
        <form id="rifle-builder-form" class="rifle-dialog-form" novalidate>
          <div class="rifle-dialog-head">
            <div class="rifle-dialog-heading">
              <h2 class="lg-modal-title" id="rf-title">${title}</h2>
              <p class="lg-muted rifle-dialog-sub" id="rf-subtitle">${editing ? esc(p.name) : 'Rifle, bullet and scope. The new rifle is used in the Solver.'}</p>
            </div>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon rifle-dialog-close" data-lg-close value="" data-close aria-label="Close">${icon('x')}</button>
          </div>

          <div class="lg-modal-body rifle-dialog-body">
            <fieldset class="rf-section">
              <legend class="lg-label">${icon('rifle')} Rifle</legend>
              <div class="field-grid-2">
                <div>
                  <label class="field-label" for="rf-name">Name</label>
                  <input type="text" id="rf-name" class="lg-input" maxlength="120" required placeholder="e.g. Tikka T3x 6.5 Creedmoor" value="${v(p?.name)}" />
                </div>
                <div>
                  <label class="field-label" for="rf-caliber">Caliber</label>
                  <input type="text" id="rf-caliber" class="lg-input" maxlength="80" required placeholder="e.g. 6.5 Creedmoor" value="${v(p?.caliber)}" />
                </div>
                <div class="field-span-2">
                  <label class="field-label" for="rf-desc">Notes (optional)</label>
                  <input type="text" id="rf-desc" class="lg-input" maxlength="200" placeholder="e.g. 26 in barrel, match load" value="${v(p?.description)}" />
                </div>
              </div>
              <div class="field-grid-3">
                <div>
                  <label class="field-label" for="rf-mv">Muzzle velocity (${u.vel})</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-mv" class="lg-input" min="${lim.mv[0]}" max="${lim.mv[1]}" step="${lim.mv[2]}" value="${mvDisp}" required aria-describedby="rf-mv-hint" />
                  <p class="field-hint" id="rf-mv-hint"></p>
                </div>
                <div>
                  <label class="field-label" for="rf-twist">Barrel twist (1 in … in)</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-twist" class="lg-input" min="5" max="20" step="0.25" value="${p ? p.twistRateIn : 8}" />
                </div>
                <div>
                  <label class="field-label" for="rf-twist-dir">Twist direction</label>
                  <select id="rf-twist-dir" class="lg-select">
                    <option value="right" ${p?.twistDirection !== 'left' ? 'selected' : ''}>Right hand</option>
                    <option value="left" ${p?.twistDirection === 'left' ? 'selected' : ''}>Left hand</option>
                  </select>
                </div>
                <div>
                  <label class="field-label" for="rf-sh">Sight height (${u.sh})</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-sh" class="lg-input" min="${lim.sh[0]}" max="${lim.sh[1]}" step="${lim.sh[2]}" value="${shDisp}" aria-describedby="rf-sh-hint" />
                  <p class="field-hint" id="rf-sh-hint">Centre of the bore to centre of the scope.</p>
                </div>
                <div>
                  <label class="field-label" for="rf-zero">Zero distance (${u.dist})</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-zero" class="lg-input" min="${lim.zero[0]}" max="${lim.zero[1]}" step="1" value="${zeroDisp}" />
                </div>
              </div>
            </fieldset>

            <fieldset class="rf-section">
              <legend class="lg-label">${icon('bullet')} Bullet</legend>
              <div class="field-row">
                <label class="field-label" for="rf-bullet-select">Bullet</label>
                <select id="rf-bullet-select" class="lg-select">
                  <option value="custom" ${libBullet ? '' : 'selected'}>Enter my own…</option>
                  ${bulletOptions}
                </select>
              </div>
              <div class="field-grid-3">
                <div class="field-span-2">
                  <label class="field-label" for="rf-bullet-name">Bullet name</label>
                  <input type="text" id="rf-bullet-name" class="lg-input rf-bullet-field" maxlength="120" required value="${v(p ? b.name : 'Custom bullet')}" />
                </div>
                <div>
                  <label class="field-label" for="rf-weight">Weight (gr)</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-weight" class="lg-input rf-bullet-field" min="15" max="1500" step="0.1" value="${p ? b.weightGr : 140}" />
                </div>
                <div>
                  <label class="field-label" for="rf-dia">Diameter (${u.dia})</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-dia" class="lg-input rf-bullet-field" min="${lim.dia[0]}" max="${lim.dia[1]}" value="${diaDisp}" />
                </div>
                <div>
                  <label class="field-label" for="rf-len">Length (${u.len})</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-len" class="lg-input rf-bullet-field" min="${lim.len[0]}" max="${lim.len[1]}" value="${lenDisp}" />
                </div>
                <div>
                  <label class="field-label" for="rf-drag-model">Drag model</label>
                  <select id="rf-drag-model" class="lg-select rf-bullet-field">
                    <option value="G7" ${dm === 'G7' ? 'selected' : ''}>G7 (boat-tail)</option>
                    <option value="G1" ${dm === 'G1' ? 'selected' : ''}>G1 (flat-base)</option>
                  </select>
                </div>
                <div>
                  <label class="field-label" for="rf-bc" id="rf-bc-label"><abbr title="Ballistic coefficient">BC</abbr> (${dm})</label>
                  <input type="text" inputmode="decimal" autocomplete="off" id="rf-bc" class="lg-input rf-bullet-field" min="0.05" max="${dm === 'G1' ? 2 : 1.5}" step="0.001" value="${bcVal}" aria-describedby="rf-bc-hint" />
                </div>
              </div>
              <p class="field-hint" id="rf-bc-hint">Picked from the list, both G1 and G7 values come with the bullet. For your own bullet the other one is estimated.</p>
            </fieldset>

            <fieldset class="rf-section">
              <legend class="lg-label">${icon('scope-cap')} Scope</legend>
              <div class="field-grid-2">
                <div class="field-span-2">
                  <label class="field-label" for="rf-optic-model">Scope model</label>
                  <input type="text" id="rf-optic-model" class="lg-input" maxlength="120" placeholder="e.g. Vortex Razor HD Gen III 6-36x56" value="${v(p?.optic?.model ?? '')}" />
                </div>
                <div>
                  <label class="field-label" for="rf-click-value">Click value</label>
                  <select id="rf-click-value" class="lg-select">
                    ${CLICKS.map((c) => `<option value="${c.id}" ${c.id === click.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="field-label" for="rf-reticle">Reticle</label>
                  <select id="rf-reticle" class="lg-select" aria-describedby="rf-reticle-hint">
                    ${RETICLES.map((r) => `<option value="${esc(r.id)}" data-unit="${r.unit}" ${r.id === reticleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
                  </select>
                  <p class="field-hint" id="rf-reticle-hint">Only reticles that match the click unit are offered.</p>
                </div>
                <div>
                  <label class="field-label" for="rf-focal-plane">Focal plane</label>
                  <select id="rf-focal-plane" class="lg-select">
                    <option value="FFP" ${p?.optic?.focalPlane !== 'SFP' ? 'selected' : ''}>First focal plane (FFP)</option>
                    <option value="SFP" ${p?.optic?.focalPlane === 'SFP' ? 'selected' : ''}>Second focal plane (SFP)</option>
                  </select>
                </div>
                <div class="rf-mag">
                  <span class="field-label" id="rf-mag-label">Magnification (lowest to highest)</span>
                  <div class="rf-mag-row">
                    <label class="lg-sr-only" for="rf-mag-min">Lowest magnification</label>
                    <input type="text" inputmode="numeric" autocomplete="off" id="rf-mag-min" class="lg-input" min="1" max="60" step="1" value="${p?.optic?.minMagnification ?? 5}" aria-describedby="rf-mag-label" />
                    <span class="rf-mag-sep">to</span>
                    <label class="lg-sr-only" for="rf-mag-max">Highest magnification</label>
                    <input type="text" inputmode="numeric" autocomplete="off" id="rf-mag-max" class="lg-input" min="1" max="100" step="1" value="${p?.optic?.maxMagnification ?? 25}" aria-describedby="rf-mag-label" />
                  </div>
                </div>
              </div>
            </fieldset>
          </div>

          <div class="lg-modal-actions">
            <button type="button" class="lg-btn" data-lg-close value="" data-close>Cancel</button>
            <button type="submit" class="lg-btn lg-btn-primary">${icon('save')} ${editing ? 'Save changes' : 'Save rifle'}</button>
          </div>
        </form>
      </dialog>
    `;

    const holder = document.createElement('div');
    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    holder.innerHTML = html;
    this.dialog = holder.firstElementChild;
    document.body.append(this.dialog);
    this.trigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    this.libBullet = libBullet || null;
    this.mvTouched = editing;
    // Fields shown rounded in the display unit: an unchanged field keeps its exact stored value,
    // so opening and saving a rifle never nudges e.g. a 100 m zero to 99.67 m in yards
    this.initial = { mv: [mvDisp, mvMs], sh: [shDisp, shM], zero: [zeroDisp, zeroM], dia: [diaDisp, diaIn], len: [lenDisp, lenIn] };

    this._bind();
    this._syncReticles();
    this._updateMvHint();

    // onSaved runs once the dialog is fully closed, so the caller can move focus back into the page
    // (while the close animation runs, the page behind the modal is still inert)
    const onClosed = () => {
      window.removeEventListener('hashchange', this._onHash);
      window.removeEventListener('navigate-view', this._onHash);
      this.dialog?.remove();
      this.dialog = null;
      const saved = this._saved;
      this._saved = null;
      if (saved) this.onSaved?.(saved);
    };
    if (typeof LadaGlass !== 'undefined' && LadaGlass.overlay?.open) {
      LadaGlass.overlay.open(this.dialog, { trigger: this.trigger, modal: true, onClose: onClosed });
    } else {
      this.dialog.addEventListener('close', () => {
        onClosed();
        this.trigger?.focus?.();
      });
      this.dialog.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) this.close();
      });
      this.dialog.showModal();
    }
    window.addEventListener('hashchange', this._onHash);
    window.addEventListener('navigate-view', this._onHash);
    this.dialog.querySelector('#rf-name')?.focus();
  }

  close() {
    const d = this.dialog;
    if (!d) return;
    if (typeof LadaGlass !== 'undefined' && LadaGlass.overlay?.close && d.open) {
      LadaGlass.overlay.close(d, '');
    } else if (d.open) {
      d.close();
    } else {
      d.remove();
      this.dialog = null;
    }
  }

  _q(sel) {
    return this.dialog?.querySelector(sel);
  }

  _click() {
    return CLICKS.find((c) => c.id === this._q('#rf-click-value')?.value) || CLICKS[0];
  }

  /** Keep the reticle consistent with the click unit: hide reticles in the other unit. */
  _syncReticles() {
    const unit = this._click().unit;
    const sel = this._q('#rf-reticle');
    if (!sel) return;
    let selectedOk = false;
    for (const opt of sel.options) {
      const ok = opt.dataset.unit === 'any' || opt.dataset.unit === unit;
      opt.disabled = !ok;
      opt.hidden = !ok;
      if (opt.selected && ok) selectedOk = true;
    }
    if (!selectedOk) sel.value = unit === 'MOA' ? 'EBR-2C MOA' : 'EBR-8 MRAD';
  }

  _updateMvHint() {
    const hint = this._q('#rf-mv-hint');
    if (!hint) return;
    const b = this.libBullet;
    const ms = b ? (b.factoryVelocityMs || (b.factoryVelocityFps ? b.factoryVelocityFps * 0.3048 : 0)) : 0;
    hint.replaceChildren();
    if (!ms) return;
    const u = this._units();
    const disp = Math.round(UnitConverter.fromSI(ms, u.vel));
    hint.append(document.createTextNode(`Factory: ${disp} ${u.vel}. Your chronograph value is better. `));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lg-btn lg-btn-ghost rf-inline-btn';
    btn.textContent = 'Use factory';
    btn.addEventListener('click', () => {
      const mv = this._q('#rf-mv');
      mv.value = String(disp);
      setFieldError(mv, '');
      this.mvTouched = true;
    });
    hint.append(btn);
  }

  _bind() {
    const d = this.dialog;
    d.querySelector('#rifle-builder-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._save();
    });

    // Live validation for every number field
    d.querySelectorAll('input[inputmode]').forEach((input) => {
      input.addEventListener('change', () => this._num(input));
    });
    d.querySelectorAll('input[required][type="text"]').forEach((input) => {
      input.addEventListener('input', () => {
        if (input.value.trim()) setFieldError(input, '');
      });
    });
    this._q('#rf-mv').addEventListener('input', () => {
      this.mvTouched = true;
    });

    this._q('#rf-click-value').addEventListener('change', () => this._syncReticles());

    this._q('#rf-drag-model').addEventListener('change', () => {
      const g1 = this._q('#rf-drag-model').value === 'G1';
      const label = this._q('#rf-bc-label');
      label.replaceChildren();
      const abbr = document.createElement('abbr');
      abbr.title = 'Ballistic coefficient';
      abbr.textContent = 'BC';
      label.append(abbr, document.createTextNode(` (${g1 ? 'G1' : 'G7'})`));
      const bc = this._q('#rf-bc');
      bc.max = g1 ? '2' : '1.5';
      if (this.libBullet) {
        const val = g1 ? this.libBullet.bcG1 : this.libBullet.bcG7;
        if (Number(val) > 0) bc.value = String(val);
      }
    });

    // Picking a bullet fills its fields; typing in a bullet field makes it "my own"
    this._q('#rf-bullet-select').addEventListener('change', (e) => {
      const id = e.target.value;
      const b = id === 'custom' ? null : (appState.state.projectilesLibrary || []).find((x) => x.id === id);
      this.libBullet = b || null;
      if (b) {
        this._q('#rf-bullet-name').value = b.name;
        this._q('#rf-weight').value = String(b.weightGr);
        const u = this._units();
        this._q('#rf-dia').value = String(this._fromIn(b.diameterIn, u.dia));
        this._q('#rf-len').value = String(this._fromIn(b.lengthIn || b.diameterIn * 4.2, u.len));
        const dm = b.dragModel === 'G1' ? 'G1' : 'G7';
        this._q('#rf-drag-model').value = dm;
        this._q('#rf-drag-model').dispatchEvent(new Event('change'));
        this.dialog.querySelectorAll('.rf-bullet-field').forEach((el) => setFieldError(el, ''));
        const ms = b.factoryVelocityMs || (b.factoryVelocityFps ? b.factoryVelocityFps * 0.3048 : 0);
        if (!this.mvTouched && ms) {
          const u = this._units();
          this._q('#rf-mv').value = String(Math.round(UnitConverter.fromSI(ms, u.vel)));
        }
        if (!this._q('#rf-caliber').value.trim() && b.caliber) this._q('#rf-caliber').value = b.caliber;
      }
      this._updateMvHint();
    });
    this.dialog.querySelectorAll('.rf-bullet-field').forEach((el) => {
      if (el.id === 'rf-drag-model') return;
      el.addEventListener('input', () => {
        if (!this.libBullet) return;
        this.libBullet = null;
        this._q('#rf-bullet-select').value = 'custom';
        this._updateMvHint();
      });
    });
  }

  /** Validates one number input; returns the value or NaN. */
  _num(input) {
    const value = parseNumber(input.value);
    const error = rangeError(input, value);
    setFieldError(input, error);
    return error ? NaN : value;
  }

  _save() {
    const d = this.dialog;
    const u = this._units();
    const text = (id) => this._q(`#${id}`).value.trim();
    const num = (id) => this._num(this._q(`#${id}`));

    const values = {
      mv: num('rf-mv'), twist: num('rf-twist'), sh: num('rf-sh'), zero: num('rf-zero'),
      weight: num('rf-weight'), dia: num('rf-dia'), len: num('rf-len'), bc: num('rf-bc'),
      magMin: num('rf-mag-min'), magMax: num('rf-mag-max'),
    };
    for (const id of ['rf-name', 'rf-caliber', 'rf-bullet-name']) {
      const el = this._q(`#${id}`);
      setFieldError(el, el.value.trim() ? '' : 'This is needed');
    }
    if (Number.isFinite(values.magMin) && Number.isFinite(values.magMax) && values.magMin > values.magMax) {
      setFieldError(this._q('#rf-mag-max'), 'Must be at least the lowest magnification');
    }

    const firstBad = d.querySelector('[aria-invalid="true"]');
    if (firstBad) {
      firstBad.focus();
      toast("Couldn't save the rifle", 'bad', 'Fix the marked fields.');
      return;
    }

    const dragModel = this._q('#rf-drag-model').value === 'G1' ? 'G1' : 'G7';
    const lib = this.libBullet;
    let bullet;
    if (lib) {
      const g7 = Number(lib.bcG7) > 0 ? lib.bcG7 : lib.bcG1 / G1_PER_G7;
      const g1 = Number(lib.bcG1) > 0 ? lib.bcG1 : lib.bcG7 * G1_PER_G7;
      bullet = {
        id: lib.id, name: lib.name, weightGr: lib.weightGr, diameterIn: lib.diameterIn,
        lengthIn: lib.lengthIn || lib.diameterIn * 4.2,
        bcG1: Number(g1.toFixed(3)), bcG7: Number(g7.toFixed(3)),
        // The user may have typed a different BC for the chosen model (e.g. a trued one)
        dragModel,
      };
      if (dragModel === 'G1') bullet.bcG1 = values.bc;
      else bullet.bcG7 = values.bc;
    } else {
      const sameAsBefore = this.profile && this.profile.bullet && this.profile.bullet.name === text('rf-bullet-name');
      bullet = {
        id: sameAsBefore ? this.profile.bullet.id : `bullet-${Date.now().toString(36)}`,
        name: text('rf-bullet-name').slice(0, 120),
        weightGr: values.weight,
        diameterIn: this.initial.dia[0] === values.dia ? this.initial.dia[1] : this._toIn(values.dia, u.dia),
        lengthIn: this.initial.len[0] === values.len ? this.initial.len[1] : this._toIn(values.len, u.len),
        bcG1: dragModel === 'G1' ? values.bc : Number((values.bc * G1_PER_G7).toFixed(3)),
        bcG7: dragModel === 'G7' ? values.bc : Number((values.bc / G1_PER_G7).toFixed(3)),
        dragModel,
      };
    }

    const click = this._click();
    const opticBase = this.profile?.optic || { zeroElevationClicks: 0, zeroWindageClicks: 0 };
    const minMag = Math.round(values.magMin);
    const maxMag = Math.round(values.magMax);
    const exact = (key, value, unit, decimals) => {
      const [shown, si] = this.initial?.[key] || [];
      return shown === value && Number.isFinite(si) ? si : Number(UnitConverter.toSI(value, unit).toFixed(decimals));
    };
    const zeroDistanceM = exact('zero', values.zero, u.dist, 2);
    const updates = {
      name: text('rf-name').slice(0, 120),
      caliber: text('rf-caliber').slice(0, 80),
      description: text('rf-desc').slice(0, 200),
      bullet,
      muzzleVelocityMs: exact('mv', values.mv, u.vel, 1),
      sightHeightM: exact('sh', values.sh, u.sh, 4),
      zeroDistanceM,
      zeroAngleRad: null, // re-zero with the new values
      twistRateIn: values.twist,
      twistDirection: this._q('#rf-twist-dir').value === 'left' ? 'left' : 'right',
      optic: {
        ...opticBase,
        model: text('rf-optic-model').slice(0, 120) || 'Scope',
        focalPlane: this._q('#rf-focal-plane').value === 'SFP' ? 'SFP' : 'FFP',
        reticle: this._q('#rf-reticle').value,
        clickValueRad: click.rad,
        clickName: click.name,
        minMagnification: minMag,
        maxMagnification: maxMag,
        currentMagnification: Math.min(maxMag, Math.max(minMag, opticBase.currentMagnification ?? Math.round((minMag + maxMag) / 2))),
      },
    };

    let saved;
    if (this.profile && appState.state.profiles.includes(this.profile)) {
      // Clicks of a different size make the stored zero offsets meaningless
      if (Math.abs((this.profile.optic?.clickValueRad || 0) - click.rad) > 1e-9) {
        updates.optic.zeroElevationClicks = 0;
        updates.optic.zeroWindageClicks = 0;
      }
      Object.assign(this.profile, updates);
      saved = this.profile;
      this._saved = saved;
      appState.notify('profiles');
      this.close();
    } else {
      saved = {
        id: `profile-${Date.now().toString(36)}`,
        powderTempSensitivity: 0.9,
        powderRefTempC: 15,
        rifleWeightKg: 6.5,
        ...updates,
        optic: { zeroElevationClicks: 0, zeroWindageClicks: 0, ...updates.optic },
      };
      this._saved = saved;
      appState.addProfile(saved);
      this.close();
    }
  }
}
