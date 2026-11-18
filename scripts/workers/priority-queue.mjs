#!/usr/bin/env node
// PRIOR ART: scripts/lib/priority-queue.mjs — the rule (this is its only scheduled caller). scripts/workers/
// pipeline-next-snapshot / situation.mjs --brief (#379) — report what is waiting by step and hold, not in what order.
// The #380 share instrument (/root/jobs/new-books-first-380/code/share.mjs on gex45) — the same before/after count of
// agy pages per priority, never committed; this is it in the repo, run every time the queue is.
/**
 * priority-queue — compute the ranked queue (v3#461) and publish it.
 *
 *   node --env-file=.env.production.local scripts/workers/priority-queue.mjs [--dry-run] [--to=ISO] [--hours=24] [--top=10]
 *
 * READS: `books` (visible with pages; stored fields only, one projection scan) and the page writes of the window on the
 * indexed `ocr.updated_at` / `translation.updated_at` (agy lanes only), plus a count of stale translations
 * (`translation_stale.reason`, partial index). No model calls.
 *
 * WRITES (ops_reports, three documents; nothing on books or pages):
 *   priority-queue:latest     the report: tiers with owed / done in the window / days to clear, the head (top 50 with a
 *                             reason each), held books by hold with who owns the release, and the share of agy pages
 *                             per priority in the window. /admin/pipeline and the daily mail read it.
 *   priority-queue:ranks      the ranked book ids. ACTUATION: lanes that read it (cli-ocr-lane.mjs run --cohort=finish, via
 *                             queueRankOrder) take books in this order for QUEUE_MAX_AGE_H after it is written.
 *   priority-queue:<day>      the day's last report, kept, so a before/after reads two days side by side.
 *
 * The window's share is attributed to each book's place at the START of the window: the window's own agy first reads
 * and first translations are taken back from its counters first, so a book that crossed into complete yesterday still
 * counts its pages as finishing work.
 */
import { MongoClient } from 'mongodb';
import {
  buildQueue, placeBook, classifyWrite, shareByPriority, daysToClear, QUEUE_BOOK_PROJECTION,
  QUEUE_VERSION, QUEUE_REPORT_ID, QUEUE_RANKS_ID, QUEUE_TYPE, TIERS,
} from '../lib/priority-queue.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const DRY = process.argv.includes('--dry-run');
const HOURS = Number(arg('hours') || 24), TOP = Number(arg('top') || 10);
const TO = arg('to') ? new Date(arg('to')) : new Date(Math.floor(Date.now() / 3600e3) * 3600e3);
const FROM = new Date(TO.getTime() - HOURS * 3600e3);
const HEAD = 50;

/** The agy page writes in [from, to): [{ book_id, stage, kind }]. Index-driven, small projection. */
async function windowWrites(db, from, to) {
  const out = [];
  const scan = async (stage, field, projection) => {
    const cur = db.collection('pages').find({ [field]: { $gte: from, $lt: to } }, { projection: { _id: 0, book_id: 1, ...projection } })
      .hint({ [field]: -1 }).batchSize(5000);
    for await (const p of cur) { const c = classifyWrite(stage, p); if (c) out.push({ book_id: p.book_id, ...c }); }
  };
  await scan('ocr', 'ocr.updated_at', { 'ocr.lane': 1, 'ocr.pipeline': 1 });
  await scan('translation', 'translation.updated_at', { 'translation.lane': 1, 'translation.engine.run.read_call': 1, 'translation.engine.run.job_id': 1 });
  return out;
}

