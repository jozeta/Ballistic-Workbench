/**
 * Ballistic Workbench - Library Manager
 * Manages:
 * 1. Projectiles Database (40+ bullets with instant search & filter)
 * 2. Custom Bullet Builder with real-time Miller stability validation
 * 3. Rifle & Optic Equipment Profiles Manager with JSON import/export
 */

import { appState } from '../core/state.js';
import { calculateStability, validateCustomBullet } from '../data/projectiles.js';
import { RifleBuilderModal } from './rifleBuilderModal.js';

export class LibraryManagerView {
  constructor(containerElement) {
    this.container = containerElement;
    this.activeTab = 'database'; // 'database' | 'builder' | 'rifles'
    this.searchQuery = '';
    this.caliberFilter = 'all';

    this.render();
  }

  destroy() {
    // cleanup
  }

  setTab(tab) {
    this.activeTab = tab;
    this.render();
  }

  renderDatabaseTable() {
    const list = appState.state.projectilesLibrary;
    const query = this.searchQuery.trim().toLowerCase();

    const filtered = list.filter((p) => {
      const matchSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.manufacturer.toLowerCase().includes(query) ||
        p.caliber.toLowerCase().includes(query) ||
        (query.includes('223') && (p.diameterIn === 0.224 || p.caliber.includes('223'))) ||
        (query.includes('308') && (p.diameterIn === 0.308 || p.caliber.includes('308'))) ||
        (query.includes('6.5') && (p.diameterIn === 0.264 || p.caliber.includes('6.5'))) ||
        (query.includes('6mm') && (p.diameterIn === 0.243 || p.caliber.includes('6mm'))) ||
        (query.includes('338') && (p.diameterIn === 0.338 || p.caliber.includes('338'))) ||
        (query.includes('50') && (p.diameterIn >= 0.5 || p.caliber.includes('50'))) ||
        (query.includes('remington') && (p.diameterIn === 0.224 || p.caliber.toLowerCase().includes('remington'))) ||
        (query.includes('winchester') && (p.diameterIn === 0.308 || p.caliber.toLowerCase().includes('winchester') || p.name.toLowerCase().includes('win'))) ||
        (query.includes('nato') && (p.caliber.toLowerCase().includes('nato') || p.name.toLowerCase().includes('nato')));

      const matchCaliber = (() => {
        if (this.caliberFilter === 'all') return true;
        if (this.caliberFilter === '5.56') return p.diameterIn === 0.224 || p.caliber.includes('5.56') || p.caliber.includes('223');
        if (this.caliberFilter === '6mm') return p.diameterIn === 0.243 || (p.caliber.includes('6mm') && !p.caliber.includes('5.56'));
        if (this.caliberFilter === '6.5') return p.diameterIn === 0.264 || p.caliber.includes('6.5');
        if (this.caliberFilter === '308') return p.diameterIn === 0.308 && (p.caliber.includes('308') || p.caliber.includes('Winchester') || p.name.includes('.308 Win'));
        if (this.caliberFilter === '300') return p.diameterIn === 0.308 && (p.caliber.includes('300') || p.caliber.includes('PRC') || p.name.includes('Win Mag') || p.name.includes('PRC'));
        if (this.caliberFilter === '338') return p.diameterIn === 0.338 || p.caliber.includes('338');
        if (this.caliberFilter === 'elr' || this.caliberFilter === '50') return p.diameterIn > 0.35 || p.caliber.includes('ELR') || p.caliber.includes('50') || p.caliber.includes('375');
        return p.caliber.includes(this.caliberFilter);
      })();

      return matchSearch && matchCaliber;
    });

    const activeBulletId = appState.getActiveProfile().bullet.id;

    return `
      <table class="dope-table">
        <thead>
          <tr>
            <th>Manufacturer</th>
            <th>Projectile Name</th>
            <th>Caliber</th>
            <th>Weight</th>
            <th>Factory MV</th>
            <th>G7 BC</th>
            <th>G1 BC</th>
            <th>Model</th>
            <th>Rec. Twist</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `
            <tr>
              <td colspan="10" class="text-center text-muted py-4">No projectiles matched your search or caliber filter.</td>
            </tr>
          ` : filtered.map((b) => {
            const isActive = b.id === activeBulletId;
            return `
              <tr class="${isActive ? 'target-row' : ''}">
                <td class="font-bold">${b.manufacturer}</td>
                <td>${b.name} ${isActive ? '<span class="badge badge-mach-supersonic">Active In Rifle</span>' : ''}</td>
                <td>${b.caliber}</td>
                <td>${b.weightGr} gr</td>
                <td class="text-emerald font-mono text-sm">${b.factoryVelocityFps ? `${b.factoryVelocityFps} fps <span class="text-muted text-xs">(${b.factoryVelocityMs} m/s)</span>` : '--'}</td>
                <td class="text-cyan font-bold">${b.bcG7 || '--'}</td>
                <td>${b.bcG1 || '--'}</td>
                <td><span class="badge">${b.dragModel}</span></td>
                <td class="text-sm text-muted">${b.recommendedTwist}</td>
                <td>
                  <button class="btn-primary-sm btn-load-bullet" data-id="${b.id}" ${isActive ? 'disabled' : ''}>
                    ${isActive ? 'Loaded' : 'Load into Rifle'}
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  renderDatabase() {
    return `
      <div class="library-panel">
        <div class="filter-bar">
          <input type="text" id="proj-search" class="form-input search-input" placeholder="🔍 Search projectile by name or manufacturer..." value="${this.searchQuery}" />
          <select id="caliber-filter" class="form-select-sm">
            <option value="all" ${this.caliberFilter === 'all' ? 'selected' : ''}>All Calibers</option>
            <option value="5.56" ${this.caliberFilter === '5.56' ? 'selected' : ''}>.223 Rem / 5.56 NATO</option>
            <option value="6mm" ${this.caliberFilter === '6mm' ? 'selected' : ''}>6mm Creedmoor</option>
            <option value="6.5" ${this.caliberFilter === '6.5' ? 'selected' : ''}>6.5 Creedmoor / PRC</option>
            <option value="308" ${this.caliberFilter === '308' ? 'selected' : ''}>.308 Win / 7.62 NATO</option>
            <option value="300" ${this.caliberFilter === '300' ? 'selected' : ''}>.300 Win Mag / .300 PRC</option>
            <option value="338" ${this.caliberFilter === '338' ? 'selected' : ''}>.338 Lapua Mag</option>
            <option value="elr" ${this.caliberFilter === 'elr' || this.caliberFilter === '50' ? 'selected' : ''}>ELR (.375 CheyTac / .50 BMG)</option>
          </select>
        </div>

        <div id="projectiles-table-wrapper" class="table-scrollable mt-3">
          ${this.renderDatabaseTable()}
        </div>
      </div>
    `;
  }

  renderBuilder() {
    const profile = appState.getActiveProfile();

    return `
      <div class="library-panel">
        <div class="builder-layout">
          <div class="builder-form-card">
            <h3>Custom Projectile Builder</h3>
            <p class="tool-desc">Enter physical bullet dimensions to compute stability and generate ballistic coefficients.</p>

            <div class="field-row">
              <label>Projectile Name</label>
              <input type="text" id="cust-name" class="form-input" placeholder="e.g. Custom 6.5mm 153.5gr Long Range Solid" />
            </div>

            <div class="field-grid-2">
              <div>
                <label>Manufacturer</label>
                <input type="text" id="cust-mfg" class="form-input" placeholder="e.g. Cutting Edge Bullets" />
              </div>
              <div>
                <label>Caliber Family</label>
                <input type="text" id="cust-caliber" class="form-input" placeholder="e.g. 6.5mm / .264" />
              </div>
            </div>

            <div class="field-grid-3">
              <div>
                <label>Weight (grains)</label>
                <input type="number" id="cust-weight" class="form-input" min="10" max="1500" value="140" />
              </div>
              <div>
                <label>Diameter (inches)</label>
                <input type="number" id="cust-dia" class="form-input" min="0.100" max="1.000" step="0.001" value="0.264" />
              </div>
              <div>
                <label>Total Length (inches)</label>
                <input type="number" id="cust-len" class="form-input" min="0.2" max="5.0" step="0.01" value="1.42" />
              </div>
            </div>

            <div class="field-grid-3">
              <div>
                <label>G7 BC (Boat-tail)</label>
                <input type="number" id="cust-bc-g7" class="form-input" min="0.05" max="1.5" step="0.005" value="0.325" />
              </div>
              <div>
                <label>G1 BC (Flat-base)</label>
                <input type="number" id="cust-bc-g1" class="form-input" min="0.05" max="2.0" step="0.005" value="0.640" />
              </div>
              <div>
                <label>Drag Model</label>
                <select id="cust-drag-model" class="form-select">
                  <option value="G7">G7 Boat-tail</option>
                  <option value="DOPPLER">Doppler VLD</option>
                  <option value="G1">G1 Gavre</option>
                </select>
              </div>
            </div>

            <button id="btn-save-custom-bullet" class="btn-primary mt-3">Save Projectile to Library</button>
            <div id="builder-validation-msg" class="mt-2"></div>
          </div>

          <div class="builder-preview-card">
            <h4>Live Gyroscopic Stability Estimate (Miller Rule)</h4>
            <p class="text-sm text-muted">Evaluated against active rifle twist rate (<strong>1:${profile.twistRateIn}"</strong>) at <strong>${profile.muzzleVelocityMs} m/s</strong>.</p>

            <div id="stability-live-hud" class="stability-hud mt-3"></div>
          </div>
        </div>
      </div>
    `;
  }

  updateLiveStability() {
    const wt = parseFloat(this.container.querySelector('#cust-weight')?.value || 140);
    const dia = parseFloat(this.container.querySelector('#cust-dia')?.value || 0.264);
    const len = parseFloat(this.container.querySelector('#cust-len')?.value || 1.42);
    const profile = appState.getActiveProfile();

    const res = calculateStability(wt, dia, len, profile.twistRateIn, profile.muzzleVelocityMs * 3.28084);

    const hud = this.container.querySelector('#stability-live-hud');
    if (!hud) return;

    hud.innerHTML = `
      <div class="stability-score-box ${res.badgeClass}">
        <span class="score-label">GYROSCOPIC STABILITY (Sg)</span>
        <span class="score-value">${res.sg}</span>
        <span class="score-status">${res.status}</span>
      </div>
      <div class="field-grid-2 mt-3">
        <div class="stat-card">
          <span class="stat-label">OPTIMAL TWIST RATE</span>
          <span class="stat-val">1 : ${res.optimalTwistIn}"</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">SECTIONAL DENSITY</span>
          <span class="stat-val">${res.sectionalDensity}</span>
        </div>
      </div>
    `;
  }

  renderRifles() {
    const profiles = appState.state.profiles;
    const activeId = appState.state.activeProfileId;

    return `
      <div class="library-panel">
        <div class="card-meta-bar">
          <h3>Saved Rifle & Optic Systems</h3>
          <div class="button-row">
            <button id="btn-add-rifle-profile" class="btn-accent-sm">➕ Add New Rifle</button>
            <button id="btn-export-profiles" class="btn-secondary-sm">📤 Export Library (JSON)</button>
            <button id="btn-import-profiles-trigger" class="btn-secondary-sm">📥 Import JSON</button>
            <input type="file" id="import-json-file" accept=".json" style="display:none;" />
          </div>
        </div>

        <div class="profiles-grid mt-3">
          ${profiles.map((p) => {
            const isActive = p.id === activeId;
            return `
              <div class="profile-card ${isActive ? 'active-profile' : ''}">
                <div class="profile-card-header">
                  <h4>${p.name}</h4>
                  ${isActive ? '<span class="badge badge-mach-supersonic">Active</span>' : ''}
                </div>
                <p class="profile-desc">${p.description}</p>
                <div class="profile-specs">
                  <div><strong>Caliber:</strong> ${p.caliber}</div>
                  <div><strong>Bullet:</strong> ${p.bullet.name}</div>
                  <div><strong>MV:</strong> ${p.muzzleVelocityMs} m/s</div>
                  <div><strong>Optic:</strong> ${p.optic?.model}</div>
                  <div><strong>Twist:</strong> 1:${p.twistRateIn}"</div>
                  <div><strong>Zero:</strong> ${p.zeroDistanceM}m</div>
                </div>
                <div class="profile-card-actions mt-3">
                  <button class="btn-primary-sm btn-activate-profile" data-id="${p.id}" ${isActive ? 'disabled' : ''}>
                    ${isActive ? 'Active Rig' : 'Select Rifle'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  render() {
    let contentHtml = '';
    switch (this.activeTab) {
      case 'builder':
        contentHtml = this.renderBuilder();
        break;
      case 'rifles':
        contentHtml = this.renderRifles();
        break;
      case 'database':
      default:
        contentHtml = this.renderDatabase();
        break;
    }

    this.container.innerHTML = `
      <div class="library-header">
        <div>
          <h2>Ballistic Equipment & Projectile Library</h2>
          <p class="subtitle">Search factory match projectiles, design custom solid bullets, and manage rifle setups</p>
        </div>
        <div class="format-button-group">
          <button class="btn-lib ${this.activeTab === 'database' ? 'active' : ''}" data-tab="database">📦 Projectiles Database</button>
          <button class="btn-lib ${this.activeTab === 'builder' ? 'active' : ''}" data-tab="builder">✏️ Custom Bullet Builder</button>
          <button class="btn-lib ${this.activeTab === 'rifles' ? 'active' : ''}" data-tab="rifles">🎯 Rifle Profiles</button>
        </div>
      </div>

      <div class="library-content-area">
        ${contentHtml}
      </div>
    `;

    // Tab switcher
    const libBtns = this.container.querySelectorAll('.btn-lib');
    libBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setTab(btn.dataset.tab);
      });
    });

