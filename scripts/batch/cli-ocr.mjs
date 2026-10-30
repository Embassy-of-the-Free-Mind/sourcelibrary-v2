#!/usr/bin/env node
// PRIOR ART: scripts/batch/realtime-ocr.mjs and bulk-reocr-local.mjs — the two hand-run OCR writers; both call the
// paid Gemini API. Since 2026-10-08 every Gemini model except flash-lite runs through the subscription CLI instead
// (`agy -p`), and neither script can do that. scripts/eval/pareto-6182/RUNBOOK-cli38-xl.md runs the CLI for a
// TRANSLATION eval and writes no page. This is the OCR writer for CLI reads, with the same guards and the same
// provenance block as realtime-ocr.mjs.
/**
 * OCR a page list through the Gemini subscription CLI, in two stages, so a read can be looked at before it is written.
 *
 * WHO RUNS IT: a person or session at a machine where `agy` is installed and signed in. About 30 s a page, one page
 * per call, no API key and no API spend. It is for a handful to a few hundred pages a stronger model has to read
 * (flash-lite drops lines on dense early print, #4877); it is not a bulk lane.
 *
 *   read   node --env-file=.env.production.local scripts/batch/cli-ocr.mjs read --page-ids-file=F --out=DIR [--model=gemini-3.8-flash-low]
 *          Downloads each page's archived image, asks the CLI to transcribe it on the live default OCR prompt, and
 *          saves DIR/<page_id>.txt + .meta.json. Writes no page or book: only the job's book list, for the lane
 *          registry (lane_job_books, #7301). Re-running skips pages already read.
 *
 *   apply  node --env-file=.env.production.local scripts/batch/cli-ocr.mjs apply --out=DIR --reason="..." [--apply]
 *          Dry run unless --apply. Per page: refuses a human-edited page, a page whose OCR changed after the read,
 *          an empty or over-long read, a repetition loop, a refusal or summary dressed as a transcription, and a read
 *          that shares under 40% of its words with the text already stored; writes through writePageText (#7058: the old
 *          text to page_revisions under the run id, so scripts/maintenance/revert-run.mjs --run-id <run> undoes it); writes
 *          `ocr` with a gemini-engine/1 block (api: 'cli', the CLI's name and version, the prompt sent, the image
 *          read); leaves a sweep_log row per page and one book_events row per book.
 *
 * THE CALL (#6523, tuned on a fixed dev set of Latin and Early English pages): the prompt asks for the transcription
 * between <<<BEGIN>>> / <<<END>>> markers and nothing outside them, and a PreToolUse hook in the page's workspace
 * (scripts/lib/agy-tool-gate.py) denies every tool but view_file on the image, with a reason, so the turn goes on to
 * the transcription instead of ending empty. The raw reply is kept as <page_id>.raw.txt; .txt holds the text between
 * the markers. A reply with text outside the markers or cut before <<<END>>> is read once more, then never written.
 *
 * HOW IT FAILS: a CLI that is not signed in, or a refusal, leaves an empty .txt and a non-zero `exit` in the meta;
 * `apply` skips those and says so. Nothing is retried silently. A quota reply (or a model locked until its reset)
 * sleeps and tries the same page again, which suits a person at the desk; `read --stop-on-quota` exits 3 instead, so
 * a scheduled caller (cli-ocr-lane.mjs) stops cleanly and the next run resumes from the pages already read (#7089).
 *
 * CORRECT MODE (#6560, the Yigdzin Tibetan pass): `read --correct-prompt=FILE --lane=ID` sends FILE's text with
 * `{draft}` replaced by the page's stored OCR, then ` @./<page>.jpg` (the #6560 eval's exact request, as
 * run-cli-arm.py built it), and keeps the prompt sent as <page_id>.prompt.txt. `apply` then takes the reply as plain
 * text (no <page-type> header), refuses a correction that changes over 25% of the draft's syllables or one whose
 * draft was rewritten since the read, and runs the ya-btags guard (scripts/lib/tibetan-yatags-guard.mjs): a page with
 * a ya-btags change under མ is held until `--yatags-verdicts=FILE` (JSONL {page_id, hits, keep}) carries a leaf
 * check for it, and every change the check did not confirm is put back to the draft before the write. The write
 * stamps `ocr.pipeline` with the lane id and keeps the draft's `language` and `verdict`; the draft read is named in
 * `engine.input.draft`.
 * `--draft-file=FILE` (eval only, #7263): JSON {page_id: text} supplies the draft instead of the stored OCR (e.g. a GPU
 * engine's read kept on disk). The meta records `draft.source: 'file'`, and apply refuses such a read.
 *
 * GPU DRAFT (#7263, route C: PERO draft -> agy Flash-low with the image, for Latin print with no OCR yet):
 * `read --correct-prompt=FILE --lane=ID --gpu-draft=FILE` takes the draft from a GPU engine's output on disk
 * (scripts/batch/pero-draft.py: {_engine, <page_id>: {text, image_sha256}}) for a page that has NO stored OCR. The
 * read refuses a page that has OCR, a draft under 30 word characters (the TEST's own floor), and a draft made from other
 * image bytes than the ones the corrector is sent. It keeps the draft as <page_id>.draft.txt; the meta records
 * `draft.source: 'gpu'` with the engine block. `apply` writes such a read only while the page still has no OCR, with the
 * plain read's header checks (the draft has no header), not the 25% refuse: instead it records the share of the draft's
 * words the corrector changed (scripts/lib/draft-change-share.mjs, the TEST's T3) in `engine.input.draft.change_share`
 * and sets `engine.input.draft.check_flag` at >= 27% (Derek, 2026-10-28), which the lane-judge sampler always judges.
 * UNCHANGED leaves the page unread (a headerless draft is not what was judged); a page the corrector tags handwritten
 * or mixed is not written (the route is print only).
 * `read --over-stored` (#7567 arm c): the same read for a page that HAS a stored draft (the lane sends Flash-Lite drafts
 * of Latin and Italian print); the read records the stored text it replaces (`draft.replaces`). `apply` writes it only
 * while the page still holds that exact text, through the plain read's 40% shared-words floor against it, and then the
 * E3 guards against it (scripts/lib/correction-diff-guard.mjs): the long-s pass, and every flagged number, negation or
 * expansion change put back to the stored reading, counted in `engine.input.draft.diff_guard`. The unread-only path
 * (no --over-stored) is unchanged.
 *
 * RE-READ LANE GATE (#6769, Gemini 4 Argon low over Greek manuscripts and Rashi books): `apply --lane=ID
 * --lane-gate=FILE` replaces the 40% shared-words floor — which compares the read with the bad read it replaces — by a
 * per-BOOK verdict (scripts/batch/reread-gate.mjs: 30 random pages judged blind against the image by Opus through
 * `claude -p`, 0 worse, 5/5 planted controls caught). A failed or mismatched gate writes nothing; every other guard
 * stays. The write stamps `ocr.pipeline` with the lane and the gate (verdict, sample, judge run, file hashes) in
 * `engine.input.lane_gate`. `read --instruction-file=F` appends F's text to the prompt; it is kept as
 * prompt-extra.txt and is part of the prompt hashed. (Tried on #6769 with a Hebrew right-column-first rule: G4L then
 * read the left column first on 15/23 two-column pages, against 6/23 without it. Measure an instruction before using it.)
 *
 * FIRST READS (#7701, cli-ocr-lane.mjs run --cohort): `apply --lane=ID --first-read-only --print-only` stamps a plain
 * read's `ocr.pipeline` with the lane, writes it only while the page still has no OCR, and only when the read's own
 * <script> tag says printed.
 *
 * BY-EYE CHECK (#6865): `apply --by-eye=FILE` (JSONL, one row per page: {page_id, read_sha256, verdict, checked_by, at,
 * note}) lifts the 40% shared-words floor for exactly the pages a person or session opened against the image, when a
 * book has too few refused pages for a lane gate (it needs 10). `verdict` must be 'read-matches-image'; a row whose
 * read_sha256 is not the read in the directory lifts nothing. Every other guard stays, and the row is written into
 * `engine.input.by_eye`.
 *
 * KEPT AND REUSED (#7075, scripts/lib/candidate-reads.mjs): every usable read is copied to R2 candidate-reads/ the
 * moment it is made. Before calling, `read` asks for a kept read of the same page by the same model on the same prompt
 * sent and the same image bytes (correct mode: the same draft, in the prompt), and uses it instead of calling; the meta
 * then carries `reused_from`. `--fresh` always calls (a repeat-noise eval needs fresh reads; kept ones are its noise).
 *
 * SEVERAL PAGES A CALL (#7522): `read --per-call=N` (2-8; default 1, the one-page call above, unchanged) sends up to N
 * consecutive pages of one book (in the page-ids file's order; a gap or a new book starts a new call) in ONE agy call:
 * the images under neutral names p01.jpg … in one workspace, the live prompt, then the block wrapper (agy-cli.mjs
 * ocrBlockInstruction) asking for each page between <<<PAGE n BEGIN>>> / <<<PAGE n END>>>. The reply is split ONLY by
 * those markers (splitPageBlocks): a reply missing, repeating or reordering any page's markers, or with text outside
 * them, is refused whole, retried once as a block, then each of its pages is read one per call on the ordinary
 * prompt. A page of an accepted block that fails the chatter or write guard is read again alone. The prompt sent is
 * kept as prompts/<hash>.txt (apply hashes it); the whole reply as raw/<call id>.txt; each page's meta carries the
 * call (call_id, call_pages, call_position, per_call) and the call's agy usage, and the kept-read variant names the
 * call's page count, so a 1/call read and an N/call read never stand in for each other. A one-page remainder is read
 * on the one-page prompt.
 * With `--correct-prompt` (#7701 arm C) the block is a CORRECTION of N consecutive drafted pages: the template up to
 * its one-page correction paragraph, then each page's draft between DRAFT n START / DRAFT n END and the same three
 * answers per page (agy-cli.mjs correctBlockPrompt), split by the same markers. Each page's meta is a correct-mode meta
 * (mode, lane, draft) pointing at the whole prompt sent, so `apply` runs every correct-mode guard page by page,
 * unchanged. A page with no draft is not sent and breaks the run.
 *
 * ALWAYS, in every mode (scripts/lib/reread-lane-gate.mjs): a page whose text is an open edition fitted to the scan
 * (Sefaria, Esukhia Derge, CBETA) is never overwritten, and a read with 3+ letters of a script that is not the book's
 * (#6560: Kannada in a Tibetan correction) is refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { readPageIdsFile } from '../lib/ocr-targeting.mjs';
import { writePageText, textHash } from '../lib/page-text-writer.mjs';
import { geminiEngine, engineNameForCli, imageInput, ocrProvenance, notRecorded, contentHash, codeVersion, host } from '../lib/write-provenance.mjs';
import { liftOcrTags, parseDetectedImages } from '../lib/ocr-result-parse.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { ocrReadProblem, OCR_SENTINEL_INSTRUCTION } from '../lib/cli-chatter.mjs';
import { recordFailedReads, fromCliRead } from '../lib/ocr-failed-read.mjs';
import { CLI, CLI_SAFE_ARGS, agyCall, agyUsage, installToolGate, gateCalls, unwrapRead, ocrBlockInstruction, splitPageBlocks, pageBlockFile, OCR_READ_FILE_INSTRUCTION, correctBlockPrompt } from '../lib/agy-cli.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { markTranslationsStale } from '../lib/syriac-kraken-lane.mjs';
import { liveOcrPrompt } from '../lib/live-ocr-prompt.mjs';
import { diffSyllables, alignSyllables, yatagsHits, revertHits } from '../lib/tibetan-yatags-guard.mjs';
import { checkWrittenText, writeGuardReason, correctionHeaderProblem } from '../lib/write-text-guard.mjs';
import { fittedTextReason, foreignScriptReason, bookLanguages, gateUsable, gateProvenance, sha256 } from '../lib/reread-lane-gate.mjs';
import { keepRead, findRead, reuseInto, reuseHash, wantsFresh } from '../lib/candidate-reads.mjs';
import { laneForWrite } from '../lib/lanes.mjs';
import { recordLaneBooks, laneJob } from '../lib/lane-book-list.mjs';
import { unsplitReadRefusal } from '../lib/pipeline-hold.mjs';
import { changeShare, CHECK_FLAG_SHARE } from '../lib/draft-change-share.mjs';
import { correctionDiffs, applyDiffVerdicts, longSPass, LANG_OF } from '../lib/correction-diff-guard.mjs';

const CALL_SITE = 'scripts/batch/cli-ocr.mjs';
const STAGE = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
const MODEL = arg('model') || 'gemini-3.8-flash-low';
const APPLY = process.argv.includes('--apply');
const CORRECT_PROMPT = arg('correct-prompt');
const LANE = arg('lane');
const INSTRUCTION_FILE = arg('instruction-file');
const LANE_GATE_FILE = arg('lane-gate');
if (STAGE === 'read' && INSTRUCTION_FILE && CORRECT_PROMPT) { console.error('--instruction-file is for a plain read, not --correct-prompt'); process.exit(2); }
if (STAGE === 'apply' && LANE_GATE_FILE && !LANE) { console.error('--lane-gate needs --lane=<id>: the lane the gate was made for and the pages are stamped with'); process.exit(2); }
const DRAFT_FILE = arg('draft-file');
if (STAGE === 'read' && DRAFT_FILE && !CORRECT_PROMPT) { console.error('--draft-file is for --correct-prompt'); process.exit(2); }
const GPU_DRAFT = arg('gpu-draft');
if (STAGE === 'read' && GPU_DRAFT && (!CORRECT_PROMPT || DRAFT_FILE)) { console.error('--gpu-draft is for --correct-prompt, without --draft-file'); process.exit(2); }
// --image-dir=DIR (with --gpu-draft): the page images the GPU engine read, DIR/<page_id>.jpg, sent instead of a fresh
// fetch. The image host can serve the same URL as different JPEG bytes from one request to the next (two variants of
// archived/<book>/12.jpg, 2026-10-28), so a re-fetch is not the image the draft was made from.
const IMAGE_DIR = arg('image-dir');
if (STAGE === 'read' && IMAGE_DIR && !GPU_DRAFT) { console.error('--image-dir is for --gpu-draft'); process.exit(2); }
// --over-stored (#7567 arm c, with --gpu-draft): the page HAS a stored draft (the lane picks Flash-Lite drafts) and the
// corrected GPU draft replaces it. The read requires stored OCR instead of refusing it, and records the stored text it
// will replace (`draft.replaces`); apply writes only while the page still holds exactly that text (see GPU DRAFT).
const OVER_STORED = process.argv.includes('--over-stored');
if (STAGE === 'read' && OVER_STORED && !GPU_DRAFT) { console.error('--over-stored is for --gpu-draft'); process.exit(2); }
if (STAGE === 'read' && CORRECT_PROMPT && !LANE) { console.error('--correct-prompt needs --lane=<id>: the ocr.pipeline the corrected pages are stamped with'); process.exit(2); }
const PER_CALL = Number(arg('per-call') || 1);
// up to 8 (#7701 german-cheaper: the read@8 arm); the lanes still cap themselves at 4 (cli-ocr-lane.mjs --per-call 1-4)
if (STAGE === 'read' && !(Number.isInteger(PER_CALL) && PER_CALL >= 1 && PER_CALL <= 8)) { console.error('--per-call must be 1 to 8'); process.exit(2); }
// --per-call with --correct-prompt (#7701 arm C): N drafts and their images in one call (agy-cli.mjs correctBlockPrompt);
// the template must carry the one-page correction paragraph that prompt replaces, or nothing is read.
if (STAGE === 'read' && PER_CALL > 1 && CORRECT_PROMPT && !correctBlockPrompt(fs.readFileSync(CORRECT_PROMPT, 'utf8'), ['a', 'b'])) { console.error(`--per-call with --correct-prompt: ${CORRECT_PROMPT} has no one-page correction paragraph to rebuild as a block`); process.exit(2); }
if (!['read', 'apply'].includes(STAGE) || !OUT) { console.error('usage: cli-ocr.mjs read|apply --out=DIR ... (see the header)'); process.exit(2); }

// The sentence that points the CLI at the image. It is part of the prompt SENT, so it is part of what is hashed.
// #6523: the reply is asked for between <<<BEGIN>>> / <<<END>>> markers (the dev rounds' winning config). A read made
// before that records no `prompt_variant` and is rebuilt with the legacy sentence, so its hash still matches at apply.
// #7558: `@./file` does NOT attach the image in `agy -p` (1.4.8): with read_file denied the model answers "the image is
// not present in the context", and stream-json input refuses image blocks ("only text"). The model sees the page only
// through its own read_file turn, so that turn is the read, not a redundant one. What a call can lose is the turn the
// model spends on a denied shell (crop) before it opens the file. `read-file-7558` (--prompt-variant) names the file and
// the one tool that works up front; the default stays sentinels-6523 unless the A/B in the experiment record says so.
const PROMPT_VARIANTS = ['sentinels-6523', 'read-file-7558'];
const PROMPT_VARIANT = arg('prompt-variant') || 'sentinels-6523';
if (STAGE === 'read' && !PROMPT_VARIANTS.includes(PROMPT_VARIANT)) { console.error(`--prompt-variant must be one of ${PROMPT_VARIANTS.join(', ')}`); process.exit(2); }
if (STAGE === 'read' && arg('prompt-variant') && CORRECT_PROMPT) { console.error('--prompt-variant is for a plain read; --correct-prompt sends its own file'); process.exit(2); }
const imageInstruction = (imagePath, variant = PROMPT_VARIANT) => (variant === 'read-file-7558'
  ? `\n\nThe page image to transcribe is the file ./${path.basename(imagePath)} in this directory. ${OCR_READ_FILE_INSTRUCTION} Then transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`
  : variant === 'sentinels-6523'
  ? `\n\nThe page image to transcribe is attached: @./${path.basename(imagePath)} Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`
  : `\n\nThe page image to transcribe is attached: @./${path.basename(imagePath)} Transcribe it. Output only the transcription in the format above, with no preamble and no commentary.\n`);
// #6523: a PreToolUse hook in the page's workspace (scripts/lib/agy-tool-gate.py) lets the model open the image with
// view_file and denies every other tool WITH A REASON, so the turn goes on to the transcription instead of ending empty
// on a denied shell or web request. It approves nothing plan mode would not; it never auto-approves a command (#6345).
// The CLI is an AGENT. Plan mode stops it running tools; without it the model sometimes tries a shell command
// (seen: cropping a Chinese page into columns in /tmp), and the auto-approve flag this script used to pass let it
// run as root on the box. Never auto-approve; tests/unit/no-cli-auto-approve.test.ts sweeps for the flag.
// The call, the gate and the marker unwrap live in scripts/lib/agy-cli.mjs, shared with cli-translate.mjs.
const workspaceImage = (key) => path.join(OUT, `ws-${key}`, `${key}.jpg`);
// Even in plan mode the model sometimes asks for a shell command (to crop the image); headless mode denies it and the
// turn ends empty with `denied_actions` set. The #6331 fix: continue THAT conversation once with this nudge
// (scripts/eval/run-cli-arm.py, same words).
const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
// The account's shared call meter (run-cli-arm.py writes the same rows): every job's calls, one line each.
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const JOB = arg('job') || 'cli-ocr';
const logCall = (row) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: JOB, kind: 'ocr', ...row }) + '\n'); } catch { /* the meter is advisory */ } };
// The reuse key of a read (#7075): the prompt sent (it names the page's image file, and in correct mode carries the
// draft), the image bytes, and the mode. `readReuseKey` rebuilds it from a kept meta for reads kept before readers
// stamped their own.
// A read made N pages a call (#7522) carries the call's page count in its variant: it never stands in for a 1/call read.
const variantOf = (mode, lane, promptVariant, callPages = 1) => (mode === 'correct' ? `correct:${lane}${callPages > 1 ? `:per_call=${callPages}` : ''}` : callPages > 1 ? `${promptVariant}:per_call=${callPages}` : promptVariant ?? null);
const readReuseKey = (m) => (m.cli === CLI ? reuseHash({ field: 'ocr', prompt: m.prompt_sent_hash, input: m.image_sha256, variant: variantOf(m.mode, m.lane, m.prompt_variant, m.call_pages ?? 1) }) : null);
const FRESH = wantsFresh();
// --reuse-only (#7075): hand back kept reads, never call the model. Used by scripts/lib/kept-read-reuse.mjs before a
// paid lane buys a page that a free read already covers.
const REUSE_ONLY = process.argv.includes('--reuse-only');
if (REUSE_ONLY && FRESH) { console.error('--reuse-only and --fresh contradict each other'); process.exit(2); }
let noKept = 0;

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');