const n0 = (v) => Math.round(v).toLocaleString('en-US');
const pctS = (v) => `${(100 * v).toFixed(1)}%`;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const t0 = Date.now();
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: QUEUE_BOOK_PROJECTION }).batchSize(5000).toArray();
  const writes = await windowWrites(db, FROM, TO);
  // Take the window's first writes back from each book, for its place at the start of the window.
  const adjust = new Map();
  for (const w of writes) {
    if (w.kind !== 'first') continue;
    const a = adjust.get(w.book_id) ?? { translated: 0, ocr: 0 };
    if (w.stage === 'translation') a.translated++; else a.ocr++;
    adjust.set(w.book_id, a);
  }
  const byId = new Map(books.map((b) => [b.id, b]));
  const startPlace = new Map();
  const placeOf = (id) => {
    if (!startPlace.has(id)) startPlace.set(id, byId.has(id) ? placeBook(byId.get(id), { adjust: adjust.get(id) ?? null }) : null);
    return startPlace.get(id);
  };
  const share = shareByPriority(writes, placeOf);
  const q = buildQueue(books);
  const stale = await db.collection('pages').countDocuments({ 'translation_stale.reason': { $exists: true } }, { hint: { 'translation_stale.reason': 1, book_id: 1 }, maxTimeMS: 120000 }).catch(() => null);

  const done = (key) => share.buckets[key] ?? { ocr: 0, translation: 0, total: 0, share: 0 };
  const perDay = 24 / HOURS;
  const tiers = q.tiers.map((t) => {
    const d = done(t.key);
    return { ...t, done: { translation: d.translation, ocr: d.ocr }, days_to_clear: daysToClear(t.owed, d.translation * perDay), days_to_read: daysToClear(t.unread, d.ocr * perDay) };
  });
  const again = done('reread');
  tiers.push({ ...TIERS[2], books: null, owed: stale, unread: null, owed_note: 'pages whose English is stale after a re-read (translation_stale), awaiting re-translation; the re-read frame itself is page-level and not counted here',
    done: { translation: again.translation, ocr: again.ocr }, days_to_clear: daysToClear(stale ?? 0, again.translation * perDay), days_to_read: null });
  const heldBooks = q.held.reduce((s, h) => s + h.books, 0);
  const report = {
    _id: QUEUE_REPORT_ID, type: QUEUE_TYPE, version: QUEUE_VERSION, generated_at: new Date().toISOString(), generated_by: 'scripts/workers/priority-queue.mjs',
    issue: 461, window: { from: FROM.toISOString(), to: TO.toISOString(), hours: HOURS },
    order: 'tier (1 finish >= 80% in English, 2 first reads and first translations, 3 re-reads); inside a tier: asked for, fewest pages to get there, larger share in English, id',
    books_scanned: books.length, queued: q.ranked.length, tiers,
    head: q.ranked.slice(0, HEAD).map(({ rank, tier, key, id, title, language, reason, owed, unread, share: s }) => ({ rank, tier, key, id, title, language, reason, owed, unread, share: Math.round(1000 * s) / 1000 })),
    held: { books: heldBooks, derek_books: q.held.filter((h) => h.derek).reduce((s, h) => s + h.books, 0), by_reason: q.held.slice(0, 60) },
    share: { total: share.total, buckets: share.buckets },
    took_ms: Date.now() - t0,
  };

  console.log(`priority queue ${report.generated_at}: ${n0(books.length)} visible books, ${n0(q.ranked.length)} queued, ${n0(heldBooks)} held out (${q.held.length} holds)`);
  for (const t of tiers) console.log(`  ${t.tier} ${t.label}: ${t.books == null ? '' : `${n0(t.books)} books, `}${t.owed == null ? '?' : n0(t.owed)} pages owed English${t.unread ? ` (${n0(t.unread)} unread)` : ''}; done in ${HOURS} h: ${n0(t.done.translation)} translated, ${n0(t.done.ocr)} read; ${t.days_to_clear == null ? 'no pace' : `${Math.round(t.days_to_clear)} days to clear`}`);
  console.log(`  agy pages ${FROM.toISOString()} -> ${TO.toISOString()}: ${n0(share.total)}; ${Object.entries(share.buckets).map(([k, v]) => `${k} ${pctS(v.share)} (${n0(v.ocr)} OCR, ${n0(v.translation)} tr)`).join(' · ')}`);
  console.log(`next ${TOP}:`);
  for (const r of report.head.slice(0, TOP)) console.log(`  ${r.rank}. [${r.key}] ${String(r.title ?? r.id).slice(0, 60)} (${r.language ?? '?'}) — ${r.reason}`);
  console.log('held (top 10):');
  for (const h of q.held.slice(0, 10)) console.log(`  ${h.reason}: ${n0(h.books)} books, ${n0(h.owed)} pages owed; release: ${h.owner}`);

  if (!DRY) {
    const c = db.collection('ops_reports');
    // A window ending in the past (--to) is a backfill: it keeps its day document, never the live report or ranks.
    const live = Math.abs(Date.now() - TO.getTime()) < 3600e3;
    await c.replaceOne({ _id: `${QUEUE_TYPE}:${TO.toISOString().slice(0, 10)}` }, { ...report, _id: `${QUEUE_TYPE}:${TO.toISOString().slice(0, 10)}`, kind: 'daily' }, { upsert: true });
    if (!live) { console.log(`written: ${QUEUE_TYPE}:${TO.toISOString().slice(0, 10)} only (window ends ${TO.toISOString()}, not now)`); await client.close(); return; }
    await c.replaceOne({ _id: QUEUE_REPORT_ID }, report, { upsert: true });
    await c.replaceOne({ _id: QUEUE_RANKS_ID }, { _id: QUEUE_RANKS_ID, type: QUEUE_TYPE, version: QUEUE_VERSION, generated_at: report.generated_at,
      tier_starts: Object.fromEntries([1, 2].map((t) => [t, q.ranked.findIndex((r) => r.tier === t)])), ids: q.ranked.map((r) => r.id) }, { upsert: true });
    console.log(`written: ${QUEUE_REPORT_ID}, ${QUEUE_RANKS_ID} (${q.ranked.length} ids), ${QUEUE_TYPE}:${TO.toISOString().slice(0, 10)}`);
  } else console.log('dry run: nothing written');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
