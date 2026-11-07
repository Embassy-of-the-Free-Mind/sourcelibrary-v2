#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-gate-controls-5021.mjs — cuts single-page-lane books into 8-page blocks for the
// number gate's false alarms; it reads stored English, so it cannot measure an ANCHOR, which only a fresh read made on
// the anchor prompt carries. This draws the pages for that fresh read (and the stored-text windows for the other two
// checks). scripts/eval/eu-agy-translate-7263/ — draws pages for an agy quality arm, not consecutive blocks.
/**
 * Draw consecutive 4-page blocks for the #5021 block-page-guard false-refusal measurement. Read-only.
 *   node --env-file=.env.production.local scripts/eval/block-guard-5021/sample-blocks.mjs --out=DIR [--per-lang=40] [--seed=5021]
 * One block per book: four consecutive pages, each with OCR >= 400 chars, a stored translation, and a text page type.
 * Writes DIR/<lang>.ids (page ids, page order) and DIR/blocks.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const OUT = arg('out'); const PER = Number(arg('per-lang', 40)); let seed = Number(arg('seed', 5021));
const LANGS = (arg('langs', 'Latin,German,Italian,French,Chinese')).split(',');
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SKIP = /index|errata|title|blank|bibliograph|contents|toc|glossary|apparatus|spread|insert|illustration|plate|map/i;
fs.mkdirSync(OUT, { recursive: true });
const c = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = c.db('bookstore');
const all = [];
for (const lang of LANGS) {
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 12 }, language: new RegExp(`^${lang}\\b`, 'i'), 'pipeline_auto.hold': { $exists: false } }, { projection: { id: 1 } }).toArray();
  books.sort(() => rnd() - 0.5);
  const ids = [];
  let n = 0;
  for (const b of books) {
    if (n >= PER) break;
    const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, translation_withheld: 1 } }).sort({ page_number: 1 }).toArray();
    const ok = (p) => (p.ocr?.data || '').length >= 400 && (p.translation?.data || '').length > 100 && !p.translation_withheld && !SKIP.test(p.page_type || '');
    const starts = [];
    for (let i = 0; i + 4 <= pages.length; i++) if ([0, 1, 2, 3].every((d) => ok(pages[i + d]) && pages[i + d].page_number === pages[i].page_number + d)) starts.push(i);
    if (!starts.length) continue;
    const i = starts[Math.floor(rnd() * starts.length)];
    const blk = pages.slice(i, i + 4);
    ids.push(...blk.map((p) => p.id));
    all.push({ lang, book_id: b.id, pages: blk.map((p) => p.page_number) });
    n++;
  }
  fs.writeFileSync(path.join(OUT, `${lang}.ids.json`), JSON.stringify(ids));
  console.log(lang, n, 'blocks');
}
fs.writeFileSync(path.join(OUT, 'blocks.json'), JSON.stringify(all, null, 1));
await c.close();
