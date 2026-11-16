/**
 * Ballistic Workbench - "i" help buttons and info boxes for every input.
 *
 * initHelp(root) watches the view container: every label (or control) whose input id has an entry in
 * HELP (src/ui/helpContent.js) gets a small "i" button. Its info box (a Låda Glass .lg-popover placed
 * with LadaGlass.place) opens on hover, on keyboard focus and on tap/click, and has a "Read more in
 * the guide" link. Nothing is hover-only: tap or focus works the same. All text goes in as textContent.
 */

import { HELP } from './helpContent.js';
import { iconEl } from './icons.js';

const SHOW_DELAY = 250;
const HIDE_DELAY = 200;
let pop = null;
let current = null; // the button whose box is showing
let pinned = false; // opened by click/tap: stays until closed
let showTimer = 0;
let hideTimer = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function ensurePopover() {
  if (pop) return pop;
  pop = el('div', 'lg-popover help-pop');
  pop.id = 'help-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  pop.tabIndex = -1;
  pop.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  pop.addEventListener('pointerleave', () => {
    if (!pinned) scheduleHide();
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      const btn = current;
      hide();
      btn?.focus();
    }
  });
  document.body.append(pop);
  return pop;
}

function fill(entry) {
  const p = ensurePopover();
  p.replaceChildren();
  const title = el('p', 'help-title', entry.title);
  title.id = 'help-pop-title';
  p.setAttribute('aria-labelledby', title.id);
  p.append(title, el('p', 'help-text', entry.text));
  if (entry.how?.length) {
    p.append(el('p', 'lg-label help-label', 'How to'));
    const ol = el('ol', 'help-steps');
    for (const step of entry.how) ol.append(el('li', '', step));
    p.append(ol);
  }
  if (entry.typical) p.append(el('p', 'help-typical', entry.typical));
  if (entry.tip) {
    const tip = el('p', 'help-tip');
    tip.append(iconEl('bulb'), el('span', '', entry.tip));
    p.append(tip);
  }
  if (entry.guide) {
    const link = el('button', 'lg-btn lg-btn-ghost help-guide');
    link.type = 'button';
    link.append(iconEl('guide'), el('span', '', 'Read more in the guide'));
    link.addEventListener('click', () => {
      const anchor = entry.guide;
      hide();
      window.dispatchEvent(new CustomEvent('navigate-view', { detail: { view: 'guide', anchor } }));
    });
    p.append(link);
  }
}

function place(btn) {
  const p = ensurePopover();
  const a = btn.getBoundingClientRect();
  const size = { width: p.offsetWidth, height: p.offsetHeight };
  const vp = { width: document.documentElement.clientWidth, height: window.innerHeight };
  const pos = typeof LadaGlass !== 'undefined' && LadaGlass.place
    ? LadaGlass.place(a, size, vp, 'bottom', 6)
    : { top: a.bottom + 6, left: Math.max(8, Math.min(a.left, vp.width - size.width - 8)) };
  p.style.setProperty('top', `${Math.round(pos.top)}px`);
  p.style.setProperty('left', `${Math.round(pos.left)}px`);
}

function show(btn, pin = false) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const entry = HELP[btn.dataset.help];
  if (!entry) return;
  if (current && current !== btn) current.setAttribute('aria-expanded', 'false');
  current = btn;
  pinned = pin || pinned;
  fill(entry);
  const p = ensurePopover();
  p.setAttribute('data-lg-open', '');
  btn.setAttribute('aria-expanded', 'true');
  place(btn);
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  pinned = false;
  if (current) current.setAttribute('aria-expanded', 'false');
  current = null;
  pop?.removeAttribute('data-lg-open');
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, HIDE_DELAY);
}

/** The visible label text for an input, for the button's accessible name. */
function labelText(text, key) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t || HELP[key]?.title || 'this setting';
}

function makeButton(key, name) {
  const btn = el('button', 'help-btn');
  btn.type = 'button';
  btn.dataset.help = key;
  btn.setAttribute('aria-label', `About ${labelText(name, key)}`);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'help-pop');
  btn.append(iconEl('info'));
  return btn;
}

/** Puts a button after a field's label, keeping label and button on one line. */
function besideLabel(label, btn) {
  if (label.parentElement?.classList.contains('help-row')) {
    label.parentElement.append(btn);
    return;
  }
  const row = el('span', 'help-row');
  label.before(row);
  row.append(label, btn);
}

/** Once per anchor element: marks it so re-scans don't add a second button. */
function once(anchor, key) {
  const done = (anchor.dataset.helpFor || '').split(' ');
  if (done.includes(key)) return false;
  anchor.dataset.helpFor = [...done.filter(Boolean), key].join(' ');
  return true;
}

