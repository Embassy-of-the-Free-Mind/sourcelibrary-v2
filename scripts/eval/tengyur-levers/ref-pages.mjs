#!/usr/bin/env node
// PRIOR ART: sample.mjs (this directory) builds the same page rows for the random sample; this builds
// them for the sides aligned to a published translation (#6121 step 4), so run-arms.mjs --pages ref
// can translate them with the identical request. The alignments themselves (/root/tlev/ref/align-*.jsonl)
// hold the reference text and are never committed.
/**
 * ref-pages.mjs — read-only, $0. Writes /root/tlev/ref-pages.jsonl (one row per aligned side, the
 * sample-pages.jsonl shape) and <out>/ref-alignment.json (ids, folios, confidence; no reference text).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-levers/ref-pages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { verseShare } from '../tengyur-characterize/common.mjs';

const out = 'scripts/eval/results/tengyur-levers-6121';
const TITLES = {
  D3862: { toh: 'D3862', tibetan: 'དབུ་མ་ལ་འཇུག་པའི་བཤད་པ་ཞེས་བྱ་བ', sanskrit: 'མཱ་དྷྱཱ་མ་ཀ་ཨ་བ་ཏཱ་ར་བྷཱ་ཥུ་ནཱ་མ', section: 'Madhyamaka' },
  D4231: { toh: 'D4231', tibetan: 'རིགས་པའི་ཐིགས་པའི་རྒྱ་ཆེར་འགྲེལ་པ', sanskrit: 'ན་ཡ་བིནྡུ་ཊཱི་ཀཱ', section: 'Pramāṇa' },
};
const read = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const aligned = Object.keys(TITLES).flatMap((t) => read(`/root/tlev/ref/align-${t}.jsonl`).map((a) => ({ ...a, toh: t })));
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pages = c.db('bookstore').collection('pages');
const ln = (s) => (s || '').split('\n').filter((l) => l.trim());
const rows = [], meta = [];
for (const a of aligned) {
  const pg = await pages.findOne({ id: a.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.folio': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1 } });
  const nb = await pages.find({ book_id: pg.book_id, page_number: { $in: [pg.page_number - 2, pg.page_number - 1, pg.page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  const at = (d) => nb.find((x) => x.page_number === pg.page_number + d)?.ocr?.data || '';
  const { section, ...titles } = TITLES[a.toh];
  const m = { vol: a.vol, section, book_id: pg.book_id, page_id: pg.id, page_number: pg.page_number, folio: pg.ocr?.text_edition?.folio || null,
    text_toh: a.toh, titles, verse_share: verseShare(pg.ocr.data), model: pg.translation?.model, prompt_version: pg.translation?.prompt_version };
  rows.push({ ...m, bo: pg.ocr.data, en: pg.translation.data, prev2: at(-2), prev1: at(-1), prev_last: ln(at(-1)).slice(-1)[0] || '', next_first: ln(at(1))[0] || '' });
  meta.push({ ...m, ref_lang: a.ref_lang, ref_source: a.ref_source, confidence: a.confidence, note: a.note });
}
fs.writeFileSync('/root/tlev/ref-pages.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'ref-alignment.json'), JSON.stringify({ note: 'sides aligned to a published translation (#6121 step 4); the reference text stays on the box', sides: meta }, null, 1));
console.log(rows.length, 'sides', rows.reduce((m, r) => ((m[r.text_toh] = (m[r.text_toh] || 0) + 1), m), {}), [...new Set(rows.map((r) => `${r.model} ${r.prompt_version}`))]);
await c.close();
