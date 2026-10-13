#!/usr/bin/env node
/**
 * Backfill provenance on Tibetan pages that still serve the BDRC Woodblock read applied
 * 2026-09-10 (#4523). The first version of apply-reocr-verdicts.mjs wrote those pages with
 * `ocr.source: 'ai'`, no `ocr.engine`, no `ocr.content_hash`, and left the previous Gemini
 * read's prompt/token fields on the page — so the page claims a Gemini prompt produced a
 * Woodblock transcription. Approved by Derek 2026-09-26 ("do it"), handoff
 * ops/handoffs/2026-09-26-ocr-metadata-restore-and-woodblock-backfill.md Part 2.
 *
 * PRIOR ART: scripts/maintenance/apply-reocr-verdicts.mjs — the writer that produced these
 * pages; it has the human-edit guard, sweep_log and book_events patterns reused here, but it
 * rewrites TEXT from a verdict file, and this job must never touch `ocr.data`.
 *
 * Scope: pages listed in --list (hetzner:/root/tibetan-reocr/woodblock-applied-no-engine-20260925.jsonl)
 * whose CURRENT ocr is still the Woodblock read (`ocr.model: 'bdrc-woodblock-easter2'`, no
 * `ocr.engine`). Pages since overwritten by Yigdzin already carry Yigdzin's engine block and are
 * skipped (the Woodblock text is in their page_revisions row).
 *
 * Per page:
 *   1. snapshot the whole ocr object to page_revisions (reason 'woodblock-provenance-backfill-4523',
 *      keepMeta) — the stale Gemini fields survive under `meta`;
 *   2. $set ocr.source 'bdrc', ocr.engine (below), ocr.content_hash of the unchanged text;
 *   3. $unset the stale Gemini-era fields (STALE_OCR_FIELDS minus the unreadable flag and its
 *      reason: a MARKed page stays marked).
 * The update filter re-checks model, missing engine, the human-edit guard AND the exact text, so a
 * page changed between plan and write is skipped and recorded, never written.
 *
 * Default is DRY RUN (shape assertions + one before/after print). --apply writes.
 *   node --env-file=.env.production.local scripts/maintenance/backfill-woodblock-provenance-4523.mjs \
 *     --list=/root/tibetan-reocr/woodblock-applied-no-engine-20260925.jsonl [--book=<id>] [--apply]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { contentHash } from '../lib/translate-core.mjs';
import { STALE_OCR_FIELDS } from '../lib/syriac-kraken-lane.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const ARG = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : d;
};
const APPLY = process.argv.includes('--apply');
const LIST = ARG('--list', null);
const ONLY_BOOK = ARG('--book', null);
const REPORT = ARG('--report', `scripts/output/backfill-woodblock-provenance-${new Date().toISOString().slice(0, 10)}.jsonl`);
if (!LIST) { console.error('--list required'); process.exit(1); }

const MODEL = 'bdrc-woodblock-easter2';
const REASON = 'woodblock-provenance-backfill-4523';
const SWEEP = 'woodblock-provenance-backfill-4523';
// Keep the MARK flag: it describes the page's verdict, not the Gemini read.
const UNSET = STALE_OCR_FIELDS.filter((f) => f !== 'ocr.unreadable' && f !== 'ocr.unreadable_reason');

/**
 * Facts and their sources:
 *  - model files, architecture, input size: model_config.json of the HF snapshot on clawdbot
 *    (/root/.cache/huggingface/hub/models--BDRC--Woodblock, the path reocr_worker.py loads);
 *  - weights licence: the model card's front matter (`license: cc-by-nc-4.0`);
 *  - app repo + commit: /root/tibetan-ocr-app on clawdbot (the line-detection app);
 *  - fleet, dates, whole-frame reads, 2400 px downscale, adjudication bar: ops handoffs
 *    2026-09-04-tibetan-reocr-execution.md and 2026-09-09-tibetan-reocr-watcher-and-apply.md.
 * The fleet boxes were deleted; which weights revision THEY loaded was not logged, so the
 * revision is marked inferred.
 */
const ENGINE = {
  name: 'BDRC tibetan-ocr-app', version: 'ONNX line models', model: 'Woodblock (Easter2)',
  model_label: 'BDRC tibetan-ocr-app — Woodblock line recognizer',
  model_url: 'https://huggingface.co/BDRC/Woodblock/tree/5fa7588ef1e7d325bdb708ad305de702b9159c11',
  revision: '5fa7588ef1e7d325bdb708ad305de702b9159c11',
  revision_source: 'inferred: the BDRC/Woodblock snapshot cached on clawdbot since 2026-09-01 (the path reocr_worker.py loads); the rented fleet (sl-reocr-1..3, sl-reocr-x86) was deleted and logged no sha',
  licence: 'CC-BY-NC-4.0',
  licence_source: 'BDRC/Woodblock model card front matter (weights); the app repository is MIT',
  app: { repo: 'https://github.com/buda-base/tibetan-ocr-app', commit: '62d68ec01996560e1105796630c10489731fe8aa', commit_source: 'inferred: /root/tibetan-ocr-app HEAD on clawdbot', licence: 'MIT' },
  architecture: 'Easter2, input 3200x100, wylie encoder (model_config.json v2)',
  read_mode: 'page',
  decode: { image: 'whole frame, no leaf splitting; downscaled to 2400 px wide (Lanczos, JPEG q95) when wider' },
  fleet: '41 shards on rented Hetzner Cloud boxes sl-reocr-1, -2, -3, sl-reocr-x86; launched 2026-09-08 00:35Z',
  adjudication: 'Woodblock vs BigUCHAN agreement >= 0.70, Derge index on (adjudicate.py)',
  run: 'woodblock-2026-09', issue: 4523,
  backfilled: { at: new Date(), by: SWEEP, handoff: 'ops/handoffs/2026-09-26-ocr-metadata-restore-and-woodblock-backfill.md' },
};

