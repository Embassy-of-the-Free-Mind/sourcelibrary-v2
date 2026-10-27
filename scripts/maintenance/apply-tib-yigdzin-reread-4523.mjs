#!/usr/bin/env node
/**
 * Apply the gex45 Yigdzin (vLLM 0.29) re-reads of Tibetan pages (job tib-gemini-ocr-6871, #4523 / #6871) under the
 * #4523 write rule, and lift the withhold this job put on the Gemini-read pages page by page as their read passes.
 *
 * PRIOR ART: scripts/maintenance/apply-tib-gutter-vllm-6871.mjs — the same rule and writer, for whole-page reads of
 * guttered pages (gex45 task 86); it reads one flat directory of page-mode files keyed by page id and writes only to
 * pages that are empty or carry a flash-lite read. This lane's reads are mostly LEAF-mode (yig_leaf_worker.py splits
 * each multi-leaf capture and joins the leaves top to bottom, files keyed <book>_<page>), with a page-mode remainder
 * for guttered captures, and the pages it targets are withheld (`ocr.withheld_reason: gemini-ocr-tibetan-4523`,
 * scripts/maintenance/withhold-gemini-ocr-tibetan-4523.mjs) or never read. Engine block reused from it.
 *
 * Per page of a todo manifest (gex45 /root/jobs/tib-gemini-ocr-6871/todo-<set>.jsonl):
 *   skip-existing   the page now carries text that is not this job's withheld Gemini read (any other read, a human
 *                   edit, typed/Esukhia, an Opus or Flash-corrected read): never overwritten
 *   unread          no read file (fetch error, refused, still queued)
 *   drop-junk       Latin letters > Tibetan, a repeated line (>= 10 chars, the #5771 defect), a leaf the worker left
 *                   looping, or a read that hit max_tokens
 *   withhold-guard  first-ocr-guard flags the read (text, or blank_leaf on the image)
 *   withhold-short  fewer than 150 Tibetan syllables (blank markers stripped)
 *   write           the text, with provenance; `unreadable` / `withheld_*` are gone from the new `ocr` (the prior object,
 *                   withhold and all, is in the page_revisions row). A page whose English was withheld gets
 *                   `translation_stale` (lane yigdzin-reread-4523) so the re-translation lane finds it.
 * Writes go through writePageText (#7058), one run id: undo with scripts/maintenance/revert-run.mjs --run-id <id>.
 * Book holds are not touched (the translate lanes stay off until the English is re-made by the lane that owns it).
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-tib-yigdzin-reread-4523.mjs \
 *        --todo=<todo-X.jsonl> --reads=<out-X dir> [--books=id,id] [--apply] [--report=<file>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { firstOcrVerdict } from '../lib/first-ocr-guard.mjs';
import { writePageText, newRunId, isHumanEditedField } from '../lib/page-text-writer.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { recountBook } from '../lib/page-counts.mjs';

const ARG = (n, d = null) => { const a = process.argv.find((x) => x.startsWith(`${n}=`)); return a ? a.slice(n.length + 1) : d; };
const APPLY = process.argv.includes('--apply');
const ISSUE = 4523;
const SWEEP = 'tib-yigdzin-reread-4523';
const REASON = 'tib_yigdzin_reread_4523'; // page_revisions reason and ocr.pipeline
const WITHHELD = 'gemini-ocr-tibetan-4523';
const STALE_LANE = 'yigdzin-reread-4523';
const MODEL = 'bdrc-yigdzin-v1';
const MIN_SYL = 150;
const BLANK_MARKER = /^\s*(empty page|ཤོག་སྟོང་།?)\s*$/iu;

const ENGINE = {
  name: 'Yigdzin', version: 'v1', model: 'BDRC/tibetan-ocr',
  model_label: 'Yigdzin 1 — BDRC tibetan-ocr VLM',
  revision: '50506eb6d8ed8738df86b448f6f6cdc688de29ea',
  revision_source: 'pinned: the task loads the gex45 HF cache snapshot 50506eb6…',
  model_url: 'https://huggingface.co/BDRC/tibetan-ocr/tree/50506eb6d8ed8738df86b448f6f6cdc688de29ea',
  licence: 'Apache-2.0',
  runtime_id: 'yigdzin-vllm-0.29',
  decode: {
    runtime: 'vLLM 0.29 + vllm_paddleocr_seqpos (sequential M-RoPE), bf16, RTX PRO 4000 Blackwell (gex45), gpu_memory_utilization 0.6',
    leaf: 'yig_leaf_worker.py --mode partition: leafsplit.detect() cuts the capture into its leaves, each read alone at 2400 px, joined top to bottom; loop retry T 0.4 n=2; short-read re-decode',
    page: 'guttered captures: yig_vllm.py page mode, batch 64 (the task-86 recipe)',
    prompt: 'Extract all Tibetan text. Preserve line breaks.',
    sampling: 'greedy; DRY multiplier 0.8 base 1.75 allowed_length 12; max_tokens 4096',
  },
  issue: ISSUE,
  code: 'scripts/gpu/yigdzin-vllm/yig_leaf_worker.py, gex45 /root/jobs/yig-vllm-6871/harness',
};
const RULE = {
  name: '#4523 write rule',
  steps: 'blank-marker lines stripped; Latin > Tibetan, repeated line, unrecovered loop or max_tokens dropped; first-ocr-guard (text + blank_leaf) unflagged; >= 150 Tibetan syllables',
  approved: 'Derek 2026-10-27 brief tib-gemini-ocr-6871 ("hide the poor quality flash lite ocr"; re-read with Yigdzin, write under the #4523 rule)',
  issue: ISSUE,
};

const stripMarkers = (t) => t.split('\n').filter((l) => !BLANK_MARKER.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
/** The #5771 junk checks, as task 86 ran them. */
export function junkFlags(t) {
  const tib = (t.match(/[ༀ-࿿]/gu) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
  const lines = t.split('\n').map((l) => l.replace(/\s+/g, '')).filter((l) => l.length >= 10);
  const seen = new Map(); for (const l of lines) seen.set(l, (seen.get(l) || 0) + 1);
  const dup = [...seen.values()].reduce((s, n) => s + (n > 1 ? n - 1 : 0), 0);
  return [lat > tib && 'latin', dup > 0 && 'dupline'].filter(Boolean);
}
/** Text on the page this lane must not overwrite (null = empty, or this job's withheld Gemini read). */
const keepReason = (p) => {
  const o = p?.ocr;
  if (!o) return null;
  if (isHumanEditedField(o)) return 'human';
  if (o.withheld_reason === WITHHELD && typeof o.data !== 'string') return null;
  if (typeof o.data !== 'string' || o.data.trim() === '') return o.unreadable ? `unreadable:${o.unreadable_reason || '?'}` : null;
  return `existing:${o.model || o.source || 'unknown'}`;
};

const TODO = ARG('--todo'), READS = ARG('--reads');
if (!TODO || !READS) { console.error('needs --todo and --reads'); process.exit(2); }
const ONLY = ARG('--books') ? new Set(ARG('--books').split(',')) : null;
const REPORT = ARG('--report', `${process.env.JOB_SCRATCH || '/tmp'}/${path.basename(TODO, '.jsonl')}-${APPLY ? 'apply' : 'dry'}.jsonl`);

// ledger: per-page leaf meta from the leaf worker; tokens from the page-mode remainder
const ledger = new Map();
const lp = path.join(READS, 'pages.jsonl');
if (fs.existsSync(lp)) for (const l of fs.readFileSync(lp, 'utf8').split('\n')) if (l.startsWith('{')) { const r = JSON.parse(l); ledger.set(r.id, r); }
const gtok = new Map();
const gp = path.join(READS, 'gutter', 'timings.jsonl');
if (fs.existsSync(gp)) for (const l of fs.readFileSync(gp, 'utf8').split('\n')) if (l.startsWith('{')) { const r = JSON.parse(l); gtok.set(r.id, r.tokens); }
const readFile = (stem) => {
  for (const [f, mode] of [[path.join(READS, 'txt', `${stem}.txt`), 'leaf'], [path.join(READS, 'gutter', `${stem}.txt`), 'page']]) {
    if (fs.existsSync(f)) return { raw: fs.readFileSync(f, 'utf8'), mode };
  }
  return null;
};

const todo = fs.readFileSync(TODO, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !ONLY || ONLY.has(r.book));
const byBook = new Map();
for (const r of todo) { if (!byBook.has(r.book)) byBook.set(r.book, []); byBook.get(r.book).push(r); }

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const RUN_ID = newRunId('apply-tib-yigdzin-reread-4523');
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const T = { books: 0, pages: 0, actions: {}, statuses: {}, stale: 0, lifted: 0, pub_written: 0 };
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
console.log(`=== ${SWEEP} ${APPLY ? `APPLY run_id=${RUN_ID}` : '(dry run)'} — ${todo.length} pages, ${byBook.size} books ===`);
try {
  for (const [bookId, rows] of byBook) {
    T.books++;
    const pages = new Map((await db.collection('pages').find({ id: { $in: rows.map((r) => r.page_id) } },
      { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, translation_withheld: 1, 'translation.data': 1 } }).toArray()).map((p) => [p.id, p]));
    let wrote = 0;
    const acts = {};
    const work = [...rows];
    const one = async (r) => {
      T.pages++;
      const p = pages.get(r.page_id);
      const stem = `${r.book}_${String(r.page).padStart(5, '0')}`;
      const row = { book: r.book, page: r.page, id: r.page_id, pub: r.pub };
      const keep = p ? keepReason(p) : 'no-page-doc';
      const f = readFile(stem);
      if (keep) row.action = 'skip-existing', row.why = keep;
      else if (!f) row.action = 'unread';
      else {
        row.mode = f.mode;
        const text = stripMarkers(f.raw);
        const lg = ledger.get(stem);
        const loopLeft = f.mode === 'leaf' && (lg?.leaf || []).some((x) => x.loop_left || (x.fin === 'length' && !x.retry));
        const capped = f.mode === 'page' && (gtok.get(stem) ?? 0) >= 4096;
        const jf = junkFlags(text);
        if (loopLeft || capped || jf.length) row.action = 'drop-junk', row.why = [...jf, loopLeft && 'loop', capped && 'max_tokens'].filter(Boolean).join('+');
        else {
          let v = null;
          try {
            const res = await fetch(r.url);
            if (res.ok) v = await firstOcrVerdict(text, Buffer.from(await res.arrayBuffer()));
            else row.why = `image-http-${res.status}`;
          } catch (e) { row.why = `image-${e.name}`; }
          if (!v) row.action = 'withhold-guard';
          else {
            row.units = v.units; row.script = v.script; row.leaf_tex = v.leaf_tex ?? null;
            if (v.flag) row.action = 'withhold-guard', row.why = v.flags.join('+');
            else if (v.script !== 'tibetan' || v.units < MIN_SYL) row.action = 'withhold-short', row.why = `${v.script}:${v.units}`;
            else row.action = 'write', row.text = text;
          }
        }
      }
      bump(acts, row.action); bump(T.actions, row.action);
      if (row.action === 'write' && APPLY) {
        const now = new Date();
        const hash = contentHash(row.text);
        const next = {
          data: row.text, language: 'Tibetan', model: MODEL, source: 'bdrc', pipeline: REASON, updated_at: now, content_hash: hash,
          engine: { ...ENGINE, read_mode: row.mode, run: `gex45-tib-gemini-ocr-6871-${path.basename(READS)}` },
          verdict: { verdict: 'SERVE', rule: RULE, units: row.units, leaf_tex: row.leaf_tex, judged_engine: MODEL, issue: ISSUE, at: now },
        };
        const res = await writePageText(db, r.page_id, 'ocr', next, { by: 'scripts/maintenance/apply-tib-yigdzin-reread-4523.mjs', reason: `${REASON}: #4523 write rule`, run_id: RUN_ID, now });
        row.status = res.status; bump(T.statuses, res.status);
        if (res.status === 'written') {
          wrote++; if (r.pub) T.pub_written++;
          if (p.ocr?.withheld_reason === WITHHELD) T.lifted++;
          if (p.translation_withheld && !p.translation?.data) {
            const s = await db.collection('pages').updateOne({ id: r.page_id, translation_stale: { $exists: false } },
              { $set: { translation_stale: { reason: 'ocr_rewritten', since: now, lane: STALE_LANE } } });
            T.stale += s.modifiedCount;
          }
        }
      }
      delete row.text;
      report.write(`${JSON.stringify(row)}\n`);
    };
    await Promise.all(Array.from({ length: 8 }, async () => { for (let r = work.shift(); r; r = work.shift()) await one(r); }));
    if (APPLY && wrote) {
      const rc = await recountBook(db, bookId, { reason: SWEEP });
      await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'yigdzin-reread-applied', detail: { issue: ISSUE, run_id: RUN_ID, reads: path.basename(READS), written: wrote, actions: acts, pages_ocr_after: rc.after?.pages_ocr ?? null } });
    }
    if (T.books % 50 === 0) console.log(`  ${T.books} books, ${T.pages} pages ${JSON.stringify(T.actions)}`);
  }
  console.log(JSON.stringify({ apply: APPLY, run_id: APPLY ? RUN_ID : null, report: REPORT, ...T }, null, 1));
  if (APPLY) console.log(`UNDO: node --env-file=.env.production.local scripts/maintenance/revert-run.mjs --run-id ${RUN_ID} --apply`);
} finally {
  report.end();
  await mongo.close();
}
