#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs onePerBook() (seeded one-page-per-book draw) and
// scripts/eval/error-zoo/labels.mjs (the stale check: the live text moved after the audit). Neither draws from the
// weekly audit's on-disk pool by finding stage, which is what this test needs.
/**
 * Draw the English-repair test set (#342) from pool.jsonl (pool.py): weekly-audit RANDOM served pages, Opus reader.
 *   en_only  a serious finding in the English, none in the transcription
 *   both     serious findings in both
 *   clean    no serious finding at all (the harm control)
 * Kept only where the live page still serves the audited text (ocr.data and translation.data byte-equal to the
 * packet), is not withheld or stale, and the book is not English. One page per book across the whole set.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/english-repair-342/draw.mjs \
 *        --pool=$JOB_SCRATCH/pool.jsonl --out=$JOB_SCRATCH/set --en_only=50 --both=50 --clean=100
 * Read-only: one indexed find on pages by (book_id, page_number).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SALT = arg('salt', 'english-repair-342');
const h = (s) => createHash('sha256').update(`${SALT}:${s}`).digest('hex');
const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
const want = { en_only: +arg('en_only', 50), both: +arg('both', 50), clean: +arg('clean', 100) };
const out = arg('out'); fs.mkdirSync(out, { recursive: true });

const pool = fs.readFileSync(arg('pool'), 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter((r) => r.selection === 'random' && want[r.group] && r.right_page !== 'no' && r.image && fs.existsSync(r.image)
    && !/^english$/i.test(r.language || '') && words(r.translation) >= 40 && r.ocr);
// a page audited in two rounds: keep the latest audit
const latest = new Map();
for (const r of pool) { const k = `${r.book_id}|${r.page_number}`; if (!latest.has(k) || latest.get(k).drawn_at < r.drawn_at) latest.set(k, r); }
const cands = [...latest.values()];

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const live = new Map();
for (let i = 0; i < cands.length; i += 400) {
  const docs = await db.collection('pages').find({ $or: cands.slice(i, i + 400).map((r) => ({ book_id: r.book_id, page_number: r.page_number })) },
    { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1, translation_withheld: 1, translation_stale: 1 } }).toArray();
  for (const d of docs) live.set(`${d.book_id}|${d.page_number}`, d);
}
await c.close();

const why = {};
const ok = [];
for (const r of cands) {
  const d = live.get(`${r.book_id}|${r.page_number}`);
  const bad = !d ? 'missing' : d.ocr?.data !== r.ocr ? 'ocr_changed' : d.translation?.data !== r.translation ? 'translation_changed'
    : d.translation_withheld ? 'withheld' : d.translation_stale ? 'stale' : null;
  if (bad) { why[`${r.group}/${bad}`] = (why[`${r.group}/${bad}`] ?? 0) + 1; continue; }
  ok.push({ ...r, page_id: d.id ?? String(d._id), live_model: d.translation?.model ?? null, live_translation_at: d.translation?.updated_at ?? null });
}
// One page per book: groups drawn in a fixed order of scarcity (both, en_only, clean), seeded order within each.
const usedBooks = new Set();
const set = [];
for (const g of ['both', 'en_only', 'clean']) {
  const byBook = new Map();
  for (const r of ok.filter((x) => x.group === g).sort((a, b) => h(a.page_id).localeCompare(h(b.page_id)))) if (!byBook.has(r.book_id)) byBook.set(r.book_id, r);
  const picked = [...byBook.values()].filter((r) => !usedBooks.has(r.book_id)).slice(0, want[g]);
  for (const r of picked) { usedBooks.add(r.book_id); set.push(r); }
}
fs.writeFileSync(path.join(out, 'set.jsonl'), set.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'page-ids.json'), JSON.stringify(set.map((r) => r.page_id)));
const tally = {}; for (const r of set) tally[r.group] = (tally[r.group] ?? 0) + 1;
const langs = {}; for (const r of set) langs[r.language] = (langs[r.language] ?? 0) + 1;
console.log(JSON.stringify({ candidates: cands.length, eligible: ok.length, dropped: why, drawn: tally, languages: langs }, null, 1));
