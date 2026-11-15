/**
 * Ballistic Workbench - HTML escaping for template strings.
 * Views render with template strings + innerHTML, so every string that can come from the user,
 * localStorage or an imported file goes through esc() before it is interpolated.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for use in HTML element content and quoted attribute values. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** A finite number or the fallback (for values from storage or imports that may be strings or junk). */
export function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}
