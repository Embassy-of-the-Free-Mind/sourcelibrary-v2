#!/usr/bin/env node
/**
 * Apply the Tibetan re-OCR adjudication (#4523/#4534/#4722) to production pages.
 *
 * Consumes a verdicts JSONL (from the eval-side adjudicator: one row per page,
 * {book, page, verdict, reason, ...evidence}) plus the new OCR text files, and for each page:
 *
 *   SERVE            snapshot the old ocr to page_revisions (reason
 *                    'reocr_bdrc_4523'), write the new text with provenance
 *                    (`ocr.engine`, `ocr.verdict`, `ocr.content_hash`), clear any prior
 *                    `ocr.unreadable` flag and the old model's prompt/job fields.
 *   MARK_UNRELIABLE  set `ocr.unreadable = true` + reason and `ocr.verdict`. The reader then
 *                    shows the scan as authoritative and an honest "not reliably
 *                    legible" notice instead of serving the text. The existing
 *                    `ocr.data` (often the old fabricated read) is RETAINED for
 *                    provenance but no longer rendered or counted; `ocr.engine` is NOT
 *                    touched, because it describes `data` and the judged read is not
 *                    `data` — the judged engine is `ocr.verdict.judged_engine`.
 *   TEXTLESS         leave the page untouched (cover / blank / divider).
 *
 * Human edits win: a page with `ocr.edited_by` or `ocr.source: 'manual'` is never
 * written. The guard is in the update FILTER, so an edit made between plan and write
 * is also respected; every such skip is recorded in the report.
 *
 * Reversible: SERVE snapshots before overwrite; MARK only sets flags and never
 * destroys text. Every action recorded in a report, a sweep_log row and a book_events
 * row per book. Idempotent: a page already carrying the verdict (same text + provenance,
 * or the same unreadable flag from the same judged engine) is counted as `alreadyApplied`
 * and not touched, so the lane can re-run a book after retried pages land without
 * stacking page_revisions snapshots. Read the new-text files from --textdir (one
 * <book>_<page5>.txt per SERVE page).
 *
 * Run on Hetzner. Default is DRY RUN; pass --apply to write.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/apply-reocr-verdicts.mjs \
 *     --verdicts=/root/tibetan-reocr/verdicts.jsonl --textdir=/root/tibetan-reocr/txt-wood \
 *     [--book=<id>] [--model=<ocr.model>] [--run=<engine run id>] [--read-mode=page|leaf] [--apply]
 *
 * --model names the recognizer that produced --textdir and selects its row in ENGINES
 * (written to ocr.model and ocr.engine). Default is the Woodblock ONNX model of the first
 * pass; the Yigdzin-primary pass (#4722) runs with --model=bdrc-yigdzin-v1
 * --textdir=.../txt-yigdzin. --run / --read-mode override the engine block's run id and
 * read mode (the per-leaf re-read of 2026-09-25 is --run=yigdzin-leaf-2026-09-25 --read-mode=leaf).
 * Keep --reason at its default: WITHHOLD_LANES (scripts/lib/stale-translation.mjs)
 * keys on `ocr.pipeline` = this value to withhold the English made from the text this
 * overwrites (the hourly withhold sweep acts on every rewritten page).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { contentHash } from '../lib/translate-core.mjs';
import { STALE_OCR_FIELDS } from '../lib/syriac-kraken-lane.mjs';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const ARG = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : d;
};
const APPLY = process.argv.includes('--apply');
const VERDICTS = ARG('--verdicts', null);
const TEXTDIR = ARG('--textdir', null);
const ONLY_BOOK = ARG('--book', null);
const REASON = ARG('--reason', 'reocr_bdrc_4523');
const REPORT = ARG('--report', `scripts/output/apply-verdicts-${new Date().toISOString().slice(0, 10)}.jsonl`);
if (!VERDICTS || !TEXTDIR) { console.error('--verdicts and --textdir required'); process.exit(1); }

const MODEL = ARG('--model', 'bdrc-woodblock-easter2');
const MIN_SYL = 20;
const ISSUE = 4523;
const SWEEP = 'tibetan-reocr-4523';
const BOOK_EVENT = 'tibetan_reocr_applied';

/**
 * The recognizers whose text this lane serves. `engine` is copied onto every SERVE page.
 * Yigdzin's revision is INFERRED, and the block says so (`revision_source`): the run loaded
 * the weights from a local copy and logged no sha; BDRC/tibetan-ocr `main` pointed at
 * 50506eb6 from 2026-08-22 through the whole run (2026-09-11 → 09-15), and the 2026-09-25
 * re-read box's download metadata (10 files) records the same revision.
 */
