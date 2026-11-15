/**
 * Ballistic Workbench - High-DPI Canvas Reticle & Holdover Engine
 * Implements:
 * - FFP (First Focal Plane) & SFP (Second Focal Plane) optical magnification simulation
 * - 9 Precision Tactical, Competition, and Hunting Reticles:
 *   1. Vortex EBR-8 MRAD / EBR-8 (Christmas tree with 0.2 mil wind dots)
 *   2. Kahles SKMR4 (PRS match floating dot, 0.2 mil sub-hashes, holdover tree)
 *   3. Leupold PR2-MIL (Clean PRS / NRL competition 0.25 mil stadia)
 *   4. Vortex EBR-2C MOA (Calibrated Minutes of Angle drop grid)
 *   5. German #4 (Classic European 3-post heavy duplex hunting reticle)
 *   6. Primary Arms ACSS DMR (Horseshoe CQB, Chevron tip, BDC ladder & wind leads)
 *   7. Nightforce Mil-XT (Precision floating center dot & Christmas tree)
 *   8. Horus Tremor3 (Horus wind dots & speed brackets)
 *   9. USMC / Army Mil-Dot (Classic tactical mil-dot with thick duplex stadium posts)
 * - Scaled Target Projection (IPSC, Steel Gong, Square Plate, NATO-E)
 * - Glowing ballistic impact pip with dialed vs holdover overlay
 * - Day / Night illuminated reticle toggle
 * - Dynamic high-DPI scaling with ResizeObserver
 */

