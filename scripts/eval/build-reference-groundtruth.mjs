#!/usr/bin/env node
/**
 * Build reference-based OCR ground truth for any language (#3212).
 * Generalizes build-ctext-groundtruth.mjs (which remains the Chinese-specific
 * original) to every script via the two-stage guard in lib/metrics.mjs.
 *
 * Input:  scripts/eval/reference-works/<language>.json — curated works, each with
 *         a short reference passage + provenance (see reference-sources.json).
 * Output: scripts/eval/ground-truth/<language>-<slug>.json, pinned to an exact
 *         book_id + page_number. Only passages that pass the identity guard are
 *         written; everything else is reported and skipped (wrong book, divergent
 *         recension, or a same-title translation decoy — NOT an OCR failure).
 *
 * Identity never comes from titles. The title regex is only a cheap prefilter
 * for candidate books; the subsequence guard (word-level for alphabetic scripts,
 * char-level for cjk) decides whether the passage is genuinely on the page.
 *
 * ONE-PAGE RULE: keep reference passages short enough to sit on a single printed
 * page of the densest edition we hold (commentary editions may print only ~4
 * verse lines per page). A passage spanning a page boundary fails the guard on
 * honest word deletions — shorten the passage, don't loosen the guard.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/build-reference-groundtruth.mjs --language=hebrew [--write] [--verbose]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAgainstReference, normalizeForScript, normalizeCJK } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const WRITE = !!args.write;
const VERBOSE = !!args.verbose;
// --only=<regex on slug> restricts to matching works, so --write can add new
// rows without regenerating (and clobbering the hand-added page_class /
// audit_note annotations of) already-pinned ground-truth files.
const ONLY = args.only ? new RegExp(args.only, 'i') : null;
const LANG = args.language;
if (!LANG) {
  const avail = fs.readdirSync(path.join(__dirname, 'reference-works')).filter(f => f.endsWith('.json'));
  console.error(`--language required. Available works files: ${avail.map(f => f.replace('.json', '')).join(', ') || '(none)'}`);
  process.exit(1);
}

const worksFile = path.join(__dirname, 'reference-works', `${LANG}.json`);
if (!fs.existsSync(worksFile)) { console.error(`No works file at ${worksFile}`); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(worksFile, 'utf8'));
const { script, db_languages } = cfg;

// Candidate pages are pre-screened with a cheap normalized-substring probe on the
// first few reference words before paying for the full guard DP.
const probeOf = ref => script === 'cjk'
  ? normalizeCJK(ref).slice(0, 6)
  : normalizeForScript(ref, script).split(' ').slice(0, 3).join(' ');
const pageNorm = ocr => script === 'cjk' ? normalizeCJK(ocr) : normalizeForScript(ocr, script);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set (source .env.production.local)'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const B = db.collection('books'), P = db.collection('pages');
const gtDir = path.join(__dirname, 'ground-truth');
if (WRITE) fs.mkdirSync(gtDir, { recursive: true });

let written = 0, skipped = 0;
for (const w of cfg.works) {
  const { work, slug, title_rx, source, source_url, reference, edition, non_canonical, memorization_risk } = w;
  if (!slug || (ONLY && !ONLY.test(slug))) continue;
  // A blocked work is a known trap, not a TODO: the probe would "confirm" a page
  // whose stored OCR is itself model recitation (see the works file's _note).
  if (w.blocked) { console.log(`SKIP ${work}: blocked in works file — ${path.basename(worksFile)} _note explains why`); skipped++; continue; }
  // A works entry may pin book_id (and optionally page_number) directly — used
  // when the copy matters (same-book canonical/non-canonical contrasts, or a
  // specific edition among several copies) or when the opening-words probe is
  // too brittle (OCR errors in the exact probe words hide a page the alignment
  // guard would accept). The guard still decides; pinning only scopes the search.
  const books = w.book_id
    ? await B.find({ $or: [{ id: w.book_id }, { _id: w.book_id }] },
        { projection: { id: 1, _id: 1, title: 1, display_title: 1 } }).toArray()
    : await B.find(
        {
          language: { $in: db_languages },
          $or: [{ title: { $regex: title_rx, $options: 'i' } }, { display_title: { $regex: title_rx, $options: 'i' } }],
        },
        { projection: { id: 1, _id: 1, title: 1, display_title: 1 }, sort: { pages_count: -1 } },
      ).limit(15).toArray();

  if (VERBOSE) console.log(`\n${work}: ${books.length} candidate books`);
  const probe = probeOf(reference);
  let best = null;
  for (const bk of books) {
    const bookId = bk.id || bk._id.toString();
    const pageQuery = { book_id: bookId, 'ocr.data': { $exists: true } };
    if (w.book_id && w.page_number) pageQuery.page_number = w.page_number;
    const cursor = P.find(pageQuery,
      { projection: { page_number: 1, 'ocr.data': 1 }, sort: { page_number: 1 } });
    for await (const pg of cursor) {
      if (!pageQuery.page_number && !pageNorm(pg.ocr?.data || '').includes(probe)) continue;
      const r = scoreAgainstReference(reference, pg.ocr.data, script);
      const guardVal = r.guard.value;
      if (VERBOSE) console.log(`  probe hit: ${bookId} p${pg.page_number} guard=${(guardVal * 100).toFixed(0)}% cer=${(r.cer * 100).toFixed(1)}% [${(bk.display_title || bk.title).slice(0, 40)}]`);
      if (!best || guardVal < best.guardVal) {
        best = { bookId, page: pg.page_number, guardVal, cer: r.cer, aligned: r.aligned, title: bk.display_title || bk.title };
      }
    }
  }

  if (!best) { console.log(`SKIP  ${work}: no page contains the reference opening (probe: "${probe.slice(0, 30)}…")`); skipped++; continue; }
  if (!best.aligned) {
    console.log(`SKIP  ${work}: best guard ${(best.guardVal * 100).toFixed(0)}% — reference not cleanly present (wrong book, divergent recension, or translation decoy) — [${best.title.slice(0, 40)}]`);
    skipped++; continue;
  }

  const gt = {
    work, book_id: best.bookId, page_number: best.page, script,
    language: cfg.language, source, source_url, edition,
    ...(non_canonical ? { non_canonical, memorization_risk } : {}),
    // Alternate recensions of the same passage (e.g. the critical text a model
    // most likely memorized vs the edition actually printed) ride along for the
    // recension-divergence outcome in build-observations.
    ...(w.alt_references ? { alt_references: w.alt_references } : {}),
    ocr_ground_truth: reference,
  };
  console.log(`WRITE ${work}: ${best.bookId} p${best.page}  guard=${(best.guardVal * 100).toFixed(0)}%  CER=${(best.cer * 100).toFixed(1)}%  [${best.title.slice(0, 40)}]`);
  if (WRITE) fs.writeFileSync(path.join(gtDir, `${LANG}-${slug}.json`), JSON.stringify(gt, null, 2) + '\n');
  written++;
}

console.log(`\n${WRITE ? 'Wrote' : 'Would write'} ${written} ground-truth files, skipped ${skipped}. ${WRITE ? '' : '(dry run — pass --write to save)'}`);
await client.close();
