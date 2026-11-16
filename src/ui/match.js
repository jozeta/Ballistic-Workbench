/**
 * Ballistic Workbench - Match planner
 *
 * Matches hold stages; stages hold named targets with a distance, a shot angle (+ uphill), a
 * direction relative to the stage's main direction (+ right) and a size. Every target is solved live
 * for the active rifle and the Solver's atmosphere and wind: a target to the right of the main
 * direction sees the wind from a different clock angle, and Coriolis follows the true azimuth.
 * Edits are saved as they are made (validated by state.saveMatch). Matches can be shared as a file,
 * a link or a QR code.
 */

import { appState } from '../core/state.js';
import { UnitConverter } from '../core/units.js';
import { esc } from '../core/escape.js';
import { TARGETS, targetOf } from '../core/targets.js';
import { solveExact, atmosphereOf } from '../core/solve.js';
import { icon } from './icons.js';
import { parseNumber, rangeError, setFieldError } from './fields.js';
import { toast } from './notify.js';
import { openShareDialog } from './shareDialog.js';

const UNDO_MS = 8000;
const newId = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

function units() {
  const s = appState.state;
  const d = s.displayUnits;
  const imp = s.systemUnits === 'imperial';
  return { dist: d.distance === 'yd' ? 'yd' : 'm', ang: d.elevationAngle === 'MOA' ? 'MOA' : 'MRAD', size: imp ? 'in' : 'cm' };
}
const toU = (si, unit) => UnitConverter.fromSI(si, unit);
const fromU = (v, unit) => UnitConverter.toSI(v, unit);

/** An example to start from: a two-stage club match. */
function exampleMatch() {
  const t = (name, d, ang, off, shape = 'square', w = 30, h = 30) => ({ id: newId('tgt'), name, distanceM: d, inclinationDeg: ang, offsetDeg: off, targetShape: shape, widthCm: w, heightCm: h });
  return {
    id: newId('match'),
    name: 'Club match (example)',
    date: new Date().toISOString().slice(0, 10),
    stages: [
      { id: newId('stage'), name: 'Barricade', note: '2 rounds per target, 90 s', targets: [t('T1 plate', 365, 0, -10), t('T2 IPSC', 512, 2, 0, 'ipsc', 45, 75), t('T3 small plate', 640, 3, 15, 'circle', 25, 25)] },
      { id: newId('stage'), name: 'Rooftop', note: 'Shooting down', targets: [t('Near', 280, -8, 0), t('Far', 455, -5, 20, 'nato-e', 50, 100)] },
    ],
  };
}

/** Field definitions for a target row: [key, label, unit kind, min SI, max SI, decimals]. */
const TARGET_FIELDS = [
  ['distanceM', 'Distance', 'dist', 25, 3000, 0],
  ['inclinationDeg', 'Angle (°)', null, -60, 60, 0],
  ['offsetDeg', 'Direction (°)', null, -90, 90, 0],
  ['widthCm', 'Width', 'size', 1, 500, 0],
  ['heightCm', 'Height', 'size', 1, 500, 0],
];

export class MatchView {
  constructor(container) {
    this.container = container;
    this.undo = null;
    this.render();
    this.unsubscribe = appState.subscribe((state, key) => {
      if (this._ownChange) return;
      if (['units', 'displayUnits', 'activeProfile', 'profiles', 'profile', 'import', 'matches', 'environment', 'activeEnvironment', 'solverConfig'].includes(key)) this.render();
    });
  }

  refresh() {
    this.render();
  }

  destroy() {
    this.unsubscribe?.();
    clearTimeout(this.undo?.timer);
  }

  _save(match) {
    this._ownChange = true;
    const saved = appState.saveMatch(match);
    this._ownChange = false;
    return saved;
  }

