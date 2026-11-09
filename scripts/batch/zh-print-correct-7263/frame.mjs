#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-gemini-reocr-7263/frame.mjs + draw.mjs (the frame and page rule of the cell test; the
// Siku test and the page rule are restated here because draw.mjs runs at import and only draws). ocr-convergence/driver.mjs
// frame (distinct ip-day readers per book, restated: it writes queue files of its own and drops held books).
// ocr-convergence/lib.mjs translationLaneReason: the rule for which books a translate lane would pick up, imported.
/**
 * #7263 job zh-print-correct-7263: the pages Opus corrects, from Mongo. Read-only.
 *   node --env-file=... scripts/batch/zh-print-correct-7263/frame.mjs --frame=frame-all.json --out=DIR
 * Writes DIR/books.json (per book, ranked by readers) and DIR/pages.jsonl.gz (page_id, book_id, page_number, state).
 * A page is `owed` when it holds a Gemini read, is not human-edited, is a page of reading text (typed text, untyped, or
 * preface, contents, index and the like), carries 30+ Han and kana and is not tagged handwritten or mixed. Wider than the
 * rule the 26/30 measured (text or untyped, 100+ Han, interior, English not withheld), so the pilot draws from THIS rule.
 * Others carry the reason. English withheld for a stale or looping source stays owed: the OCR is what the reader still sees.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { bodyCharCount } from '../../lib/paddle-print-lane.mjs';
import { scriptClass } from '../../eval/lane-judge-sampler.mjs';
import { translationLaneReason } from '../ocr-convergence/lib.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
export const MODEL_RE = '^(gemini-3-flash-preview|gemini-3\\.1-flash-lite)';
export const MIN_HAN = 30;
const READING_TYPES = /^(text|toc|toc, text|preface|index|colophon|errata|appendix|table)$/i;
const WITHHELD_BY_EYE = /invented_by_eye|leaked-reasoning|ocr_unreadable/;
const WRITE_STATUSES = ['complete', 'chapters_complete', 'translate_complete'];
/** The one hold whose books may be corrected: the lane's own hold, kept. Its release is a decision that prices the English. */
export const WRITABLE_HOLD = 'paddle-print-6101';
const SIKU_HOLDS = /^(paddle-zh-5600-ocr-only|paddle-zh-6388-ocr-only|paddle-zh-6388-excluded|gpu-backlog-5660)$/;
export const isSiku = (b) => SIKU_HOLDS.test(String(b.hold?.reason ?? '')) || /·卷|\(vol \d+\)/.test(String(b.title || ''));


/**
 * Why this book's pages may not be written now, or null. A corrected page's English predates its OCR, and translate-worker
 * and Phase 4 re-translate such pages on a paid lane in the statuses translationLaneReason names. A book in such a status
 * is deferred: no read, no write, retried each wave. `b` is a books document.
 */
export function writeGate(b) {
  const hold = b.pipeline_auto?.hold?.reason ?? null;
  if (b.needs_splitting === true && b.split_completed !== true) return 'unsplit spread book';
  if (hold) return hold === WRITABLE_HOLD ? null : `hold ${hold}`;
  if (!WRITE_STATUSES.includes(b.pipeline_auto?.status)) return `status ${b.pipeline_auto?.status}: a lane may translate it`;
  return translationLaneReason(b);
}

/** Why a page is not owed, or null. `p` needs ocr.data, ocr.model, ocr.edited_by, ocr.source, ocr.unreadable, script_type, translation_withheld. */
export function pageState(p) {
  if (!new RegExp(MODEL_RE).test(p.ocr?.model || '')) return 'not a Gemini read now';
  if (p.ocr?.edited_by || p.ocr?.source === 'manual') return 'human-edited';
  if (p.ocr?.unreadable === true) return 'ocr.unreadable';
  if (WITHHELD_BY_EYE.test(String(p.translation_withheld?.reason ?? ''))) return 'English withheld by eye';
  const sc = scriptClass(p.ocr.data, p.script_type, null).script_type;
  if (sc === 'manuscript' || sc === 'mixed') return 'tagged handwritten or mixed';
  const pt = /<page-type>\s*([^<]*?)\s*<\/page-type>/i.exec(p.ocr.data)?.[1];
  if (pt && !READING_TYPES.test(pt)) return 'not a page of reading text';
  if (bodyCharCount(p.ocr.data.replace(/<(?!\/?(?:margin)\b)[^>]+>[^<]*<\/[^>]+>/g, ' ')) < MIN_HAN) return `under ${MIN_HAN} Han`;
  return null;
}

