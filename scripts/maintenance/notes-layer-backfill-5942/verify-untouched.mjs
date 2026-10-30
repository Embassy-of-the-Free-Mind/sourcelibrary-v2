#!/usr/bin/env node
/**
 * Did any lane pick up the backfilled pages? (#5942) Snapshot what the lanes key on right after a
 * backfill run, then compare a while later (the brief: 30 minutes). Read-only.
 *
 * PRIOR ART: backfill.mjs in this directory writes the pages this checks; nothing else snapshots
 * the lane keys of a page set (status-output-drift.mjs measures books, not a run's pages).
 *
 * What a lane selects on, per page and per book, and what it writes when it acts:
 *   pages:  updated_at, translation.updated_at, ocr.updated_at, the data hash, translation_stale,
 *           translation_withheld, pipeline status fields — and new page_revisions rows (any source
 *           but the backfill's own), which every translation/OCR writer makes before it writes.
 *   books:  updated_at, pipeline_auto.status, pages_translated, translation_state.rung.
 *   Supabase page_translations (the embedding lane): mongo_updated_at + updated_at per page.
 *
 * USAGE
 *   node --env-file=.env.production.local …/verify-untouched.mjs --pages <pilot.jsonl> --snapshot <out.json>
 *   node --env-file=.env.production.local …/verify-untouched.mjs --pages <pilot.jsonl> --compare <out.json>
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const PAGES = arg('--pages');
const SNAP = arg('--snapshot');
const CMP = arg('--compare');
if (!PAGES || (!SNAP && !CMP)) { console.error('--pages <jsonl> and --snapshot <file> | --compare <file>'); process.exit(2); }
const ids = readFileSync(PAGES, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.written === true).map((r) => r.page_id);
const h = (s) => (s == null ? null : createHash('sha256').update(String(s)).digest('hex').slice(0, 16));
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

const client = new MongoClient(process.env.MONGODB_URI, { appName: 'notes-layer-verify-5942' });
await client.connect();
const db = client.db('bookstore');

async function capture() {
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, updated_at: 1, 'translation.updated_at': 1, 'translation.data': 1, 'translation.text_from': 1, 'ocr.updated_at': 1, translation_stale: 1, translation_withheld: 1, status: 1 } }).toArray();
  const out = { at: new Date().toISOString(), pages: {}, books: {}, revisions: {}, supabase: {} };
  for (const p of pages) {
    out.pages[p.id] = { book_id: p.book_id, updated_at: iso(p.updated_at), tr_updated_at: iso(p.translation?.updated_at), ocr_updated_at: iso(p.ocr?.updated_at), data: h(p.translation?.data), text_from: p.translation?.text_from?.data_hash ?? null, stale: !!p.translation_stale, withheld: !!p.translation_withheld, status: p.status ?? null };
  }
  const bookIds = [...new Set(pages.map((p) => p.book_id))];
  for (const b of await db.collection('books').find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, updated_at: 1, 'pipeline_auto.status': 1, pages_translated: 1, 'translation_state.rung': 1 } }).toArray()) {
    out.books[b.id] = { updated_at: iso(b.updated_at), status: b.pipeline_auto?.status ?? null, pages_translated: b.pages_translated ?? null, rung: b.translation_state?.rung ?? null };
  }
  for (const r of await db.collection('page_revisions').aggregate([{ $match: { page_id: { $in: ids }, source: { $ne: 'notes-layer-backfill-5942' } } }, { $group: { _id: '$page_id', n: { $sum: 1 } } }]).toArray()) out.revisions[r._id] = r.n;
  if (process.env.SUPABASE_DB_URL) {
    const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const { rows } = await c.query('SELECT page_id, max(mongo_updated_at) AS m, max(updated_at) AS u, count(*)::int AS n FROM page_translations WHERE page_id = ANY($1) GROUP BY page_id', [ids]);
    for (const r of rows) out.supabase[r.page_id] = { m: iso(r.m), u: iso(r.u), n: r.n };
    await c.end();
  } else out.supabase = null;
  return out;
}

const now = await capture();
if (SNAP) {
  writeFileSync(SNAP, JSON.stringify(now));
  console.log(`snapshot: ${Object.keys(now.pages).length} pages, ${Object.keys(now.books).length} books, ${now.supabase ? Object.keys(now.supabase).length : 'no'} supabase rows, at ${now.at}`);
} else {
  const was = JSON.parse(readFileSync(CMP, 'utf8'));
  const diff = { pages: [], books: [], revisions: [], supabase: [] };
  for (const [id, p] of Object.entries(was.pages)) {
    const q = now.pages[id];
    const changed = Object.keys(p).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(q?.[k]));
    if (changed.length) diff.pages.push({ id, changed, was: Object.fromEntries(changed.map((k) => [k, p[k]])), now: Object.fromEntries(changed.map((k) => [k, q?.[k]])) });
  }
  for (const [id, b] of Object.entries(was.books)) {
    const q = now.books[id];
    const changed = Object.keys(b).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(q?.[k]));
    if (changed.length) diff.books.push({ id, changed, was: Object.fromEntries(changed.map((k) => [k, b[k]])), now: Object.fromEntries(changed.map((k) => [k, q?.[k]])) });
  }
  for (const id of new Set([...Object.keys(was.revisions), ...Object.keys(now.revisions)])) if ((was.revisions[id] || 0) !== (now.revisions[id] || 0)) diff.revisions.push({ id, was: was.revisions[id] || 0, now: now.revisions[id] || 0 });
  if (was.supabase && now.supabase) for (const id of new Set([...Object.keys(was.supabase), ...Object.keys(now.supabase)])) if (JSON.stringify(was.supabase[id]) !== JSON.stringify(now.supabase[id])) diff.supabase.push({ id, was: was.supabase[id], now: now.supabase[id] });
  console.log(JSON.stringify({ snapshot_at: was.at, now: now.at, pages: Object.keys(was.pages).length, changed_pages: diff.pages.length, changed_books: diff.books.length, new_revisions: diff.revisions.length, supabase_changed: diff.supabase.length, diff }, null, 1));
}
await client.close();