  /** Solution for one target: elevation and wind for the Solver's conditions, turned to the target. */
  _solve(t, env, atmos, profile) {
    const off = t.offsetDeg || 0;
    const turn = (deg) => (((deg - off) % 360) + 360) % 360;
    const tEnv = {
      ...env,
      inclinationDeg: t.inclinationDeg || 0,
      windDirectionDeg: turn(env.windDirectionDeg ?? 90),
      windZones: (env.windZones || []).map((z) => ({ ...z, directionDeg: turn(z.directionDeg) })),
      shootingAzimuthDeg: (((env.shootingAzimuthDeg || 0) + off) % 360 + 360) % 360,
    };
    return solveExact({
      profile,
      env: tEnv,
      config: appState.state.solverConfig,
      algorithm: appState.solverAlgorithm(),
      distanceM: t.distanceM,
      targetHeightM: t.heightCm / 100,
      atmos,
    });
  }

  render() {
    const u = units();
    const s = appState.state;
    const match = appState.getActiveMatch();
    const profile = appState.getActiveProfile();
    const env = appState.getActiveEnvironment();
    const windTxt = `${toU(env.windSpeedMs ?? 0, s.displayUnits.windSpeed || 'm/s').toFixed(1)} ${esc(s.displayUnits.windSpeed || 'm/s')} from ${Math.round(((env.windDirectionDeg ?? 90) / 30)) % 12 || 12} o'clock`;

    let body;
    if (!match) {
      body = `
        <div class="lg-card lg-empty tool-empty match-empty">
          <svg class="empty-art" aria-hidden="true" focusable="false"><use href="./assets/art.svg#empty"></use></svg>
          <strong>No matches yet</strong>
          <p>Plan a match: stages with named targets at known distances, angles and directions, solved for your rifle and the day's conditions.</p>
          <div class="card-actions"><button type="button" class="lg-btn lg-btn-primary" id="match-new">${icon('plus')} New match</button><button type="button" class="lg-btn" id="match-example">${icon('stage')} Start from an example</button></div>
        </div>`;
    } else {
      const atmos = atmosphereOf(env);
      body = `
        <section class="lg-card records-card match-head" aria-label="Match">
          <div class="match-bar">
            <div class="field-row match-pick">
              <label class="field-label" for="match-select">Match</label>
              <select class="lg-select" id="match-select">${s.matches.map((m) => `<option value="${esc(m.id)}" ${m.id === match.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
            </div>
            <div class="card-actions match-actions">
              <button type="button" class="lg-btn" id="match-new">${icon('plus')} New</button>
              <button type="button" class="lg-btn" id="match-share">${icon('share')} Share</button>
              <button type="button" class="lg-btn lg-btn-ghost" id="match-delete">${icon('trash')} Delete</button>
            </div>
          </div>
          <div class="field-grid-2">
            <div class="field-row"><label class="field-label" for="match-name">Name</label><input type="text" class="lg-input" id="match-name" maxlength="120" value="${esc(match.name)}" /></div>
            <div class="field-row"><label class="field-label" for="match-date">Date</label><input type="date" class="lg-input" id="match-date" value="${esc(match.date)}" /></div>
          </div>
        </section>
        ${match.stages.map((st, si) => this._stageHtml(match, st, si, u, env, atmos, profile)).join('')}
        <div class="card-actions"><button type="button" class="lg-btn" id="stage-add">${icon('plus')} Add stage</button></div>`;
    }

    // eslint-disable-next-line no-unsanitized/property -- reviewed: numbers, constants, icons and esc()'d strings only
    this.container.innerHTML = `
      <div class="records-view match-view">
        <header class="lg-header view-header">
          <div>
            <h1 class="lg-title">Match</h1>
            <p class="lg-muted">Stages with named targets, solved live for your rifle and the conditions set in the Solver.</p>
          </div>
        </header>
        <ul class="tool-context" aria-label="Using">
          <li class="lg-chip lg-plain">${icon('rifle')}<strong>${esc(profile.name)}</strong></li>
          <li class="lg-chip lg-plain">${icon('weather')}${esc(env.name)}</li>
          <li class="lg-chip lg-plain">${icon('wind')}${windTxt}</li>
        </ul>
        <div class="library-undo lg-alert lg-alert-info" id="match-undo" role="status" aria-live="polite" ${this.undo ? '' : 'hidden'}>
          ${this.undo ? `<span>${esc(this.undo.message)}</span><button type="button" class="lg-btn" id="match-undo-btn">${icon('arrow-left')} Undo</button>` : ''}
        </div>
        ${body}
      </div>`;
    this._bind();
  }

  _stageHtml(match, st, si, u, env, atmos, profile) {
    const angDec = u.ang === 'MRAD' ? 1 : 2;
    const clickRad = profile.optic?.clickValueRad > 0 ? profile.optic.clickValueRad : 0.0001;
    const num = (v, kind, dec) => (kind ? Number(toU(kind === 'size' ? v / 100 : v, u[kind]).toFixed(dec)) : v);
    const rows = st.targets.map((t, ti) => {
      const p = this._solve(t, env, atmos, profile);
      const base = `mt-${si}-${ti}`;
      const cellOf = ([key, label, kind, min, max, dec]) => {
        const lo = kind ? Math.ceil(toU(kind === 'size' ? min / 100 : min, u[kind])) : min;
        const hi = kind ? Math.floor(toU(kind === 'size' ? max / 100 : max, u[kind])) : max;
        return `<td><input type="text" inputmode="decimal" autocomplete="off" class="lg-input match-cell" id="${base}-${key}" data-stage="${si}" data-target="${ti}" data-key="${key}" min="${lo}" max="${hi}" value="${num(t[key], kind, kind === 'size' && u.size === 'in' ? 1 : dec)}" aria-label="${esc(t.name)}: ${label}${kind ? ` (${u[kind]})` : ''}" /></td>`;
      };
      const cell = (key) => cellOf(TARGET_FIELDS.find((f) => f[0] === key));
      const elev = p ? `${toU(Math.abs(p.elevationClicks) * clickRad, u.ang).toFixed(angDec)}<span class="cell-sub">${p.elevationClicks >= 0 ? 'U' : 'D'} ${Math.abs(p.elevationClicks)}</span>` : '–';
      const wind = p ? (p.windageClicks === 0 ? '0' : `${p.windageClicks > 0 ? 'R' : 'L'} ${toU(Math.abs(p.windageClicks) * clickRad, u.ang).toFixed(angDec)}`) : '–';
      const wAng = toU(t.widthCm / 100 / t.distanceM, u.ang);
      const transonic = p && p.mach < 1.2;
      return `
        <tr>
          <th scope="row"><input type="text" class="lg-input match-cell match-name" id="${base}-name" data-stage="${si}" data-target="${ti}" data-key="name" maxlength="40" value="${esc(t.name)}" aria-label="Target ${ti + 1} name" /></th>
          ${cell('distanceM')}
          <td class="num sol"><strong>${elev}</strong>${transonic ? '<span class="lg-badge lg-badge-warn">Transonic</span>' : ''}</td>
          <td class="num sol"><strong>${wind}</strong></td>
          <td class="num sol">${wAng.toFixed(angDec)}</td>
          ${cell('inclinationDeg')}
          ${cell('offsetDeg')}
          <td><select class="lg-select match-cell match-type" id="${base}-shape" data-stage="${si}" data-target="${ti}" data-key="targetShape" aria-label="${esc(t.name)}: target type">${Object.entries(TARGETS).map(([k, v]) => `<option value="${k}" ${k === t.targetShape ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></td>
          ${cell('widthCm')}
          ${cell('heightCm')}
          <td><button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" data-del-target="${si}:${ti}" aria-label="Delete target ${esc(t.name)}">${icon('trash')}</button></td>
        </tr>`;
    }).join('');
    return `
      <section class="lg-card records-card stage-card" aria-labelledby="stage-${si}-title">
        <div class="card-head">
          <h2 class="lg-label" id="stage-${si}-title">${icon('stage')} Stage ${si + 1}</h2>
          <button type="button" class="lg-btn lg-btn-ghost" data-del-stage="${si}">${icon('trash')} Delete stage</button>
        </div>
        <div class="field-grid-2">
          <div class="field-row"><label class="field-label" for="stage-${si}-name">Stage name</label><input type="text" class="lg-input stage-field" id="stage-${si}-name" data-stage="${si}" data-key="name" maxlength="80" value="${esc(st.name)}" /></div>
          <div class="field-row"><label class="field-label" for="stage-${si}-note">Note</label><input type="text" class="lg-input stage-field" id="stage-${si}-note" data-stage="${si}" data-key="note" maxlength="120" value="${esc(st.note)}" placeholder="e.g. 2 rounds per target, 90 s" /></div>
        </div>
        ${st.targets.length ? `
        <div class="lg-table-wrap">
          <table class="lg-table match-table">
            <caption class="lg-sr-only">Stage ${si + 1} targets in shooting order, with the elevation, wind hold and target width for the current conditions</caption>
            <thead><tr>
              <th scope="col">Target</th><th scope="col">Distance (${u.dist})</th>
              <th scope="col" class="num">Elevation (${u.ang})</th><th scope="col" class="num">Wind (${u.ang})</th><th scope="col" class="num" title="How wide the target looks in your reticle">Size (${u.ang})</th>
              <th scope="col">Angle (°)</th><th scope="col">Direction (°)</th><th scope="col">Type</th>
              <th scope="col">Width (${u.size})</th><th scope="col">Height (${u.size})</th><th scope="col"><span class="lg-sr-only">Delete</span></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : '<p class="lg-muted">No targets yet.</p>'}
        <div class="card-actions"><button type="button" class="lg-btn" data-add-target="${si}">${icon('plus')} Add target</button></div>
        <p class="lg-small lg-muted">Angle: + uphill, − downhill. Direction: degrees right (+) or left (−) of the stage's main direction (12 o'clock for the wind). Elevation shows clicks up (U) or down (D); wind is the hold or dial left (L) or right (R).</p>
      </section>`;
  }

  _bind() {
    const q = (sel) => this.container.querySelector(sel);
    const u = units();
    const match = appState.getActiveMatch();
    const work = () => structuredClone(appState.getActiveMatch());
    const rerenderKeepFocus = (id) => {
      this.render();
      const el = id && this.container.querySelector(`#${CSS.escape(id)}`);
      el?.focus?.();
    };

