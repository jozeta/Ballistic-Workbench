/**
 * Ballistic Workbench - icon helper.
 * All icons live in one sprite (assets/icons.svg): Låda Glass base icons plus app-specific ballistics
 * icons. Names are constants from this file's callers, never user data.
 */

const SPRITE = './assets/icons.svg';

/** Markup for a decorative icon (hidden from screen readers; the button or label carries the text). */
export function icon(name, extraClass = '') {
  return `<svg class="lg-icon${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true" focusable="false"><use href="${SPRITE}#${name}"></use></svg>`;
}

/** The same icon as a DOM element, for code that builds nodes instead of template strings. */
export function iconEl(name, extraClass = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', `lg-icon${extraClass ? ` ${extraClass}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `${SPRITE}#${name}`);
  svg.append(use);
  return svg;
}
