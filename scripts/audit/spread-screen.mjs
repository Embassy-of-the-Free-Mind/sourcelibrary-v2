#!/usr/bin/env node
/**
 * Which visible books are still served as unsplit two-leaf spreads? (#6114)
 *
 * PRIOR ART: scripts/migration/backfill-split-detection.mjs, scripts/ar-gate-remaining.mjs
 *   — both download one image per book and WRITE split flags from a single image.
 *   This screen is read-only, downloads nothing, and samples 9 pages per book from
 *   fields already stored. The pixel gutter detector in split-book.mjs parks
 *   woodblock books (#6099), so it is not a screen either.
 *
 * WHY
 * ---
 * Whole-spread OCR drops small-print attributions and lost ~40% of a lite-read
 * spread on the kōan anthology (#6099). Sampling found unsplit spreads in most LoC,
 * Harvard and NDL Chinese books. Before splitting more, we need the denominator.
 *
 * SIGNAL (measured 2026-10-07, by eye on contact sheets)
 * ------
 * FLAGGED = no page carries a split marker AND the median stored aspect ratio
 * (image_width/image_height) is between 1.05 and 2.2. The pilot spreads measure 1.15.
 *  - Two split markers exist: split_from_spread (split-book.mjs) and split_from /
 *    crop / cropped_photo (the older crop path, which leaves image_width/height at the
 *    SPREAD's size — without it, 9/16 BPH "landscape" books were already single pages).
 *  - The OCR's <columns>2 tag is reported (col2Majority) but does not flag: portrait
 *    two-column prints tag 2 (7/8 false positives), and a Japanese spread tagged 0/9.
 *  - > 2.2:1 is a pothi folio, palm leaf or scroll, not an open book.
 * split-candidates.tsv further drops typed not-a-codex objects (NOT_A_CODEX_*).
 * Precision on 24 random non-BL flags: 14/24 spreads; 14/17 after those exclusions.
 *
 * POSITIVE CONTROL
 * ----------------
 * --control runs the same classifier over the pilot book's ARCHIVED spreads
 * (page_type 'archived-spread', 69bd0afdb01b17638a098546). It must flag; the live
 * (split) leaves of the same book must not. The full run refuses to start if not.
 *
 * Usage (read-only):
 *   node --env-file=.env.production.local scripts/audit/spread-screen.mjs --control
 *   node --env-file=.env.production.local scripts/audit/spread-screen.mjs --out <dir> [--limit N] [--concurrency 16]
 * Output: <dir>/spread-screen.jsonl (one row per book, resumable), <dir>/split-candidates.tsv,
 * summary on stdout.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const CONTROL_ONLY = args.includes('--control');
const OUT_DIR = arg('--out', null);
const LIMIT = parseInt(arg('--limit', '0'), 10);
const CONCURRENCY = parseInt(arg('--concurrency', '16'), 10);
const SAMPLE = 9;
// Landscape objects that are not open books, typed by eye on 24 random flags (2026-10-07):
// BL Tibetan = 2-4 pothi folios photographed in one frame (a different defect: several leaves per
// image); Met/ORAEC = ostraca and papyri; Sanskrit/Javanese/etc. = pothi and palm leaves.
const NOT_A_CODEX_PROVIDERS = new Set(['bl', 'met', 'oraec', 'wikimedia_commons']);
const NOT_A_CODEX_LANGS = new Set(['Tibetan', 'Sanskrit', 'Egyptian hieroglyphs', 'Javanese', 'Balinese', 'Pali', 'Burmese', 'Sinhala', 'Coptic']);
const PILOT = '69bd0afdb01b17638a098546';

const COLUMNS_RE = /<columns>\s*([^<]*?)\s*<\/columns>/;

/** Classify a set of page docs. Pure — the control and the screen share it. */
export function classify(pages) {
  const withOcr = pages.filter(p => typeof p.ocr?.data === 'string' && p.ocr.data.length > 0);
  const tagged = withOcr.map(p => p.ocr.data.match(COLUMNS_RE)?.[1]).filter(Boolean);
  const col2 = tagged.filter(t => t === '2').length;
  const ars = pages.filter(p => p.image_width > 0 && p.image_height > 0).map(p => p.image_width / p.image_height).sort((a, b) => a - b);
  const medianAr = ars.length ? ars[Math.floor(ars.length / 2)] : null;
  // Two split mechanisms: split-book.mjs writes split_from_spread; the older crop path writes split_from / crop /
  // cropped_photo and leaves image_width/height at the SPREAD's size (BPH, measured 2026-10-07).
  const split = pages.some(p => p.split_from_spread || p.split_from || p.crop || p.cropped_photo);
  const col2Frac = withOcr.length ? col2 / withOcr.length : null;
  return {
    sampled: pages.length, ocred: withOcr.length, tagged: tagged.length, col2,
    col2Frac: col2Frac == null ? null : Math.round(col2Frac * 100) / 100,
    medianAr: medianAr == null ? null : Math.round(medianAr * 100) / 100,
    split,
    // Shape is the signal; the columns tag is too weak (a Japanese spread tagged 0/9, portrait two-column
    // prints tag 2). Wider than 2.2:1 is a pothi folio, palm leaf or scroll, not an open book.
    flagged: !split && medianAr != null && medianAr > 1.05 && medianAr < 2.2,
    col2Majority: withOcr.length >= 3 && col2Frac > 0.5,
  };
}

