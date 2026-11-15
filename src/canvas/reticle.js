/**
 * Ballistic Workbench - reticle view (canvas)
 * Simulates the sight picture through the scope: a daylight scene, the target at its true angular
 * size, the reticle and the hold mark for the firing solution.
 * - FFP (first focal plane): the reticle grows with magnification, so its marks are true at any zoom.
 * - SFP (second focal plane): the reticle stays the same size; its marks are only true at the
 *   calibrated magnification (calibratedMag). The hold mark is always drawn at the true angle.
 * Reticles: Vortex EBR-8 and EBR-2C (MOA), Kahles SKMR4, Leupold PR2-MIL, Nightforce Mil-XT,
 * Horus Tremor3, Mil-Dot, German #4, Primary Arms ACSS DMR.
 *
 * Hold convention (screen coordinates, +x right, +y down):
 *   The hold mark is the point on the reticle you put on the target.
 *   elevation hold E (MRAD, + = up)    -> mark at y = cy + E * ppm (below the centre)
 *   windage hold W (MRAD, + = right)   -> mark at x = cx - W * ppm (left of the centre, i.e. on
 *   the downwind side: a wind from 3 o'clock pushes the bullet left, you hold right, so the target
 *   sits on a mark left of the centre).
 *   Holds are what is left after the dialed clicks: E - elevationDialClicks * clickValueRad.
 *
 * Public API (used by src/ui/workspace.js):
 *   new ReticleRenderer(canvas, opts) .update(opts) .bindEvents() .resize() .destroy()
 *   .options.illuminated   opts.distanceUnit ('m' | 'yd', default 'm') is used in the aria-label.
 */

import { getPalette } from './palette.js';

const MOA_PER_MRAD = 3.437746770784939;

/** Screen position of the hold mark. Exported for tests. */
export function holdMarkPosition(cx, cy, ppm, elevationHoldMrad, windageHoldMrad) {
  return { x: cx - windageHoldMrad * ppm, y: cy + elevationHoldMrad * ppm };
}

function fmtHold(v) {
  const s = v.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
}

