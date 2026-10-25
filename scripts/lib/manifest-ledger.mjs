/**
 * The manifest archive ledger (#5448 step 2): what a manifest-only book has on R2, recorded on the
 * BOOK, because a manifest-only book (#7343 lazy pages) has no page docs to record it on.
 *
 * PRIOR ART: scripts/lib/lazy-pages.mjs (the one materializer; it builds page N from canvas N and
 * now applies this ledger as it does); scripts/lib/archive-miss.mjs (per-PAGE miss bookkeeping and
 * the book verdict, reused — but it writes `pages.archive_metadata`, which a lazy book does not have);
 * books.pages_archived (a counter, not a record of WHICH pages, and recountBook() resets it to zero on
 * a lazy book). None says which pages of a book with no pages are on R2.
 *
 * WHERE. `books.archive_metadata.manifest_ledger` — a sub-key of an existing field, not a new column
 * (field-sprawl.md; the validator binds the top level). Pure codec here, NO imports beyond node and
 * the key guard, so lazy-pages.mjs can read it without pulling in sharp or the fetch stack.
 *
 *   { v: 1,
 *     fp,         sha1 (16 hex) of the canvases' image URLs in order — the PAIRING check
 *     canvases,   canvas count when the ledger was started
 *     base,       public URL base the objects were written under (from storagePut's own answer)
 *     host,       the image host (the lane this book belongs to)
 *     done,       base64 bitmap, bit n-1 = page n is on R2 at pages/<bookId>/<NNNN>.jpg
 *     dims,       base64 Uint16LE [w, h] per page of what was STORED (0 = unknown)
 *     native,     same shape, what the source says native is; only when info.json was read
 *     miss,       { "<n>": count } pages that answered 404/410 to their URL (sparse)
 *     n_done, bytes, started_at, updated_at,
 *     complete,   every imaged canvas is stored, or a tolerated gap (bookVerdict)
 *     exhausted } nothing left to fetch, but too many gaps to be complete: lanes stop drawing it
 *
 * THE PAIRING (paired-artifacts.md). The archiver stores canvas n as page n. materializePages builds
 * page n from canvas n of the manifest IT fetches. Those are the same image only if the manifest did
 * not change in between, so the ledger carries a fingerprint of the image URL list and
 * materializePages applies it ONLY when its own list has the same fingerprint. A mismatch applies
 * nothing (fail closed): the pages are then archived again the ordinary way.
 *
 * Compact on purpose: ~4 bytes of bitmap+dims per page in base64, about 1.5 KB for a 286-page book,
 * against ~286 page docs it stands in for.
 */

import { createHash } from 'node:crypto';
import { assertBookScopedKey } from './r2-key.mjs';

export const LEDGER_FIELD = 'archive_metadata.manifest_ledger';
export const LEDGER_VERSION = 1;

/** Fingerprint of an ordered list of canvas image URLs ('' for a canvas with no image). */
export function manifestFingerprint(photos) {
  if (!Array.isArray(photos)) throw new TypeError('manifestFingerprint: photos must be an array');
  return createHash('sha1').update(photos.map(p => p || '').join('\n')).digest('hex').slice(0, 16);
}

/** The R2 key of page `n` of a book. Book-scoped by construction, and checked anyway (#3362). */
export function ledgerKey(bookId, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`ledgerKey: page number must be a positive integer (got ${n})`);
  const key = `pages/${bookId}/${String(n).padStart(4, '0')}.jpg`;
  assertBookScopedKey(key, bookId, 'manifest-ledger');
  return key;
}

const bitsBytes = (n) => Math.ceil(n / 8);
const decode = (b64, len) => {
  const buf = Buffer.alloc(len);
  if (typeof b64 === 'string' && b64) Buffer.from(b64, 'base64').copy(buf, 0, 0, len);
  return buf;
};

/** A fresh ledger for a manifest of `photos`. */
export function newLedger({ photos, base = null, host = null, now = new Date() }) {
  const n = photos.length;
  return {
    v: LEDGER_VERSION,
    fp: manifestFingerprint(photos),
    canvases: n,
    base,
    host,
    done: Buffer.alloc(bitsBytes(n)).toString('base64'),
    dims: Buffer.alloc(n * 4).toString('base64'),
    miss: {},
    n_done: 0,
    bytes: 0,
    complete: false,
    started_at: now,
    updated_at: now,
  };
}

/**
 * A mutable view over a stored ledger: decode once, mark pages, encode once per flush.
 * Page numbers are 1-based, like `pages.page_number`.
 */
