#!/usr/bin/env node
// PRIOR ART: scripts/eval/kraken-refused-4686/draw.mjs — draws refused pages that still have NO text (for a re-read);
// this needs refused pages that DO carry a later read, plus matched never-refused books and controls.
// scripts/eval/ai-exposure-r3-6038.mjs draws passages from a seeded 500, not from the refusal population.
/**
 * draw.mjs — draw and seal the 55 pages of the continuation probe (#7271). Read-only on Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/continuation-probe-7271/draw.mjs [--write]
 *
 * One page per book. Every page's cleaned text (text.mjs cleanStored) must hold ≥ 270 words, ≥ 80% of them with two
 * letters or more; prefix = words 1–60, truth = words 61–260. Pages typed as index/title/table, and Google's scan
 * boilerplate page, are not drawn.
 *   R  20 refused: a page with ocr.recitation_count ≥ 1 whose stored ocr.data comes from a later read by a model
 *      (not the Archive's own OCR: ia-*), in a book with a page stamped ocr.recitation_blocked (the indexed way in;
 *      a full scan on recitation_count times out). Books drawn seeded at random among those whose language is
 *      written with spaces between words.
 *   M  20 read, never refused: for each R book, a book of the same language and century (year missing ↔ missing)
 *      with NO page carrying recitation_count ≥ 1, and a page read by flash-lite.
 *   N  10 negative controls: the English translation, written on or after 2026-07-01 by a non-Claude model, of a
 *      page in a book first imported on or after 2026-07-01. Rule: the text is our own and first existed after both
 *      models' cutoffs (Opus 5.5: mid-2026; Gemini 3.8 Flash earlier), so it cannot have been trained on. Canonical
 *      works (a published English translation could exist) are removed by eye: EXCLUDE_N below, with reasons.
 *      (Manuscript transcriptions were the first choice; of the post-July books the OCR calls handwritten, the two
 *      Latin ones with long pages are incunabula on inspection, so none qualified.)
 *   P  5 positive controls: famous passages from public e-texts (Gutenberg, The Latin Library).
 * --write seals scripts/eval/results/continuation-probe-7271/sealed.json (ids, prefix, truth, hashes).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { cleanStored, words, wordy } from './text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../results/continuation-probe-7271/sealed.json');
const WRITE = process.argv.includes('--write');
const SEED = 7271, PRE = 60, TRUTH = 200, MIN = 270;
const CUTOFF = new Date('2026-07-01');
const NO_SPACES = /^(Chinese|Japanese|Tibetan|Thai|Burmese|Khmer|Lao|Korean|Classical Chinese|Dz)/i;
// book id → reason. Filled from the eye check of the first dry run's titles, before any model call.
const EXCLUDE_N = {
  '6abeb628896ea18127c852a1': 'Derge Tengyur volume: 84000 publishes English translations of Tengyur texts',
  '6a4cb3668714f7d388a289fe': 'Epistola ad Philadelphum: likely Ignatius to the Philadelphians, widely translated',
  '6a5183620dd02e16c3798e1a': 'Hess-Luther dialogue (1521): a known Reformation pamphlet, a translation may exist',
};

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(SEED);
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const BOILER = /digital copy of a book that was preserved|Google Book Search|This is a digital copy/i;
const PROSE_TYPES = /^(text|body|prose|verse)?$/i; // page-type absent or a running-text type; index/title/table pages are not drawn
const cut = (text) => {
  const pt = (/<page-type>([^<]*)<\/page-type>/.exec(text || '') || [, ''])[1].trim();
  if (!PROSE_TYPES.test(pt) || BOILER.test(text)) return null;
  const w = words(cleanStored(text)); if (w.length < MIN || wordy(w.slice(0, PRE + TRUTH)) < 0.8) return null; return { prefix: w.slice(0, PRE).join(' '), truth: w.slice(PRE, PRE + TRUTH).join(' '), n_words: w.length }; };
const century = (y) => (typeof y === 'number' && y > 0 ? Math.floor(y / 100) * 100 : null);
const strText = (f) => ({ $cond: [{ $eq: [{ $type: f }, 'string'] }, f, ''] });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const P = db.collection('pages'), B = db.collection('books');
const pages = [];
const row = (group, b, p, c, extra = {}) => ({ group, slug: `${group}-${b.id}-p${p.page_number}`, book_id: b.id, page_id: p.id, page_number: p.page_number,
  title: String(b.title || '').slice(0, 160), author: b.author || null, language: b.language || null, year: b.year ?? null, ...extra,
  prefix: c.prefix, truth: c.truth, n_words: c.n_words, prefix_sha: sha(c.prefix), truth_sha: sha(c.truth) });

// R and M
const refusedBooks = await P.distinct('book_id', { 'ocr.recitation_blocked': true });
const rBooks = shuffle((await B.find({ id: { $in: refusedBooks } }, { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1 } }).toArray())
  .sort((a, b) => a.id.localeCompare(b.id))).filter((b) => b.language && !NO_SPACES.test(b.language));
const used = new Set();
for (const b of rBooks) {
  if (pages.filter((x) => x.group === 'R').length >= 20) break;
  const cands = await P.aggregate([{ $match: { book_id: b.id, 'ocr.recitation_count': { $gte: 1 } } },
    { $project: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.recitation_count': 1, len: { $strLenCP: strText('$ocr.data') } } },
    { $match: { len: { $gte: 1200 }, 'ocr.model': { $not: /^ia-/ , $ne: null } } }, { $sort: { page_number: 1 } }]).toArray();
  let rp = null;
  for (const p of shuffle(cands).slice(0, 6)) { const c = cut(p.ocr.data); if (c) { rp = { p, c }; break; } }
  if (!rp) continue;
  // the matched book
  const cen = century(b.year);
  const match = { language: b.language, pages_count: { $gte: 20 }, id: { $nin: [...refusedBooks, ...used] }, ...(cen ? { year: { $gte: cen, $lt: cen + 100 } } : { $or: [{ year: null }, { year: { $exists: false } }] }) };
  const mc = (await B.aggregate([{ $match: match }, { $project: { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1 } }, { $sort: { id: 1 } }], { maxTimeMS: 120000 }).toArray());
  let mp = null;
  for (const m of shuffle(mc).slice(0, 25)) {
    const refused = await P.countDocuments({ book_id: m.id, 'ocr.recitation_count': { $gte: 1 } });
    if (refused) continue;
    const lite = await P.aggregate([{ $match: { book_id: m.id, 'ocr.model': /flash-lite/ } },
      { $project: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, len: { $strLenCP: strText('$ocr.data') } } },
      { $match: { len: { $gte: 1500 } } }, { $sort: { page_number: 1 } }]).toArray();
    for (const p of shuffle(lite).slice(0, 6)) { const c = cut(p.ocr.data); if (c) { mp = { m, p, c }; break; } }
    if (mp) break;
  }
  if (!mp) { console.log(`no match for ${b.language} ${cen} (${b.id}); skipping`); continue; }
  used.add(b.id); used.add(mp.m.id);
  pages.push(row('R', b, rp.p, rp.c, { text_model: rp.p.ocr.model, recitation_count: rp.p.ocr.recitation_count, pair: mp.m.id }));
  pages.push(row('M', mp.m, mp.p, mp.c, { text_model: mp.p.ocr.model, recitation_count: 0, pair: b.id }));
  console.log(`R ${b.language} ${b.year ?? '—'} ${b.title?.slice(0, 50)}  ↔  M ${mp.m.year ?? '—'} ${mp.m.title?.slice(0, 50)}`);
}

// N
const nb = (await B.find({ created_at: { $gte: CUTOFF }, pages_count: { $gte: 10 } }, { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1 } }).sort({ id: 1 }).toArray());
for (const b of shuffle(nb)) {
  if (pages.filter((x) => x.group === 'N').length >= 10) break;
  if (EXCLUDE_N[b.id] || /^English$/i.test(b.language || '')) continue;
  const tp = await P.aggregate([{ $match: { book_id: b.id, 'translation.updated_at': { $gte: CUTOFF } } },
    { $project: { _id: 0, id: 1, page_number: 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1, len: { $strLenCP: strText('$translation.data') } } },
    { $match: { len: { $gte: 1500 }, 'translation.model': { $not: /claude|opus|sonnet|haiku/i } } }, { $sort: { page_number: 1 } }]).toArray();
  let np = null;
  for (const p of shuffle(tp).slice(0, 6)) { const c = cut(p.translation.data); if (c) { np = { p, c }; break; } }
  if (!np) continue;
  pages.push(row('N', b, np.p, np.c, { text_model: np.p.translation.model, field: 'translation', text_written: np.p.translation.updated_at }));
  console.log(`N ${b.language} ${b.year ?? '—'} ${b.id} ${np.p.translation.model} | ${b.title?.slice(0, 90)}`);
}
await client.close();

// P
const fetchText = async (u) => (await fetch(u)).text();
const after = (txt, anchor) => { const i = txt.indexOf(anchor); if (i < 0) throw new Error(`anchor not found: ${anchor}`); return txt.slice(i); };
const POS = [
  { slug: 'P-genesis-kjv', title: 'Genesis 1 (King James Version)', language: 'English', url: 'https://www.gutenberg.org/cache/epub/10/pg10.txt', anchor: '1:1 In the beginning', fix: (t) => t.replace(/\b\d+:\d+\s/g, ' ') },
  { slug: 'P-bacon-of-truth', title: 'Bacon, Essays: Of Truth', language: 'English', url: 'https://www.gutenberg.org/cache/epub/575/pg575.txt', anchor: 'WHAT is truth? said jesting Pilate' },
  { slug: 'P-declaration', title: 'Declaration of Independence', language: 'English', url: 'https://www.gutenberg.org/cache/epub/1/pg1.txt', anchor: 'When in the Course of human events' },
  { slug: 'P-two-cities', title: 'Dickens, A Tale of Two Cities, ch. 1', language: 'English', url: 'https://www.gutenberg.org/cache/epub/98/pg98.txt', anchor: 'It was the best of times' },
  { slug: 'P-caesar-bg1', title: 'Caesar, De bello Gallico 1.1', language: 'Latin', url: 'https://www.thelatinlibrary.com/caesar/gall1.shtml', anchor: 'Gallia est omnis', fix: (t) => t.replace(/<font size=2>\d+<\/font>/g, ' ').replace(/\[<a name="\d+">\d+<\/a>\]/g, ' ') },
];
for (const p of POS) {
  let t = after(await fetchText(p.url), p.anchor);
  if (p.fix) t = p.fix(t);
  const w = words(cleanStored(t));
  const c = { prefix: w.slice(0, PRE).join(' '), truth: w.slice(PRE, PRE + TRUTH).join(' '), n_words: w.length };
  pages.push({ group: 'P', slug: p.slug, book_id: null, page_id: null, title: p.title, language: p.language, source_url: p.url, ...c, prefix_sha: sha(c.prefix), truth_sha: sha(c.truth) });
}

const counts = Object.fromEntries(['R', 'M', 'N', 'P'].map((g) => [g, pages.filter((x) => x.group === g).length]));
console.log(counts);
if (WRITE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ issue: 7271, sealed_at: new Date().toISOString(), seed: SEED, prefix_words: PRE, truth_words: TRUTH, counts, pages }, null, 1));
  console.log(`sealed → ${OUT}`);
}