    q('#match-new')?.addEventListener('click', () => {
      const m = this._save({ id: newId('match'), name: `Match ${appState.state.matches.length + 1}`, date: new Date().toISOString().slice(0, 10), stages: [{ id: newId('stage'), name: 'Stage 1', note: '', targets: [] }] });
      this.render();
      q('#match-name')?.focus();
      this.container.querySelector('#match-name')?.select();
      if (m) toast('Match created', 'ok', m.name);
    });
    q('#match-example')?.addEventListener('click', () => {
      this._save(exampleMatch());
      this.render();
      this.container.querySelector('#match-select')?.focus();
    });
    if (!match) return;

    q('#match-select')?.addEventListener('change', (e) => {
      this._ownChange = true;
      appState.setActiveMatch(e.target.value);
      this._ownChange = false;
      rerenderKeepFocus('match-select');
    });
    q('#match-name')?.addEventListener('change', (e) => {
      const m = work();
      m.name = e.target.value.trim() || 'Match';
      this._save(m);
      rerenderKeepFocus(document.activeElement?.id);
    });
    q('#match-date')?.addEventListener('change', (e) => {
      const m = work();
      m.date = e.target.value;
      this._save(m);
    });
    q('#match-share')?.addEventListener('click', (e) => openShareDialog({ kind: 'match', data: appState.getActiveMatch(), name: match.name, trigger: e.currentTarget }));
    q('#match-delete')?.addEventListener('click', () => {
      this._ownChange = true;
      const removed = appState.deleteMatch(match.id);
      this._ownChange = false;
      if (!removed) return;
      this._setUndo(`Match "${removed.match.name}" deleted.`, () => appState.restoreMatch(removed));
    });
    q('#stage-add')?.addEventListener('click', () => {
      const m = work();
      m.stages.push({ id: newId('stage'), name: `Stage ${m.stages.length + 1}`, note: '', targets: [] });
      this._save(m);
      rerenderKeepFocus(`stage-${m.stages.length - 1}-name`);
    });

