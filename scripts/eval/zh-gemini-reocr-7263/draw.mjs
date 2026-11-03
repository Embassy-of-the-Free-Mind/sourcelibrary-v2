#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs plan / pageOf (the page rule, the image check, the plan.json and
// texts/ shape its judge stage reads; written to that shape here). It cannot draw this cell: frameFor takes Flash-Lite
// German, French and Latin only, its draw is book-uniform, and this frame's median book holds ONE Gemini page, so a
// book-uniform draw would answer for residue pages rather than for the ~120K pages the question is about.
/**
 * The draw of #7263's Chinese re-read cell test: 30 books, one body page each, seed 20261103, none in existing evidence.
 * Books in a seeded order with probability proportional to their print frame pages (exponential keys, no replacement), so
 * each frame page is about equally likely. In a book, a page uniform among its interior print pages. Read-only.
 * Two strata, the Siku Quanshu cohort and the rest (--stratum=siku|print): by title and hold, most pages Gemini tags printed
 * are Siku hand copies, which the Paddle print lane does not read.
 *   node --env-file=... scripts/eval/zh-gemini-reocr-7263/draw.mjs --frame=frame.json --out=DIR --stratum=print [--n=40] [--seed=20261103]
 */
import '../router-confirm/readonly-mongo.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { isInterior, lastPageNumber } from '../../batch/cli-ocr-lane.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { bodyCharCount } from '../../lib/paddle-print-lane.mjs';
import { evidenceSources } from '../router-confirm/confirm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.resolve(HERE, '..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out')), N = Number(arg('n', 40)), SEED = Number(arg('seed', 20261103));
const MODEL_RE = '^(gemini-3-flash-preview|gemini-3\\.1-flash-lite)';
// holds that say the text is already known bad and sits in its own repair lane: not this question
const REPAIR_HOLD = /contain|invented|wrong-leaf|scrambled|unsettled|served-audit|qa-/i;
const MIN_HAN = 100;
// the Siku Quanshu cohort, whatever Gemini's tag says: its holds (paddle-print-lane.mjs SIKU_HOLDS) or a juan-and-volume title.
// Gemini tags these hand copies `printed` (by eye, 10 of 10 on the first sheet).
const SIKU_HOLDS = /^(paddle-zh-5600-ocr-only|paddle-zh-6388-ocr-only|paddle-zh-6388-excluded|gpu-backlog-5660)$/;
const isSiku = (b) => SIKU_HOLDS.test(String(b.hold?.reason ?? '')) || /·卷|\(vol \d+\)/.test(String(b.title || ''));
const STRATUM = arg('stratum', 'print');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// The judged evidence on Chinese: every source a Chinese cell of rules.json cites, the #7866 draw, the router's evidence
// folder. Not every 24-hex id under scripts/eval: coverage lists and classifier runs name most of the frame (a first
// draw on those excluded 265 of 333 books, the large printed ones first) and they judged nothing.
function evidenceIds() {
  const ids = new Set();
  const rules = JSON.parse(fs.readFileSync(path.join(EVAL, 'estimator/router-table/rules.json'), 'utf8'));
  const cells = rules.cells.filter((x) => /^(chinese|zh)-/.test(x.id)).map((x) => x.id);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [...cells.flatMap((x) => evidenceSources(x).files), ...walk(path.join(EVAL, 'confidence-7866/results')), ...walk(path.join(EVAL, 'estimator/router-table/evidence')), ...walk(path.join(EVAL, 'flash-reread-5924/results-7568/zh'))];
  for (const f of new Set(files)) {
    let b = fs.readFileSync(f); if (f.endsWith('.gz')) { try { b = zlib.gunzipSync(b); } catch { continue; } }
    for (const m of b.toString('latin1').match(/[0-9a-f]{24}/g) || []) ids.add(m);
  }
  return ids;
}

