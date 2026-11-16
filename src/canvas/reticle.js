/**
 * Ballistic Workbench - reticle view (canvas)
 * Draws the sight picture through the scope in the Låda Glass graphic language: a flat glass field
 * with muted range rings (every 5 MRAD), the target at its true angular size, the reticle in the text
 * colour (muted red token when illuminated, no glow) and the hold mark in the accent. A caption band
 * above and a readout band below ("Dialed 4.4 MRAD · hold 1.0 right MRAD", target size) keep text
 * off the field. Token colours come from palette.js, so both themes work.
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

import { getPalette, drawLabel } from './palette.js';

const MOA_PER_MRAD = 3.437746770784939;

/** Screen position of the hold mark. Exported for tests. */
export function holdMarkPosition(cx, cy, ppm, elevationHoldMrad, windageHoldMrad) {
  return { x: cx - windageHoldMrad * ppm, y: cy + elevationHoldMrad * ppm };
}

function fmtHold(v) {
  const s = v.toFixed(1);
  return s === '-0.0' ? '0.0' : s;
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
        illuminationColor: null, // Illuminated reticle colour; null = the --lg-bad token
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

  /**
   * Remaining hold after the dialed clicks, in MRAD. A residual within half a click is what the
   * turret cannot resolve, so it counts as no hold (the target then sits exactly on the crosshair
   * instead of jittering by a pixel as the distance changes).
   */
  _holds() {
    const click = (this.options.clickValueRad || 0.0001) * 1000;
    const snap = (v) => (Math.abs(v) <= click / 2 + 1e-9 ? 0 : v);
    const dialedEl = (this.options.elevationDialClicks || 0) * click;
    const dialedWind = (this.options.windageDialClicks || 0) * click;
    return {
      el: snap((this.options.elevationHoldMrad || 0) - dialedEl),
      wind: snap((this.options.windageHoldMrad || 0) - dialedWind),
      dialedEl,
      dialedWind,
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
    const elPart = Math.abs(el) < 0.05 ? 'no elevation' : `${fmtHold(Math.abs(el))} ${el > 0 ? 'up' : 'down'}`;
    const windPart = Math.abs(wind) < 0.05 ? 'no wind' : `${fmtHold(Math.abs(wind))} ${wind > 0 ? 'right' : 'left'}`;
    const none = elPart === 'no elevation' && windPart === 'no wind';
    const parts = [elPart, windPart].filter((x) => !x.startsWith('no '));
    const holdValue = `${parts.join(', ')} ${unit}`;
    const holdPart = none ? 'no hold' : `hold ${holdValue}`;
    const dEl = (hold.dialedEl || 0) * k;
    const dWind = (hold.dialedWind || 0) * k;
    const dialBits = [];
    if (Math.abs(dEl) >= 0.05) dialBits.push(`${fmtHold(Math.abs(dEl))}${dEl < 0 ? ' down' : Math.abs(dWind) >= 0.05 ? ' up' : ''}`);
    if (Math.abs(dWind) >= 0.05) dialBits.push(`${fmtHold(Math.abs(dWind))} ${dWind > 0 ? 'right' : 'left'}`);
    const dialPart = dialBits.length ? `Dialed ${dialBits.join(', ')} ${unit}` : '';
    return { elPart, windPart, unit, none, holdPart, holdValue, dialPart };
  }

  render() {
    if (!this.ctx || !this.w || !this.h) return;
    const ctx = this.ctx;
    const pal = getPalette();
    const w = this.w;
    const h = this.h;
    this._numFont = pal.font(11, 500);
    this._fine = 1.5; // fine reticle lines (Låda marks are 1.5 to 1.7 px)

    const hold = this._holds();
    const holdText = this._holdText(hold);
    const mag = Math.max(1, Number(this.options.magnification) || 15);

    // Layout: a caption band above and a readout band below the field, so text never covers it
    const narrow = w < 440;
    const valueLines = this._valueLines(holdText, narrow);
    const topBand = 30;
    const bottomBand = 28 + valueLines.length * 18;
    const cx = w / 2;
    const r = Math.max(60, Math.min(w / 2 - 12, (h - topBand - bottomBand) / 2 - 4));
    const cy = topBand + 4 + r;
    this._r = r;

    const { worldPpm, reticlePpm, cal } = this._scales(r);
    const mark = holdMarkPosition(cx, cy, worldPpm, hold.el, hold.wind);

    // The card shows through around the field (flat glass, no fill outside)
    ctx.clearRect(0, 0, w, h);

    // 1. Field of view: a flat, slightly lifted glass disc with a hairline edge
    const field = pal.mix(pal.surface, pal.text, pal.isLight ? 0.03 : 0.045);
    this._field = field;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = field;
    ctx.fill();
    ctx.clip();

    // Muted range rings every 5 MRAD of the scene, like chart gridlines
    ctx.strokeStyle = pal.gridline;
    ctx.lineWidth = pal.stroke.hair;
    for (let m = 5; m * worldPpm < r; m += 5) {
      ctx.beginPath();
      ctx.arc(cx, cy, m * worldPpm, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Target, placed on the hold mark: this is the sight picture when you hold correctly
    this._renderTarget(ctx, pal, mark.x, mark.y, worldPpm);

    // 3. Reticle (text colour, or the muted red token when illuminated; no glow)
    const reticleColor = this.options.illuminated ? this.options.illuminationColor || pal.bad : pal.text;
    ctx.save();
    ctx.strokeStyle = reticleColor;
    ctx.fillStyle = reticleColor;
    ctx.lineWidth = this._fine;
    ctx.lineCap = 'round';
    const ppm = reticlePpm;
    const rType = (this.options.reticleType || '').toLowerCase();
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

    // 4. Hold mark (the accent: the one mark that matters)
    this._renderHoldMark(ctx, pal, mark, cx, cy, r);
    ctx.restore();

    // Field edge
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = pal.stroke.mark;
    ctx.stroke();

    // 5. Captions and readout in the Låda type scale
    this._renderText(ctx, pal, { holdText, valueLines, mag, cal, cy, r, topBand });
    this._updateAriaLabel(holdText, mag);
  }

  /** Readout lines for the band below the field ("Dialed 4.4 MRAD · hold 1.0 right"). */
  _valueLines(holdText, narrow) {
    const { dialPart, holdPart } = holdText;
    // Hold only: the caption already says "Hold", so the value is "4.4 up, 1.0 right MRAD"
    if (!dialPart) return [holdText.none ? 'None needed' : holdText.holdValue];
    const one = `${dialPart} · ${holdPart}`;
    if (!narrow || one.length <= 34) return [one];
    return [dialPart, holdPart.charAt(0).toUpperCase() + holdPart.slice(1)];
  }

  _renderText(ctx, pal, { holdText, valueLines, mag, cal, cy, r, topBand }) {
    const w = this.w;
    const pad = 12;
    const plane = this.options.focalPlane === 'SFP' ? 'SFP' : 'FFP';
    drawLabel(ctx, pal, `Sight picture · ${mag}× ${plane}`, pad, topBand - 10);
    if (plane === 'SFP' && Math.abs(mag - cal) > 0.01) {
      ctx.save();
      ctx.font = pal.font(11, 500);
      ctx.fillStyle = pal.warnText;
      ctx.textAlign = 'right';
      ctx.fillText(`Marks true at ${cal}×`, w - pad, topBand - 10);
      ctx.restore();
    }

    const top = cy + r + 22;
    drawLabel(ctx, pal, holdText.dialPart ? 'Dial and hold' : 'Hold', pad, top);
    ctx.save();
    ctx.font = pal.font(13, 600);
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    let leftW = 0;
    valueLines.forEach((line, i) => {
      ctx.fillText(line, pad, top + 18 + i * 18, w - 2 * pad);
      leftW = Math.max(leftW, ctx.measureText(line).width);
    });
    ctx.restore();

    // Target size in the hold unit (right), only when it fits beside the hold readout
    const sizeText = this._targetSizeText();
    ctx.save();
    ctx.font = pal.font(13, 500);
    const sw = ctx.measureText(sizeText).width;
    ctx.restore();
    if (pad + leftW + 24 + Math.max(sw, 50) <= w - pad) {
      drawLabel(ctx, pal, 'Target', w - pad, top, { align: 'right' });
      ctx.save();
      ctx.font = pal.font(13, 500);
      ctx.fillStyle = pal.muted;
      ctx.textAlign = 'right';
      ctx.fillText(sizeText, w - pad, top + 18);
      ctx.restore();
    }
  }

  /** Angular size of the target in the hold unit, e.g. "0.75 × 1.25 MRAD". */
  _targetSizeText() {
    const isMrad = this._holdUnitIsMrad();
    const k = isMrad ? 1 : MOA_PER_MRAD;
    const d = Math.max(10, this.options.targetDistanceM || 600);
    const a = (cm) => ((cm / 100 / d) * 1000 * k).toFixed(isMrad ? 2 : 1);
    const wcm = this.options.targetWidthCm || 45;
    const hcm = this.options.targetHeightCm || 75;
    const shape = this.options.targetShape || 'ipsc';
    const unit = isMrad ? 'MRAD' : 'MOA';
    return shape === 'circle' ? `${a(wcm)} ${unit} wide` : `${a(wcm)} × ${a(hcm)} ${unit}`;
  }

  _updateAriaLabel(holdText, mag) {
    if (!this.canvas) return;
    const plane = this.options.focalPlane === 'SFP' ? 'second focal plane' : 'first focal plane';
    const yd = this.options.distanceUnit === 'yd';
    const dist = Math.round((this.options.targetDistanceM || 0) * (yd ? 1.0936133 : 1));
    const dial = holdText.dialPart ? `${holdText.dialPart}. ` : '';
    const hold = holdText.none ? 'No hold needed.' : `Hold ${holdText.holdValue}.`;
    this.canvas.setAttribute(
      'aria-label',
      `Reticle view: ${this.options.reticleType} at ${mag}x, ${plane}. Target at ${dist} ${yd ? 'yd' : 'm'}, ${this._targetSizeText()}. ${dial}${hold}`
    );
  }

  /** Target at its true angular size: a flat, neutral shape with a hairline outline. */
  _renderTarget(ctx, pal, targetX, targetY, worldPpm) {
    const distM = Math.max(10, this.options.targetDistanceM || 600);
    const targetW_M = (this.options.targetWidthCm || 45) / 100.0;
    const targetH_M = (this.options.targetHeightCm || 75) / 100.0;

    // Angular size in MRAD = size / distance * 1000
    const pxW = (targetW_M / distM) * 1000.0 * worldPpm;
    const pxH = (targetH_M / distM) * 1000.0 * worldPpm;

    ctx.save();
    ctx.fillStyle = pal.alpha(pal.text, pal.isLight ? 0.1 : 0.14);
    ctx.strokeStyle = pal.alpha(pal.text, 0.5);
    ctx.lineWidth = pal.stroke.mark;
    ctx.lineJoin = 'round';

    const shape = this.options.targetShape || 'ipsc';
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(targetX, targetY, pxW / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (shape === 'square') {
      ctx.beginPath();
      ctx.rect(targetX - pxW / 2, targetY - pxH / 2, pxW, pxH);
      ctx.fill();
      ctx.stroke();
    } else if (shape === 'nato-e') {
      // NATO E-type silhouette: body over the lower 80 %, half-width head over the top 20 %,
      // with sloped shoulders between them (same geometry as the hit test in wez.js)
      const halfW = pxW / 2;
      const halfH = pxH / 2;
      const headHalfW = halfW * 0.5;
      const neckY = targetY - halfH * 0.6;
      const shoulderY = targetY - halfH * 0.42;
      const r = Math.min(headHalfW, halfH * 0.18);
      ctx.beginPath();
      ctx.moveTo(targetX - halfW, targetY + halfH);
      ctx.lineTo(targetX + halfW, targetY + halfH);
      ctx.lineTo(targetX + halfW, shoulderY);
      ctx.lineTo(targetX + headHalfW, neckY);
      ctx.lineTo(targetX + headHalfW, targetY - halfH + r);
      ctx.arcTo(targetX + headHalfW, targetY - halfH, targetX, targetY - halfH, r);
      ctx.arcTo(targetX - headHalfW, targetY - halfH, targetX - headHalfW, targetY - halfH + r, r);
      ctx.lineTo(targetX - headHalfW, neckY);
      ctx.lineTo(targetX - halfW, shoulderY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // IPSC torso: body with a 15 cm head box over the top 20 % (same geometry as wez.js)
      const halfW = pxW / 2;
      const halfH = pxH / 2;
      const headHalfW = halfW * (7.5 / ((this.options.targetWidthCm || 45) / 2));
      const headBottomY = targetY - halfH * 0.6;

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

      // A-zone
      if (pxW > 14) {
        ctx.strokeStyle = pal.alpha(pal.text, 0.3);
        ctx.lineWidth = pal.stroke.hair;
        ctx.beginPath();
        ctx.arc(targetX, targetY - halfH * 0.1, pxW * 0.15, 0, Math.PI * 2);
        ctx.stroke();
      }
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
    ctx.lineWidth = 4;
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
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;
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
    const barWidth = 6;
    // Left bar
    ctx.fillRect(cx - r, cy - barWidth / 2, r - gate, barWidth);
    // Right bar
    ctx.fillRect(cx + gate, cy - barWidth / 2, r - gate, barWidth);
    // Bottom bar
    ctx.fillRect(cx - barWidth / 2, cy + gate, barWidth, r - gate);

    // 2. Fine Center Hairlines (Note: 12 o'clock has fine line extending all the way to top)
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;

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
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;
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
    ctx.lineWidth = this._fine;
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

  /** Accent ring on the hold mark, or an accent chevron at the edge when it is outside the view. */
  _renderHoldMark(ctx, pal, mark, cx, cy, r) {
    const dx = mark.x - cx;
    const dy = mark.y - cy;
    const dist = Math.hypot(dx, dy);
    const inside = dist <= r - 12;
    const halo = pal.alpha(this._field || pal.surface, 0.85);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (inside) {
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 9, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = halo;
      ctx.stroke();
      ctx.lineWidth = pal.stroke.bold;
      ctx.strokeStyle = pal.accent;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 2.25, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent;
      ctx.fill();
    } else {
      const ux = dx / (dist || 1);
      const uy = dy / (dist || 1);
      ctx.translate(cx + ux * (r - 16), cy + uy * (r - 16));
      ctx.rotate(Math.atan2(uy, ux));
      ctx.beginPath();
      ctx.moveTo(-5, -7);
      ctx.lineTo(4, 0);
      ctx.lineTo(-5, 7);
      ctx.lineWidth = 4;
      ctx.strokeStyle = halo;
      ctx.stroke();
      ctx.lineWidth = pal.stroke.bold;
      ctx.strokeStyle = pal.accent;
      ctx.stroke();
    }
    ctx.restore();
  }
}
