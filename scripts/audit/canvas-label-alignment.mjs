#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-alignment-screen.mjs (#7866) — repeats, text on blank leaves and
// image shifts, judged by image bytes and dHash; its experiment note names "text-side shifts on
// e-rara books whose images are their own leaves" as a miss, which is this script's whole target.
// scripts/audit/bulk-archive-alignment.mjs — dHash at offsets 0/+1, IA bulk_jp2 pages only.
// scripts/eval/jev/clef-* (#5803) — a model on every page; this is free and model-less.
/**
 * canvas-label-alignment — is each page's text from the leaf its image shows? (#7949)
 * $0 and read-only: Mongo reads + the provider's IIIF manifest. No model, no writes.
 *
 * Per page, the printed page number OCR recorded (<page-num>) is looked up among the IIIF
 * canvas labels within ±8 slots. A unique hit at slot s+k gives the page offset k. A book
 * whose scored pages agree on one non-zero k carries text from another leaf on most pages.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/canvas-label-alignment.mjs --book <id>
 *   node --env-file=.env.production.local scripts/audit/canvas-label-alignment.mjs --provider e-rara [--limit N]
 *   flags: --out <dir> (default scripts/eval/results/canvas-label-alignment) --runs (print offset runs)
 *
 * Output: <out>/books.jsonl, one row per book: verdict, offset, share, histogram, runs.
 * Exit 0 always for a completed scan; the verdicts are the result.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { labelNumber, slotOffsets, bookVerdict, offsetRuns } from '../lib/canvas-label-alignment.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const BOOK = flag('book'), PROVIDER = flag('provider'), LIMIT = Number(flag('limit', '0'));
const OUT = flag('out', 'scripts/eval/results/canvas-label-alignment');
const SHOW_RUNS = args.includes('--runs');
if (!BOOK && !PROVIDER) { console.error('usage: --book <id> | --provider <name> [--limit N]'); process.exit(1); }

async function manifestLabels(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-audit/1.0 (+https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const canvases = j.sequences?.[0]?.canvases ?? j.items ?? [];
      return canvases.map((c) => labelNumber(c.label));
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
}

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, BOOK ? `book-${BOOK}.jsonl` : `books-${PROVIDER}.jsonl`);
const out = fs.createWriteStream(outFile);
try {
  const q = BOOK ? { id: BOOK } : { 'image_source.provider': PROVIDER, 'image_source.iiif_manifest': { $exists: true }, pages_ocr: { $gt: 0 } };
  let cursor = db.collection('books').find(q, { projection: { id: 1, title: 1, visible: 1, pages_count: 1, image_source: 1 } }).sort({ _id: 1 });
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const tally = {};
  for await (const b of cursor) {
    const row = { book_id: b.id, title: b.title?.slice(0, 80), visible: b.visible === true, pages_count: b.pages_count };
    try {
      const labels = await manifestLabels(b.image_source.iiif_manifest);
      // Only the head of each OCR is needed for <page-num>; don't pull whole texts.
      const pages = await db.collection('pages').aggregate([
        { $match: { book_id: b.id, page_number: { $gte: 1 } } },
        { $project: { _id: 0, page_number: 1, 'ocr.data': { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 400] } } },
        { $sort: { page_number: 1 } },
      ]).toArray();
      const rows = slotOffsets(pages, labels);
      Object.assign(row, { canvases: labels.length, pages: pages.length, numeric_labels: labels.filter((l) => l != null).length }, bookVerdict(rows));
      const runs = offsetRuns(rows).filter((r) => r.scored >= 3);
      row.runs = runs;
      if (SHOW_RUNS) for (const r of runs) console.log(`  run ${r.from}-${r.to} offset ${r.offset} (${r.scored} scored)`);
    } catch (e) {
      row.verdict = 'error'; row.error = String(e.message ?? e).slice(0, 200);
    }
    tally[row.verdict] = (tally[row.verdict] ?? 0) + 1;
    out.write(JSON.stringify(row) + '\n');
    if (row.verdict === 'shifted' || row.verdict === 'mixed' || BOOK) {
      console.log(`${row.verdict.padEnd(8)} ${b.id} k=${row.offset ?? '-'} share=${row.share?.toFixed(2) ?? '-'} scored=${row.scored ?? 0} ${JSON.stringify(row.histogram ?? {})} ${row.title}`);
    }
  }
  console.log(`done: ${JSON.stringify(tally)} -> ${outFile}`);
} finally {
  out.end();
  await client.close();
}
