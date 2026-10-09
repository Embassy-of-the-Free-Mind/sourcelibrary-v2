#!/usr/bin/env node
// PRIOR ART: scripts/batch/realtime-translate.mjs --stale drains every page carrying the
// translation_stale marker; scripts/batch/retranslate-stale.mjs selects by model vintage per book.
// Neither takes "only the pages whose text changed". This is the driver around
// realtime-translate.mjs --book-id --pages-file (#5937), which does the translating and writing.
//
// Stage 4 of #5813 — retranslate only the re-read pages whose text changed materially.
// In: compare.mjs's JSONL (old vs new character agreement per re-read page). Picks pages that were
// re-read, carried a translation, and agree under --threshold (0.95, the pilot's metric); orders
// BOOKS by total change (sum of 1 − agreement), biggest first; runs one realtime-translate.mjs
// process per book, --concurrency at a time. Before each book it adds up what this run has spent
// (gemini_usage rows of the script for these books since --since, tokens × the flash list price)
// and stops starting books once --budget-usd is reached. Books already finished are skipped on a
// re-run (the page rule itself is idempotent: a retranslated page is no longer stale).
// BIGGEST CHANGE FIRST across the whole list is done in tiers: run with --threshold=0.5, then 0.8,
// 0.9, 0.95 over the same --dir; a later tier skips, unpaid, every page an earlier tier translated.
// The budget counts every tier's spend since the first run (state.since, or --since=ISO).
//   node --env-file=… scripts/batch/greek-reocr-5813/stage4-run.mjs --compare=F --dir=DIR --budget-usd=N [--threshold=0.95] [--concurrency=4] [--dry-run]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DRY = process.argv.includes('--dry-run');
const DIR = arg('dir'), THRESHOLD = Number(arg('threshold', '0.95')), BUDGET = Number(arg('budget-usd', '0')), CONC = Number(arg('concurrency', '4'));
// Realtime list prices per token (scripts/lib/model-pricing.mjs is per-model; a row without a model match is priced as flash).
const PRICE = (m) => /flash-lite/.test(m || '') ? [0.25e-6, 1.5e-6] : [0.5e-6, 3e-6];
const rows = fs.readFileSync(arg('compare'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.outcome === 'reread' && r.tr && r.agreement < THRESHOLD);
const byBook = new Map();
for (const r of rows) { const b = byBook.get(r.book_id) || byBook.set(r.book_id, { id: r.book_id, pages: [], change: 0 }).get(r.book_id); b.pages.push(r.page_id); b.change += 1 - r.agreement; }
// A long book is cut into parts of --part pages, each its own process, so one 1,200-page book does
// not take five hours in a single sequential lane. Each page is still seeded from the STORED
// translation of the page before it (realtime-translate.mjs --pages-file), so parts do not interact.
const PART = Number(arg('part', '150'));
const books = [...byBook.values()].sort((a, b) => b.change - a.change).flatMap((b) => {
  if (b.pages.length <= PART) return [b];
  const parts = [];
  for (let i = 0; i < b.pages.length; i += PART) parts.push({ id: b.id, part: parts.length + 1, pages: b.pages.slice(i, i + PART), change: b.change });
  return parts;
});
console.log(`${rows.length} pages under ${THRESHOLD} in ${books.length} books; budget $${BUDGET}`);
if (DRY) { for (const b of books.slice(0, 15)) console.log(`  ${b.id} ${b.pages.length} pages, change ${b.change.toFixed(1)}`); process.exit(0); }
if (!(BUDGET > 0)) { console.error('--budget-usd is required'); process.exit(1); }
fs.mkdirSync(`${DIR}/stage4`, { recursive: true });
const statePath = `${DIR}/stage4/state.json`;
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { since: arg('since', new Date().toISOString()), done: {} };
const key = (b) => `${b.id}@${THRESHOLD}${b.part ? `#${b.part}` : ''}`;
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
save();
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const U = c.db('bookstore').collection('gemini_usage');
const ids = [...new Set(books.map((b) => b.id))];
async function spent() {
  const r = await U.aggregate([
    { $match: { book_id: { $in: ids }, endpoint: 'scripts/realtime-translate.mjs', timestamp: { $gte: new Date(state.since) } } },
    { $group: { _id: '$model', in: { $sum: '$input_tokens' }, out: { $sum: '$output_tokens' }, n: { $sum: 1 } } },
  ]).toArray();
  return r.reduce((s, x) => { const [pi, po] = PRICE(x._id); s.usd += x.in * pi + x.out * po; s.calls += x.n; return s; }, { usd: 0, calls: 0 });
}
const runBook = (b) => new Promise((resolve) => {
  const tag = `${b.id}-${THRESHOLD}${b.part ? `-p${b.part}` : ''}`;
  const pf = `${DIR}/stage4/${tag}.json`;
  fs.writeFileSync(pf, JSON.stringify(b.pages));
  const log = fs.openSync(`${DIR}/stage4/${tag}.log`, 'a');
  const p = spawn(process.execPath, ['scripts/batch/realtime-translate.mjs', `--book-id=${b.id}`, `--pages-file=${pf}`, `--limit=${b.pages.length}`], { stdio: ['ignore', log, log], env: process.env });
  p.on('exit', (code) => { fs.closeSync(log); resolve(code); });
});
let i = 0, stopped = false;
async function lane() {
  while (i < books.length && !stopped) {
    const b = books[i++];
    if (state.done[key(b)]) continue;
    const s = await spent();
    if (s.usd >= BUDGET) { stopped = true; console.log(`budget reached: $${s.usd.toFixed(2)} of $${BUDGET} — not starting ${b.id}`); break; }
    const code = await runBook(b);
    state.done[key(b)] = { pages: b.pages.length, exit: code, at: new Date().toISOString() };
    save();
    console.log(`[${Object.keys(state.done).filter((k) => k.endsWith(`@${THRESHOLD}`)).length}/${books.length}] ${b.id} ${b.pages.length} pages exit ${code}; spent $${s.usd.toFixed(2)} before it`);
  }
}
await Promise.all(Array.from({ length: CONC }, lane));
const s = await spent();
console.log(`done: ${Object.keys(state.done).length}/${books.length} books, ${s.calls} calls, $${s.usd.toFixed(2)} (tokens × list price)${stopped ? ' — STOPPED AT BUDGET' : ''}`);
await c.close();
