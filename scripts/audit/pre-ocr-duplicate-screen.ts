/**
 * pre-ocr-duplicate-screen — hold a book out of paid OCR when we already hold (and read) the same printing (#4285).
 *
 * PRIOR ART: src/lib/holdings-check.ts `checkHoldings()` (the candidate generator used here, unchanged);
 * scripts/audit/page-image-same-printing.py (the verdict, unchanged: this script only feeds it pairs and
 * reads its jsonl); scripts/lib/pipeline-hold.mjs `holdBook()` (the hold). scripts/maintenance/
 * dedup-books.mjs and hide-efm-duplicates.mjs merge or hide by metadata — this screen never merges,
 * hides or writes `duplicate_of`; it only keeps an unread copy out of the OCR lane.
 *
 * WHY. Every duplicate read is paid twice (OCR, then translation), and edition keys miss about one live
 * duplicate in 13 while passing volumes and reprints as the same (#6019, #4285). An unread book has no
 * text to compare, so the decision comes from page images (ORB+RANSAC, calibrated on 25 pairs).
 *
 * THREE STEPS (step 2 is the Python image check):
 *   1. candidates  books entering OCR (status archive_complete|queued, processing_priority >= MIN) →
 *                  checkHoldings() on title/author/year/pages → plausible same-edition pairs → pairs.tsv
 *   2. uv run -q --env-file .env.production.local scripts/audit/page-image-same-printing.py \
 *          --pairs <dir>/pairs.tsv --out <dir>/verdicts.jsonl --wide
 *   3. decide      read verdicts → holds.jsonl (dry run) or hold with --apply, and review.jsonl
 *
 * HOLD RULE. Only on a `same_printing` verdict, never on metadata alone. The queued book Q is held when
 * the other copy C is at least 90% of Q's length and C is read (pages_ocr >= 80% of its pages), or
 * further along the pipeline than Q, or also queued and preferred (higher priority, then visible, then
 * more pages, then id). A copy much shorter than Q (an incomplete scan) never takes Q's place.
 * Everything else with a `same_printing` verdict goes to review.jsonl for a person.
 *
 * Usage (from the repo root; reads only, unless `decide --apply`):
 *   npx tsx --env-file=.env.production.local scripts/audit/pre-ocr-duplicate-screen.ts candidates --dir <dir> [--min-priority 50] [--limit N]
 *   npx tsx --env-file=.env.production.local scripts/audit/pre-ocr-duplicate-screen.ts decide --dir <dir> [--apply]
 */

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, type Db, type Document } from 'mongodb';
import { checkHoldings, type HoldingReason } from '../../src/lib/holdings-check';
// @ts-expect-error — untyped .mjs helper
import { holdBook } from '../lib/pipeline-hold.mjs';

const ENTERING_OCR = ['archive_complete', 'queued'];
const HOLD_REASON = 'same-edition-copy-unread'; // shared with the 13 image-confirmed holds of 2026-10-21 (#6019)
const RELEASE = 'the copy named in hold.detail.kept turns out not to be the same printing (title pages read by eye), or it is withdrawn';

// Reasons worth an image check. `other_edition` is vetoed by a differing year or volume; the weaker
// title-only reasons are kept only when the page counts agree, which is the same-edition signature.
const STRONG: HoldingReason[] = ['same_source_object', 'same_iiif_manifest', 'same_edition', 'same_edition_year_unknown',
  'same_work_same_year', 'title_author_near_same_year', 'related_copy'];
const IF_PAGES_AGREE: HoldingReason[] = ['same_work', 'title_author_near', 'near_title'];