function samplePositions(n) {
  if (n <= SAMPLE) return Array.from({ length: n }, (_, i) => i + 1);
  // Skip the first and last ~5% (covers, boards), then space evenly.
  const lo = Math.max(1, Math.floor(n * 0.05)), hi = Math.max(lo, Math.ceil(n * 0.95));
  return Array.from({ length: SAMPLE }, (_, i) => Math.round(lo + (hi - lo) * i / (SAMPLE - 1)));
}

const PROJ = { page_number: 1, 'ocr.data': 1, image_width: 1, image_height: 1, split_from_spread: 1, split_from: 1, crop: 1, cropped_photo: 1 };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const pagesColl = db.collection('pages');

// --- positive control ---
const archived = await pagesColl.find({ book_id: PILOT, page_type: 'archived-spread' }, { projection: PROJ }).toArray();
archived.sort((a, b) => b.page_number - a.page_number);
const archSample = samplePositions(archived.length).map(i => archived[i - 1]).filter(Boolean)
  .map(p => ({ ...p, split_from_spread: false }));
const live = await pagesColl.find({ book_id: PILOT, page_number: { $in: samplePositions(1896) }, page_type: { $ne: 'archived-spread' } }, { projection: PROJ }).toArray();
const ctlSpreads = classify(archSample), ctlLeaves = classify(live);
console.log('control  archived spreads:', JSON.stringify(ctlSpreads));
console.log('control  split leaves:    ', JSON.stringify(ctlLeaves));
const controlOk = ctlSpreads.flagged && !ctlLeaves.flagged;
console.log(controlOk ? 'control  PASS' : 'control  FAIL — the classifier cannot see the pilot spreads; refusing to screen');
if (CONTROL_ONLY || !controlOk) { await client.close(); process.exit(controlOk ? 0 : 1); }

if (!OUT_DIR) { console.error('--out <dir> required'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'spread-screen.jsonl');
const done = new Set();
if (fs.existsSync(outFile)) for (const line of fs.readFileSync(outFile, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).id);

// --- the screen ---
const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 } },
  { projection: { id: 1, title: 1, language: 1, pages_count: 1, 'image_source.provider': 1 } },
).toArray();
const todo = books.filter(b => b.id && !done.has(b.id)).slice(0, LIMIT || undefined);
console.log(`books: ${books.length} visible live, ${done.size} already screened, ${todo.length} to do`);

const out = fs.createWriteStream(outFile, { flags: 'a' });
let idx = 0, n = 0;
async function worker() {
  while (idx < todo.length) {
    const b = todo[idx++];
    const pages = await pagesColl.find(
      { book_id: b.id, page_number: { $in: samplePositions(b.pages_count) }, page_type: { $ne: 'archived-spread' } },
      { projection: PROJ },
    ).toArray();
    const row = { id: b.id, title: (b.title || '').slice(0, 120), language: b.language || null, provider: b.image_source?.provider || 'unknown', pages_count: b.pages_count, ...classify(pages) };
    out.write(JSON.stringify(row) + '\n');
    if (++n % 2000 === 0) console.log(`  ${n}/${todo.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await new Promise(r => out.end(r));
await client.close();

// --- summary over the whole file (including earlier runs) ---
const rows = fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const flagged = rows.filter(r => r.flagged);
const withCol2 = flagged.filter(r => r.col2Majority);
console.log(`\nscreened ${rows.length}; already split ${rows.filter(r => r.split).length}; no stored AR ${rows.filter(r => r.medianAr == null).length}`);
console.log(`flagged ${flagged.length} (unsplit, median AR 1.05-2.2); of those OCR tags columns=2 on most pages: ${withCol2.length}`);
const by = (list, key) => Object.entries(list.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
const total = Object.fromEntries(by(rows, 'provider'));
const c2 = Object.fromEntries(by(withCol2, 'provider'));
console.log('\nflagged by provider (flagged / of which col2 / screened):');
for (const [p, c] of by(flagged, 'provider').slice(0, 25)) console.log(`  ${p.padEnd(24)} ${String(c).padStart(5)} ${String(c2[p] || 0).padStart(5)} / ${total[p]}`);
const candidates = flagged.filter(r => !NOT_A_CODEX_PROVIDERS.has(r.provider) && !NOT_A_CODEX_LANGS.has(r.language));
fs.writeFileSync(path.join(OUT_DIR, 'split-candidates.tsv'), ['id\tprovider\tlanguage\tpages_count\tmedianAr\tcol2\ttitle', ...candidates
  .sort((a, b) => a.provider.localeCompare(b.provider) || b.pages_count - a.pages_count)
  .map(r => [r.id, r.provider, r.language, r.pages_count, r.medianAr, `${r.col2}/${r.ocred}`, r.title].join('\t'))].join('\n') + '\n');
const candPages = candidates.reduce((s, r) => s + r.pages_count, 0);
console.log(`\nsplit candidates (flagged minus not-a-codex types): ${candidates.length} books, ${candPages} pages -> ${path.join(OUT_DIR, 'split-candidates.tsv')}`);
const cc = Object.fromEntries(by(candidates, 'provider'));
console.log('candidates by provider: ' + Object.entries(cc).slice(0, 15).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('\nflagged by language:');
for (const [l, c] of by(flagged, 'language').slice(0, 15)) console.log(`  ${String(l).padEnd(24)} ${c}`);