/** Help for a single control found by id. */
function attachToControl(root, key, control) {
  // Special places where the control has no label of its own
  if (key === 'turret-mode') {
    const label = root.querySelector('.turret-header .lg-label');
    if (label && once(label, key)) label.append(makeButton(key, label.textContent));
    return;
  }
  if (key === 'col-picker-details') {
    if (once(control, key)) control.after(makeButton(key, 'Columns'));
    return;
  }
  const label = control.labels?.[0] || root.querySelector(`label[for="${CSS.escape(control.id)}"]`);
  // A label only screen readers see (toolbar selects): put the button right after the control
  if (label && label.classList.contains('lg-sr-only')) {
    if (once(control, key)) control.after(makeButton(key, label.textContent));
    return;
  }
  if (label && !label.contains(control)) {
    if (once(label, key)) besideLabel(label, makeButton(key, label.textContent));
    return;
  }
  if (label) {
    if (once(label, key)) label.append(makeButton(key, label.textContent));
    return;
  }
  // A heading or group label just before it (settings switches, tab lists)
  const prev = control.previousElementSibling;
  if (prev && /^(P|H[2-6]|LEGEND|SPAN)$/.test(prev.tagName) && prev.textContent.trim()) {
    if (once(prev, key)) prev.append(makeButton(key, prev.textContent));
    return;
  }
  if (once(control, key)) control.before(makeButton(key, control.getAttribute('aria-label')));
}

/** Help for a radio group, keyed by its name: next to the group's label or legend. */
function attachToGroup(root, key, first) {
  const label = document.getElementById(`${key}-label`)
    || first.closest('fieldset')?.querySelector('legend')
    || first.closest('[role="radiogroup"], .lg-segmented')?.previousElementSibling;
  if (label && once(label, key)) {
    if (label.tagName === 'LABEL' && label.htmlFor) besideLabel(label, makeButton(key, label.textContent));
    else label.append(makeButton(key, label.textContent));
  }
}

/** Help for a column of inputs in a table (one button in the column header). */
function attachToColumn(key, first) {
  const cell = first.closest('td, th');
  const table = first.closest('table');
  const head = table?.tHead?.rows[table.tHead.rows.length - 1];
  const th = cell && head ? head.cells[cell.cellIndex] : null;
  if (th && once(th, key)) th.append(makeButton(key, th.textContent));
}

// Repeated rows: help keys that stand for every input of a kind
const REPEATED = [
  // Stage targets repeat the same fields: help on the first target only (less noise)
  { prefix: 'stage-field-', selector: (f) => `[id^="tgt-"][id$="-${f}"]` },
  { prefix: 'shot-field-x', selector: () => '[id^="shot-x-"]', column: true },
  { prefix: 'shot-field-y', selector: () => '[id^="shot-y-"]', column: true },
  { prefix: 'range-row-select', selector: () => '.chk-range-select', column: true },
  // Match targets: one button per column header
  { prefix: 'match-col-', selector: (f) => `.match-cell[data-key="${f}"]`, column: true },
];

/** Adds "i" buttons to every control under root that has help and doesn't have a button yet. */
export function attachHelp(root) {
  for (const key of Object.keys(HELP)) {
    const rep = REPEATED.find((r) => key.startsWith(r.prefix));
    if (rep) {
      const list = root.querySelectorAll(rep.selector(key.slice(rep.prefix.length)));
      if (!list.length) continue;
      if (rep.column) attachToColumn(key, list[0]);
      else attachToControl(root, key, list[0]);
      continue;
    }
    const control = document.getElementById(key);
    if (control && root.contains(control)) {
      attachToControl(root, key, control);
      continue;
    }
    const first = root.querySelector(`input[name="${CSS.escape(key)}"]`);
    if (first) attachToGroup(root, key, first);
  }
}

/** Starts the help system for the app: watches the view container for new controls. */
export function initHelp(root) {
  if (!root) return;
  attachHelp(root);
  new MutationObserver(() => attachHelp(root)).observe(root, { childList: true, subtree: true });

  // Hover (mouse/pen) with a short delay; never touch (a tap is a click)
  root.addEventListener('pointerover', (e) => {
    const btn = e.target.closest?.('.help-btn');
    if (!btn || e.pointerType === 'touch' || pinned) return;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => show(btn), SHOW_DELAY);
  });
  root.addEventListener('pointerout', (e) => {
    const btn = e.target.closest?.('.help-btn');
    if (!btn || pinned) return;
    clearTimeout(showTimer);
    scheduleHide();
  });
  // Keyboard focus shows it; leaving hides it (unless the focus moved into the box)
  root.addEventListener('focusin', (e) => {
    const btn = e.target.closest?.('.help-btn');
    if (btn && btn.matches(':focus-visible')) show(btn);
  });
  root.addEventListener('focusout', (e) => {
    const btn = e.target.closest?.('.help-btn');
    if (btn && !pinned && !pop?.contains(e.relatedTarget)) scheduleHide();
  });
  // Click / tap toggles a pinned box
  root.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.help-btn');
    if (!btn) return;
    e.preventDefault();
    if (current === btn && pinned) hide();
    else {
      show(btn, true);
      // Opened from the keyboard (Enter/Space): move focus into the box so its link is the next Tab
      if (e.detail === 0) pop?.focus();
    }
  });
  // Close on outside click, Esc, scroll or view change
  document.addEventListener('pointerdown', (e) => {
    if (!current) return;
    if (pop?.contains(e.target) || e.target.closest?.('.help-btn')) return;
    hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) {
      const btn = current;
      hide();
      btn.focus();
    }
  });
  // A pinned box follows its button while scrolling; it closes when the button scrolls out of view
  // or disappears (the view re-rendered)
  const follow = () => {
    if (!current) return;
    if (!current.isConnected) return hide();
    if (!pinned) return hide();
    const r = current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return hide();
    place(current);
  };
  window.addEventListener('scroll', follow, { passive: true, capture: true });
  new MutationObserver(() => current && !current.isConnected && hide()).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => current && place(current));
  window.addEventListener('hashchange', hide);
}
