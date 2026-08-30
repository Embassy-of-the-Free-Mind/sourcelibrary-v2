/**
 * One definition of "is this page archived?" — because there were at least four.
 *
 * ## Why this module exists
 *
 * #4239 inventoried ≥15 archive writers, 3 storage eras and 3 half-blind
 * monitors, and asked for one metric. On 2026-08-30 three different methods
 * were run against the same question ("how many pages lack a master?") and
 * returned 1.48M, 4.03M and 5.18M — a 3.5x spread. None was obviously wrong;
 * they were answering *different questions* while using the same word.
 *
 * The three questions, which must never be collapsed again:
 *
 *   1. RECORD  — does a page doc claim an R2 URL?           (cheap, corpus-wide)
 *   2. FILE    — does the object behind that URL exist?      (HEAD, sampled)
 *   3. MASTER  — is that object the full-resolution original? (dimensions, sampled)
 *
 * Question 3 is the one nothing measured, and it is the one preservation turns
 * on. #4194 documented the state that makes it necessary: a page can serve
 * 100% from R2 (`display_photo` + thumb) while the only full-resolution copy
 * sits on the source institution's server. It looks archived to any query that
 * asks "is there an R2 URL", and if that institution changes a URL scheme we
 * serve 1200px forever and can never regenerate anything larger.
 *
 * ## The trap that makes path-based classification impossible
 *
 * You cannot tell a master from a derivative by its R2 key. Measured 2026-08-30:
 * `pages/{bookId}/{NNNN}.jpg` is documented in `.claude/docs/r2-storage.md` as
 * the "1200px display" variant, and in production it holds full-resolution
 * masters — 1361x2517 written by `archive-acquired.ts` (which resizes nothing),
 * 2370x3816 written by the pipeline. Same key shape, and neither is 1200px.
 *
 * So any classifier keyed on the path is guessing. `classifyPageRecord()` below
 * therefore reports MASTER_OR_DERIVATIVE rather than pretending, and only
 * `classifyPagePreservation()` — which reads actual pixel dimensions — returns
 * a verdict. A cheap wrong number is worse than an honest uncertain one; that
 * is how the 3.5x spread happened.
 *
 * Related: #4239 (one metric), #4194 (three states), #3186 (~2.1M pages below
 * master resolution — the same question at a different threshold), #4190
 * (`pages_archived` lies in both directions, and archive-bulk selects by it).
 */

import { fetchIiifInfo, upgradeToFullRes } from './iiif-utils.mjs';

export const R2_HOST = 'images.sourcelibrary.org';
const R2_URL_RE = /^https:\/\/images\.sourcelibrary\.org\//;
const ARCHIVE_FAILED_RE = /^failed:/;

/**
 * Record-level states. Ordered from best to worst; `NONE` is the only one that
 * means "we hold nothing".
 */
export const RecordState = {
  /** An R2 object is claimed, but only dimensions can say whether it is the master. */
  MASTER_OR_DERIVATIVE: 'master_or_derivative',
  /** R2 holds a display/thumb derivative; no field claims a full-res original. */
  DERIVATIVE_ONLY: 'derivative_only',
  /** Serves from the source institution only — nothing of ours. */
  EXTERNAL_ONLY: 'external_only',
  /** A previous archive attempt recorded a failure in `archived_photo`. */
  FAILED: 'failed',
  /** No image reference at all. */
  NONE: 'none',
};

/** Preservation verdicts, from `classifyPagePreservation`. */
export const PreservationState = {
  /** Stored object is at (or near) the source's native resolution. */
  MASTER: 'master',
  /** Stored object is materially smaller than the source — #3186 debt. */
  BELOW_MASTER: 'below_master',
  /** Nothing of ours is stored. */
  MISSING: 'missing',
  /** Could not determine — network, no info.json, unparseable image. */
  UNKNOWN: 'unknown',
};

/**
 * A stored image counts as the master when it reaches this fraction of the
 * source's native width. Not 1.0: archivers apply `sharp().rotate()` (EXIF
 * orientation) and re-encode, and some IIIF servers cap `full/full` slightly
 * below the advertised native size via `maxWidth`. 0.95 tolerates that without
 * admitting a 1200px derivative of a 2400px scan.
 */
export const MASTER_WIDTH_RATIO = 0.95;

const isR2 = (u) => typeof u === 'string' && R2_URL_RE.test(u);

/**
 * Classify one page doc without touching the network.
 *
 * Cheap enough to run corpus-wide, and deliberately unable to distinguish a
 * master from a derivative — see the module header. Use this for "how much is
 * on R2 at all", never for "how much is preserved".
 *
 * @param {object} page  a `pages` document
 * @returns {{state: string, r2Url: string|null, sourceUrl: string|null}}
 */
export function classifyPageRecord(page) {
  const archived = page?.archived_photo;
  const sourceUrl = page?.photo_original || page?.photo || null;

  if (typeof archived === 'string' && ARCHIVE_FAILED_RE.test(archived)) {
    // A `failed:` marker hides the page from every future archiver run, so it
    // is a distinct state, not a flavour of NONE — see
    // invariants/archive-fetch-failures.md.
    return { state: RecordState.FAILED, r2Url: null, sourceUrl };
  }

  if (isR2(archived)) {
    return { state: RecordState.MASTER_OR_DERIVATIVE, r2Url: archived, sourceUrl };
  }

  // No claimed original, but we may still be serving our own derivative. This
  // is #4194's middle state and the one that reads as "archived" to a naive
  // "is there an R2 URL anywhere" query.
  const derivative = [page?.cropped_photo, page?.display_photo, page?.thumbnail_blob, page?.image_thumb]
    .find(isR2);
  if (derivative) {
    return { state: RecordState.DERIVATIVE_ONLY, r2Url: derivative, sourceUrl };
  }

  if (sourceUrl) return { state: RecordState.EXTERNAL_ONLY, r2Url: null, sourceUrl };
  return { state: RecordState.NONE, r2Url: null, sourceUrl: null };
}