    // Database events
    const updateTable = () => {
      const tableWrapper = this.container.querySelector('#projectiles-table-wrapper');
      if (tableWrapper) {
        tableWrapper.innerHTML = this.renderDatabaseTable();
        this._bindDatabaseActions();
      }
    };

    const searchInput = this.container.querySelector('#proj-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      updateTable();
    });

    const calFilter = this.container.querySelector('#caliber-filter');
    calFilter?.addEventListener('change', (e) => {
      this.caliberFilter = e.target.value;
      updateTable();
    });

    this._bindDatabaseActions();

    // Builder events
    if (this.activeTab === 'builder') {
      ['cust-weight', 'cust-dia', 'cust-len'].forEach((id) => {
        this.container.querySelector(`#${id}`)?.addEventListener('input', () => this.updateLiveStability());
      });
      this.updateLiveStability();

      const saveBtn = this.container.querySelector('#btn-save-custom-bullet');
      saveBtn?.addEventListener('click', () => {
        const bullet = {
          id: `custom-${Date.now()}`,
          name: this.container.querySelector('#cust-name')?.value || 'Custom Bullet',
          manufacturer: this.container.querySelector('#cust-mfg')?.value || 'Custom',
          caliber: this.container.querySelector('#cust-caliber')?.value || 'Custom',
          weightGr: parseFloat(this.container.querySelector('#cust-weight')?.value || 140),
          diameterIn: parseFloat(this.container.querySelector('#cust-dia')?.value || 0.264),
          lengthIn: parseFloat(this.container.querySelector('#cust-len')?.value || 1.42),
          bcG7: parseFloat(this.container.querySelector('#cust-bc-g7')?.value || 0.325),
          bcG1: parseFloat(this.container.querySelector('#cust-bc-g1')?.value || 0.640),
          dragModel: this.container.querySelector('#cust-drag-model')?.value || 'G7',
          recommendedTwist: 'Custom',
        };

        const val = validateCustomBullet(bullet);
        const msgDiv = this.container.querySelector('#builder-validation-msg');
        if (!val.valid) {
          if (msgDiv) msgDiv.innerHTML = `<p class="text-amber">⚠️ ${val.errors.join(', ')}</p>`;
          return;
        }

        appState.addCustomBullet(bullet);
        if (msgDiv) msgDiv.innerHTML = `<p class="text-emerald">✅ Saved "${bullet.name}" to Projectiles Database!</p>`;
      });
    }

    // Rifle Profile events
    if (this.activeTab === 'rifles') {
      this.container.querySelector('#btn-add-rifle-profile')?.addEventListener('click', () => {
        new RifleBuilderModal(() => this.render()).open();
      });

      this.container.querySelectorAll('.btn-activate-profile').forEach((btn) => {
        btn.addEventListener('click', () => {
          appState.setActiveProfile(btn.dataset.id);
          this.render();
        });
      });

      this.container.querySelector('#btn-export-profiles')?.addEventListener('click', () => {
        const json = appState.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ballistic_workbench_backup_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });

      const importTrigger = this.container.querySelector('#btn-import-profiles-trigger');
      const importInput = this.container.querySelector('#import-json-file');
      importTrigger?.addEventListener('click', () => importInput?.click());
      importInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const ok = appState.importJSON(evt.target.result);
            if (ok) {
              alert('Successfully imported ballistic library!');
              this.render();
            } else {
              alert('Failed to import JSON: invalid format.');
            }
          };
          reader.readAsText(file);
        }
      });
    }
  }

  _bindDatabaseActions() {
    const loadBtns = this.container.querySelectorAll('.btn-load-bullet');
    loadBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const bulletId = btn.dataset.id;
        const bullet = appState.state.projectilesLibrary.find((b) => b.id === bulletId);
        if (bullet) {
          const profile = appState.getActiveProfile();
          profile.bullet = { ...bullet };
          profile.caliber = bullet.caliber;
          if (bullet.factoryVelocityMs) {
            profile.muzzleVelocityMs = bullet.factoryVelocityMs;
          }
          profile.zeroAngleRad = null; // trigger re-zero
          appState.notify('profile');
          this.render();
        }
      });
    });
  }
}