const HUMAN_GUARD = { 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } };

const listed = fs.readFileSync(LIST, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((r) => !ONLY_BOOK || r.book === ONLY_BOOK);
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

// Plan: read current state in chunks, keep only pages still serving the Woodblock read.
const plan = new Map(); // book -> [page]
const states = {};
for (let i = 0; i < listed.length; i += 2000) {
  const ids = listed.slice(i, i + 2000).map((r) => r.id);
  const docs = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1 } }).toArray();
  for (const p of docs) {
    const o = p.ocr || {};
    let k;
    if (o.edited_by || o.source === 'manual') k = 'human-edited';
    else if (o.model !== MODEL) k = `other-model:${o.model}`;
    else if (o.engine) k = 'already-has-engine';
    else if (!o.data) k = 'no-text';
    else k = 'target';
    states[k] = (states[k] || 0) + 1;
    if (k === 'target') { if (!plan.has(p.book_id)) plan.set(p.book_id, []); plan.get(p.book_id).push(p); }
  }
}
const targets = [...plan.values()].reduce((n, a) => n + a.length, 0);
console.log(JSON.stringify({ listed: listed.length, states, targets, books: plan.size }));

// Shape assertions — refuse to run on a set that does not look like the one measured 2026-09-30.
const assert = (c, m) => { if (!c) { console.error(`SHAPE FAIL: ${m}`); process.exit(2); } };
assert(listed.length === 68768 || ONLY_BOOK, `list has ${listed.length} rows, expected 68768`);
assert(!ONLY_BOOK ? targets > 1000 && targets < 2500 : true, `targets ${targets} outside 1000..2500`);
assert(!states['human-edited'], 'human-edited pages present in the target list');
for (const pages of plan.values()) for (const p of pages) {
  assert(p.ocr.pipeline === 'reocr_bdrc_4523', `page ${p.id} pipeline ${p.ocr.pipeline}`);
}

const sample = [...plan.values()][0]?.[0];
if (sample) {
  const shown = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'data' ? `<${v.length} chars>` : v]));
  console.log('BEFORE', JSON.stringify(shown(sample.ocr)));
}

if (!APPLY) {
  rec({ status: 'dry-run', states, targets, books: plan.size });
  report.end(); await mongo.close();
  process.exit(0);
}

const totals = { written: 0, revisions: 0, raced: 0, books: 0 };
for (const [bookId, pages] of plan) {
  const ids = pages.map((p) => p.id);
  const n = await saveRevisionsBeforeOverwrite(db, ids, 'ocr', { reason: REASON, keepMeta: true });
  if (n !== ids.length) { rec({ book: bookId, status: 'ABORT-revision-mismatch', want: ids.length, got: n }); console.error(`ABORT ${bookId}: revisions ${n} != ${ids.length}`); continue; }
  totals.revisions += n;
  let wrote = 0;
  for (const p of pages) {
    const res = await db.collection('pages').updateOne(
      { id: p.id, 'ocr.model': MODEL, 'ocr.engine': { $exists: false }, 'ocr.data': p.ocr.data, ...HUMAN_GUARD },
      { $set: { 'ocr.source': 'bdrc', 'ocr.engine': ENGINE, 'ocr.content_hash': contentHash(p.ocr.data) }, $unset: Object.fromEntries(UNSET.map((f) => [f, ''])) },
    );
    if (res.modifiedCount === 1) { wrote++; totals.written++; } else { totals.raced++; rec({ book: bookId, page: p.page_number, status: 'SKIP-guard-at-write' }); }
  }
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'woodblock-provenance-backfilled', detail: { issue: 4523, pages: wrote, revisions: n, engine_run: ENGINE.run } });
  await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_provenance_backfilled', at: new Date(), source: SWEEP, details: { issue: 4523, model: MODEL, pages: wrote } });
  totals.books++;
  rec({ book: bookId, status: 'applied', pages: wrote, revisions: n });
  if (sample && pages.includes(sample)) {
    const after = await db.collection('pages').findOne({ id: sample.id }, { projection: { ocr: 1 } });
    console.log('AFTER', JSON.stringify({ ...after.ocr, data: `<${after.ocr.data.length} chars>` }));
  }
}
console.log(JSON.stringify(totals));
rec({ status: 'run-summary', ...totals });
report.end();
await mongo.close();
