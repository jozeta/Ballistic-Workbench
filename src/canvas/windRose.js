/**
 * Ballistic Workbench - wind clock (canvas)
 * A 12-hour clock seen from above with the target at 12 o'clock. The arrow shows where the wind
 * comes FROM (90° = 3 o'clock = from the right). Operate it by dragging, or with the keyboard
 * (it is an ARIA slider): arrow keys turn 5°, Page up/down turn one hour (30°), Home = 12 o'clock.
 *
 * Public API (used by src/ui/workspace.js):
 *   new WindRoseVisualizer(canvas, { windSpeedMs, windDirectionDeg, windSpeedUnit, onChange })
 *   .update(opts) .destroy()
 *   onChange({ windDirectionDeg, windSpeedMs })
 */

import { CONVERSIONS } from '../core/units.js';
import { getPalette } from './palette.js';

/** Clock position (1..12) for a direction in degrees (0 = 12 o'clock, clockwise). */
export function clockHour(deg) {
  const h = Math.round((((deg % 360) + 360) % 360) / 30) % 12;
  return h === 0 ? 12 : h;
}

function normDeg(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

export class WindRoseVisualizer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        windSpeedMs: 4.0,
        windDirectionDeg: 90.0,
        windSpeedUnit: 'm/s',
        onChange: null,
      },
      options
    );

    this.isDragging = false;
    this._handlers = {};

    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'slider');
    this.canvas.setAttribute('aria-label', 'Wind direction');
    this.canvas.setAttribute('aria-valuemin', '0');
    this.canvas.setAttribute('aria-valuemax', '359');
    this.canvas.setAttribute(
      'aria-description',
      'Drag around the clock, or use the arrow keys (5 degrees) and Page up or Page down (one hour).'
    );

    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const size = Math.max(140, Math.floor(Math.min(rect.width || 200, rect.height || rect.width || 200)));
    const px = Math.floor(size * dpr);
    if (this.canvas.width !== px) this.canvas.width = px;
    if (this.canvas.height !== px) this.canvas.height = px;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
    this.render();
  }

  _setDirection(deg) {
    const d = normDeg(deg);
    if (d === normDeg(this.options.windDirectionDeg || 0)) return;
    this.options.windDirectionDeg = d;
    this.render();
    if (this.options.onChange) {
      this.options.onChange({ windDirectionDeg: d, windSpeedMs: this.options.windSpeedMs });
    }
  }

  _bindEvents() {
    const h = this._handlers;

    const fromPointer = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      if (Math.hypot(x, y) < 10) return; // too close to the centre to read a direction
      // 0° at 12 o'clock (up), 90° at 3 o'clock (right)
      let a = Math.atan2(x, -y);
      if (a < 0) a += Math.PI * 2;
      this._setDirection((a * 180) / Math.PI);
    };

    h.pointerdown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.isDragging = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best effort
      }
      this.canvas.focus({ preventScroll: true });
      fromPointer(e);
      e.preventDefault();
    };
    h.pointermove = (e) => {
      if (this.isDragging) fromPointer(e);
    };
    h.pointerup = (e) => {
      this.isDragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Already released
      }
    };
    h.keydown = (e) => {
      const d = this.options.windDirectionDeg || 0;
      let next = null;
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          next = d + 5;
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          next = d - 5;
          break;
        case 'PageUp':
          next = d + 30;
          break;
        case 'PageDown':
          next = d - 30;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = 359;
          break;
        default:
          return;
      }
      e.preventDefault();
      this._setDirection(next);
    };
    h.focus = () => this.render();

    this.canvas.addEventListener('pointerdown', h.pointerdown);
    this.canvas.addEventListener('pointermove', h.pointermove);
    this.canvas.addEventListener('pointerup', h.pointerup);
    this.canvas.addEventListener('pointercancel', h.pointerup);
    this.canvas.addEventListener('keydown', h.keydown);
    this.canvas.addEventListener('focus', h.focus);
    this.canvas.addEventListener('blur', h.focus);

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }
  }

  destroy() {
    const h = this._handlers;
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', h.pointerdown);
      this.canvas.removeEventListener('pointermove', h.pointermove);
      this.canvas.removeEventListener('pointerup', h.pointerup);
      this.canvas.removeEventListener('pointercancel', h.pointerup);
      this.canvas.removeEventListener('keydown', h.keydown);
      this.canvas.removeEventListener('focus', h.focus);
      this.canvas.removeEventListener('blur', h.focus);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this._handlers = {};
    this.options.onChange = null;
  }

  update(newOptions = {}) {
    Object.assign(this.options, newOptions);
    this.render();
  }

  _speedText() {
    const unit = CONVERSIONS[this.options.windSpeedUnit] ? this.options.windSpeedUnit : 'm/s';
    const v = (Number(this.options.windSpeedMs) || 0) / CONVERSIONS[unit];
    return `${v.toFixed(v < 10 ? 1 : 0)} ${unit === 'knots' ? 'kn' : unit}`;
  }

  /** Share of the wind that pushes the bullet sideways. */
  _valueText(dirRad) {
    const share = Math.abs(Math.sin(dirRad));
    if (share > 0.95) return 'Full value';
    if (share < 0.2) return 'No crosswind';
    return `${Math.round(share * 100)}% value`;
  }

  /**
   * A clean compass rose in the Låda graphic language: hairline rim, 12 hour ticks
   * with 11 px numbers, a dashed line of fire to the target at 12, and the wind as the one accent
   * mark (an arrow from the rim towards the shooter, with a drag handle on the rim).
   */
  render() {
    if (!this.ctx || !this.size) return;
    const ctx = this.ctx;
    const pal = getPalette();
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;
    const r = s / 2 - 10;

    const dirDeg = normDeg(this.options.windDirectionDeg || 0);
    const dirRad = (dirDeg * Math.PI) / 180;
    const hour = clockHour(dirDeg);
    const speed = this._speedText();
    const share = this._valueText(dirRad);

    this.canvas.setAttribute('aria-valuenow', String(dirDeg));
    this.canvas.setAttribute('aria-valuetext', `From ${hour} o'clock (${dirDeg}°), ${speed}, ${share.toLowerCase()}`);

    ctx.clearRect(0, 0, s, s);
    ctx.lineCap = 'round';
    const at = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];

    // 1. Face: a flat glass disc with a hairline rim
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = pal.mix(pal.surface, pal.text, pal.isLight ? 0.03 : 0.045);
    ctx.fill();
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = pal.stroke.mark;
    ctx.stroke();

    // 2. Hour ticks and numbers (the wind's hour in the text colour, the rest muted)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      const quarter = h % 3 === 0;
      ctx.strokeStyle = quarter ? pal.alpha(pal.muted, 0.9) : pal.line2;
      ctx.lineWidth = pal.stroke.mark;
      ctx.beginPath();
      ctx.moveTo(...at(r - (quarter ? 7 : 5), a));
      ctx.lineTo(...at(r - 1, a));
      ctx.stroke();
      const current = h === hour;
      ctx.font = pal.font(11, current || quarter ? 600 : 500);
      ctx.fillStyle = current ? pal.text : pal.muted;
      ctx.fillText(String(h), ...at(r - 17, a));
    }

    // 3. Line of fire to the target at 12 o'clock, and the shooter in the middle
    ctx.save();
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = pal.stroke.mark;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r + 28);
    ctx.lineTo(cx, cy - 8);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = pal.muted;
    ctx.fill();

    // 4. Wind arrow from the rim towards the centre (the accent), handle on the rim
    const ox = at(r - 30, dirRad);
    const tip = at(14, dirRad);
    ctx.save();
    ctx.strokeStyle = pal.accent;
    ctx.fillStyle = pal.accent;
    ctx.lineWidth = pal.stroke.bold;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...ox);
    ctx.lineTo(...tip);
    ctx.stroke();
    const head = Math.atan2(tip[1] - ox[1], tip[0] - ox[0]);
    const hl = 8;
    ctx.beginPath();
    ctx.moveTo(tip[0] - hl * Math.cos(head - Math.PI / 6), tip[1] - hl * Math.sin(head - Math.PI / 6));
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(tip[0] - hl * Math.cos(head + Math.PI / 6), tip[1] - hl * Math.sin(head + Math.PI / 6));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ox[0], ox[1], 6, 0, Math.PI * 2);
    ctx.fillStyle = pal.surface;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 5. Readout in the half of the face away from the arrow
    const textY = Math.cos(dirRad) > 0 ? cy + r * 0.3 : cy - r * 0.36;
    ctx.font = pal.font(15, 600);
    ctx.fillStyle = pal.text;
    ctx.fillText(speed, cx, textY);
    ctx.font = pal.font(11, 500);
    ctx.fillStyle = pal.muted;
    ctx.fillText(`${dirDeg}° · ${share}`, cx, textY + 16);

    // 6. Focus ring for keyboard focus
    let focused = false;
    try {
      focused = typeof document !== 'undefined' && document.activeElement === this.canvas && this.canvas.matches(':focus-visible');
    } catch {
      focused = typeof document !== 'undefined' && document.activeElement === this.canvas;
    }
    if (focused) {
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = pal.stroke.bold;
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
