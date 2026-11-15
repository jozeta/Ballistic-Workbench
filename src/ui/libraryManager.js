/**
 * Ballistic Workbench - Library view.
 * Three tabs:
 *   Rifles       saved rifles: use, edit, duplicate, delete (with undo), new rifle
 *   Bullets      searchable bullet list, filtered to the rifle's bullet diameter by default;
 *                "Use" puts a bullet in the current rifle (keeps its trued muzzle velocity unless
 *                the user opts in to the factory velocity), with undo
 *   Add a bullet custom bullet form with a live Miller stability check against the rifle's twist
 * Backups: Export… / Import… (JSON, max 2 MB, validated by appState.importJSON).
 */

import { appState } from '../core/state.js';
import { esc } from '../core/escape.js';
import { UnitConverter } from '../core/units.js';
import { MAX_IMPORT_BYTES } from '../core/sanitize.js';
import { calculateStability, PROJECTILES } from '../data/projectiles.js';
import { RifleBuilderModal } from './rifleBuilderModal.js';
import { icon } from './icons.js';
import { toast } from './notify.js';
import { bindNumber, parseNumber, rangeError, setFieldError } from './fields.js';

const TABS = [
  { id: 'rifles', label: 'Rifles', icon: 'rifle' },
  { id: 'bullets', label: 'Bullets', icon: 'bullet' },
  { id: 'add', label: 'Add a bullet', icon: 'plus' },
];

const UNDO_MS = 10000;
const FACTORY_IDS = new Set(PROJECTILES.map((p) => p.id));
// Same rough G1/G7 ratio the solver falls back to when a bullet only has one BC
const G1_PER_G7 = 1.95;

/** Diameter key for grouping bullets that fit the same bore, e.g. "0.308". */
const diaKey = (d) => (Number.isFinite(Number(d)) ? Number(d).toFixed(3) : '');
const fmtDia = (key) => `${key.replace(/^0/, '')} in`;

export class LibraryManagerView {
  constructor(containerElement) {
    this.container = containerElement;
    this.activeTab = 'rifles';
    this.searchQuery = '';
    this.caliberFilter = null; // null = follow the rifle's bullet diameter; 'all' or a diameter key
    this.useFactoryMv = false;
    this.undo = null; // { message, run, timer }
    this.draft = null; // values typed in "Add a bullet", kept across re-renders

    this._onClick = (e) => this._handleClick(e);
    this.container.addEventListener('click', this._onClick);

    this.render();

    this.unsubscribe = appState.subscribe((state, key) => {
      if (['profile', 'profiles', 'activeProfile', 'import', 'projectiles', 'units', 'displayUnits'].includes(key)) {
        this._saveDraft();
        this.render();
      }
    });
  }

  /** Full rebuild (theme change). */
  refresh() {
    this._saveDraft();
    this.render();
  }

  destroy() {
    this.unsubscribe?.();
    this.container.removeEventListener('click', this._onClick);
    if (this.undo?.timer) clearTimeout(this.undo.timer);
    this.undo = null;
  }

  // ---- units ----------------------------------------------------------------------------------

  _units() {
    const isImp = appState.state.systemUnits === 'imperial';
    const du = appState.state.displayUnits || {};
    return {
      isImp,
      vel: du.velocity || (isImp ? 'fps' : 'm/s'),
      dist: du.distance || (isImp ? 'yd' : 'm'),
      sh: du.sightHeight || (isImp ? 'in' : 'cm'),
    };
  }

  _velocity(ms) {
    const u = this._units();
    if (!Number.isFinite(ms) || ms <= 0) return '–';
    return `${Math.round(UnitConverter.fromSI(ms, u.vel))} ${u.vel}`;
  }

  _factoryMs(b) {
    if (Number.isFinite(b.factoryVelocityMs) && b.factoryVelocityMs > 0) return b.factoryVelocityMs;
    if (Number.isFinite(b.factoryVelocityFps) && b.factoryVelocityFps > 0) return b.factoryVelocityFps * 0.3048;
    return null;
  }

  // ---- render ---------------------------------------------------------------------------------

  render() {
    const panel = this.activeTab === 'bullets' ? this.renderBullets() : this.activeTab === 'add' ? this.renderAdd() : this.renderRifles();

    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    this.container.innerHTML = `
      <section class="library-view lg-stack" aria-labelledby="library-title">
        <header class="lg-header view-header">
          <div>
            <h1 class="lg-title" id="library-title">Library</h1>
            <p class="lg-muted">Your rifles and bullets. Pick a bullet for a rifle, or add your own.</p>
          </div>
          <div class="lg-row library-backup">
            <button type="button" class="lg-btn" data-action="export" aria-describedby="backup-hint" data-lg-tooltip="Save rifles, bullets and settings to a file">${icon('download')} Export</button>
            <button type="button" class="lg-btn" data-action="import" aria-describedby="backup-hint" data-lg-tooltip="Load a backup file">${icon('upload')} Import…</button>
            <input type="file" id="import-json-file" accept=".json,application/json" hidden />
            <p class="lg-sr-only" id="backup-hint">Export saves your rifles, bullets and settings to a backup file. Import loads a backup: it replaces your rifles and settings and adds its bullets. You can undo an import right after.</p>
          </div>
        </header>

        <div class="lg-tabs library-tabs" role="tablist" aria-label="Library sections">
          ${TABS.map((t) => `
            <button type="button" class="lg-tab" role="tab" id="lib-tab-${t.id}" aria-controls="lib-panel" data-tab="${t.id}"
              aria-selected="${this.activeTab === t.id}" tabindex="${this.activeTab === t.id ? '0' : '-1'}">${icon(t.icon)} ${t.label}</button>`).join('')}
        </div>

        <div class="library-panel" role="tabpanel" id="lib-panel" aria-labelledby="lib-tab-${this.activeTab}">
          ${panel}
        </div>

        <div class="library-undo lg-glass" id="library-undo" role="status" aria-live="polite" ${this.undo ? '' : 'hidden'}>
          ${this.undo ? this._undoInner() : ''}
        </div>
      </section>
    `;

    this._bindTabs();
    this._bindImport();
    if (this.activeTab === 'bullets') this._bindBullets();
    if (this.activeTab === 'add') this._bindAdd();
  }

