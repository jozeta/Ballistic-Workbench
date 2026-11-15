/**
 * Ballistic Workbench - High-DPI Canvas Multi-Tab Chart Engine
 * Renders razor-sharp vector graphs with synchronized crosshairs across tabs:
 * 1. Dedicated Bullet Drop Chart (Drop vs Distance in cm/in, Elevation in MRAD/MOA, Zero Line, Line of Sight, Apex)
 * 2. Velocity & Mach with Transonic/Subsonic regime shading
 * 3. Wind Drift Dial
 * 4. Flight Time & Moving Target Lead
 * 5. Kinetic Energy & Momentum with Ethical Hunting Thresholds
 */

import { UnitConverter } from '../core/units.js';

export class BallisticChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = Object.assign(
      {
        activeTab: 'drop', // 'drop' | 'velocity' | 'wind' | 'lead' | 'energy'
        dropMode: 'both', // 'trajectory' | 'dial' | 'both'
        systemUnits: 'metric',
        displayUnits: UnitConverter.getSystemDefaults('metric'),
        onHover: null,
      },
      options
    );

    this.trajectory = [];
    this.telemetry = {};
    this.hoverDistance = null;
    this.padding = { top: 34, right: 64, bottom: 44, left: 68 };
    this.resizeObserver = null;

    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Canvas takes 100% of parent container dynamically
    const parent = this.canvas.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : rect;

    const displayWidth = Math.max(300, Math.floor(parentRect.width || rect.width || 600));
    const displayHeight = Math.max(220, Math.floor(parentRect.height || rect.height || 340));

    this.canvas.width = Math.floor(displayWidth * dpr);
    this.canvas.height = Math.floor(displayHeight * dpr);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.w = displayWidth;
    this.h = displayHeight;

    this.render();
  }

  _bindEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      if (mouseX >= this.padding.left && mouseX <= this.w - this.padding.right) {
        const plotW = this.w - this.padding.left - this.padding.right;
        const frac = (mouseX - this.padding.left) / plotW;
        if (this.trajectory && this.trajectory.length > 0) {
          const maxDist = this.trajectory[this.trajectory.length - 1].distanceM;
          this.hoverDistance = frac * maxDist;
          if (this.options.onHover) {
            this.options.onHover(this.hoverDistance);
          }
          this.render();
        }
      } else {
        this.hoverDistance = null;
        this.render();
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverDistance = null;
      if (this.options.onHover) this.options.onHover(null);
      this.render();
    });

    // Dynamic container resize observation
    if (window.ResizeObserver && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.canvas.parentElement);
    }

    window.addEventListener('resize', () => this.resize());
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  setHoverDistance(distM) {
    this.hoverDistance = distM;
    this.render();
  }

  setData(trajectoryData, telemetryData = {}) {
    this.trajectory = trajectoryData || [];
    this.telemetry = telemetryData || {};
    this.render();
  }

  setTab(tabName) {
    this.options.activeTab = tabName;
    this.render();
  }

  setUnits(system, displayUnits) {
    this.options.systemUnits = system;
    this.options.displayUnits = displayUnits;
    this.render();
  }

  render() {
    if (!this.ctx || !this.w || !this.h) return;
    const ctx = this.ctx;
    const { w, h, padding } = this;
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    // Clear background
    ctx.fillStyle = isLight ? '#ffffff' : '#0b0f17';
    ctx.fillRect(0, 0, w, h);

    if (!this.trajectory || this.trajectory.length < 2) {
      ctx.fillStyle = isLight ? '#64748b' : '#64748b';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No trajectory data calculated', w / 2, h / 2);
      return;
    }

    const traj = this.trajectory;
    const maxDistM = traj[traj.length - 1].distanceM;
    const distUnit = this.options.displayUnits.distance || 'm';
    const isMetric = this.options.systemUnits === 'metric';

    // Map function for X coordinate (Distance)
    const getX = (distM) => padding.left + (distM / maxDistM) * plotW;

    const tab = this.options.activeTab;

    // Render based on tab
    if (tab === 'drop') {
      this._renderDropTab(ctx, traj, maxDistM, distUnit, isMetric, isLight, getX, plotW, plotH);
    } else {
      this._renderStandardTab(ctx, traj, maxDistM, distUnit, isMetric, isLight, getX, plotW, plotH, tab);
    }
  }

  /**
   * Primary Dedicated Bullet Drop Chart:
   * Drop vs Distance in cm/in, Elevation in MRAD/MOA, Zero Line, Line of Sight, Apex
   */
  _renderDropTab(ctx, traj, maxDistM, distUnit, isMetric, isLight, getX, plotW, plotH) {
    const { padding } = this;
    const isMrad = this.options.displayUnits.elevationAngle === 'MRAD';
    const linUnit = isMetric ? 'cm' : 'in';
    const linFactor = isMetric ? 100 : 39.3701;

    // Series 1: Physical Trajectory Drop relative to Line of Sight (y in cm/in)
    const dropSeries = traj.map((p) => ({
      x: p.distanceM,
      y: p.dropM * linFactor,
    }));

    // Series 2: Elevation Dial (in MRAD or MOA)
    const dialSeries = traj.map((p) => ({
      x: p.distanceM,
      y: isMrad ? p.elevationMrad : p.elevationMoa,
    }));

    // Find Apex (highest point above line of sight)
    let apexIndex = 0;
    let apexVal = -Infinity;
    dropSeries.forEach((pt, i) => {
      if (pt.y > apexVal) {
        apexVal = pt.y;
        apexIndex = i;
      }
    });
    const apexPt = dropSeries[apexIndex];

    // Find Zero point (first point near 0 drop after apex, or zeroDistanceM)
    const zeroDistanceM = this.telemetry?.zeroDistanceM || (traj[0].distanceM === 0 && traj[4] ? traj[4].distanceM : 100);

    // Left Y Axis: Trajectory Drop (cm/in)
    // Trajectory is usually from -sightHeight, rises to Apex (+), drops to negative downrange (-100cm ... -900cm)
    const minDrop = Math.min(...dropSeries.map((s) => s.y));
    const maxDrop = Math.max(10, Math.ceil(apexPt.y * 1.5));
    // Round minDrop down to nice round number
    const yLinMin = Math.floor(minDrop / 50) * 50;
    const yLinMax = Math.ceil(maxDrop / 10) * 10;

    const getYDrop = (val) => padding.top + plotH - ((val - yLinMin) / (yLinMax - yLinMin)) * plotH;

    // Right Y Axis: Elevation Dial (MRAD/MOA)
    const maxDial = Math.max(5, Math.ceil(Math.max(...dialSeries.map((s) => s.y)) * 1.15));
    const getYDial = (val) => padding.top + plotH - (val / maxDial) * plotH;

    // 1. Grid Lines
    ctx.strokeStyle = isLight ? '#e2e8f0' : '#1e293b';
    ctx.lineWidth = 1;
    ctx.fillStyle = isLight ? '#475569' : '#64748b';
    ctx.font = '10px monospace';

    // Horizontal grid ticks (5 intervals)
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const dropVal = yLinMin + (i / ticks) * (yLinMax - yLinMin);
      const yPos = getYDrop(dropVal);

      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(padding.left + plotW, yPos);
      ctx.stroke();

      // Left axis label: Drop (cm/in)
      ctx.textAlign = 'right';
      ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.fillText(`${Math.round(dropVal)}`, padding.left - 8, yPos + 4);

      // Right axis label: Dial (MRAD/MOA)
      const dialVal = (i / ticks) * maxDial;
      ctx.textAlign = 'left';
      ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
      ctx.fillText(`${dialVal.toFixed(1)}`, padding.left + plotW + 8, getYDial(dialVal) + 4);
    }

    // Vertical Distance Grid Lines
    const xInterval = maxDistM <= 600 ? 100 : maxDistM <= 1200 ? 200 : 300;
    ctx.fillStyle = isLight ? '#64748b' : '#64748b';
    for (let dist = 0; dist <= maxDistM; dist += xInterval) {
      const xPos = getX(dist);
      ctx.beginPath();
      ctx.strokeStyle = isLight ? '#e2e8f0' : '#1e293b';
      ctx.moveTo(xPos, padding.top);
      ctx.lineTo(xPos, padding.top + plotH);
      ctx.stroke();

      ctx.textAlign = 'center';
      const dispDist = distUnit === 'yd' ? Math.round(dist * 1.09361) : dist;
      ctx.fillText(`${dispDist}`, xPos, padding.top + plotH + 18);
    }

    // 2. LINE OF SIGHT (LOS = 0 Line)
    const yLos = getYDrop(0);
    if (yLos >= padding.top && yLos <= padding.top + plotH) {
      ctx.save();
      ctx.strokeStyle = isLight ? '#64748b' : '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, yLos);
      ctx.lineTo(padding.left + plotW, yLos);
      ctx.stroke();

      ctx.fillStyle = isLight ? '#475569' : '#cbd5e1';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('━━━ LINE OF SIGHT (LOS = 0)', padding.left + 12, yLos - 6);
      ctx.restore();
    }

    // 3. ZERO LINE INDICATOR
    const xZero = getX(zeroDistanceM);
    if (xZero >= padding.left && xZero <= padding.left + plotW) {
      ctx.save();
      ctx.strokeStyle = isLight ? '#059669' : '#10b981';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xZero, padding.top);
      ctx.lineTo(xZero, padding.top + plotH);
      ctx.stroke();

      // Zero Badge
      ctx.fillStyle = isLight ? 'rgba(236, 253, 245, 0.95)' : 'rgba(6, 78, 59, 0.85)';
      ctx.strokeStyle = isLight ? '#059669' : '#10b981';
      ctx.beginPath();
      ctx.roundRect(xZero - 34, padding.top + 6, 68, 18, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isLight ? '#047857' : '#34d399';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`ZERO ${zeroDistanceM}${distUnit}`, xZero, padding.top + 18);
      ctx.restore();
    }

    // 4. CURVE 1: Trajectory Physical Path (Cyan)
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';

    dropSeries.forEach((pt, idx) => {
      const px = getX(pt.x);
      const py = getYDrop(pt.y);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Soft gradient area under trajectory
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    if (isLight) {
      grad.addColorStop(0, 'rgba(2, 132, 199, 0.15)');
      grad.addColorStop(1, 'rgba(2, 132, 199, 0.00)');
    } else {
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.20)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.00)');
    }
    ctx.lineTo(getX(dropSeries[dropSeries.length - 1].x), padding.top + plotH);
    ctx.lineTo(getX(dropSeries[0].x), padding.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // 5. CURVE 2: Elevation Dial Angle (Amber Dashed)
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = isLight ? '#d97706' : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);

    dialSeries.forEach((pt, idx) => {
      const px = getX(pt.x);
      const py = getYDial(pt.y);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();

    // 6. APEX CALLOUT INDICATOR
    if (apexPt && apexPt.y > 0) {
      const apexX = getX(apexPt.x);
      const apexY = getYDrop(apexPt.y);

      ctx.save();
      // Apex point circle
      ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(apexX, apexY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Apex callout pill
      const apexText = `▲ Apex: +${apexPt.y.toFixed(1)}${linUnit} @ ${apexPt.x}${distUnit}`;
      ctx.font = 'bold 9px monospace';
      const aw = ctx.measureText(apexText).width + 12;

      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(apexX - aw / 2, apexY - 26, aw, 18, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.textAlign = 'center';
      ctx.fillText(apexText, apexX, apexY - 14);
      ctx.restore();
    }

    // 7. Axis Titles & Dual Legend
    ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`━━ Drop (${linUnit})`, padding.left, padding.top - 12);

    ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
    ctx.textAlign = 'right';
    ctx.fillText(`┅┅ Elevation Dial (${isMrad ? 'MRAD' : 'MOA'})`, padding.left + plotW, padding.top - 12);

    ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';
    ctx.fillText(`Target Distance (${distUnit})`, padding.left + plotW / 2, padding.top + plotH + 34);

    // 8. Crosshair Tracking & Hover Tooltip
    if (this.hoverDistance !== null && this.hoverDistance >= 0 && this.hoverDistance <= maxDistM) {
      const hX = getX(this.hoverDistance);
      const nearest = traj.reduce((prev, curr) =>
        Math.abs(curr.distanceM - this.hoverDistance) < Math.abs(prev.distanceM - this.hoverDistance) ? curr : prev
      );

      const hDrop = nearest.dropM * linFactor;
      const hDial = isMrad ? nearest.elevationMrad : nearest.elevationMoa;
      const hY = getYDrop(hDrop);

      ctx.save();
      // Vertical crosshair
      ctx.strokeStyle = isLight ? '#d97706' : '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hX, padding.top);
      ctx.lineTo(hX, padding.top + plotH);
      ctx.stroke();

      // Point circle
      ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(hX, hY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Tooltip Card
      const ttDist = distUnit === 'yd' ? Math.round(nearest.distanceM * 1.09361) : nearest.distanceM;
      const ttText1 = `${ttDist} ${distUnit}: Drop ${hDrop.toFixed(1)} ${linUnit} | Dial ${hDial.toFixed(2)} ${isMrad ? 'MRAD' : 'MOA'}`;
      const ttText2 = `Clicks: ${nearest.elevationClicks} | Vel: ${Math.round(isMetric ? nearest.velocityMs : nearest.velocityMs * 3.28084)} ${isMetric ? 'm/s' : 'fps'} | ToF: ${nearest.tofS.toFixed(3)}s`;

      ctx.font = '11px monospace';
      const tw = Math.max(ctx.measureText(ttText1).width, ctx.measureText(ttText2).width) + 20;
      const th = 42;
      let tx = hX + 12;
      let ty = hY - 48;
      if (tx + tw > this.w - 10) tx = hX - tw - 12;
      if (ty < 10) ty = hY + 12;

      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
      ctx.textAlign = 'left';
      ctx.fillText(ttText1, tx + 10, ty + 16);
      ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
      ctx.fillText(ttText2, tx + 10, ty + 32);
      ctx.restore();
    }
  }

  /**
   * Standard Graphs: Velocity & Mach, Wind Drift, Lead / ToF, Kinetic Energy
   */
  _renderStandardTab(ctx, traj, maxDistM, distUnit, isMetric, isLight, getX, plotW, plotH, tab) {
    const { padding, w, h } = this;
    let minY = 0;
    let maxY = 100;
    let yUnitLabel = '';
    let series = [];

    if (tab === 'velocity') {
      yUnitLabel = isMetric ? 'Velocity (m/s)' : 'Velocity (fps)';
      series = traj.map((p) => ({
        x: p.distanceM,
        y: isMetric ? p.velocityMs : p.velocityMs * 3.28084,
      }));
      minY = 0;
      maxY = Math.ceil(traj[0].velocityMs * (isMetric ? 1 : 3.28084) * 1.1);
    } else if (tab === 'wind') {
      const isMrad = this.options.displayUnits.windageAngle === 'MRAD';
      yUnitLabel = isMrad ? 'Wind Drift Dial (MRAD)' : 'Wind Drift Dial (MOA)';
      series = traj.map((p) => ({
        x: p.distanceM,
        y: Math.abs(isMrad ? p.windageMrad : p.windageMoa),
      }));
      minY = 0;
      maxY = Math.max(2, Math.ceil(Math.max(...series.map((s) => s.y)) * 1.2));
    } else if (tab === 'lead') {
      yUnitLabel = 'Flight Time (seconds)';
      series = traj.map((p) => ({
        x: p.distanceM,
        y: p.tofS,
      }));
      minY = 0;
      maxY = Math.max(1.0, Number((Math.max(...series.map((s) => s.y)) * 1.2).toFixed(1)));
    } else if (tab === 'energy') {
      yUnitLabel = isMetric ? 'Kinetic Energy (Joules)' : 'Kinetic Energy (ft-lb)';
      series = traj.map((p) => ({
        x: p.distanceM,
        y: isMetric ? p.energyJ : p.energyJ * 0.737562,
      }));
      minY = 0;
      maxY = Math.ceil(series[0].y * 1.1);
    }

    const getY = (val) => padding.top + plotH - ((val - minY) / (maxY - minY)) * plotH;

    // Transonic / Subsonic Shading (Velocity tab)
    if (tab === 'velocity') {
      const sos = this.telemetry.speedOfSoundMs || 340;
      const sosVal = isMetric ? sos : sos * 3.28084;
      const transUpper = sosVal * 1.2;
      const transLower = sosVal * 0.9;

      const yTransUpper = getY(transUpper);
      const yTransLower = getY(transLower);
      const ySos = getY(sosVal);

      // Transonic warning zone
      ctx.fillStyle = isLight ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.08)';
      ctx.fillRect(padding.left, yTransUpper, plotW, yTransLower - yTransUpper);

      // Subsonic zone
      ctx.fillStyle = isLight ? 'rgba(239, 68, 68, 0.10)' : 'rgba(239, 68, 68, 0.08)';
      ctx.fillRect(padding.left, yTransLower, plotW, padding.top + plotH - yTransLower);

      // Mach 1 line
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, ySos);
      ctx.lineTo(padding.left + plotW, ySos);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`Mach 1.0 (${Math.round(sosVal)} ${isMetric ? 'm/s' : 'fps'})`, padding.left + plotW - 8, ySos - 4);
    }

    // Hunting Energy Thresholds (Energy tab)
    if (tab === 'energy') {
      const deerThreshold = isMetric ? 1000 : 750;
      const elkThreshold = isMetric ? 2000 : 1500;

      if (maxY > deerThreshold) {
        const yDeer = getY(deerThreshold);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padding.left, yDeer);
        ctx.lineTo(padding.left + plotW, yDeer);
        ctx.stroke();
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`Deer / Medium Game (${deerThreshold} ${isMetric ? 'J' : 'ft-lb'})`, padding.left + plotW - 8, yDeer - 4);
      }
      if (maxY > elkThreshold) {
        const yElk = getY(elkThreshold);
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.4)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padding.left, yElk);
        ctx.lineTo(padding.left + plotW, yElk);
        ctx.stroke();
        ctx.fillStyle = isLight ? '#059669' : '#34d399';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`Elk / Large Game (${elkThreshold} ${isMetric ? 'J' : 'ft-lb'})`, padding.left + plotW - 8, yElk - 4);
      }
      ctx.setLineDash([]);
    }

    // Grid lines & Axis ticks
    ctx.strokeStyle = isLight ? '#e2e8f0' : '#1e293b';
    ctx.lineWidth = 1;
    ctx.fillStyle = isLight ? '#475569' : '#64748b';
    ctx.font = '11px monospace';

    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const val = minY + (i / yTicks) * (maxY - minY);
      const yPos = getY(val);

      ctx.beginPath();
      ctx.moveTo(padding.left, yPos);
      ctx.lineTo(padding.left + plotW, yPos);
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillText(Number(val.toFixed(1)), padding.left - 8, yPos + 4);
    }

    const xInterval = maxDistM <= 600 ? 100 : maxDistM <= 1200 ? 200 : 300;
    for (let dist = 0; dist <= maxDistM; dist += xInterval) {
      const xPos = getX(dist);
      ctx.beginPath();
      ctx.moveTo(xPos, padding.top);
      ctx.lineTo(xPos, padding.top + plotH);
      ctx.stroke();

      ctx.textAlign = 'center';
      const dispDist = distUnit === 'yd' ? Math.round(dist * 1.09361) : dist;
      ctx.fillText(`${dispDist}`, xPos, padding.top + plotH + 18);
    }

    // Axis Labels
    ctx.fillStyle = isLight ? '#334155' : '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Distance (${distUnit})`, padding.left + plotW / 2, padding.top + plotH + 34);

    ctx.save();
    ctx.translate(16, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(yUnitLabel, 0, 0);
    ctx.restore();

    // Plot Curve Line
    ctx.beginPath();
    ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';

    series.forEach((pt, index) => {
      const px = getX(pt.x);
      const py = getY(pt.y);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Area fill under curve
    ctx.lineTo(getX(series[series.length - 1].x), padding.top + plotH);
    ctx.lineTo(getX(series[0].x), padding.top + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    if (isLight) {
      grad.addColorStop(0, 'rgba(2, 132, 199, 0.15)');
      grad.addColorStop(1, 'rgba(2, 132, 199, 0.00)');
    } else {
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.20)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0.00)');
    }
    ctx.fillStyle = grad;
    ctx.fill();

    // Synchronized Crosshair Tracking & Tooltip
    if (this.hoverDistance !== null && this.hoverDistance >= 0 && this.hoverDistance <= maxDistM) {
      const hX = getX(this.hoverDistance);
      const nearest = traj.reduce((prev, curr) =>
        Math.abs(curr.distanceM - this.hoverDistance) < Math.abs(prev.distanceM - this.hoverDistance) ? curr : prev
      );

      let hoverVal = 0;
      let valUnit = '';
      if (tab === 'velocity') {
        hoverVal = isMetric ? nearest.velocityMs : nearest.velocityMs * 3.28084;
        valUnit = isMetric ? 'm/s' : 'fps';
      } else if (tab === 'wind') {
        const isMrad = this.options.displayUnits.windageAngle === 'MRAD';
        hoverVal = Math.abs(isMrad ? nearest.windageMrad : nearest.windageMoa);
        valUnit = isMrad ? 'MRAD' : 'MOA';
      } else if (tab === 'lead') {
        hoverVal = nearest.tofS;
        valUnit = 'sec';
      } else if (tab === 'energy') {
        hoverVal = isMetric ? nearest.energyJ : nearest.energyJ * 0.737562;
        valUnit = isMetric ? 'J' : 'ft-lb';
      }

      const hY = getY(hoverVal);

      ctx.strokeStyle = isLight ? '#d97706' : '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hX, padding.top);
      ctx.lineTo(hX, padding.top + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padding.left, hY);
      ctx.lineTo(padding.left + plotW, hY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(hX, hY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const ttDist = distUnit === 'yd' ? Math.round(nearest.distanceM * 1.09361) : nearest.distanceM;
      const ttText1 = `${ttDist} ${distUnit}: ${hoverVal.toFixed(2)} ${valUnit}`;
      const ttText2 = `Mach ${nearest.mach.toFixed(2)} | ToF: ${nearest.tofS.toFixed(3)}s`;

      ctx.font = '11px monospace';
      const tw = Math.max(ctx.measureText(ttText1).width, ctx.measureText(ttText2).width) + 20;
      const th = 42;
      let tx = hX + 12;
      let ty = hY - 48;
      if (tx + tw > w - 10) tx = hX - tw - 12;
      if (ty < 10) ty = hY + 12;

      ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
      ctx.textAlign = 'left';
      ctx.fillText(ttText1, tx + 10, ty + 16);
      ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
      ctx.fillText(ttText2, tx + 10, ty + 32);
    }
  }
}
