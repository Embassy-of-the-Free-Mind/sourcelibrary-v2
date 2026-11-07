#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/chain/volumes-by-draft.mjs — counts pages per book x draft engine (its draft
// buckets are reused here verbatim) but measures no page's SIZE. Nothing in scripts/eval/estimator/ measures what a
// page puts into a Claude call (Derek, 2026-10-26: "10 pages are not the same in all books"); this does, read-only.
/**
 * Page size per router-table cell (#6740): the draft text a corrector reads and rewrites, the image it opens, the
 * layout (OCR <columns> tag, self-reported; page_type table). Read-only, secondary reads, a random sample.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/router-table/page-size.mjs \
 *     [--books=200] [--per-book=30] --out=scripts/eval/estimator/router-table/page-sizes-2026-10-26.json
 * Books: $sample of live books (visible && pages_count > 0) with OCR per language; pages: $sample per book; each page
 * goes to the cell whose draft bucket it is in. Image tokens follow Anthropic's published image rule: resize to at
 * most 1568 px on the long edge and about 1.15 MP, then width x height / 750.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const arg = (n) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const out = arg('out'); const NB = Number(arg('books') || 200); const PB = Number(arg('per-book') || 30);
if (!out) { console.error('--out=FILE required'); process.exit(2); }
const SEED_NOTE = 'Mongo $sample (not seeded): a re-run draws other pages';

const draft = (m) => !m ? 'none' : /flash-lite/.test(m) ? 'lite' : /paddle/i.test(m) ? 'paddle' : /yigdzin/i.test(m) ? 'yigdzin'
  : /^gemini-3-flash/.test(m) ? 'flash3' : /^claude/.test(m) ? 'claude' : /antigravity|gemini-3\.[678]|gemini-4/.test(m) ? 'agy' : 'other';
// cell -> (language, test on a page). Translation cells: the German source a translator reads, the English it writes.
const CELLS = {
  'latin-lite': ['Latin', p => draft(p.m) === 'lite'],
  'latin-flash3': ['Latin', p => draft(p.m) === 'flash3'],
  'german-lite': ['German', p => draft(p.m) === 'lite'],
  'german-flash3': ['German', p => draft(p.m) === 'flash3'],
  'german-tr-flash3': ['German', p => /^gemini-3-flash/.test(p.tm || '')],
  'german-tr-lite': ['German', p => /flash-lite/.test(p.tm || '')],
  'french-lite': ['French', p => draft(p.m) === 'lite'],
  'tibetan-yigdzin': ['Tibetan', p => draft(p.m) === 'yigdzin'],
  'zh-paddle-dice-lt090': ['Chinese', p => draft(p.m) === 'paddle' && typeof p.dice === 'number' && p.dice < 0.9],
  'zh-6561-served': ['Chinese', p => draft(p.m) === 'paddle'],
  'chinese-flash3': ['Chinese', p => draft(p.m) === 'flash3'],
  'zh-frame-6871': ['Chinese', p => p.pipe === 'paddle-zh-guarded-2026-10'],
  'hebrew-flash3': ['Hebrew', p => draft(p.m) === 'flash3'],
  'arabic-flash3': ['Arabic', p => draft(p.m) === 'flash3'],
};
const imgTokens = (w, h) => {
  if (!w || !h) return null;
  const s = Math.min(1, 1568 / Math.max(w, h), Math.sqrt(1.15e6 / (w * h)));
  return Math.round(w * h * s * s / 750);
};
const qs = (xs, p) => { const a = xs.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor(p * (a.length - 1))] : null; };

const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const pages = Object.fromEntries(Object.keys(CELLS).map(c => [c, []]));
for (const language of [...new Set(Object.values(CELLS).map(([l]) => l))]) {
  const books = await db.collection('books').aggregate([
    { $match: { language, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } } }, { $sample: { size: NB } }, { $project: { id: 1 } }]).toArray();
  for (const b of books) {
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: b.id, 'ocr.data': { $type: 'string' } } }, { $sample: { size: PB } },
      // strlen-safe: the $match above keeps only pages whose ocr.data is a string
      { $project: { _id: 0, m: '$ocr.model', pipe: '$ocr.pipeline', dice: '$ocr.qa_screen.dice', tm: '$translation.model',
        chars: { $strLenCP: '$ocr.data' }, tchars: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, { $strLenCP: '$translation.data' }, null] },
        gout: '$ocr.output_tokens', w: '$image_width', h: '$image_height', pt: '$page_type',
        cols: { $regexFind: { input: '$ocr.data', regex: /<columns>\s*(\d+)\s*<\/columns>/i } } } }],
      { maxTimeMS: 120000 }).toArray();
    for (const p of rows) for (const [c, [l, f]] of Object.entries(CELLS)) if (l === language && f(p)) pages[c].push({ ...p, book: b.id });
  }
  console.error(`${language}: ${books.length} books sampled`);
}
// two Chinese cells are too rare in random books: sample their pages directly instead
// strlen-safe: every $match that uses PROJ requires 'ocr.data': { $type: 'string' }
const PROJ = { _id: 0, book: '$book_id', m: '$ocr.model', pipe: '$ocr.pipeline', dice: '$ocr.qa_screen.dice', chars: { $strLenCP: '$ocr.data' },
  gout: '$ocr.output_tokens', w: '$image_width', h: '$image_height', pt: '$page_type',
  cols: { $regexFind: { input: '$ocr.data', regex: /<columns>\s*(\d+)\s*<\/columns>/i } } };
for (const [c, match] of [['zh-frame-6871', { 'ocr.pipeline': 'paddle-zh-guarded-2026-10' }],
  ['zh-paddle-dice-lt090', { 'ocr.qa_screen.dice': { $lt: 0.9 }, 'ocr.model': /paddle/i }]]) {
  try {
    const rows = await db.collection('pages').aggregate([{ $match: { ...match, 'ocr.data': { $type: 'string' } } }, { $sample: { size: NB * 5 } }, { $project: PROJ }],
      { maxTimeMS: 900000, allowDiskUse: true }).toArray();
    if (rows.length > pages[c].length) { pages[c] = rows; console.error(`${c}: ${rows.length} pages sampled directly`); }
  } catch (e) { console.error(`${c}: direct sample failed (${e.message}); keeping the book sample`); }
}
await client.close();

const res = {};
for (const [c, ps] of Object.entries(pages)) {
  const ch = ps.map(p => p.chars), it = ps.map(p => imgTokens(p.w, p.h));
  const cpt = ps.filter(p => p.gout > 20 && p.chars > 50).map(p => p.chars / p.gout);
  const multi = ps.filter(p => (Number(p.cols?.captures?.[0]) || 1) >= 2 || /table/i.test(p.pt || '')).length;
  res[c] = { language: CELLS[c][0], pages: ps.length, books: new Set(ps.map(p => p.book)).size,
    draft_chars: { median: qs(ch, .5), p90: qs(ch, .9) },
    translation_chars: c.startsWith('german-tr') ? { median: qs(ps.map(p => p.tchars), .5), p90: qs(ps.map(p => p.tchars), .9) } : undefined,
    image_tokens: { median: qs(it, .5), p90: qs(it, .9), with_dims: it.filter(x => x != null).length },
    image_px: { width_median: qs(ps.map(p => p.w), .5), height_median: qs(ps.map(p => p.h), .5) },
    gemini_chars_per_output_token: { median: qs(cpt, .5), n: cpt.length },
    multi_column_share: ps.length ? +(multi / ps.length).toFixed(3) : null };
}
fs.writeFileSync(out, JSON.stringify({ generated_by: 'scripts/eval/estimator/router-table/page-size.mjs (read-only)', as_of: new Date().toISOString(),
  sample: `${NB} live books per language with OCR, up to ${PB} OCR'd pages each; ${SEED_NOTE}`,
  multi_column: 'OCR <columns>N</columns> with N >= 2 (self-reported by the OCR model) or page_type matching /table/', cells: res }, null, 1) + '\n');
console.error('wrote', out);