/**
 * Read a JPEG's pixel dimensions from its header without downloading the file.
 *
 * Requests only the leading bytes and walks the JPEG segment markers to the
 * SOF frame. A full-resolution page master is ~1 MB; the header sits in the
 * first few KB, so this is ~100x cheaper than fetching the image and is what
 * makes a preservation check affordable at sample scale.
 *
 * @returns {Promise<{width: number, height: number}|null>} null if not a
 *   parseable JPEG, or the range request failed.
 */
export async function probeStoredDimensions(url, opts = {}) {
  const { bytes = 131072, timeoutMs = 20000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Range: `bytes=0-${bytes - 1}` },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // not JPEG

    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15 carry the frame dimensions; DHT/JPG/DAC share the range.
      const isSOF = marker >= 0xC0 && marker <= 0xCF
        && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSOF) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null; // malformed
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Native width of a source image, by whichever route the source supports.
 *
 * `fetchIiifInfo` is authoritative and costs no image bytes, but it returns
 * null for anything that is not a IIIF URL — which is most of this corpus by
 * page count (Internet Archive serves plain JPEGs). Measured 2026-08-30, an
 * info.json-only implementation left 93% of the MASTER tier as `no-native-dims`,
 * i.e. blind precisely where preservation is decided.
 *
 * The fallback reads the source JPEG's own SOF header over a ranged GET, which
 * works for any JPEG regardless of protocol. `upgradeToFullRes` is applied
 * first: a stored `/full/1200,/` URL would otherwise report 1200 as "native"
 * and every derivative would grade itself a perfect master.
 *
 * COST NOTE: unlike the info.json route, this hits the institution's image
 * server. Callers must keep this tier sampled and paced — see the serial
 * probing in `scripts/audit/archive-coverage.mjs`. Three hosts blocked us in
 * 48 hours during August 2026 (#4395, and the IA/Wellcome incidents); an
 * unpaced audit is exactly how a fourth would happen.
 */
export async function fetchNativeWidth(sourceUrl, opts = {}) {
  try {
    const info = await fetchIiifInfo(sourceUrl, opts);
    if (info?.width) return info.width;
  } catch { /* fall through to the header probe */ }

  try {
    const dims = await probeStoredDimensions(upgradeToFullRes(sourceUrl), opts);
    if (dims?.width) return dims.width;
  } catch { /* give up honestly */ }

  return null;
}

/**
 * Decide whether what we hold for a page is the full-resolution master.
 *
 * Compares the stored object's width against the source's native width from
 * IIIF `info.json`. Two network calls per page (one ranged GET, one info.json),
 * so this is a SAMPLED tier — never run it corpus-wide.
 *
 * Returns UNKNOWN rather than guessing whenever either side is unavailable.
 * An unknown is not a failure: it is the honest answer, and counting unknowns
 * separately is what keeps this metric from drifting into the optimism that
 * produced the 3.5x spread.
 *
 * @param {object} page  a `pages` document
 * @param {object} [opts] passed through to `fetchIiifInfo`
 * @returns {Promise<{state: string, storedWidth?: number, nativeWidth?: number,
 *   ratio?: number, reason?: string}>}
 */
export async function classifyPagePreservation(page, opts = {}) {
  const rec = classifyPageRecord(page);

  if (rec.state === RecordState.NONE || rec.state === RecordState.EXTERNAL_ONLY
      || rec.state === RecordState.FAILED) {
    return { state: PreservationState.MISSING, reason: rec.state };
  }

  const stored = await probeStoredDimensions(rec.r2Url, opts);
  if (!stored) {
    // The record claims an object that we could not read. That is either a
    // dead pointer (record-level coverage overstating reality) or a transient
    // failure, and this tier cannot tell them apart — the FILE tier can.
    return { state: PreservationState.UNKNOWN, reason: 'stored-unreadable' };
  }

  if (!rec.sourceUrl) {
    // Uploads, PDFs and split pages have no upstream to compare against; the
    // object we hold IS the original by definition.
    return {
      state: PreservationState.MASTER,
      storedWidth: stored.width,
      reason: 'no-upstream-source',
    };
  }

  const native = await fetchNativeWidth(rec.sourceUrl, opts);
  if (!native) {
    return { state: PreservationState.UNKNOWN, storedWidth: stored.width, reason: 'no-native-dims' };
  }

  const ratio = stored.width / native;
  return {
    state: ratio >= MASTER_WIDTH_RATIO ? PreservationState.MASTER : PreservationState.BELOW_MASTER,
    storedWidth: stored.width,
    nativeWidth: native,
    ratio: Math.round(ratio * 1000) / 1000,
  };
}

/**
 * Host a page's images would be fetched FROM, for work-list sharding (#4397).
 * Returns null when the page needs no fetch.
 */
export function pageFetchHost(page) {
  const rec = classifyPageRecord(page);
  if (rec.state === RecordState.MASTER_OR_DERIVATIVE) return null;
  if (!rec.sourceUrl) return null;
  try { return new URL(rec.sourceUrl).hostname; } catch { return null; }
}

/** Empty tally shaped for `classifyPageRecord` results. */
export function emptyRecordTally() {
  return Object.fromEntries(Object.values(RecordState).map(s => [s, 0]));
}

/** Empty tally shaped for `classifyPagePreservation` results. */
export function emptyPreservationTally() {
  return Object.fromEntries(Object.values(PreservationState).map(s => [s, 0]));
}
