/**
 * Ballistic Workbench - elevation turret (canvas)
 * The elevation turret drawn as a Låda meter dial in the optic's own unit. One revolution is 10 MRAD
 * for MRAD optics and 25 MOA for MOA optics, so the number of clicks per turn follows the click size.
 * Operate it by dragging up/down, the mouse wheel, or the keyboard (it is an ARIA slider):
 *   Arrow up/right: one click up      Arrow down/left: one click down
 *   Page up/down: one major mark (1 MRAD or 2.5 MOA)
 *   Home/End: lowest/highest setting
 *
 * Public API (used by src/ui/workspace.js):
 *   new TurretKnob(canvas, { clicks, clickValueRad, clickName, isMrad, onChange })
 *   .update(opts) .setClicks(n, emit = true) .adjustClicks(delta) .options.targetClicks .destroy()
 *   .clicksPerRev / .majorClicks (read-only getters: clicks per turn and per major mark)
 */

import { getPalette } from './palette.js';

const MOA_RAD = Math.PI / 180 / 60;
const MRAD_RAD = 0.001;

/** True when the optic clicks in MOA (by name, or by a click value that is a neat MOA fraction). */
export function opticIsMoa(clickValueRad, clickName = '') {
  const name = String(clickName || '').toUpperCase();
  if (name.includes('MOA')) return true;
  if (name.includes('MRAD') || name.includes('MIL')) return false;
  const inMoa = (clickValueRad || 0.0001) / MOA_RAD;
  return [1 / 8, 1 / 4, 1 / 2, 1].some((f) => Math.abs(inMoa - f) < 0.002);
}

/** Clicks per revolution: 10 MRAD or 25 MOA worth of clicks. */
export function clicksPerRevolution(clickValueRad, clickName) {
  const click = clickValueRad > 0 ? clickValueRad : 0.0001;
  const rev = opticIsMoa(click, clickName) ? 25 * MOA_RAD : 10 * MRAD_RAD;
  return Math.max(10, Math.round(rev / click));
}

function fmt(value, maxDecimals = 1) {
  const s = Number(value.toFixed(maxDecimals)).toString();
  return s === '-0' ? '0' : s;
}

