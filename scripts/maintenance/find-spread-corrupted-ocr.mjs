/**
 * Enumerate (and optionally re-queue) split pages that were OCR'd on the full
 * spread instead of the cropped half — the #2288/#2294 bug class (#2298).
 *
 * Two enumeration paths, both reported:
 *   1. PROVENANCE (exact, post-#2297): pages where `ocr.source_url` is set and
 *      ≠ `getPageSource(page)`. Use audit-ocr-source-drift.mjs for the go-forward
 *      view; here it's folded in for completeness.
 *   2. AR-SWEEP (the backlog, what exists today): `split_from_spread` pages with
 *      OCR, whose *reconstructed* OCR source (the old buggy picker:
 *      crop&&cropped_photo ▸ archived_photo ▸ photo_original ▸ photo) is NOT a
 *      half-shaped URL, AND whose fetched image has aspect ratio > 1.1 (a spread).
 *      AR is the ground truth — URL shape over-flags (a `split_from_spread` page
 *      can legitimately carry a single portrait `archived_photo`).
 *
 * DEFAULT IS DRY-RUN: reports the count + a sample. Pass --execute to clear
 * `ocr` on the confirmed set so the pipeline cron re-OCRs them through the
 * corrected getPageSource (no direct batch submission here — reuses the
 * existing pipeline, which now picks the cropped half).
 *
 * Designed to run on Hetzner (fast Atlas scans + local image fetches). From a
 * laptop the unindexed split_from_spread scan is slow — use --limit to bound it.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/find-spread-corrupted-ocr.mjs [--limit N] [--ar-sample M] [--execute] [--json]
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { getPageSource } from '../lib/page-image-url.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const LIMIT = parseInt(arg('limit', '0'), 10);          // 0 = no cap (Hetzner)
const AR_SAMPLE = parseInt(arg('ar-sample', '0'), 10);  // 0 = AR-check ALL candidates
const EXECUTE = process.argv.includes('--execute');
const AS_JSON = process.argv.includes('--json');

const usable = (u) => typeof u === 'string' && u.startsWith('http');
const isHalfShaped = (u) =>
  usable(u) && (/\/pages\/[^/]+\/sp[^/]+\.jpg/i.test(u) || /\/cropped\//.test(u));
// The OLD buggy picker, reconstructed — what these pages were OCR'd through.
const oldPick = (p) => {
  if (p.crop && usable(p.cropped_photo)) return p.cropped_photo;
  if (usable(p.archived_photo) && !p.archived_photo.startsWith('failed:')) return p.archived_photo;
  return p.photo_original || p.photo || null;
};

async function arOf(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    return m.width && m.height ? m.width / m.height : null;
  } catch { return null; }
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
await client.connect();
const pages = client.db('bookstore').collection('pages');

const filter = { split_from_spread: true, 'ocr.model': { $exists: true } };
const proj = {
  projection: {
    _id: 0, id: 1, book_id: 1, page_number: 1,
    'ocr.source_url': 1,
    crop: 1, cropped_photo: 1, archived_photo: 1, photo_original: 1, photo: 1, split_from_spread: 1,
  },
};

const cursor = LIMIT ? pages.find(filter, proj).limit(LIMIT) : pages.find(filter, proj);

let scanned = 0;
let provenanceDrift = 0;
const arCandidates = [];   // non-half reconstructed source → needs AR check
for await (const p of cursor) {
  scanned++;
  // Path 1: exact, where provenance exists.
  if (usable(p.ocr?.source_url)) {
    const expected = getPageSource(p);
    if (expected && p.ocr.source_url !== expected) provenanceDrift++;
  }
  // Path 2: AR-sweep candidate set (the backlog).
  const fed = oldPick(p);
  if (usable(fed) && !isHalfShaped(fed)) arCandidates.push({ ...p, _fed: fed });
}

// AR-confirm the candidates (this is the slow part — bound with --ar-sample on a laptop).
const toCheck = AR_SAMPLE ? arCandidates.slice(0, AR_SAMPLE) : arCandidates;
let measured = 0, confirmedSpread = 0, fetchErr = 0;
const corrupted = [];
for (const p of toCheck) {
  const ar = await arOf(p._fed);
  if (ar === null) { fetchErr++; continue; }
  measured++;
  if (ar > 1.1) { confirmedSpread++; corrupted.push(p); }
}

const projectedCorrupted = AR_SAMPLE && measured
  ? Math.round(arCandidates.length * (confirmedSpread / measured))
  : confirmedSpread;

const report = {
  scanned,
  provenance_drift_exact: provenanceDrift,
  ar_candidates: arCandidates.length,
  ar_measured: measured,
  ar_confirmed_spread: confirmedSpread,
  fetch_errors: fetchErr,
  spread_fraction_of_candidates: measured ? +(confirmedSpread / measured).toFixed(3) : 0,
  CORRUPTED_count: AR_SAMPLE ? `~${projectedCorrupted} (projected from ${measured}-page AR sample)` : confirmedSpread,
  mode: EXECUTE ? 'EXECUTE' : 'DRY-RUN',
};

if (EXECUTE && corrupted.length) {
  // Per-page so we can preserve each page's own corrupted OCR for audit/rollback.
  // The pipeline cron re-OCRs any page whose ocr.data is absent (orchestrator
  // selectors at lines ~1394/1724/2959) — now through the corrected getPageSource.
  let cleared = 0;
  for (const p of corrupted) {
    const full = await pages.findOne({ id: p.id }, { projection: { ocr: 1 } });
    await pages.updateOne(
      { id: p.id },
      {
        // Preserve, don't destroy: keep the bad OCR under a backup field so the
        // repair is reversible and auditable (which image, what text).
        $set: {
          ocr_corrupted_backup: { ...full?.ocr, corrupted_source: p._fed, flagged_by: 'spread-corruption-2298', flagged_at: new Date() },
          updated_at: new Date(),
        },
        $unset: { ocr: '' },
      }
    );
    cleared++;
  }
  report.cleared_for_reocr = cleared;
}

console.log(AS_JSON ? JSON.stringify({ ...report, sample: corrupted.slice(0, 15).map((p) => ({ id: p.id, book_id: p.book_id, page: p.page_number, fed: p._fed, should_be: getPageSource(p) })) }, null, 2)
  : Object.entries(report).map(([k, v]) => `${k}: ${v}`).join('\n'));

if (!EXECUTE && corrupted.length) {
  console.log(`\nDRY-RUN — ${corrupted.length} confirmed corrupted pages NOT modified. Re-run with --execute to clear their OCR for re-processing.`);
  for (const p of corrupted.slice(0, 10)) {
    console.log(`  ${p.book_id}/${p.page_number}  fed=${p._fed.replace('https://images.sourcelibrary.org/', '')}  → should be ${(getPageSource(p) || '').replace('https://images.sourcelibrary.org/', '')}`);
  }
}

await client.close();