export function openLedger(stored) {
  if (!stored || stored.v !== LEDGER_VERSION || !Number.isInteger(stored.canvases)) throw new Error('openLedger: not a v1 manifest ledger');
  const n = stored.canvases;
  const done = decode(stored.done, bitsBytes(n));
  const dims = decode(stored.dims, n * 4);
  let native = stored.native ? decode(stored.native, n * 4) : null;
  const miss = { ...(stored.miss || {}) };
  let bytes = stored.bytes || 0;
  const inRange = (p) => Number.isInteger(p) && p >= 1 && p <= n;
  const isDone = (p) => inRange(p) && (done[(p - 1) >> 3] & (1 << ((p - 1) & 7))) !== 0;
  const countDone = () => { let c = 0; for (let p = 1; p <= n; p++) if (isDone(p)) c++; return c; };
  return {
    canvases: n,
    isDone,
    missCount: (p) => miss[String(p)] || 0,
    /** Record page `p` as stored, with what was stored and (when known) what native is. */
    markDone(p, { width = 0, height = 0, bytes: b = 0, nativeWidth = 0, nativeHeight = 0 } = {}) {
      if (!inRange(p)) throw new Error(`markDone: page ${p} outside 1..${n}`);
      done[(p - 1) >> 3] |= 1 << ((p - 1) & 7);
      dims.writeUInt16LE(Math.min(width || 0, 65535), (p - 1) * 4);
      dims.writeUInt16LE(Math.min(height || 0, 65535), (p - 1) * 4 + 2);
      if (nativeWidth || nativeHeight) {
        native ??= Buffer.alloc(n * 4);
        native.writeUInt16LE(Math.min(nativeWidth || 0, 65535), (p - 1) * 4);
        native.writeUInt16LE(Math.min(nativeHeight || 0, 65535), (p - 1) * 4 + 2);
      }
      delete miss[String(p)];
      bytes += b;
    },
    markMiss(p) {
      if (!inRange(p)) throw new Error(`markMiss: page ${p} outside 1..${n}`);
      miss[String(p)] = (miss[String(p)] || 0) + 1;
    },
    /** Stored and native dimensions of page `p` (0 = unknown). */
    dimsOf(p) {
      const o = (p - 1) * 4;
      return {
        width: dims.readUInt16LE(o), height: dims.readUInt16LE(o + 2),
        nativeWidth: native ? native.readUInt16LE(o) : 0, nativeHeight: native ? native.readUInt16LE(o + 2) : 0,
      };
    },
    countDone,
    /** The stored shape, for a `$set` of LEDGER_FIELD. */
    encode(extra = {}) {
      return {
        ...stored,
        done: done.toString('base64'),
        dims: dims.toString('base64'),
        ...(native ? { native: native.toString('base64') } : {}),
        miss: { ...miss },
        n_done: countDone(),
        bytes,
        ...extra,
      };
    },
  };
}

/**
 * The page-doc fields the ledger says page `p` should carry, or null when the page is not on R2.
 * Field names are dimensionFields()'s (iiif-utils.mjs), so a page archived from the manifest reads
 * exactly like one archived page by page.
 */
export function ledgerPageFields(stored, view, bookId, p) {
  if (!view.isDone(p) || typeof stored.base !== 'string' || !/^https?:\/\//.test(stored.base)) return null;
  const { width, height, nativeWidth, nativeHeight } = view.dimsOf(p);
  const out = { archived_photo: `${stored.base.replace(/\/+$/, '')}/${ledgerKey(bookId, p)}` };
  if (width) out.image_width = width;
  if (height) out.image_height = height;
  if (nativeWidth) out['iiif_info.width'] = nativeWidth;
  if (nativeHeight) out['iiif_info.height'] = nativeHeight;
  return out;
}

/**
 * The page fields a stored ledger proves, for page docs built from `photos` (the same canvases, in
 * order). Returns `{ fields: Map<pageNumber, $set fields>, mismatch }`; mutates nothing. A
 * fingerprint mismatch returns no fields at all: the pairing is not proven, so nothing is claimed.
 */
export function ledgerFieldsFor(stored, bookId, photos) {
  if (!stored) return { fields: new Map(), mismatch: false };
  if (stored.v !== LEDGER_VERSION || stored.fp !== manifestFingerprint(photos) || stored.canvases !== photos.length) {
    return { fields: new Map(), mismatch: true };
  }
  const view = openLedger(stored);
  const fields = new Map();
  for (let p = 1; p <= photos.length; p++) {
    if (!photos[p - 1]) continue;
    const f = ledgerPageFields(stored, view, bookId, p);
    if (f) fields.set(p, f);
  }
  return { fields, mismatch: false };
}