  _undoInner() {
    return `<span>${esc(this.undo.message)}</span><button type="button" class="lg-btn" data-action="undo">${icon('arrow-left')} Undo</button>`;
  }

  _showUndo(message, run) {
    if (this.undo?.timer) clearTimeout(this.undo.timer);
    this.undo = { message, run, timer: setTimeout(() => this._clearUndo(), UNDO_MS) };
    this._paintUndo();
  }

  _clearUndo() {
    if (this.undo?.timer) clearTimeout(this.undo.timer);
    this.undo = null;
    this._paintUndo();
  }

  _paintUndo() {
    const bar = this.container.querySelector('#library-undo');
    if (!bar) return;
    bar.hidden = !this.undo;
    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    bar.innerHTML = this.undo ? this._undoInner() : '';
  }

  // ---- rifles ---------------------------------------------------------------------------------

  renderRifles() {
    const { profiles, activeProfileId } = appState.state;
    const u = this._units();
    const only = profiles.length <= 1;

    const cards = profiles.map((p) => {
      const isActive = p.id === activeProfileId;
      const zero = `${Math.round(UnitConverter.fromSI(p.zeroDistanceM, u.dist))} ${u.dist}`;
      const sh = UnitConverter.fromSI(p.sightHeightM, u.sh).toFixed(u.sh === 'in' ? 2 : 1);
      const name = esc(p.name);
      const id = esc(p.id);
      return `
        <article class="lg-card rifle-card${isActive ? ' is-active' : ''}" data-rifle="${id}" aria-labelledby="rifle-${id}-name">
          <div class="rifle-card-head">
            <div class="rifle-card-title">
              <h3 id="rifle-${id}-name">${name}</h3>
              ${p.caliber ? `<p class="lg-small lg-muted">${esc(p.caliber)}</p>` : ''}
            </div>
            ${isActive ? `<span class="lg-badge lg-badge-ok rifle-badge">${icon('check')} In use</span>` : ''}
          </div>
          ${p.description ? `<p class="lg-muted rifle-card-notes">${esc(p.description)}</p>` : ''}
          <dl class="lg-kv rifle-specs">
            <dt>Bullet</dt><dd>${esc(p.bullet?.name)}</dd>
            <dt>Muzzle velocity</dt><dd>${this._velocity(p.muzzleVelocityMs)}</dd>
            <dt>Zero</dt><dd>${zero}</dd>
            <dt>Barrel twist</dt><dd>1 in ${Number(p.twistRateIn).toFixed(2).replace(/\.?0+$/, '')} in</dd>
            <dt>Sight height</dt><dd>${sh} ${u.sh}</dd>
            <dt>Scope</dt><dd>${esc(p.optic?.model)}${p.optic?.clickName ? ` · ${esc(p.optic.clickName)} clicks` : ''}</dd>
          </dl>
          <div class="rifle-card-actions">
            ${isActive
              ? `<a class="lg-btn lg-btn-ghost rifle-main-action" href="#workspace">Open in Solver ${icon('arrow-right')}</a>`
              : `<button type="button" class="lg-btn rifle-main-action" data-action="use-rifle" data-id="${id}" aria-label="Use ${name}">Use this rifle</button>`}
            <span class="toolbar-spacer"></span>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" data-action="edit-rifle" data-id="${id}" aria-label="Edit ${name}" data-lg-tooltip="Edit">${icon('edit')}</button>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" data-action="duplicate-rifle" data-id="${id}" aria-label="Duplicate ${name}" data-lg-tooltip="Duplicate">${icon('copy')}</button>
            <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon lib-danger" data-action="delete-rifle" data-id="${id}"
              aria-label="Delete ${name}" data-lg-tooltip="${only ? 'You need at least one rifle' : 'Delete'}" ${only ? 'aria-disabled="true"' : ''}>${icon('trash')}</button>
          </div>
        </article>`;
    }).join('');

    return `
      <div class="lib-toolbar">
        <h2 class="lg-label">Your rifles <span class="lib-count">${profiles.length}</span></h2>
        <button type="button" class="lg-btn lg-btn-primary" data-action="new-rifle">${icon('plus')} New rifle</button>
      </div>
      <div class="lg-grid rifle-grid">${cards}</div>
    `;
  }