async function main() {
  const OUT = path.resolve(arg('out'));
  fs.mkdirSync(OUT, { recursive: true });
  const frame = JSON.parse(fs.readFileSync(arg('frame'), 'utf8'));
  const print = frame.rows.filter((b) => !isSiku(b));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const since = new Date(Date.now() - 60 * 86400e3);
  const docs = new Map((await db.collection('books').find({ id: { $in: print.map((b) => b.book_id) } }, { projection: { id: 1, slug: 1, title: 1, language: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, human_read_count: 1, needs_splitting: 1, split_completed: 1, processing_priority: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
  const views = await db.collection('analytics_pageviews').aggregate([
    { $match: { timestamp: { $gte: since }, path: /^\/book\// } },
    { $project: { slug: { $arrayElemAt: [{ $split: ['$path', '/'] }, 2] }, ip: 1, d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } },
    { $group: { _id: { s: '$slug', ip: '$ip', d: '$d' } } },
    { $group: { _id: '$_id.s', v: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();
  const bySlug = new Map(views.map((r) => [r._id, r.v]));
  const pagesOut = zlib.createGzip();
  pagesOut.pipe(fs.createWriteStream(path.join(OUT, 'pages.jsonl.gz')));
  const books = []; let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < print.length) {
      const b = print[i++]; const d = docs.get(b.book_id);
      const rows = await db.collection('pages').find({ book_id: b.book_id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $regex: MODEL_RE } }, { projection: { id: 1, page_number: 1, script_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.unreadable': 1, translation_withheld: 1, 'translation.data': 1, translation_stale: 1 } }).toArray();
      const states = {}; let owed = 0, en = 0;
      for (const p of rows) {
        const st = pageState(p); states[st ?? 'owed'] = (states[st ?? 'owed'] ?? 0) + 1;
        if (!st) { owed++; if (p.translation?.data) en++; }
        pagesOut.write(JSON.stringify({ page_id: p.id, book_id: b.book_id, page_number: p.page_number, state: st ?? 'owed', en: !!p.translation?.data, model: p.ocr.model }) + '\n');
      }
      const hold = d.pipeline_auto?.hold?.reason ?? null;
      books.push({ book_id: b.book_id, slug: d.slug, title: String(d.title || '').slice(0, 80), language: d.language, year: d.year ?? null, views: (bySlug.get(d.slug) || 0) + (bySlug.get(d.id) || 0), human_read_count: d.human_read_count ?? 0, status: d.pipeline_auto?.status ?? null, hold, gate: writeGate(d), processing_priority: d.processing_priority ?? null, pages_ocr: d.pages_ocr ?? 0, pages_blank: d.pages_blank ?? 0, pages_translated: d.pages_translated ?? 0, gemini_pages: rows.length, owed, owed_with_english: en, states });
    }
  }));
  pagesOut.end();
  await c.close();
  books.sort((a, b) => b.views - a.views || b.owed - a.owed);
  books.forEach((b, r) => { b.rank = r + 1; });
  fs.writeFileSync(path.join(OUT, 'books.json'), JSON.stringify({ at: new Date().toISOString(), frame_at: frame.at, n: books.length, books }, null, 1));
  const sum = (f) => books.reduce((t, b) => t + f(b), 0);
  const st = {}; for (const b of books) for (const [k, v] of Object.entries(b.states)) st[k] = (st[k] ?? 0) + v;
  console.log(JSON.stringify({ print_books: books.length, gemini_pages: sum((b) => b.gemini_pages), states: st, owed: sum((b) => b.owed), owed_with_english: sum((b) => b.owed_with_english) }, null, 1));
}
if (process.argv[1]?.endsWith('frame.mjs')) await main();
