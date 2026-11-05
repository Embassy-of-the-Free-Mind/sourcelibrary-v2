#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-ditto-restore-5274/draw.mjs (the same census: live books titled 佩文韻府 | 韻府拾遺 | 駢字類編,
// Paddle pages with ≥ 300 body Han, 丨 counted on the stored text; its frame and draw are the eval's, committed, and it
// writes into the eval's results) and partial-census.mjs there (the Kanripo band per page). This is that census taken
// again on the day of the write, with what a WRITE needs and the eval did not: the hold per book, human edits, the
// served English, and the Kanripo mark count of the own leaf, so a page whose leaf has no marks is not corrected.
/**
 * frame.mjs — the zero-丨 frame for the #5274 correction run. READ-ONLY on Mongo.
 *   node --env-file=<repo>/.env.production.local scripts/batch/zh-ditto-5274/frame.mjs [--kanripo=DIR]
 * Writes $JOB_SCRATCH/census.jsonl.gz (every body page) and $JOB_SCRATCH/frame.json (the counts).
 * --kanripo=DIR (KR3k0059, KR3k0056, KR3k0060 checked out at branch WYG) adds `leaf_marks` per page.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { bodyHanCount } from '../../lib/paddle-zh-lane.mjs';
import { isHeld } from '../../lib/pipeline-hold.mjs';
import { getTranslationText } from '../../lib/translation-text.mjs';

export const FAM = /佩文韻府|韻府拾遺|駢字類編/;
export const MIN_HAN = 300;
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const OUT = process.env.JOB_SCRATCH;
if (!OUT) { console.error('JOB_SCRATCH is not set'); process.exit(2); }
const count = (s, re) => (s.match(re) || []).length;

const leaf = new Map();
if (arg('kanripo')) for (const r of ['KR3k0059', 'KR3k0056', 'KR3k0060']) for (const f of fs.readdirSync(path.join(arg('kanripo'), r)).filter((x) => x.endsWith('.txt'))) {
  const parts = fs.readFileSync(path.join(arg('kanripo'), r, f), 'utf8').split(/<pb:([^>]+)>/);
  for (let i = 1; i < parts.length; i += 2) leaf.set(parts[i], count(parts[i + 1], /丨/g));
}

const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, title: { $regex: FAM.source } },
  { projection: { _id: 0, id: 1, title: 1, 'pipeline_auto.hold': 1, 'pipeline_auto.status': 1 } }).sort({ id: 1 }).toArray();
const rows = [];
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < books.length) {
    const b = books[next++];
    const ps = await db.collection('pages').find({ book_id: b.id, 'ocr.source': 'paddle' },
      { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.pipeline': 1, 'ocr.edited_by': 1, 'ocr.updated_at': 1, 'ocr.qa_screen.status': 1, 'ocr.qa_screen.dice': 1, 'ocr.qa_screen.pb': 1, translation: 1, translation_withheld: 1, translation_stale: 1 } }).toArray();
    for (const p of ps) {
      const t = String(p.ocr?.data || '');
      const han = bodyHanCount(t);
      if (han < MIN_HAN) continue;
      const pb = p.ocr?.qa_screen?.pb ?? null, dice = p.ocr?.qa_screen?.dice ?? null;
      rows.push({ pid: p.id, bid: b.id, pn: p.page_number, fam: b.title.match(FAM)[0], han, marks: count(t, /丨/g), alt: count(t, /[｜|│┃〡]/g),
        pipeline: p.ocr?.pipeline ?? null, edited: Boolean(p.ocr?.edited_by), qa: p.ocr?.qa_screen?.status ?? null, dice, pb,
        leaf_marks: pb && dice >= 0.6 && leaf.has(pb) ? leaf.get(pb) : null,
        translated: Boolean(getTranslationText(p)), tr_source: p.translation?.source ?? null, tr_model: p.translation?.model ?? null,
        withheld: Boolean(p.translation_withheld), stale: Boolean(p.translation_stale),
        held: isHeld(b) ? b.pipeline_auto.hold.reason : null, status: b.pipeline_auto?.status ?? null });
    }
  }
}));
await c.close();
rows.sort((a, b) => (a.pid < b.pid ? -1 : 1));
fs.writeFileSync(path.join(OUT, 'census.jsonl.gz'), zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
const tally = (xs, f) => { const o = {}; for (const x of xs) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };
const zero = rows.filter((r) => r.marks === 0);
const frame = {
  at: new Date().toISOString(), books_live: books.length, body_pages: rows.length, zero_pages: zero.length, zero_books: new Set(zero.map((r) => r.bid)).size,
  zero_by_family: tally(zero, (r) => r.fam), zero_human_edited: zero.filter((r) => r.edited).length,
  zero_leaf: tally(zero, (r) => (r.leaf_marks == null ? 'no own leaf' : r.leaf_marks === 0 ? 'leaf has none' : 'leaf has marks')),
  zero_translated: zero.filter((r) => r.translated).length, zero_withheld: zero.filter((r) => r.withheld).length, zero_stale: zero.filter((r) => r.stale).length,
  zero_by_hold: tally(zero, (r) => r.held ?? 'not held'), zero_books_by_hold: Object.fromEntries(Object.entries(tally([...new Map(zero.map((r) => [r.bid, r])).values()], (r) => r.held ?? 'not held'))),
  zero_by_status: tally(zero, (r) => r.status), zero_by_pipeline: tally(zero, (r) => r.pipeline), zero_by_tr_source: tally(zero, (r) => r.tr_source),
};
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(frame, null, 1));
console.log(JSON.stringify(frame, null, 1));
