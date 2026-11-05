#!/usr/bin/env node
/**
 * Apply the vLLM Yigdzin reads of the 5,132 "guttered" Tibetan pages (#6871 row 4, gex45 task 86) to the held,
 * hidden books they belong to, under the #4523 write rule that passed round 2 (PR #7044).
 *
 * PRIOR ART: scripts/maintenance/apply-reocr-verdicts.mjs — the #4523/#4722 Yigdzin writer (revisions first, human-edit
 * guard in the update filter, literal $set, sweep_log + book_events per book; its ENGINES row is the provenance block
 * reused here). It applies an adjudicator's SERVE/MARK verdicts to pages that already HAVE text; these pages have
 * never been read, the verdict is the write rule itself, and blanks and junk reads need their own outcomes, so it does
 * not fit without a second mode. scripts/maintenance/set-blank-leaves-by-eye.mjs — the blank-leaf shape reused for
 * the 468 pages the reader called "empty page".
 *
 * Two steps:
 *   --plan   reads the task-86 files and decides every page. Writes nothing to Mongo.
 *            (reads/  = gex45:/root/jobs/tib-gutter-6871/full-vllm,  run/ = …/vllm-full-run with todo + flags)
 *   --apply  executes a plan for the books named in --books (comma list) or --all. Without --apply, a dry run.
 *   --backfill-revisions --run-id=<id> [--apply]  writer rows for pages an earlier run wrote by direct $set (see below).
 *
 * Outcomes per page (the plan's `action`):
 *   skip-rights          the book is a modern authored work or uncertain (rights CSV): no text write at all
 *   skip-page-excluded   a page the rights pass names as modern front matter in a cleared book
 *   skip-existing        the page already carries text that is not a flash-lite read, or a human edit
 *   drop-junk            a flagged read that is not just the blank marker (loops, Latin junk, duplicated lines): nothing written
 *   withhold-cap         the read hit max_tokens (4096): a loop by construction, nothing written
 *   withhold-guard       first-ocr-guard flags the read (text or blank_leaf): nothing written
 *   withhold-short       fewer than 150 Tibetan syllables after the blank markers are stripped: nothing written
 *   withhold-blank       the read is only the blank marker ("empty page"): nothing written. The reader says this for
 *                        real blank leaves, but also for faded text leaves and English imprint pages (by eye,
 *                        2026-10-26: 1 of 10 drawn "blanks" carried 5–6 faded lines, and an ink measure could not
 *                        separate those from ruled blank frames), so the marker is not evidence enough for page_type 'blank'.
 *   write                the text, with provenance
 * Every withheld/dropped page gets a report row; the book's sweep_log row carries the counts.
 *
 * Writes go through writePageText (scripts/lib/page-text-writer.mjs, #7058): one page_revisions row per page with the
 * whole prior `ocr` and the run_id, then a compare-and-set. Undo a run: scripts/maintenance/revert-run.mjs --run-id <id>.
 * The 2026-10-26 run predates that and wrote with a direct $set; --backfill-revisions added its writer rows afterwards
 * (run_id apply-tib-gutter-vllm-6871-20261026T182400Z-backfill, 2,805 rows, revert-run dry run: 2,805 restorable).
 *
 * Books stay held: this never touches `pipeline_auto`, `visible` or anything a translate phase selects; the only
 * book write is the page-counter recount (recountBook, the one writer of those counters).
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-tib-gutter-vllm-6871.mjs --plan \
 *        --reads=<dir> --run=<dir> --rights=scripts/eval/tibetan-gutter-6871/rights-pass-2026-10-26.csv --out=<plan.jsonl>
 *   node --env-file=.env.production.local scripts/maintenance/apply-tib-gutter-vllm-6871.mjs --plan-file=<plan.jsonl> \
 *        --books=<id,id> | --all  [--apply] [--report=<file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { firstOcrVerdict, textVerdict } from '../lib/first-ocr-guard.mjs';
import { randomBytes } from 'node:crypto';
import { writePageText, newRunId, buildTextRevision } from '../lib/page-text-writer.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const ARG = (n, d = null) => { const a = process.argv.find((x) => x.startsWith(`${n}=`)); return a ? a.slice(n.length + 1) : d; };
const HAS = (f) => process.argv.includes(f);
const ISSUE = 6871;
const SWEEP = 'tib-gutter-vllm-apply-6871';
const REASON = 'tib_gutter_vllm_6871'; // page_revisions reason and ocr.pipeline
const BOOK_EVENT = 'tibetan_gutter_ocr_applied';
const MODEL = 'bdrc-yigdzin-v1';
const MIN_SYL = 150;
const MAX_TOKENS = 4096;
const BLANK_MARKER = /^\s*(empty page|ཤོག་སྟོང་།?)\s*$/iu;

// Same reader and weights as apply-reocr-verdicts' 'bdrc-yigdzin-v1' row; the runtime and run differ.
// Facts: gex45:/root/jobs/tib-gutter-6871/yig_vllm.py (REPO/REV, sampling) and gpu-queue/86-tib-gutter-vllm-full/task.log.
const ENGINE = {
  name: 'Yigdzin', version: 'v1', model: 'BDRC/tibetan-ocr',
  model_label: 'Yigdzin 1 — BDRC tibetan-ocr VLM',
  revision: '50506eb6d8ed8738df86b448f6f6cdc688de29ea',
  revision_source: 'pinned: yig_vllm.py loads LLM(model="BDRC/tibetan-ocr", revision=REV); the gex45 HF cache refs/main is the same sha',
  model_url: 'https://huggingface.co/BDRC/tibetan-ocr/tree/50506eb6d8ed8738df86b448f6f6cdc688de29ea',
  licence: 'Apache-2.0',
  read_mode: 'page',
  runtime_id: 'yigdzin-vllm-0.29',
  decode: {
    runtime: 'vLLM 0.29 + vllm_paddleocr_seqpos (sequential M-RoPE), bf16, RTX PRO 4000 Blackwell (gex45), gpu_memory_utilization 0.6, batch 64',
    image: 'whole page image as served, no crop or downscale by the script',
    prompt: 'Extract all Tibetan text. Preserve line breaks.',
    sampling: 'greedy; DRY multiplier 0.8 base 1.75 allowed_length 12; max_tokens 4096; no loop retry, no min_tokens re-decode',
  },
  run: 'gex45-86-tib-gutter-vllm-full-2026-10-26', issue: ISSUE,
  code: 'scripts/eval/tibetan-gutter-6871/yig_vllm.py (PR #7427)',
};
const RULE = {
  name: '#4523 write rule (round 2, preregistered: scripts/eval/tibetan-gutter-6871/r2/PREREGISTRATION.md)',
  steps: 'blank-marker lines stripped; first-ocr-guard (text + blank_leaf) unflagged; >= 150 Tibetan syllables; read under max_tokens',
  gate: 'PR #7044 (0 invented in 15 written pages); vLLM parity PR #7427',
  approved: 'Derek 2026-10-26 ("approve, if it is good, spot check")',
  issue: ISSUE,
};

const csvRows = (file) => {
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  const parse = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
  return lines.map((l) => Object.fromEntries(parse(l).map((v, i) => [cols[i], v])));
};
const stripMarkers = (t) => t.split('\n').filter((l) => !BLANK_MARKER.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
/** A page already carries text we must not overwrite: anything but an empty field or a flash-lite read. */
const hasKeepText = (p) => {
  if (p.ocr?.edited_by || p.ocr?.source === 'manual') return 'human';
  const d = p.ocr?.data;
  if (typeof d !== 'string' || d.trim() === '') return null;
  return /lite/i.test(String(p.ocr?.model || '')) ? null : `existing:${p.ocr?.model || p.ocr?.source || 'unknown'}`;
};

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