const ENGINES = {
  'bdrc-yigdzin-v1': {
    name: 'Yigdzin', version: 'v1', model: 'BDRC/tibetan-ocr',
    model_label: 'Yigdzin 1 — BDRC tibetan-ocr VLM',
    revision: '50506eb6d8ed8738df86b448f6f6cdc688de29ea',
    revision_source: 'inferred: BDRC/tibetan-ocr main for the whole run (2026-09-11 to 09-15); the run loaded a local copy and logged no sha; corroborated by 10 HF download-metadata files on sl-mitra-1 (2026-09-25 re-read)',
    model_url: 'https://huggingface.co/BDRC/tibetan-ocr/tree/50506eb6d8ed8738df86b448f6f6cdc688de29ea',
    licence: 'Apache-2.0',
    read_mode: 'page',
    decode: {
      runtime: 'vLLM 0.29 + vllm_paddleocr_seqpos (sequential M-RoPE), bf16, L4',
      image: 'downscaled to 2400 px wide (Lanczos, JPEG q95) when wider',
      sampling: 'greedy; DRY multiplier 0.8 base 1.75 allowed_length 12',
      loop_retry: 'temperature 0.4, n=2, when the greedy read shows measured repetition',
      truncation_redecode: 'min_tokens=300 re-decode where the greedy read ended on whitespace (kept only if longer)',
    },
    run: 'yigdzin-2026-09-15', issue: 4722,
  },
  'bdrc-woodblock-easter2': {
    name: 'BDRC tibetan-ocr-app', version: 'ONNX line models', model: 'Woodblock (easter2)',
    model_label: 'BDRC tibetan-ocr-app — Woodblock line recognizer',
    model_url: 'https://github.com/buda-base/tibetan-ocr-app',
    licence: 'MIT',
    read_mode: 'page',
    decode: { image: 'downscaled to 2400 px wide (Lanczos, JPEG q95) when wider' },
    run: 'woodblock-2026-09', issue: 4523,
  },
};
const ENGINE = ENGINES[MODEL];
if (!ENGINE) { console.error(`--model=${MODEL} has no ENGINES row; add one (provenance is required)`); process.exit(1); }
const ENGINE_BLOCK = { ...ENGINE, run: ARG('--run', ENGINE.run), read_mode: ARG('--read-mode', ENGINE.read_mode) };
const ADJ_RUN = path.basename(VERDICTS).replace(/\.jsonl$/, '');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Evidence block from a verdict row. The Yigdzin adjudicator writes structured fields;
 *  the September woodblock rows only carry `reason` ("agree=0.84" / "align=0.73"). */
function verdictBlock(v, now) {
  const fromReason = (k) => {
    const m = String(v.reason || '').match(new RegExp(`(?:^|\\s)${k}=([0-9.]+)`));
    return m ? Number(m[1]) : null;
  };
  return {
    verdict: v.verdict,
    rule: v.rule || (v.verdict === 'SERVE' ? String(v.reason || '').split('=')[0] || 'none' : 'none'),
    agree_wood: num(v.agree_w) ?? fromReason('agree_w') ?? fromReason('agree'),
    agree_uchan: num(v.agree_u) ?? fromReason('agree_u'),
    align: num(v.align) ?? fromReason('align'),
    align_src: v.align_src ?? null,
    dharani: num(v.dharani),
    valid: num(v.valid),
    judged_engine: MODEL,
    run: ADJ_RUN,
    issue: ISSUE,
    at: now,
  };
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

const rows = fs.readFileSync(VERDICTS, 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l))
  .filter((r) => !ONLY_BOOK || r.book === ONLY_BOOK);

// Group by book so revision snapshots batch and counter resync runs once each.
const byBook = new Map();
for (const r of rows) { if (!byBook.has(r.book)) byBook.set(r.book, []); byBook.get(r.book).push(r); }

