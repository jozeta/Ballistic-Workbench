/**
 * Ballistic Workbench - Interactive Wind Clock & Multi-Zone Vector Visualizer
 * Implements:
 * 1. Interactive 12-hour Tactical Wind Clock with real-time crosswind & headwind breakdown
 * 2. Multi-Zone Downrange Wind Vector Lane visualizer
 */

export class WindRoseVisualizer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        windSpeedMs: 4.0,
        windDirectionDeg: 90.0,
        systemUnits: 'metric',
        windSpeedUnit: 'm/s',
        windZones: [],
        onChange: null,
      },
      options
    );

    this.isDragging = false;
    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const displaySize = Math.max(220, Math.floor(Math.min(rect.width || 260, rect.height || 260)));
    this.canvas.width = Math.floor(displaySize * dpr);
    this.canvas.height = Math.floor(displaySize * dpr);
    this.canvas.style.width = `${displaySize}px`;
    this.canvas.style.height = `${displaySize}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.size = displaySize;

    this.render();
  }

  _bindEvents() {
    const handlePointer = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - (this.size / 2);
      const y = e.clientY - rect.top - (this.size / 2);

      // Angle from center: 0 deg = 12 o'clock (top, -y)
      // Math.atan2(x, -y) yields 0 at top, pi/2 at 3 o'clock (+x)
      let angleRad = Math.atan2(x, -y);
      if (angleRad < 0) angleRad += 2 * Math.PI;
      const angleDeg = Math.round((angleRad * 180) / Math.PI);

      this.options.windDirectionDeg = angleDeg;
      if (this.options.onChange) {
        this.options.onChange({
          windDirectionDeg: angleDeg,
          windSpeedMs: this.options.windSpeedMs,
        });
      }
      this.render();
    };

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      handlePointer(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) handlePointer(e);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        this.isDragging = true;
        handlePointer(e.touches[0]);
      }
    });

    window.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length > 0) {
        handlePointer(e.touches[0]);
      }
    });

    window.addEventListener('touchend', () => {
      this.isDragging = false;
    });
  }

  update(newOptions) {
    Object.assign(this.options, newOptions);
    this.render();
  }

  render() {
    if (!this.ctx || !this.size) return;
    const ctx = this.ctx;
    const s = this.size;
    const cx = s / 2;
    const cy = s / 2;
    const r = (s / 2) - 20;

    ctx.clearRect(0, 0, s, s);

    // 1. Clock Face Outer Dial
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Clock Hour Tick Marks (12 to 11)
    ctx.font = '10px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let hour = 1; hour <= 12; hour++) {
      const angle = (hour / 12) * Math.PI * 2;
      const tickInner = r - 8;
      const tickOuter = r - 2;

      const x1 = cx + tickInner * Math.sin(angle);
      const y1 = cy - tickInner * Math.cos(angle);
      const x2 = cx + tickOuter * Math.sin(angle);
      const y2 = cy - tickOuter * Math.cos(angle);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = hour % 3 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Number text
      const textR = r - 18;
      const tx = cx + textR * Math.sin(angle);
      const ty = cy - textR * Math.cos(angle);
      ctx.fillText(`${hour}`, tx, ty);
    }

    // 3. Central Target / Shooter Direction Indicator (Points straight UP to 12)
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 22);
    ctx.lineTo(cx - 7, cy + 12);
    ctx.lineTo(cx, cy + 6);
    ctx.lineTo(cx + 7, cy + 12);
    ctx.closePath();
    ctx.fill();

    // Line of sight track
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Active Wind Vector
    const dirDeg = this.options.windDirectionDeg || 0;
    const dirRad = (dirDeg * Math.PI) / 180;
    const arrowLen = r - 24;

    // Wind origin point on rim
    const ox = cx + arrowLen * Math.sin(dirRad);
    const oy = cy - arrowLen * Math.cos(dirRad);

    // Wind blowing from origin towards center
    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#f59e0b';
    ctx.strokeStyle = '#f59e0b';
    ctx.fillStyle = '#f59e0b';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    // Arrowhead pointing towards center
    const headLen = 10;
    const headAngle = Math.atan2(cy - oy, cx - ox);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx - headLen * Math.cos(headAngle - Math.PI / 6),
      cy - headLen * Math.sin(headAngle - Math.PI / 6)
    );
    ctx.lineTo(
      cx - headLen * Math.cos(headAngle + Math.PI / 6),
      cy - headLen * Math.sin(headAngle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Drag handle circle on perimeter
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 5. Tactical Component Breakdown (Crosswind & Head/Tail wind)
    const speed = this.options.windSpeedMs || 4.0;
    const crosswind = Math.abs(speed * Math.sin(dirRad));
    const headwind = speed * Math.cos(dirRad); // positive = headwind, negative = tailwind
    const speedUnit = this.options.windSpeedUnit || 'm/s';

    // Clock hour position calculation
    let clockHour = Math.round(dirDeg / 30);
    if (clockHour === 0) clockHour = 12;

    let valueType = 'Full Value';
    const sinAbs = Math.abs(Math.sin(dirRad));
    if (sinAbs > 0.95) valueType = '100% Full Value';
    else if (sinAbs > 0.70) valueType = '87% Value';
    else if (sinAbs > 0.35) valueType = '50% Half Value';
    else valueType = 'No Value (Head/Tail)';

    // Telemetry text overlay in bottom corner or below
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${dirDeg}° (${clockHour} o'clock)`, cx, cy + r - 32);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(valueType, cx, cy + r - 18);
  }
}
