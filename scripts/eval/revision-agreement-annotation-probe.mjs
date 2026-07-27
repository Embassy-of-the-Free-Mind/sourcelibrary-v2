#!/usr/bin/env node
/**
 * How much of measured OCR revision DISAGREEMENT is annotation, not text? (#3235)
 *
 * `stripWrappers()` removes the editorial BLOCK wrappers (<meta>, <summary>, …)
 * content-and-all, but for inline marks (<note>, <margin>, <header>, <sig>,
 * <catchword>, <page-num>, <gloss>, <term>, <unclear>, <insert>) it removes only
 * the TAGS and keeps their content — correctly, since those sit on real body
 * text. `<image-desc>` is in NEITHER list, so AI-written illustration prose
 * survives whole.
 *
 * Consequence for the agreement metric: if one OCR pass emits a marginal note or
 * an image description and the other does not, those words count as textual
 * disagreement even though the transcribed body text may be identical. This
 * probe re-scores the same pairs under progressively stricter strips and reports
 * how much of the gap is annotation churn.
 *
 * Read-only, free (Mongo + local compute).
 *   node scripts/eval/revision-agreement-annotation-probe.mjs [--sample=400] [--show=8]
 */
import { MongoClient } from 'mongodb';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { stripWrappers, levenshtein } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '400');
const SHOW = parseInt(args.show || '8');

const INLINE_MARKS = 'note|term|margin|gloss|unclear|insert|header|catchword|sig|page-num';
const dropBlocks = (s, names) => {
  let t = s;
  for (const w of names.split('|')) t = t.replace(new RegExp(`<${w}[^>]*>[\\s\\S]*?</${w}>`, 'gi'), '');
  return t;
};

// Regime A = the production metric (pilot parity).
const A = s => stripWrappers(s || '');
// B = A but also drop <image-desc> blocks (AI-written illustration prose).
const B = s => stripWrappers(dropBlocks(s || '', 'image-desc'));
// C = B but also drop the CONTENT of inline marks, not just their tags.
const C = s => stripWrappers(dropBlocks(s || '', `image-desc|${INLINE_MARKS}`));
// D = C but also drop markdown headings (### …), which are structural, not body.
const D = s => C(s).replace(/^#{1,6}\s.*$/gm, '');

const toWords = t => t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1).slice(0, 800);
const agree = (a, b, norm) => {
  const X = toWords(norm(a)), Y = toWords(norm(b));
  if (!X.length && !Y.length) return null;
  if (!X.length || !Y.length) return 0;
  return 1 - levenshtein(X, Y) / Math.max(X.length, Y.length);
};