if (STAGE === 'read') {
  const ids = readPageIdsFile(arg('page-ids-file'));
  fs.mkdirSync(OUT, { recursive: true });
  let base, ref;
  if (CORRECT_PROMPT) {
    // Each page's prompt carries its own draft, so there is no shared base: apply reads <page_id>.prompt.txt.
    base = fs.readFileSync(CORRECT_PROMPT, 'utf8');
    if (!base.includes('{draft}')) { console.error(`${CORRECT_PROMPT} has no {draft} slot`); process.exit(2); }
    ref = { id: `correct:${path.basename(CORRECT_PROMPT)}`, name: `correction prompt ${path.basename(CORRECT_PROMPT)}`, version: contentHash(base), lane: LANE };
    fs.writeFileSync(path.join(OUT, 'correct-prompt-template.txt'), base);
  } else {
    ({ base, ref } = await liveOcrPrompt(db));
    fs.writeFileSync(path.join(OUT, 'prompt-base.txt'), base);
  }
  // --instruction-file: text appended after the live prompt (e.g. #6769's right-column-first rule for Hebrew).
  const extra = INSTRUCTION_FILE ? `\n\n${fs.readFileSync(INSTRUCTION_FILE, 'utf8').trim()}` : '';
  if (extra) fs.writeFileSync(path.join(OUT, 'prompt-extra.txt'), extra);
  fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify(ref));
  // A reuse-only run makes no call, so it does not need the CLI installed (a cron PATH may not have it).
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim() || (REUSE_ONLY ? 'not needed (reuse-only)' : '');
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  const found = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1, ...(CORRECT_PROMPT && { 'ocr.data': 1, 'ocr.content_hash': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.pipeline': 1 }) } }).toArray();
  // Split before read (#7605): a page of an unsplit spread book is never sent; the lane's book list is not the only caller.
  const spreadBooks = new Map((await db.collection('books').find({ id: { $in: [...new Set(found.map((p) => p.book_id))] } }, { projection: { id: 1, needs_splitting: 1, split_completed: 1 } }).toArray()).map((b) => [b.id, b]));
  const pages = found.filter((p) => { const why = unsplitReadRefusal(spreadBooks.get(p.book_id), p); if (why) console.log(`  ${p.book_id} p.${p.page_number} not read: ${why}`); return !why; });
  if (DRAFT_FILE) {
    const drafts = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8'));
    for (const p of pages) p.ocr = drafts[p.id] ? { data: drafts[p.id], model: `file:${path.basename(DRAFT_FILE)}`, pipeline: null, content_hash: contentHash(drafts[p.id]), updated_at: null, source: 'file' } : null;
  }
  if (GPU_DRAFT) {
    // Route C (#7263): the draft is a GPU engine's read of a page with no OCR. A page that has OCR is not this route's.
    const drafts = JSON.parse(fs.readFileSync(GPU_DRAFT, 'utf8'));
    const eng = drafts._engine;
    if (!eng?.name || !eng?.model) { console.error(`${GPU_DRAFT} has no _engine block`); process.exit(2); }
    for (const p of pages) {
      const d = drafts[p.id];
      if (OVER_STORED && !p.ocr?.data?.trim()) { console.log(`  ${p.page_number} has no stored OCR: --over-stored replaces a stored draft; skipped`); p.ocr = null; continue; }
      if (!OVER_STORED && p.ocr?.data?.trim()) { console.log(`  ${p.page_number} has OCR: the GPU-draft route is for unread pages; skipped`); p.ocr = null; continue; }
      if (!d?.text || d.text.replace(/\W/g, '').length < 30) { console.log(`  ${p.page_number} GPU draft under 30 word characters; skipped`); p.ocr = null; continue; }
      const replaces = OVER_STORED ? { model: p.ocr.model ?? null, pipeline: p.ocr.pipeline ?? null, content_hash: p.ocr.content_hash ?? null, text_hash: contentHash(p.ocr.data), updated_at: p.ocr.updated_at ?? null } : null;
      p.ocr = { data: d.text, model: `${eng.name}/${eng.model}`, pipeline: null, content_hash: contentHash(d.text), updated_at: null, source: 'gpu', gpu: { engine: eng, image_sha256: d.image_sha256, regions: d.regions, lines: d.lines, ...(replaces && { replaces }) } };
    }
  }
  const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('concurrency') || 1)));
  const QUOTA_SLEEP_S = Number(arg('quota-sleep') || 1800);
  const STOP_ON_QUOTA = process.argv.includes('--stop-on-quota');
  const stopOnQuota = async (p, why) => { console.error(`QUOTA at p.${p.page_number}: stopping (--stop-on-quota). ${why}`); await client.close(); process.exit(3); };
  console.log(`${pages.length} of ${ids.length} page ids found; model ${MODEL}; ${CLI} ${version}; ${CONCURRENCY} at a time`);
  // The job's book list, recorded with the job for the lane registry (#7301 item 5): no page or book is written.
  await recordLaneBooks(db, { lane: laneForWrite('ocr', { call_site: CALL_SITE, name: engineNameForCli(CLI) }), ...laneJob(arg('job')), pages });
  let quotaUntil = 0, reused = 0;
  // What a correction read records of the draft it was sent (apply checks it against the stored OCR / the GPU draft file).
  const draftMeta = (p) => ({ ...(p.ocr.source === 'file' && { source: 'file' }), ...(p.ocr.source === 'gpu' && { source: 'gpu', file: `${p.id}.draft.txt`, ...p.ocr.gpu }), model: p.ocr.model, pipeline: p.ocr.pipeline ?? null, content_hash: p.ocr.content_hash ?? contentHash(p.ocr.data), text_hash: contentHash(p.ocr.data), updated_at: p.ocr.updated_at });
  // `from`: the block call (#7522) whose refusal or guard sent this page to be read alone, recorded in its meta.
  const readOne = async (p, from = null) => {
    const key = p.id;
    if (fs.existsSync(path.join(OUT, `${key}.meta.json`)) && fs.readFileSync(path.join(OUT, `${key}.txt`), 'utf8').length > 5) { console.log(`  ${p.page_number} already read`); return; }
    // The page's own image, split-aware (#6420): on a page split from a spread `archived_photo` is the WHOLE spread,
    // and a read of it transcribes both pages onto one. getPageSource() is the resolver the OCR lanes use.
    if (CORRECT_PROMPT && !p.ocr?.data?.trim()) { console.log(`  ${p.page_number} has no stored OCR to correct; skipped`); return; }
    const src = getPageSource(p);
    if (!src) { console.log(`  ${p.page_number} has no usable image; skipped`); return; }
    const local = IMAGE_DIR && p.ocr?.source === 'gpu' ? path.join(IMAGE_DIR, `${p.id}.jpg`) : null;
    if (local && !fs.existsSync(local)) { console.log(`  ${p.page_number} not in --image-dir; skipped`); return; }
    const res = local ? null : await fetch(src);
    if (res && !res.ok) { console.log(`  ${p.page_number} image HTTP ${res.status}; skipped`); return; }
    const buf = local ? fs.readFileSync(local) : Buffer.from(await res.arrayBuffer());
    if (p.ocr?.source === 'gpu') {
      // The corrector must see the image the draft was made from, or its "the image is the authority" is about another scan.
      if (createHash('sha256').update(buf).digest('hex') !== p.ocr.gpu.image_sha256) { console.log(`  ${p.page_number} the GPU draft was made from other image bytes; skipped`); return; }
      fs.writeFileSync(path.join(OUT, `${key}.draft.txt`), p.ocr.data);
    }
    // One directory per page, so the CLI's workspace holds exactly the one image it is asked to read.
    const img = workspaceImage(key);
    fs.mkdirSync(path.dirname(img), { recursive: true });
    fs.writeFileSync(img, buf);
    // Correct mode: the #6560 request exactly — template with the draft in its slot, then the attachment.
    const sent = CORRECT_PROMPT ? `${base.split('{draft}').join(p.ocr.data)} @./${path.basename(img)}` : base + extra + imageInstruction(img);
    if (CORRECT_PROMPT) fs.writeFileSync(path.join(OUT, `${key}.prompt.txt`), sent);
    const imageSha = createHash('sha256').update(buf).digest('hex');
    const reuseKey = reuseHash({ field: 'ocr', prompt: contentHash(sent), input: imageSha, variant: variantOf(CORRECT_PROMPT ? 'correct' : null, LANE, PROMPT_VARIANT) });
    if (!FRESH) {
      const hit = await findRead({ page_id: p.id, book_id: p.book_id, field: 'ocr', model: MODEL, prompt_hash: reuseKey, derive: readReuseKey });
      if (hit && await reuseInto(OUT, key, hit)) { reused++; console.log(`  ${p.page_number} reused a kept read (${hit.body.job ?? '?'}, ${hit.body.read_at?.slice(0, 10) ?? '?'}): no call`); return; }
    }
    // --reuse-only (#7075): a paid lane hands its pages here first; a page with no kept read is left to that lane.
    if (REUSE_ONLY) { noKept++; return; }
    const gateLog = installToolGate(path.dirname(img));
    const t0 = new Date();
    // Attempt 1; a denied tool continues that conversation once with the nudge; a reply that fails the chatter guard
    // (plan note, refusal, restarted or duplicated read) is read once more from scratch (#6420 rule 4). A quota error
    // sleeps until the window resets and tries the same page again: it is the account's limit, not the page's.
    let r, nudged = false, rereads = 0, calls = 0;
    // agy's own token counts, one entry per call made for this page (#7517: what a page costs the account's pool).
    const usage = [];
    for (;;) {
      while (Date.now() < quotaUntil) await new Promise((s) => setTimeout(s, 30_000));
      r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], path.dirname(img));
      // A locked model is not called (agy-cli.mjs → model-limits.mjs): sleep to its quoted reset, not a fixed 30 min.
      if (r.not_called && STOP_ON_QUOTA) await stopOnQuota(p, `locked until ${r.locked_until || '?'}: ${r.err}`);
      if (r.not_called) { quotaUntil = Math.max(Date.now() + 60_000, Date.parse(r.locked_until || '') || Date.now() + QUOTA_SLEEP_S * 1000); console.log(`  LOCKED at p.${p.page_number}: no call until ${new Date(quotaUntil).toISOString()}`); continue; }
      calls++; usage.push(agyUsage(r.usage));
      logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls });
      if (r.cls === 'quota' && STOP_ON_QUOTA) await stopOnQuota(p, r.err);
      if (r.cls === 'quota') { quotaUntil = Date.now() + QUOTA_SLEEP_S * 1000; console.log(`  QUOTA at p.${p.page_number}: sleeping ${QUOTA_SLEEP_S}s`); continue; }
      if (r.cls === 'denied_tool' && r.conversation && !nudged) {
        nudged = true;
        r = await agyCall(['-p', NUDGE, '--model', MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], path.dirname(img)); calls++; usage.push(agyUsage(r.usage));
        logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls });
      }
      // #5055: a read the write guard calls truncated (a tag left open at its tail, a text ending inside a tag) is read
      // once more too; apply refuses it if the second read is cut as well.
      if (!r.cls && (unwrapRead(r.text).problem || ocrReadProblem(unwrapRead(r.text).text, { header: !CORRECT_PROMPT }) || checkWrittenText(unwrapRead(r.text).text, { kind: 'ocr' }).verdict === 'truncated') && rereads === 0) { rereads++; continue; }
      break;
    }
    // The raw reply is kept beside the transcription; `.txt` holds only what was between the markers.
    const { text, problem: wrapper } = unwrapRead(r.text);
    fs.writeFileSync(path.join(OUT, `${key}.raw.txt`), r.text);
    fs.writeFileSync(path.join(OUT, `${key}.txt`), text);
    const meta = {
      page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, model: MODEL,
      started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: r.code === null ? -9 : r.code, error_class: r.cls,
      chars: text.length, nudged, rereads, calls, usage, chatter: text ? ocrReadProblem(text, { header: !CORRECT_PROMPT }) : null,
      write_guard: text ? checkWrittenText(text, { kind: 'ocr' }).verdict : null,
      prompt_variant: PROMPT_VARIANT, wrapper, tool_calls: gateCalls(gateLog),
      image_url: src, image_bytes: buf.length, image_sha256: imageSha,
      prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), stderr_tail: r.err, ...(extra && { prompt_extra_hash: contentHash(extra) }),
      ...(from && { per_call: PER_CALL, block_fallback: from }),
      ...(CORRECT_PROMPT && { mode: 'correct', lane: LANE, prompt_sent_file: `${key}.prompt.txt`, draft: draftMeta(p) }),
    };
    fs.writeFileSync(path.join(OUT, `${key}.meta.json`), JSON.stringify(meta, null, 1));
    // Kept the moment it is paid for (#7075); best effort, never fails the read.
    if (meta.exit === 0 && !meta.error_class && !meta.wrapper) await keepRead({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, field: 'ocr', text, model: MODEL, prompt_hash: reuseKey, job: JOB, meta, prompt_text: CORRECT_PROMPT ? sent : null, source_path: path.join(OUT, `${key}.txt`) });
    console.log(`  ${p.page_number} ${r.cls || 'ok'}${nudged ? ' (nudged)' : ''}${rereads ? ' (re-read)' : ''} ${text.length} chars ${Math.round((Date.now() - t0) / 1000)}s`);
  };
  // ── --per-call=N (#7522): several consecutive pages of one book in one call ──
  const fetchImage = async (p) => {
    const src = getPageSource(p);
    if (!src) return { error: 'has no usable image' };
    // A GPU draft is corrected against the image it was made from (--image-dir), as readOne does.
    const local = IMAGE_DIR && p.ocr?.source === 'gpu' ? path.join(IMAGE_DIR, `${p.id}.jpg`) : null;
    if (local && !fs.existsSync(local)) return { error: 'not in --image-dir' };
    const res = local ? null : await fetch(src);
    if (res && !res.ok) return { error: `image HTTP ${res.status}` };
    const buf = local ? fs.readFileSync(local) : Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    if (p.ocr?.source === 'gpu' && sha !== p.ocr.gpu.image_sha256) return { error: 'the GPU draft was made from other image bytes' };
    return { src, buf, sha };
  };
  // Correct mode (#7701 arm C): the block carries each page's draft, so the prompt is the group's, not the count's.
  const blockPrompt = (n, group) => (CORRECT_PROMPT ? correctBlockPrompt(base, group.map((q) => q.ocr.data)) : base + extra + ocrBlockInstruction(n, { variant: PROMPT_VARIANT }));
  const blockReuseKey = (sent, imageSha, n) => reuseHash({ field: 'ocr', prompt: contentHash(sent), input: imageSha, variant: variantOf(CORRECT_PROMPT ? 'correct' : null, LANE, PROMPT_VARIANT, n) });
  /** One block call. Returns the pages to read again one per call ([] when every page was kept), or null when the call was refused whole. */
  const readBlock = async (group, imgs, attempt) => {
    const n = group.length, first = group[0], last = group[n - 1];
    const sent = blockPrompt(n, group);
    const sentHash = contentHash(sent);
    const promptFile = path.join('prompts', `${sentHash}.txt`);
    fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
    if (!fs.existsSync(path.join(OUT, promptFile))) fs.writeFileSync(path.join(OUT, promptFile), sent);
    const callId = `${JOB}-${first.book_id}-${first.page_number}-${n}-${attempt}`;
    // One workspace per call, holding exactly this call's images under neutral names.
    const ws = path.join(OUT, `ws-call-${callId}`);
    fs.rmSync(ws, { recursive: true, force: true });
    fs.mkdirSync(ws, { recursive: true });
    imgs.forEach((im, i) => fs.writeFileSync(path.join(ws, pageBlockFile(i)), im.buf));
    const gateLog = installToolGate(ws);
    const t0 = new Date();
    let r, nudged = false, calls = 0;
    const usage = [];
    for (;;) {
      while (Date.now() < quotaUntil) await new Promise((s) => setTimeout(s, 30_000));
      r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], ws);
      if (r.not_called && STOP_ON_QUOTA) await stopOnQuota(first, `locked until ${r.locked_until || '?'}: ${r.err}`);
      if (r.not_called) { quotaUntil = Math.max(Date.now() + 60_000, Date.parse(r.locked_until || '') || Date.now() + QUOTA_SLEEP_S * 1000); console.log(`  LOCKED at p.${first.page_number}: no call until ${new Date(quotaUntil).toISOString()}`); continue; }
      calls++; usage.push(agyUsage(r.usage));
      logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls, pages: n });
      if (r.cls === 'quota' && STOP_ON_QUOTA) await stopOnQuota(first, r.err);
      if (r.cls === 'quota') { quotaUntil = Date.now() + QUOTA_SLEEP_S * 1000; console.log(`  QUOTA at p.${first.page_number}: sleeping ${QUOTA_SLEEP_S}s`); continue; }
      if (r.cls === 'denied_tool' && r.conversation && !nudged) {
        nudged = true;
        r = await agyCall(['-p', NUDGE, '--model', MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws); calls++; usage.push(agyUsage(r.usage));
        logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls, pages: n });
      }
      break;
    }
    const texts = r.cls ? null : splitPageBlocks(r.text, n);
    fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'raw', `${callId}.txt`), r.text);   // the whole reply, so a refused call can be read
    const tools = gateCalls(gateLog);
    fs.appendFileSync(path.join(OUT, 'calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), call_id: callId, book_id: first.book_id, pages: group.map((p) => p.page_number), page_ids: group.map((p) => p.id), model: MODEL, secs: Math.round((Date.now() - t0) / 1000), cls: r.cls || (texts ? null : 'page_markers_mismatch'), calls, nudged, usage, tool_calls: tools }) + '\n');
    if (!texts) { console.log(`  p.${first.page_number}-${last.page_number}: ${r.cls || 'page markers do not match: call refused'} (${Math.round((Date.now() - t0) / 1000)}s)`); return null; }
    const redo = [];
    for (const [i, p] of group.entries()) {
      const text = texts[i];
      // A correction's UNCHANGED / CONTAIN answer is not a transcription: no chatter or cut-text check (readOne: the same).
      const answer = CORRECT_PROMPT && /^(UNCHANGED\.?|CONTAIN\s*:[\s\S]*)$/i.test(text);
      const chatter = answer ? null : ocrReadProblem(text, { header: !CORRECT_PROMPT || p.ocr?.source === 'gpu' });
      const guard = checkWrittenText(text, { kind: 'ocr' }).verdict;
      // A page of the block that reads as chatter or a cut text is read again alone, not written from this call.
      if (chatter || (!answer && guard === 'truncated')) { redo.push(p); continue; }
      if (p.ocr?.source === 'gpu') fs.writeFileSync(path.join(OUT, `${p.id}.draft.txt`), p.ocr.data);
      fs.writeFileSync(path.join(OUT, `${p.id}.raw.txt`), text);
      fs.writeFileSync(path.join(OUT, `${p.id}.txt`), text);
      const meta = {
        page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, model: MODEL,
        started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: r.code === null ? -9 : r.code, error_class: null,
        chars: text.length, nudged, rereads: attempt, calls, usage, chatter: null, write_guard: guard,
        prompt_variant: PROMPT_VARIANT, per_call: PER_CALL, call_id: callId, call_pages: n, call_position: i + 1, call_page_ids: group.map((q) => q.id),
        wrapper: null, tool_calls: tools, image_url: imgs[i].src, image_bytes: imgs[i].buf.length, image_sha256: imgs[i].sha, image_file: path.join(path.basename(ws), pageBlockFile(i)),
        prompt_sent_chars: sent.length, prompt_sent_hash: sentHash, prompt_sent_file: promptFile, stderr_tail: r.err, ...(extra && !CORRECT_PROMPT && { prompt_extra_hash: contentHash(extra) }),
        ...(CORRECT_PROMPT && { mode: 'correct', lane: LANE, draft: draftMeta(p) }),
      };
      fs.writeFileSync(path.join(OUT, `${p.id}.meta.json`), JSON.stringify(meta, null, 1));
      // Kept the moment it is paid for (#7075), keyed on this call's page count; best effort, never fails the read.
      await keepRead({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, field: 'ocr', text, model: MODEL, prompt_hash: blockReuseKey(sent, imgs[i].sha, n), job: JOB, meta, prompt_text: sent, source_path: path.join(OUT, `${p.id}.txt`) });
    }
    console.log(`  p.${first.page_number}-${last.page_number}: ok ${texts.map((t) => t.length).join('/')} chars${redo.length ? `; ${redo.length} to read alone (guard)` : ''} (${Math.round((Date.now() - t0) / 1000)}s)`);
    return redo;
  };
  const readGroup = async (group) => {
    if (group.length === 1) return readOne(group[0], PER_CALL > 1 ? 'remainder' : null);
    const imgs = [];
    for (const p of group) {
      const im = await fetchImage(p);
      if (im.error) { console.log(`  ${p.page_number} ${im.error}: its call's ${group.length} pages are read one per call`); for (const q of group) await readOne(q, 'image'); return; }
      imgs.push(im);
    }
    // A block's kept reads are used only when every page of it has one at this page count; otherwise the block is called.
    if (!FRESH) {
      const sent = blockPrompt(group.length, group);
      const hits = [];
      for (const [i, p] of group.entries()) hits.push(await findRead({ page_id: p.id, book_id: p.book_id, field: 'ocr', model: MODEL, prompt_hash: blockReuseKey(sent, imgs[i].sha, group.length), derive: readReuseKey }));
      if (hits.every(Boolean)) {
        let all = true;
        for (const [i, p] of group.entries()) all = (await reuseInto(OUT, p.id, hits[i])) && all;
        if (all) { reused += group.length; console.log(`  p.${group[0].page_number}-${group[group.length - 1].page_number} reused kept reads: no call`); return; }
      }
    }
    if (REUSE_ONLY) { noKept += group.length; return; }
    let redo = await readBlock(group, imgs, 0);
    if (redo === null) redo = await readBlock(group, imgs, 1);
    // Still refused: each page alone, so one hard page does not cost its neighbours.
    const from = redo === null ? 'refused' : 'guard';
    for (const p of redo ?? group) await readOne(p, from);
  };
  let groups = pages.map((p) => [p]);
  if (PER_CALL > 1) {
    // Runs of consecutive pages of one book in the page-ids file's order (a gap or a new book starts a run), cut into calls.
    const order = new Map(ids.map((id, i) => [id, i]));
    const isRead = (p) => { try { return fs.existsSync(path.join(OUT, `${p.id}.meta.json`)) && fs.readFileSync(path.join(OUT, `${p.id}.txt`), 'utf8').length > 5; } catch { return false; } };
    const runs = [];
    for (const p of [...pages].sort((a, b) => order.get(a.id) - order.get(b.id))) {
      if (isRead(p)) { console.log(`  ${p.page_number} already read`); continue; }
      // Correct mode: a page with no draft is not corrected, and it breaks the run (its neighbours are not consecutive).
      if (CORRECT_PROMPT && !p.ocr?.data?.trim()) { console.log(`  ${p.page_number} has no draft to correct; skipped`); runs.push([]); continue; }
      const run = runs[runs.length - 1], prev = run?.[run.length - 1];
      if (prev && prev.book_id === p.book_id && prev.page_number + 1 === p.page_number) run.push(p); else runs.push([p]);
    }
    groups = runs.filter((run) => run.length).flatMap((run) => Array.from({ length: Math.ceil(run.length / PER_CALL) }, (_, i) => run.slice(i * PER_CALL, (i + 1) * PER_CALL)));
    console.log(`--per-call=${PER_CALL}: ${groups.length} calls planned (${groups.filter((g) => g.length > 1).length} of several pages)`);
  }
  const queue = [...groups];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await readGroup(queue.shift()); }));
  console.log(`reused ${reused} kept read(s) instead of calling${FRESH ? ' (--fresh: none looked up)' : ''}`);
  if (REUSE_ONLY) console.log(`reuse-only: ${noKept} page(s) had no matching kept read and were not called`);
  await client.close();
  process.exit(0);
}

