// PRIOR ART: scripts/eval/route-judge-6740/jcb-1600-8049/run.mjs drawEuro (the cell test's draw: unread pages drawn
// BEFORE the route reads them, read and dry-applied by the harness). It does not fit the gate: the gate judges what
// the production lane WROTE (the pilot, `cli-ocr-lane.mjs armc --frame=euro --apply`), so the draw is over the lane's
// ledger, and the text is the stored page. The packet / judge / score stages after it are run.mjs and judge.mjs, unchanged.
/**
 * #6871 euro route gate: draw N written pilot pages of one cell, one a book where books allow, seeded; write the
 * run.mjs files (sample.json, written.json) so `run.mjs packet|plant|score --study=euro-6871` and `judge.mjs judge`
 * run on them unchanged. Also counts, over EVERY page the pilot tried: written / refused, marker residue in written
 * text, refusal reasons. Read-only (Mongo reads; files under --out).
 *
 *   node --env-file=… draw.mjs --cell=es19 --ledger=<lane>/armc-ledger.jsonl --out=DIR [--n=30]
 *        [--exclude=<cell-test sample.json>,…] [--since=ISO]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const CELL = arg('cell'), OUT = path.resolve(arg('out')), N = Number(arg('n') || 30), SINCE = arg('since') ? Date.parse(arg('since')) : 0;
const CELLS = { es19: { lang: 'Spanish', years: [1800, 1929], engine: 'lo', route: 'lighton>agy-flash-low' }, fr19: { lang: 'French', years: [1800, 1929], engine: 'lo', route: 'lighton>agy-flash-low' },
  // #6871 English widening gate (run.mjs --study=en19-6871): its own lane stamp and study. Bare guarded LightOnOCR reads
  // (Derek 2026-11-07 "we can use ocr gpu until we later correct"), written by gpu-print-lane.mjs --lang en19: --applied=<lane dir>
  en19: { lang: 'English', years: [1800, 1929], engine: 'lo', route: 'lighton (bare, guarded)', lane: 'gpu-print-en19-2026-11', study: 'en19-6871' } };
if (!CELLS[CELL]) throw new Error('--cell=es19|fr19|en19');
const MARKER = /<<<\s*(?:BEGIN|END)\s*>>>/;
// --ledger: an armc ledger. --applied=<dir>: a gpu-print-lane.mjs lane dir (applied / rejected / skipped .jsonl), as ledger rows
const jsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const laneRows = (d) => [
  ...jsonl(path.join(d, 'applied.jsonl')).map((r) => ({ page_id: r.pid, book_id: r.bid, page_number: r.pn, outcome: 'written', at: r.at })),
  ...jsonl(path.join(d, 'rejected.jsonl')).map((r) => ({ page_id: r.pid, book_id: r.bid, page_number: r.pn, outcome: 'refused', why: r.reason, at: r.at })),
  ...jsonl(path.join(d, 'skipped.jsonl')).map((r) => ({ page_id: r.pid ?? null, book_id: r.bid, page_number: r.pn, outcome: 'skipped', why: r.why, at: r.at })),
];
const rows = (arg('applied') ? laneRows(path.resolve(arg('applied'))) : jsonl(arg('ledger'))).filter((r) => Date.parse(r.at) >= SINCE);
// cell-test pages (both draws): never drawn again
const ex = new Set();
for (const f of (arg('exclude') || '').split(',').filter(Boolean)) for (const c of Object.values(JSON.parse(fs.readFileSync(f, 'utf8')).cells)) for (const p of c.pages) ex.add(p.page_id);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const written = rows.filter((r) => r.outcome === 'written');
const pages = new Map((await db.collection('pages').find({ id: { $in: written.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.pipeline': 1 } }).toArray()).map((p) => [p.id, p]));
await c.close();
const t = { tried: rows.length, written: written.length, by_outcome: {}, refused_why: {}, marker_residue: 0, marker_pages: [], not_stamped: 0, excluded_cell_test: 0 };
for (const r of rows) {
  t.by_outcome[r.outcome] = (t.by_outcome[r.outcome] ?? 0) + 1;
  if (r.outcome !== 'written') { const k = String(r.why).replace(/[0-9a-f]{24}/g, '<id>').slice(0, 90); t.refused_why[k] = (t.refused_why[k] ?? 0) + 1; }
}
for (const r of written) {
  const p = pages.get(r.page_id);
  if (MARKER.test(p?.ocr?.data || '')) { t.marker_residue++; t.marker_pages.push(r.page_id); }
  if (p?.ocr?.pipeline !== (CELLS[CELL].lane ?? 'gpu-agy-first-read-euro-6871')) t.not_stamped++;
}
// the draw: books in seeded order, one random written page a book, then a second round over the same order
const pool = written.filter((r) => { if (ex.has(r.page_id)) { t.excluded_cell_test++; return false; } return pages.get(r.page_id)?.ocr?.data; });
const byBook = new Map();
for (const r of pool) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
const books = [...byBook.keys()].sort((a, b) => h(`6871-gate-${CELL}-${a}`).localeCompare(h(`6871-gate-${CELL}-${b}`)));
for (const b of books) byBook.get(b).sort((x, y) => h(`6871-gate-${CELL}-${x.page_id}`).localeCompare(h(`6871-gate-${CELL}-${y.page_id}`)));
const picks = [];
for (let round = 0; picks.length < N && round < 30; round++) for (const b of books) { if (picks.length >= N) break; const r = byBook.get(b)[round]; if (r) picks.push({ ...r, round }); }
fs.mkdirSync(OUT, { recursive: true });
const C = CELLS[CELL];
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify({ drawn_at: new Date().toISOString(), study: C.study ?? 'euro-6871', gate: 'euro-route-gate-6871', cells: { [CELL]: { ...C, books: new Set(picks.map((p) => p.book_id)).size, pages: picks.map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, round: r.round })) } }, frame: { [CELL]: { books_written: books.length, ...t } } }, null, 1));
fs.writeFileSync(path.join(OUT, 'written.json'), JSON.stringify({ [CELL]: Object.fromEntries(picks.map((r) => [r.page_id, { text: pages.get(r.page_id).ocr.data }])) }, null, 1));
console.log(`${CELL}: ${picks.length} pages drawn from ${new Set(picks.map((p) => p.book_id)).size} books (${books.length} books with a written page)`, JSON.stringify(t));
