/**
 * Ballistic Workbench - trajectory chart (canvas)
 * Five views of one solved trajectory, drawn with the Låda Glass tokens so the chart follows the
 * active theme:
 *   drop     - drop below the line of sight and the elevation to dial, with zero and apex marks
 *   velocity - remaining velocity with the transonic and subsonic bands
 *   wind     - wind correction (angle)
 *   lead     - time of flight
 *   energy   - remaining energy with common minimums for deer and elk as a guide
 * Series never rely on colour alone: each has its own dash pattern and is named in the legend.
 *
 * Public API (used by src/ui/workspace.js):
 *   new BallisticChart(canvas, { activeTab, systemUnits, displayUnits, onHover })
 *   .setUnits(system, displayUnits) .setData(trajectory, telemetry) .setTab(name)
 *   .setHoverDistance(distM) .resize() .render() .destroy()
 */

import { UnitConverter, CONVERSIONS } from '../core/units.js';
import { getPalette } from './palette.js';

const DASH = {
  solid: [],
  dashed: [7, 4],
  dotted: [2, 4],
  guide: [4, 4],
};

const TAB_NAMES = {
  drop: 'Drop',
  velocity: 'Velocity',
  wind: 'Wind drift',
  lead: 'Time of flight',
  energy: 'Energy',
};