const frame = JSON.parse(fs.readFileSync(arg('frame'), 'utf8'));
const printPages = (b) => b.counts.filter((x) => x.cls !== 'handwritten' && !x.human).reduce((t, x) => t + x.n, 0);
const elig = frame.rows.filter((b) => printPages(b) > 0 && !REPAIR_HOLD.test(String(b.hold?.reason ?? '')) && isSiku(b) === (STRATUM === 'siku')).sort((a, b) => a.book_id.localeCompare(b.book_id));
const rnd = makeRng(SEED);
const order = elig.map((b) => ({ b, key: -Math.log(1 - rnd()) / printPages(b) })).sort((x, y) => x.key - y.key).map((x) => x.b);
const ev = evidenceIds();
console.log(`frame books ${frame.rows.length}; print-eligible ${elig.length}; ${elig.reduce((t, b) => t + printPages(b), 0)} pages; evidence ids ${ev.size}; frame books named in evidence ${elig.filter((b) => ev.has(b.book_id)).length}`);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
for (const b of await db.collection('lane_judge_verdicts').distinct('book_id')) ev.add(b);
const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
const sel = [], skipped = {}; let tried = 0;
const skip = (w) => { skipped[w] = (skipped[w] ?? 0) + 1; };
for (const b of order) {
  if (sel.length >= N) break;
  tried++;
  if (ev.has(b.book_id)) { skip('book in evidence'); continue; }
  const all = await db.collection('pages').find({ book_id: b.book_id }, { projection: { id: 1 } }).toArray();
  if (all.some((p) => ev.has(p.id))) { skip('a page of the book in evidence'); continue; }
  const rows = await db.collection('pages').find({ book_id: b.book_id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $regex: MODEL_RE }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $exists: false }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } },
    { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, 'ocr.data': 1, 'ocr.model': 1 } }).sort({ page_number: 1 }).toArray();
  const last = await lastPageNumber(db, b.book_id);
  const owed = rows.filter((p) => {
    const sc = scriptClass(p.ocr.data, p.script_type, null).script_type;
    const pt = /<page-type>\s*([^<]*?)\s*<\/page-type>/i.exec(p.ocr.data)?.[1];
    return sc !== 'manuscript' && sc !== 'mixed' && (!pt || /^text$/i.test(pt)) && bodyCharCount(p.ocr.data.replace(/<(?!\/?(?:margin)\b)[^>]+>[^<]*<\/[^>]+>/g, ' ')) >= MIN_HAN && isInterior(p.page_number, last);
  });
  if (!owed.length) { skip(rows.length ? `no interior print body page of ${MIN_HAN}+ Han` : 'no eligible page'); continue; }
  const pick = owed[Math.floor(makeRng(SEED + parseInt(b.book_id.slice(-6), 16))() * owed.length)];
  const image = getPageSource(pick)?.replace(/\s+/g, '');
  if (!image) { skip('no image source'); continue; }
  try { const r = await fetch(image); const nb = (await r.arrayBuffer()).byteLength; if (!r.ok || nb < 2000) { skip(`image ${r.ok ? 'under 2 KB' : `HTTP ${r.status}`}`); continue; } } catch { skip('image fetch failed'); continue; }
  const stored = pick.ocr.data, key = `V4-${pick.id}`;
  const info = await db.collection('books').findOne({ id: b.book_id }, { projection: { needs_splitting: 1, split_completed: 1, 'image_source.provider': 1 } });
  fs.writeFileSync(path.join(OUT, 'texts', `${key}.lite.txt`), stored);
  sel.push({ key, book_id: b.book_id, title: String(b.title || '').slice(0, 80), language: b.language, year: b.year, page_id: pick.id, page_number: pick.page_number, image, block: [pick.id], stored_model: pick.ocr.model, stored_sha: sha(stored).slice(0, 16), words: bodyCharCount(stored), han: bodyCharCount(stored),
    script: scriptClass(stored, pick.script_type, null), owed: owed.length, hold: b.hold?.reason ?? null, status: b.status, provider: info?.image_source?.provider ?? null, needs_splitting: !!info?.needs_splitting, split_completed: !!info?.split_completed });
  console.log(`  ${sel.length}/${N} ${b.book_id} p.${pick.page_number} ${pick.ocr.model.slice(7, 20)} han=${sel.at(-1).han} hold=${b.hold?.reason ?? '-'} ${String(b.title || '').slice(0, 40)}`);
}
await c.close();
const P = {
  at: new Date().toISOString(), cell: `chinese-gemini/${STRATUM}`, stratum: STRATUM, lang_name: 'Chinese', unit: 'Han and kana characters of the stored page', n_target: N, n_drawn: sel.length, seed: SEED,
  rule: { within: 0.08, wrong_text_max: 0.04, source: 'rules.json switch', max_unparsed_share: 0.10 },
  page_rule: { min_han: MIN_HAN, models: MODEL_RE, page_type: 'text or none', script: 'not manuscript or mixed by tag / pages.script_type' },
  frame: { books_in_frame: frame.rows.length, print_books: elig.length, print_pages: elig.reduce((t, b) => t + printPages(b), 0), books_tried: tried, skipped, unit: 'one page a book, books with probability proportional to print frame pages', repair_holds_left_out: String(REPAIR_HOLD) },
  selected: sel,
};
fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(P, null, 1));
console.log(JSON.stringify({ ...P, selected: undefined }, null, 1));
