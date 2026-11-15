/**
 * Ballistic Workbench - Interactive Tactical Elevation Turret Simulator
 * High-DPI canvas elevation turret knob with:
 * - Knurled rotary dial with physical graduation marks (0.1 click ticks, 0.5 medium, 1.0 major + numbers)
 * - Mouse drag & wheel tactile rotation
 * - Web Audio API synthesized mechanical detent clicks
 * - Bidirectional coupling with reticle holdover & profile dial clicks
 */

export class TurretKnob {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        clicks: 0, // Current dialed elevation clicks
        clickValueRad: 0.0001, // 0.1 MRAD per click
        clickName: '0.1 MRAD',
        isMrad: true,
        targetClicks: 0, // Target holdover clicks needed
        maxClicks: 150, // 15 MRAD (1.5 revolutions)
        minClicks: 0,
        clicksPerRev: 100, // 10 MRAD per revolution
        onChange: null, // Callback when clicks change
      },
      options
    );

    this.isDragging = false;
    this.dragStartY = 0;
    this.dragStartClicks = 0;
    this.audioCtx = null;

    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Use container dimension or sensible default with compact flexibility
    const displaySize = Math.max(80, Math.floor(Math.min(rect.width || 140, (rect.height || 120) - 10)));
    this.canvas.width = Math.floor(displaySize * dpr);
    this.canvas.height = Math.floor(displaySize * dpr);
    this.canvas.style.width = `${displaySize}px`;
    this.canvas.style.height = `${displaySize}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.size = displaySize;

    this.render();
  }

  _initAudio() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          this.audioCtx = new AudioContextClass();
        } catch (e) {
          // Audio context might be restricted before user gesture
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  playClickSound() {
    try {
      this._initAudio();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      // Synthesize realistic precision metal detent click
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const filter = this.audioCtx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3200, now);
      filter.Q.setValueAtTime(3.0, now);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(3600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.012);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.014);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.015);
    } catch (e) {
      // Audio playback fails silently in non-interactive tests
    }
  }

  setClicks(clicks, emitChange = true) {
    const clamped = Math.max(this.options.minClicks, Math.min(this.options.maxClicks, Math.round(clicks)));
    if (clamped !== this.options.clicks) {
      const oldClicks = this.options.clicks;
      this.options.clicks = clamped;
      this.playClickSound();
      this.render();
      if (emitChange && this.options.onChange) {
        this.options.onChange(clamped, oldClicks);
      }
    }
  }

  adjustClicks(delta) {
    this.setClicks(this.options.clicks + delta, true);
  }

  update(newOptions) {
    Object.assign(this.options, newOptions);
    this.render();
  }

  _bindEvents() {
    // Mouse Drag Interaction
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartY = e.clientY;
      this.dragStartClicks = this.options.clicks;
      this._initAudio();
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      // 6 pixels drag = 1 click detent
      const diffY = this.dragStartY - e.clientY;
      const deltaClicks = Math.round(diffY / 6);
      this.setClicks(this.dragStartClicks + deltaClicks, true);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Touch Drag Interaction
    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          this.isDragging = true;
          this.dragStartY = e.touches[0].clientY;
          this.dragStartClicks = this.options.clicks;
          this._initAudio();
        }
      },
      { passive: true }
    );

    window.addEventListener(
      'touchmove',
      (e) => {
        if (!this.isDragging || e.touches.length !== 1) return;
        const diffY = this.dragStartY - e.touches[0].clientY;
        const deltaClicks = Math.round(diffY / 7);
        this.setClicks(this.dragStartClicks + deltaClicks, true);
      },
      { passive: true }
    );

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    // Mouse Wheel Interaction
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this._initAudio();
        const dir = e.deltaY < 0 ? 1 : -1;
        this.adjustClicks(dir);
      },
      { passive: false }
    );

    // Dynamic resize via ResizeObserver on parent
    if (window.ResizeObserver && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.canvas.parentElement);
    }
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  render() {
    if (!this.ctx || !this.size) return;
    const ctx = this.ctx;
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;
    const r = s / 2 - 8;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    // Background clearing
    ctx.clearRect(0, 0, s, s);

    // Turret rotation angle: 1 revolution = clicksPerRev (e.g. 100 clicks = 10 MRAD)
    // Clicks increase clockwise
    const rotAngle = (this.options.clicks / this.options.clicksPerRev) * Math.PI * 2;

    // 1. Outer Knurled Grip Ring (machined serrations)
    ctx.save();
    ctx.translate(cx, cy);

    const outerR = r;
    const innerR = r - 12;

    // Outer knurling notches
    const notchCount = 48;
    for (let i = 0; i < notchCount; i++) {
      const a = (i / notchCount) * Math.PI * 2 + rotAngle;
      ctx.beginPath();
      ctx.strokeStyle = isLight ? '#94a3b8' : '#334155';
      ctx.lineWidth = 2.5;
      ctx.moveTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
      ctx.lineTo(Math.cos(a) * outerR, Math.sin(a) * outerR);
      ctx.stroke();
    }

    // 2. Beveled Turret Dial Rim
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(0, 0, innerR * 0.4, 0, 0, innerR);
    if (isLight) {
      grad.addColorStop(0, '#e2e8f0');
      grad.addColorStop(0.8, '#cbd5e1');
      grad.addColorStop(1, '#94a3b8');
    } else {
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(0.8, '#0f172a');
      grad.addColorStop(1, '#020617');
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = isLight ? '#94a3b8' : '#475569';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3. Dial Graduation Tick Marks & Numerals
    // Draw 100 clicks (10 MRAD or 25 MOA) around perimeter
    const totalTicks = this.options.clicksPerRev;
    for (let i = 0; i < totalTicks; i++) {
      // Angle relative to rotation: 0 click aligns with 12 o'clock (-PI/2) when clicks=0
      const angle = (i / totalTicks) * Math.PI * 2 - Math.PI / 2 - rotAngle;

      const isMajor = i % 10 === 0; // 1.0 MRAD
      const isMedium = i % 5 === 0 && !isMajor; // 0.5 MRAD
      const tickLen = isMajor ? 9 : isMedium ? 6 : 3.5;

      const p1R = innerR - 2;
      const p2R = innerR - 2 - tickLen;

      ctx.beginPath();
      ctx.strokeStyle = isMajor
        ? (isLight ? '#0f172a' : '#f8fafc')
        : isMedium
        ? (isLight ? '#475569' : '#cbd5e1')
        : (isLight ? '#94a3b8' : '#64748b');
      ctx.lineWidth = isMajor ? 1.5 : 1;
      ctx.moveTo(Math.cos(angle) * p1R, Math.sin(angle) * p1R);
      ctx.lineTo(Math.cos(angle) * p2R, Math.sin(angle) * p2R);
      ctx.stroke();

      // Numerals at major ticks (0, 1, 2, ... 9)
      if (isMajor && s >= 160) {
        const textR = innerR - 18;
        const tx = Math.cos(angle) * textR;
        const ty = Math.sin(angle) * textR;

        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(angle + Math.PI / 2);
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = i === 0 ? (isLight ? '#dc2626' : '#ef4444') : isLight ? '#0f172a' : '#f1f5f9';
        const isMradOpt = this.options.isMrad !== false;
        const majorNum = isMradOpt ? `${i / 10}` : `${(i * 0.25).toFixed(0)}`;
        ctx.fillText(majorNum, 0, 0);
        ctx.restore();
      }
    }

    // 4. Center Turret Cap
    const centerR = innerR * 0.44;
    ctx.beginPath();
    ctx.arc(0, 0, centerR, 0, Math.PI * 2);
    ctx.fillStyle = isLight ? '#f1f5f9' : '#0b0f17';
    ctx.fill();
    ctx.strokeStyle = isLight ? '#cbd5e1' : '#334155';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center Label: Elevation Value & UP arrow
    const isMrad = this.options.isMrad !== false;
    const dialedMrad = this.options.clicks * (this.options.clickValueRad || 0.0001) * 1000;
    const dialedVal = isMrad ? dialedMrad.toFixed(1) : (dialedMrad * ((180 * 60) / (Math.PI * 1000))).toFixed(1);
    ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${dialedVal}`, 0, -5);

    ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
    ctx.font = '8px sans-serif';
    ctx.fillText(`${isMrad ? 'MRAD' : 'MOA'} UP`, 0, 8);

    ctx.restore();

    // 5. Index Pointer Mark at 12 o'clock (Fixed Reference Triangle)
    ctx.save();
    ctx.fillStyle = isLight ? '#dc2626' : '#ef4444';
    ctx.beginPath();
    ctx.moveTo(cx, 1);
    ctx.lineTo(cx - 5, 8);
    ctx.lineTo(cx + 5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
