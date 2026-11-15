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
function labelText(control, label) {
  const t = (label?.textContent || control.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  return t || HELP[control.id]?.title || 'this setting';
}

/** Adds "i" buttons to every control under root that has help and doesn't have a button yet. */
export function attachHelp(root) {
  for (const id of Object.keys(HELP)) {
    const control = root.querySelector(`#${CSS.escape(id)}`);
    if (!control || control.dataset.helpAttached) continue;
    control.dataset.helpAttached = '1';
    const label = control.labels?.[0] || root.querySelector(`label[for="${CSS.escape(id)}"]`);
    const btn = el('button', 'help-btn');
    btn.type = 'button';
    btn.dataset.help = id;
    btn.setAttribute('aria-label', `About ${labelText(control, label)}`);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'help-pop');
    btn.append(iconEl('info'));
    if (label && !label.contains(control)) {
      // Next to the label text (the button sits outside the label, so clicking it doesn't focus the field)
      label.classList.add('has-help');
      label.after(btn);
      label.parentElement?.classList.add('help-row-host');
      const row = el('span', 'help-row');
      label.before(row);
      row.append(label, btn);
    } else if (label) {
      label.classList.add('has-help');
      label.after(btn);
    } else {
      control.before(btn);
    }
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
    else show(btn, true);
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
  window.addEventListener('scroll', () => current && !pinned && hide(), { passive: true });
  window.addEventListener('resize', () => current && place(current));
  window.addEventListener('hashchange', hide);
}