    this.container.querySelectorAll('.stage-field').forEach((el) => el.addEventListener('change', () => {
      const m = work();
      const st = m.stages[Number(el.dataset.stage)];
      if (!st) return;
      st[el.dataset.key] = el.value;
      this._save(m);
    }));
    this.container.querySelectorAll('[data-del-stage]').forEach((btn) => btn.addEventListener('click', () => {
      const m = work();
      const i = Number(btn.dataset.delStage);
      const before = structuredClone(m);
      const [st] = m.stages.splice(i, 1);
      this._save(m);
      this._setUndo(`Stage "${st?.name || ''}" deleted.`, () => appState.saveMatch(before));
    }));
    this.container.querySelectorAll('[data-add-target]').forEach((btn) => btn.addEventListener('click', () => {
      const m = work();
      const si = Number(btn.dataset.addTarget);
      const st = m.stages[si];
      if (!st) return;
      const last = st.targets[st.targets.length - 1];
      const std = targetOf('square');
      st.targets.push({ id: newId('tgt'), name: `T${st.targets.length + 1}`, distanceM: last ? Math.min(3000, last.distanceM + 100) : 300, inclinationDeg: 0, offsetDeg: 0, targetShape: 'square', widthCm: std.w, heightCm: std.h });
      this._save(m);
      rerenderKeepFocus(`mt-${si}-${st.targets.length - 1}-name`);
    }));
    this.container.querySelectorAll('[data-del-target]').forEach((btn) => btn.addEventListener('click', () => {
      const [si, ti] = btn.dataset.delTarget.split(':').map(Number);
      const m = work();
      const before = structuredClone(m);
      const [t] = m.stages[si]?.targets.splice(ti, 1) || [];
      this._save(m);
      this._setUndo(`Target "${t?.name || ''}" deleted.`, () => appState.saveMatch(before));
    }));

