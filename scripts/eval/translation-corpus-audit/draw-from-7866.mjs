#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-corpus-audit/draw.mjs (the item shape, and the swap / drop / repeat control
// construction, followed here step for step) and scripts/eval/confidence-7866/regrade.mjs (how the 800 #7866 verdicts
// are loaded, gradeOf / bucketOf, the book weights). draw.mjs draws its OWN random pages; this script draws none: its
// frame is the 800 pages #7866 already judged for the transcription, so the English verdict can be joined to the
// transcription verdict on the same page (#7968). draw-wave2.mjs's getPageSource() image pick is reused.
/**
 * Build a translation-audit draw from the #7866 pages (#7968).
 *
 *   node --env-file=.env.production.local scripts/eval/translation-corpus-audit/draw-from-7866.mjs \
 *        --out scripts/eval/results/translation-on-7866-draw [--seed 7968]
 *
 * Unit: each of the 800 pages in lane_judge_verdicts (lane confidence-7866, run confidence-validation-7866). A page is
 * an item when its live `translation.data` is longer than 20 characters; otherwise it is a logged skip. No length,
 * page-type or source filter beyond that: the frame is #7866's, and the analysis must cover every page that carries
 * English.
 *
 * Controls (blinded, as draw.mjs): the EXTRA pool is one other interior page (not one of the 800) from books in the
 * #7866 draw, with ocr.data >= 200 and translation.data >= 100 characters, so no control shares a page with a main
 * item. swap = another extra's translation in the same language (expect fidelity <= 2); drop = middle ~35% of the
 * translation's units removed (expect omission); repeat = a main item under a new id (at most 2 per language).
 * draw.mjs takes one swap pair per language in one pass; here the passes repeat until 15 swaps, because the #7866
 * draw has fewer languages with spare pages. Logged in draw-log.json.controls.
 *
 * Writes (OUT): items.jsonl ({id, language, source, translation} only: the packet sees nothing else),
 * manifest.jsonl (provenance, the #7866 grade, stratum, weight, truth; NO text), draw-log.json (kept / skipped,
 * every one of the 800 accounted for). Read-only on Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { armOf } from './arm.mjs';
import { LANE, RUN, gradeOf, bucketOf, eraOf } from '../confidence-7866/regrade.mjs';
import { words } from '../route-judge-6740/defect-rate.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = args.out || 'scripts/eval/results/translation-on-7866-draw';
const SEED = Number(args.seed || 7968);
const MIN_TR_KEEP = 20;              // the brief's rule for a main item
const MIN_OCR = 200, MIN_TR = 100;   // draw.mjs's rule, for the control pool only
const N_SWAP = 15, N_DROP = 15, N_REPEAT = 15;
const EXTRA_TARGET = 60;             // 30 for swap pairs, 15 for drop, slack for short texts

const sha16 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newId = () => { let s = ''; for (let i = 0; i < 10; i++) s += Math.floor(seededRand() * 16).toString(16); return s; };
const PAGE_PROJ = {
  id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1,
  'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.prompt_hash': 1, 'translation.source': 1,
  'translation.updated_at': 1, 'translation.edited_by': 1, display_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1,
  enhanced_photo: 1, archived_photo: 1, photo_original: 1,
};

resetSeed(SEED);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const pagesC = db.collection('pages'), booksC = db.collection('books');

// 1. The 800 verdicts.
const recs = (await db.collection('lane_judge_verdicts').find({ lane: LANE, run_id: RUN, kind: 'item' }).toArray()).filter((r) => r.verdict);
recs.sort((a, b) => String(a._id).localeCompare(String(b._id)));
console.error(`${recs.length} #7866 verdicts`);

const bookIds = [...new Set(recs.map((r) => r.book_id))];
const bookMeta = new Map();
for (const b of await booksC.find({ $or: [{ _id: { $in: bookIds.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x)) } }, { id: { $in: bookIds } }] },
  { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, year: 1, pages_count: 1, provider: 1 } }).toArray()) {
  bookMeta.set(String(b._id), b); if (b.id) bookMeta.set(String(b.id), b);
}

// 2. The live page for each verdict, by (book, page number) as regrade.mjs does: a re-minted _id is still found.
const live = new Map();
for (let i = 0; i < recs.length; i += 100) {
  const batch = recs.slice(i, i + 100);
  for (const p of await pagesC.find({ $or: batch.map((r) => ({ book_id: r.book_id, page_number: r.page_number })) }, { projection: PAGE_PROJ }).toArray()) {
    live.set(`${p.book_id}:${p.page_number}`, p);
  }
}

const log = { seed: SEED, at: new Date().toISOString(), source: { lane: LANE, run_id: RUN, issue: 7866 }, frame: recs.length, kept: 0, skipped: {}, skipped_pages: [], weights: {}, controls: {} };
const main = [], texts = {};
function toItem(kind, r, page, book, extra = {}) {
  const t = page.translation, o = page.ocr;
  const lang = r?.lang ?? book?.language ?? 'unknown';
  return {
    id: newId(), kind, book_id: page.book_id, page_number: page.page_number, page_id: page.id ?? String(page._id), page_type: page.page_type || null,
    title: book?.title ?? null, author: book?.author ?? null, provider: book?.provider ?? null,
    language: lang, published: book?.published ?? null, period: eraOf(book?.published), age_band: eraOf(book?.published),
    arm: armOf(t.model), model: t.model ?? null, prompt_version: t.prompt_version || null, prompt_hash: t.prompt_hash || null,
    translation_source: t.source ?? null, translation_edited: !!t.edited_by, translated_at: t.updated_at || null,
    ocr_model: o?.model || null, ocr_source: o?.source || null, ocr_at: o?.updated_at || null,
    translation_older_than_ocr: !!(t.updated_at && o?.updated_at && new Date(t.updated_at) < new Date(o.updated_at)),
    ocr_chars: (o?.data ?? '').length, translation_chars: t.data.length, ocr_hash: sha16(o?.data ?? ''), translation_hash: sha16(t.data),
    english_words: words(t.data),
    image: getPageSource(page),
    url: `https://sourcelibrary.org/book/${page.book_id}?page=${page.page_number}`,
    ...extra,
  };
}

for (const r of recs) {
  const p = live.get(`${r.book_id}:${r.page_number}`);
  const skip = (why) => { log.skipped[why] = (log.skipped[why] || 0) + 1; log.skipped_pages.push({ book_id: r.book_id, page_number: r.page_number, lang: r.lang, why }); };
  if (!p) { skip('page_not_found'); continue; }
  const tr = typeof p.translation?.data === 'string' ? p.translation.data : '';
  if (tr.trim().length <= MIN_TR_KEEP) { skip(tr.trim().length ? 'translation_20_chars_or_less' : 'no_translation'); continue; }
  const grade = gradeOf(r.verdict);
  const ocrNow = typeof p.ocr?.data === 'string' ? p.ocr.data : '';
  const it = toItem('main', r, p, bookMeta.get(r.book_id), {
    verdict_7866_id: r._id, grade_7866: grade, bucket_7866: bucketOf(grade), fidelity_7866: Number(r.verdict.fidelity),
    accept_7866: !!r.verdict.accept, search_only_or_worse_7866: !['fit_to_quote', 'fit_to_read'].includes(grade),
    // #7866 judged the text whose sha this was; if the live OCR has changed since, its grade is about another text.
    ocr_same_as_7866: r.write?.text_sha ? crypto.createHash('sha256').update(ocrNow.trim()).digest('hex').slice(0, 16) === r.write.text_sha : null,
    ocr_route: r.route ?? null, script_7866: r.script_type ?? null, stratum: r.draw?.stratum ?? 'unmeasured', weight: r.draw?.weight ?? 1,
  });
  main.push(it); texts[it.id] = { source: ocrNow, translation: tr };
}
log.kept = main.length;
console.error(`kept ${main.length}, skipped ${log.skipped_pages.length}: ${JSON.stringify(log.skipped)}`);
if (main.length + log.skipped_pages.length !== recs.length) throw new Error('accounting: kept + skipped != frame');

// score.mjs's corpus estimate reads draw-log.weights[lang].translated_pages. Here it is the sum of the #7866 book
// weights of the kept pages in that language (the #7866 frame's weight, not a live translated-page count).
for (const m of main) {
  const w = (log.weights[m.language] ||= { books: 0, translated_pages: 0, pages: 0, note: 'sum of #7866 draw weights over kept pages' });
  w.translated_pages += m.weight; w.pages++;
}
for (const L of Object.keys(log.weights)) log.weights[L].books = new Set(main.filter((m) => m.language === L).map((m) => m.book_id)).size;

// 3. Control pool: one other interior page from books in the draw (never one of the 800).
const judgedKey = new Set(recs.map((r) => `${r.book_id}:${r.page_number}`));
const extras = [];
const poolBooks = shuffle([...new Set(main.map((m) => m.book_id))]);
for (const bid of poolBooks) {
  if (extras.length >= EXTRA_TARGET) break;
  const b = bookMeta.get(bid); const n = b?.pages_count || 0;
  const lo = Math.floor(n * 0.15), hi = Math.ceil(n * 0.95);
  const cands = await pagesC.aggregate([
    { $match: { book_id: bid, page_number: { $gt: lo, $lt: hi }, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } } },
    { $project: { page_number: 1, ol: { $strLenCP: '$ocr.data' }, tl: { $strLenCP: '$translation.data' } } },
  ], { maxTimeMS: 60000 }).toArray();
  const ok = cands.filter((p) => p.ol >= MIN_OCR && p.tl >= MIN_TR && !judgedKey.has(`${bid}:${p.page_number}`)).sort((a, z) => a.page_number - z.page_number);
  if (!ok.length) continue;
  const pick = ok[Math.floor(seededRand() * ok.length)];
  const p = await pagesC.findOne({ book_id: bid, page_number: pick.page_number }, { projection: PAGE_PROJ });
  const lang = main.find((m) => m.book_id === bid).language;
  const it = toItem('extra', { lang }, p, b);
  extras.push(it); texts[it.id] = { source: p.ocr.data, translation: p.translation.data };
}
log.control_pool = { extras: extras.length, by_language: extras.reduce((o, e) => ((o[e.language] = (o[e.language] || 0) + 1), o), {}) };

// 4. Controls, as draw.mjs.
const splitUnits = (s) => {
  let u = s.split(/(?<=[.!?。।])\s+/).filter((x) => x.trim());
  if (u.length < 6) u = s.split(/\n+/).filter((x) => x.trim());
  return u;
};
const controls = [];
const byLang = {};
for (const e of shuffle([...extras])) (byLang[e.language] ||= []).push(e);
let swaps = 0, passes = 0;
while (swaps < N_SWAP && passes < 20) {
  passes++;
  let progressed = false;
  for (const lang of shuffle(Object.keys(byLang))) {
    const arr = byLang[lang];
    if (arr.length < 2 || swaps >= N_SWAP) continue;
    const [a, b] = arr.splice(0, 2);
    const it = { ...a, id: newId(), kind: 'swap', control_of: a.id, swap_translation_from: b.id, expected: { fidelity: 1, wrong_page: true } };
    controls.push(it); texts[it.id] = { source: texts[a.id].source, translation: texts[b.id].translation };
    swaps++; progressed = true;
  }
  if (!progressed) break;
}
let drops = 0;
for (const lang of shuffle(Object.keys(byLang))) {
  for (const e of byLang[lang]) {
    if (drops >= N_DROP) break;
    const units = splitUnits(texts[e.id].translation);
    if (units.length < 4) continue;
    const k = Math.max(1, Math.round(units.length * 0.35)), start = Math.floor((units.length - k) / 2);
    const kept = [...units.slice(0, start), ...units.slice(start + k)];
    const removed = units.slice(start, start + k).join(' ');
    const it = { ...e, id: newId(), kind: 'drop', control_of: e.id, dropped_units: k, total_units: units.length, dropped_chars: removed.length, expected: { omission: true } };
    controls.push(it); texts[it.id] = { source: texts[e.id].source, translation: kept.join(units.length >= 6 && /[.!?。।]\s/.test(texts[e.id].translation) ? ' ' : '\n') };
    drops++;
  }
}
const seenLang = {};
let repeats = 0;
for (const m of shuffle([...main])) {
  if (repeats >= N_REPEAT) break;
  if ((seenLang[m.language] || 0) >= 2) continue;
  seenLang[m.language] = (seenLang[m.language] || 0) + 1;
  const it = { ...m, id: newId(), kind: 'repeat', repeat_of: m.id };
  controls.push(it); texts[it.id] = texts[m.id];
  repeats++;
}
log.controls = { swap: swaps, drop: drops, repeat: repeats, swap_passes: passes };
console.error(`controls: ${JSON.stringify(log.controls)}`);
for (const [k, n] of Object.entries({ swap: swaps, drop: drops, repeat: repeats })) if (n < 10) console.error(`WARNING: only ${n} ${k} controls (need >= 10)`);

// 5. Write.
fs.mkdirSync(OUT, { recursive: true });
const manifest = [...main, ...controls];
fs.writeFileSync(path.join(OUT, 'manifest.jsonl'), manifest.map((m) => JSON.stringify(m)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'items.jsonl'), manifest.map((m) => JSON.stringify({ id: m.id, language: m.language, source: texts[m.id].source, translation: texts[m.id].translation })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'draw-log.json'), JSON.stringify(log, null, 1));
console.error(`wrote ${main.length} main + ${controls.length} controls → ${OUT}`);
await client.close();
