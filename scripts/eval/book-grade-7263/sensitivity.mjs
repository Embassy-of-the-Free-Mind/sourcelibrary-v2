#!/usr/bin/env node
// PRIOR ART: labels.mjs (the judged-text hash match) and expand.mjs buildSet (features for a set no fit has seen), in
// this directory. Searched the store's origin:'test' rows by test.id / arm (verdictQuery tests:'only'): see below.
/**
 * §6 sensitivity of #7263 book-grade-model: other route-judge `origin: 'test'` rows, `selection: 'random'`, whose judged
 * text is the STORED text and can be shown to be (a text hash on the row matches the current page or a revision).
 * Labelled; added to training in model.py `sens`, never pooled into a bar.
 *
 * Survey of test rows on 2026-11-04 (route-judge scale, random, kind item): only two arms judged the stored text,
 *   zh-gemini-reocr-7263 `served` (60 pages, text_hash) and router-v4-latin-lite-7263 `served` (30, no text hash: the
 *   text cannot be shown, so not used). correct-vs-reread-7568 is Step T (never pooled). Every other arm is a fresh read.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/book-grade-7263/sensitivity.mjs → OUT/sens/
 */
import { MongoClient, ObjectId } from 'mongodb';
import { verdictQuery, ROUTE_JUDGE } from '../lib/judge-rows.mjs';
import { J, contentHash } from './lib.mjs';
import { buildSet, labelFields } from './expand.mjs';
import { LANG } from './assemble.mjs';

const ARMS = [{ id: 'zh-gemini-reocr-7263', arm: 'served' }];
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const rows = [], why = {};
for (const a of ARMS) {
  const vs = await db.collection('lane_judge_verdicts').find(verdictQuery({ kind: 'item', selection: 'random', 'test.id': a.id, 'test.arm': a.arm, 'judge.instrument': ROUTE_JUDGE }, { tests: 'only' })).toArray();
  for (const v of vs) {
    if (!v.verdict || !v.text_hash) { why.no_hash = (why.no_hash ?? 0) + 1; continue; }
    const p = await db.collection('pages').findOne({ _id: new ObjectId(v.page_id) }, { projection: { 'ocr.data': 1 } });
    let text = typeof p?.ocr?.data === 'string' && contentHash(p.ocr.data) === v.text_hash ? p.ocr.data : null;
    if (text == null) {
      const revs = await db.collection('page_revisions').find({ page_id: { $in: [v.page_id, new ObjectId(v.page_id)] }, field: 'ocr' }, { projection: { data: 1 } }).limit(100).toArray();
      text = revs.map((r) => r.data).find((t) => typeof t === 'string' && contentHash(t) === v.text_hash) ?? null;
    }
    if (text == null) { why.text_missing = (why.text_missing ?? 0) + 1; continue; }
    rows.push(labelFields({ study: `sens:${a.id}`, book_id: v.book_id, page_id: v.page_id, page_number: v.page_number, lang: LANG(v.lang), route: v.route, cell: null,
      script: v.script_type === 'print' ? 'printed' : v.script_type === 'manuscript' ? 'handwritten' : 'unknown', judged_at: v.test?.judged_at ?? v.judged_at, verdict: v.verdict, text, lockbox: false }));
    await new Promise((r) => setTimeout(r, 50));
  }
}
await c.close();
const label = new Set(J('labels.json.gz').rows.map((r) => r.book_id));
const keep = rows.filter((r) => !label.has(r.book_id));
console.log(`${keep.length} sensitivity pages (${rows.length - keep.length} dropped: book already a label book); skipped`, why);
await buildSet('sens', keep);