export class TurretKnob {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        clicks: 0, // Current dialed elevation clicks
        clickValueRad: 0.0001, // 0.1 MRAD per click
        clickName: '0.1 MRAD',
        isMrad: true, // Display unit for aria-valuetext (the dial's scale and centre value use the optic's unit)
        targetClicks: 0, // Clicks the firing solution needs
        maxClicks: null, // null = derived (at least 3 revolutions)
        minClicks: null, // null = derived (0, or lower if the solution needs it)
        sound: true,
        onChange: null,
      },
      options
    );

    this.isDragging = false;
    this.dragStartY = 0;
    this.dragStartClicks = 0;
    this.audioCtx = null;
    this._handlers = {};

    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'slider');
    this.canvas.setAttribute('aria-label', 'Elevation turret');
    this.canvas.setAttribute('aria-orientation', 'vertical');
    this.canvas.setAttribute(
      'aria-description',
      'Drag up or down, scroll, or use the arrow keys. Page up and Page down move one major mark.'
    );

    this._bindEvents();
    this.resize();
  }

  // ---- derived scale -----------------------------------------------------------------------------

  get isMoaOptic() {
    return opticIsMoa(this.options.clickValueRad, this.options.clickName);
  }

  get clicksPerRev() {
    return clicksPerRevolution(this.options.clickValueRad, this.options.clickName);
  }

  /** Clicks per engraved number: 1 MRAD, or 2.5 MOA (a tenth of a revolution). */
  get majorClicks() {
    return Math.max(1, Math.round(this.clicksPerRev / 10));
  }

  get maxClicks() {
    if (Number.isFinite(this.options.maxClicks)) return this.options.maxClicks;
    const need = Math.ceil(Math.abs(this.options.targetClicks || 0) * 1.1);
    return Math.max(3 * this.clicksPerRev, need);
  }

  get minClicks() {
    if (Number.isFinite(this.options.minClicks)) return this.options.minClicks;
    return Math.min(0, Math.round(this.options.targetClicks || 0));
  }

  // ---- sizing ------------------------------------------------------------------------------------

  resize() {
    if (!this.canvas || !this.ctx) return;
    const parent = this.canvas.parentElement;
    const width = parent ? parent.clientWidth : 200;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.max(120, Math.min(200, Math.floor(width || 200)));
    const px = Math.floor(size * dpr);
    if (this.canvas.width !== px) this.canvas.width = px;
    if (this.canvas.height !== px) this.canvas.height = px;
    this.canvas.style.setProperty('width', `${size}px`);
    this.canvas.style.setProperty('height', `${size}px`);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
    this.render();
  }

  // ---- sound -------------------------------------------------------------------------------------

  _initAudio() {
    if (!this.options.sound) return;
    // Browsers only allow audio after a user gesture; skip until there has been one
    if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          this.audioCtx = new AudioContextClass();
        } catch {
          this.audioCtx = null;
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  playClickSound() {
    if (!this.options.sound || !this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3200, now);
      filter.Q.setValueAtTime(3.0, now);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(3600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.012);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.014);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.015);
    } catch {
      // Audio is optional
    }
  }

  // ---- value -------------------------------------------------------------------------------------

  setClicks(clicks, emitChange = true) {
    if (!Number.isFinite(Number(clicks))) return;
    const clamped = Math.max(this.minClicks, Math.min(this.maxClicks, Math.round(clicks)));
    if (clamped !== this.options.clicks) {
      const oldClicks = this.options.clicks;
      this.options.clicks = clamped;
      this.playClickSound();
      this.render();
      if (emitChange && this.options.onChange) this.options.onChange(clamped, oldClicks);
    }
  }

  adjustClicks(delta) {
    this._initAudio();
    this.setClicks(this.options.clicks + delta, true);
  }

  update(newOptions = {}) {
    Object.assign(this.options, newOptions);
    this.render();
  }

  _valueText() {
    const isMrad = this.options.isMrad !== false;
    const mrad = this.options.clicks * (this.options.clickValueRad || 0.0001) * 1000;
    const val = isMrad ? mrad : (mrad * MRAD_RAD) / MOA_RAD;
    const dir = this.options.clicks < 0 ? 'down' : 'up';
    const n = Math.abs(this.options.clicks);
    const t = Number(this.options.targetClicks);
    const sol = Number.isFinite(t) ? (t === this.options.clicks ? ', on the solution' : `, solution ${t} clicks`) : '';
    return `${Math.abs(val).toFixed(1)} ${isMrad ? 'MRAD' : 'MOA'} ${dir}, ${n} ${n === 1 ? 'click' : 'clicks'}${sol}`;
  }

  _updateAria() {
    const c = this.canvas;
    c.setAttribute('aria-valuemin', String(this.minClicks));
    c.setAttribute('aria-valuemax', String(this.maxClicks));
    c.setAttribute('aria-valuenow', String(this.options.clicks));
    c.setAttribute('aria-valuetext', this._valueText());
  }

  // ---- events ------------------------------------------------------------------------------------

  _bindEvents() {
    const h = this._handlers;

    h.pointerdown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.isDragging = true;
      this.dragStartY = e.clientY;
      this.dragStartClicks = this.options.clicks;
      this._initAudio();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best effort
      }
      this.canvas.focus({ preventScroll: true });
      e.preventDefault();
    };
    h.pointermove = (e) => {
      if (!this.isDragging) return;
      // 6 px of drag per click; dragging up dials up
      const px = e.pointerType === 'touch' ? 7 : 6;
      this.setClicks(this.dragStartClicks + Math.round((this.dragStartY - e.clientY) / px), true);
    };
    h.pointerup = (e) => {
      this.isDragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Already released
      }
    };
    h.wheel = (e) => {
      e.preventDefault();
      this.adjustClicks(e.deltaY < 0 ? 1 : -1);
    };
    h.keydown = (e) => {
      const big = this.majorClicks;
      let handled = true;
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          this.adjustClicks(1);
          break;
        case 'ArrowDown':
        case 'ArrowLeft':
          this.adjustClicks(-1);
          break;
        case 'PageUp':
          this.adjustClicks(big);
          break;
        case 'PageDown':
          this.adjustClicks(-big);
          break;
        case 'Home':
          this._initAudio();
          this.setClicks(this.minClicks, true);
          break;
        case 'End':
          this._initAudio();
          this.setClicks(this.maxClicks, true);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    h.focus = () => this.render();

    this.canvas.addEventListener('pointerdown', h.pointerdown);
    this.canvas.addEventListener('pointermove', h.pointermove);
    this.canvas.addEventListener('pointerup', h.pointerup);
    this.canvas.addEventListener('pointercancel', h.pointerup);
    this.canvas.addEventListener('wheel', h.wheel, { passive: false });
    this.canvas.addEventListener('keydown', h.keydown);
    this.canvas.addEventListener('focus', h.focus);
    this.canvas.addEventListener('blur', h.focus);

    if (window.ResizeObserver && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  destroy() {
    const h = this._handlers;
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', h.pointerdown);
      this.canvas.removeEventListener('pointermove', h.pointermove);
      this.canvas.removeEventListener('pointerup', h.pointerup);
      this.canvas.removeEventListener('pointercancel', h.pointerup);
      this.canvas.removeEventListener('wheel', h.wheel);
      this.canvas.removeEventListener('keydown', h.keydown);
      this.canvas.removeEventListener('focus', h.focus);
      this.canvas.removeEventListener('blur', h.focus);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this._handlers = {};
    this.options.onChange = null;
  }

  // ---- drawing -----------------------------------------------------------------------------------

  /**
   * A Låda meter dial: a fixed scale (one revolution, 0 at 12 o'clock) with a track that fills in
   * the accent clockwise as you dial up, a handle at the dialed position, a small marker for the
   * solution and the value in the middle. Completed revolutions tint the track and are counted.
   */
  render() {
    if (!this.ctx || !this.size) return;
    this._updateAria();
    const ctx = this.ctx;
    const pal = getPalette();
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;
    const rev = this.clicksPerRev;
    const major = this.majorClicks;
    const clicks = this.options.clicks;
    const isMoaOptic = this.isMoaOptic;
    const clickInOptic = (this.options.clickValueRad || 0.0001) / (isMoaOptic ? MOA_RAD : MRAD_RAD);
    const TOP = -Math.PI / 2;
    const angleOf = (c) => TOP + (c / rev) * Math.PI * 2;

    ctx.clearRect(0, 0, s, s);
    ctx.lineCap = 'round';

    const R = s / 2 - 14; // track centre line (room for the handle and the focus ring)
    const thick = Math.max(6, Math.round(R * 0.11));
    const inner = R - thick / 2;

    // 1. Track (.lg-chart-track); a completed revolution underneath tints it with the accent
    const turnIndex = Math.floor(Math.abs(clicks) / rev); // whole revolutions already dialed
    ctx.lineWidth = thick;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = turnIndex > 0 ? pal.alpha(pal.accent, 0.3) : pal.track;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Fill: from 0 to the dialed position within this revolution (counter-clockwise below zero)
    const within = Math.abs(clicks) % rev;
    const full = clicks !== 0 && within === 0;
    const sign = clicks < 0 ? -1 : 1;
    if (full || within > 0) {
      ctx.strokeStyle = pal.accent;
      ctx.beginPath();
      if (full) ctx.arc(cx, cy, R, 0, Math.PI * 2);
      else ctx.arc(cx, cy, R, TOP, angleOf(sign * within), sign < 0);
      ctx.stroke();
    }

    // 3. Scale inside the track: hairline ticks every major mark, numbers in 11 px muted text
    const showNumbers = s >= 140;
    const numberEvery = s >= 170 || rev / major <= 10 ? 1 : 2;
    ctx.lineCap = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = pal.font(11, 500);
    const tickOuter = inner - 4;
    for (let i = 0, n = 0; i < rev; i += major, n++) {
      const a = angleOf(i);
      const isNumbered = n % numberEvery === 0;
      const len = isNumbered ? 5 : 3;
      ctx.strokeStyle = isNumbered ? pal.alpha(pal.muted, 0.9) : pal.line2;
      ctx.lineWidth = pal.stroke.mark;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * tickOuter, cy + Math.sin(a) * tickOuter);
      ctx.lineTo(cx + Math.cos(a) * (tickOuter - len), cy + Math.sin(a) * (tickOuter - len));
      ctx.stroke();
      if (showNumbers && isNumbered) {
        const tr = tickOuter - len - 9;
        ctx.fillStyle = i === 0 ? pal.text : pal.muted;
        ctx.fillText(fmt(i * clickInOptic, 1), cx + Math.cos(a) * tr, cy + Math.sin(a) * tr);
      }
    }

    // 4. Solution marker: a small chevron outside the track pointing in, in the text colour
    const target = Number(this.options.targetClicks);
    if (Number.isFinite(target)) {
      const ta = angleOf(target);
      const mr = R + thick / 2 + 3;
      ctx.save();
      ctx.translate(cx + Math.cos(ta) * mr, cy + Math.sin(ta) * mr);
      ctx.rotate(ta + Math.PI); // point towards the centre
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-7, -5);
      ctx.lineTo(-7, 5);
      ctx.closePath();
      ctx.fillStyle = target === clicks ? pal.accent : pal.text;
      ctx.fill();
      ctx.restore();
    }

    // 5. Handle at the dialed position (white-on-accent ring like a slider thumb)
    const ha = angleOf(clicks);
    const hx = cx + Math.cos(ha) * R;
    const hy = cy + Math.sin(ha) * R;
    ctx.beginPath();
    ctx.arc(hx, hy, thick / 2 + 3, 0, Math.PI * 2);
    ctx.fillStyle = pal.surface;
    ctx.fill();
    ctx.lineWidth = pal.stroke.bold;
    ctx.strokeStyle = pal.accent;
    ctx.stroke();

    // 6. Value in the middle (meter style): number, unit and direction, revolution
    // In the optic's unit, so the number matches the scale around it (the readout below the dial
    // and aria-valuetext use the display unit, options.isMrad)
    const isMrad = !isMoaOptic;
    const dialedVal = clicks * clickInOptic;
    const big = s >= 170 ? 22 : 18;
    ctx.fillStyle = pal.text;
    ctx.font = pal.font(big, 600);
    ctx.fillText(Math.abs(dialedVal).toFixed(1), cx, cy - 6);
    ctx.fillStyle = pal.muted;
    ctx.font = pal.font(11, 500);
    ctx.fillText(`${isMrad ? 'MRAD' : 'MOA'} ${clicks < 0 ? 'down' : 'up'}`, cx, cy + big / 2 + 4);
    if (showNumbers) {
      ctx.fillText(`Turn ${turnIndex + (within > 0 || clicks === 0 ? 1 : 0)}`, cx, cy + big / 2 + 19);
    }

    // 7. Focus ring for keyboard focus (the canvas is an ARIA slider)
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
      ctx.arc(cx, cy, s / 2 - 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
