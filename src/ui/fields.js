/**
 * Ballistic Workbench - validated number fields.
 *
 * bindNumber(input, onValid) checks the input against its own min/max on every change. Valid values
 * are passed to onValid; invalid ones keep the last good value in the app, mark the field
 * (aria-invalid + a red border) and show an inline message under it, e.g. "Enter 200–1500".
 * Messages are linked with aria-describedby so screen readers read them.
 */

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

/** Parses a number typed with a dot or a comma decimal separator. */
export function parseNumber(raw) {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return Number(s);
}

function messageEl(input) {
  const id = `${input.id || 'field'}-error`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('p');
    el.id = id;
    el.className = 'field-error';
    el.setAttribute('role', 'alert');
    input.insertAdjacentElement('afterend', el);
  }
  return el;
}

export function setFieldError(input, message) {
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    const el = messageEl(input);
    el.textContent = message;
    el.hidden = false;
    const ids = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    ids.add(el.id);
    input.setAttribute('aria-describedby', [...ids].join(' '));
  } else {
    input.removeAttribute('aria-invalid');
    const el = document.getElementById(`${input.id || 'field'}-error`);
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
  }
}

/** Validates value against the input's min/max attributes; returns an error message or ''. */
export function rangeError(input, value) {
  const min = input.min !== '' ? Number(input.min) : -Infinity;
  const max = input.max !== '' ? Number(input.max) : Infinity;
  if (!Number.isFinite(value)) return 'Enter a number';
  if (value < min || value > max) {
    if (Number.isFinite(min) && Number.isFinite(max)) return `Enter ${fmt(min)}–${fmt(max)}`;
    return Number.isFinite(min) ? `Enter at least ${fmt(min)}` : `Enter at most ${fmt(max)}`;
  }
  return '';
}

/**
 * Binds validation to a number input. onValid(value) runs only for valid values.
 * event: 'change' (default, after editing) or 'input' (live).
 */
export function bindNumber(input, onValid, event = 'change') {
  if (!input) return;
  input.addEventListener(event, () => {
    const value = parseNumber(input.value);
    const error = rangeError(input, value);
    setFieldError(input, error);
    if (!error) onValid(value);
  });
}
