#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-ref/dump-pages.mjs (PR #5704) dumps whole volumes that carry an 84000
// text; scripts/eval/tengyur-pilot-qa/dump.mjs (PR #5676) dumps 5 pilot volumes. Neither draws a uniform
// sample over every Tengyur page with English, which is what #5829 needs. lib/page-text.mjs helpers are
// not needed: this reads raw ocr.data / translation.data.
/**
 * sample.mjs — read-only, $0. Step 1 of #5829: exact per-volume counts of Derge Tengyur pages with
 * translation.data, then a seeded (5829) uniform draw of N pages by global index (never $sample).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-characterize/sample.mjs \
 *        --n 150 --out scripts/eval/results/tengyur-characterize-5829 --work /root/tchar
 *
 * Writes <out>/counts.json, <out>/sample.json (metadata), <work>/sample-pages.jsonl (Tibetan + English).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { sectionOf, verseShare, isColophon, openingAt, rng as mkRng } from './common.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('n', 150));
const out = arg('out', 'scripts/eval/results/tengyur-characterize-5829');
const work = arg('work', '/root/tchar');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(work, { recursive: true });

const HAS_EN = { 'translation.data': { $type: 'string', $nin: [''] } };
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = (await db.collection('books').find({ 'catalog_ids.derge_tengyur_volume': { $exists: true } },
  { projection: { id: 1, title: 1, catalog_ids: 1 } }).toArray())
  .sort((a, b) => a.catalog_ids.derge_tengyur_volume - b.catalog_ids.derge_tengyur_volume);

const counts = [];
for (const b of books) {
  const n = await db.collection('pages').countDocuments({ book_id: b.id, ...HAS_EN });
  const all = await db.collection('pages').countDocuments({ book_id: b.id });
  counts.push({ vol: b.catalog_ids.derge_tengyur_volume, book_id: b.id, section: sectionOf(b.title), pages: all, with_english: n });
}
const total = counts.reduce((s, x) => s + x.with_english, 0);
const bySection = {};
for (const x of counts) { const s = (bySection[x.section] ||= { vols: 0, pages: 0, with_english: 0 }); s.vols++; s.pages += x.pages; s.with_english += x.with_english; }
fs.writeFileSync(path.join(out, 'counts.json'), JSON.stringify({ measured_at: new Date().toISOString(), total_with_english: total, by_section: bySection, by_volume: counts }, null, 1));
console.log(`total pages with English: ${total} in ${counts.filter((x) => x.with_english).length} volumes`);

const R = mkRng(5829);
const idx = new Set();
while (idx.size < N) idx.add(Math.floor(R() * total));
const picks = [...idx].sort((a, b) => a - b).map((g) => {
  let k = g;
  for (const x of counts) { if (k < x.with_english) return { g, vol: x.vol, book_id: x.book_id, section: x.section, rank: k }; k -= x.with_english; }
  throw new Error('index out of range');
});

const marksCache = {};
async function marks(book_id) {
  if (marksCache[book_id]) return marksCache[book_id];
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id } },
    { $project: { _id: 0, page_number: 1, m: { $regexFindAll: { input: { $ifNull: ['$ocr.data', ''] }, regex: /\{D\d+[a-zA-Z]?\}/ } } } },
    { $sort: { page_number: 1 } },
  ]).toArray();
  return (marksCache[book_id] = rows.map((r) => ({ page_number: r.page_number, marks: r.m.map((x) => x.match.slice(1, -1)) })));
}
const proj = { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.folio': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1 };
const meta = [], lines = [];
for (const p of picks) {
  const [pg] = await db.collection('pages').find({ book_id: p.book_id, ...HAS_EN }, { projection: proj }).sort({ page_number: 1 }).skip(p.rank).limit(1).toArray();
  const nb = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [pg.page_number - 1, pg.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  const prev = nb.find((x) => x.page_number === pg.page_number - 1)?.ocr?.data || '';
  const next = nb.find((x) => x.page_number === pg.page_number + 1)?.ocr?.data || '';
  const bo = pg.ocr?.data || '';
  const op = openingAt(await marks(p.book_id), pg.page_number);
  // A text that runs on from an earlier volume: take the last opening in the volumes before.
  for (let v = p.vol - 1; !op.current && v >= 1; v--) {
    const pb = counts.find((x) => x.vol === v);
    if (pb) op.current = (await marks(pb.book_id)).flatMap((r) => r.marks).pop() || null;
  }
  const m = {
    g: p.g, vol: p.vol, section: p.section, book_id: p.book_id, page_id: pg.id, page_number: pg.page_number,
    folio: pg.ocr?.text_edition?.folio || null, text_toh: op.current, opens_text: op.opensHere, colophon: isColophon(bo),
    verse_share: verseShare(bo), bo_chars: bo.length, en_chars: (pg.translation?.data || '').length,
    model: pg.translation?.model || null, prompt_version: pg.translation?.prompt_version || null,
  };
  meta.push(m);
  const ln = (s) => s.split('\n').filter((l) => l.trim());
  lines.push(JSON.stringify({ ...m, bo, en: pg.translation.data, prev_last: ln(prev).slice(-1)[0] || '', next_first: ln(next)[0] || '' }));
}
fs.writeFileSync(path.join(out, 'sample.json'), JSON.stringify({ seed: 5829, n: N, population: total, method: 'uniform global index over pages with translation.data, volumes in order, pages by page_number', pages: meta }, null, 1));
fs.writeFileSync(path.join(work, 'sample-pages.jsonl'), lines.join('\n') + '\n');
const sc = {};
for (const m of meta) sc[m.section] = (sc[m.section] || 0) + 1;
console.log('sample by section', sc, 'openings', meta.filter((m) => m.opens_text).length, 'colophons', meta.filter((m) => m.colophon).length);
await c.close();
