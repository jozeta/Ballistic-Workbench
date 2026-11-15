/**
 * Ballistic Workbench - elevation turret (canvas)
 * A knurled elevation turret engraved in the optic's own unit. One revolution is 10 MRAD for MRAD
 * optics and 25 MOA for MOA optics, so the number of clicks per turn follows the click size.
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
        isMrad: true, // Display unit for the readout (the engraving uses the optic's unit)
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
    return `${Math.abs(val).toFixed(1)} ${isMrad ? 'MRAD' : 'MOA'} ${dir}, ${n} ${n === 1 ? 'click' : 'clicks'}`;
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

  render() {
    if (!this.ctx || !this.size) return;
    this._updateAria();
    const ctx = this.ctx;
    const pal = getPalette();
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;
    const r = s / 2 - 10;
    const rev = this.clicksPerRev;
    const major = this.majorClicks;
    const medium = Math.max(1, Math.round(major / 2));
    const clicks = this.options.clicks;
    const isMoaOptic = this.isMoaOptic;
    const clickInOptic = (this.options.clickValueRad || 0.0001) / (isMoaOptic ? MOA_RAD : MRAD_RAD);

    ctx.clearRect(0, 0, s, s);

    // The dial turns clockwise as clicks increase; the engraving moves under the fixed index mark
    const rotAngle = (clicks / rev) * Math.PI * 2;
    const metal = pal.mix(pal.surface, pal.text, pal.isLight ? 0.1 : 0.06);
    const metalEdge = pal.mix(pal.surface, pal.text, pal.isLight ? 0.28 : 0.2);

    ctx.save();
    ctx.translate(cx, cy);

    // 1. Knurled grip ring
    const outerR = r;
    const innerR = r - 12;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fillStyle = metalEdge;
    ctx.fill();
    ctx.strokeStyle = pal.alpha(pal.surface, 0.9);
    ctx.lineWidth = 2;
    const notchCount = 60;
    for (let i = 0; i < notchCount; i++) {
      const a = (i / notchCount) * Math.PI * 2 + rotAngle;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (innerR + 1), Math.sin(a) * (innerR + 1));
      ctx.lineTo(Math.cos(a) * (outerR - 1), Math.sin(a) * (outerR - 1));
      ctx.stroke();
    }

    // 2. Dial face
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-innerR * 0.3, -innerR * 0.4, innerR * 0.1, 0, 0, innerR);
    grad.addColorStop(0, pal.mix(metal, pal.elevated, 0.5));
    grad.addColorStop(1, metal);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 3. Graduations (thin out minor ticks when there are many clicks per turn)
    const minorEvery = rev > 120 ? 2 : 1;
    const showNumbers = s >= 140;
    for (let i = 0; i < rev; i++) {
      const isMajor = i % major === 0;
      const isMedium = !isMajor && i % medium === 0;
      if (!isMajor && !isMedium && i % minorEvery !== 0) continue;
      const angle = (i / rev) * Math.PI * 2 - Math.PI / 2 - rotAngle;
      const len = isMajor ? 9 : isMedium ? 6 : 3.5;
      ctx.beginPath();
      ctx.strokeStyle = isMajor ? pal.text : isMedium ? pal.alpha(pal.text, 0.7) : pal.alpha(pal.text, 0.4);
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.moveTo(Math.cos(angle) * (innerR - 2), Math.sin(angle) * (innerR - 2));
      ctx.lineTo(Math.cos(angle) * (innerR - 2 - len), Math.sin(angle) * (innerR - 2 - len));
      ctx.stroke();

      if (isMajor && showNumbers) {
        const textR = innerR - 20;
        ctx.save();
        ctx.translate(Math.cos(angle) * textR, Math.sin(angle) * textR);
        ctx.rotate(angle + Math.PI / 2);
        ctx.font = pal.monoFont(11, 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = i === 0 ? pal.accent : pal.text;
        ctx.fillText(fmt(i * clickInOptic, 1), 0, 0);
        ctx.restore();
      }
    }

    // Solution mark: where the dial needs to be (shown as a small ring on the dial edge)
    const target = Number(this.options.targetClicks);
    if (Number.isFinite(target) && target !== clicks) {
      // Engraving value v sits at angle (v - clicks) / rev turns from the index at 12 o'clock
      const ta = ((target - clicks) / rev) * Math.PI * 2 - Math.PI / 2;
      const tx = Math.cos(ta) * (innerR + 6);
      const ty = Math.sin(ta) * (innerR + 6);
      ctx.beginPath();
      ctx.arc(tx, ty, 4, 0, Math.PI * 2);
      ctx.fillStyle = pal.ok;
      ctx.fill();
      ctx.strokeStyle = pal.surface;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 4. Centre cap with the dialed value
    const capR = innerR * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, capR, 0, Math.PI * 2);
    ctx.fillStyle = pal.elevated;
    ctx.fill();
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = 1;
    ctx.stroke();

    const isMrad = this.options.isMrad !== false;
    const dialedMrad = clicks * (this.options.clickValueRad || 0.0001) * 1000;
    const dialedVal = isMrad ? dialedMrad : (dialedMrad * MRAD_RAD) / MOA_RAD;
    ctx.fillStyle = pal.text;
    ctx.font = pal.monoFont(Math.max(13, Math.round(capR * 0.42)), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.abs(dialedVal).toFixed(1), 0, -capR * 0.22);
    ctx.fillStyle = pal.muted;
    ctx.font = pal.font(11, 500);
    ctx.fillText(`${isMrad ? 'MRAD' : 'MOA'} ${clicks < 0 ? 'down' : 'up'}`, 0, capR * 0.28);

    // Turn counter (multi-turn turret)
    const turn = Math.floor(Math.max(0, clicks) / rev) + 1;
    if (turn > 1 && showNumbers) {
      ctx.font = pal.font(11, 600);
      ctx.fillStyle = pal.accent;
      ctx.fillText(`Turn ${turn}`, 0, capR * 0.66);
    }
    ctx.restore();

    // 5. Fixed index mark at 12 o'clock
    ctx.save();
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.moveTo(cx, 10 + 9);
    ctx.lineTo(cx - 5, 1);
    ctx.lineTo(cx + 5, 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 6. Focus ring (the canvas is keyboard operable)
    if (typeof document !== 'undefined' && document.activeElement === this.canvas) {
      ctx.save();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