// ── apply ──
const REASON = arg('reason');
if (!REASON) { console.error('--reason is required: say why these pages are being re-read'); process.exit(2); }
// A Gemini read dir has prompt-base.txt (one prompt for every page); a claude-ocr.mjs read dir has none, because each
// call's prompt names its own page count and language: its meta points at the exact text sent (`prompt_sent_file`).
const basePath = path.join(OUT, 'prompt-base.txt');
const base = fs.existsSync(basePath) ? fs.readFileSync(basePath, 'utf8') : null;
const ref = JSON.parse(fs.readFileSync(path.join(OUT, 'prompt-ref.json'), 'utf8'));
// --only=FILE: apply just these page ids (a JSON array, as --page-ids-file) out of a read directory, e.g. the pages an
// adjudicator picked (scripts/batch/ocr-convergence/driver.mjs). Without it every read in OUT is a candidate.
const ONLY = arg('only') ? new Set(readPageIdsFile(arg('only'))) : null;
// --mark-stale=<lane>: stamp `translation_stale` (#4927) on written pages that carry a translation, with this lane
// id, so the re-translation of exactly these pages can be planned and found (#6420 lane C) rather than discovered.
const MARK_STALE = arg('mark-stale');
// --first-read-only (#7701): write a plain read only while the page still has no OCR (a first read, never a re-read).
// --print-only (#7701): write a plain read only when its own <script> tag says printed (the lane is print only).
const FIRST_READ_ONLY = process.argv.includes('--first-read-only');
// --diff-guard=gpu-draft (#7701, the Latin arm-c cell): on the unread GPU-draft path, run #7695's put-back guards against
// the GPU draft (the --over-stored path runs them against the stored text it replaces).
const DIFF_GUARD_DRAFT = arg('diff-guard') === 'gpu-draft';
if (arg('diff-guard') && !DIFF_GUARD_DRAFT) { console.error('--diff-guard: the only value is gpu-draft'); process.exit(2); }
// --emit-written=FILE (#7701): one JSON line {page_id, text} for every page this apply writes (or, dry run, would write):
// the exact text, after every guard and put-back, so an eval judges what the lane writes.
const EMIT_WRITTEN = arg('emit-written');
const PRINT_ONLY = process.argv.includes('--print-only');
const metas = fs.readdirSync(OUT).filter((f) => f.endsWith('.meta.json')).map((f) => ({ key: f.replace(/\.meta\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) }))
  .filter((m) => !ONLY || ONLY.has(m.page_id ?? m.key));
