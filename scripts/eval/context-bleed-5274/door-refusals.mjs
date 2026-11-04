#!/usr/bin/env node
// PRIOR ART: scripts/audit/recited-short-source.mjs (the #6297 rule over a random draw, current rule only). This runs
// the door's health check twice per page — the rule as it was and as it is now — to count what the change refuses.
/**
 * False refusals of the #5274 door change (translate-core: `<detected-images>` JSON no longer counts as source in
 * isCollapsed and sourceWeight). Draws --n random pages that hold English, OCR and no context-bleed flag (not in
 * cands.jsonl), and asks assessTranslationHealth with the old and the new measure. A page the new rule refuses and the
 * old did not is a refusal the change adds; on a clean draw each is a false refusal unless read otherwise by eye.
 * `context_dropped`: pages under RECITED_SOURCE_MAX, which buildTranslationPrompt now sends without n-1's English.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/door-refusals.mjs --scan=DIR --out=FILE [--n=500] [--books-from=miss-draw.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { assessTranslationHealth, withoutDetectedImages, sourceWeight, RECITED_SOURCE_MAX } from '../../lib/translate-core.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const N = Number(arg('n', 500));
const flagged = new Set(fs.readFileSync(path.join(path.resolve(arg('scan')), 'cands.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id));
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const pages = c.db('bookstore').collection('pages');
// the old rule: the source WITH the detector JSON, which the new code strips; feeding the JSON in twice is not the
// old rule, so the old result is the new function given an OCR whose block is renamed (it then counts, as before)
const asOld = (ocr) => String(ocr || '').replace(/<(\/?)detected-images\b/gi, '<$1x-detected-images');
const out = [];
// --books-from=miss-draw.json: instead of a random draw (which held no page with a detector block in 500), take the
// pages that carry one, in the miss-draw's random books, in its order
const BF = arg('books-from');
const rows = BF ? (await Promise.all(JSON.parse(fs.readFileSync(BF, 'utf8')).per.map((b) => b.book_id).map((b) => pages.find({ book_id: b, page_number: { $gt: 0 }, 'translation.data': { $type: 'string' }, 'ocr.data': { $regex: '<detected-images' } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).limit(Number(arg("per-book", 20))).toArray()))).flat().map((p) => ({ ...p, has_di: true })) : await pages.aggregate([
  // $sample first (a random cursor; a $match before it scans the collection), then keep pages with both texts
  { $sample: { size: N * 4 } },
  { $match: { 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' }, page_number: { $gt: 0 } } },
  { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, has_di: { $gte: [{ $indexOfCP: ['$ocr.data', '<detected-images'] }, 0] } } },
]).toArray();
for (const p of rows) {
  if (flagged.has(p.id) || out.length >= N) continue;
  const ocr = p.ocr.data, tr = p.translation.data;
  const now = assessTranslationHealth(ocr, tr), was = assessTranslationHealth(asOld(ocr), tr);
  out.push({ page_id: p.id, book_id: p.book_id, page: p.page_number, has_detected_images: p.has_di, was: was.healthy ? 'ok' : was.reason, now: now.healthy ? 'ok' : now.reason, src_chars_removed: ocr.length - withoutDetectedImages(ocr).length, context_dropped: sourceWeight(ocr) < RECITED_SOURCE_MAX });
}
await c.close();
const added = out.filter((o) => o.now !== 'ok' && o.was === 'ok'), lifted = out.filter((o) => o.was !== 'ok' && o.now === 'ok');
fs.writeFileSync(path.resolve(arg('out')), JSON.stringify({ at: new Date().toISOString(), n: out.length, with_detected_images: out.filter((o) => o.has_detected_images).length, refused_was: out.filter((o) => o.was !== 'ok').length, refused_now: out.filter((o) => o.now !== 'ok').length, context_dropped: out.filter((o) => o.context_dropped).length, added, lifted, pages: out }, null, 1));
console.log(JSON.stringify({ n: out.length, with_detected_images: out.filter((o) => o.has_detected_images).length, refused_was: out.filter((o) => o.was !== 'ok').length, refused_now: out.filter((o) => o.now !== 'ok').length, added: added.map((o) => `${o.page_id} ${o.now}`), lifted: lifted.map((o) => `${o.page_id} ${o.was}`) }));
