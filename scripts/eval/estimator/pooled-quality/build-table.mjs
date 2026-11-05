#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/heldout/heldout.py + router-table/pooled_prior.py (#7878) pool ROUTE acceptance
// k of n from a router table, not page verdicts from the spot checks; scripts/maintenance/judge-verdicts-to-book-checks.mjs
// (judgedTextIsLive, reused here) writes judged-pages rows FROM lane_judge_verdicts, so this reads the verdicts once, at
// the source; scripts/eval/confidence-7866/frame.mjs reads live provenance per book but for a confidence score, not a
// poststratification frame. Nothing built one page-level table across the book_checks methods (#6557, 2026-11-04).
/**
 * The page table of the pooled quality model (#6557). Mongo READS only (projected), no writes anywhere but OUT.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/pooled-quality/build-table.mjs [--out=DIR] [--no-frame]
 *
 * Writes OUT (default $JOB_SCRATCH/pooled-quality, else /tmp/pooled-quality):
 *   checks.json.gz      every book_checks row (projected) — page outcomes are derived in fit.py, not here
 *   verdicts.json.gz    every live lane_judge_verdicts row (projected) — judged-pages and the confidence-7866 draw come from here
 *   convergence.json.gz the per-page decisions of every ocr-convergence set in the repo (scripts/batch/ocr-convergence/results)
 *   pages.json.gz       live state of every page any of the above read: script_type, OCR / translation model, updated_at,
 *                       content hash, and whether the judged text of a lane verdict is still the live text
 *   books.json.gz       language, visible, pages_count of every book read, and of every book in the frame
 *   frame.json.gz       live pages per (book, OCR model, translation model, script_type), for poststratification
 *                       (visible, pages_count > 0); --no-frame skips it and fit.py reuses the last one
 * New book_checks methods or runs (zh-held-quality-8053, check-recorder-8069) are picked up by re-running this; fit.py
 * decides which methods enter.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { judgedTextIsLive } from '../../../maintenance/judge-verdicts-to-book-checks.mjs';
import { verdictQuery } from '../../lib/judge-rows.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || '/tmp', 'pooled-quality'));
fs.mkdirSync(OUT, { recursive: true });
const put = (name, obj) => { fs.writeFileSync(path.join(OUT, name), zlib.gzipSync(JSON.stringify(obj))); console.log(`${name}: ${Array.isArray(obj) ? obj.length : Object.keys(obj).length}`); };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const checks = await db.collection('book_checks').find({}, { projection: {
  book_id: 1, method_id: 1, method_version: 1, run_id: 1, checked_at: 1, pages_read: 1, reader: 1, verdict: 1, frame: 1,
  'page_findings.page_number': 1, 'page_findings.wrong_page': 1, 'page_findings.errors.stage': 1, 'page_findings.errors.class': 1,
  text_provenance: 1, exposure: 1, evidence_path: 1 } }).toArray();
put('checks.json.gz', checks);

// live rows only: origin:'test' rows (#7263) are per-page reads from finished tests, not what readers were served
const verdicts = await db.collection('lane_judge_verdicts').find(verdictQuery({}), { projection: {
  kind: 1, page_id: 1, book_id: 1, page_number: 1, cell: 1, route: 1, lane: 1, run_id: 1, judged_at: 1, task: 1, stratum: 1,
  'judge.model_reported': 1, 'judge.model': 1, 'verdict.accept': 1, 'verdict.fidelity': 1, 'verdict.defects.severity': 1,
  'verdict.defects.class': 1, write: 1, plant: 1 } }).toArray();
put('verdicts.json.gz', verdicts);

const conv = [];
const CDIR = path.join(REPO, 'scripts/batch/ocr-convergence/results');
for (const run of fs.readdirSync(CDIR)) {
  const rd = path.join(CDIR, run); if (!fs.statSync(rd).isDirectory()) continue;
  for (const set of fs.readdirSync(rd)) {
    const f = path.join(rd, set, 'decisions.jsonl.gz'); if (!fs.existsSync(f)) continue;
    for (const l of zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n')) {
      if (!l.trim()) continue;
      const d = JSON.parse(l);
      conv.push({ run, set, page_id: d.page_id, book_id: d.book_id, page_number: d.page_number, group: d.group, language: d.language,
        action: d.action, stored_model: d.stored_model ?? null, cli_model: d.cli_model ?? null, cer: d.cer ?? null,
        stored_serious: d.adj?.stored_serious ?? null, adjudicated: !!d.adj });
    }
  }
}
put('convergence.json.gz', conv);

// Live page state for every page read. Pages are keyed by (book_id, page_number): book_checks rows carry both, and a
// page_id in text_provenance can be absent on old rows.
const want = new Map();
const addPage = (b, n) => { if (b && Number.isFinite(n)) { (want.get(b) ?? want.set(b, new Set()).get(b)).add(n); } };
for (const c of checks) for (const n of c.pages_read || []) addPage(c.book_id, n);
for (const v of verdicts) addPage(v.book_id, v.page_number);
for (const d of conv) addPage(d.book_id, d.page_number);
const lanePages = new Map(verdicts.filter((v) => v.kind === 'item').map((v) => [`${v.book_id}|${v.page_number}`, v]));
const pages = [];
const bookIds = [...want.keys()];
for (let i = 0; i < bookIds.length; i += 200) {
  const ids = bookIds.slice(i, i + 200);
  const or = ids.map((b) => ({ book_id: b, page_number: { $in: [...want.get(b)] } }));
  const rows = await db.collection('pages').find({ $or: or }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, script_type: 1,
    'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.model': 1, 'translation.updated_at': 1, 'translation.content_hash': 1,
    translation_withheld: 1 } }).toArray();
  // The judged text of a lane verdict against the live text: only those pages need ocr.data.
  const needText = rows.filter((r) => lanePages.has(`${r.book_id}|${r.page_number}`)).map((r) => r.id);
  const texts = new Map();
  if (needText.length) for (const t of await db.collection('pages').find({ id: { $in: needText } }, { projection: { _id: 0, id: 1, 'ocr.data': 1 } }).toArray()) texts.set(t.id, t.ocr?.data);
  for (const r of rows) {
    const v = lanePages.get(`${r.book_id}|${r.page_number}`);
    pages.push({ id: r.id, book_id: r.book_id, page_number: r.page_number, script_type: r.script_type ?? null,
      ocr_model: r.ocr?.model ?? null, ocr_source: r.ocr?.source ?? null, ocr_updated_at: r.ocr?.updated_at ?? null,
      tr_model: r.translation?.model ?? null, tr_updated_at: r.translation?.updated_at ?? null, tr_hash: r.translation?.content_hash ?? null,
      withheld: r.translation_withheld != null,
      ...(v ? { lane_text_live: judgedTextIsLive(v.write, texts.get(r.id)) } : {}) });
  }
  process.stderr.write(`\rpages: ${Math.min(i + 200, bookIds.length)}/${bookIds.length} books`);
}
process.stderr.write('\n');
put('pages.json.gz', pages);

const LIVE = { visible: true, pages_count: { $gt: 0 } };
const bproj = { _id: 0, id: 1, language: 1, original_language: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, hidden_reason: 1 };
const books = await db.collection('books').find({ $or: [{ id: { $in: bookIds } }, LIVE] }, { projection: bproj }).toArray();
put('books.json.gz', books);

if (!process.argv.includes('--no-frame')) {
  const live = books.filter((b) => b.visible === true && b.pages_count > 0 && (b.pages_ocr ?? 0) > 0).map((b) => b.id);
  const frame = [];
  for (let i = 0; i < live.length; i += 250) {
    const ids = live.slice(i, i + 250);
    const rows = await db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids } } },
      { $group: { _id: { b: '$book_id', m: '$ocr.model', t: '$translation.model', st: '$script_type' },
        n: { $sum: 1 }, ocr: { $sum: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, 1, 0] } },
        tr: { $sum: { $cond: [{ $eq: [{ $type: '$translation.data' }, 'string'] }, 1, 0] } } } },
    ], { allowDiskUse: true }).toArray();
    for (const r of rows) frame.push({ b: r._id.b, m: r._id.m ?? null, t: r._id.t ?? null, st: r._id.st ?? null, n: r.n, ocr: r.ocr, tr: r.tr });
    process.stderr.write(`\rframe: ${Math.min(i + 250, live.length)}/${live.length} books`);
  }
  process.stderr.write('\n');
  put('frame.json.gz', { built_at: new Date().toISOString(), filter: 'books visible, pages_count > 0, pages_ocr > 0; pages grouped by OCR model, translation model, script_type', rows: frame });
}
await client.close();