/** Formats a number without ever showing "-0.00". */
export function fmtNum(value, decimals = 0) {
  if (!Number.isFinite(value)) return '--';
  const s = value.toFixed(decimals);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** A "nice" tick step (1, 2, 2.5 or 5 x 10^n) that splits `range` into about `count` parts. */
function niceStep(range, count) {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** Nice axis bounds and ticks covering [min, max]. */
function niceAxis(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2, ticks: [0, 1] };
  if (max - min < 1e-9) {
    max = min + 1;
  }
  const step = niceStep(max - min, count);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 0.5; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return { min: lo, max: hi, step, ticks };
}

function decimalsFor(step) {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

export class BallisticChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        activeTab: 'drop', // 'drop' | 'velocity' | 'wind' | 'lead' | 'energy'
        systemUnits: 'metric',
        displayUnits: UnitConverter.getSystemDefaults('metric'),
        onHover: null,
      },
      options
    );

    this.trajectory = [];
    this.telemetry = {};
    this.hoverDistance = null;
    this.padding = { top: 40, right: 56, bottom: 44, left: 60 };
    this.resizeObserver = null;
    this._handlers = {};

    if (!this.canvas.getAttribute('role')) this.canvas.setAttribute('role', 'img');

    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.max(260, Math.floor(rect.width || 600));
    const displayHeight = Math.max(220, Math.floor(rect.height || 340));

    const pw = Math.floor(displayWidth * dpr);
    const ph = Math.floor(displayHeight * dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = displayWidth;
    this.h = displayHeight;
    this.render();
  }

  _bindEvents() {
    const h = this._handlers;

    h.move = (e) => {
      if (!this.w) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const { left, right } = this.padding;
      if (x >= left && x <= this.w - right && this.trajectory.length > 1) {
        const frac = (x - left) / (this.w - left - right);
        this.hoverDistance = frac * this.trajectory[this.trajectory.length - 1].distanceM;
        if (this.options.onHover) this.options.onHover(this.hoverDistance);
        this.render();
      } else if (this.hoverDistance !== null) {
        h.leave();
      }
    };
    h.leave = () => {
      if (this.hoverDistance === null) return;
      this.hoverDistance = null;
      if (this.options.onHover) this.options.onHover(null);
      this.render();
    };

    this.canvas.addEventListener('pointermove', h.move);
    this.canvas.addEventListener('pointerdown', h.move);
    this.canvas.addEventListener('pointerleave', h.leave);
    this.canvas.addEventListener('pointercancel', h.leave);

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    } else {
      h.resize = () => this.resize();
      window.addEventListener('resize', h.resize);
    }
  }

  destroy() {
    const h = this._handlers;
    if (this.canvas) {
      this.canvas.removeEventListener('pointermove', h.move);
      this.canvas.removeEventListener('pointerdown', h.move);
      this.canvas.removeEventListener('pointerleave', h.leave);
      this.canvas.removeEventListener('pointercancel', h.leave);
    }
    if (h.resize) window.removeEventListener('resize', h.resize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this._handlers = {};
    this.options.onHover = null;
  }

  setHoverDistance(distM) {
    this.hoverDistance = distM;
    this.render();
  }

  setData(trajectoryData, telemetryData = {}) {
    this.trajectory = Array.isArray(trajectoryData) ? trajectoryData : [];
    this.telemetry = telemetryData || {};
    this._updateAriaLabel();
    this.render();
  }

  setTab(tabName) {
    if (!TAB_NAMES[tabName]) return;
    this.options.activeTab = tabName;
    this.hoverDistance = null;
    this._updateAriaLabel();
    this.render();
  }

  setUnits(system, displayUnits) {
    this.options.systemUnits = system;
    this.options.displayUnits = displayUnits || UnitConverter.getSystemDefaults(system);
    this._updateAriaLabel();
    this.render();
  }

  // ---- units -------------------------------------------------------------------------------------

  _units() {
    const du = this.options.displayUnits || {};
    const isMetric = this.options.systemUnits !== 'imperial';
    const distUnit = CONVERSIONS[du.distance] ? du.distance : isMetric ? 'm' : 'yd';
    const dropUnit = CONVERSIONS[du.dropOffset] ? du.dropOffset : isMetric ? 'cm' : 'in';
    const driftUnit = CONVERSIONS[du.windDriftOffset] ? du.windDriftOffset : dropUnit;
    const velUnit = CONVERSIONS[du.velocity] ? du.velocity : isMetric ? 'm/s' : 'fps';
    const energyUnit = CONVERSIONS[du.energy] ? du.energy : isMetric ? 'J' : 'ft-lb';
    const elevMoa = du.elevationAngle === 'MOA';
    const windMoa = du.windageAngle === 'MOA';
    return {
      distUnit,
      dropUnit,
      driftUnit,
      velUnit,
      energyUnit,
      energyLabel: energyUnit === 'ft-lb' ? 'ft·lb' : energyUnit,
      elevUnit: elevMoa ? 'MOA' : 'MRAD',
      windUnit: windMoa ? 'MOA' : 'MRAD',
      dist: (m) => m / CONVERSIONS[distUnit],
      drop: (m) => m / CONVERSIONS[dropUnit],
      drift: (m) => m / CONVERSIONS[driftUnit],
      vel: (ms) => ms / CONVERSIONS[velUnit],
      energy: (j) => j / CONVERSIONS[energyUnit],
      elev: (p) => (elevMoa ? p.elevationMoa : p.elevationMrad),
      wind: (p) => (windMoa ? p.windageMoa : p.windageMrad),
    };
  }

  /** Builds the series definition for the active tab. */
  _seriesFor(tab, u) {
    const traj = this.trajectory;
    if (tab === 'velocity') {
      return {
        main: { label: `Velocity (${u.velUnit})`, values: traj.map((p) => u.vel(p.velocityMs)), unit: u.velUnit, dec: 0 },
        floorZero: true,
      };
    }
    if (tab === 'wind') {
      return {
        main: { label: `Wind (${u.windUnit})`, values: traj.map((p) => Math.abs(u.wind(p))), unit: u.windUnit, dec: 2 },
        floorZero: true,
      };
    }
    if (tab === 'lead') {
      return {
        main: { label: 'Time of flight (s)', values: traj.map((p) => p.tofS), unit: 's', dec: 2 },
        floorZero: true,
      };
    }
    if (tab === 'energy') {
      return {
        main: { label: `Energy (${u.energyLabel})`, values: traj.map((p) => u.energy(p.energyJ)), unit: u.energyLabel, dec: 0 },
        floorZero: true,
      };
    }
    return null;
  }

  _updateAriaLabel() {
    if (!this.canvas) return;
    const traj = this.trajectory;
    const tab = this.options.activeTab;
    if (!traj || traj.length < 2) {
      this.canvas.setAttribute('aria-label', 'Trajectory chart. No trajectory calculated yet.');
      return;
    }
    const u = this._units();
    const last = traj[traj.length - 1];
    const range = `${fmtNum(u.dist(last.distanceM))} ${u.distUnit}`;
    let summary = '';
    if (tab === 'drop') {
      summary = `At ${range} the bullet drops ${fmtNum(Math.abs(u.drop(last.dropM)), 0)} ${u.dropUnit} and needs ${fmtNum(u.elev(last), 1)} ${u.elevUnit} of elevation.`;
    } else if (tab === 'velocity') {
      summary = `Velocity falls from ${fmtNum(u.vel(traj[0].velocityMs))} to ${fmtNum(u.vel(last.velocityMs))} ${u.velUnit} at ${range} (Mach ${fmtNum(last.mach, 2)}).`;
    } else if (tab === 'wind') {
      summary = `Wind correction at ${range}: ${fmtNum(Math.abs(u.wind(last)), 2)} ${u.windUnit}.`;
    } else if (tab === 'lead') {
      summary = `Time of flight to ${range}: ${fmtNum(last.tofS, 2)} s.`;
    } else if (tab === 'energy') {
      summary = `Energy falls from ${fmtNum(u.energy(traj[0].energyJ))} to ${fmtNum(u.energy(last.energyJ))} ${u.energyLabel} at ${range}.`;
    }
    this.canvas.setAttribute(
      'aria-label',
      `${TAB_NAMES[tab] || 'Trajectory'} chart, 0 to ${range}. ${summary} The range table has the same data as text.`
    );
  }

  // ---- drawing helpers ---------------------------------------------------------------------------

  /** Lays out the legend (wrapping on narrow canvases) and returns the rows height. */
  _layoutLegend(ctx, pal, items) {
    ctx.font = pal.font(12, 500);
    const gap = 16;
    const sample = 22;
    const maxW = this.w - 16;
    const rows = [[]];
    let x = 0;
    for (const it of items) {
      const iw = sample + 6 + ctx.measureText(it.label).width;
      if (x > 0 && x + iw > maxW) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1].push({ ...it, x, iw });
      x += iw + gap;
    }
    return { rows, sample, height: rows.length * 18 };
  }

  _drawLegend(ctx, pal, layout) {
    ctx.save();
    ctx.font = pal.font(12, 500);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    layout.rows.forEach((row, ri) => {
      const y = 12 + ri * 18;
      for (const it of row) {
        const x0 = 8 + it.x;
        if (it.swatch) {
          ctx.fillStyle = it.swatch;
          ctx.strokeStyle = it.color;
          ctx.lineWidth = 1;
          ctx.fillRect(x0, y - 5, layout.sample, 10);
          ctx.strokeRect(x0 + 0.5, y - 4.5, layout.sample - 1, 9);
        } else {
          ctx.strokeStyle = it.color;
          ctx.lineWidth = it.width || 2;
          ctx.setLineDash(it.dash || []);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x0 + layout.sample, y);
          ctx.stroke();
          ctx.setLineDash([]);
          if (it.marker) {
            ctx.fillStyle = it.color;
            ctx.beginPath();
            ctx.arc(x0 + layout.sample / 2, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = pal.text;
        ctx.fillText(it.label, x0 + layout.sample + 6, y + 0.5);
      }
    });
    ctx.restore();
  }

  _drawXAxis(ctx, pal, u, maxDistM, getX, plotBottom) {
    const { padding } = this;
    const plotW = this.w - padding.left - padding.right;
    const maxDisp = u.dist(maxDistM);
    const step = niceStep(maxDisp, Math.max(2, Math.floor(plotW / 70)));
    ctx.save();
    ctx.font = pal.monoFont(11);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let d = 0; d <= maxDisp + 1e-6; d += step) {
      const x = getX(d * CONVERSIONS[u.distUnit]);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, padding.top);
      ctx.lineTo(Math.round(x) + 0.5, plotBottom);
      ctx.stroke();
      ctx.fillStyle = pal.muted;
      ctx.fillText(fmtNum(d, decimalsFor(step)), x, plotBottom + 6);
    }
    ctx.font = pal.font(12);
    ctx.fillStyle = pal.muted;
    ctx.fillText(`Distance (${u.distUnit})`, padding.left + plotW / 2, plotBottom + 24);
    ctx.restore();
  }

  /** Horizontal grid + left tick labels for an axis built with niceAxis. */
  _drawYGrid(ctx, pal, axis, getY, side = 'left', withGrid = true) {
    const { padding } = this;
    const plotRight = this.w - padding.right;
    const dec = decimalsFor(axis.step);
    ctx.save();
    ctx.font = pal.monoFont(11);
    ctx.textBaseline = 'middle';
    for (const v of axis.ticks) {
      const y = Math.round(getY(v)) + 0.5;
      if (withGrid) {
        ctx.strokeStyle = v === 0 ? pal.line2 : pal.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = pal.line2;
        ctx.beginPath();
        ctx.moveTo(plotRight, y);
        ctx.lineTo(plotRight + 4, y);
        ctx.stroke();
      }
      ctx.fillStyle = pal.muted;
      if (side === 'left') {
        ctx.textAlign = 'right';
        ctx.fillText(fmtNum(v, dec), padding.left - 8, y);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(fmtNum(v, dec), plotRight + 8, y);
      }
    }
    ctx.restore();
  }

  _strokeSeries(ctx, points, color, dash, width = 2.25) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  _fillUnder(ctx, pal, points, color, baseY) {
    if (points.length < 2) return;
    ctx.save();
    const grad = ctx.createLinearGradient(0, this.padding.top, 0, baseY);
    grad.addColorStop(0, pal.alpha(color, pal.isLight ? 0.14 : 0.2));
    grad.addColorStop(1, pal.alpha(color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.lineTo(points[points.length - 1][0], baseY);
    ctx.lineTo(points[0][0], baseY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _marker(ctx, pal, x, y, color, r = 4) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = pal.elevated;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** A small pill label, clamped inside the plot. */
  _pill(ctx, pal, text, x, y, color, align = 'center') {
    ctx.save();
    ctx.font = pal.font(11, 600);
    const tw = ctx.measureText(text).width + 12;
    const th = 18;
    const { padding } = this;
    let bx = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
    bx = Math.max(padding.left + 2, Math.min(this.w - padding.right - tw - 2, bx));
    const by = Math.max(padding.top + 2, Math.min(this.h - padding.bottom - th - 2, y));
    ctx.fillStyle = pal.alpha(pal.elevated, 0.92);
    ctx.strokeStyle = pal.alpha(color, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, tw - 1, th - 1, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 6, by + th / 2 + 0.5);
    ctx.restore();
    return { x: bx, y: by, w: tw, h: th };
  }

  _tooltip(ctx, pal, hx, hy, lines) {
    const { padding } = this;
    ctx.save();
    ctx.font = pal.font(12, 600);
    const titleW = ctx.measureText(lines[0]).width;
    ctx.font = pal.font(12);
    const bodyW = Math.max(0, ...lines.slice(1).map((l) => ctx.measureText(l).width));
    const tw = Math.max(titleW, bodyW) + 20;
    const th = 14 + lines.length * 17;
    let tx = hx + 14;
    if (tx + tw > this.w - 4) tx = hx - tw - 14;
    tx = Math.max(4, tx);
    let ty = hy - th - 10;
    if (ty < padding.top) ty = Math.min(hy + 12, this.h - padding.bottom - th);
    ty = Math.max(4, ty);

    ctx.shadowColor = pal.alpha('#000000', pal.isLight ? 0.12 : 0.4);
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = pal.elevated;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 8);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = pal.line2;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      ctx.font = i === 0 ? pal.font(12, 600) : pal.font(12);
      ctx.fillStyle = i === 0 ? pal.text : pal.muted;
      ctx.fillText(line, tx + 10, ty + 15 + i * 17);
    });
    ctx.restore();
  }

  _crosshair(ctx, pal, x, plotBottom) {
    ctx.save();
    ctx.strokeStyle = pal.alpha(pal.text, 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash(DASH.guide);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, this.padding.top);
    ctx.lineTo(Math.round(x) + 0.5, plotBottom);
    ctx.stroke();
    ctx.restore();
  }

  _nearest(distM) {
    return this.trajectory.reduce((prev, curr) =>
      Math.abs(curr.distanceM - distM) < Math.abs(prev.distanceM - distM) ? curr : prev
    );
  }

  // ---- render ------------------------------------------------------------------------------------

  render() {
    if (!this.ctx || !this.w || !this.h) return;
    const ctx = this.ctx;
    const pal = getPalette();
    ctx.clearRect(0, 0, this.w, this.h);

    const traj = this.trajectory;
    if (!traj || traj.length < 2) {
      ctx.fillStyle = pal.muted;
      ctx.font = pal.font(13);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No trajectory calculated yet', this.w / 2, this.h / 2);
      return;
    }

    // Narrow canvases get tighter margins
    const narrow = this.w < 480;
    this.padding.left = narrow ? 48 : 60;
    this.padding.right = this.options.activeTab === 'drop' ? (narrow ? 44 : 56) : narrow ? 14 : 24;
    this.padding.bottom = 44;

    if (this.options.activeTab === 'drop') this._renderDrop(ctx, pal);
    else this._renderStandard(ctx, pal, this.options.activeTab);
  }

  _renderDrop(ctx, pal) {
    const traj = this.trajectory;
    const u = this._units();
    const maxDistM = traj[traj.length - 1].distanceM;

    const dropVals = traj.map((p) => u.drop(p.dropM));
    const elevVals = traj.map((p) => u.elev(p));

    const legend = this._layoutLegend(ctx, pal, [
      { label: `Drop (${u.dropUnit})`, color: pal.accent, dash: DASH.solid, width: 2.5 },
      { label: `Elevation (${u.elevUnit}, right axis)`, color: pal.accent2, dash: DASH.dashed },
      { label: 'Line of sight', color: pal.muted, dash: DASH.guide, width: 1.5 },
      { label: 'Zero', color: pal.ok, dash: DASH.dotted, width: 2 },
    ]);
    const { padding } = this;
    padding.top = legend.height + 30;
    const plotW = this.w - padding.left - padding.right;
    const plotH = this.h - padding.top - padding.bottom;
    const plotBottom = padding.top + plotH;
    const getX = (distM) => padding.left + (distM / maxDistM) * plotW;

    // Left axis (drop), with headroom above the apex
    const maxDrop = Math.max(...dropVals);
    const minDrop = Math.min(...dropVals);
    const dropAxis = niceAxis(minDrop, Math.max(0, maxDrop) + (maxDrop - minDrop) * 0.05, Math.max(3, Math.floor(plotH / 48)));
    const getYDrop = (v) => padding.top + plotH - ((v - dropAxis.min) / (dropAxis.max - dropAxis.min)) * plotH;

    // Right axis (elevation)
    const elevAxis = niceAxis(Math.min(0, ...elevVals), Math.max(...elevVals) * 1.05, Math.max(3, Math.floor(plotH / 48)));
    const getYElev = (v) => padding.top + plotH - ((v - elevAxis.min) / (elevAxis.max - elevAxis.min)) * plotH;

    this._drawLegend(ctx, pal, legend);
    this._drawYGrid(ctx, pal, dropAxis, getYDrop, 'left', true);
    this._drawYGrid(ctx, pal, elevAxis, getYElev, 'right', false);
    this._drawXAxis(ctx, pal, u, maxDistM, getX, plotBottom);

    // Axis units above the tick columns
    ctx.save();
    ctx.font = pal.font(11, 600);
    ctx.fillStyle = pal.muted;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillText(u.dropUnit, padding.left - 8, padding.top - 12);
    ctx.textAlign = 'left';
    ctx.fillText(u.elevUnit, this.w - padding.right + 8, padding.top - 12);
    ctx.restore();

    // Line of sight (drop = 0)
    const yLos = getYDrop(0);
    ctx.save();
    ctx.strokeStyle = pal.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(DASH.guide);
    ctx.beginPath();
    ctx.moveTo(padding.left, yLos);
    ctx.lineTo(padding.left + plotW, yLos);
    ctx.stroke();
    ctx.restore();

    // Zero distance
    const zeroDistanceM = Number(this.telemetry?.zeroDistanceM) || 100;
    const xZero = getX(zeroDistanceM);
    const zeroInside = zeroDistanceM > 0 && zeroDistanceM <= maxDistM;
    if (zeroInside) {
      ctx.save();
      ctx.strokeStyle = pal.ok;
      ctx.lineWidth = 2;
      ctx.setLineDash(DASH.dotted);
      ctx.beginPath();
      ctx.moveTo(xZero, padding.top);
      ctx.lineTo(xZero, plotBottom);
      ctx.stroke();
      ctx.restore();
    }

    // Series
    const dropPts = traj.map((p, i) => [getX(p.distanceM), getYDrop(dropVals[i])]);
    const elevPts = traj.map((p, i) => [getX(p.distanceM), getYElev(elevVals[i])]);
    this._fillUnder(ctx, pal, dropPts, pal.accent, plotBottom);
    this._strokeSeries(ctx, elevPts, pal.accent2, DASH.dashed, 2);
    this._strokeSeries(ctx, dropPts, pal.accent, DASH.solid, 2.5);

    // Labels: zero at the bottom of the plot, apex above the curve
    if (zeroInside) {
      this._pill(ctx, pal, `Zero ${fmtNum(u.dist(zeroDistanceM))} ${u.distUnit}`, xZero + 6, plotBottom - 24, pal.ok, 'left');
    }
    let apexI = 0;
    dropVals.forEach((v, i) => {
      if (v > dropVals[apexI]) apexI = i;
    });
    if (dropVals[apexI] > 0) {
      const [ax, ay] = dropPts[apexI];
      this._marker(ctx, pal, ax, ay, pal.accent);
      this._pill(
        ctx,
        pal,
        `Apex +${fmtNum(dropVals[apexI], 1)} ${u.dropUnit} at ${fmtNum(u.dist(traj[apexI].distanceM))} ${u.distUnit}`,
        ax,
        ay - 28,
        pal.accent,
        'center'
      );
    }
    // Hover
    if (this.hoverDistance !== null && this.hoverDistance >= 0 && this.hoverDistance <= maxDistM) {
      const p = this._nearest(this.hoverDistance);
      const hx = getX(p.distanceM);
      const hDrop = u.drop(p.dropM);
      const hy = getYDrop(hDrop);
      this._crosshair(ctx, pal, hx, plotBottom);
      this._marker(ctx, pal, hx, getYElev(u.elev(p)), pal.accent2, 3.5);
      this._marker(ctx, pal, hx, hy, pal.accent, 4.5);
      this._tooltip(ctx, pal, hx, hy, [
        `${fmtNum(u.dist(p.distanceM))} ${u.distUnit}`,
        `Drop ${fmtNum(hDrop, 1)} ${u.dropUnit}`,
        `Elevation ${fmtNum(u.elev(p), 2)} ${u.elevUnit} (${fmtNum(p.elevationClicks)} clicks)`,
        `${fmtNum(u.vel(p.velocityMs))} ${u.velUnit} · ${fmtNum(p.tofS, 2)} s`,
      ]);
    }
  }

  _renderStandard(ctx, pal, tab) {
    const traj = this.trajectory;
    const u = this._units();
    const maxDistM = traj[traj.length - 1].distanceM;
    const def = this._seriesFor(tab, u);
    if (!def) return;
    const color = tab === 'wind' ? pal.warn : pal.accent;

    const legendItems = [{ label: def.main.label, color, dash: DASH.solid, width: 2.5 }];
    if (tab === 'velocity') {
      legendItems.push({ label: 'Transonic', color: pal.warn, swatch: pal.alpha(pal.warn, 0.22) });
      legendItems.push({ label: 'Subsonic', color: pal.bad, swatch: pal.alpha(pal.bad, 0.18) });
    }
    if (tab === 'energy') {
      legendItems.push({ label: 'Common minimums (guide)', color: pal.muted, dash: DASH.guide, width: 1.5 });
    }
    const legend = this._layoutLegend(ctx, pal, legendItems);
    const { padding } = this;
    padding.top = legend.height + 30;
    const plotW = this.w - padding.left - padding.right;
    const plotH = this.h - padding.top - padding.bottom;
    const plotBottom = padding.top + plotH;
    const getX = (distM) => padding.left + (distM / maxDistM) * plotW;

    const vals = def.main.values;
    const vMax = Math.max(...vals);
    const vMin = def.floorZero ? 0 : Math.min(...vals);
    const axis = niceAxis(vMin, vMax * 1.06 || 1, Math.max(3, Math.floor(plotH / 48)));
    const getY = (v) => padding.top + plotH - ((v - axis.min) / (axis.max - axis.min)) * plotH;
    const clampY = (y) => Math.max(padding.top, Math.min(plotBottom, y));

    this._drawLegend(ctx, pal, legend);

    // Regime bands (behind the grid)
    if (tab === 'velocity') {
      const sos = u.vel(Number(this.telemetry.speedOfSoundMs) || 340);
      const yTop = clampY(getY(sos * 1.2));
      const ySub = clampY(getY(sos));
      ctx.save();
      ctx.fillStyle = pal.alpha(pal.warn, pal.isLight ? 0.14 : 0.12);
      ctx.fillRect(padding.left, yTop, plotW, ySub - yTop);
      ctx.fillStyle = pal.alpha(pal.bad, pal.isLight ? 0.1 : 0.1);
      ctx.fillRect(padding.left, ySub, plotW, plotBottom - ySub);
      ctx.restore();
    }

    this._drawYGrid(ctx, pal, axis, getY, 'left', true);
    this._drawXAxis(ctx, pal, u, maxDistM, getX, plotBottom);

    ctx.save();
    ctx.font = pal.font(11, 600);
    ctx.fillStyle = pal.muted;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.fillText(def.main.unit, padding.left - 8, padding.top - 12);
    ctx.restore();

    if (tab === 'velocity') {
      const sos = u.vel(Number(this.telemetry.speedOfSoundMs) || 340);
      const ySos = getY(sos);
      if (ySos > padding.top && ySos < plotBottom) {
        ctx.save();
        ctx.strokeStyle = pal.warn;
        ctx.lineWidth = 1.25;
        ctx.setLineDash(DASH.guide);
        ctx.beginPath();
        ctx.moveTo(padding.left, ySos);
        ctx.lineTo(padding.left + plotW, ySos);
        ctx.stroke();
        ctx.font = pal.font(11, 600);
        ctx.fillStyle = pal.warnText;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Speed of sound, ${fmtNum(sos)} ${u.velUnit}`, padding.left + plotW - 6, ySos - 4);
        ctx.restore();
      }
    }

    if (tab === 'energy') {
      // Widely quoted rules of thumb, shown as a guide only: 1,000 ft·lb for deer, 1,500 ft·lb for elk
      const guides = [
        { j: 1000 * CONVERSIONS['ft-lb'], label: 'deer' },
        { j: 1500 * CONVERSIONS['ft-lb'], label: 'elk' },
      ];
      ctx.save();
      for (const g of guides) {
        const v = u.energy(g.j);
        const y = getY(v);
        if (y <= padding.top + 12 || y >= plotBottom) continue;
        ctx.strokeStyle = pal.muted;
        ctx.lineWidth = 1.25;
        ctx.setLineDash(DASH.guide);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = pal.font(11);
        ctx.fillStyle = pal.muted;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Common minimum for ${g.label}: ${fmtNum(v)} ${u.energyLabel}`, padding.left + plotW - 6, y - 4);
      }
      ctx.restore();
    }

    const pts = traj.map((p, i) => [getX(p.distanceM), getY(vals[i])]);
    this._fillUnder(ctx, pal, pts, color, plotBottom);
    this._strokeSeries(ctx, pts, color, DASH.solid, 2.5);

    if (this.hoverDistance !== null && this.hoverDistance >= 0 && this.hoverDistance <= maxDistM) {
      const p = this._nearest(this.hoverDistance);
      const idx = traj.indexOf(p);
      const hx = getX(p.distanceM);
      const hy = getY(vals[idx]);
      this._crosshair(ctx, pal, hx, plotBottom);
      this._marker(ctx, pal, hx, hy, color, 4.5);

      const lines = [`${fmtNum(u.dist(p.distanceM))} ${u.distUnit}`];
      if (tab === 'velocity') {
        lines.push(`Velocity ${fmtNum(vals[idx])} ${u.velUnit}`, `Mach ${fmtNum(p.mach, 2)}`);
      } else if (tab === 'wind') {
        const w = u.wind(p);
        const dir = Math.abs(w) < 0.005 ? '' : w > 0 ? ' right' : ' left';
        lines.push(`Wind ${fmtNum(Math.abs(w), 2)} ${u.windUnit}${dir} (${fmtNum(Math.abs(p.windageClicks))} clicks)`);
        if (Number.isFinite(p.driftM)) lines.push(`Drift ${fmtNum(Math.abs(u.drift(p.driftM)), 1)} ${u.driftUnit}`);
      } else if (tab === 'lead') {
        lines.push(`Time of flight ${fmtNum(p.tofS, 3)} s`);
      } else if (tab === 'energy') {
        lines.push(`Energy ${fmtNum(vals[idx])} ${u.energyLabel}`);
      }
      if (tab !== 'velocity') lines.push(`Mach ${fmtNum(p.mach, 2)} · ${fmtNum(p.tofS, 2)} s`);
      this._tooltip(ctx, pal, hx, hy, lines);
    }
  }
}
