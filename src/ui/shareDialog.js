/**
 * Ballistic Workbench - share dialog and shared-item import.
 *
 * openShareDialog: shows a QR code of the share link (scan it with another phone's camera), and
 * buttons to copy the link, save a .bwshare.json file or use the system share sheet. Nothing is
 * uploaded: the link carries the data itself.
 * confirmSharedImport: asks before adding a rifle or match that arrived by link or file, then
 * merges it with state.importShared (validated; never overwrites).
 *
 * The QR code is drawn black on white whatever the theme: scanners need a light quiet zone.
 */

import qrcode from '../../vendor/qrcode-generator/2.0.4/qrcode.mjs';
import { appState } from '../core/state.js';
import { esc } from '../core/escape.js';
import { encodeShare, shareLink, shareEnvelope, shareFileName, MAX_QR_CHARS } from '../core/share.js';
import { icon } from './icons.js';
import { toast } from './notify.js';

const QR_INK = '#000000';
const QR_PAPER = '#FFFFFF';
const KIND_LABEL = { rifle: 'rifle', match: 'match' };

function openDialog(html, trigger, onClose) {
  const holder = document.createElement('div');
  // eslint-disable-next-line no-unsanitized/property -- reviewed: callers pass constants, icons and esc()'d strings only
  holder.innerHTML = html;
  const dialog = holder.firstElementChild;
  document.body.append(dialog);
  const done = () => {
    dialog.remove();
    onClose?.();
  };
  if (typeof LadaGlass !== 'undefined' && LadaGlass.overlay?.open) {
    LadaGlass.overlay.open(dialog, { trigger, modal: true, onClose: done });
  } else {
    dialog.addEventListener('close', done);
    dialog.showModal();
  }
  return dialog;
}

function closeDialog(dialog, value = '') {
  if (typeof LadaGlass !== 'undefined' && LadaGlass.overlay?.close) LadaGlass.overlay.close(dialog, value);
  else dialog.close(value);
}

