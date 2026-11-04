#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/regrade.mjs load() (the 800 verdicts through verdictQuery, texts by (book,
// page number)); scripts/eval/severity-cal-7263/analyze.mjs (open PR #8136: key.json maps a blind id to arm S/F).
// Neither assembles one label table across studies or checks the text a feature reads is the text the judge saw.
/**
 * Step 1 of #7263 book-grade-model: the label table and the lockbox, before any feature exists.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/book-grade-7263/labels.mjs
 *
 * Labels (route-judge scale only, random draws, text as served):
 *   - confidence-7866: live rows, verdictQuery({ lane, run_id, kind: 'item' }) — 160 books x 5 pages.
 *   - severity-cal-7263: the STORED arm (S) of sitting 1 (route-s1.jsonl via key.json) — 60 books x 1 page.
 *     Its rows are not in Mongo; read from that job's scratch.
 * Step T rows are never read. Other origin:'test' rows are read only by sensitivity.mjs.
 * The judged text: the page's current ocr.data when its hash matches the verdict's text hash, else the page_revisions
 * row whose text matches; else the page is labelled text_missing and enters no text feature.
 * judged-expand-7263's books are listed as the LATER test and dropped from training and lockbox.
 * Writes OUT/labels.json.gz (per page, includes text: stays on the box) and OUT/lockbox.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { verdictQuery } from '../lib/judge-rows.mjs';
import { OUT, C66, SEVCAL, EXPAND, J, W, jsonl, sha256, contentHash, lockboxOf, words, unitOf, pageGradeOf, bandOf, seriousSpans } from './lib.mjs';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

const rows = [];
// ── 7866 ──
const v66 = (await db.collection('lane_judge_verdicts').find(verdictQuery({ lane: 'confidence-7866', run_id: 'confidence-validation-7866', kind: 'item' })).toArray()).filter((r) => r.verdict);
for (const r of v66) rows.push({ study: '7866', book_id: r.book_id, page_id: r.page_id, page_number: r.page_number, lang: r.lang, route: r.route, cell: r.cell_real, script: r.script_type ?? 'unknown', judged_at: r.judged_at, want_hash: r.write?.text_sha, hash_kind: 'content16', verdict: r.verdict, stratum: r.draw?.stratum, weight: r.draw?.weight });
// ── severity-cal stored arm, sitting 1 ──
const key = J(path.join(SEVCAL, 'key.json'));
const sample = J(path.join(SEVCAL, 'sample.json'));
const s1 = new Map(jsonl(path.join(SEVCAL, 'route-s1.jsonl')).map((x) => [x.id, x]));
const LANG = { sa: 'Sanskrit', zh: 'Chinese' };
for (const k of key.filter((x) => x.arm === 'S' && x.kind === 'item')) {
  const v = s1.get(k.id); const smp = sample.find((x) => x.page_id === k.page_id);
  if (!v?.verdict || !smp) continue;
  rows.push({ study: 'sevcal', book_id: k.book_id, page_id: k.page_id, page_number: k.page_number, lang: smp.book_language || LANG[k.lang], route: smp.stored_model, cell: null, script: smp.script_type ?? 'unknown', judged_at: fs.statSync(path.join(SEVCAL, 'route-s1.jsonl')).mtime.toISOString(), want_hash: k.text_sha, hash_kind: 'sha256', verdict: v.verdict, text_at_draw: smp.stored, weight: 1 });
}

// ── the judged text ──
const pages = new Map();
for (let i = 0; i < rows.length; i += 200) {
  const ids = rows.slice(i, i + 200).map((r) => new ObjectId(r.page_id));
  for (const p of await db.collection('pages').find({ _id: { $in: ids } }, { projection: { 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1 } }).toArray()) pages.set(String(p._id), p);
}
const hashOf = (r, t) => (r.hash_kind === 'sha256' ? sha256(t) : contentHash(t));
const why = {};
for (const r of rows) {
  let text = null, from = null;
  if (r.text_at_draw != null && hashOf(r, r.text_at_draw) === r.want_hash) { text = r.text_at_draw; from = 'copied at draw'; }
  const copy = path.join(C66, 'texts', `${r.page_id}.txt`);
  if (text == null && fs.existsSync(copy)) { const t = fs.readFileSync(copy, 'utf8'); if (hashOf(r, t) === r.want_hash) { text = t; from = 'copied at draw'; } }
  const cur = pages.get(r.page_id)?.ocr?.data;
  if (text == null && typeof cur === 'string' && hashOf(r, cur) === r.want_hash) { text = cur; from = 'current'; }
  if (text == null) {
    const revs = await db.collection('page_revisions').find({ page_id: { $in: [r.page_id, new ObjectId(r.page_id)] }, field: 'ocr' }, { projection: { data: 1, source: 1 } }).limit(100).toArray();
    for (const rv of revs) if (text == null && typeof rv.data === 'string' && hashOf(r, rv.data) === r.want_hash) { text = rv.data; from = 'page_revisions'; }
  }
  if (text == null && !r.want_hash && typeof cur === 'string') { text = cur; from = 'current (no hash on the verdict)'; }
  r.text = text; r.text_from = from ?? 'text_missing';
  why[r.text_from] = (why[r.text_from] ?? 0) + 1;
  r.current_differs = typeof cur === 'string' && text != null && cur !== text;
  delete r.text_at_draw;
  // targets
  const v = r.verdict;
  r.units = text == null ? null : words(text, r.lang);
  r.unit = unitOf(r.lang);
  r.serious = seriousSpans(v);
  r.fidelity = Number(v.fidelity);
  r.wrong_page = r.fidelity <= 2;
  r.page_grade = pageGradeOf(v);
  r.band = bandOf(v);
  // Page "many": 3 or more sense errors on the page (bandOf's split), or not this page's text / mostly wrong.
  r.many = r.serious >= 3 || r.wrong_page;
}
await c.close();

// ── the later test and the lockbox ──
const expandBooks = new Set(fs.existsSync(path.join(EXPAND, 'sample.json')) ? J(path.join(EXPAND, 'sample.json')).map((x) => x.book_id) : []);
const overlap = [...new Set(rows.map((r) => r.book_id))].filter((b) => expandBooks.has(b));
const labelRows = rows.filter((r) => !expandBooks.has(r.book_id));
const books = [...new Set(labelRows.map((r) => r.book_id))].sort();
const lock = lockboxOf(books);
for (const r of labelRows) r.lockbox = lock.has(r.book_id);

W('labels.json.gz', { built_at: new Date().toISOString(), rows: labelRows, dropped_for_expand_overlap: overlap });
const lockList = [...lock].sort();
W('lockbox.json', { rule: 'lowest 20% of sha256("bgm-7263-lockbox-v1:" + book_id) over the label books', books: lockList, sha256_of_list: sha256(lockList.join('\n')) });
console.log('rows', labelRows.length, 'books', books.length, 'by study', labelRows.reduce((a, r) => ((a[r.study] = (a[r.study] ?? 0) + 1), a), {}));
console.log('judged text from', why, 'current text differs from judged', labelRows.filter((r) => r.current_differs).length);
console.log('lockbox books', lockList.length, 'sha', sha256(lockList.join('\n')), 'overlap with judged-expand', overlap.length);