const CODE_VERSION = await codeVersion();
// The pid keeps two applies started in the same second (cli-ocr-lane.mjs --concurrency, #7558) on separate run ids.
const runId = `cli-ocr-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text/im;
// Distinct words of 5+ letters, folded: enough to tell "the same page read again" from "a different text".
const longWords = (t) => new Set((String(t).replace(/<[^>]+>/g, ' ').replace(/-\n/g, '').toLowerCase().replace(/æ/g, 'ae').replace(/ſ/g, 's').replace(/v/g, 'u').match(/\p{L}{5,}/gu) || []));
const MIN_SHARED = 0.4;
// Correct mode: a correction keeps most of its draft. Over this share of the draft's syllables changed, it is a
// re-transcription (or an invention), not a correction, and a person looks first.
const MAX_CORRECTED = 0.25;
// The 25% is counted in syllables on a Tibetan draft and in words (whitespace tokens, tags out) on any other: the
// syllable tokenizer keeps only Tibetan syllables, so on Latin it counted 0 of 0 and passed every correction (#7269).
// Text lines, the <leaf-break/> marker line not counted: adding or moving the marker (a seam fix) is not a line change.
const leafLines = (t) => String(t).split('\n').filter((l) => l.trim() && !/^\s*<leaf-break\/>\s*$/.test(l)).length;
const latinLetters = (t) => (String(t).replace(/<[^>]+>/g, ' ').match(/[A-Za-z]/g) || []).length;
const wordTokens = (t) => String(t).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
function changedUnits(draft, next) {
  if (/[\u0F00-\u0FFF]/u.test(draft)) return { ...diffSyllables(draft, next), unit: 'syllables' };
  const A = wordTokens(draft), B = wordTokens(next);
  const same = alignSyllables(A, B).filter(([i, j]) => i !== null && j !== null && A[i] === B[j]).length;
  return { draftN: A.length, changed: Math.max(A.length, B.length) - same, unit: 'words' };
}
// --yatags-verdicts=FILE: the leaf checks of the ya-btags guard, one JSON row per page {page_id, hits, keep}.
const YATAGS = new Map();
if (arg('yatags-verdicts')) for (const l of fs.readFileSync(arg('yatags-verdicts'), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); YATAGS.set(r.page_id, r); }
// --lane-gate=FILE (#6769): the per-book verdict that stands in for the 40% floor. Checked once, before any page: a gate
// for another lane, book or model, a failed gate, or a judged page whose read changed since writes NOTHING.
const LANE_GATE = LANE_GATE_FILE ? JSON.parse(fs.readFileSync(LANE_GATE_FILE, 'utf8')) : null;
if (LANE_GATE) {
  const bookIds = new Set(metas.map((m) => m.book_id));
  const models = new Set(metas.map((m) => m.model));
  const why = bookIds.size !== 1 ? `the read directory holds ${bookIds.size} books; a gate is per book`
    : models.size !== 1 ? `the read directory holds ${models.size} models`
    : gateUsable(LANE_GATE, { lane: LANE, bookId: [...bookIds][0], model: [...models][0], readHash: (id) => { try { return sha256(fs.readFileSync(path.join(OUT, `${id}.txt`), 'utf8')); } catch { return null; } } });
  if (why) { console.error(`lane gate refused, nothing written: ${why}`); fs.writeFileSync(path.join(OUT, `apply-summary-${APPLY ? 'refused' : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), apply: APPLY, lane: LANE, gate_refused: why, written: 0 }, null, 1)); await client.close(); process.exit(1); }
  console.log(`lane gate ${LANE}: PASS (${LANE_GATE.sample.better} better / ${LANE_GATE.sample.same} same / ${LANE_GATE.sample.worse} worse of ${LANE_GATE.sample.n}; controls ${LANE_GATE.controls.pass}/${LANE_GATE.controls.n}) — the 40% shared-words floor is lifted for this book`);
}
const BY_EYE = new Map();
if (arg('by-eye')) for (const l of fs.readFileSync(arg('by-eye'), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); BY_EYE.set(r.page_id, r); }
const EXTRA_PATH = path.join(OUT, 'prompt-extra.txt');
const EXTRA = fs.existsSync(EXTRA_PATH) ? fs.readFileSync(EXTRA_PATH, 'utf8') : '';
const bookCache = new Map();
const bookOf = async (id) => { if (!bookCache.has(id)) bookCache.set(id, await db.collection('books').findOne({ id }, { projection: { id: 1, language: 1, original_language: 1, languages: 1, needs_splitting: 1, split_completed: 1 } })); return bookCache.get(id); };
const tally0 = { held_yatags: 0, yatags_hits: 0, yatags_kept: 0, yatags_reverted: 0 };
const tally = { written: 0, skipped: {}, ...tally0, written_page_ids: [], write_guard_repaired: 0, write_guard_refused: [], skipped_pages: {}, contain_claims: [] };
// skipped_pages: page id -> the reason, so a lane can ledger each page's outcome (cli-ocr-lane.mjs correct, #7558).
const skip = (m, why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; tally.skipped_pages[m.page_id ?? m.key] = why; console.log(`  skip p.${m.page_number}: ${why}`); };
// A read the engine did not deliver (exit, empty, refusal, a cut or chattering wrapper) is stamped on the page as a
// failed read (#7378), so the route census sees this route's did-not-read rate. Our own guards' skips are not.
const failedReads = [];
const failed = (m, why, kind) => { skip(m, why); const row = fromCliRead(m, kind, CALL_SITE); if (row) failedReads.push(row); };
const books = {};

