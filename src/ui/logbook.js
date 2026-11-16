/**
 * Ballistic Workbench - Logbook (impact records and multi-point truing)
 *
 * Each entry is one distance on one day: the elevation dialled, where the group landed relative to
 * the aim, and the conditions at the time (copied from the active atmosphere and wind). The needed
 * elevation is dial − impact ÷ distance. "Fit the model" finds the muzzle velocity, and with enough
 * spread in distance the drag (BC), that match every entry at once (src/physics/fit.js), and shows
 * how far each entry is off before and after. Entries belong to a rifle.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { esc } from '../core/escape.js';
import { solveExact } from '../core/solve.js';
import { CONDITIONS_TEMPLATE } from '../core/sanitize.js';
import { fitLogbook, canFitDrag, DRAG_FIT_MIN_RANGE_M, DRAG_FIT_MIN_SPAN } from '../physics/fit.js';
import { icon } from './icons.js';
import { bindNumber, parseNumber, rangeError, setFieldError } from './fields.js';
import { toast } from './notify.js';

const UNDO_MS = 8000;
const today = () => new Date().toISOString().slice(0, 10);

function units() {
  const s = appState.state;
  const d = s.displayUnits;
  const imp = s.systemUnits === 'imperial';
  return {
    dist: d.distance === 'yd' ? 'yd' : 'm',
    ang: d.elevationAngle === 'MOA' ? 'MOA' : 'MRAD',
    size: imp ? 'in' : 'cm',
    vel: d.velocity === 'fps' ? 'fps' : 'm/s',
    temp: d.temperature === 'F' ? 'F' : 'C',
  };
}
const toU = (si, unit) => UnitConverter.fromSI(si, unit);
const fromU = (v, unit) => UnitConverter.toSI(v, unit);
/** Signed number at d decimals; a value that rounds to zero shows no sign. */
const signed = (n, d) => {
  const r = Number(n.toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`;
};

/** The conditions to save with a new entry: the active atmosphere and wind. */
function currentConditions() {
  const env = appState.getActiveEnvironment();
  const out = {};
  for (const k of Object.keys(CONDITIONS_TEMPLATE)) out[k] = Number.isFinite(env[k]) ? env[k] : CONDITIONS_TEMPLATE[k];
  return out;
}

/** The environment object the solver needs, built from saved conditions. */
const envOf = (c) => ({ ...c, windZones: [], cantDeg: 0 });

export class LogbookView {
  constructor(container) {
    this.container = container;
    this.fit = null; // last fit result, for the active rifle
    this.undo = null;
    this.draft = { date: today(), distanceM: 600, dialRad: null, impactOffsetM: 0, note: '' };
    this.render();
    this.unsubscribe = appState.subscribe((state, key) => {
      if (this._ownChange) return;
      if (['activeProfile', 'profiles', 'import'].includes(key)) {
        this.fit = null;
        this.draft.dialRad = null;
      }
      if (['units', 'displayUnits', 'activeProfile', 'profiles', 'profile', 'import', 'logbook', 'environment', 'activeEnvironment', 'solverConfig'].includes(key)) this.render();
    });
  }

  refresh() {
    this.render();
  }

  destroy() {
    this.unsubscribe?.();
    clearTimeout(this.undo?.timer);
  }

  /** The model's elevation (rad) at a distance in the given conditions, for the active rifle. */
  _predict(distanceM, conditions) {
    const p = solveExact({
      profile: { ...appState.getActiveProfile(), zeroAngleRad: null },
      env: envOf(conditions),
      config: appState.state.solverConfig,
      algorithm: appState.solverAlgorithm(),
      distanceM,
    });
    return p ? p.elevationRad : NaN;
  }

  render() {
    const u = units();
    const s = appState.state;
    const profile = appState.getActiveProfile();
    const entries = appState.logbookFor().slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.distanceM - b.distanceM);
    const env = appState.getActiveEnvironment();
    const cond = currentConditions();
    if (this.draft.dialRad === null) this.draft.dialRad = this._predict(this.draft.distanceM, cond);
    const angDec = u.ang === 'MRAD' ? 2 : 2;
    const tempTxt = `${toU(cond.temperatureC + 273.15, u.temp).toFixed(0)} °${u.temp}`;
    const pressTxt = s.systemUnits === 'imperial' ? `${toU(cond.pressureHpa * 100, 'inHg').toFixed(2)} inHg` : `${cond.pressureHpa.toFixed(0)} hPa`;
    const field = (id, label, unit, value, min, max, hint = '') => `
      <div class="field-row">
        <label class="field-label" for="${id}">${label}${unit ? ` (${unit})` : ''}</label>
        <input type="text" inputmode="decimal" autocomplete="off" class="lg-input" id="${id}" min="${min}" max="${max}" value="${value}"${hint ? ` aria-describedby="${id}-hint"` : ''} />
        ${hint ? `<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
      </div>`;

    const rows = entries.map((e) => {
      const predicted = this._predict(e.distanceM, e.conditions);
      const off = (predicted - e.observedElevationRad);
      const after = this.fit?.byId?.get(e.id);
      const c = e.conditions;
      return `
        <tr>
          <td>${esc(e.date || '–')}</td>
          <td class="num">${Math.round(toU(e.distanceM, u.dist))}</td>
          <td class="num">${toU(e.dialRad, u.ang).toFixed(angDec)}</td>
          <td class="num">${signed(toU(e.impactOffsetM, u.size), u.size === 'in' ? 1 : 0)}</td>
          <td class="num"><strong>${toU(e.observedElevationRad, u.ang).toFixed(angDec)}</strong></td>
          <td class="num">${Number.isFinite(predicted) ? toU(predicted, u.ang).toFixed(angDec) : '–'}</td>
          <td class="num ${Math.abs(off) > 0.0001 ? 'is-off' : ''}">${Number.isFinite(off) ? signed(toU(off, u.ang), angDec) : '–'}</td>
          ${this.fit ? `<td class="num">${after !== undefined ? signed(toU(after / 1000, u.ang), angDec) : '–'}</td>` : ''}
          <td class="log-cond">${toU(c.temperatureC + 273.15, u.temp).toFixed(0)} °${u.temp}${e.note ? ` · ${esc(e.note)}` : ''}</td>
          <td><button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" data-delete="${esc(e.id)}" aria-label="Delete the ${Math.round(toU(e.distanceM, u.dist))} ${u.dist} entry from ${esc(e.date || 'no date')}">${icon('trash')}</button></td>
        </tr>`;
    }).join('');

    const dragOk = canFitDrag(entries);
    const fitHint = entries.length === 0
      ? 'Add entries first.'
      : dragOk
        ? `Fits the muzzle velocity and the drag (BC) to all ${entries.length} entries.`
        : `Fits the muzzle velocity only. To fit the drag too, add entries that reach ${Math.round(toU(DRAG_FIT_MIN_RANGE_M, u.dist))} ${u.dist} or more, with the furthest at least ${DRAG_FIT_MIN_SPAN} × the nearest.`;

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    this.container.innerHTML = `
      <div class="records-view logbook-view">
        <header class="lg-header view-header">
          <div>
            <h1 class="lg-title">Logbook</h1>
            <p class="lg-muted">Record the elevation that hit at each distance. Then fit the model to all your entries at once: it trues the muzzle velocity, and the drag when your entries reach far enough.</p>
          </div>
        </header>
        <ul class="tool-context" aria-label="Using">
          <li class="lg-chip lg-plain">${icon('rifle')}<strong>${esc(profile.name)}</strong></li>
          <li class="lg-chip lg-plain">${icon('notebook')}${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</li>
        </ul>
        <div class="library-undo lg-alert lg-alert-info" id="log-undo" role="status" aria-live="polite" ${this.undo ? '' : 'hidden'}>
          ${this.undo ? `<span>${esc(this.undo.message)}</span><button type="button" class="lg-btn" id="log-undo-btn">${icon('arrow-left')} Undo</button>` : ''}
        </div>
        <div class="records-layout">
          <section class="lg-card records-card" aria-labelledby="log-add-title">
            <h2 class="lg-label" id="log-add-title">${icon('plus')} Add an entry</h2>
            <div class="field-grid-2">
              <div class="field-row">
                <label class="field-label" for="log-date">Date</label>
                <input type="date" class="lg-input" id="log-date" value="${esc(this.draft.date)}" max="${today()}" />
              </div>
              ${field('log-dist', 'Distance', u.dist, Math.round(toU(this.draft.distanceM, u.dist)), Math.ceil(toU(50, u.dist)), Math.floor(toU(3000, u.dist)))}
              ${field('log-dial', 'Elevation dialled', u.ang, Number.isFinite(this.draft.dialRad) ? toU(this.draft.dialRad, u.ang).toFixed(angDec) : '', 0, Math.round(toU(0.15, u.ang)))}
              ${field('log-impact', 'Group centre vs aim', u.size, Number(toU(this.draft.impactOffsetM, u.size).toFixed(1)), -Math.round(toU(2, u.size)), Math.round(toU(2, u.size)))}
            </div>
            <p class="field-hint" id="log-impact-hint">Group centre high: positive; low: negative; on the aim point: 0. The elevation the model should have given is then worked out for you. The model says <strong id="log-model">${Number.isFinite(this.draft.dialRad) ? `${toU(this._predict(this.draft.distanceM, cond), u.ang).toFixed(angDec)} ${u.ang}` : '–'}</strong> at this distance.</p>
            <div class="field-row">
              <label class="field-label" for="log-note">Note (optional)</label>
              <input type="text" class="lg-input" id="log-note" maxlength="120" value="${esc(this.draft.note)}" placeholder="e.g. 5 shots, prone, light wind" />
            </div>
            <p class="lg-small lg-muted log-cond-note">${icon('weather')} Saved with the conditions now set in the Solver: ${esc(env.name)} · ${tempTxt} · ${pressTxt}. Change them there first if the day was different.</p>
            <div class="card-actions"><button type="button" class="lg-btn lg-btn-primary" id="log-add">${icon('plus')} Add entry</button></div>
          </section>

          <section class="lg-card records-card log-fit" aria-labelledby="log-fit-title">
            <h2 class="lg-label" id="log-fit-title">${icon('turret')} Fit the model</h2>
            <p class="lg-muted">${fitHint}</p>
            ${entries.length ? `<div class="card-actions"><button type="button" class="lg-btn ${this.fit ? '' : 'lg-btn-primary'}" id="log-fit">${icon('refresh')} Fit to ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</button></div>` : ''}
            <div id="log-fit-result" aria-live="polite">${this._fitHtml(u)}</div>
          </section>
        </div>

        <section class="lg-card records-card" aria-labelledby="log-list-title">
          <h2 class="lg-label" id="log-list-title">${icon('list')} Entries for ${esc(profile.name)}</h2>
          ${entries.length ? `
          <div class="lg-table-wrap">
            <table class="lg-table log-table">
              <caption class="lg-sr-only">Logbook entries: elevation dialled, group centre, the elevation that would have hit, the model's elevation and how far it is off</caption>
              <thead><tr>
                <th scope="col">Date</th><th scope="col" class="num">Distance (${u.dist})</th><th scope="col" class="num">Dialled (${u.ang})</th>
                <th scope="col" class="num">Group (${u.size})</th><th scope="col" class="num">Needed (${u.ang})</th><th scope="col" class="num">Model (${u.ang})</th>
                <th scope="col" class="num">Model off (${u.ang})</th>${this.fit ? `<th scope="col" class="num">After fit (${u.ang})</th>` : ''}<th scope="col">Conditions</th><th scope="col"><span class="lg-sr-only">Delete</span></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="lg-small lg-muted">Needed = dialled − group centre ÷ distance. Model off = the model's elevation in that day's conditions minus the needed elevation: positive means the model asks for too much.</p>` : `
          <div class="lg-empty tool-empty"><svg class="empty-art" aria-hidden="true" focusable="false"><use href="./assets/art.svg#empty"></use></svg><strong>No entries yet</strong>Shoot a group at a known distance, then add the elevation you dialled and where the group landed.</div>`}
        </section>
      </div>`;
    this._bind();
  }

  _fitHtml(u) {
    const f = this.fit;
    if (!f) return '';
    const vel = (ms) => `${toU(ms, u.vel).toFixed(u.vel === 'fps' ? 0 : 1)} ${u.vel}`;
    const angDec = 2;
    const changed = Math.abs(f.muzzleVelocityMs - f.mvBefore) > 0.05 || (f.fittedDrag && Math.abs(f.bc - f.originalBc) > 0.0005);
    return `
      <dl class="log-fit-list">
        <div><dt>Muzzle velocity</dt><dd>${vel(f.mvBefore)} → <strong>${vel(f.muzzleVelocityMs)}</strong></dd></div>
        <div><dt>BC (${f.dragModel})</dt><dd>${f.fittedDrag ? `${f.originalBc.toFixed(3)} → <strong>${f.bc.toFixed(3)}</strong>` : `${f.originalBc.toFixed(3)} (not fitted)`}</dd></div>
        <div><dt>Average miss of the model</dt><dd>${toU(f.rmsBeforeMrad / 1000, u.ang).toFixed(angDec)} → <strong>${toU(f.rmsAfterMrad / 1000, u.ang).toFixed(angDec)}</strong> ${u.ang}</dd></div>
      </dl>
      ${f.applied
        ? `<p class="applied-note" tabindex="-1">${icon('check')} Applied to ${esc(f.rifleName)}.</p>`
        : changed
          ? `<div class="card-actions"><button type="button" class="lg-btn lg-btn-primary btn-wrap" id="log-apply">${icon('check')} Apply to ${esc(f.rifleName)}</button></div>`
          : `<p class="lg-muted">The model already matches your entries.</p>`}
      ${f.rmsAfterMrad > 0.15 ? `<div class="lg-alert lg-alert-warn" role="status">${icon('alert')}<div><strong>Some entries still disagree</strong><p>Check the entries that are far off after the fit: a wrong distance, a mis-read dial or a different load are the usual causes.</p></div></div>` : ''}`;
  }

  _runFit() {
    const profile = appState.getActiveProfile();
    const entries = appState.logbookFor();
    const res = fitLogbook({
      profile,
      algorithm: appState.solverAlgorithm(),
      entries: entries.map((e) => ({ id: e.id, distanceM: e.distanceM, observedElevationRad: e.observedElevationRad, environment: envOf(e.conditions) })),
    });
    if (!res) {
      toast('Could not fit the model', 'bad', 'Check the entries for impossible values.');
      return;
    }
    const byId = new Map(entries.map((e, i) => [e.id, res.after[i].residualMrad]));
    this.fit = { ...res, mvBefore: profile.muzzleVelocityMs, rifleName: profile.name, byId, applied: false };
    this.render();
    this.container.querySelector('#log-fit-result')?.focus?.();
  }

  _apply() {
    const f = this.fit;
    if (!f) return;
    const profile = appState.getActiveProfile();
    const updates = { muzzleVelocityMs: Number(f.muzzleVelocityMs.toFixed(1)), zeroAngleRad: null };
    if (f.fittedDrag) updates.bullet = { ...profile.bullet, [f.dragModel === 'G1' ? 'bcG1' : 'bcG7']: Number(f.bc.toFixed(4)) };
    this._ownChange = true;
    appState.updateActiveProfile(updates);
    this._ownChange = false;
    f.applied = true;
    this.draft.dialRad = null; // the model changed: start the dial at its new answer
    toast('Model updated', 'ok', `${profile.name}: ${f.fittedDrag ? 'muzzle velocity and BC' : 'muzzle velocity'} applied.`);
    this.render();
    this.container.querySelector('.log-fit .applied-note')?.focus();
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    const u = units();
    q('#log-date')?.addEventListener('change', (e) => {
      this.draft.date = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : today();
    });
    bindNumber(q('#log-dist'), (v) => {
      this.draft.distanceM = fromU(v, u.dist);
      // A new distance: start the dial at the model's answer there
      const pred = this._predict(this.draft.distanceM, currentConditions());
      this.draft.dialRad = pred;
      const dial = q('#log-dial');
      if (dial && Number.isFinite(pred)) dial.value = toU(pred, u.ang).toFixed(2);
      const model = q('#log-model');
      if (model) model.textContent = Number.isFinite(pred) ? `${toU(pred, u.ang).toFixed(2)} ${u.ang}` : '–';
    });
    bindNumber(q('#log-dial'), (v) => { this.draft.dialRad = fromU(v, u.ang); });
    bindNumber(q('#log-impact'), (v) => { this.draft.impactOffsetM = fromU(v, u.size); });
    q('#log-note')?.addEventListener('input', (e) => { this.draft.note = e.target.value; });

    q('#log-add')?.addEventListener('click', () => {
      // Read and validate what is in the fields now (a value typed without leaving the field
      // counts), without the distance field's side effect of resetting the dial
      const read = {};
      let bad = false;
      for (const [key, id, unit] of [['distanceM', '#log-dist', u.dist], ['dialRad', '#log-dial', u.ang], ['impactOffsetM', '#log-impact', u.size]]) {
        const el = q(id);
        const v = parseNumber(el?.value);
        const err = el ? rangeError(el, v) : 'missing';
        if (el) setFieldError(el, err);
        if (err) bad = true;
        else read[key] = fromU(v, unit);
      }
      if (bad) {
        toast('Check the highlighted fields', 'bad');
        this.container.querySelector('.records-card [aria-invalid="true"]')?.focus();
        return;
      }
      const d = { ...this.draft, ...read };
      this._ownChange = true;
      const added = appState.addLogEntry({
        profileId: appState.state.activeProfileId,
        date: d.date,
        distanceM: d.distanceM,
        dialRad: d.dialRad,
        impactOffsetM: d.impactOffsetM,
        note: d.note.trim(),
        conditions: currentConditions(),
      });
      this._ownChange = false;
      if (!added) {
        toast('Entry not added', 'bad', 'Check the values.');
        return;
      }
      if (this.fit) this.fit = null; // the fit was for the old set of entries
      this.draft = { ...d, impactOffsetM: 0, note: '', dialRad: null, distanceM: d.distanceM };
      toast('Entry added', 'ok', `${Math.round(toU(added.distanceM, u.dist))} ${u.dist}, ${added.date || 'no date'}`);
      this.render();
      this.container.querySelector('#log-dist')?.focus();
    });

    q('#log-fit')?.addEventListener('click', () => this._runFit());
    q('#log-apply')?.addEventListener('click', () => this._apply());

    this.container.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._ownChange = true;
        const removed = appState.deleteLogEntry(btn.dataset.delete);
        this._ownChange = false;
        if (!removed) return;
        this.fit = null;
        clearTimeout(this.undo?.timer);
        this.undo = {
          message: `Entry deleted (${Math.round(toU(removed.entry.distanceM, u.dist))} ${u.dist}, ${removed.entry.date || 'no date'}).`,
          removed,
          timer: setTimeout(() => {
            this.undo = null;
            const bar = this.container.querySelector('#log-undo');
            if (bar) bar.hidden = true;
          }, UNDO_MS),
        };
        this.render();
        this.container.querySelector('#log-undo-btn')?.focus();
      });
    });
    q('#log-undo-btn')?.addEventListener('click', () => {
      const removed = this.undo?.removed;
      clearTimeout(this.undo?.timer);
      this.undo = null;
      if (!removed) return;
      this._ownChange = true;
      appState.restoreLogEntry(removed);
      this._ownChange = false;
      this.render();
      this.container.querySelector('[data-delete]')?.focus();
    });
  }
}
