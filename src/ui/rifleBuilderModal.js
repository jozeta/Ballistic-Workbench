/**
 * Ballistic Workbench - Rifle Profile Builder Modal
 * Provides interactive modal dialog to build, calibrate, and persist new rifle & optic rigs.
 */

import { appState } from '../core/state.js';
import { esc } from '../core/escape.js';
import { UnitConverter } from '../core/units.js';

export class RifleBuilderModal {
  constructor(onSaved = null) {
    this.onSaved = onSaved;
    this.modalEl = null;
  }

  open() {
    this.close(); // Clean up if existing
    const isImp = appState.state.systemUnits === 'imperial';
    const bullets = appState.state.projectilesLibrary || [];

    const modalHtml = `
      <div id="rifle-builder-modal-root" class="palette-modal open">
        <div class="palette-backdrop" id="rf-modal-backdrop"></div>
        <div class="rifle-modal-container">
          <div class="rifle-modal-header">
            <div>
              <h3>➕ Rifle & Optic Profile Builder</h3>
              <p class="subtitle">Configure a new rifle, optic turret, and match ammunition profile</p>
            </div>
            <button id="btn-close-rifle-modal" class="btn-close-x">✕</button>
          </div>

          <form id="rifle-builder-form" class="rifle-modal-body">
            <!-- SECTION 1: RIFLE IDENTIFICATION -->
            <div class="modal-section-title">1. Rifle Platform</div>
            <div class="field-grid-2">
              <div>
                <label>Rifle Name *</label>
                <input type="text" id="rf-name" class="form-input" placeholder="e.g. Proof Research Elevation 6.5 PRC" required />
              </div>
              <div>
                <label>Caliber *</label>
                <input type="text" id="rf-caliber" class="form-input" placeholder="e.g. 6.5 Creedmoor / .264" required />
              </div>
            </div>
            <div class="field-row mt-2">
              <label>Description / Usage</label>
              <input type="text" id="rf-desc" class="form-input" placeholder="e.g. PRS Competition Rig with Bartlein 26 inch barrel" />
            </div>

            <!-- SECTION 2: BARREL & BALLISTICS -->
            <div class="modal-section-title mt-3">2. Barrel & Ammunition</div>
            <div class="field-row">
              <label>Match Projectile (Select from Database or Custom)</label>
              <select id="rf-bullet-select" class="form-select">
                <option value="custom">-- Custom Bullet Parameters --</option>
                ${bullets.map((b) => `<option value="${esc(b.id)}">${esc(b.manufacturer)} - ${esc(b.name)} (${b.weightGr}gr, BC ${b.bcG7 || b.bcG1})</option>`).join('')}
              </select>
            </div>

            <div class="field-grid-3 mt-2">
              <div>
                <label>Bullet Name</label>
                <input type="text" id="rf-bullet-name" class="form-input" value="Custom Match Bullet" />
              </div>
              <div>
                <label>Bullet Weight (gr) *</label>
                <input type="number" id="rf-weight" class="form-input" min="20" max="1000" value="140" required />
              </div>
              <div>
                <label>Diameter (in)</label>
                <input type="number" id="rf-dia" class="form-input" step="0.001" value="0.264" />
              </div>
            </div>

            <div class="field-grid-3 mt-2">
              <div>
                <label>Drag Model</label>
                <select id="rf-drag-model" class="form-select">
                  <option value="G7">G7 (Boat-tail)</option>
                  <option value="G1">G1 (Flat-base)</option>
                  <option value="DOPPLER">Doppler Radar</option>
                </select>
              </div>
              <div>
                <label>Ballistic Coeff (BC)</label>
                <input type="number" id="rf-bc" class="form-input" step="0.001" value="0.320" />
              </div>
              <div>
                <label>Muzzle Velocity (${isImp ? 'fps' : 'm/s'}) *</label>
                <input type="number" id="rf-mv" class="form-input" value="${isImp ? 2750 : 838}" required />
              </div>
            </div>

            <div class="field-grid-3 mt-2">
              <div>
                <label>Twist Rate (1:X")</label>
                <input type="number" id="rf-twist" class="form-input" step="0.1" value="8.0" />
              </div>
              <div>
                <label>Sight Height (${isImp ? 'in' : 'cm'})</label>
                <input type="number" id="rf-sh" class="form-input" step="0.05" value="${isImp ? 1.85 : 4.7}" />
              </div>
              <div>
                <label>Zero Range (${isImp ? 'yd' : 'm'})</label>
                <input type="number" id="rf-zero" class="form-input" step="25" value="100" />
              </div>
            </div>

            <!-- SECTION 3: OPTIC & TURRETS -->
            <div class="modal-section-title mt-3">3. Optic & Turret Setup</div>
            <div class="field-grid-2">
              <div>
                <label>Optic Model</label>
                <input type="text" id="rf-optic-model" class="form-input" placeholder="e.g. Vortex Razor HD Gen III 6-36x56" value="Precision Match 5-25x56 FFP" />
              </div>
              <div>
                <label>Focal Plane</label>
                <select id="rf-focal-plane" class="form-select">
                  <option value="FFP">FFP (First Focal Plane)</option>
                  <option value="SFP">SFP (Second Focal Plane)</option>
                </select>
              </div>
            </div>

            <div class="field-grid-3 mt-2">
              <div>
                <label>Reticle Graticule</label>
                <select id="rf-reticle" class="form-select">
                  <option value="EBR-8 MRAD">Vortex EBR-8 MRAD</option>
                  <option value="Kahles SKMR4">Kahles SKMR4 (PRS)</option>
                  <option value="Leupold PR2-MIL">Leupold PR2-MIL</option>
                  <option value="Mil-XT">Nightforce Mil-XT</option>
                  <option value="Tremor3">Horus Tremor3</option>
                  <option value="Mil-Dot">USMC / Army Mil-Dot</option>
                  <option value="EBR-2C MOA">Vortex EBR-2C MOA</option>
                  <option value="German #4">German #4 Hunting</option>
                  <option value="ACSS DMR">Primary Arms ACSS DMR</option>
                </select>
              </div>
              <div>
                <label>Turret Click Value</label>
                <select id="rf-click-value" class="form-select">
                  <option value="0.0001|0.1 MRAD">0.1 MRAD (1cm @ 100m)</option>
                  <option value="0.0000727|1/4 MOA">1/4 MOA (0.26in @ 100yd)</option>
                  <option value="0.0000363|1/8 MOA">1/8 MOA Target</option>
                  <option value="0.00005|0.05 MRAD">0.05 MRAD ELR</option>
                </select>
              </div>
              <div>
                <label>Magnification (Min - Max)</label>
                <div class="field-grid-2">
                  <input type="number" id="rf-mag-min" class="form-input" value="5" min="1" max="50" placeholder="Min" />
                  <input type="number" id="rf-mag-max" class="form-input" value="25" min="1" max="60" placeholder="Max" />
                </div>
              </div>
            </div>

            <!-- MODAL ACTIONS -->
            <div class="rifle-modal-actions mt-4">
              <button type="button" id="btn-cancel-rifle-modal" class="btn-secondary">Cancel</button>
              <button type="submit" id="btn-save-rifle-profile" class="btn-primary">💾 Save Rifle Profile</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = modalHtml;
    this.modalEl = div.firstElementChild;
    document.body.appendChild(this.modalEl);

    this._bindModalEvents();
  }

  close() {
    if (this.modalEl && this.modalEl.parentElement) {
      this.modalEl.parentElement.removeChild(this.modalEl);
      this.modalEl = null;
    }
  }

  _bindModalEvents() {
    if (!this.modalEl) return;

    const closeBtn = this.modalEl.querySelector('#btn-close-rifle-modal');
    const cancelBtn = this.modalEl.querySelector('#btn-cancel-rifle-modal');
    const backdrop = this.modalEl.querySelector('#rf-modal-backdrop');

    closeBtn?.addEventListener('click', () => this.close());
    cancelBtn?.addEventListener('click', () => this.close());
    backdrop?.addEventListener('click', () => this.close());

    // Projectile dropdown quick-fill
    const bulletSel = this.modalEl.querySelector('#rf-bullet-select');
    bulletSel?.addEventListener('change', (e) => {
      const bId = e.target.value;
      if (bId === 'custom') return;
      const b = (appState.state.projectilesLibrary || []).find((x) => x.id === bId);
      if (!b) return;

      const isImp = appState.state.systemUnits === 'imperial';
      this.modalEl.querySelector('#rf-bullet-name').value = b.name;
      this.modalEl.querySelector('#rf-weight').value = b.weightGr;
      this.modalEl.querySelector('#rf-dia').value = b.diameterIn;
      this.modalEl.querySelector('#rf-drag-model').value = b.dragModel || 'G7';
      this.modalEl.querySelector('#rf-bc').value = b.dragModel === 'G1' ? b.bcG1 : (b.bcG7 || b.bcG1);
      if (b.factoryVelocityFps) {
        this.modalEl.querySelector('#rf-mv').value = isImp ? b.factoryVelocityFps : b.factoryVelocityMs;
      }
    });

    // Form Submit
    const form = this.modalEl.querySelector('#rifle-builder-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveProfile();
    });
  }

  _saveProfile() {
    const isImp = appState.state.systemUnits === 'imperial';

    const name = this.modalEl.querySelector('#rf-name').value.trim();
    const caliber = this.modalEl.querySelector('#rf-caliber').value.trim();
    const desc = this.modalEl.querySelector('#rf-desc').value.trim() || 'Custom Precision Rifle Setup';

    const bulletName = this.modalEl.querySelector('#rf-bullet-name').value.trim();
    const weightGr = parseFloat(this.modalEl.querySelector('#rf-weight').value) || 140;
    const diaIn = parseFloat(this.modalEl.querySelector('#rf-dia').value) || 0.264;
    const dragModel = this.modalEl.querySelector('#rf-drag-model').value || 'G7';
    const bcVal = parseFloat(this.modalEl.querySelector('#rf-bc').value) || 0.320;

    const rawMv = parseFloat(this.modalEl.querySelector('#rf-mv').value) || (isImp ? 2750 : 838);
    const mvMs = isImp ? rawMv / 3.28084 : rawMv;

    const twist = parseFloat(this.modalEl.querySelector('#rf-twist').value) || 8.0;

    const rawSh = parseFloat(this.modalEl.querySelector('#rf-sh').value) || (isImp ? 1.85 : 4.7);
    const sightHeightM = isImp ? rawSh * 0.0254 : rawSh / 100.0;

    const rawZero = parseFloat(this.modalEl.querySelector('#rf-zero').value) || 100;
    const zeroDistanceM = isImp ? Math.round(rawZero * 0.9144) : rawZero;

    const opticModel = this.modalEl.querySelector('#rf-optic-model').value.trim() || 'Tactical Scope';
    const focalPlane = this.modalEl.querySelector('#rf-focal-plane').value;
    const reticle = this.modalEl.querySelector('#rf-reticle').value;

    const [clickValStr, clickName] = this.modalEl.querySelector('#rf-click-value').value.split('|');
    const clickValueRad = parseFloat(clickValStr) || 0.0001;

    const minMag = parseInt(this.modalEl.querySelector('#rf-mag-min').value, 10) || 5;
    const maxMag = parseInt(this.modalEl.querySelector('#rf-mag-max').value, 10) || 25;

    const id = `profile-custom-${Date.now()}`;

    const newProfile = {
      id,
      name,
      description: desc,
      caliber,
      bullet: {
        id: `bullet-${Date.now()}`,
        name: bulletName,
        weightGr,
        diameterIn: diaIn,
        lengthIn: diaIn * 4.2,
        bcG1: dragModel === 'G1' ? bcVal : bcVal * 2.0,
        bcG7: dragModel === 'G7' ? bcVal : bcVal * 0.5,
        dragModel,
      },
      muzzleVelocityMs: Number(mvMs.toFixed(1)),
      powderTempSensitivity: 0.9,
      powderRefTempC: 15.0,
      sightHeightM: Number(sightHeightM.toFixed(4)),
      zeroDistanceM,
      zeroAngleRad: null,
      twistRateIn: twist,
      twistDirection: 'right',
      optic: {
        model: opticModel,
        focalPlane,
        reticle,
        clickValueRad,
        clickName: clickName || '0.1 MRAD',
        currentMagnification: Math.round((minMag + maxMag) / 2),
        minMagnification: minMag,
        maxMagnification: maxMag,
        zeroElevationClicks: 0,
        zeroWindageClicks: 0,
      },
      rifleWeightKg: 6.5,
    };

    // Add to state & persist
    appState.addProfile(newProfile);

    this.close();

    if (this.onSaved) {
      this.onSaved(newProfile);
    }
  }
}
