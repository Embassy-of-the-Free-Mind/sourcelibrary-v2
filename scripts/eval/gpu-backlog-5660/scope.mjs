// Tibetan first-OCR scope for job gpu-backlog-5660 (#5660): Tibetan books with never-read pages that pass the script
// gate, minus yigdzin-527's exclusions and by-eye typeset books; HOLD (reason gpu-backlog-5660) before any read is written.
// Writes bo/todo-all.jsonl (yigdzin-527 todo shape) + bo/scope.json. --apply places the holds.
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
import { holdBook } from '/root/sourcelibrary/.claude/worktrees/job-gpu-backlog-5660/scripts/lib/pipeline-hold.mjs';
const APPLY = process.argv.includes('--apply');
const gate = fs.readFileSync('bo/gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const eye = new Map(fs.readFileSync('eye/bo-gate/verdicts.jsonl', 'utf8').trim().split('\n').map(JSON.parse).map(v => [v.book_id, v]));
const excl = JSON.parse(fs.readFileSync('/root/sourcelibrary/.claude/worktrees/job-gpu-backlog-5660/scripts/eval/tibetan-lite-vs-yigdzin/exclude-books.json', 'utf8')).books;
const why = {}; const inScope = [];
for (const g of gate) {
  const e = eye.get(g.id);
  let w = null;
  if (excl[g.id]) w = 'yigdzin-527 exclude list';
  else if (g.tib_share != null && g.tib_share >= 0.8) { if (e && e.page_class === 'typeset') w = 'typeset (by eye)'; }
  else if (!e) w = 'no gate page';
  else if (e.script !== 'tibetan') w = `by eye: ${e.script}`;
  else if (e.page_class === 'typeset') w = 'typeset (by eye)';
  if (w) { why[w] ??= { books: 0, owed: 0 }; why[w].books++; why[w].owed += g.owed; continue; }
  inScope.push(g);
}
const SKIP_TYPES = new Set(['blank', 'archived-spread']);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const out = fs.createWriteStream('bo/todo-all.jsonl'); const tally = { books: 0, rows: 0, typeSkip: 0, noImage: 0, badKey: 0, holds: {} };
const cls = {};
for (const g of inScope) {
  const pages = await db.collection('pages').find({ book_id: g.id, page_number: { $gt: 0 }, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { ocr: null }] }, { projection: { id: 1, page_number: 1, page_type: 1, archived_photo: 1, 'ocr.edited_by': 1, 'ocr.source': 1 } }).sort({ page_number: 1 }).toArray();
  const rows = [];
  for (const p of pages) {
    if (SKIP_TYPES.has(p.page_type)) { tally.typeSkip++; continue; }
    if (p.ocr?.edited_by || p.ocr?.source === 'manual') continue;
    if (!p.archived_photo) { tally.noImage++; continue; }
    if (!p.archived_photo.includes(`/${g.id}/`)) { tally.badKey++; continue; }
    rows.push({ id: p.id, book: g.id, page: p.page_number, stem: `${g.id}_${String(p.page_number).padStart(5, '0')}`, url: p.archived_photo, type: p.page_type ?? null, prior: null, gate: null });
  }
  if (!rows.length) continue;
  if (APPLY) {
    const h = await holdBook(db, g.id, { reason: 'gpu-backlog-5660', issue: 5660, release: 'first OCR (Yigdzin) of these Tibetan pages was job gpu-backlog-5660 (#5660, OCR only); translation is its own priced decision', source: 'gpu-backlog-5660', detail: { engine: 'bdrc-yigdzin-v1' } });
    tally.holds[h.outcome] = (tally.holds[h.outcome] || 0) + 1;
    if (!['held', 'already_held', 'held_other_reason'].includes(h.outcome)) continue;
  }
  const k = g.provider === 'bl' ? 'manuscript' : g.bc === 'handwritten' ? 'manuscript' : g.bc === 'printed' ? 'woodblock' : 'unclassed';
  cls[k] ??= { books: 0, pages: 0 }; cls[k].books++; cls[k].pages += rows.length;
  for (const r of rows) out.write(JSON.stringify(r) + '\n');
  tally.books++; tally.rows += rows.length;
}
out.end();
fs.writeFileSync('bo/scope.json', JSON.stringify({ at: new Date().toISOString(), applied: APPLY, tally, by_class: cls, excluded: why }, null, 1));
console.log(JSON.stringify({ tally, cls, why }));
await c.close();