// Words present in the annotation regions of a text (what A keeps but C drops).
const annotationWords = s => {
  const kept = new Set(toWords(C(s)));
  return toWords(A(s)).filter(w => !kept.has(w));
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const revs = await db.collection('page_revisions').aggregate([
  { $match: { field: 'ocr', data: { $type: 'string', $ne: '' } } },
  { $sample: { size: SAMPLE } },
  { $project: { page_id: 1, book_id: 1, data: 1, model: 1, prompt_version: 1 } },
]).toArray();

const pageDocs = await db.collection('pages').find(
  { id: { $in: revs.map(r => r.page_id) } },
  { projection: { id: 1, page_number: 1, 'ocr.data': 1 } },
).toArray();
const pageById = new Map(pageDocs.map(p => [p.id, p]));
const bookIds = [...new Set(revs.map(r => r.book_id).filter(Boolean))];
const books = await db.collection('books').find(
  { $or: [{ _id: { $in: bookIds } }, { id: { $in: bookIds } }] },
  { projection: { id: 1, slug: 1, language: 1, year: 1 } },
).toArray();
const bookById = new Map();
for (const b of books) for (const k of [String(b._id), b.id]) if (k) bookById.set(k, b);
await client.close();

const rows = [];
for (const rv of revs) {
  const pg = pageById.get(rv.page_id);
  if (!pg?.ocr?.data) continue;
  const a = agree(rv.data, pg.ocr.data, A);
  if (a == null) continue;
  const bk = bookById.get(rv.book_id) || null;
  rows.push({
    page_id: rv.page_id, page_number: pg.page_number, slug: bk?.slug || null,
    language: bk?.language || null, year: bk?.year ?? null,
    prior: rv.data, current: pg.ocr.data,
    agr_A: a,
    agr_B: agree(rv.data, pg.ocr.data, B),
    agr_C: agree(rv.data, pg.ocr.data, C),
    agr_D: agree(rv.data, pg.ocr.data, D),
    ann_prior: annotationWords(rv.data).length,
    ann_current: annotationWords(pg.ocr.data).length,
    body_prior: toWords(C(rv.data)).length,
    body_current: toWords(C(pg.ocr.data)).length,
    has_imgdesc: /<image-desc/i.test(rv.data) !== /<image-desc/i.test(pg.ocr.data),
  });
}

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = x => (x * 100).toFixed(1) + '%';
console.log(`\nn = ${rows.length} revision pairs (random sample of the OCR corpus)\n`);
console.log('  regime                                              mean agreement   disagreement');
const base = mean(rows.map(r => r.agr_A));
for (const [k, label] of [['agr_A', 'A  production metric (pilot parity)'],
  ['agr_B', 'B  + drop <image-desc> prose'],
  ['agr_C', 'C  + drop inline mark CONTENT (note/margin/header/…)'],
  ['agr_D', 'D  + drop markdown headings']]) {
  const m = mean(rows.map(r => r[k]));
  const share = (m - base) / (1 - base);
  console.log(`  ${label.padEnd(52)} ${pct(m).padStart(6)}        ${pct(1 - m).padStart(6)}` +
    (k === 'agr_A' ? '' : `   (${pct(share)} of A's disagreement explained)`));
}

const annShare = mean(rows.map(r => (r.ann_prior + r.ann_current) / Math.max(1, r.ann_prior + r.ann_current + r.body_prior + r.body_current)));
console.log(`\n  annotation words as a share of all compared words: ${pct(annShare)}`);
const imgAsym = rows.filter(r => r.has_imgdesc);
console.log(`  pairs where exactly one side has <image-desc>: ${imgAsym.length} (${pct(imgAsym.length / rows.length)})` +
  (imgAsym.length ? `  mean agr A ${pct(mean(imgAsym.map(r => r.agr_A)))} → C ${pct(mean(imgAsym.map(r => r.agr_C)))}` : ''));

const low = rows.filter(r => r.agr_A < 0.5);
console.log(`\n  pairs below 0.5 under A: ${low.length} (${pct(low.length / rows.length)}); of those, ` +
  `${low.filter(r => r.agr_C >= 0.5).length} rise above 0.5 under C — i.e. annotation-only "disagreement".`);

// ── spot checks ──────────────────────────────────────────────────
const firstDiff = (x, y) => {
  const X = toWords(A(x)), Y = toWords(A(y));
  let i = 0; while (i < X.length && i < Y.length && X[i] === Y[i]) i++;
  return { prior: X.slice(i, i + 14).join(' '), current: Y.slice(i, i + 14).join(' '), at: i };
};
const picks = [...rows].sort((a, b) => (b.agr_C - b.agr_A) - (a.agr_C - a.agr_A)).slice(0, SHOW);
console.log(`\n=== spot checks: the ${SHOW} pairs most rescued by stripping annotation ===`);
for (const r of picks) {
  const d = firstDiff(r.prior, r.current);
  console.log(`\n  ${r.slug || r.page_id} p${r.page_number} · ${r.language || '?'} ${r.year ?? ''}`);
  console.log(`    agreement  A ${pct(r.agr_A)} → C ${pct(r.agr_C)}   annotation words prior/current: ${r.ann_prior}/${r.ann_current}  body: ${r.body_prior}/${r.body_current}`);
  if (r.slug) console.log(`    https://sourcelibrary.org/book/${r.slug}/page/${r.page_id}`);
  console.log(`    first divergence @word ${d.at}:`);
  console.log(`      prior:   …${d.prior}…`);
  console.log(`      current: …${d.current}…`);
}

const outPath = path.join(__dirname, 'results', `revision-agreement-annotation-probe-${new Date().toISOString().slice(0, 10)}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  date: new Date().toISOString(), n: rows.length,
  means: { A: mean(rows.map(r => r.agr_A)), B: mean(rows.map(r => r.agr_B)), C: mean(rows.map(r => r.agr_C)), D: mean(rows.map(r => r.agr_D)) },
  annotation_word_share: annShare,
  low_under_A: low.length, rescued_by_C: low.filter(r => r.agr_C >= 0.5).length,
  rows: rows.map(({ prior, current, ...rest }) => rest),
}, null, 1));
console.log(`\nSaved → ${outPath}`);