    // Target cells: text and type save on change; numbers are validated first
    this.container.querySelectorAll('.match-cell').forEach((el) => el.addEventListener('change', () => {
      const m = work();
      const t = m.stages[Number(el.dataset.stage)]?.targets[Number(el.dataset.target)];
      if (!t) return;
      const key = el.dataset.key;
      if (key === 'name') t.name = el.value.trim() || t.name;
      else if (key === 'targetShape') {
        t.targetShape = el.value;
        const std = targetOf(el.value);
        t.widthCm = std.w;
        t.heightCm = std.h;
      } else {
        const v = parseNumber(el.value);
        const err = rangeError(el, v);
        setFieldError(el, err);
        if (err) return;
        const def = TARGET_FIELDS.find((f) => f[0] === key);
        const kind = def?.[2];
        t[key] = kind === 'size' ? fromU(v, u.size) * 100 : kind ? fromU(v, u[kind]) : v;
      }
      this._save(m);
      rerenderKeepFocus(el.id);
    }));

    q('#match-undo-btn')?.addEventListener('click', () => {
      const run = this.undo?.run;
      clearTimeout(this.undo?.timer);
      this.undo = null;
      if (!run) return;
      this._ownChange = true;
      run();
      this._ownChange = false;
      this.render();
      this.container.querySelector('#match-select, #match-new')?.focus();
    });
  }

  _setUndo(message, run) {
    clearTimeout(this.undo?.timer);
    this.undo = {
      message,
      run,
      timer: setTimeout(() => {
        this.undo = null;
        const bar = this.container.querySelector('#match-undo');
        if (bar) bar.hidden = true;
      }, UNDO_MS),
    };
    this.render();
    this.container.querySelector('#match-undo-btn')?.focus();
  }
}