/** Draws a QR code for `text` on the canvas; returns false when it does not fit. */
function drawQr(canvas, text) {
  let qr;
  try {
    qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
  } catch {
    return false;
  }
  const n = qr.getModuleCount();
  const quiet = 4;
  const cssSize = Math.min(320, Math.max(200, (n + quiet * 2) * 3));
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  const cell = canvas.width / (n + quiet * 2);
  ctx.fillStyle = QR_PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = QR_INK;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(Math.floor((c + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
  return true;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shows the share dialog for one rifle or match. */
export async function openShareDialog({ kind, data, name, trigger = null }) {
  const payload = await encodeShare(kind, data);
  const link = shareLink(payload);
  const label = KIND_LABEL[kind] || 'item';
  const fitsQr = link.length <= MAX_QR_CHARS;
  const canShare = typeof navigator.share === 'function';
  const dialog = openDialog(`
    <dialog class="lg-modal share-dialog" aria-labelledby="share-title" aria-describedby="share-sub">
      <div class="rifle-dialog-head">
        <div class="rifle-dialog-heading">
          <h2 class="lg-modal-title" id="share-title">${icon('share')} Share ${label}</h2>
          <p class="lg-muted" id="share-sub">${esc(name)}</p>
        </div>
        <button type="button" class="lg-btn lg-btn-ghost lg-btn-icon" data-lg-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="lg-modal-body share-body">
        ${fitsQr
          ? `<div class="share-qr-wrap"><canvas class="share-qr" id="share-qr" role="img" aria-label="QR code with the link to this ${label}"></canvas></div>
             <p class="lg-small lg-muted share-howto">Scan with the other phone's camera: the link opens Ballistic Workbench and asks before adding the ${label}. The data is in the link itself; nothing is uploaded.</p>`
          : `<div class="lg-alert lg-alert-info" role="status">${icon('info')}<div><strong>Too large for a QR code</strong><p>Send the file or the link instead.</p></div></div>`}
        <p class="lg-small lg-muted share-howto">The link points to this copy of the app (${esc(location.host)}). The other device must be able to open that address; otherwise send the file and open it there with Library → Import.</p>
      </div>
      <div class="lg-modal-actions share-actions">
        <button type="button" class="lg-btn" id="share-copy">${icon('copy')} Copy link</button>
        <button type="button" class="lg-btn" id="share-file">${icon('download')} Save file</button>
        ${canShare ? `<button type="button" class="lg-btn lg-btn-primary" id="share-native">${icon('share')} Share…</button>` : ''}
      </div>
    </dialog>`, trigger);

  if (fitsQr) drawQr(dialog.querySelector('#share-qr'), link);
  dialog.querySelector('#share-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied', 'ok');
    } catch {
      toast('Could not copy the link', 'bad', 'Your browser blocked the clipboard. Use Save file instead.');
    }
  });
  dialog.querySelector('#share-file')?.addEventListener('click', () => {
    download(shareFileName(name), JSON.stringify(shareEnvelope(kind, data), null, 2));
    toast('File saved', 'ok', 'Open it on the other device with Library → Import.');
  });
  dialog.querySelector('#share-native')?.addEventListener('click', async () => {
    try {
      await navigator.share({ title: `${name} (Ballistic Workbench)`, url: link });
    } catch {
      // Cancelled or refused: nothing to do
    }
  });
  return dialog;
}

/** One line describing a shared item, for the confirmation. Plain text; escaped by the caller. */
function summary(kind, data) {
  if (kind === 'rifle') {
    const b = data.bullet || {};
    return [b.name, Number.isFinite(data.muzzleVelocityMs) ? `${Math.round(data.muzzleVelocityMs)} m/s` : ''].filter(Boolean).join(' · ');
  }
  const stages = Array.isArray(data.stages) ? data.stages : [];
  const targets = stages.reduce((n, s) => n + (Array.isArray(s?.targets) ? s.targets.length : 0), 0);
  return `${stages.length} ${stages.length === 1 ? 'stage' : 'stages'}, ${targets} ${targets === 1 ? 'target' : 'targets'}`;
}

/**
 * Asks before adding a shared rifle or match. Resolves with the import result, or null when the
 * user declined. `data` is untrusted: it is only shown escaped and is validated by importShared.
 */
export function confirmSharedImport({ kind, data }) {
  return new Promise((resolve) => {
    const label = KIND_LABEL[kind] || 'item';
    const name = typeof data?.name === 'string' && data.name.trim() ? data.name.slice(0, 120) : `Shared ${label}`;
    let result = null;
    const dialog = openDialog(`
      <dialog class="lg-modal share-dialog" aria-labelledby="import-title" aria-describedby="import-sub">
        <div class="rifle-dialog-head">
          <div class="rifle-dialog-heading">
            <h2 class="lg-modal-title" id="import-title">${icon('download')} Add a shared ${label}?</h2>
            <p class="lg-muted" id="import-sub">Someone shared this ${label} with you.</p>
          </div>
        </div>
        <div class="lg-modal-body">
          <p><strong>${esc(name)}</strong></p>
          <p class="lg-muted">${esc(summary(kind, data))}</p>
          <p class="lg-small lg-muted">It is added next to your own ${label === 'rifle' ? 'rifles' : 'matches'}; nothing you have is replaced. Values are checked first.</p>
        </div>
        <div class="lg-modal-actions">
          <button type="button" class="lg-btn" data-lg-close value="no">Don't add</button>
          <button type="button" class="lg-btn lg-btn-primary" id="import-yes">${icon('plus')} Add ${label}</button>
        </div>
      </dialog>`, null, () => resolve(result));
    dialog.querySelector('#import-yes')?.addEventListener('click', () => {
      result = appState.importShared(kind, data);
      closeDialog(dialog, 'yes');
    });
  });
}
