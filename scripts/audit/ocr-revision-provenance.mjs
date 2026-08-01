#!/usr/bin/env node
/**
 * Can a TIMESTAMP tell a re-OCR from an administrative text move?
 *
 * #3473 established that ~40% of `page_revisions` pairs did not read the same
 * leaf, and the follow-up (handoff 2026-07-30) resolved the dominant +/-1 class
 * as the #3357 shift REPAIR — text subdocuments moved between page docs rather
 * than re-transcribed. That resolution was verified two ways: against the actual
 * scans (page 49's image shows a printed 5; live OCR says 5, the revision says
 * 4), and by noting the timestamps are INVERTED — the live `ocr.updated_at`
 * (April) is OLDER than the revision that supposedly preceded it (July), which
 * was read as "impossible for a re-OCR; exactly what a text move does."
 *
 * THE IMAGE CHECK IS SOUND. THE TIMESTAMP ARGUMENT IS NOT, and this script is
 * what shows it. Inversion is the corpus-wide norm, including on pairs where a
 * move is impossible by construction:
 *
 *   - `pages.ocr` carries `updated_at` on ~100% of revision-bearing pages and
 *     `created_at` on 0% — so there is exactly one timestamp to reason with.
 *   - ~86% of ALL revision-bearing pages are inverted.
 *   - Restricted to pages whose live `ocr.model` DIFFERS from the revision's
 *     model — proof a genuine re-OCR ran — ~88% are still inverted, and ~62%
 *     remain inverted when both sides print the SAME page number, where
 *     relocation cannot be the explanation.
 *
 * The cause is provenance, not integrity: the sweeps that move or rewrite `ocr`
 * do not re-stamp `updated_at`, and `page_revisions.created_at` is a SWEEP clock
 * rather than a reading clock — a single day (2026-07-25, the #3357 repair) is
 * ~30% of every OCR revision in the collection.
 *
 * So neither timestamp orders a pair, and neither can classify one. Mechanism
 * claims about this corpus need the image or the text, not the clock.
 *
 * WHAT THIS DOES NOT ANSWER — state it when reporting:
 *   It does not show the 63,572 same-leaf true-repeat pairs are unsound. Those
 *   are selected on printed page number, model and prompt, none of which is a
 *   timestamp. It shows only that the clock cannot be used to audit them, and
 *   that "N pairs exist" is not the same claim as "N independent readings".
 *
 * Read-only, free (Mongo only, no AI calls). ~2 min.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/ocr-revision-provenance.mjs [--sample=6000] [--out=FILE]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '6000');
const OUT = args.out || `scripts/eval/results/ocr-revision-provenance-${new Date().toISOString().slice(0, 10)}.json`;

// Same extractor as scripts/audit/revision-image-shift.mjs — the printed number
// is transcribed FROM the page, so it identifies the leaf independently of the
// clock. Deliberately shared rather than re-invented: a probe regex written
// fresh for each script is how #3473's earlier passes went wrong.
const pageNum = t => {
  const m = (t || '').match(/<page-num>\s*([0-9]{1,4})\s*<\/page-num>/i);
  return m ? parseInt(m[1]) : null;
};

const pct = (x, d) => (d ? +(100 * x / d).toFixed(1) : null);
const line = (label, x, d) => console.log(`  ${label.padEnd(46)} ${String(x).padStart(6)}${d ? ` / ${String(d).padStart(6)} = ${pct(x, d)}%` : ''}`);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing — set -a; source .env.production.local; set +a');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const REVS = db.collection('page_revisions');
  const PAGES = db.collection('pages');

  // ── 1. is `page_revisions.created_at` a reading clock or a sweep clock? ──
  const byDay = await REVS.aggregate([
    { $match: { field: 'ocr' } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true }).toArray();
  const totalRevs = byDay.reduce((s, d) => s + d.n, 0);

  console.log(`\nOCR revisions: ${totalRevs} across ${byDay.length} distinct days`);
  console.log('Concentration (a reading clock would be diffuse; a sweep clock spikes):');
  let cum = 0;
  const topDays = byDay.slice(0, 10).map(d => {
    cum += d.n;
    console.log(`  ${d._id}  ${String(d.n).padStart(7)}  ${pct(d.n, totalRevs)}%  cum ${pct(cum, totalRevs)}%`);
    return { day: d._id, n: d.n, pct: pct(d.n, totalRevs) };
  });

  // ── 2. inversion, by cohort ────────────────────────────────────────────
  // Sample revisions (indexed + small) rather than pages: a $match-then-$sample
  // on `pages` is a full collection scan and does not finish.
  const revs = await REVS.aggregate([
    { $match: { field: 'ocr', data: { $type: 'string', $ne: '' } } },
    { $sample: { size: SAMPLE } },
    { $project: { page_id: 1, created_at: 1, model: 1, data: 1 } },
  ], { allowDiskUse: true }).toArray();

  const ids = [...new Set(revs.map(r => r.page_id))];
  const pages = new Map();
  for (let i = 0; i < ids.length; i += 2000) {
    const docs = await PAGES.find(
      { id: { $in: ids.slice(i, i + 2000) } },
      { projection: { id: 1, 'ocr.updated_at': 1, 'ocr.created_at': 1, 'ocr.model': 1, 'ocr.data': 1 } },
    ).toArray();
    for (const p of docs) pages.set(p.id, p);
  }

  const c = {
    considered: 0, missingPage: 0, hasUpdatedAt: 0, hasCreatedAt: 0, noTimestamp: 0,
    identicalText: 0, inverted: 0,
    modelChanged: 0, modelChangedInverted: 0,
    modelChangedSameLeaf: 0, modelChangedSameLeafInverted: 0,
    sameLeaf: 0, sameLeafInverted: 0,
  };

  for (const r of revs) {
    const p = pages.get(r.page_id);
    if (!p?.ocr?.data) { c.missingPage++; continue; }
    if (p.ocr.updated_at) c.hasUpdatedAt++;
    if (p.ocr.created_at) c.hasCreatedAt++;
    if (!p.ocr.updated_at && !p.ocr.created_at) { c.noTimestamp++; continue; }
    const stamp = p.ocr.updated_at || p.ocr.created_at;
    c.considered++;
    if (r.data === p.ocr.data) c.identicalText++;

    const inverted = new Date(stamp).getTime() < new Date(r.created_at).getTime();
    if (inverted) c.inverted++;

    const a = pageNum(r.data), b = pageNum(p.ocr.data);
    const sameLeaf = a != null && b != null && a === b;
    if (sameLeaf) { c.sameLeaf++; if (inverted) c.sameLeafInverted++; }

    // A different model on the live side than on the revision is positive
    // evidence that a real re-OCR ran. If those are inverted too, inversion
    // cannot mean "the text was moved".
    if (r.model && p.ocr.model && r.model !== p.ocr.model) {
      c.modelChanged++;
      if (inverted) c.modelChangedInverted++;
      if (sameLeaf) { c.modelChangedSameLeaf++; if (inverted) c.modelChangedSameLeafInverted++; }
    }
  }

  console.log(`\nTimestamp fields on revision-bearing pages (n=${revs.length} sampled revisions)`);
  line('live page missing or ocr empty', c.missingPage);
  line('has ocr.updated_at', c.hasUpdatedAt, c.considered);
  line('has ocr.created_at', c.hasCreatedAt, c.considered);
  line('has neither', c.noTimestamp);
  line('revision text IDENTICAL to live', c.identicalText, c.considered);

  console.log('\nInversion (live stamp OLDER than the revision that preceded it)');
  line('all pairs', c.inverted, c.considered);
  line('SAME printed leaf (no move possible)', c.sameLeafInverted, c.sameLeaf);
  line('MODEL CHANGED (a re-OCR certainly ran)', c.modelChangedInverted, c.modelChanged);
  line('  ...and SAME printed leaf', c.modelChangedSameLeafInverted, c.modelChangedSameLeaf);

  const verdict = pct(c.modelChangedInverted, c.modelChanged) > 50
    ? 'TIMESTAMP IS NOT A DISCRIMINATOR — pages with a proven re-OCR invert at the same rate as everything else.'
    : 'Timestamp separates the cohorts; re-examine.';
  console.log(`\n${verdict}\n`);

  const out = {
    date: new Date().toISOString(),
    sample: SAMPLE,
    revisions_total: totalRevs,
    revision_days: byDay.length,
    top_days: topDays,
    counts: c,
    rates: {
      inverted_all: pct(c.inverted, c.considered),
      inverted_same_leaf: pct(c.sameLeafInverted, c.sameLeaf),
      inverted_model_changed: pct(c.modelChangedInverted, c.modelChanged),
      inverted_model_changed_same_leaf: pct(c.modelChangedSameLeafInverted, c.modelChangedSameLeaf),
    },
    verdict,
    caveat: 'Does NOT show the same-leaf true-repeat corpus is unsound — that corpus is selected on printed page number, model and prompt, never on a timestamp. It shows the clock cannot audit it.',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`wrote ${OUT}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
