#!/usr/bin/env node
/**
 * What mechanism produced each `page_revisions` row — and what says so?
 *
 * THE ANSWER IS A STORED FIELD: `page_revisions.source`. It labels the
 * mechanism outright, on every row, and nothing about it needs to be inferred:
 *
 *   batch_api                    109,982  57.5%   real OCR passes
 *   shift-repair-erara-2026-07    56,413  29.5%   the #3357 text move
 *   pipeline_preview              12,949   6.8%
 *   ai                             8,622   4.5%
 *   unknown / null / manual / …    3,255   1.7%
 *
 * Crossed against the printed page number (the independent instrument from
 * `revision-image-shift.mjs`), the label is near-perfectly diagnostic:
 *
 *   source                       numbered pairs   leaf-shifted   of which +1
 *   shift-repair-erara-2026-07            1,734         99.4%         89.6%
 *   batch_api                             2,427          3.8%         14.0%
 *   pipeline_preview                        216          1.4%
 *   ai                                      133          1.5%
 *
 * So the ±1 population #3473 spent an audit characterising is simply the rows
 * that already say `shift-repair-erara-2026-07`. Two consequences:
 *
 *  1. **It covers the stratum the page-number instrument cannot see.** 22.3% of
 *     pairs printing no number on one or both sides are shift-repair rows —
 *     roughly 13,500 of the ~60,500 "unmeasurable" pairs, classifiable for free.
 *  2. **`source` is the correct exclusion filter**, being categorical and
 *     complete where the printed number is neither.
 *
 * WHY THIS SCRIPT ALSO REPORTS TIMESTAMPS. An earlier version of this file
 * argued the mechanism from an inverted timestamp, and a first pass at this
 * audit concluded "no clock can classify these rows." Both were overreach, and
 * the timestamp section is kept as the correction:
 *
 *   - `page_revisions.created_at` is a SNAPSHOT clock. It records when the row
 *     was written, not when the text was read, so it is later than the live
 *     `pages.ocr.updated_at` on ~84% of pairs — including ~89% of pairs whose
 *     model demonstrably changed. Inversion against it means nothing.
 *   - `page_revisions.original_date` (92.4% of rows) IS a reading clock, and it
 *     orders correctly: on pairs with a proven re-OCR it precedes the live
 *     `ocr.updated_at` 91.6% of the time.
 *   - `pages.ocr.updated_at` is therefore maintained, not stale. The corpus does
 *     have write-time provenance; the first pass just read the wrong field.
 *
 * The general lesson is the one this corpus keeps teaching: one field failing is
 * not the category failing. Check whether the fact is simply stored somewhere
 * before building an instrument to infer it.
 *
 * WHAT THIS DOES NOT ANSWER — state it when reporting:
 *   `source` says how a row was PRODUCED, not which side is correct. For the
 *   shift-repair rows that was settled separately, against the scans: the LIVE
 *   text matches the printed number and the revision does not (handoff
 *   2026-07-30). A label is provenance, not adjudication.
 *
 * Read-only, free (Mongo only, no AI calls). ~2 min.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/ocr-revision-provenance.mjs [--sample=8000] [--out=FILE]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '8000');
const OUT = args.out || `scripts/eval/results/ocr-revision-provenance-${new Date().toISOString().slice(0, 10)}.json`;

// Same extractor as scripts/audit/revision-image-shift.mjs. Shared deliberately:
// a probe regex written fresh per script is how #3473's earlier passes went wrong.
const pageNum = t => {
  const m = (t || '').match(/<page-num>\s*([0-9]{1,4})\s*<\/page-num>/i);
  return m ? parseInt(m[1]) : null;
};
const pct = (x, d) => (d ? +(100 * x / d).toFixed(1) : null);
const T = v => (v ? new Date(v).getTime() : null);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing — set -a; source .env.production.local; set +a');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const REVS = db.collection('page_revisions');
  const PAGES = db.collection('pages');

  // ── 1. the label, over the whole collection (not a sample) ─────────────
  const bySource = await REVS.aggregate([
    { $match: { field: 'ocr' } },
    { $group: { _id: '$source', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true }).toArray();
  const totalRevs = bySource.reduce((s, d) => s + d.n, 0);
  console.log(`\nALL ocr revisions: ${totalRevs}, by stored source label:`);
  const sourceTable = bySource.map(s => {
    console.log(`  ${String(s._id).padEnd(34)} ${String(s.n).padStart(7)}  ${pct(s.n, totalRevs)}%`);
    return { source: s._id, n: s.n, pct: pct(s.n, totalRevs) };
  });

  // ── 2. cross the label against the printed-number instrument ───────────
  const revs = await REVS.aggregate([
    { $match: { field: 'ocr', data: { $type: 'string', $ne: '' } } },
    { $sample: { size: SAMPLE } },
    { $project: { page_id: 1, source: 1, data: 1, created_at: 1, original_date: 1, model: 1 } },
  ], { allowDiskUse: true }).toArray();

  const ids = [...new Set(revs.map(r => r.page_id))];
  const pages = new Map();
  for (let i = 0; i < ids.length; i += 2000) {
    const docs = await PAGES.find(
      { id: { $in: ids.slice(i, i + 2000) } },
      { projection: { id: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.model': 1 } },
    ).toArray();
    for (const p of docs) pages.set(p.id, p);
  }

  const numbered = {}, unnumbered = {};
  const clock = {
    n: 0, hasOriginalDate: 0,
    invertedVsCreatedAt: 0,
    modelChanged: 0, modelChangedInvertedVsCreatedAt: 0, modelChangedOrigOrdersOk: 0, modelChangedWithOrig: 0,
  };

  for (const r of revs) {
    const p = pages.get(r.page_id);
    if (!p?.ocr?.data) continue;
    const a = pageNum(r.data), b = pageNum(p.ocr.data);
    const src = r.source || '(none)';

    if (a == null || b == null) {
      unnumbered[src] = (unnumbered[src] || 0) + 1;
    } else {
      const t = (numbered[src] = numbered[src] || { n: 0, shifted: 0, plusOne: 0 });
      t.n++;
      if (a !== b) { t.shifted++; if (b - a === 1) t.plusOne++; }
    }

    // clock cohort — needs a live stamp to compare against
    const live = T(p.ocr.updated_at);
    if (!live) continue;
    clock.n++;
    const orig = T(r.original_date);
    if (orig) clock.hasOriginalDate++;
    if (live < T(r.created_at)) clock.invertedVsCreatedAt++;
    if (r.model && p.ocr.model && r.model !== p.ocr.model) {
      clock.modelChanged++;
      if (live < T(r.created_at)) clock.modelChangedInvertedVsCreatedAt++;
      if (orig) { clock.modelChangedWithOrig++; if (orig < live) clock.modelChangedOrigOrdersOk++; }
    }
  }

  console.log('\nNUMBERED pairs — leaf shift by source (the label vs the independent instrument):');
  console.log('  source                                 n   shifted    of which +1');
  const numberedTable = Object.entries(numbered).sort((x, y) => y[1].n - x[1].n).map(([s, v]) => {
    console.log(`  ${s.padEnd(34)} ${String(v.n).padStart(5)}  ${String(pct(v.shifted, v.n)).padStart(5)}%  ${String(pct(v.plusOne, v.shifted) ?? '—').padStart(6)}%`);
    return { source: s, n: v.n, shifted_pct: pct(v.shifted, v.n), plus_one_pct_of_shifted: pct(v.plusOne, v.shifted) };
  });

  const unNoTotal = Object.values(unnumbered).reduce((a, b) => a + b, 0);
  console.log(`\nUNNUMBERED pairs (n=${unNoTotal}) — the stratum the printed number cannot see:`);
  const unnumberedTable = Object.entries(unnumbered).sort((x, y) => y[1] - x[1]).map(([s, v]) => {
    console.log(`  ${s.padEnd(34)} ${String(v).padStart(5)}  ${pct(v, unNoTotal)}%`);
    return { source: s, n: v, pct: pct(v, unNoTotal) };
  });
  const repairUnnumbered = pct(unnumbered['shift-repair-erara-2026-07'] || 0, unNoTotal);
  console.log(`  -> ${repairUnnumbered}% of them are shift-repair, classifiable for free where the page number was silent.`);

  console.log('\nCLOCKS (kept as the correction to an earlier overreach):');
  console.log(`  live ocr.updated_at OLDER than revision created_at : ${pct(clock.invertedVsCreatedAt, clock.n)}%  <- created_at is a SNAPSHOT clock; inversion here is meaningless`);
  console.log(`    ...restricted to pairs whose model changed        : ${pct(clock.modelChangedInvertedVsCreatedAt, clock.modelChanged)}%  (n=${clock.modelChanged})`);
  console.log(`  revision has original_date                          : ${pct(clock.hasOriginalDate, clock.n)}%`);
  console.log(`  original_date PRECEDES live updated_at, model changed: ${pct(clock.modelChangedOrigOrdersOk, clock.modelChangedWithOrig)}%  <- original_date IS a reading clock`);

  const out = {
    date: new Date().toISOString(),
    sample: SAMPLE,
    revisions_total: totalRevs,
    by_source: sourceTable,
    numbered_by_source: numberedTable,
    unnumbered_by_source: unnumberedTable,
    unnumbered_shift_repair_pct: repairUnnumbered,
    clocks: {
      inverted_vs_created_at_pct: pct(clock.invertedVsCreatedAt, clock.n),
      inverted_vs_created_at_model_changed_pct: pct(clock.modelChangedInvertedVsCreatedAt, clock.modelChanged),
      has_original_date_pct: pct(clock.hasOriginalDate, clock.n),
      original_date_orders_correctly_model_changed_pct: pct(clock.modelChangedOrigOrdersOk, clock.modelChangedWithOrig),
    },
    headline: 'page_revisions.source labels the mechanism directly; shift-repair-erara-2026-07 is 99.4% leaf-shifted vs 3.8% for batch_api. No inference required.',
    caveat: 'source says how a row was produced, not which side is correct. Which side is right was settled against the scans (handoff 2026-07-30).',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${OUT}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