export class ReticleRenderer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        reticleType: 'EBR-8 MRAD', // 'EBR-8 MRAD' | 'Kahles SKMR4' | 'Leupold PR2-MIL' | 'EBR-2C MOA' | 'German #4' | 'ACSS DMR' | 'Tremor3' | 'Mil-XT' | 'Mil-Dot'
        focalPlane: 'FFP', // 'FFP' | 'SFP'
        magnification: 15,
        calibratedMag: 20, // Calibrated zoom for SFP
        targetDistanceM: 600,
        targetShape: 'ipsc', // 'ipsc' | 'circle' | 'square' | 'nato-e'
        targetWidthCm: 45,
        targetHeightCm: 75,
        elevationHoldMrad: 3.5, // Holdover needed (MRAD)
        windageHoldMrad: -1.2, // Windage hold needed (MRAD)
        elevationDialClicks: 0,
        windageDialClicks: 0,
        clickValueRad: 0.0001, // 0.1 MRAD
        illuminated: false, // Day black / Night glowing red or green
        illuminationColor: '#ef4444', // Red illumination
      },
      options
    );

    this.resizeObserver = null;
    this.bindEvents();
    this.resize();
  }

  bindEvents() {
    // Dynamic resize via ResizeObserver on parent container
    if (window.ResizeObserver && this.canvas?.parentElement) {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
      }
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.canvas.parentElement);
    }

    if (!this._hasWindowResize) {
      window.addEventListener('resize', () => this.resize());
      this._hasWindowResize = true;
    }
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Fill 100% of parent container dynamically with high-DPI scaling
    const displayWidth = Math.max(200, Math.floor(rect.width || 360));
    const displayHeight = Math.max(200, Math.floor(rect.height || 360));

    this.canvas.width = Math.floor(displayWidth * dpr);
    this.canvas.height = Math.floor(displayHeight * dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.w = displayWidth;
    this.h = displayHeight;
    this.size = Math.min(displayWidth, displayHeight);

    this.render();
  }

  update(newOptions) {
    Object.assign(this.options, newOptions);
    this.render();
  }

  render() {
    if (!this.ctx || !this.w || !this.h) return;
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const s = this.size;
    const cx = w / 2;
    const cy = h / 2;
    const r = s / 2 - 10; // Scope optical ocular boundary radius

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const subcardBg = isLight ? '#f8fafc' : '#172133';

    // 1. Draw Scope Housing / Eyepiece Bell (matching container background exactly)
    ctx.save();
    ctx.fillStyle = subcardBg;
    ctx.fillRect(0, 0, w + 2, h + 2);

    // Circular scope FOV clip
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Sight picture background (outdoor tactical field gradient)
    const skyGrad = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    if (isLight) {
      skyGrad.addColorStop(0, '#bae6fd'); // Daylight sky
      skyGrad.addColorStop(0.5, '#7dd3fc');
      skyGrad.addColorStop(0.51, '#86efac'); // Sunny berm grass
      skyGrad.addColorStop(1, '#4ade80');
    } else {
      skyGrad.addColorStop(0, '#1e293b'); // Horizon sky
      skyGrad.addColorStop(0.5, '#172554');
      skyGrad.addColorStop(0.51, '#14532d'); // Range berm terrain
      skyGrad.addColorStop(1, '#0f172a');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w + 2, h + 2);

    // Compute angular scaling: Pixels per MRAD
    // At 15x zoom, standard FOV across scope ocular is ~10 MRAD radius (20 MRAD total width)
    const basePixelsPerMrad = r / 10.0;
    let scaleMultiplier = 1.0;

    if (this.options.focalPlane === 'FFP') {
      // In FFP, higher zoom increases reticle and target scale simultaneously
      scaleMultiplier = this.options.magnification / 15.0;
    } else {
      // In SFP, target scales with zoom, but reticle subtension matches calibrated magnification
      scaleMultiplier = 1.0;
    }

    const pixelsPerMrad = basePixelsPerMrad * scaleMultiplier;

    // 2. Render Scaled Target Downrange
    this._renderTarget(ctx, cx, cy, pixelsPerMrad);

    // 3. Render Reticle Graticule (Subtensions)
    const reticleColor = this.options.illuminated
      ? this.options.illuminationColor
      : isLight
      ? '#0f172a'
      : '#090d16';
    ctx.strokeStyle = reticleColor;
    ctx.fillStyle = reticleColor;
    ctx.lineWidth = 1;

    const rType = (this.options.reticleType || '').toLowerCase();
    if (rType.includes('skmr4')) {
      this._renderSkMr4(ctx, cx, cy, pixelsPerMrad, reticleColor, r);
    } else if (rType.includes('pr2')) {
      this._renderPr2Mil(ctx, cx, cy, pixelsPerMrad, reticleColor, r);
    } else if (rType.includes('ebr-2c') || rType.includes('moa')) {
      this._renderEbr2cMoa(ctx, cx, cy, pixelsPerMrad, reticleColor, r);
    } else if (rType.includes('german')) {
      this._renderGerman4(ctx, cx, cy, pixelsPerMrad, reticleColor, r);
    } else if (rType.includes('acss')) {
      this._renderAcssDmr(ctx, cx, cy, pixelsPerMrad, reticleColor, r);
    } else if (rType.includes('tremor')) {
      this._renderTremor3(ctx, cx, cy, pixelsPerMrad, reticleColor);
    } else if (rType.includes('mil-xt')) {
      this._renderMilXT(ctx, cx, cy, pixelsPerMrad, reticleColor);
    } else if (rType.includes('mil-dot') || rType.includes('mildot')) {
      this._renderMilDot(ctx, cx, cy, pixelsPerMrad, reticleColor, r);
    } else {
      // Vortex EBR-8 MRAD (default)
      this._renderEbr8(ctx, cx, cy, pixelsPerMrad, reticleColor);
    }

    // 4. Render Active Ballistic Pip (Hold Point)
    this._renderHoldPip(ctx, cx, cy, pixelsPerMrad);

    // 5. Scope Vignette Ring & Turret Dial Telemetry Badge
    ctx.restore();

    // Dark scope ocular ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 14;
    ctx.strokeStyle = isLight ? '#475569' : '#020617';
    ctx.stroke();

    // Scope inner bevel
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#94a3b8' : '#334155';
    ctx.stroke();

    // Magnification & Focal Plane Badge
    ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(16, 16, 130, 48, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.options.magnification}X [${this.options.focalPlane}]`, 24, 34);

    ctx.fillStyle = isLight ? '#334155' : '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`${this.options.reticleType}`, 24, 50);
  }

  _renderTarget(ctx, cx, cy, pixelsPerMrad) {
    const distM = Math.max(50, this.options.targetDistanceM || 600);
    const targetW_M = (this.options.targetWidthCm || 45) / 100.0;
    const targetH_M = (this.options.targetHeightCm || 75) / 100.0;

    // Angular dimensions in MRAD: theta = (Dimension / Distance) * 1000
    const mradW = (targetW_M / distM) * 1000.0;
    const mradH = (targetH_M / distM) * 1000.0;

    // If SFP, target scales with magnification independently of reticle
    const sfpZoomFactor =
      this.options.focalPlane === 'SFP' ? this.options.magnification / this.options.calibratedMag : 1.0;

    const pxW = mradW * pixelsPerMrad * sfpZoomFactor;
    const pxH = mradH * pixelsPerMrad * sfpZoomFactor;

    // Target is centered on optical axis
    const targetX = cx;
    const targetY = cy;

    ctx.save();
    ctx.fillStyle = '#f8fafc'; // White painted steel target
    ctx.strokeStyle = '#0f172a';
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
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
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
    const r = scopeRadius || this.size / 2 - 10;
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
    const r = scopeRadius || this.size / 2 - 10;
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
        ctx.font = '8px monospace';
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
        ctx.font = '8px monospace';
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
    const r = scopeRadius || this.size / 2 - 10;
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
      ctx.font = '8px monospace';
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
    const r = scopeRadius || this.size / 2 - 10;
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
        ctx.font = '8px monospace';
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

      ctx.font = '8px monospace';
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
    const r = scopeRadius || this.size / 2 - 10;
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
    const r = scopeRadius || this.size / 2 - 10;

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
      ctx.font = '8px monospace';
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

  _renderEbr8(ctx, cx, cy, ppm, color) {
    const postThick = 2.5;
    ctx.lineWidth = postThick;
    ctx.strokeStyle = color;

    // Outer thick stadia
    const outerGap = 10 * ppm;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(cx - outerGap, cy);
    ctx.moveTo(cx + outerGap, cy);
    ctx.lineTo(this.size, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, cy - outerGap);
    ctx.moveTo(cx, cy + 12 * ppm);
    ctx.lineTo(cx, this.size);
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
        ctx.font = '9px monospace';
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

      ctx.font = '9px monospace';
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
        ctx.font = '9px monospace';
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
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${drop}`, cx + 6, y + 3);
      }
    }
  }

  _renderHoldPip(ctx, cx, cy, ppm) {
    const dialedElMrad = (this.options.elevationDialClicks || 0) * (this.options.clickValueRad || 0.0001) * 1000;
    const dialedWindMrad = (this.options.windageDialClicks || 0) * (this.options.clickValueRad || 0.0001) * 1000;
    const remElHold = (this.options.elevationHoldMrad || 0) - dialedElMrad;
    const remWindHold = (this.options.windageHoldMrad || 0) - dialedWindMrad;

    // Pip location on reticle:
    // Drop is down (+y on canvas)
    // Left wind drift requires holding right (+x)
    const pipX = cx + remWindHold * ppm;
    const pipY = cy + remElHold * ppm;

    // Glowing impact pip
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#38bdf8';

    // Outer ring
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pipX, pipY, 6, 0, Math.PI * 2);
    ctx.stroke();

    // Center illuminated pip
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(pipX, pipY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Floating text label with exact hold subtensions
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    const isMrad = this.options.isMrad !== false && !this.options.reticleType?.toLowerCase().includes('moa');
    const elHoldVal = isMrad ? remElHold : remElHold * 3.43775;
    const windHoldVal = isMrad ? Math.abs(remWindHold) : Math.abs(remWindHold) * 3.43775;
    const unitStr = isMrad ? 'MRAD' : 'MOA';
    const holdText = `▲ ${elHoldVal.toFixed(2)} | ${remWindHold >= 0 ? '▶' : '◀'} ${windHoldVal.toFixed(2)} ${unitStr}`;
    ctx.font = 'bold 11px monospace';
    const txtW = ctx.measureText(holdText).width;

    ctx.beginPath();
    ctx.roundRect(pipX + 10, pipY - 12, txtW + 12, 22, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#d97706';
    ctx.textAlign = 'left';
    ctx.fillText(holdText, pipX + 16, pipY + 3);
  }
}
