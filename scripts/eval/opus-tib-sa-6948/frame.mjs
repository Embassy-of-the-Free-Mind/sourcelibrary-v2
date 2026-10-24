#!/usr/bin/env node
// PRIOR ART: scripts/eval/tib-translator-6948/frame.mjs — the Tibetan frame this adapts (Yigdzin pages with no
// English on live Tibetan books, split by withheld reason). It has no Sanskrit frame, no page-type, unreadable,
// left_to_84000 or pipeline-hold filter, and keeps the Derge typed-text cell this lane does not translate.
/**
 * frame.mjs — read-only, $0. The frames for the #6948 Opus translation lane (job opus-tib-sa-6948).
 *
 *   bo  live Tibetan books (`language` starts "Tibetan", visible, pages_count > 0); a page with no `translation.data`,
 *       a Yigdzin transcription (`ocr.model: bdrc-yigdzin-v1`, non-empty), not `ocr.unreadable`, not withheld for
 *       source_loop / ocr_unreadable / invented_by_eye, not `ocr.text_edition.left_to_84000`.
 *   sa  live Sanskrit books; a page with non-empty OCR text and no translation, not unreadable, not withheld at all.
 *   Both: blank / cover / binding page types skipped; a book held by another lane skipped (HOLD_OK below names the
 *   holds this lane translates under, and why).
 *
 * Writes $JOB_SCRATCH/frame-<lang>.jsonl (one row per frame page, no text) and frame-excluded.json (the counts of
 * every exclusion), and prints the counts.
 *   node --env-file=.env.production.local scripts/eval/opus-tib-sa-6948/frame.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const S = process.env.JOB_SCRATCH;
// Holds this lane writes under (decision recorded on #6948, 2026-10-24):
//  tibetan-retranslation-awaits-derek — "Derek approves the Tibetan retranslation ... after the Yigdzin apply waves
//    land": Derek dispatched this lane on 2026-10-24 ("yes, dispatch"); the Yigdzin waves have landed (that is the frame).
//  specialist-ocr-lane-4523 / tibetan-unverified-gemini-ocr-4523 — about the Gemini OCR; this lane reads Yigdzin only.
//    (Tibetan only: on a Sanskrit book the OCR under the hold IS the unverified Gemini read.)
//  gpu-backlog-5660 — "translation is its own priced decision": this is that decision, at $0.
// The hold stays on the book: a page write does not touch pipeline_auto, and no other lane should pick these books up.
const HOLD_OK = { bo: new Set(['tibetan-retranslation-awaits-derek', 'specialist-ocr-lane-4523', 'tibetan-unverified-gemini-ocr-4523', 'gpu-backlog-5660']), sa: new Set() };
// English translations catalogued with language "Sanskrit": their frame pages' OCR is 0% Indic script (measured
// 2026-10-24 over all 66 frame pages). Nothing to translate; the language label is a metadata question, not this lane's.
const ENGLISH_EDITIONS = new Set(['6992596c3d2d40d1b058e88c', '69d7e185e9e5e67989c377ec', '6992475d4c402ed78ad6999e', '699247754c402ed78ad69ed9', '6992580c5a81897d604b5126']);
const BAD_WITHHELD = new Set(['source_loop', 'ocr_unreadable', 'invented_by_eye']);
const SKIP_TYPE = /^(blank|cover|binding|colou?r[-_ ]?(chart|card)|endpaper|spine)/i;
const LANGS = { bo: /^\s*tibetan\b/i, sa: /^\s*sanskrit\b/i };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const excluded = {};
const ex = (lang, k) => { excluded[lang] ??= {}; excluded[lang][k] = (excluded[lang][k] || 0) + 1; };
const summary = {};
for (const [lang, re] of Object.entries(LANGS)) {
  const books = await db.collection('books').find(
    { language: re, visible: true, pages_count: { $gt: 0 } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, language: 1, pages_count: 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.status': 1 } },
  ).toArray();
  const out = fs.createWriteStream(`${S}/frame-${lang}.jsonl`);
  let pages = 0, nbooks = 0, i = 0;
  for (const b of books) {
    i++;
    const hold = b.pipeline_auto?.hold?.reason || null;
    if (hold && !HOLD_OK[lang].has(hold)) { ex(lang, `book_held:${hold}`); continue; }
    if (ENGLISH_EDITIONS.has(b.id)) { ex(lang, 'book_is_english_edition'); continue; }
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: b.id } },
      { $project: {
        _id: 0, id: 1, page_number: 1, page_type: 1, model: '$ocr.model', unreadable: '$ocr.unreadable', left84: '$ocr.text_edition.left_to_84000',
        has_tr: { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, '$translation.data', ''] } }, 0] },
        wr: '$translation_withheld.reason',
        olen: { $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } },
      } },
    ]).toArray();
    let n = 0;
    for (const p of rows) {
      if (p.has_tr) continue;
      if (p.page_number < 0) { ex(lang, 'soft_hidden'); continue; }   // a soft-hidden page (negative number) is not served
      if (!p.olen) { ex(lang, 'no_ocr_text'); continue; }
      if (lang === 'bo' && p.model !== 'bdrc-yigdzin-v1') { ex(lang, `ocr_not_yigdzin`); continue; }
      if (p.unreadable) { ex(lang, 'ocr_unreadable_flag'); continue; }
      if (p.wr && (lang === 'sa' || BAD_WITHHELD.has(p.wr))) { ex(lang, `withheld:${p.wr}`); continue; }
      if (p.left84) { ex(lang, 'left_to_84000'); continue; }
      if (p.page_type && SKIP_TYPE.test(p.page_type)) { ex(lang, `page_type:${p.page_type}`); continue; }
      n++;
      out.write(JSON.stringify({ lang, book_id: b.id, title: b.display_title || b.title, hold, page_id: p.id, page_number: p.page_number, page_type: p.page_type || null, model: p.model || null, wr: p.wr || null, olen: p.olen }) + '\n');
    }
    pages += n; if (n) nbooks++;
    if (i % 300 === 0) console.error(lang, i, '/', books.length, pages);
  }
  await new Promise((r) => out.end(r));
  summary[lang] = { live_books: books.length, books_with_frame_pages: nbooks, frame_pages: pages };
}
fs.writeFileSync(`${S}/frame-excluded.json`, JSON.stringify({ at: new Date().toISOString(), summary, excluded }, null, 1));
console.log(JSON.stringify({ summary, excluded }, null, 1));
await c.close();
