#!/usr/bin/env node
/**
 * build-edition-refs.mjs — page references for one of our books, cut from a modern edition of the same
 * work, and the production OCR's accuracy against them (#5488, parent #4925).
 *
 * PRIOR ART: benchmark-refs.mjs cuts windows for SEALED benchmark pages from open corpora it searches
 * (CBETA, Kanripo, First1K, Wikisource); build-reference-groundtruth.mjs pins one short curated passage to
 * the page that prints it. Neither takes a whole edition we hold as a file — the case for in-copyright
 * editions, whose text must stay private. The window cut is shared (lib/edition-window.mjs), the private
 * store is lib/private-refs.mjs, the score is lib/metrics.mjs scoreAgainstReference.
 *
 *   node --env-file=.env.production.local scripts/eval/build-edition-refs.mjs \
 *     --book=<id> --edition=<path/to/edition.txt> --script=latin|greek|hebrew|syriac|armenian|… \
 *     --meta=<path/to/meta.json> [--pages=40-60 | --draw=20 --seed=1] [--min-overlap=0.35] [--write]
 *
 * meta.json describes the edition: { "source": "Josten 1964", "edition": "C. H. Josten, Ambix 12 (1964)",
 *   "licence": "in-copyright", "kind": "ocr-same-text", "canonical": false, "memorization_risk": "low",
 *   "acquired": "bought print, digitised 2026-10" }. licence is required; anything but an open licence
 *   should be "in-copyright", which keeps the text out of this repo.
 *
 * Without --write it only reports. With --write each accepted page becomes a private reference
 * (`ed-<book8>-p<n>`): text in the private dir, record in benchmark/refs/. Every refused page is a recorded
 * skip with its reason in results/edition-refs/<book8>.json, never silently dropped.
 *
 * What the score is and is not:
 *  - The window is located with our production read of the page (the probe) and then padded, so the
 *    probe cannot excuse its own omissions at the page edges; the pad's overshoot is charged as deletions
 *    instead. Both errors are small next to edition variance and are fixed by the leaf check.
 *  - A modern edition is not our edition: spelling, abbreviations and readings differ. A score is OCR
 *    error PLUS edition variance until the source's reference_error_rate is measured (20 hand-read pages,
 *    eval-design §4.1). Report scores per source, never pooled across sources.
 *  - leaf_check is "unchecked" on every new record; benchmark-score.mjs and the dashboard grade only ok.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { cutEditionWindow, foldedWords, SUPPORTED_SCRIPTS } from './lib/edition-window.mjs';
import { writePrivateRef, privateRefsDir } from './lib/private-refs.mjs';
import { scoreAgainstReference } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const BOOK = args.book, EDITION = args.edition, SCRIPT = args.script, WRITE = !!args.write;
const MIN_OVERLAP = Number(args['min-overlap'] ?? 0.35);
const REFS_DIR = path.join(__dirname, 'benchmark', 'refs');
const OUT_DIR = path.join(__dirname, 'results', 'edition-refs');

function die(msg) { console.error(msg); process.exit(1); }
if (!BOOK || !EDITION || !SCRIPT || !args.meta) die('required: --book --edition --script --meta');
if (!SUPPORTED_SCRIPTS.includes(SCRIPT)) die(`--script must be one of ${SUPPORTED_SCRIPTS.join(', ')}`);
const meta = JSON.parse(fs.readFileSync(args.meta, 'utf8'));
if (!meta.licence) die('meta.licence is required ("in-copyright" for a modern edition)');
if (path.resolve(EDITION).startsWith(path.resolve(__dirname, '..', '..')) && meta.licence === 'in-copyright')
  die('the edition text is inside this public repo — move it to the private dir first');

// Seeded draw (mulberry32), so a draw is reproducible from its seed.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
  const editionText = fs.readFileSync(EDITION, 'utf8');
  const editionWords = foldedWords(editionText, SCRIPT);
  if (editionWords.length < 200) die(`edition has only ${editionWords.length} ${SCRIPT} words — wrong --script?`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const book = await db.collection('books').findOne({ $or: [{ id: BOOK }, { _id: BOOK }] }, { projection: { id: 1, title: 1, published: 1 } });
  if (!book) die(`book ${BOOK} not found (looked up by id and _id)`);
  const pages = await db.collection('pages').find({ book_id: BOOK, 'ocr.data': { $type: 'string' } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1 } }).sort({ page_number: 1 }).toArray();
  await client.close();

  let chosen = pages;
  if (args.pages) { const [a, b] = String(args.pages).split('-').map(Number); chosen = pages.filter(p => p.page_number >= a && p.page_number <= (b || a)); }
  else if (args.draw) { const r = rng(Number(args.seed ?? 1)); chosen = [...pages].sort(() => r() - 0.5).slice(0, Number(args.draw)).sort((x, y) => x.page_number - y.page_number); }

  const short = String(BOOK).replace(/[^0-9a-z]/gi, '').slice(0, 8);
  const rows = [];
  for (const p of chosen) {
    const slug = `ed-${short}-p${p.page_number}`;
    const cut = cutEditionWindow(editionWords, editionText, p.ocr.data, SCRIPT);
    if (!cut) { rows.push({ slug, page: p.page_number, skipped: 'probe-too-short' }); continue; }
    if (cut.overlap < MIN_OVERLAP) { rows.push({ slug, page: p.page_number, skipped: 'no-window', overlap: +cut.overlap.toFixed(3) }); continue; }
    const s = scoreAgainstReference(cut.window, p.ocr.data, SCRIPT);
    const row = { slug, page: p.page_number, overlap: +cut.overlap.toFixed(3), probe_words: cut.probe_words, ref_chars: [...cut.window].length,
      engine: p.ocr.model || null, aligned: s.aligned, guard_wer: +s.guard.value.toFixed(3),
      char_acc: +s.charAccuracy.toFixed(4), char_acc_windowed: s.charAccuracyWindowed == null ? null : +s.charAccuracyWindowed.toFixed(4) };
    if (!s.aligned) row.skipped = 'guard-refused';   // wrong leaf, divergent recension or decoy — never averaged in
    rows.push(row);
    if (WRITE && !row.skipped) writePrivateRef(REFS_DIR, slug, cut.window, {
      ...meta, origin: 'library', book_id: BOOK, page_number: p.page_number, script: SCRIPT,
      reference_kind: meta.kind || 'ocr-same-text', window: { from_char: cut.from_char, to_char: cut.to_char, overlap: row.overlap, probe: 'production-ocr', pad_words: 3 },
      leaf_check: { status: 'unchecked', by: null, at: null }, reference_error_rate: null, built_by: 'build-edition-refs.mjs', built_at: new Date().toISOString(),
    });
  }

  const ok = rows.filter(r => !r.skipped);
  const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const summary = { book_id: BOOK, title: book.title, published: book.published, source: meta.source, licence: meta.licence, script: SCRIPT,
    pages_tried: rows.length, referenced: ok.length, skips: rows.filter(r => r.skipped).reduce((m, r) => ((m[r.skipped] = (m[r.skipped] || 0) + 1), m), {}),
    median_char_acc: med(ok.map(r => r.char_acc)), median_char_acc_windowed: med(ok.map(r => r.char_acc_windowed).filter(x => x != null)),
    note: 'OCR error + edition variance until reference_error_rate is measured; leaf_check unchecked', written: WRITE, private_dir: WRITE ? privateRefsDir() : null };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${short}.json`), JSON.stringify({ summary, rows }, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  for (const r of rows) console.log(`  p${r.page}\t${r.skipped || 'ok'}\toverlap=${r.overlap ?? '-'}\tacc=${r.char_acc ?? '-'}/${r.char_acc_windowed ?? '-'}`);
}
main().catch(e => { console.error(e); process.exit(1); });
