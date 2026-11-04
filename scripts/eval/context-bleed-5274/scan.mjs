#!/usr/bin/env node
// PRIOR ART: scripts/eval/chinese-translation-strata-5274 (the zh near-blank predicate, ≤ 15 Han characters and ≥ 150
// English words: Chinese only, and it read the OCR body by a regex the 11-03 screen found under-counts);
// scripts/lib/translate-core.mjs isRecited (#6297: short source, long English, write-time only, Tibetan-tuned
// thresholds); scripts/eval/wrong-leaf-find-5021/walk.mjs (a library walk of write TIMES, not lengths). None measures
// a stored page's English against its neighbours' English in every script, so this walks the library once, by book,
// with the lengths computed server-side and text pulled only for the pages the $0 length test keeps.
/**
 * Context-bleed scan (#5274): stored English on a nearly empty leaf that is another leaf's text.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/scan.mjs --out=DIR [--concurrency=3] [--limit-books=N]
 *
 * Stage A (per book, server side): every page with English (served `translation.data` or withheld
 * `translation_withheld.text`) projects its lengths only; the OCR and English TEXT come back only where the English
 * is at least 400 characters and over twice the OCR less its <detected-images>/<image-desc> block (a cheap superset of the near-blank shape: the OCR's raw length
 * includes its markup, so this keeps far more than it needs).
 * Stage A' (here): srcW = the OCR with metadata blocks and tags stripped (bodyLen's strip) and every Han/kana/Hangul
 * character counted 8 (Han to English runs about 7-8 English characters a character); enBody = translate-core bodyLen of the English. A page survives when enBody ≥ 200 and
 * enBody ≥ 2.5 × max(srcW, 10) (loose on purpose; the bands are cut later on the calibration set).
 * Stage B (survivors only): the English of n±1, n±2 and n±4 (current, else withheld, and when that neighbour's English
 * is newer than page n's, its page_revisions version of n's time), and the share of n's English content words found
 * in each. English to English for every script: OCR and English share no vocabulary in Han, Tibetan, Arabic ….
 * Out: DIR/cands.jsonl (one row per survivor), DIR/books-done.txt (resume), DIR/stats.jsonl (per-book counts).
 * Secondary reads, 3 books at a time, nothing written to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { bodyLen } from '../../lib/translate-core.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out'));
fs.mkdirSync(OUT, { recursive: true });
const DONE = path.join(OUT, 'books-done.txt');
const done = new Set(fs.existsSync(DONE) ? fs.readFileSync(DONE, 'utf8').split('\n').filter(Boolean) : []);

const BLOCKS = /<(meta|image-desc|detected-images|vocab|summary|keywords|warning|note|scan-quality|language|lang|page-type|script|columns)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
export function srcWeight(ocr) {
  const t = String(ocr || '').replace(BLOCKS, ' ').replace(/->|<-/g, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').replace(/\[[^\]]{0,40}\]/g, ' ').replace(/\s+/g, '');
  const han = (t.match(HAN) || []).length;
  return { w: t.length + 7 * han, han, chars: t.length };
}
const STOP = new Set('this that with from which their there these those have been were what when where while would could should about after before other into only also such than then them they upon your more most some very over under page text leaf entry volume chapter section original note continues continued previous following illustration illustrated depicts shows translation title said says will being made many much like each even every same well here thus therefore great first second third through without within against between'.split(' '));
export const words = (s) => String(s || '').replace(/<(meta|summary|keywords|vocab|warning)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) || [];
export function shareIn(aWords, b) { if (!aWords.length || !b) return null; const B = new Set(words(b)); return +(aWords.filter((w) => B.has(w)).length / aWords.length).toFixed(3); }

const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 8 });
await c.connect();
const db = c.db('bookstore');
const pages = db.collection('pages');

const books = await db.collection('books').find({ pages_translated: { $gt: 0 } }, { projection: { id: 1, language: 1, title: 1, visible: 1, hidden: 1, human_read_count: 1, pages_count: 1 } }).toArray();
const zh = (b) => /chinese|^zh|classical chinese|lzh/i.test(b.language || '');
books.sort((a, b) => (zh(b) - zh(a)) || ((b.human_read_count || 0) - (a.human_read_count || 0)));
const todo = books.filter((b) => !done.has(b.id)).slice(0, Number(arg('limit-books', 1e9)));
console.log(`books with English: ${books.length}; to scan: ${todo.length}`);

const strExpr = (f) => ({ $cond: [{ $eq: [{ $type: f }, 'string'] }, f, ''] });
// the length of one <tag>…</tag> block in the OCR (0 when absent): picture leaves carry a long <detected-images> JSON
// that made the raw OCR look long and kept half the 518 near-blank pages out of stage A (first run, 2026-11-04)
const blockLen = (tag) => ({ $let: { vars: { a: { $indexOfCP: ['$ocr', `<${tag}`] }, z: { $indexOfCP: ['$ocr', `</${tag}>`] } },
  in: { $cond: [{ $and: [{ $gte: ['$$a', 0] }, { $gt: ['$$z', '$$a'] }] }, { $subtract: ['$$z', '$$a'] }, 0] } } });
async function scanBook(b) {
  const rows = await pages.aggregate([
    { $match: { book_id: b.id } },
    { $project: { _id: 0, id: 1, page_number: 1, page_type: 1, tr: strExpr('$translation.data'), wt: strExpr('$translation_withheld.text'), ocr: strExpr('$ocr.data'),
      model: { $ifNull: ['$translation.model', '$translation_withheld.model'] }, at: { $ifNull: ['$translation.updated_at', '$translation_withheld.updated_at'] },
      src: '$translation.source', edited: '$translation.edited_by', wr: '$translation_withheld.reason', pv: { $ifNull: ['$translation.prompt_version', '$translation_withheld.prompt_version'] } } },
    { $project: { id: 1, page_number: 1, page_type: 1, model: 1, at: 1, src: 1, edited: 1, wr: 1, pv: 1, en: { $cond: [{ $gt: [{ $strLenCP: '$tr' }, 0] }, '$tr', '$wt'] }, ocr: 1 } },
    { $project: { id: 1, page_number: 1, page_type: 1, model: 1, at: 1, src: 1, edited: 1, wr: 1, pv: 1, en_len: { $strLenCP: '$en' }, ocr_len: { $strLenCP: '$ocr' }, en: 1, ocr: 1 } },
    { $match: { en_len: { $gt: 0 } } },
    { $project: { id: 1, page_number: 1, page_type: 1, model: 1, at: 1, src: 1, edited: 1, wr: 1, pv: 1, en_len: 1, ocr_len: 1,
      keep: { $and: [{ $gte: ['$en_len', 400] }, { $gt: ['$en_len', { $multiply: [2, { $subtract: ['$ocr_len', { $add: [blockLen('detected-images'), blockLen('image-desc')] }] }] }] }] }, en: 1, ocr: 1 } },
    { $project: { id: 1, page_number: 1, page_type: 1, model: 1, at: 1, src: 1, edited: 1, wr: 1, pv: 1, en_len: 1, ocr_len: 1, keep: 1,
      en: { $cond: ['$keep', '$en', '$$REMOVE'] }, ocr: { $cond: ['$keep', '$ocr', '$$REMOVE'] } } },
  ], { allowDiskUse: false, maxTimeMS: 120000 }).toArray();
  const surv = [];
  for (const r of rows) {
    if (!r.keep) continue;
    const s = srcWeight(r.ocr), en = bodyLen(r.en);
    if (en >= 200 && en >= 2.5 * Math.max(s.w, 10)) surv.push({ ...r, srcW: s.w, han: s.han, enBody: en });
  }
  if (surv.length) {
    const want = new Set();
    for (const r of surv) for (const d of [-4, -2, -1, 1, 2, 4]) want.add(r.page_number + d);
    const nb = new Map((await pages.find({ book_id: b.id, page_number: { $in: [...want] } }, { projection: { _id: 0, id: 1, page_number: 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation_withheld.text': 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.page_number, p]));
    const out = [];
    for (const r of surv) {
      const W = words(r.en);
      const share = {};
      for (const d of [-4, -2, -1, 1, 2, 4]) {
        const p = nb.get(r.page_number + d);
        if (!p) { share[d] = null; continue; }
        let e = p.translation?.data || p.translation_withheld?.text || '';
        // a neighbour rewritten after page n's English: compare with the version that stood when n was written
        if (Math.abs(d) <= 1 && r.at && p.translation?.updated_at && new Date(p.translation.updated_at) > new Date(r.at)) {
          const rev = await db.collection('page_revisions').find({ page_id: p.id, field: 'translation', original_date: { $lte: new Date(new Date(r.at).getTime() + 3600e3) } }).project({ data: 1 }).sort({ original_date: -1 }).limit(1).toArray();
          if (typeof rev[0]?.data === 'string') e = rev[0].data;
        }
        share[d] = shareIn(W, e);
      }
      const nOcr = (d) => srcWeight(nb.get(r.page_number + d)?.ocr?.data).w;
      out.push({ book_id: b.id, page: r.page_number, page_id: r.id, page_type: r.page_type || null, language: b.language, visible: b.visible !== false && !b.hidden, reads: b.human_read_count || 0,
        state: r.wr ? `withheld:${r.wr}` : 'served', human: !!(r.edited || r.src === 'manual'), model: r.model, at: r.at, pv: r.pv, src_w: r.srcW, han: r.han, en_body: r.enBody, en_words: W.length,
        share, prev_src_w: nOcr(-1), next_src_w: nOcr(1), head: String(r.en).slice(0, 160).replace(/\s+/g, ' ') });
    }
    fs.appendFileSync(path.join(OUT, 'cands.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  }
  fs.appendFileSync(path.join(OUT, 'stats.jsonl'), JSON.stringify({ book_id: b.id, language: b.language, pages_en: rows.length, kept_a: rows.filter((r) => r.keep).length, surv: surv.length }) + '\n');
  fs.appendFileSync(DONE, b.id + '\n');
}

const CONC = Number(arg('concurrency', 3));
let i = 0, n = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < todo.length) {
    const b = todo[i++];
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await scanBook(b); break; } catch (e) { console.error(`${b.id}: ${e.message}`); await new Promise((r) => setTimeout(r, 5000)); }
    }
    if (++n % 200 === 0) console.log(`${n}/${todo.length} books, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    if (fs.existsSync(path.join(OUT, 'STOP'))) { console.log('STOP file: stopping'); i = todo.length; }
  }
}));
console.log(`done ${n} books in ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
await c.close();