const HUMAN_GUARD = { 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } };
const isHumanEdited = (p) => Boolean(p.ocr?.edited_by) || p.ocr?.source === 'manual';
// A literal $set inside a pipeline update: a transcription is arbitrary text, and in a
// pipeline a string beginning with `$` would be read as a field path.
const literal = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { $literal: v }]));
// `ocr` is null on never-read pages and a dotted $set cannot create fields inside null.
const ENSURE_OCR = { $set: { ocr: { $cond: { if: { $eq: [{ $type: '$ocr' }, 'object'] }, then: '$ocr', else: {} } } } };

const totals = { serve: 0, mark: 0, textless: 0, skipped: 0, alreadyApplied: 0, loopRefused: 0, humanEdited: 0, raced: 0, books: 0 };
for (const [bookId, verdicts] of byBook) {
  const pageDocs = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { id: 1, page_number: 1, ocr: 1 } })
    .toArray();
  const byNum = new Map(pageDocs.map((p) => [p.page_number, p]));

  const serveIds = [];
  const servePlan = [];
  const markOps = [];
  for (const v of verdicts) {
    const p = byNum.get(v.page);
    if (!p) { totals.skipped++; rec({ book: bookId, page: v.page, status: 'no-page-doc' }); continue; }
    if (v.verdict === 'TEXTLESS') { totals.textless++; continue; }
    if (isHumanEdited(p)) {
      totals.humanEdited++;
      rec({ book: bookId, page: v.page, status: 'SKIP-human-edited', edited_by: p.ocr?.edited_by ?? null, source: p.ocr?.source ?? null });
      continue;
    }
    if (v.verdict === 'MARK_UNRELIABLE') {
      if (p.ocr?.unreadable === true && p.ocr?.unreadable_reason === REASON && p.ocr?.verdict?.judged_engine === MODEL) { totals.alreadyApplied++; continue; }
      markOps.push({ page: p, v });
      continue;
    }
    if (v.verdict !== 'SERVE') { totals.skipped++; rec({ book: bookId, page: v.page, status: 'unknown-verdict', verdict: v.verdict }); continue; }
    const f = path.join(TEXTDIR, `${bookId}_${String(v.page).padStart(5, '0')}.txt`);
    if (!fs.existsSync(f)) { totals.skipped++; rec({ book: bookId, page: v.page, status: 'serve-no-text-file' }); continue; }
    const text = fs.readFileSync(f, 'utf8').trim();
    if (text.split('་').length < MIN_SYL) { totals.skipped++; rec({ book: bookId, page: v.page, status: 'serve-too-short' }); continue; }
    // Degeneration-loop guard (#4850) — never promote a looping read to SERVE.
    if (loopVerdict(text).refuse) {
      totals.loopRefused++;
      rec({ book: bookId, page: v.page, status: 'SKIP-repetition-loop' });
      continue;
    }
    // Idempotent re-run: a page that already carries this exact text from this model
    // under this lane gets no second revision snapshot and no rewrite.
    if (p.ocr?.pipeline === REASON && p.ocr?.data === text && p.ocr?.model === MODEL && !p.ocr?.unreadable) {
      totals.alreadyApplied++;
      continue;
    }
    if (p.ocr?.data) serveIds.push(p.id);
    servePlan.push({ page: p, text, v });
  }

  if (!APPLY) {
    // --show-page=N prints the exact fields a SERVE/MARK write would set on page N (text elided)
    const show = Number(ARG('--show-page', NaN));
    const hit = servePlan.find((x) => x.page.page_number === show) || markOps.find((x) => x.page.page_number === show);
    if (hit) {
      const now = new Date();
      const planned = hit.text
        ? { 'ocr.data': `<${hit.text.length} chars>`, 'ocr.language': 'Tibetan', 'ocr.model': MODEL, 'ocr.source': 'bdrc', 'ocr.pipeline': REASON, 'ocr.content_hash': contentHash(hit.text), 'ocr.engine': ENGINE_BLOCK, 'ocr.verdict': verdictBlock(hit.v, now), $unset: STALE_OCR_FIELDS }
        : { 'ocr.unreadable': true, 'ocr.unreadable_reason': REASON, 'ocr.verdict': verdictBlock(hit.v, now) };
      console.log(JSON.stringify({ book: bookId, page: show, page_id: hit.page.id, write: planned }, null, 2));
    }
    totals.serve += servePlan.length;
    totals.mark += markOps.length;
    rec({ book: bookId, status: 'dry-run', serve: servePlan.length, mark: markOps.length });
    continue;
  }
  if (!servePlan.length && !markOps.length) {
    rec({ book: bookId, status: 'already-applied' });
    continue;
  }

  // SERVE: version old text, then write new with provenance + clear unreadable.
  if (serveIds.length) {
    const n = await saveRevisionsBeforeOverwrite(db, serveIds, 'ocr', { reason: REASON, keepMeta: true });
    if (n !== serveIds.length) {
      rec({ book: bookId, status: 'ABORT-revision-mismatch', want: serveIds.length, got: n });
      console.error(`ABORT ${bookId}: revisions ${n} != ${serveIds.length}`);
      continue;
    }
  }
  const now = new Date();
  let wroteServe = 0;
  let wroteMark = 0;
  // the previous model's prompt/job/failure fields and the unreadable flag (all in the list)
  const unsetServe = STALE_OCR_FIELDS;
  for (const { page, text, v } of servePlan) {
    const set = {
      'ocr.data': text, 'ocr.language': 'Tibetan', 'ocr.model': MODEL,
      'ocr.source': 'bdrc', 'ocr.pipeline': REASON, 'ocr.updated_at': now,
      'ocr.content_hash': contentHash(text),
      'ocr.engine': ENGINE_BLOCK,
      'ocr.verdict': verdictBlock(v, now),
      updated_at: now,
    };
    const res = await db.collection('pages').updateOne({ id: page.id, ...HUMAN_GUARD }, [
      ENSURE_OCR, { $set: literal(set) }, { $unset: unsetServe },
    ]);
    if (res.modifiedCount === 1) { wroteServe++; totals.serve++; } else { totals.raced++; rec({ book: bookId, page: page.page_number, status: 'SKIP-guard-at-write' }); }
  }

  // MARK: flag unreadable; retain existing ocr.data (and the engine that produced it).
  for (const { page, v } of markOps) {
    const set = {
      'ocr.unreadable': true, 'ocr.unreadable_reason': REASON,
      'ocr.verdict': verdictBlock(v, now),
      updated_at: now,
    };
    const res = await db.collection('pages').updateOne({ id: page.id, ...HUMAN_GUARD }, [ENSURE_OCR, { $set: literal(set) }]);
    if (res.modifiedCount === 1) { wroteMark++; totals.mark++; } else { totals.raced++; rec({ book: bookId, page: page.page_number, status: 'SKIP-guard-at-write' }); }
  }

  // Counters follow the served state (unreadable pages are not counted as OCR'd).
  const [counts] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
  await db.collection('books').updateOne({ id: bookId }, {
    $set: { pages_ocr: counts?.with_ocr ?? 0, pages_translated: counts?.with_translation ?? 0, updated_at: now },
  });
  await recordSweepAction(db, {
    sweep: SWEEP, book_id: bookId, action: 'reocr-applied',
    detail: { issue: ISSUE, model: MODEL, engine_run: ENGINE_BLOCK.run, read_mode: ENGINE_BLOCK.read_mode, adjudication: ADJ_RUN, served: wroteServe, marked: wroteMark, revisions: serveIds.length, pages_ocr_after: counts?.with_ocr ?? null },
  });
  // one book_events row per book and model, advanced in place across passes (every
  // operator addresses a LEAF under `details` — see syriac-kraken-lane, Mongo error 40)
  await db.collection('book_events').updateOne(
    { book_id: bookId, type: BOOK_EVENT, 'details.model': MODEL },
    {
      $setOnInsert: { book_id: bookId, type: BOOK_EVENT, at: now, source: 'apply-reocr-verdicts', 'details.issue': ISSUE, 'details.model': MODEL, 'details.model_url': ENGINE_BLOCK.model_url ?? null, 'details.revision': ENGINE_BLOCK.revision ?? null },
      $set: { 'details.last_apply_at': now, 'details.last_adjudication': ADJ_RUN, 'details.pages_ocr_after': counts?.with_ocr ?? null },
      $inc: { 'details.served': wroteServe, 'details.marked': wroteMark },
    },
    { upsert: true },
  );
  totals.books++;
  rec({ book: bookId, status: 'applied', serve: wroteServe, mark: wroteMark, revisions: serveIds.length, pages_ocr_after: counts?.with_ocr ?? null });
}

console.log(JSON.stringify(totals));
rec({ status: 'run-summary', ...totals });
report.end();
await mongo.close();
