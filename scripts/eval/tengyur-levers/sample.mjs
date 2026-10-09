#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-characterize/sample.mjs (#5829) draws a uniform sample over the whole
// drafted Tengyur. #6121 needs exact counts per weak SECTION, mid-text pages only, and the two previous
// sides plus the text's title for the context arm, so it reuses that file's helpers (common.mjs) and its
// draw method (seeded global index, never $sample) on a section-restricted population.
/**
 * sample.mjs — read-only, $0. Step 1 of #6121: 60 mid-text pages of the Derge Tengyur draft,
 * 30 Pramāṇa + 10 each Madhyamaka, Vinaya, Jātaka, seeded (6121) uniform draw by global index over
 * each section's pages with translation.data. Rejected (redrawn) when the page or the side before it
 * opens a text ({D####}), when the page carries a colophon, or when either of the two previous sides
 * has no e-text — so the context arm always has two previous sides of the same text.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-levers/sample.mjs
 *
 * Writes <out>/sample.json (metadata + rejections) and <work>/sample-pages.jsonl (Tibetan, the two
 * previous sides, neighbours' lines, the stored English, the text's titles).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { sectionOf, verseShare, isColophon, openingAt, rng as mkRng } from '../tengyur-characterize/common.mjs';

// --round 3 (#6182): a FRESH reviewer sample of 100 (seed 6182), excluding every page of rounds 1–2's
// sample, their planted controls and the reference-aligned sides, written to the #6182 directories.
const R3 = process.argv.includes('--round') && process.argv[process.argv.indexOf('--round') + 1] === '3';
const out = R3 ? 'scripts/eval/results/pareto-6182/tib-rev' : 'scripts/eval/results/tengyur-levers-6121';
const work = R3 ? '/root/pareto-6182/rev' : '/root/tlev';
const EXCLUDE = new Set(R3 ? ['/root/tlev/sample-pages.jsonl', '/root/tlev/ref-pages.jsonl', '/root/tlev/controls.jsonl', '/root/tlev2/controls-1.jsonl']
  .flatMap((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : [])) : []);
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(work, { recursive: true });
const PLAN = R3 ? [['Pramāṇa', 40], ['Madhyamaka', 30], ['Vinaya', 15], ['Jātaka', 15]] : [['Pramāṇa', 30], ['Madhyamaka', 10], ['Vinaya', 10], ['Jātaka', 10]];
const SEED = R3 ? 6182 : 6121;

const HAS_EN = { 'translation.data': { $type: 'string', $nin: [''] } };
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const pages = db.collection('pages');
const allBooks = (await db.collection('books').find({ 'catalog_ids.derge_tengyur_volume': { $exists: true } },
  { projection: { id: 1, title: 1, catalog_ids: 1 } }).toArray())
  .sort((a, b) => a.catalog_ids.derge_tengyur_volume - b.catalog_ids.derge_tengyur_volume);

const marksCache = {};
async function marks(book_id) {
  if (marksCache[book_id]) return marksCache[book_id];
  const rows = await pages.aggregate([
    { $match: { book_id } },
    { $project: { _id: 0, page_number: 1, m: { $regexFindAll: { input: { $ifNull: ['$ocr.data', ''] }, regex: /\{D\d+[a-zA-Z]?\}/ } } } },
    { $sort: { page_number: 1 } },
  ]).toArray();
  return (marksCache[book_id] = rows.map((r) => ({ page_number: r.page_number, marks: r.m.map((x) => x.match.slice(1, -1)) })));
}

// The text's titles as its opening side gives them: རྒྱ་གར་སྐད་དུ། <Sanskrit> བོད་སྐད་དུ། <Tibetan>.
const titleCache = {};
async function titlesOf(toh, vol) {
  if (!toh) return null;
  if (titleCache[toh] !== undefined) return titleCache[toh];
  for (let v = vol; v >= 1 && v >= vol - 3; v--) {
    const b = allBooks.find((x) => x.catalog_ids.derge_tengyur_volume === v);
    if (!b) continue;
    const m = (await marks(b.id)).find((r) => r.marks.includes(toh));
    if (!m) continue;
    const two = await pages.find({ book_id: b.id, page_number: { $in: [m.page_number, m.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    const t = two.map((x) => x.ocr?.data || '').join('\n');
    const after = t.slice(t.indexOf(`{${toh}}`));
    const clean = (s) => (s || '').replace(/\{[^}]*\}|\[[^\]]*\]|#|\([^)]*,|\)/g, '').replace(/\s+/g, ' ').trim();
    const skt = after.match(/རྒྱ་གར་སྐད་དུ[།\s]*([^།]+)/);
    // Texts that run on from an earlier volume open with a running title instead: "།<title>་བཞུགས".
    const bod = after.match(/བོད་སྐད་དུ[།\s]*([^།]+)/) || after.slice(0, 400).match(/།\s*([^།]+?)་?བཞུགས/);
    return (titleCache[toh] = { toh, sanskrit: skt ? clean(skt[1]) : null, tibetan: bod ? clean(bod[1]) : null });
  }
  return (titleCache[toh] = { toh, sanskrit: null, tibetan: null });
}

const ln = (s) => (s || '').split('\n').filter((l) => l.trim());
const proj = { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.folio': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1 };
const meta = [], lines = [], rejected = [], population = {};
for (const [section, n] of PLAN) {
  const vols = [];
  for (const b of allBooks.filter((x) => sectionOf(x.title) === section)) {
    vols.push({ vol: b.catalog_ids.derge_tengyur_volume, book_id: b.id, with_english: await pages.countDocuments({ book_id: b.id, ...HAS_EN }) });
  }
  const total = vols.reduce((s, x) => s + x.with_english, 0);
  population[section] = { vols: vols.length, with_english: total };
  const R = mkRng(SEED + PLAN.findIndex((p) => p[0] === section));
  const seen = new Set();
  let got = 0;
  while (got < n) {
    const g = Math.floor(R() * total);
    if (seen.has(g)) continue;
    seen.add(g);
    let k = g, v;
    for (const x of vols) { if (k < x.with_english) { v = x; break; } k -= x.with_english; }
    const [pg] = await pages.find({ book_id: v.book_id, ...HAS_EN }, { projection: proj }).sort({ page_number: 1 }).skip(k).limit(1).toArray();
    const nb = await pages.find({ book_id: v.book_id, page_number: { $in: [pg.page_number - 2, pg.page_number - 1, pg.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
    const at = (d) => nb.find((x) => x.page_number === pg.page_number + d)?.ocr?.data || '';
    const bo = pg.ocr?.data || '', p1 = at(-1), p2 = at(-2);
    const why = EXCLUDE.has(pg.id) ? 'used in rounds 1–2' : /\{D\d+[a-zA-Z]?\}/.test(bo) ? 'opens a text' : /\{D\d+[a-zA-Z]?\}/.test(p1) ? 'previous side opens a text'
      : isColophon(bo) ? 'colophon' : (!p1.trim() || !p2.trim()) ? 'no two previous sides' : null;
    if (why) { rejected.push({ section, g, page_id: pg.id, vol: v.vol, page_number: pg.page_number, why }); continue; }
    const op = openingAt(await marks(v.book_id), pg.page_number);
    for (let vv = v.vol - 1; !op.current && vv >= 1; vv--) {
      const pb = allBooks.find((x) => x.catalog_ids.derge_tengyur_volume === vv);
      if (pb) op.current = (await marks(pb.id)).flatMap((r) => r.marks).pop() || null;
    }
    const titles = await titlesOf(op.current, v.vol);
    const m = {
      g, vol: v.vol, section, book_id: v.book_id, page_id: pg.id, page_number: pg.page_number,
      folio: pg.ocr?.text_edition?.folio || null, text_toh: op.current, titles, colophon: false,
      verse_share: verseShare(bo), bo_chars: bo.length, en_chars: (pg.translation?.data || '').length,
      model: pg.translation?.model || null, prompt_version: pg.translation?.prompt_version || null,
    };
    meta.push(m);
    lines.push(JSON.stringify({ ...m, bo, en: pg.translation.data, prev2: p2, prev1: p1, prev_last: ln(p1).slice(-1)[0] || '', next_first: ln(at(1))[0] || '' }));
    got++;
  }
}
fs.writeFileSync(path.join(out, 'sample.json'), JSON.stringify({
  seed: SEED, plan: Object.fromEntries(PLAN), population,
  method: 'per section: uniform global index over pages with translation.data (volumes in order, pages by page_number), seeded mulberry32(6121 + section index); redrawn when the page or the side before opens a text, the page has a colophon, or a previous side has no e-text',
  pages: meta, rejected,
}, null, 1));
fs.writeFileSync(path.join(work, 'sample-pages.jsonl'), lines.join('\n') + '\n');
console.log('population', population, 'rejected', rejected.length, 'models', [...new Set(meta.map((m) => `${m.model} ${m.prompt_version}`))],
  'titled', meta.filter((m) => m.titles?.tibetan).length, '/', meta.length);
await c.close();