export class ReticleRenderer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        reticleType: 'EBR-8 MRAD',
        focalPlane: 'FFP', // 'FFP' | 'SFP'
        magnification: 15,
        calibratedMag: 20, // SFP: magnification at which the reticle marks are true
        targetDistanceM: 600,
        distanceUnit: 'm',
        targetShape: 'ipsc', // 'ipsc' | 'circle' | 'square' | 'nato-e'
        targetWidthCm: 45,
        targetHeightCm: 75,
        elevationHoldMrad: 0, // Elevation the solution needs (MRAD, + = up)
        windageHoldMrad: 0, // Windage the solution needs (MRAD, + = right)
        elevationDialClicks: 0,
        windageDialClicks: 0,
        clickValueRad: 0.0001,
        isMrad: true,
        illuminated: false,
        illuminationColor: '#e5484d', // Illuminated reticle red (part of the scene, not the UI)
      },
      options
    );

    this.resizeObserver = null;
    this._onWindowResize = null;
    this.bindEvents();
    this.resize();
  }

  /** (Re)attaches the size observer. Safe to call more than once: it never adds a second listener. */
  bindEvents() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const parent = this.canvas?.parentElement;
    if (window.ResizeObserver && parent) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(parent);
    } else if (!this._onWindowResize) {
      this._onWindowResize = () => this.resize();
      window.addEventListener('resize', this._onWindowResize);
    }
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this._onWindowResize) {
      window.removeEventListener('resize', this._onWindowResize);
      this._onWindowResize = null;
    }
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.max(200, Math.floor(rect.width || 360));
    const displayHeight = Math.max(200, Math.floor(rect.height || 360));
    const pw = Math.floor(displayWidth * dpr);
    const ph = Math.floor(displayHeight * dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = displayWidth;
    this.h = displayHeight;
    this.size = Math.min(displayWidth, displayHeight);
    this.render();
  }

  update(newOptions = {}) {
    Object.assign(this.options, newOptions);
    this.render();
  }

  /** Pixels per MRAD for the scene (target, hold) and for the reticle marks. */
  _scales(r) {
    const base = r / 10.0; // at 15x the eyepiece shows about 10 MRAD from centre to edge
    const mag = Math.max(1, Number(this.options.magnification) || 15);
    const cal = Math.max(1, Number(this.options.calibratedMag) || 20);
    const worldPpm = base * (mag / 15);
    const reticlePpm = this.options.focalPlane === 'SFP' ? base * (cal / 15) : worldPpm;
    return { worldPpm, reticlePpm, mag, cal };
  }

  /** Remaining hold after the dialed clicks, in MRAD. */
  _holds() {
    const click = this.options.clickValueRad || 0.0001;
    const dialedEl = (this.options.elevationDialClicks || 0) * click * 1000;
    const dialedWind = (this.options.windageDialClicks || 0) * click * 1000;
    return {
      el: (this.options.elevationHoldMrad || 0) - dialedEl,
      wind: (this.options.windageHoldMrad || 0) - dialedWind,
    };
  }

  _holdUnitIsMrad() {
    return this.options.isMrad !== false && !String(this.options.reticleType || '').toLowerCase().includes('moa');
  }

  _holdText(hold) {
    const isMrad = this._holdUnitIsMrad();
    const k = isMrad ? 1 : MOA_PER_MRAD;
    const unit = isMrad ? 'MRAD' : 'MOA';
    const el = hold.el * k;
    const wind = hold.wind * k;
    const elPart = Math.abs(el) < 0.005 ? 'no elevation' : `${fmtHold(Math.abs(el))} ${el > 0 ? 'up' : 'down'}`;
    const windPart = Math.abs(wind) < 0.005 ? 'no wind' : `${fmtHold(Math.abs(wind))} ${wind > 0 ? 'right' : 'left'}`;
    return { elPart, windPart, unit, none: elPart === 'no elevation' && windPart === 'no wind' };
  }

  render() {
    if (!this.ctx || !this.w || !this.h) return;
    const ctx = this.ctx;
    const pal = getPalette();
    const w = this.w;
    const h = this.h;
    const s = this.size;
    const cx = w / 2;
    const cy = h / 2;
    const r = s / 2 - 12; // eyepiece radius
    this._r = r;
    this._numFont = pal.monoFont(11, 500);

    const { worldPpm, reticlePpm, mag, cal } = this._scales(r);
    const hold = this._holds();
    const mark = holdMarkPosition(cx, cy, worldPpm, hold.el, hold.wind);

    // 1. Around the eyepiece: the card surface, so the view sits in the panel in both themes
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = pal.surface;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // 2. Daylight scene (fixed colours: this is a picture through glass, not UI)
    const scene = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    scene.addColorStop(0, '#9fb6c8');
    scene.addColorStop(0.47, '#c9d3d6');
    scene.addColorStop(0.5, '#8d9070');
    scene.addColorStop(1, '#5f6648');
    ctx.fillStyle = scene;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // 3. Target, placed on the hold mark: this is the sight picture when you hold correctly
    this._renderTarget(ctx, mark.x, mark.y, worldPpm);

    // 4. Reticle
    const reticleColor = this.options.illuminated ? this.options.illuminationColor : '#141414';
    ctx.strokeStyle = reticleColor;
    ctx.fillStyle = reticleColor;
    ctx.lineWidth = 1;
    const ppm = reticlePpm;
    const rType = (this.options.reticleType || '').toLowerCase();
    ctx.save();
    if (this.options.illuminated) {
      ctx.shadowColor = reticleColor;
      ctx.shadowBlur = 4;
    }
    if (rType.includes('skmr4')) this._renderSkMr4(ctx, cx, cy, ppm, reticleColor, r);
    else if (rType.includes('pr2')) this._renderPr2Mil(ctx, cx, cy, ppm, reticleColor, r);
    else if (rType.includes('ebr-2c') || rType.includes('moa')) this._renderEbr2cMoa(ctx, cx, cy, ppm, reticleColor, r);
    else if (rType.includes('german')) this._renderGerman4(ctx, cx, cy, ppm, reticleColor, r);
    else if (rType.includes('acss')) this._renderAcssDmr(ctx, cx, cy, ppm, reticleColor, r);
    else if (rType.includes('tremor')) this._renderTremor3(ctx, cx, cy, ppm, reticleColor);
    else if (rType.includes('mil-xt')) this._renderMilXT(ctx, cx, cy, ppm, reticleColor);
    else if (rType.includes('mil-dot') || rType.includes('mildot')) this._renderMilDot(ctx, cx, cy, ppm, reticleColor, r);
    else this._renderEbr8(ctx, cx, cy, ppm, reticleColor, r);
    ctx.restore();

    // 5. Hold mark
    this._renderHoldMark(ctx, pal, mark, cx, cy, r);
    ctx.restore();

    // 6. Eyepiece: dark tube ring with a soft inner edge
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#16181b';
    ctx.stroke();
    const vignette = ctx.createRadialGradient(cx, cy, r * 0.82, cx, cy, r);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = vignette;
    ctx.fill();
    ctx.restore();

    // 7. Overlays (UI, token colours)
    const holdText = this._holdText(hold);
    this._renderBadges(ctx, pal, holdText, mag, cal);
    this._updateAriaLabel(holdText, mag);
  }

  /** Two pills: optic settings (top left) and the hold (bottom left). */
  _renderBadges(ctx, pal, holdText, mag, cal) {
    const pad = 12;
    const lines1 = [
      { text: `${mag}x · ${this.options.focalPlane}`, font: pal.font(13, 700), color: pal.text },
      { text: String(this.options.reticleType || ''), font: pal.font(11), color: pal.muted },
    ];
    if (this.options.focalPlane === 'SFP' && Math.abs(mag - cal) > 0.01) {
      lines1.push({ text: `Marks true at ${cal}x`, font: pal.font(11, 600), color: pal.warnText });
    }
    this._card(ctx, pal, pad, pad, lines1, 'top');

    const narrow = this.w < 520;
    let lines2;
    if (holdText.none) {
      lines2 = [{ text: 'No hold needed', font: pal.font(12, 600), color: pal.text }];
    } else if (narrow) {
      lines2 = [
        { text: `Hold (${holdText.unit})`, font: pal.font(11, 600), color: pal.muted },
        { text: holdText.elPart, font: pal.monoFont(12, 600), color: pal.text },
        { text: holdText.windPart, font: pal.monoFont(12, 600), color: pal.text },
      ];
    } else {
      lines2 = [
        { text: 'Hold', font: pal.font(11, 600), color: pal.muted },
        { text: `${holdText.elPart}, ${holdText.windPart} ${holdText.unit}`, font: pal.monoFont(12, 600), color: pal.text },
      ];
    }
    this._card(ctx, pal, pad, this.h - pad, lines2, 'bottom');
  }

  _card(ctx, pal, x, y, lines, anchor) {
    ctx.save();
    const lh = 16;
    let tw = 0;
    for (const l of lines) {
      ctx.font = l.font;
      tw = Math.max(tw, ctx.measureText(l.text).width);
    }
    const bw = Math.min(this.w - 2 * x, tw + 20);
    const bh = lines.length * lh + 12;
    const by = anchor === 'bottom' ? y - bh : y;
    ctx.fillStyle = pal.alpha(pal.elevated, 0.9);
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, by + 0.5, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x + 10, by + 6 + lh / 2 + i * lh, bw - 20);
    });
    ctx.restore();
  }

  _updateAriaLabel(holdText, mag) {
    if (!this.canvas) return;
    const plane = this.options.focalPlane === 'SFP' ? 'second focal plane' : 'first focal plane';
    const yd = this.options.distanceUnit === 'yd';
    const dist = Math.round((this.options.targetDistanceM || 0) * (yd ? 1.0936133 : 1));
    const hold = holdText.none
      ? 'No hold needed.'
      : `Hold ${holdText.elPart} and ${holdText.windPart} ${holdText.unit}.`;
    this.canvas.setAttribute(
      'aria-label',
      `Reticle view: ${this.options.reticleType} at ${mag}x, ${plane}. Target at ${dist} ${yd ? 'yd' : 'm'}. ${hold}`
    );
  }

  _renderTarget(ctx, targetX, targetY, worldPpm) {
    const distM = Math.max(10, this.options.targetDistanceM || 600);
    const targetW_M = (this.options.targetWidthCm || 45) / 100.0;
    const targetH_M = (this.options.targetHeightCm || 75) / 100.0;

    // Angular size in MRAD = size / distance * 1000
    const pxW = (targetW_M / distM) * 1000.0 * worldPpm;
    const pxH = (targetH_M / distM) * 1000.0 * worldPpm;

    ctx.save();
    ctx.fillStyle = '#eceae4'; // painted steel
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 1.5;

    const shape = this.options.targetShape || 'ipsc';
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(targetX, targetY, pxW / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (shape === 'square') {
      ctx.fillRect(targetX - pxW / 2, targetY - pxH / 2, pxW, pxH);
      ctx.strokeRect(targetX - pxW / 2, targetY - pxH / 2, pxW, pxH);
    } else {
      // IPSC Torso: 45 x 75 cm with 15x15 cm head box
      const halfW = pxW / 2;
      const halfH = pxH / 2;
      const headHalfW = halfW * 0.35;
      const headBottomY = targetY - halfH * 0.45;

      ctx.beginPath();
      ctx.moveTo(targetX - halfW, targetY + halfH);
      ctx.lineTo(targetX + halfW, targetY + halfH);
      ctx.lineTo(targetX + halfW, headBottomY);
      ctx.lineTo(targetX + headHalfW, headBottomY);
      ctx.lineTo(targetX + headHalfW, targetY - halfH);
      ctx.lineTo(targetX - headHalfW, targetY - halfH);
      ctx.lineTo(targetX - headHalfW, headBottomY);
      ctx.lineTo(targetX - halfW, headBottomY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Center hit zone diamond
      ctx.strokeStyle = 'rgba(160, 60, 50, 0.45)';
      ctx.beginPath();
      ctx.arc(targetX, targetY - halfH * 0.1, pxW * 0.15, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Fixed Mil-Dot Reticle:
   * - Eliminates diamond polygon distortion by isolating each arc in its own distinct path.
   * - Adds thick duplex stadium posts outside the 5-mil central zone.
   */
  _renderMilDot(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;
    const stadiumStartMil = 5.0;
    const stadiumOffset = stadiumStartMil * ppm;

    // 1. Thick Duplex Stadium Posts (Outer Heavy Bars)
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = color;

    ctx.beginPath();
    // Left post
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - stadiumOffset, cy);
    // Right post
    ctx.moveTo(cx + stadiumOffset, cy);
    ctx.lineTo(cx + r, cy);
    // Top post
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - stadiumOffset);
    // Bottom post
    ctx.moveTo(cx, cy + stadiumOffset);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // 2. Fine Center Hairlines
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - stadiumOffset, cy);
    ctx.lineTo(cx + stadiumOffset, cy);
    ctx.moveTo(cx, cy - stadiumOffset);
    ctx.lineTo(cx, cy + stadiumOffset);
    ctx.stroke();

    // 3. Classic Oval Mil-Dots Spaced Every 1 MRAD (1 through 4 mils)
    // CRITICAL BUG FIX: Distinct beginPath() for every individual dot to avoid diamond poly distortion!
    const dotR = 2.2;
    for (let mil = 1; mil < stadiumStartMil; mil++) {
      const off = mil * ppm;

      // Right Dot
      ctx.beginPath();
      ctx.arc(cx + off, cy, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Left Dot
      ctx.beginPath();
      ctx.arc(cx - off, cy, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Down Dot
      ctx.beginPath();
      ctx.arc(cx, cy + off, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Up Dot
      ctx.beginPath();
      ctx.arc(cx, cy - off, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Kahles SKMR4 Reticle (PRS Match with floating dot, 0.2 mil sub-hashes, and holdover tree)
   */
  _renderSkMr4(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;
    const outerGap = 7 * ppm;

    // Outer thick posts
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - outerGap, cy);
    ctx.moveTo(cx + outerGap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - outerGap);
    ctx.moveTo(cx, cy + (12 * ppm));
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Fine center crosshair with center dot gap
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - outerGap, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + outerGap, cy);
    ctx.moveTo(cx, cy - outerGap);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + (12 * ppm));
    ctx.stroke();

    // Floating center dot (0.05 mil)
    ctx.beginPath();
    ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
    ctx.fill();

    // 0.2 mil sub-hashes and 1.0 mil marks on horizontal axis
    for (let mil = 1; mil <= 6; mil++) {
      const off = mil * ppm;

      // 1.0 mil major tick
      ctx.beginPath();
      ctx.moveTo(cx + off, cy - 5);
      ctx.lineTo(cx + off, cy + 5);
      ctx.moveTo(cx - off, cy - 5);
      ctx.lineTo(cx - off, cy + 5);
      ctx.stroke();

      // 0.5 mil medium tick
      const halfOff = (mil - 0.5) * ppm;
      ctx.beginPath();
      ctx.moveTo(cx + halfOff, cy - 3.5);
      ctx.lineTo(cx + halfOff, cy + 3.5);
      ctx.moveTo(cx - halfOff, cy - 3.5);
      ctx.lineTo(cx - halfOff, cy + 3.5);
      ctx.stroke();

      // 0.2 sub-hashes
      for (const f of [0.2, 0.4, 0.6, 0.8]) {
        const subOff = (mil - 1 + f) * ppm;
        ctx.beginPath();
        ctx.moveTo(cx + subOff, cy - 2);
        ctx.lineTo(cx + subOff, cy + 2);
        ctx.moveTo(cx - subOff, cy - 2);
        ctx.lineTo(cx - subOff, cy + 2);
        ctx.stroke();
      }

      if (mil % 2 === 0) {
        ctx.font = this._numFont;
        ctx.textAlign = 'center';
        ctx.fillText(`${mil}`, cx + off, cy - 8);
        ctx.fillText(`${mil}`, cx - off, cy - 8);
      }
    }

    // SKMR4 Holdover Tree (downwards from 1 to 10 mils)
    for (let drop = 1; drop <= 10; drop++) {
      const y = cy + drop * ppm;

      ctx.beginPath();
      ctx.moveTo(cx - 4, y);
      ctx.lineTo(cx + 4, y);
      ctx.stroke();

      if (drop % 2 === 0) {
        ctx.font = this._numFont;
        ctx.textAlign = 'left';
        ctx.fillText(`${drop}`, cx + 8, y + 3);
      }

      // Wind hold dots at 0.5 and 1.0 mils
      const maxWind = Math.min(5, drop * 0.6);
      for (let w = 1; w <= maxWind; w++) {
        const wOff = w * ppm;
        ctx.beginPath();
        ctx.arc(cx + wOff, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - wOff, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Leupold PR2-MIL Reticle (Minimalist PRS / NRL competition)
   */
  _renderPr2Mil(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;
    const outerGap = 8 * ppm;

    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = color;

    // Outer posts
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - outerGap, cy);
    ctx.moveTo(cx + outerGap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - outerGap);
    ctx.moveTo(cx, cy + (12 * ppm));
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Fine center hairline
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - outerGap, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + outerGap, cy);
    ctx.moveTo(cx, cy - outerGap);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + (12 * ppm));
    ctx.stroke();

    // Floating micro-dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // 0.25 mil hash marks
    for (let mil = 1; mil <= 7; mil++) {
      const off = mil * ppm;
      ctx.beginPath();
      ctx.moveTo(cx + off, cy - 4);
      ctx.lineTo(cx + off, cy + 4);
      ctx.moveTo(cx - off, cy - 4);
      ctx.lineTo(cx - off, cy + 4);
      ctx.stroke();

      // Half-mil hash
      const half = (mil - 0.5) * ppm;
      ctx.beginPath();
      ctx.moveTo(cx + half, cy - 2.5);
      ctx.lineTo(cx + half, cy + 2.5);
      ctx.moveTo(cx - half, cy - 2.5);
      ctx.lineTo(cx - half, cy + 2.5);
      ctx.stroke();
    }

    // Uncluttered tree lines
    for (let drop = 2; drop <= 10; drop += 2) {
      const y = cy + drop * ppm;
      ctx.font = this._numFont;
      ctx.textAlign = 'left';
      ctx.fillText(`${drop}`, cx + 6, y + 3);

      for (let w = 1; w <= 3; w++) {
        ctx.beginPath();
        ctx.arc(cx + w * ppm, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - w * ppm, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Vortex EBR-2C MOA Reticle (Calibrated in Minutes of Angle)
   */
  _renderEbr2cMoa(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;
    // 1 MOA in MRAD is ~0.29089 mrad
    const moaPpm = ppm * 0.29089;
    const outerGap = 24 * moaPpm;

    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = color;

    // Outer thick posts
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - outerGap, cy);
    ctx.moveTo(cx + outerGap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - outerGap);
    ctx.moveTo(cx, cy + (36 * moaPpm));
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Fine lines
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - outerGap, cy);
    ctx.lineTo(cx + outerGap, cy);
    ctx.moveTo(cx, cy - outerGap);
    ctx.lineTo(cx, cy + (36 * moaPpm));
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 2 MOA & 4 MOA horizontal marks
    for (let moa = 2; moa <= 24; moa += 2) {
      const off = moa * moaPpm;
      const isMajor = moa % 4 === 0;
      const len = isMajor ? 5 : 3;

      ctx.beginPath();
      ctx.moveTo(cx + off, cy - len);
      ctx.lineTo(cx + off, cy + len);
      ctx.moveTo(cx - off, cy - len);
      ctx.lineTo(cx - off, cy + len);
      ctx.stroke();

      if (isMajor) {
        ctx.font = this._numFont;
        ctx.textAlign = 'center';
        ctx.fillText(`${moa}`, cx + off, cy - 8);
        ctx.fillText(`${moa}`, cx - off, cy - 8);
      }
    }

    // MOA Drop Tree (every 4 MOA down to 32 MOA)
    for (let drop = 4; drop <= 32; drop += 4) {
      const y = cy + drop * moaPpm;
      ctx.beginPath();
      ctx.moveTo(cx - 5, y);
      ctx.lineTo(cx + 5, y);
      ctx.stroke();

      ctx.font = this._numFont;
      ctx.textAlign = 'left';
      ctx.fillText(`${drop}`, cx + 7, y + 3);

      const maxWind = Math.min(16, drop * 0.6);
      for (let w = 4; w <= maxWind; w += 4) {
        const wOff = w * moaPpm;
        ctx.beginPath();
        ctx.arc(cx + wOff, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - wOff, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * German #4 Hunting Reticle (3 Heavy Stadium Bars, Open Top)
   */
  _renderGerman4(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;
    const gateMil = 3.5;
    const gate = gateMil * ppm;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    // 1. Three Heavy Thick Stadium Bars (9 o'clock, 3 o'clock, 6 o'clock)
    const barWidth = 8;
    // Left bar
    ctx.fillRect(cx - r, cy - barWidth / 2, r - gate, barWidth);
    // Right bar
    ctx.fillRect(cx + gate, cy - barWidth / 2, r - gate, barWidth);
    // Bottom bar
    ctx.fillRect(cx - barWidth / 2, cy + gate, barWidth, r - gate);

    // 2. Fine Center Hairlines (Note: 12 o'clock has fine line extending all the way to top)
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Horizontal fine crosshair connecting through center
    ctx.moveTo(cx - gate, cy);
    ctx.lineTo(cx + gate, cy);
    // Vertical fine crosshair (runs from top edge down to bottom heavy bar)
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + gate);
    ctx.stroke();

    // Fine center aim point
    ctx.beginPath();
    ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Primary Arms ACSS DMR Reticle (Horseshoe CQB, Chevron tip, BDC ladder & wind leads)
   */
  _renderAcssDmr(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;

    // 1. Center Aiming Chevron (Point of aim is chevron apex at cx, cy)
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 5);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.stroke();

    // 2. CQB Horseshoe Arc (270-degree outer ring surrounding chevron)
    const hsR = 2.4 * ppm;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, cy, hsR, 0.25 * Math.PI, 0.75 * Math.PI, true);
    ctx.stroke();

    // 3. Horizontal stadia with ranging bars
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.85, cy);
    ctx.lineTo(cx - hsR - 4, cy);
    ctx.moveTo(cx + hsR + 4, cy);
    ctx.lineTo(cx + r * 0.85, cy);
    ctx.stroke();

    // 4. BDC Drop Ladder with Ranging Brackets (300m, 400m, 500m, 600m, 700m, 800m)
    const bdcDrops = [
      { dropM: 300, mil: 1.2, widthMil: 1.5 },
      { dropM: 400, mil: 2.3, widthMil: 1.2 },
      { dropM: 500, mil: 3.6, widthMil: 0.9 },
      { dropM: 600, mil: 5.1, widthMil: 0.75 },
      { dropM: 700, mil: 6.8, widthMil: 0.65 },
      { dropM: 800, mil: 8.8, widthMil: 0.55 },
    ];

    bdcDrops.forEach((b, idx) => {
      const y = cy + b.mil * ppm;
      const halfW = (b.widthMil * ppm) / 2;

      // Center cross rung
      ctx.beginPath();
      ctx.moveTo(cx - halfW, y);
      ctx.lineTo(cx + halfW, y);
      ctx.stroke();

      // Ranging number label
      ctx.font = this._numFont;
      ctx.textAlign = 'left';
      ctx.fillText(`${b.dropM / 100}`, cx + halfW + 6, y + 3);

      // Wind hold dots (5 mph & 10 mph leads)
      const wind5 = halfW * 1.5;
      const wind10 = halfW * 2.5;
      for (const w of [wind5, wind10]) {
        ctx.beginPath();
        ctx.arc(cx + w, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - w, y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.restore();
  }

  _renderEbr8(ctx, cx, cy, ppm, color, scopeRadius) {
    const r = scopeRadius || this._r;
    const postThick = 2.5;
    ctx.lineWidth = postThick;
    ctx.strokeStyle = color;

    // Outer thick stadia
    const outerGap = 10 * ppm;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - outerGap, cy);
    ctx.moveTo(cx + outerGap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - outerGap);
    ctx.moveTo(cx, cy + 12 * ppm);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Fine center crosshair
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - outerGap, cy);
    ctx.lineTo(cx + outerGap, cy);
    ctx.moveTo(cx, cy - outerGap);
    ctx.lineTo(cx, cy + 12 * ppm);
    ctx.stroke();

    // Center floating dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Horizontal Mil hashes
    for (let mil = 1; mil <= 9; mil++) {
      const offset = mil * ppm;

      ctx.beginPath();
      ctx.moveTo(cx + offset, cy - 5);
      ctx.lineTo(cx + offset, cy + 5);
      ctx.moveTo(cx - offset, cy - 5);
      ctx.lineTo(cx - offset, cy + 5);
      ctx.stroke();

      const halfOffset = (mil - 0.5) * ppm;
      ctx.beginPath();
      ctx.moveTo(cx + halfOffset, cy - 3);
      ctx.lineTo(cx + halfOffset, cy + 3);
      ctx.moveTo(cx - halfOffset, cy - 3);
      ctx.lineTo(cx - halfOffset, cy + 3);
      ctx.stroke();

      if (mil % 2 === 0) {
        ctx.font = this._numFont;
        ctx.textAlign = 'center';
        ctx.fillText(`${mil}`, cx + offset, cy - 8);
        ctx.fillText(`${mil}`, cx - offset, cy - 8);
      }
    }

    // Vertical Drop Christmas Tree
    for (let dropMil = 1; dropMil <= 10; dropMil++) {
      const dropY = cy + dropMil * ppm;

      ctx.beginPath();
      ctx.moveTo(cx - 4, dropY);
      ctx.lineTo(cx + 4, dropY);
      ctx.stroke();

      ctx.font = this._numFont;
      ctx.textAlign = 'left';
      ctx.fillText(`${dropMil}`, cx + 8, dropY + 3);

      const maxWindMils = Math.min(6, dropMil * 0.7);
      for (let windMil = 1; windMil <= maxWindMils; windMil++) {
        const dotOffset = windMil * ppm;
        ctx.beginPath();
        ctx.arc(cx + dotOffset, dropY, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - dotOffset, dropY, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _renderMilXT(ctx, cx, cy, ppm, color) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;

    ctx.beginPath();
    ctx.moveTo(cx - 8 * ppm, cy);
    ctx.lineTo(cx - 1.5, cy);
    ctx.moveTo(cx + 1.5, cy);
    ctx.lineTo(cx + 8 * ppm, cy);
    ctx.moveTo(cx, cy - 8 * ppm);
    ctx.lineTo(cx, cy - 1.5);
    ctx.moveTo(cx, cy + 1.5);
    ctx.lineTo(cx, cy + 12 * ppm);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
    ctx.fill();

    for (let drop = 1; drop <= 12; drop++) {
      const y = cy + drop * ppm;
      ctx.beginPath();
      ctx.moveTo(cx - 5, y);
      ctx.lineTo(cx + 5, y);
      ctx.stroke();

      if (drop % 2 === 0) {
        ctx.font = this._numFont;
        ctx.textAlign = 'left';
        ctx.fillText(`${drop}`, cx + 7, y + 3);
      }

      const windLimit = Math.min(5, drop * 0.6);
      for (let w = 1; w <= windLimit; w++) {
        ctx.beginPath();
        ctx.arc(cx + w * ppm, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - w * ppm, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _renderTremor3(ctx, cx, cy, ppm, color) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;

    ctx.beginPath();
    ctx.moveTo(cx - 8 * ppm, cy);
    ctx.lineTo(cx + 8 * ppm, cy);
    ctx.moveTo(cx, cy - 6 * ppm);
    ctx.lineTo(cx, cy + 12 * ppm);
    ctx.stroke();

    for (let drop = 1; drop <= 10; drop++) {
      const y = cy + drop * ppm;
      const speedOffset = drop * 0.45 * ppm;

      ctx.beginPath();
      ctx.moveTo(cx - 3, y - 2);
      ctx.lineTo(cx, y);
      ctx.lineTo(cx + 3, y - 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx + speedOffset, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx - speedOffset, y, 1.2, 0, Math.PI * 2);
      ctx.fill();

      if (drop % 2 === 0) {
        ctx.font = this._numFont;
        ctx.textAlign = 'left';
        ctx.fillText(`${drop}`, cx + 6, y + 3);
      }
    }
  }

  /** Ring around the hold mark (clamped to the eyepiece edge with an arrow if it is outside the view). */
  _renderHoldMark(ctx, pal, mark, cx, cy, r) {
    const dx = mark.x - cx;
    const dy = mark.y - cy;
    const dist = Math.hypot(dx, dy);
    const inside = dist <= r - 12;
    ctx.save();
    if (inside) {
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.warn;
      ctx.stroke();
      ctx.fillStyle = pal.warn;
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Outside the field of view: an arrow at the edge pointing towards it
      const ux = dx / (dist || 1);
      const uy = dy / (dist || 1);
      const ax = cx + ux * (r - 18);
      const ay = cy + uy * (r - 18);
      ctx.translate(ax, ay);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.fillStyle = pal.warn;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -7);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
}
