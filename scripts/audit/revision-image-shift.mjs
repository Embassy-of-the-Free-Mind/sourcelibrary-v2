#!/usr/bin/env node
/**
 * Is `page_revisions` recording RE-OCR, or RE-ARCHIVING?
 *
 * The corpus is used as a double-OCR dataset: 109,953 same-page pairs, and
 * `calibration-scorecard.mjs` fits agreement→accuracy on 32 anchor pages and
 * applies it to all of them for corpus-wide accuracy bands. That inference
 * assumes both sides read THE SAME IMAGE.
 *
 * Spot-checking Latin pairs on 2026-07-30 found that assumption failing. One
 * pair's old OCR read `505 De affectibus` while its new OCR read `469 Aegyptia.
 * Latina. Arabica.` — different books. Comparing the printed `<page-num>` the
 * model transcribes from the page itself, one book showed a CONSTANT OFFSET OF
 * 36 running consecutively (505→469, 504→468, 503→467, …). That is the #3368
 * leaf-offset signature: the scan slid under its text.
 *
 * If that is widespread, "disagreement" in this corpus is substantially image
 * churn rather than reading difficulty — which would explain why agreement
 * predicts accuracy so weakly (63 points of agreement range map to ~5 points of
 * accuracy) and would qualify every number derived from the corpus arm.
 *
 * THE PRINTED PAGE NUMBER IS THE INSTRUMENT. It is transcribed *from the page*,
 * so it identifies which leaf was photographed independently of how well the
 * text was read. Two passes reporting different printed numbers did not read the
 * same leaf.
 *
 * Read-only, free (Mongo only, no AI calls).
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/revision-image-shift.mjs [--sample=6000] [--min-pairs=3]
 *
 * WHAT THIS DOES NOT ANSWER — state it when reporting:
 *   A shift says the two sides do not describe one leaf. It does NOT say which
 *   side is correct, and it does NOT say the IMAGE moved.
 *
 *   RESOLVED 2026-07-30/08-01 for the dominant class, and it is the opposite of
 *   what the header above guesses: the ±1 slice is the #3357 REPAIR moving `ocr`
 *   subdocuments between page docs. The text moved and the image stayed put —
 *   verified against two e-rara scans whose printed numbers match the LIVE text,
 *   not the revision. So a ±1 shift here is one administrative event replicated
 *   across thousands of pages, not thousands of independent re-readings.
 *
 *   AND YOU DO NOT NEED THIS SCRIPT TO KNOW THAT. `page_revisions.source` says
 *   `shift-repair-erara-2026-07` on those rows outright — 29.5% of the
 *   collection, 99% of them leaf-shifted, against 3.8% for `batch_api`. This
 *   script remains useful as the INDEPENDENT check on that label (it reads the
 *   page's own printed number, which no writer controls), but the label is the
 *   cheaper primary and it also covers pairs that print no number at all.
 *   See `scripts/audit/ocr-revision-provenance.mjs`.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '6000');
const MIN_PAIRS = parseInt(args['min-pairs'] || '3');

const pageNum = t => {
  const m = (t || '').match(/<page-num>\s*([0-9]{1,4})\s*<\/page-num>/i);
  return m ? parseInt(m[1], 10) : null;
};

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  // $sample, NOT sort by _id. The first attempt at this measurement sorted
  // newest-first, landed inside a single affected book, and reported 87.3% —
  // a concentration artefact. Randomize or the rate is meaningless.
  const revs = await db.collection('page_revisions').aggregate([
    { $match: { field: 'ocr' } },
    { $sample: { size: SAMPLE } },
    { $project: { page_id: 1, data: 1 } },
  ], { allowDiskUse: true, maxTimeMS: 300000 }).toArray();

  // Batch the page lookups — one findOne per revision is what made the ad-hoc
  // version take many minutes.
  const seen = new Set();
  const wanted = [];
  for (const r of revs) { if (!seen.has(r.page_id)) { seen.add(r.page_id); wanted.push(r); } }
  const ids = wanted.map(r => r.page_id);
  const pageById = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = await db.collection('pages').find(
      { id: { $in: ids.slice(i, i + 500) } },
      { projection: { id: 1, 'ocr.data': 1, book_id: 1, page_number: 1 } }
    ).maxTimeMS(120000).toArray();
    for (const p of chunk) pageById.set(p.id, p);
  }

  const byBook = new Map();
  let both = 0, same = 0, diff = 0;
  for (const r of wanted) {
    const p = pageById.get(r.page_id);
    const now = p?.ocr?.data; if (!now) continue;
    const a = pageNum(r.data), b = pageNum(now);
    if (a === null || b === null) continue;
    both++;
    if (!byBook.has(p.book_id)) byBook.set(p.book_id, { n: 0, d: 0, offs: new Map() });
    const B = byBook.get(p.book_id);
    B.n++;
    if (a === b) same++;
    else { diff++; B.d++; const o = b - a; B.offs.set(o, (B.offs.get(o) || 0) + 1); }
  }

  console.log(`\n  Randomized sample of ${SAMPLE} revisions → ${both} pairs with a printed page number on BOTH sides\n`);
  console.log(`    identical page number : ${same} (${(100 * same / both).toFixed(1)}%)`);
  console.log(`    DIFFERENT             : ${diff} (${(100 * diff / both).toFixed(1)}%)  — the two passes did not read the same leaf\n`);

  // Per-book: a single dominant offset means a systematic slide (the whole book
  // moved by N leaves). Many distinct offsets means per-page reassignment or
  // noise — a different, messier problem.
  const books = [...byBook.entries()].filter(([, v]) => v.n >= MIN_PAIRS);
  const affected = books.filter(([, v]) => v.d / v.n > 0.5);
  const systematic = affected.filter(([, v]) => {
    const top = Math.max(...v.offs.values());
    return top / v.d >= 0.8;      // one offset explains ≥80% of that book's shifts
  });

  console.log(`  books with ≥${MIN_PAIRS} comparable pairs : ${books.length}`);
  console.log(`  books where >50% of pairs shift  : ${affected.length}`);
  console.log(`    of those, a SINGLE dominant offset (systematic slide): ${systematic.length}`);
  console.log(`    remainder = mixed offsets (per-page reassignment or noise): ${affected.length - systematic.length}\n`);

  console.log(`  per-book signatures:`);
  for (const [id, v] of affected.slice(0, 15)) {
    const offs = [...v.offs.entries()].sort((x, y) => y[1] - x[1]);
    const [topOff, topN] = offs[0];
    const kind = topN / v.d >= 0.8 ? 'SYSTEMATIC' : 'mixed';
    console.log(`    ${id.slice(-8)}  ${String(v.d).padStart(3)}/${String(v.n).padEnd(3)} shifted  offset ${String(topOff).padStart(5)} explains ${topN}/${v.d}  [${kind}]`);
  }

  const out = path.join(__dirname, '..', 'eval', 'results', `revision-image-shift-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    date: new Date().toISOString(), sample: SAMPLE, pairs: both, same, diff,
    books: books.length, affected: affected.length, systematic: systematic.length,
    signatures: affected.map(([id, v]) => ({ book_id: id, n: v.n, shifted: v.d, offsets: Object.fromEntries(v.offs) })),
  }, null, 2));

  console.log(`\n  → ${path.relative(process.cwd(), out)}`);
  console.log(`\n  Reminder: a shift shows the image CHANGED, not which side is right.`);
  console.log(`  #3357 repaired an e-rara off-by-one; some of these are the repair.\n`);
  await c.close();
}

main().catch(e => { console.error(e); process.exit(1); });