if (HAS('--plan')) {
  const READS = ARG('--reads'), RUN = ARG('--run'), RIGHTS = ARG('--rights'), OUT = ARG('--out');
  if (!READS || !RUN || !RIGHTS || !OUT) { console.error('--plan needs --reads --run --rights --out'); process.exit(2); }
  const todo = fs.readFileSync(path.join(RUN, 'todo.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const flagged = new Map(fs.readFileSync(path.join(RUN, 'flags.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  const tokens = new Map();
  for (const l of fs.readFileSync(path.join(READS, 'timings.jsonl'), 'utf8').split('\n')) { if (l.startsWith('{')) { const r = JSON.parse(l); tokens.set(r.id, r.tokens); } }
  const rights = new Map(csvRows(RIGHTS).map((r) => [r.book_id, r]));
  const pages = new Map((await db.collection('pages').find({ id: { $in: todo.map((t) => t.id) } },
    { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1 } }).toArray()).map((p) => [p.id, p]));
  const out = fs.createWriteStream(OUT);
  const tally = {};
  const queue = [...todo];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const p = pages.get(t.id);
      const row = { id: t.id, src: t.src, book: p?.book_id ?? null, page: p?.page_number ?? null };
      const raw = fs.readFileSync(path.join(READS, `${t.id}.txt`), 'utf8');
      const text = stripMarkers(raw);
      const r = rights.get(row.book);
      const excluded = (r?.exclude_pages || '').split(/[ ;]+/).filter(Boolean).map(Number);
      const keep = p ? hasKeepText(p) : 'no-page-doc';
      if (!p) row.action = 'skip-existing', row.why = 'no-page-doc';
      else if (!r || r.verdict !== 'traditional') row.action = 'skip-rights', row.why = r ? r.verdict : 'not-in-rights-csv';
      else if (excluded.includes(row.page)) row.action = 'skip-page-excluded', row.why = r.exclude_why || 'modern front matter';
      else if (keep) row.action = 'skip-existing', row.why = keep;
      else if (flagged.has(t.id)) {
        if (!text) row.action = 'withhold-blank', row.why = 'flagged-marker-only';
        else row.action = 'drop-junk', row.why = flagged.get(t.id).flags.join('+');
      } else if (!text) row.action = 'withhold-blank', row.why = 'unflagged-marker-only';
      else if ((tokens.get(t.id) ?? 0) >= MAX_TOKENS) row.action = 'withhold-cap', row.why = `tokens=${tokens.get(t.id)}`;
      else {
        const tv = textVerdict(text);
        row.units = tv.units; row.script = tv.script;
        if (tv.flag) row.action = 'withhold-guard', row.why = tv.flags.join('+');
        else if (tv.script !== 'tibetan' || tv.units < MIN_SYL) row.action = 'withhold-short', row.why = `${tv.script}:${tv.units}`;
        else {
          const res = await fetch(t.src);
          if (!res.ok) { row.action = 'withhold-guard'; row.why = `image-http-${res.status}`; }
          else {
            const v = await firstOcrVerdict(text, Buffer.from(await res.arrayBuffer()));
            row.leaf_tex = v.leaf_tex;
            if (v.flag) row.action = 'withhold-guard', row.why = v.flags.join('+');
            else row.action = 'write';
          }
        }
      }
      if (row.action === 'write') row.hash = contentHash(text);
      tally[row.action] = (tally[row.action] || 0) + 1;
      out.write(`${JSON.stringify(row)}\n`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  out.end();
  console.log(JSON.stringify({ plan: OUT, pages: todo.length, ...tally }));
  await mongo.close();
  process.exit(0);
}

// ---------------- backfill-revisions ----------------
// The 2026-10-26 run (2,805 pages) wrote with a direct $set before this script used writePageText, so it left no
// writer rows and revert-run.mjs could not undo it. This adds one writer-shaped row per page it wrote: the prior
// `ocr` is the page's current object minus the fields this run set (on 7 pages that leaves the fail stamps of an
// earlier flash-lite attempt; elsewhere nothing, i.e. absent), and next_hash is the text the run wrote. Idempotent:
// a page that already has a row under --run-id is skipped. Dry run unless --apply.
if (HAS('--backfill-revisions')) {
  const RUN = ARG('--run-id');
  if (!RUN) { console.error('--backfill-revisions needs --run-id'); process.exit(2); }
  const RUN_FIELDS = ['data', 'language', 'model', 'source', 'pipeline', 'updated_at', 'content_hash', 'engine', 'verdict'];
  const have = new Set((await db.collection('page_revisions').find({ run_id: RUN }, { projection: { page_id: 1 } }).toArray()).map((r) => r.page_id));
  const pages = await db.collection('pages').find({ 'ocr.pipeline': REASON }, { projection: { id: 1, book_id: 1, ocr: 1 } }).toArray();
  const rows = [];
  const tally = { pages: pages.length, already: 0, absent: 0, object: 0, hash_mismatch: 0 };
  for (const p of pages) {
    if (have.has(p.id)) { tally.already++; continue; }
    if (contentHash(p.ocr.data) !== p.ocr.content_hash) { tally.hash_mismatch++; continue; }
    const rest = Object.fromEntries(Object.entries(p.ocr).filter(([k]) => !RUN_FIELDS.includes(k)));
    const prior = Object.keys(rest).length ? rest : null;
    tally[prior ? 'object' : 'absent']++;
    rows.push(buildTextRevision({
      page: { id: p.id, book_id: p.book_id, ocr: prior }, field: 'ocr', next: p.ocr,
      opts: { by: 'scripts/maintenance/apply-tib-gutter-vllm-6871.mjs --backfill-revisions', reason: `${REASON}: #4523 write rule (#${ISSUE}); row backfilled after the write (the run predates writePageText)`, run_id: RUN },
      now: p.ocr.updated_at instanceof Date ? p.ocr.updated_at : new Date(p.ocr.updated_at), id: randomBytes(6).toString('hex'),
    }));
  }
  if (HAS('--apply') && rows.length) {
    for (let i = 0; i < rows.length; i += 500) await db.collection('page_revisions').insertMany(rows.slice(i, i + 500), { ordered: true });
  }
  console.log(JSON.stringify({ backfill: true, apply: HAS('--apply'), run_id: RUN, rows: rows.length, ...tally }));
  await mongo.close();
  process.exit(0);
}

// ---------------- apply ----------------
const PLAN = ARG('--plan-file');
const READS = ARG('--reads');
const APPLY = HAS('--apply');
const BOOKS = HAS('--all') ? null : new Set((ARG('--books', '') || '').split(',').filter(Boolean));
if (!PLAN || !READS || (BOOKS && !BOOKS.size)) { console.error('needs --plan-file, --reads and --books=<ids> or --all'); process.exit(2); }
const REPORT = ARG('--report', `${PLAN.replace(/\.jsonl$/, '')}-${APPLY ? 'apply' : 'dry'}-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`);
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);
const plan = fs.readFileSync(PLAN, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.book && (!BOOKS || BOOKS.has(r.book)));
const byBook = new Map();
for (const r of plan) { if (!byBook.has(r.book)) byBook.set(r.book, []); byBook.get(r.book).push(r); }

const RUN_ID = ARG('--run-id', newRunId('apply-tib-gutter-vllm-6871'));

const totals = { books: 0, write: 0, already: 0, raced: 0, revisions: 0, notWritten: {} };
for (const [bookId, rows] of byBook) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, visible: 1 } });
  if (!book?.pipeline_auto?.hold || book.pipeline_auto.status !== 'held') {
    rec({ book: bookId, status: 'ABORT-book-not-held', pipeline: book?.pipeline_auto?.status ?? null });
    console.error(`ABORT ${bookId}: not held — this lane writes only to held books`); continue;
  }
  const todo = rows.filter((r) => r.action === 'write');
  for (const r of rows) if (!todo.includes(r)) { totals.notWritten[r.action] = (totals.notWritten[r.action] || 0) + 1; rec({ book: bookId, page: r.page, id: r.id, status: r.action, why: r.why ?? null }); }
  const current = new Map((await db.collection('pages').find({ id: { $in: todo.map((r) => r.id) } }, { projection: { id: 1, ocr: 1, page_type: 1 } }).toArray()).map((p) => [p.id, p]));
  const go = [];
  for (const r of todo) {
    const p = current.get(r.id);
    if (p?.ocr?.pipeline === REASON && p?.ocr?.content_hash === r.hash) { totals.already++; continue; }
    if (p && hasKeepText(p)) { totals.raced++; rec({ book: bookId, page: r.page, id: r.id, status: 'SKIP-existing-at-apply', why: hasKeepText(p) }); continue; }
    go.push(r);
  }
  if (!APPLY) { rec({ book: bookId, status: 'dry-run', write: go.length }); totals.books++; totals.write += go.length; continue; }
  if (!go.length) { rec({ book: bookId, status: 'nothing-to-write' }); continue; }

  // Every write goes through writePageText (#7058): a page_revisions row with the whole prior `ocr` object (a flash-lite
  // read, or only the fail stamps of an earlier lite attempt), this run's run_id and the hash of the new text, then a
  // compare-and-set on the prior text with the human-edit guard. Undo: scripts/maintenance/revert-run.mjs --run-id <id>.
  const now = new Date();
  let wrote = 0;
  const revisions = go.filter((r) => current.get(r.id)?.ocr?.data).length;
  for (const r of go) {
    const text = stripMarkers(fs.readFileSync(path.join(READS, `${r.id}.txt`), 'utf8'));
    if (contentHash(text) !== r.hash) { totals.raced++; rec({ book: bookId, page: r.page, id: r.id, status: 'SKIP-read-file-changed' }); continue; }
    const prior = current.get(r.id)?.ocr;
    const next = {
      ...(prior && typeof prior === 'object' ? prior : {}),
      data: text, language: 'Tibetan', model: MODEL, source: 'bdrc', pipeline: REASON,
      updated_at: now, content_hash: r.hash, engine: ENGINE,
      verdict: { verdict: 'SERVE', rule: RULE, units: r.units, leaf_tex: r.leaf_tex ?? null, judged_engine: MODEL, run: ENGINE.run, issue: ISSUE, at: now },
    };
    const res = await writePageText(db, r.id, 'ocr', next, { by: 'scripts/maintenance/apply-tib-gutter-vllm-6871.mjs', reason: `${REASON}: #4523 write rule (#${ISSUE})`, run_id: RUN_ID, now });
    if (res.status === 'written') { wrote++; rec({ book: bookId, page: r.page, id: r.id, status: 'WROTE', revision_id: res.revision_id, run_id: RUN_ID }); }
    else { totals.raced++; rec({ book: bookId, page: r.page, id: r.id, status: `SKIP-${res.status}` }); }
  }
  totals.write += wrote; totals.books++;
  const counts = await recountBook(db, bookId, { reason: SWEEP });
  const notWritten = rows.filter((r) => r.action !== 'write').reduce((m, r) => ((m[r.action] = (m[r.action] || 0) + 1), m), {});
  await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'tib-gutter-ocr-applied',
    detail: { issue: ISSUE, model: MODEL, engine_run: ENGINE.run, written: wrote, revisions, run_id: RUN_ID, not_written: notWritten, pages_ocr_after: counts.after?.pages_ocr ?? null } });
  await db.collection('book_events').updateOne(
    { book_id: bookId, type: BOOK_EVENT, 'details.run': ENGINE.run },
    { $setOnInsert: { book_id: bookId, type: BOOK_EVENT, at: now, source: 'apply-tib-gutter-vllm-6871', 'details.issue': ISSUE, 'details.model': MODEL, 'details.run': ENGINE.run, 'details.revision': ENGINE.revision },
      $set: { 'details.last_apply_at': now }, $inc: { 'details.written': wrote } },
    { upsert: true });
  rec({ book: bookId, status: 'applied', written: wrote, revisions, run_id: RUN_ID, counts: counts.after ?? null });
  console.log(`${bookId}: wrote ${wrote}, revisions ${revisions}`);
}
console.log(JSON.stringify({ apply: APPLY, run_id: APPLY ? RUN_ID : null, report: REPORT, ...totals }));
rec({ status: 'run-summary', apply: APPLY, ...totals });
report.end();
await mongo.close();