for (const m of metas.sort((a, b) => a.page_number - b.page_number)) {
  let text = fs.readFileSync(path.join(OUT, `${m.key}.txt`), 'utf8').trim();
  const correct = m.mode === 'correct';
  // Route C (#7263): a correction of a GPU engine's draft of a page with no OCR. Its reply carries the full header.
  const gpu = correct && m.draft?.source === 'gpu';
  if (m.exit !== 0) { failed(m, `cli exit ${m.exit}`, 'exit'); continue; }
  // #6523: a reply with chatter outside the markers, or cut before <<<END>>> (often a recitation-filter cut), is not
  // written even when the text inside looks like a transcription: it is usually a partial page.
  if (m.wrapper) { failed(m, `reply wrapper: ${m.wrapper}`, 'wrapper'); continue; }
  if (text.length < 5) { failed(m, 'empty read (refusal or blank)', 'empty'); continue; }
  // A corrector answers UNCHANGED (the draft stands) or `CONTAIN: <why>` (not this leaf's text) instead of a text: the
  // #5924 template's two non-text answers, parsed as correct.mjs parseAnswer does. Neither is ever written as OCR. A
  // CONTAIN is a model's claim, not a finding: it goes to contain_claims for a by-eye check, and the page is untouched.
  if (correct && /^UNCHANGED\.?$/i.test(text)) { skip(m, gpu ? 'corrector: UNCHANGED (a headerless GPU draft is not written; the page stays unread)' : 'corrector: UNCHANGED (the draft stands)'); continue; }
  const containClaim = correct && text.match(/^CONTAIN\s*:\s*([\s\S]+)$/i);
  if (containClaim && containClaim[1].length < 600 && !/<page-type>/.test(text)) { skip(m, 'corrector: CONTAIN (a claim to check by eye)'); tally.contain_claims.push({ page_id: m.page_id ?? m.key, book_id: m.book_id, page_number: m.page_number, reason: containClaim[1].trim() }); continue; }
  if (text.length > 25000) { skip(m, 'over 25k chars'); continue; }
  if ((!correct || gpu) && !/<page-type>/.test(text)) { skip(m, 'no <page-type> tag: not a transcription in the prompt format'); continue; }
  // The CLI is an agent, not an endpoint: a refusal arrives as exit 0 with prose. Aldine 1516 p.34 came back as two
  // false starts and then "I cannot provide a verbatim transcription ... Summary of the Page Content" (2026-10-08).
  // A correction keeps its draft's header (a Latin draft carries one; a Tibetan one does not): checked against the draft
  // once the page is read, below (#7269: refusing any header refused every correction of a headed draft).
  if ((!correct || gpu) && ((text.match(/<page-type>/g) || []).length !== 1 || (text.match(/<scan-quality>/g) || []).length > 1)) { failed(m, 'more than one transcription header: restarted or refused read', 'refused'); continue; }
  if (REFUSAL.test(text)) { failed(m, 'refusal or summary in place of a transcription', 'refused'); continue; }
  const chatter = ocrReadProblem(text, { header: !correct || gpu });
  if (chatter) { skip(m, `chatter guard: ${chatter}`); continue; }
  const loop = loopVerdict(text);
  if (loop.refuse) { skip(m, 'repetition loop'); continue; }
  // The write guard (#5055): a tag left open in the read's last 15%, or a read ending inside a tag, is a cut read and
  // is not written (the read stage already read it twice). A tag left open earlier is a forgotten close: repaired.
  const guard = checkWrittenText(text, { kind: 'ocr' });
  if (guard.verdict === 'truncated') { skip(m, writeGuardReason(guard)); tally.write_guard_refused.push({ page_id: m.page_id ?? m.key, page_number: m.page_number, reasons: guard.reasons }); continue; }
  if (guard.verdict === 'repaired_mid') { text = guard.repaired; tally.write_guard_repaired++; }
  const page = await db.collection('pages').findOne(m.page_id ? { id: m.page_id } : { book_id: m.book_id, page_number: m.page_number }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.data': 1, 'ocr.content_hash': 1, 'ocr.language': 1, 'ocr.pipeline': 1, 'ocr.verdict': 1, 'ocr.text_source': 1, 'ocr.text_edition': 1 } });
  if (!page) { skip(m, 'page not found'); continue; }
  const unsplit = unsplitReadRefusal(await bookOf(page.book_id), page);
  if (unsplit) { skip(m, 'unsplit spread book (#7605)'); continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { skip(m, 'human-edited page'); continue; }
  const fitted = fittedTextReason(page.ocr);
  if (fitted) { skip(m, fitted); continue; }
  const foreign = foreignScriptReason(text, { languages: bookLanguages(await bookOf(page.book_id)), served: page.ocr?.data });
  if (foreign) { skip(m, foreign.replace(/: .*/, '')); console.log(`    ${foreign}`); continue; }
  // A re-read of a page that already has text should mostly agree with it. Below 40% shared words it is a different
  // text (a summary, a neighbouring leaf, an invention) or the stored read was: either way a person looks first.
  let yat = null, byEye = null, change = null;
  if (!correct && FIRST_READ_ONLY && page.ocr?.data?.trim()) { skip(m, 'the page has OCR now: --first-read-only'); continue; }
  if (!correct && PRINT_ONLY) {
    const hand = (text.match(/<script>\s*(\w+)\s*<\/script>/i)?.[1] || '').toLowerCase();
    if (hand !== 'printed') { skip(m, `reader tags the page <script>${hand || 'none'}</script>: --print-only`); continue; }
  }
  if (gpu) {
    // The page must still be unread (or, --over-stored, still hold the stored draft the read was made over), and the
    // draft on disk the one the corrector was sent.
    const over = m.draft.replaces;
    if (!over && page.ocr?.data?.trim()) { skip(m, 'the page has OCR now: the GPU-draft route is for unread pages'); continue; }
    if (over && contentHash(page.ocr?.data ?? '') !== over.text_hash) { skip(m, 'the stored text this read replaces is no longer the stored OCR'); continue; }
    let draft = null;
    try { draft = fs.readFileSync(path.join(OUT, m.draft.file), 'utf8'); } catch { /* missing */ }
    if (draft == null || contentHash(draft) !== m.draft.text_hash) { skip(m, 'the GPU draft on disk is not the draft this read corrected'); continue; }
    if (m.draft.image_sha256 !== m.image_sha256) { skip(m, 'the GPU draft was made from other image bytes than the read'); continue; }
    // Print only (Derek, 2026-10-28): the corrector's own <script> tag decides; a hand it names is not this route's.
    const hand = (text.match(/<script>\s*(\w+)\s*<\/script>/i)?.[1] || '').toLowerCase();
    if (hand !== 'printed') { skip(m, `corrector tags the page <script>${hand || 'none'}</script>: the GPU-draft route is print only`); continue; }
    // Not the 25% refuse: the change share is recorded on every write and flags the page for a check at >= 27%.
    const share = changeShare(draft, text);
    change = { change_share: Number(share.toFixed(4)), change_measure: 'T3 #7263: share of the draft\'s folded words not kept (difflib blocks)', check_flag: share >= CHECK_FLAG_SHARE, check_threshold: CHECK_FLAG_SHARE };
    if (change.check_flag) tally.check_flagged = (tally.check_flagged || 0) + 1;
    (tally.change_shares ??= {})[m.page_id ?? m.key] = change.change_share;
    if (over || DIFF_GUARD_DRAFT) {
      // #7701 (--diff-guard=gpu-draft, the Latin arm-c cell on UNREAD pages): the same guards against the GPU draft itself,
      // the only reading there is; a page they refuse stays unread.
      const ref = over ? page.ocr.data : draft, stands = over ? 'the stored text stands' : 'the page stays unread';
      // #7567 arm c over a stored draft: the plain read's 40% shared-words floor against the text it replaces (E5 wrote
      // through it), then the E3 guards against that stored text: the long-s pass, and every flip-risk change (a number, a
      // negation, an abbreviation expanded into another word) PUT BACK to the stored reading. Production has no image
      // check, and put-back is the safe direction: E5's image check gave the stored reading back on 78 of 198 changed
      // numbers, 28 of 171 negations, 1 of 23 expansions, so a put-back keeps a known misread about as often as it saves one.
      const was = longWords(ref), now = longWords(text);
      const shared = [...now].filter((w) => was.has(w)).length / Math.max(1, now.size);
      if (was.size >= 40 && shared < MIN_SHARED) { skip(m, `only ${Math.round(shared * 100)}% of its words are in the ${over ? 'stored read' : 'GPU draft'}: check by eye`); continue; }
      const lang = LANG_OF((await bookOf(page.book_id))?.language);
      const ls = longSPass(text, { lang, convention: ref });
      const { flags } = correctionDiffs(ref, ls.text, { lang });
      // A put-back splices the stored span over the corrected one. A span that holds a tag (a number flag on a running
      // head moved into <header>/<sig>/<page-num>) splices tags across each other: the pilot wrote `<sig>E.</header>` on
      // 30 of 84 put-back pages (by eye, #7567). Such a page is not written: the stored text stands.
      const tagIn = (t, [x, y]) => /[<>]/.test(String(t).slice(x, y));
      if (flags.some((f) => tagIn(ref, f.a) || tagIn(ls.text, f.b))) { skip(m, 'a diff-guard flag spans a tag: the put-back cannot be spliced, ' + stands); continue; }
      // Only a like-for-like substitution (the same number of words a side) is spliced back. A one-sided or uneven hunk
      // put back deleted a printed heading the stored text lacked (CAP. XIII) and doubled a phrase the corrector had
      // re-aligned (by eye, pilot 2026-10-29): such a page is not written.
      const nWords = (s) => String(s).split(/\s+/).filter(Boolean).length;
      if (flags.some((f) => !nWords(f.draft) || nWords(f.draft) !== nWords(f.next))) { skip(m, 'a diff-guard flag is not a like-for-like substitution: the put-back cannot be spliced, ' + stands); continue; }
      const back = applyDiffVerdicts(ref, ls.text, flags, flags.map((f) => ({ i: f.i, winner: 'draft' })));
      const tagShape = (t) => (String(t).match(/<\/?[a-z-]+/g) || []).join(' ');
      if (tagShape(back.text) !== tagShape(ls.text)) { skip(m, 'the put-back changed the read\'s tag structure: ' + stands); continue; }
      text = back.text;
      const kinds = {}; for (const f of flags) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
      change.diff_guard = { against: over ? 'stored' : 'gpu-draft', lang, flags: kinds, put_back: back.reverted, put_back_changes: flags.map((f) => ({ kind: f.kind, stored: f.draft, corrected: f.next })), long_s_tells: ls.tells.length, long_s_folded: ls.folded, rule: '#7567 E3: every flag put back to the stored reading (no image check in production)' };
      const g = (tally.diff_guard ??= { pages_flagged: 0, put_back: 0, negation: 0, number: 0, expansion: 0, long_s_tells: 0 });
      if (flags.length) g.pages_flagged++;
      g.put_back += back.reverted; g.long_s_tells += ls.tells.length; for (const [k, n] of Object.entries(kinds)) g[k] += n;
      if (text.trim() === ref.trim()) { skip(m, 'every change was put back by the diff guard: ' + stands); continue; }
    }
  } else if (correct) {
    if (m.draft?.source === 'file') { skip(m, 'the draft came from --draft-file (an eval read), not the stored OCR'); continue; }
    if (contentHash(page.ocr?.data ?? '') !== m.draft?.text_hash) { skip(m, 'the draft this corrects is no longer the stored OCR'); continue; }
    if (correctionHeaderProblem(page.ocr.data, text)) { skip(m, 'more transcription headers than the draft: restarted or refused read'); continue; }
    const d = changedUnits(page.ocr.data, text);
    if (d.changed / Math.max(1, d.draftN) > MAX_CORRECTED) { skip(m, `correction changes ${Math.round(100 * d.changed / Math.max(1, d.draftN))}% of the draft's ${d.unit}: check by eye`); continue; }
    // #6740: Flash wrote སྤྱོད as `spy`ོད. The foreign-script guard always allows Latin (tags, sigla), so a correction of a
    // Tibetan draft that ADDS Latin letters is refused here.
    // Per changed span, not page totals: a correction that drops Latin elsewhere must not hide Latin it adds (#7479 review).
    if (d.unit === 'syllables' && d.hunks.some((h) => latinLetters(h.b.map((j) => d.B[j].syl).join(' ')) > latinLetters(h.a.map((i) => d.A[i].syl).join(' ')))) { skip(m, 'correction adds Latin letters to a Tibetan draft'); continue; }
    // #6740: a correction that changes the number of text lines dropped, merged or invented a line (Thadrak brGyad stong
    // p.233: 7 lines → 6), or removed a line the draft invented (Neyphug rGyud Tsha p.128). Neither can be told apart
    // without the image, so the draft stays and a person looks.
    if (d.unit === 'syllables' && leafLines(text) !== leafLines(page.ocr.data)) { skip(m, `correction changes the line count (${leafLines(page.ocr.data)} → ${leafLines(text)}): check by eye`); continue; }
    // The ya-btags guard (#6560): a change that only adds or drops ྱ under མ is the corrector's one measured way of
    // writing the canonical spelling over the leaf's. Kept only where a leaf check confirmed it; the rest go back.
    const hits = yatagsHits(page.ocr.data, text);
    if (hits.length) {
      const v = YATAGS.get(page.id);
      if (!v) {
        tally.held_yatags++; tally.yatags_held_hits = (tally.yatags_held_hits || 0) + hits.length;
        // --emit-yatags=FILE: the held pages and their changes, the input of the leaf check
        if (arg('emit-yatags')) fs.appendFileSync(arg('emit-yatags'), JSON.stringify({ page_id: page.id, book_id: page.book_id, page_number: page.page_number, image: workspaceImage(m.key), draft: page.ocr.data, next: text, hits }) + '\n');
        skip(m, 'held for a leaf check (ya-btags)'); continue;
      }
      const same = v.hits?.length === hits.length && v.hits.every((h, i) => h.draft === hits[i].draft && h.next === hits[i].next && h.j === hits[i].j);
      if (!same) { skip(m, 'the leaf check was made on a different set of ya-btags changes'); continue; }
      const keep = new Set(v.keep || []);
      text = revertHits(text, hits, keep);
      yat = { hits: hits.length, kept: hits.filter((h) => keep.has(h.k)).length, checked_by: v.checked_by ?? null };
      yat.reverted = yat.hits - yat.kept;
    }
  } else if (page.ocr?.data && !LANE_GATE) {
    const was = longWords(page.ocr.data), now = longWords(text);
    const shared = [...now].filter((w) => was.has(w)).length / Math.max(1, now.size);
    if (was.size >= 40 && shared < MIN_SHARED) {
      const eye = BY_EYE.get(page.id);
      if (!eye) { skip(m, `only ${Math.round(shared * 100)}% of its words are in the stored read: check by eye`); continue; }
      if (eye.read_sha256 !== sha256(text)) { skip(m, 'the by-eye check was made on a different read'); continue; }
      if (eye.verdict !== 'read-matches-image') { skip(m, `by-eye verdict: ${eye.verdict}`); continue; }
      byEye = { verdict: eye.verdict, checked_by: eye.checked_by ?? null, at: eye.at ?? null, note: eye.note ?? null, read_sha256: eye.read_sha256, shared_words: Number(shared.toFixed(2)) };
    }
  }
  if (page.ocr?.updated_at && new Date(page.ocr.updated_at) > new Date(m.started_at)) { skip(m, `OCR was rewritten after this read (${page.ocr.model})`); continue; }
  // The prompt hashed is the prompt sent: rebuild it and require it to match what the read stage recorded.
  if (m.prompt_extra_hash && contentHash(EXTRA) !== m.prompt_extra_hash) { skip(m, 'prompt-extra.txt is not the instruction this read was sent'); continue; }
  const sent = m.prompt_sent_file ? fs.readFileSync(path.join(OUT, m.prompt_sent_file), 'utf8') : base != null ? base + (m.prompt_extra_hash ? EXTRA : '') + imageInstruction(workspaceImage(m.key), m.prompt_variant || 'legacy') : '';
  if (contentHash(sent) !== m.prompt_sent_hash) { skip(m, 'prompt sent cannot be reconstructed (hash mismatch)'); continue; }
  const imageUrl = m.image_url || getPageSource(page);
  const engine = geminiEngine({
    // `cli: 'claude'` is Anthropic's model through the Claude CLI on the subscription (scripts/batch/claude-ocr.mjs).
    name: engineNameForCli(m.cli), call_site: CALL_SITE, api: 'cli', cli: { name: m.cli, version: m.cli_version }, model: m.model,
    prompt: { ...ref, text: sent },
    generationConfig: notRecorded(`${m.cli} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
    run: { job_id: runId, code_version: CODE_VERSION, host: host(), at: new Date(m.finished_at), read_started_at: m.started_at, ...(m.read_site && { read_site: m.read_site, read_call: m.call_id }), ...(m.call_pages > 1 && { read_call: m.call_id, call_pages: m.call_pages, call_position: m.call_position }), reason: REASON },
    input: { ...imageInput({ url: imageUrl, mime: 'image/jpeg', bytes: m.image_bytes }), image_sha256: m.image_sha256,
      ...(correct && { draft: { ...m.draft, ...(yat && { yatags_guard: yat }), ...(change && change) } }),
      ...(LANE_GATE && { lane_gate: gateProvenance(LANE_GATE) }),
      ...(byEye && { by_eye: byEye }) },
  });
  const tags = liftOcrTags(text);
  const detectedImages = parseDetectedImages(text);
  console.log(`  ${APPLY ? 'WRITE' : 'would write'} p.${page.page_number} (${page.ocr?.model ?? 'no OCR'} -> ${m.model}, ${text.length} chars)`);
  if (yat) { tally.yatags_hits += yat.hits; tally.yatags_kept += yat.kept; tally.yatags_reverted += yat.reverted; }
  if (EMIT_WRITTEN) fs.appendFileSync(EMIT_WRITTEN, JSON.stringify({ page_id: page.id, book_id: page.book_id, page_number: page.page_number, text, apply: APPLY }) + '\n');
  if (!APPLY) { tally.written++; continue; }
  // Through the one page-text writer (#7058): the whole prior `ocr` goes to page_revisions with this run's id, the write
  // is compare-and-set on the text read above, and scripts/maintenance/revert-run.mjs --run-id <run> undoes the run.
  const w = await writePageText(db, page.id, 'ocr', {
    data: text, language: correct && !gpu ? (page.ocr?.language ?? 'auto-detect') : 'auto-detect', model: m.model, updated_at: new Date(), source: 'ai', prompt_version: ref.version, prompt_id: ref.id, prompt_name: ref.name, ...ocrProvenance(text, engine),
    // A correction is stamped with its own lane, so the reader can tell it from the draft's lane and the hourly
    // withhold sweep (WITHHOLD_LANES) does not take the English down; --mark-stale queues it for re-translation.
    ...(correct && { pipeline: m.lane, ...(page.ocr?.verdict && { verdict: page.ocr.verdict }) }),
    // A gated re-read is stamped with its lane: the stale-translation sweep (arm 1) then finds any page whose
    // English was not redone after it (#6769). A plain read given `--lane` (a first-read lane, #7701) is stamped too.
    ...(!correct && LANE && { pipeline: LANE }),
  }, { by: `${m.cli} ${m.model}`, reason: REASON, run_id: runId, revision_source: 'reocr_cli', expect_prior_hash: textHash(page.ocr) });
  if (w.status !== 'written') { skip(m, w.status === 'conflict' || w.status === 'prior_changed' ? 'page changed between read and write' : `writer: ${w.status}`); continue; }
  // Page-level tags lifted from the read go in a second update, only while the page still holds the text just written.
  // revert-run restores `ocr` only, not these (a Tibetan correction lifts none: it carries no header).
  if (Object.keys(tags).length || detectedImages.length) await db.collection('pages').updateOne({ id: page.id, 'ocr.data': text }, { $set: { ...tags, ...(detectedImages.length > 0 && { detected_images: detectedImages }) } });
  await recordSweepAction(db, { sweep: 'cli-ocr', book_id: page.book_id, action: 'ocr-reread-through-cli', detail: { page_id: page.id, page_number: page.page_number, from_model: page.ocr?.model ?? null, to_model: m.model, cli: `${m.cli} ${m.cli_version}`, run: runId, reason: REASON } });
  if (MARK_STALE) await markTranslationsStale(db, [{ id: page.id, text }], new Date(), MARK_STALE);
  (books[page.book_id] ??= { nums: [], models: new Set() }).nums.push(page.page_number);
  books[page.book_id].models.add(m.model);
  tally.written++;
  tally.written_page_ids.push(page.id);
}

tally.failed_reads = failedReads.length;
if (APPLY && failedReads.length) {
  const r = await recordFailedReads(db, failedReads);
  tally.failed_reads_stamped = r.stamped;
  console.log(`stamped ${r.stamped} of ${failedReads.length} failed read(s) on their pages (ocr.last_skip, #7378)`);
}
if (APPLY) {
  for (const [bookId, { nums, models }] of Object.entries(books)) {
    // The one counter writer (#5325): three of these pages may have had no OCR before.
    await recountBook(db, bookId, { reason: 'cli-ocr' });
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_reread', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', models: [...models], pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON, ...(LANE && { lane: LANE }), ...(LANE_GATE && { lane_gate: gateProvenance(LANE_GATE) }) } });
  }
}
console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written}   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? `   run ${runId}` : '   (dry run; add --apply)'}`);
if (metas.some((m) => m.mode === 'correct')) console.log(`ya-btags guard: ${tally.held_yatags} page(s) held (${tally.yatags_held_hits || 0} changes); checked ${tally.yatags_hits} changes, kept ${tally.yatags_kept}, put back ${tally.yatags_reverted}`);
fs.writeFileSync(path.join(OUT, `apply-summary-${APPLY ? runId : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), apply: APPLY, run: APPLY ? runId : null, reason: REASON, ...(LANE && { lane: LANE }), ...tally }, null, 1));
await client.close();
