/**
 * Ballistic Workbench - offline sharing of one rifle or one match.
 *
 * Two carriers, both without any server:
 * - a file (`<name>.bwshare.json`): { app, type: 'share', kind, version, data }, imported from
 *   Library → Import… or by opening a share link;
 * - a link `<app url>#share=<payload>`, also drawn as a QR code. The payload is the same JSON,
 *   compressed with deflate-raw where the browser has CompressionStream ("z" prefix), otherwise
 *   plain ("j" prefix), in base64url.
 *
 * Decoding never trusts the input: size caps before and after inflating, JSON.parse only, and the
 * caller validates `data` with the app's sanitizers (state.importShared) before using it.
 */

export const SHARE_APP = 'ballistic-workbench';
export const SHARE_VERSION = 1;
export const SHARE_KINDS = ['rifle', 'match'];
/** Longest payload accepted from a link (characters) and largest decoded JSON (bytes). */
export const MAX_PAYLOAD_CHARS = 16000;
export const MAX_SHARE_JSON_BYTES = 256 * 1024;
/** Longest link a QR code is drawn for (byte mode, error correction L: version 40 holds 2,953). */
export const MAX_QR_CHARS = 2900;

const hasStreams = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Reads a stream to the end, refusing more than `max` bytes (a deflate bomb stops early). */
async function inflate(bytes, max) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** The share envelope for one item. */
export function shareEnvelope(kind, data) {
  return { app: SHARE_APP, type: 'share', kind, version: SHARE_VERSION, data };
}

/** Checks an envelope's outer shape; returns { kind, data } or null. `data` still needs sanitizing. */
export function readEnvelope(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.app !== SHARE_APP || obj.type !== 'share' || !SHARE_KINDS.includes(obj.kind)) return null;
  if (!Number.isInteger(obj.version) || obj.version < 1 || obj.version > SHARE_VERSION) return null;
  if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) return null;
  return { kind: obj.kind, data: obj.data };
}

/** Encodes an item as a link payload. */
export async function encodeShare(kind, data) {
  const json = new TextEncoder().encode(JSON.stringify(shareEnvelope(kind, data)));
  if (hasStreams()) {
    try {
      return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
    } catch {
      // Fall through to the plain form
    }
  }
  return `j${toBase64Url(json)}`;
}

/** Decodes a link payload; returns { kind, data } or null. */
export async function decodeShare(payload) {
  if (typeof payload !== 'string' || payload.length < 2 || payload.length > MAX_PAYLOAD_CHARS) return null;
  const bytes = fromBase64Url(payload.slice(1));
  if (!bytes) return null;
  let json;
  if (payload[0] === 'z') {
    if (!hasStreams()) return null;
    try {
      json = await inflate(bytes, MAX_SHARE_JSON_BYTES);
    } catch {
      return null;
    }
  } else if (payload[0] === 'j') {
    json = bytes.length <= MAX_SHARE_JSON_BYTES ? bytes : null;
  }
  if (!json) return null;
  try {
    return readEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)));
  } catch {
    return null;
  }
}

/** The payload in a location hash like "#share=…", or null. */
export function payloadFromHash(hash) {
  const m = /^#share=([A-Za-z0-9_-]+)$/.exec(hash || '');
  return m ? m[1] : null;
}

/** The app's own address (no hash or query) with the payload. */
export function shareLink(payload, loc = globalThis.location) {
  return `${loc.origin}${loc.pathname}#share=${payload}`;
}

/** A safe file name for an item name. */
export function shareFileName(name) {
  const base = String(name || 'shared').replace(/[^A-Za-z0-9 ._-]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60) || 'shared';
  return `${base}.bwshare.json`;
}
