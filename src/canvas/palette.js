/**
 * Ballistic Workbench - canvas palette
 * Reads the Låda Glass colour and font tokens from CSS at draw time, so every canvas follows the
 * active theme (dark or light) without hard-coded colours. Call getPalette() at the start of each
 * render; it is cheap (one getComputedStyle per call).
 */

// Fallbacks only matter outside a browser (tests) or if the stylesheet failed to load.
const FALLBACK = {
  text: '#ECEEEF',
  muted: '#8E96A2',
  accent: '#5A93C4',
  accent2: '#88C0D0',
  ok: '#47B577',
  warn: '#E09B3D',
  bad: '#E05A5A',
  okText: '#50B97E',
  warnText: '#E09B3D',
  badText: '#E78282',
  line: 'rgba(255, 255, 255, 0.08)',
  line2: 'rgba(255, 255, 255, 0.15)',
  elevated: '#252930',
  surface: '#1E2127',
  field: 'rgba(255, 255, 255, 0.04)',
  bg: '#141619',
  onAccent: '#0F1217',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const TOKENS = {
  text: '--lg-text',
  muted: '--lg-muted',
  accent: '--lg-accent',
  accent2: '--lg-accent-2',
  ok: '--lg-ok',
  warn: '--lg-warn',
  bad: '--lg-bad',
  okText: '--lg-ok-text',
  warnText: '--lg-warn-text',
  badText: '--lg-bad-text',
  line: '--lg-line',
  line2: '--lg-line-2',
  elevated: '--lg-elevated',
  surface: '--lg-surface',
  field: '--lg-field',
  bg: '--lg-bg',
  onAccent: '--lg-on-accent',
  font: '--lg-font',
  mono: '--lg-mono',
};

/** Parses '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(...)' or 'rgba(...)' into [r, g, b, a]. */
function parseColor(str) {
  const s = String(str || '').trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
    }
  }
  return null;
}

/**
 * Returns `color` with its opacity multiplied by `alpha` (0..1), as an rgba() string.
 * Unknown formats are returned unchanged.
 */
export function withAlpha(color, alpha) {
  const c = parseColor(color);
  if (!c) return color;
  const a = Math.max(0, Math.min(1, c[3] * alpha));
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a.toFixed(3)})`;
}

/** Mixes two colours (0 = a, 1 = b). Falls back to `a` if either cannot be parsed. */
export function mix(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const k = (i) => ca[i] + (cb[i] - ca[i]) * t;
  return `rgba(${Math.round(k(0))}, ${Math.round(k(1))}, ${Math.round(k(2))}, ${k(3).toFixed(3)})`;
}

/** Resolved theme: 'light' or 'dark' (app.js always sets <html data-theme>). */
export function currentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Reads the current Låda Glass tokens. Returns resolved colour strings plus:
 * - isLight: whether the light theme is active
 * - font(sizePx, weight): a canvas font string in the system font
 * - monoFont(sizePx, weight): the same in the monospace font
 * - alpha(color, a): shorthand for withAlpha
 */
export function getPalette() {
  const p = { ...FALLBACK };
  if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(document.documentElement);
    for (const [key, token] of Object.entries(TOKENS)) {
      const v = cs.getPropertyValue(token).trim();
      if (v) p[key] = v;
    }
  }
  p.fontFamily = p.font;
  p.monoFamily = p.mono;
  p.isLight = currentTheme() === 'light';
  p.alpha = withAlpha;
  p.mix = mix;
  p.font = (size, weight = 400) => `${weight} ${size}px ${p.fontFamily}`;
  p.monoFont = (size, weight = 400) => `${weight} ${size}px ${p.monoFamily}`;
  // Older callers interpolate pal.font / pal.mono as a family name (`12px ${pal.font}`); keep that working.
  p.font.toString = () => p.fontFamily;
  p.monoFont.toString = () => p.monoFamily;
  // Låda graphic language for custom canvases (matches .lg-chart-* in lada-glass.css)
  p.gridline = p.line; // .lg-chart-gridline
  p.track = p.line2; // .lg-chart-track (meter track)
  p.stroke = STROKE;
  return p;
}

/** Stroke widths for custom graphics: Låda charts use 1.5 to 2 px marks and 1 px hairline grids. */
export const STROKE = Object.freeze({ hair: 1, mark: 1.6, bold: 2 });

/**
 * Draws a `.lg-label`-style caption (11 px, 600, uppercase, .08em tracking) at (x, y).
 * align: 'left' | 'right' | 'center'. Returns the drawn width in px.
 */
export function drawLabel(ctx, pal, text, x, y, { align = 'left', color = pal.muted, baseline = 'alphabetic' } = {}) {
  const t = String(text).toUpperCase();
  ctx.save();
  ctx.font = pal.font(11, 600);
  ctx.fillStyle = color;
  ctx.textBaseline = baseline;
  ctx.textAlign = align;
  const tracking = 0.88; // .08em of 11 px
  let width;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${tracking}px`;
    width = ctx.measureText(t).width;
    // letterSpacing adds trailing space after the last glyph; shift right-aligned text to compensate
    ctx.fillText(t, align === 'right' ? x + tracking : x, y);
  } else {
    width = ctx.measureText(t).width;
    ctx.fillText(t, x, y);
  }
  ctx.restore();
  return width;
}
