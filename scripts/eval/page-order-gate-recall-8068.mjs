#!/usr/bin/env node
// PRIOR ART: scripts/eval/page-marker-order.mjs (the census runner: it reads books in their CURRENT
// order, and the #5699 books are now renumbered, so it can no longer see them as they arrived);
// scripts/eval/results/page-order-dryrun-5699/verdicts.json (the by-eye verdicts this scores against).
/**
 * page-order-gate-recall-8068 — score the #8068 gate (scripts/lib/page-order-gate.mjs) before it may hold
 * anything. READ-ONLY, $0, no model calls.
 *
 *   recall   the 50 confirmed #5699 books + Kitab Manafi, each read in the order it ARRIVED in: the
 *            renumber's sweep_log moves (`renumber-page-order-5699`) are inverted page by page.
 *   fp       the 10 #5699 false positives (read in their current order; none was renumbered).
 *   draw     a $sample of non-English books with OCR, current order: the false-hold rate's upper bound
 *            (a flag there is a false hold unless the book is a reversal nobody has found yet).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/page-order-gate-recall-8068.mjs \
 *     [--draw 400] [--out <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { getScriptClient } from '../lib/mongo.mjs';
import { readOrderPages, pageOrderVerdict } from '../lib/page-order-gate.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('--out', 'scripts/eval/results/page-order-gate-8068');
const DRAW = Number(arg('--draw', 400));
const KITAB = '69af0cf0ca8f47eb1206ae5c';
fs.mkdirSync(OUT, { recursive: true });

const verdicts = JSON.parse(fs.readFileSync('scripts/eval/results/page-order-dryrun-5699/verdicts.json', 'utf8')).books;
const { client, db } = await getScriptClient({ timeoutMs: 1_800_000, socketTimeoutMs: 180_000 });
const rows = [];

/** page id → page_number before every renumber of this book (rows inverted newest first). */
async function arrivalOrder(bookId) {
  const logs = await db.collection('sweep_log').find({ sweep: 'renumber-page-order-5699', book_id: bookId }).sort({ timestamp: -1 }).toArray();
  if (!logs.length) return { renumbered: false, fn: null };
  return {
    renumbered: true,
    fn: (p) => {
      let n = p.page_number;
      for (const l of logs) for (const [id, from, to] of l.detail?.moves || []) if (id === p.id && to === n) { n = from; break; }
      return n;
    },
  };
}

const known = [...verdicts.filter((b) => b.pattern !== 'false positive').map((b) => ({ book_id: b.book_id, title: b.title, language: b.language, pattern: b.pattern })),
  ...(verdicts.some((b) => b.book_id === KITAB) ? [] : [{ book_id: KITAB, title: 'Kitab Manafi al-Aghdhiyah', language: 'Arabic', pattern: 'whole book descending (missed by v5)' }])];
for (const b of known) {
  const { renumbered, fn } = await arrivalOrder(b.book_id);
  const v = pageOrderVerdict(await readOrderPages(db, b.book_id, { pageNumberOf: fn }));
  rows.push({ set: 'recall', ...b, renumbered, ...v });
  console.error(`recall ${b.book_id} ${b.pattern} renumbered=${renumbered} hold=${v.hold} P=${v.markers_P} S=${v.markers_S}`);
}
for (const b of verdicts.filter((x) => x.pattern === 'false positive')) {
  const v = pageOrderVerdict(await readOrderPages(db, b.book_id));
  rows.push({ set: 'fp', book_id: b.book_id, title: b.title, language: b.language, pattern: b.pattern, ...v });
  console.error(`fp ${b.book_id} hold=${v.hold}`);
}
const knownIds = new Set(verdicts.map((b) => b.book_id).concat(KITAB));
const draw = await db.collection('books').aggregate([
  { $match: { pages_ocr: { $gte: 10 }, language: { $nin: ['English', 'english', null, ''] } } },
  { $sample: { size: DRAW } },
  { $project: { _id: 0, id: 1, title: 1, language: 1, visible: 1 } },
]).toArray();
for (const b of draw) {
  if (knownIds.has(b.id)) continue;
  const v = pageOrderVerdict(await readOrderPages(db, b.id));
  rows.push({ set: 'draw', book_id: b.id, title: String(b.title || '').slice(0, 90), language: b.language, visible: b.visible, ...v });
}
await client.close();

fs.writeFileSync(path.join(OUT, 'verdicts.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const by = (set, f = () => true) => rows.filter((r) => r.set === set && f(r));
const pats = [...new Set(by('recall').map((r) => r.pattern))];
const summary = {
  generated_at: new Date().toISOString(),
  recall: Object.fromEntries(pats.map((p) => [p, { books: by('recall', (r) => r.pattern === p).length, held: by('recall', (r) => r.pattern === p && r.hold).length }])),
  recall_total: { books: by('recall').length, held: by('recall', (r) => r.hold).length },
  recall_with_10_markers: { books: by('recall', (r) => r.markers_P >= 10 || r.markers_S >= 10).length, held: by('recall', (r) => (r.markers_P >= 10 || r.markers_S >= 10) && r.hold).length },
  false_positives_5699: { books: by('fp').length, held: by('fp', (r) => r.hold).length },
  draw: { books: by('draw').length, with_10_markers: by('draw', (r) => r.markers_P >= 10 || r.markers_S >= 10).length, held: by('draw', (r) => r.hold).length },
  missed: by('recall', (r) => !r.hold).map((r) => `${r.book_id} ${r.pattern} P=${r.markers_P} S=${r.markers_S} ${String(r.title).slice(0, 50)}`),
  draw_held: by('draw', (r) => r.hold).map((r) => ({ book_id: r.book_id, language: r.language, title: r.title, runs: r.desc_runs })),
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