  _findProfile(id) {
    return appState.state.profiles.find((p) => p.id === id);
  }

  _duplicateRifle(id) {
    const src = this._findProfile(id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.id = `profile-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    copy.name = `${src.name} (copy)`.slice(0, 200);
    const list = appState.state.profiles;
    list.splice(list.indexOf(src) + 1, 0, copy);
    appState.notify('profiles');
    toast('Rifle duplicated', 'ok', copy.name);
    this._refocus(`[data-rifle="${CSS.escape(copy.id)}"] .rifle-main-action`);
  }

  /** Deletes at once; the undo bar (10 s) is the safety net, so there is no extra confirm step. */
  _deleteRifle(id) {
    const list = appState.state.profiles;
    const p = this._findProfile(id);
    if (!p || list.length <= 1) return;
    const index = list.indexOf(p);
    if (index < 0) return;
    const wasActive = appState.state.activeProfileId === id;
    list.splice(index, 1);
    if (wasActive) appState.state.activeProfileId = list[Math.min(index, list.length - 1)].id;
    this._showUndo(`Deleted ${p.name}.`, () => {
      appState.state.profiles.splice(Math.min(index, appState.state.profiles.length), 0, p);
      if (wasActive) appState.state.activeProfileId = p.id;
      appState.notify('profiles');
    });
    appState.notify('profiles');
    this._focusUndo();
  }

  /** The dialog's opener was re-rendered: put focus on its replacement once the dialog has closed. */
  _refocus(selector) {
    requestAnimationFrame(() => this.container.querySelector(selector)?.focus());
  }

  /** After an action removes the focused button, keep keyboard users next to the way back. */
  _focusUndo() {
    this.container.querySelector('#library-undo [data-action="undo"]')?.focus();
  }

  // ---- bullets --------------------------------------------------------------------------------

  _diameterGroups() {
    const groups = new Map();
    for (const b of appState.state.projectilesLibrary) {
      const key = diaKey(b.diameterIn);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, new Set());
      if (b.caliber) groups.get(key).add(String(b.caliber));
    }
    return [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  _effectiveFilter() {
    if (this.caliberFilter) return this.caliberFilter;
    const key = diaKey(appState.getActiveProfile()?.bullet?.diameterIn);
    return appState.state.projectilesLibrary.some((b) => diaKey(b.diameterIn) === key) ? key : 'all';
  }

  _filteredBullets() {
    const filter = this._effectiveFilter();
    const tokens = this.searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return appState.state.projectilesLibrary.filter((b) => {
      if (filter !== 'all' && diaKey(b.diameterIn) !== filter) return false;
      if (!tokens.length) return true;
      const hay = `${b.name} ${b.manufacturer} ${b.caliber} ${b.type || ''} ${b.weightGr}gr ${b.weightGr} gr`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  renderBullets() {
    const profile = appState.getActiveProfile();
    const filter = this._effectiveFilter();
    const groups = this._diameterGroups();
    const options = groups.map(([key, cals]) => {
      const names = [...cals].join(', ');
      return `<option value="${key}" ${filter === key ? 'selected' : ''}>${esc(fmtDia(key))}: ${esc(names)}</option>`;
    }).join('');

    return `
      <div class="lg-card bullet-filters">
        <h2 class="lg-sr-only">Find a bullet</h2>
        <div class="bullet-controls">
          <div class="bullet-control bullet-control-rifle">
            <label class="field-label" for="lib-rifle-select">For rifle</label>
            <select id="lib-rifle-select" class="lg-select">
              ${appState.state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === profile.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="bullet-control bullet-control-search">
            <label class="field-label" for="proj-search">Search</label>
            <div class="lg-search">
              ${icon('search')}
              <input type="search" id="proj-search" placeholder="Name, maker or weight, e.g. ELD 140" value="${esc(this.searchQuery)}" autocomplete="off" />
            </div>
          </div>
          <div class="bullet-control">
            <label class="field-label" for="caliber-filter">Bullet diameter</label>
            <select id="caliber-filter" class="lg-select">
              <option value="all" ${filter === 'all' ? 'selected' : ''}>All diameters</option>
              ${options}
            </select>
          </div>
        </div>
        <div class="bullet-list-bar">
          <label class="lg-row bullet-factory" for="use-factory-mv">
            <input type="checkbox" class="lg-check" id="use-factory-mv" ${this.useFactoryMv ? 'checked' : ''} aria-describedby="factory-mv-hint" />
            Also set the factory muzzle velocity
          </label>
          <p class="lg-small bullet-count" id="bullet-count" aria-live="polite"></p>
          <p class="lg-small lg-muted" id="factory-mv-hint">"Use" puts the bullet in ${esc(profile.name)} and keeps its muzzle velocity (${this._velocity(profile.muzzleVelocityMs)}) unless this is ticked.</p>
        </div>
      </div>
      <div id="projectiles-table-wrapper">${this.renderBulletTable()}</div>
    `;
  }

  renderBulletTable() {
    const profile = appState.getActiveProfile();
    const list = this._filteredBullets();
    const inUseId = profile?.bullet?.id;
    const rifleName = esc(profile?.name || 'your rifle');
    const filtered = this._effectiveFilter() !== 'all';

    if (!list.length) {
      const reset = this.searchQuery.trim()
        ? '<button type="button" class="lg-btn" data-action="clear-search">Clear the search</button>'
        : '';
      const all = filtered ? '<button type="button" class="lg-btn" data-action="all-diameters">Show all diameters</button>' : '';
      return `
        <div class="lg-card lg-empty bullet-empty">
          <svg class="empty-art" aria-hidden="true" focusable="false"><use href="./assets/art.svg#empty"></use></svg>
          <strong>No bullets match</strong>
          <p>Try another search${filtered ? ' or all bullet diameters' : ''}, or add your own bullet.</p>
          <div class="lg-row bullet-empty-actions">${reset}${all}<button type="button" class="lg-btn lg-btn-ghost" data-action="go-add">${icon('plus')} Add a bullet</button></div>
        </div>`;
    }

    const rows = list.map((b) => {
      const inUse = b.id === inUseId;
      const custom = !FACTORY_IDS.has(b.id);
      const name = esc(b.name);
      const g7 = Number(b.bcG7) > 0 ? `G7 ${Number(b.bcG7).toFixed(3)}${b.bcG7Estimated ? ' <span class="lg-muted">(est.)</span>' : ''}` : '';
      const g1 = Number(b.bcG1) > 0 ? `G1 ${Number(b.bcG1).toFixed(3)}` : '';
      const factory = this._factoryMs(b);
      return `
        <tr class="${inUse ? 'is-in-use' : ''}">
          <th scope="row" class="bullet-name-cell">
            <span class="bullet-name">${name}</span>
            ${inUse ? '<span class="lg-badge lg-badge-ok">In use</span>' : ''}
            ${custom ? '<span class="lg-chip lg-plain">Custom</span>' : ''}
            <span class="bullet-sub lg-small lg-muted">${esc(b.manufacturer)}${b.type ? ` · ${esc(b.type)}` : ''}</span>
          </th>
          <td class="lg-num bullet-weight">${Number(b.weightGr)} gr</td>
          <td class="lg-num bullet-bc">${g7}${g7 && g1 ? '<br />' : ''}<span class="${g7 ? 'lg-muted' : ''}">${g1}</span></td>
          <td class="lg-num col-opt">${factory ? Math.round(UnitConverter.fromSI(factory, this._units().vel)) : '–'}</td>
          <td class="col-opt">${esc(b.recommendedTwist || '–')}</td>
          <td class="bullet-actions-cell"><div class="bullet-actions">
            ${inUse
              ? ''
              : `<button type="button" class="lg-btn lg-btn-ghost" data-action="use-bullet" data-id="${esc(b.id)}" aria-label="Use ${name} in ${rifleName}">Use</button>`}
            ${custom ? `<button type="button" class="lg-btn lg-btn-ghost lg-btn-icon lib-danger" data-action="delete-bullet" data-id="${esc(b.id)}" aria-label="Delete ${name}" data-lg-tooltip="Delete">${icon('trash')}</button>` : ''}
          </div></td>
        </tr>`;
    }).join('');

    const u = this._units();
    return `
      <div class="lg-table-wrap lg-table-sticky bullet-table-wrap">
        <table class="lg-table bullet-table">
          <caption class="lg-sr-only">Bullets. "Use" puts the bullet in ${rifleName}.</caption>
          <thead>
            <tr>
              <th scope="col">Bullet</th>
              <th scope="col" class="lg-num">Weight</th>
              <th scope="col" class="lg-num"><abbr title="Ballistic coefficient: how well the bullet keeps its speed">BC</abbr></th>
              <th scope="col" class="lg-num col-opt">Factory velocity (${u.vel})</th>
              <th scope="col" class="col-opt">Twist</th>
              <th scope="col"><span class="lg-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  _updateBulletTable() {
    const wrap = this.container.querySelector('#projectiles-table-wrapper');
    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    if (wrap) wrap.innerHTML = this.renderBulletTable();
    const count = this.container.querySelector('#bullet-count');
    if (count) {
      const n = this._filteredBullets().length;
      count.textContent = `${n} ${n === 1 ? 'bullet' : 'bullets'}`;
    }
  }

  _bindBullets() {
    this._updateBulletTable();
    const search = this.container.querySelector('#proj-search');
    search?.addEventListener('input', () => {
      this.searchQuery = search.value;
      this._updateBulletTable();
    });
    this.container.querySelector('#caliber-filter')?.addEventListener('change', (e) => {
      this.caliberFilter = e.target.value;
      this._updateBulletTable();
    });
    this.container.querySelector('#use-factory-mv')?.addEventListener('change', (e) => {
      this.useFactoryMv = e.target.checked;
    });
    this.container.querySelector('#lib-rifle-select')?.addEventListener('change', (e) => {
      this.caliberFilter = null; // follow the newly chosen rifle
      appState.setActiveProfile(e.target.value);
    });
  }

  _useBullet(id) {
    const bullet = appState.state.projectilesLibrary.find((b) => b.id === id);
    const profile = appState.getActiveProfile();
    if (!bullet || !profile) return;

    const before = { bullet: structuredClone(profile.bullet), mv: profile.muzzleVelocityMs, zero: profile.zeroAngleRad };
    const factory = this._factoryMs(bullet);
    const bcG7 = Number(bullet.bcG7) > 0 ? bullet.bcG7 : bullet.bcG1 / G1_PER_G7;
    const bcG1 = Number(bullet.bcG1) > 0 ? bullet.bcG1 : bullet.bcG7 * G1_PER_G7;
    profile.bullet = {
      id: bullet.id,
      name: bullet.name,
      weightGr: bullet.weightGr,
      diameterIn: bullet.diameterIn,
      lengthIn: bullet.lengthIn || bullet.diameterIn * 4.2,
      bcG1: Number(bcG1.toFixed(3)),
      bcG7: Number(bcG7.toFixed(3)),
      dragModel: bullet.dragModel === 'G1' ? 'G1' : 'G7',
      ...(bullet.bcG7Estimated ? { bcG7Estimated: true } : {}),
    };
    const mvChanged = this.useFactoryMv && factory;
    if (mvChanged) profile.muzzleVelocityMs = Number(factory.toFixed(1));
    profile.zeroAngleRad = null; // re-zero with the new bullet

    const diaWarn = Math.abs((before.bullet?.diameterIn || bullet.diameterIn) - bullet.diameterIn) > 0.002;
    const desc = [
      mvChanged ? `Muzzle velocity set to the factory ${this._velocity(factory)}.` : `Muzzle velocity kept at ${this._velocity(profile.muzzleVelocityMs)}.`,
      diaWarn ? `Note: this bullet is ${fmtDia(diaKey(bullet.diameterIn))}, the previous one was ${fmtDia(diaKey(before.bullet.diameterIn))}.` : '',
    ].filter(Boolean).join(' ');

    const pid = profile.id;
    this._showUndo(`${bullet.name} is now in ${profile.name}. ${desc}`, () => {
      const p = this._findProfile(pid);
      if (!p) return;
      p.bullet = before.bullet;
      p.muzzleVelocityMs = before.mv;
      p.zeroAngleRad = before.zero ?? null;
      appState.notify('profile');
    });
    appState.notify('profile');
    this._focusUndo();
  }

  _deleteBullet(id) {
    const list = appState.state.projectilesLibrary;
    const index = list.findIndex((b) => b.id === id);
    if (index < 0 || FACTORY_IDS.has(id)) return;
    const [removed] = list.splice(index, 1);
    this._showUndo(`Deleted ${removed.name}.`, () => {
      appState.state.projectilesLibrary.splice(Math.min(index, appState.state.projectilesLibrary.length), 0, removed);
      appState.notify('projectiles');
    });
    appState.notify('projectiles');
    this._focusUndo();
  }

  // ---- add a bullet ---------------------------------------------------------------------------

  _addFields() {
    const du = appState.state.displayUnits || {};
    const lenUnit = du.bulletLength === 'mm' ? 'mm' : 'in';
    const diaUnit = du.bulletDiameter === 'mm' ? 'mm' : 'in';
    const u = this._units();
    const mm = (inch) => Number((inch * 25.4).toFixed(2));
    return {
      lenUnit,
      diaUnit,
      velUnit: u.vel,
      weight: { min: 15, max: 1500, step: 0.1, def: 140 },
      dia: diaUnit === 'mm' ? { min: mm(0.17), max: mm(1.0), step: 0.01, def: 6.71 } : { min: 0.17, max: 1.0, step: 0.001, def: 0.264 },
      len: lenUnit === 'mm' ? { min: mm(0.25), max: mm(4), step: 0.1, def: 35.0 } : { min: 0.25, max: 4, step: 0.001, def: 1.378 },
      vel: u.vel === 'fps' ? { min: 600, max: 4500, step: 1 } : { min: 180, max: 1400, step: 1 },
    };
  }

  renderAdd() {
    const f = this._addFields();
    const d = this.draft || {};
    const v = (key, def = '') => esc(d[key] ?? def);
    const profile = appState.getActiveProfile();

    return `
      <div class="add-bullet-layout">
        <form class="lg-card add-bullet-form" id="add-bullet-form" novalidate aria-labelledby="add-bullet-title">
          <h2 class="lg-label" id="add-bullet-title">New bullet</h2>
          <p class="lg-muted add-intro">Get the BC and dimensions from the bullet maker's data. The stability check updates as you type.</p>
          <div class="field-grid-2">
            <div class="field-span-2">
              <label class="field-label" for="cust-name">Name</label>
              <input type="text" id="cust-name" class="lg-input" maxlength="120" required placeholder="e.g. Lapua 136 gr Scenar-L" value="${v('name')}" />
            </div>
            <div>
              <label class="field-label" for="cust-mfg">Maker (optional)</label>
              <input type="text" id="cust-mfg" class="lg-input" maxlength="80" placeholder="e.g. Lapua" value="${v('mfg')}" />
            </div>
            <div>
              <label class="field-label" for="cust-caliber">Caliber (optional)</label>
              <input type="text" id="cust-caliber" class="lg-input" maxlength="80" placeholder="e.g. 6.5 Creedmoor" value="${v('caliber')}" />
            </div>
          </div>
          <div class="field-grid-3">
            <div>
              <label class="field-label" for="cust-weight">Weight (gr)</label>
              <input type="text" inputmode="decimal" autocomplete="off" id="cust-weight" class="lg-input lib-num" min="${f.weight.min}" max="${f.weight.max}" step="${f.weight.step}" value="${v('weight', f.weight.def)}" />
            </div>
            <div>
              <label class="field-label" for="cust-dia">Diameter (${f.diaUnit})</label>
              <input type="text" inputmode="decimal" autocomplete="off" id="cust-dia" class="lg-input lib-num" min="${f.dia.min}" max="${f.dia.max}" step="${f.dia.step}" value="${v('dia', f.dia.def)}" />
            </div>
            <div>
              <label class="field-label" for="cust-len">Length (${f.lenUnit})</label>
              <input type="text" inputmode="decimal" autocomplete="off" id="cust-len" class="lg-input lib-num" min="${f.len.min}" max="${f.len.max}" step="${f.len.step}" value="${v('len', f.len.def)}" />
            </div>
          </div>
          <div class="field-grid-3">
            <div>
              <label class="field-label" for="cust-drag-model">Drag model</label>
              <select id="cust-drag-model" class="lg-select">
                <option value="G7" ${d.model !== 'G1' ? 'selected' : ''}>G7 (boat-tail)</option>
                <option value="G1" ${d.model === 'G1' ? 'selected' : ''}>G1 (flat-base)</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="cust-bc-g7">G7 BC</label>
              <input type="text" inputmode="decimal" autocomplete="off" id="cust-bc-g7" class="lg-input lib-num" min="0.05" max="1.5" step="0.001" value="${v('g7', '0.315')}" aria-describedby="bc-hint" />
            </div>
            <div>
              <label class="field-label" for="cust-bc-g1">G1 BC (optional)</label>
              <input type="text" inputmode="decimal" autocomplete="off" id="cust-bc-g1" class="lg-input lib-num" min="0.05" max="2" step="0.001" value="${v('g1')}" aria-describedby="bc-hint" />
            </div>
          </div>
          <p class="field-hint" id="bc-hint"><abbr title="Ballistic coefficient">BC</abbr>: enter the one for your drag model. A missing one is estimated from the other.</p>
          <div class="field-grid-2">
            <div>
              <label class="field-label" for="cust-mv">Factory velocity (${f.velUnit}, optional)</label>
              <input type="text" inputmode="decimal" autocomplete="off" id="cust-mv" class="lg-input lib-num" min="${f.vel.min}" max="${f.vel.max}" step="${f.vel.step}" value="${v('mv')}" />
            </div>
          </div>
          <div class="add-actions">
            <button type="submit" class="lg-btn lg-btn-primary">${icon('save')} Save bullet</button>
          </div>
        </form>

        <section class="lg-card lg-kpi stability-card" aria-labelledby="stability-title">
          <h2 class="lg-label" id="stability-title">Stability in this rifle</h2>
          <p class="lg-small lg-muted stability-context">${esc(profile.name)}: twist 1 in ${esc(profile.twistRateIn)} in, ${this._velocity(profile.muzzleVelocityMs)}, standard air (Miller formula).</p>
          <div id="stability-live-hud" class="stability-hud" aria-live="polite"></div>
          <ul class="sg-legend" aria-label="What the numbers mean">
            <li><span class="lg-chip lg-ok"><abbr title="Gyroscopic stability factor">Sg</abbr> 1.5 or more</span> Stable</li>
            <li><span class="lg-chip lg-warn">1.0 to 1.5</span> Marginal: the BC may drop</li>
            <li><span class="lg-chip lg-bad">Below 1.0</span> Unstable: the bullet may tumble</li>
          </ul>
        </section>
      </div>
    `;
  }

  _saveDraft() {
    if (this.activeTab !== 'add') return;
    const q = (id) => this.container.querySelector(`#${id}`)?.value;
    if (!this.container.querySelector('#add-bullet-form')) return;
    this.draft = {
      name: q('cust-name'), mfg: q('cust-mfg'), caliber: q('cust-caliber'), weight: q('cust-weight'), dia: q('cust-dia'),
      len: q('cust-len'), model: q('cust-drag-model'), g7: q('cust-bc-g7'), g1: q('cust-bc-g1'), mv: q('cust-mv'),
    };
  }

  /** Reads one number field; returns NaN (and marks the field) when invalid. Empty optional fields give null. */
  _readNumber(id, { optional = false, mark = true } = {}) {
    const el = this.container.querySelector(`#${id}`);
    if (!el) return NaN;
    if (optional && String(el.value).trim() === '') {
      if (mark) setFieldError(el, '');
      return null;
    }
    const value = parseNumber(el.value);
    const error = rangeError(el, value);
    if (mark) setFieldError(el, error);
    return error ? NaN : value;
  }

  _inches(value, unit) {
    return unit === 'mm' ? value / 25.4 : value;
  }

  _updateStability() {
    const hud = this.container.querySelector('#stability-live-hud');
    if (!hud) return;
    const f = this._addFields();
    const wt = this._readNumber('cust-weight', { mark: false });
    const dia = this._readNumber('cust-dia', { mark: false });
    const len = this._readNumber('cust-len', { mark: false });
    if (![wt, dia, len].every(Number.isFinite)) {
      hud.textContent = 'Enter weight, diameter and length to see the stability.';
      return;
    }
    const profile = appState.getActiveProfile();
    const diaIn = this._inches(dia, f.diaUnit);
    const lenIn = this._inches(len, f.lenUnit);
    const res = calculateStability(wt, diaIn, lenIn, profile.twistRateIn, profile.muzzleVelocityMs / 0.3048);
    const sg = Number(res.sg) || 0;
    const level = sg >= 1.5 ? ['ok', 'Stable'] : sg >= 1.0 ? ['warn', 'Marginal'] : ['bad', 'Unstable'];
    const tooLong = lenIn / diaIn > 6.5;
    // eslint-disable-next-line no-unsanitized/property -- reviewed: user/stored strings go through esc(); the rest are numbers and constants
    hud.innerHTML = `
      <div class="sg-score">
        <span class="lg-kpi-value"><abbr title="Gyroscopic stability factor">Sg</abbr> ${sg.toFixed(2)}</span>
        <span class="lg-badge lg-badge-${level[0]}">${level[1]}</span>
      </div>
      <dl class="lg-kv sg-stats">
        <dt>Slowest twist for Sg 1.5</dt><dd>1 in ${Number(res.optimalTwistIn).toFixed(1)} in</dd>
        <dt>Length</dt><dd>${Number(res.lengthInCalibers).toFixed(2)} calibers</dd>
        <dt>Sectional density</dt><dd>${Number(res.sectionalDensity).toFixed(3)} lb/in²</dd>
      </dl>
      ${tooLong ? '<p class="lg-alert lg-alert-warn sg-note">Check the length: over 6.5 calibers is unusually long.</p>' : ''}
    `;
  }

  _bindAdd() {
    ['cust-weight', 'cust-dia', 'cust-len'].forEach((id) => {
      const el = this.container.querySelector(`#${id}`);
      bindNumber(el, () => this._updateStability());
      el?.addEventListener('input', () => this._updateStability());
    });
    ['cust-bc-g7', 'cust-bc-g1', 'cust-mv'].forEach((id) => {
      const el = this.container.querySelector(`#${id}`);
      el?.addEventListener('change', () => {
        const optional = id === 'cust-mv' || (id === 'cust-bc-g7' ? this._model() === 'G1' : this._model() === 'G7');
        this._readNumber(id, { optional });
      });
    });
    this.container.querySelector('#cust-drag-model')?.addEventListener('change', () => this._syncBcLabels());
    this._syncBcLabels();
    this._updateStability();

    this.container.querySelector('#add-bullet-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveCustomBullet();
    });
  }

  _model() {
    return this.container.querySelector('#cust-drag-model')?.value === 'G1' ? 'G1' : 'G7';
  }

  /** The BC for the chosen drag model is required, the other one optional. */
  _syncBcLabels() {
    const g1 = this._model() === 'G1';
    const l7 = this.container.querySelector('label[for="cust-bc-g7"]');
    const l1 = this.container.querySelector('label[for="cust-bc-g1"]');
    if (l7) l7.textContent = g1 ? 'G7 BC (optional)' : 'G7 BC';
    if (l1) l1.textContent = g1 ? 'G1 BC' : 'G1 BC (optional)';
  }

  _saveCustomBullet() {
    const f = this._addFields();
    const nameEl = this.container.querySelector('#cust-name');
    const name = nameEl.value.trim();
    setFieldError(nameEl, name ? '' : 'Enter a name');
    const model = this._model();
    const weight = this._readNumber('cust-weight');
    const dia = this._readNumber('cust-dia');
    const len = this._readNumber('cust-len');
    let g7 = this._readNumber('cust-bc-g7', { optional: model === 'G1' });
    let g1 = this._readNumber('cust-bc-g1', { optional: model === 'G7' });
    const mv = this._readNumber('cust-mv', { optional: true });

    const invalid = this.container.querySelector('#add-bullet-form [aria-invalid="true"]');
    if (!name || [weight, dia, len, g7, g1, mv].some((x) => Number.isNaN(x)) || invalid) {
      (invalid || nameEl).focus();
      toast("Couldn't save the bullet", 'bad', 'Fix the marked fields.');
      return;
    }

    const estimated = { g7: g7 === null, g1: g1 === null };
    if (g7 === null) g7 = g1 / G1_PER_G7;
    if (g1 === null) g1 = g7 * G1_PER_G7;
    const diaIn = this._inches(dia, f.diaUnit);
    const mvMs = mv === null ? null : UnitConverter.toSI(mv, f.velUnit);
    const bullet = {
      id: `custom-${Date.now().toString(36)}`,
      isCustom: true,
      name: name.slice(0, 120),
      manufacturer: this.container.querySelector('#cust-mfg').value.trim().slice(0, 80) || 'Custom',
      caliber: this.container.querySelector('#cust-caliber').value.trim().slice(0, 80) || `${fmtDia(diaKey(diaIn))} custom`,
      type: 'Custom',
      weightGr: weight,
      diameterIn: Number(diaIn.toFixed(3)),
      lengthIn: Number(this._inches(len, f.lenUnit).toFixed(3)),
      bcG7: Number(g7.toFixed(3)),
      bcG1: Number(g1.toFixed(3)),
      dragModel: model,
      recommendedTwist: '',
      ...(estimated.g7 ? { bcG7Estimated: true } : {}),
      ...(mvMs ? { factoryVelocityMs: Math.round(mvMs), factoryVelocityFps: Math.round(mvMs / 0.3048) } : {}),
    };

    this.draft = null;
    this.activeTab = 'bullets';
    this.searchQuery = bullet.name;
    this.caliberFilter = diaKey(bullet.diameterIn);
    toast('Bullet saved', 'ok', `${bullet.name} is in the bullet list. Press "Use" to put it in your rifle.`);
    appState.addCustomBullet(bullet); // re-renders through the subscription
  }

  // ---- tabs, events, backup -------------------------------------------------------------------

  setTab(tab) {
    if (!TABS.some((t) => t.id === tab)) return;
    this._saveDraft();
    this.activeTab = tab;
    this.render();
    this.container.querySelector(`#lib-tab-${tab}`)?.focus();
  }

  _bindTabs() {
    const tabs = [...this.container.querySelectorAll('.library-tabs [role="tab"]')];
    tabs.forEach((tab, i) => {
      tab.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') next = tabs[(i + tabs.length - 1) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (!next) return;
        e.preventDefault();
        this.setTab(next.dataset.tab);
      });
    });
  }

  _handleClick(e) {
    const tab = e.target.closest?.('.library-tabs [role="tab"]');
    if (tab && this.container.contains(tab)) {
      if (tab.dataset.tab !== this.activeTab) this.setTab(tab.dataset.tab);
      return;
    }
    const btn = e.target.closest?.('[data-action]');
    if (!btn || !this.container.contains(btn) || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    const id = btn.dataset.id;
    switch (btn.dataset.action) {
      case 'new-rifle':
        new RifleBuilderModal((p) => {
          toast('Rifle saved', 'ok', `${p.name} is now selected in the Solver.`);
          this._refocus('[data-action="new-rifle"]');
        }).open();
        break;
      case 'edit-rifle': {
        const p = this._findProfile(id);
        if (p) {
          new RifleBuilderModal((saved) => {
            toast('Rifle saved', 'ok', saved.name);
            this._refocus(`[data-action="edit-rifle"][data-id="${CSS.escape(saved.id)}"]`);
          }).open(p);
        }
        break;
      }
      case 'use-rifle':
        toast('Rifle selected', 'ok', `${this._findProfile(id)?.name || ''} is now used in the Solver.`);
        appState.setActiveProfile(id); // re-renders through the subscription
        this._refocus(`[data-rifle="${CSS.escape(id)}"] .rifle-main-action`);
        break;
      case 'duplicate-rifle':
        this._duplicateRifle(id);
        break;
      case 'delete-rifle':
        this._deleteRifle(id);
        break;
      case 'use-bullet':
        this._useBullet(id);
        break;
      case 'delete-bullet':
        this._deleteBullet(id);
        break;
      case 'undo': {
        const run = this.undo?.run;
        this._clearUndo();
        run?.();
        toast('Undone', 'info');
        break;
      }
      case 'clear-search': {
        this.searchQuery = '';
        const search = this.container.querySelector('#proj-search');
        if (search) search.value = '';
        this._updateBulletTable();
        search?.focus();
        break;
      }
      case 'all-diameters': {
        this.caliberFilter = 'all';
        const sel = this.container.querySelector('#caliber-filter');
        if (sel) sel.value = 'all';
        this._updateBulletTable();
        sel?.focus();
        break;
      }
      case 'go-add':
        this.setTab('add');
        break;
      case 'export':
        this._export();
        break;
      case 'import':
        this.container.querySelector('#import-json-file')?.click();
        break;
      default:
        break;
    }
  }

  _export() {
    const blob = new Blob([appState.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ballistic-workbench-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const n = appState.state.profiles.length;
    toast('Backup saved', 'ok', `${n} ${n === 1 ? 'rifle' : 'rifles'}, your bullets and settings.`);
  }

  _bindImport() {
    const input = this.container.querySelector('#import-json-file');
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) {
        toast("Couldn't import", 'bad', `The file is larger than ${Math.round(MAX_IMPORT_BYTES / 1048576)} MB, so it isn't a Ballistic Workbench backup.`);
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => toast("Couldn't import", 'bad', 'The file could not be read.');
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        let ids = [];
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed?.projectilesLibrary)) ids = parsed.projectilesLibrary.map((b) => b?.id).filter((x) => typeof x === 'string' && !FACTORY_IDS.has(x));
        } catch {
          // importJSON reports it
        }
        const before = JSON.parse(appState.exportJSON()); // for undo
        if (!appState.importJSON(text)) {
          toast("Couldn't import", 'bad', "The file isn't a Ballistic Workbench backup.");
          return;
        }
        this._showUndo('Backup imported. Your previous rifles and settings were replaced.', () => {
          const state = appState.state;
          for (const k of Object.keys(state)) if (!(k in before)) delete state[k];
          Object.assign(state, before);
          appState.notify('import');
        });
        const rifles = appState.state.profiles.length;
        const idSet = new Set(ids);
        const bullets = appState.state.projectilesLibrary.filter((b) => idSet.has(b.id)).length;
        toast('Backup imported', 'ok', `Imported ${rifles} ${rifles === 1 ? 'rifle' : 'rifles'} and ${bullets} ${bullets === 1 ? 'bullet' : 'bullets'}.`);
      };
      reader.readAsText(file);
    });
  }
}