const arg = (k: string, d: string | null = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const pagesAgree = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(4, 0.05 * Math.max(a, b));
const STAGE: Record<string, number> = { archiving: 0, archive_complete: 1, queued: 2, ocr_queued: 3, held: 3 };
const stage = (s: string | null | undefined) => STAGE[s ?? ''] ?? 4; // anything later (ocr_complete, enriched…) is further along

const BOOK_PROJ = { id: 1, title: 1, author: 1, year: 1, published: 1, pages_count: 1, pages_ocr: 1, visible: 1, hidden: 1, processing_priority: 1, 'pipeline_auto.status': 1, duplicate_of: 1 };

async function candidates(db: Db, dir: string) {
  const min = Number(arg('--min-priority', '50'));
  const limit = Number(arg('--limit', '0'));
  let q = db.collection('books').find(
    { 'pipeline_auto.status': { $in: ENTERING_OCR }, processing_priority: { $gte: min }, pages_count: { $gt: 0 } },
    { projection: BOOK_PROJ }).sort({ processing_priority: -1 });
  if (limit) q = q.limit(limit);
  const queued = await q.toArray();
  console.log(`${queued.length} books entering OCR at priority >= ${min}`);
  const seen = new Set<string>();
  const pairs: string[] = [];
  const rows: Document[] = [];
  let i = 0, withCand = 0;
  for (const b of queued) {
    i++;
    let res;
    try {
      res = await checkHoldings(db, { title: b.title, author: b.author, year: b.year ?? null, published: b.published ?? null, pages: b.pages_count });
    } catch (e) {
      rows.push({ book_id: b.id, error: String(e) });
      continue;
    }
    const keep = res.candidates.filter((c) => c.book_id !== b.id && String(c.book_id) !== String(b._id) && c.collection === 'books' && c.pages_count > 0
      && (STRONG.includes(c.reason) || (IF_PAGES_AGREE.includes(c.reason) && pagesAgree(b.pages_count, c.pages_count))));
    if (keep.length) withCand++;
    for (const c of keep) {
      const key = [b.id, c.book_id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(`${b.id}\t${c.book_id}`);
      rows.push({ book_id: b.id, other: c.book_id, reason: c.reason, detail: c.reason_detail, title: b.title, other_title: c.title });
    }
    if (i % 50 === 0) console.log(`  ${i}/${queued.length} checked, ${withCand} with candidates, ${pairs.length} pairs`);
  }
  fs.writeFileSync(path.join(dir, 'pairs.tsv'), pairs.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'candidates.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({ queued: queued.length, with_candidates: withCand, pairs: pairs.length, errors: rows.filter((r) => r.error).length }));
}

/** Which of two same-printing copies should wait. Returns the id to hold, or null for a person to decide. */
function chooseHold(a: Document, b: Document): { hold: Document; kept: Document; why: string } | null {
  const read = (x: Document) => (x.pages_ocr || 0) >= 0.8 * (x.pages_count || 1);
  const entering = (x: Document) => ENTERING_OCR.includes(x.pipeline_auto?.status) && !read(x);
  for (const [q, c] of [[a, b], [b, a]] as const) {
    if (!entering(q)) continue;
    if ((c.pages_count || 0) < 0.9 * (q.pages_count || 0)) continue; // never let a short copy stand in
    if (read(c)) return { hold: q, kept: c, why: 'other copy is read' };
    if (stage(c.pipeline_auto?.status) > stage(q.pipeline_auto?.status) && c.pipeline_auto?.status !== 'held') return { hold: q, kept: c, why: `other copy is further along (${c.pipeline_auto?.status})` };
  }
  if (entering(a) && entering(b) && pagesAgree(a.pages_count, b.pages_count)) {
    const score = (x: Document) => [x.processing_priority || 0, x.visible ? 1 : 0, x.pages_count || 0];
    const sa = score(a), sb = score(b);
    const cmp = sa.findIndex((v, k) => v !== sb[k]);
    const aWins = cmp === -1 ? a.id < b.id : sa[cmp] > sb[cmp];
    return aWins ? { hold: b, kept: a, why: 'both queued; the other is preferred' } : { hold: a, kept: b, why: 'both queued; the other is preferred' };
  }
  return null;
}

async function decide(db: Db, dir: string, apply: boolean) {
  const verdicts = fs.readFileSync(path.join(dir, 'verdicts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tally: Record<string, number> = {};
  for (const v of verdicts) tally[v.verdict] = (tally[v.verdict] || 0) + 1;
  console.log(`verdicts: ${JSON.stringify(tally)}`);
  const same = verdicts.filter((v) => v.verdict === 'same_printing');
  const ids = [...new Set(same.flatMap((v) => [v.a, v.b]))];
  const books = new Map((await db.collection('books').find({ id: { $in: ids } }, { projection: BOOK_PROJ }).toArray()).map((b) => [b.id, b]));
  const holds: Document[] = [], review: Document[] = [];
  const willHold = new Set<string>();
  const brief = (x: Document) => ({ id: x.id, title: String(x.title || '').slice(0, 70), year: x.year ?? x.published ?? null, pages: x.pages_count, pages_ocr: x.pages_ocr || 0, status: x.pipeline_auto?.status, visible: !!x.visible, duplicate_of: x.duplicate_of || null });
  for (const v of same) {
    const a = books.get(v.a), b = books.get(v.b);
    if (!a || !b) continue;
    if (willHold.has(a.id) || willHold.has(b.id)) continue; // already decided through another pair
    const pick = chooseHold(a, b);
    if (pick && !willHold.has(pick.kept.id)) {
      willHold.add(pick.hold.id);
      holds.push({ hold: brief(pick.hold), kept: brief(pick.kept), why: pick.why, median_inliers: v.median, inliers: v.inliers });
    } else {
      review.push({ a: brief(a), b: brief(b), median_inliers: v.median, inliers: v.inliers });
    }
  }
  fs.writeFileSync(path.join(dir, 'holds.jsonl'), holds.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'review.jsonl'), review.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const pages = holds.reduce((s, h) => s + (h.hold.pages - h.hold.pages_ocr), 0);
  console.log(`${holds.length} to hold (${pages} unread pages), ${review.length} same-printing pairs for review (${apply ? 'APPLY' : 'dry run'})`);
  const outcomes: Record<string, number> = {};
  for (const h of holds) {
    const r = await holdBook(db, h.hold.id, {
      reason: HOLD_REASON, issue: 4285, release: RELEASE, source: 'pre-ocr-duplicate-screen',
      detail: { kept: h.kept.id, why: h.why, median_inliers: h.median_inliers },
    }, { dryRun: !apply });
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
    console.log(`  ${r.outcome.padEnd(17)} ${h.hold.id} ${h.hold.title.slice(0, 40).padEnd(40)} keeps ${h.kept.id} (${h.why}, median ${h.median_inliers})`);
  }
  console.log(JSON.stringify({ outcomes, unread_pages_held: pages, review: review.length, apply }));
}

async function main() {
  const mode = process.argv[2];
  const dir = arg('--dir');
  if (!dir || !['candidates', 'decide'].includes(mode)) {
    console.error('usage: pre-ocr-duplicate-screen.ts candidates|decide --dir <dir> (see the header)');
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    if (mode === 'candidates') await candidates(db, dir);
    else await decide(db, dir, process.argv.includes('--apply'));
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
