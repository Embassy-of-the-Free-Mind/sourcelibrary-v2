#!/usr/bin/env node
// Harvest spot-check reviewer corrections into the regression set (#5913).
//
// PRIOR ART: scripts/eval/dataset/ocr-v19-labels.jsonl — per-feature labels for one prompt
//   change, not a harvest of reviewer-caught errors; #5686 plans a hand-built ~40-page OCR set
//   with behavioural expectations, which this complements (it does not replace it).
//
// Reads scripts/eval/results/spot-check/sprint-*/{results,sample}.json (reviewer findings joined
// to page ids, image URLs, engines by book_id + page_number) and writes one JSONL row per
// moderate/serious correction to scripts/eval/regression/spot-check-corrections.jsonl.
//
// Row schema (lane "ocr" or "translation"):
//   id, lane, round, book_id, page_id, page_number, image_url, engine, model,
//   class, severity, problem, verified
//   ocr:         wrong_span (what the OCR said), image_reading (what the reviewer read on the image)
//   translation: source (the text translated), wrong_english (what the translation said)
// `verified` is "reviewer-opus-image": an AI reviewer read the page image; no human has.
// A candidate lane passes a row when it does NOT reproduce wrong_span / wrong_english on that page.
//
// Books with a non-null rights_flag are excluded. Local script: no network, no model calls.
// Usage: node scripts/eval/regression-from-spot-checks.mjs [--out path]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'scripts/eval/results/spot-check';
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : 'scripts/eval/regression/spot-check-corrections.jsonl';
const KEEP = new Set(['moderate', 'serious']);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const rows = [];
let skippedRights = 0, skippedMinor = 0, skippedNoPage = 0, skippedNoImageReading = 0;
const rounds = fs
  .readdirSync(ROOT)
  .filter((d) => d.startsWith('sprint-') && fs.existsSync(path.join(ROOT, d, 'results.json')))
  .sort();

for (const round of rounds) {
  const results = read(path.join(ROOT, round, 'results.json'));
  const sample = read(path.join(ROOT, round, 'sample.json'));
  const sampleBooks = new Map(sample.map((b) => [b.book_id, b]));
  for (const book of results) {
    if (book.rights_flag) { skippedRights++; continue; }
    const sb = sampleBooks.get(book.book_id);
    for (const pg of book.pages || []) {
      const sp = sb?.pages?.find((p) => p.page_number === pg.page_number);
      const common = (lane, e, i) => ({
        id: `${round}:${book.book_id}:${pg.page_number}:${lane}:${i}`,
        lane,
        round,
        book_id: book.book_id,
        page_id: sp?.page_id ?? null,
        page_number: pg.page_number,
        image_url: sp?.image_url ?? null,
        engine: lane === 'ocr' ? sp?.ocr_engine ?? null : sp?.translation_source ?? null,
        model: lane === 'ocr' ? sp?.ocr_model ?? null : sp?.translation_model ?? null,
        class: e.class || 'unclassified',
        severity: e.severity,
        problem: e.problem,
      });
      (pg.ocr_errors || []).forEach((e, i) => {
        if (!KEEP.has(e.severity)) { skippedMinor++; return; }
        if (!sp) { skippedNoPage++; return; }
        if (!e.image) { skippedNoImageReading++; return; }
        rows.push({ ...common('ocr', e, i), wrong_span: e.ocr, image_reading: e.image, verified: 'reviewer-opus-image' });
      });
      (pg.tr_errors || []).forEach((e, i) => {
        if (!KEEP.has(e.severity)) { skippedMinor++; return; }
        if (!sp) { skippedNoPage++; return; }
        rows.push({ ...common('translation', e, i), source: e.source, wrong_english: e.english, verified: 'reviewer-opus-image' });
      });
    }
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const tally = {};
for (const r of rows) { const k = `${r.lane}\t${r.class}`; tally[k] = (tally[k] || 0) + 1; }
console.log(`rounds: ${rounds.join(', ')}`);
console.log(`rows: ${rows.length} (excluded: ${skippedRights} rights-flagged books, ${skippedMinor} minor, ${skippedNoPage} no sample page, ${skippedNoImageReading} no image reading)`);
for (const [k, n] of Object.entries(tally).sort()) console.log(`${n}\t${k}`);
