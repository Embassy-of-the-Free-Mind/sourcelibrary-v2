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
 *          saves DIR/<page_id>.txt + .meta.json. Writes NOTHING to the database. Re-running skips pages already read.
 *
 *   apply  node --env-file=.env.production.local scripts/batch/cli-ocr.mjs apply --out=DIR --reason="..." [--apply]
 *          Dry run unless --apply. Per page: refuses a human-edited page, a page whose OCR changed after the read,
 *          an empty or over-long read, a repetition loop, a refusal or summary dressed as a transcription, and a read
 *          that shares under 40% of its words with the text already stored; snapshots the old text to page_revisions; writes
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
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { geminiEngine, engineNameForCli, imageInput, ocrProvenance, notRecorded, contentHash, codeVersion, host } from '../lib/write-provenance.mjs';
import { liftOcrTags, parseDetectedImages } from '../lib/ocr-result-parse.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { ocrReadProblem, OCR_SENTINEL_INSTRUCTION } from '../lib/cli-chatter.mjs';
import { recordFailedReads, fromCliRead } from '../lib/ocr-failed-read.mjs';
import { CLI, CLI_SAFE_ARGS, agyCall, installToolGate, gateCalls, unwrapRead } from '../lib/agy-cli.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { markTranslationsStale } from '../lib/syriac-kraken-lane.mjs';
import { liveOcrPrompt } from '../lib/live-ocr-prompt.mjs';
import { diffSyllables, alignSyllables, yatagsHits, revertHits } from '../lib/tibetan-yatags-guard.mjs';
import { checkWrittenText, writeGuardReason } from '../lib/write-text-guard.mjs';
import { fittedTextReason, foreignScriptReason, bookLanguages, gateUsable, gateProvenance, sha256 } from '../lib/reread-lane-gate.mjs';
import { keepRead, findRead, reuseInto, reuseHash, wantsFresh } from '../lib/candidate-reads.mjs';

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
if (STAGE === 'read' && CORRECT_PROMPT && !LANE) { console.error('--correct-prompt needs --lane=<id>: the ocr.pipeline the corrected pages are stamped with'); process.exit(2); }
if (!['read', 'apply'].includes(STAGE) || !OUT) { console.error('usage: cli-ocr.mjs read|apply --out=DIR ... (see the header)'); process.exit(2); }

// The sentence that points the CLI at the image. It is part of the prompt SENT, so it is part of what is hashed.
// The image is ATTACHED with the CLI's `@file` syntax (relative to cwd), so the model needs no tool to open it.
// #6523: the reply is asked for between <<<BEGIN>>> / <<<END>>> markers (the dev rounds' winning config). A read made
// before that records no `prompt_variant` and is rebuilt with the legacy sentence, so its hash still matches at apply.
const PROMPT_VARIANT = 'sentinels-6523';
const imageInstruction = (imagePath, variant = PROMPT_VARIANT) => (variant === PROMPT_VARIANT
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
const variantOf = (mode, lane, promptVariant) => (mode === 'correct' ? `correct:${lane}` : promptVariant ?? null);
const readReuseKey = (m) => (m.cli === CLI ? reuseHash({ field: 'ocr', prompt: m.prompt_sent_hash, input: m.image_sha256, variant: variantOf(m.mode, m.lane, m.prompt_variant) }) : null);
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
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, ...(CORRECT_PROMPT && { 'ocr.data': 1, 'ocr.content_hash': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.pipeline': 1 }) } }).toArray();
  const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('concurrency') || 1)));
  const QUOTA_SLEEP_S = Number(arg('quota-sleep') || 1800);
  const STOP_ON_QUOTA = process.argv.includes('--stop-on-quota');
  const stopOnQuota = async (p, why) => { console.error(`QUOTA at p.${p.page_number}: stopping (--stop-on-quota). ${why}`); await client.close(); process.exit(3); };
  console.log(`${pages.length} of ${ids.length} page ids found; model ${MODEL}; ${CLI} ${version}; ${CONCURRENCY} at a time`);
  let quotaUntil = 0, reused = 0;
  const readOne = async (p) => {
    const key = p.id;
    if (fs.existsSync(path.join(OUT, `${key}.meta.json`)) && fs.readFileSync(path.join(OUT, `${key}.txt`), 'utf8').length > 5) { console.log(`  ${p.page_number} already read`); return; }
    // The page's own image, split-aware (#6420): on a page split from a spread `archived_photo` is the WHOLE spread,
    // and a read of it transcribes both pages onto one. getPageSource() is the resolver the OCR lanes use.
    if (CORRECT_PROMPT && !p.ocr?.data?.trim()) { console.log(`  ${p.page_number} has no stored OCR to correct; skipped`); return; }
    const src = getPageSource(p);
    if (!src) { console.log(`  ${p.page_number} has no usable image; skipped`); return; }
    const res = await fetch(src);
    if (!res.ok) { console.log(`  ${p.page_number} image HTTP ${res.status}; skipped`); return; }
    const buf = Buffer.from(await res.arrayBuffer());
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
    for (;;) {
      while (Date.now() < quotaUntil) await new Promise((s) => setTimeout(s, 30_000));
      r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], path.dirname(img));
      // A locked model is not called (agy-cli.mjs → model-limits.mjs): sleep to its quoted reset, not a fixed 30 min.
      if (r.not_called && STOP_ON_QUOTA) await stopOnQuota(p, `locked until ${r.locked_until || '?'}: ${r.err}`);
      if (r.not_called) { quotaUntil = Math.max(Date.now() + 60_000, Date.parse(r.locked_until || '') || Date.now() + QUOTA_SLEEP_S * 1000); console.log(`  LOCKED at p.${p.page_number}: no call until ${new Date(quotaUntil).toISOString()}`); continue; }
      calls++;
      logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls });
      if (r.cls === 'quota' && STOP_ON_QUOTA) await stopOnQuota(p, r.err);
      if (r.cls === 'quota') { quotaUntil = Date.now() + QUOTA_SLEEP_S * 1000; console.log(`  QUOTA at p.${p.page_number}: sleeping ${QUOTA_SLEEP_S}s`); continue; }
      if (r.cls === 'denied_tool' && r.conversation && !nudged) {
        nudged = true;
        r = await agyCall(['-p', NUDGE, '--model', MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], path.dirname(img)); calls++;
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
      chars: text.length, nudged, rereads, calls, chatter: text ? ocrReadProblem(text, { header: !CORRECT_PROMPT }) : null,
      write_guard: text ? checkWrittenText(text, { kind: 'ocr' }).verdict : null,
      prompt_variant: PROMPT_VARIANT, wrapper, tool_calls: gateCalls(gateLog),
      image_url: src, image_bytes: buf.length, image_sha256: imageSha,
      prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), stderr_tail: r.err, ...(extra && { prompt_extra_hash: contentHash(extra) }),
      ...(CORRECT_PROMPT && { mode: 'correct', lane: LANE, prompt_sent_file: `${key}.prompt.txt`, draft: { model: p.ocr.model, pipeline: p.ocr.pipeline ?? null, content_hash: p.ocr.content_hash ?? contentHash(p.ocr.data), text_hash: contentHash(p.ocr.data), updated_at: p.ocr.updated_at } }),
    };
    fs.writeFileSync(path.join(OUT, `${key}.meta.json`), JSON.stringify(meta, null, 1));
    // Kept the moment it is paid for (#7075); best effort, never fails the read.
    if (meta.exit === 0 && !meta.error_class && !meta.wrapper) await keepRead({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, field: 'ocr', text, model: MODEL, prompt_hash: reuseKey, job: JOB, meta, prompt_text: CORRECT_PROMPT ? sent : null, source_path: path.join(OUT, `${key}.txt`) });
    console.log(`  ${p.page_number} ${r.cls || 'ok'}${nudged ? ' (nudged)' : ''}${rereads ? ' (re-read)' : ''} ${text.length} chars ${Math.round((Date.now() - t0) / 1000)}s`);
  };
  const queue = [...pages];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await readOne(queue.shift()); }));
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
const metas = fs.readdirSync(OUT).filter((f) => f.endsWith('.meta.json')).map((f) => ({ key: f.replace(/\.meta\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) }))
  .filter((m) => !ONLY || ONLY.has(m.page_id ?? m.key));
const CODE_VERSION = await codeVersion();
const runId = `cli-ocr-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text/im;
// Distinct words of 5+ letters, folded: enough to tell "the same page read again" from "a different text".
const longWords = (t) => new Set((String(t).replace(/<[^>]+>/g, ' ').replace(/-\n/g, '').toLowerCase().replace(/æ/g, 'ae').replace(/ſ/g, 's').replace(/v/g, 'u').match(/\p{L}{5,}/gu) || []));
const MIN_SHARED = 0.4;
// Correct mode: a correction keeps most of its draft. Over this share of the draft's syllables changed, it is a
// re-transcription (or an invention), not a correction, and a person looks first.
const MAX_CORRECTED = 0.25;
// The 25% is counted in syllables on a Tibetan draft and in words (whitespace tokens, tags out) on any other: the
// syllable tokenizer keeps only Tibetan syllables, so on Latin it counted 0 of 0 and passed every correction (#7269).
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
const bookOf = async (id) => { if (!bookCache.has(id)) bookCache.set(id, await db.collection('books').findOne({ id }, { projection: { id: 1, language: 1, original_language: 1, languages: 1 } })); return bookCache.get(id); };
const tally0 = { held_yatags: 0, yatags_hits: 0, yatags_kept: 0, yatags_reverted: 0 };
const tally = { written: 0, skipped: {}, ...tally0, written_page_ids: [], write_guard_repaired: 0, write_guard_refused: [] };
const skip = (m, why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; console.log(`  skip p.${m.page_number}: ${why}`); };
// A read the engine did not deliver (exit, empty, refusal, a cut or chattering wrapper) is stamped on the page as a
// failed read (#7378), so the route census sees this route's did-not-read rate. Our own guards' skips are not.
const failedReads = [];
const failed = (m, why, kind) => { skip(m, why); const row = fromCliRead(m, kind, CALL_SITE); if (row) failedReads.push(row); };
const books = {};

for (const m of metas.sort((a, b) => a.page_number - b.page_number)) {
  let text = fs.readFileSync(path.join(OUT, `${m.key}.txt`), 'utf8').trim();
  const correct = m.mode === 'correct';
  if (m.exit !== 0) { failed(m, `cli exit ${m.exit}`, 'exit'); continue; }
  // #6523: a reply with chatter outside the markers, or cut before <<<END>>> (often a recitation-filter cut), is not
  // written even when the text inside looks like a transcription: it is usually a partial page.
  if (m.wrapper) { failed(m, `reply wrapper: ${m.wrapper}`, 'wrapper'); continue; }
  if (text.length < 5) { failed(m, 'empty read (refusal or blank)', 'empty'); continue; }
  if (text.length > 25000) { skip(m, 'over 25k chars'); continue; }
  if (!correct && !/<page-type>/.test(text)) { skip(m, 'no <page-type> tag: not a transcription in the prompt format'); continue; }
  // The CLI is an agent, not an endpoint: a refusal arrives as exit 0 with prose. Aldine 1516 p.34 came back as two
  // false starts and then "I cannot provide a verbatim transcription ... Summary of the Page Content" (2026-10-08).
  // A correction keeps its draft's header (a Latin draft carries one; a Tibetan one does not): checked against the draft
  // once the page is read, below (#7269: refusing any header refused every correction of a headed draft).
  if (!correct && ((text.match(/<page-type>/g) || []).length !== 1 || (text.match(/<scan-quality>/g) || []).length > 1)) { failed(m, 'more than one transcription header: restarted or refused read', 'refused'); continue; }
  if (REFUSAL.test(text)) { failed(m, 'refusal or summary in place of a transcription', 'refused'); continue; }
  const chatter = ocrReadProblem(text, { header: !correct });
  if (chatter) { skip(m, `chatter guard: ${chatter}`); continue; }
  const loop = loopVerdict(text);
  if (loop.refuse) { skip(m, 'repetition loop'); continue; }
  // The write guard (#5055): a tag left open in the read's last 15%, or a read ending inside a tag, is a cut read and
  // is not written (the read stage already read it twice). A tag left open earlier is a forgotten close: repaired.
  const guard = checkWrittenText(text, { kind: 'ocr' });
  if (guard.verdict === 'truncated') { skip(m, writeGuardReason(guard)); tally.write_guard_refused.push({ page_id: m.page_id ?? m.key, page_number: m.page_number, reasons: guard.reasons }); continue; }
  if (guard.verdict === 'repaired_mid') { text = guard.repaired; tally.write_guard_repaired++; }
  const page = await db.collection('pages').findOne(m.page_id ? { id: m.page_id } : { book_id: m.book_id, page_number: m.page_number }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.data': 1, 'ocr.content_hash': 1, 'ocr.language': 1, 'ocr.pipeline': 1, 'ocr.verdict': 1, 'ocr.text_source': 1, 'ocr.text_edition': 1 } });
  if (!page) { skip(m, 'page not found'); continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { skip(m, 'human-edited page'); continue; }
  const fitted = fittedTextReason(page.ocr);
  if (fitted) { skip(m, fitted); continue; }
  const foreign = foreignScriptReason(text, { languages: bookLanguages(await bookOf(page.book_id)), served: page.ocr?.data });
  if (foreign) { skip(m, foreign.replace(/: .*/, '')); console.log(`    ${foreign}`); continue; }
  // A re-read of a page that already has text should mostly agree with it. Below 40% shared words it is a different
  // text (a summary, a neighbouring leaf, an invention) or the stored read was: either way a person looks first.
  let yat = null, byEye = null;
  if (correct) {
    if (contentHash(page.ocr?.data ?? '') !== m.draft?.text_hash) { skip(m, 'the draft this corrects is no longer the stored OCR'); continue; }
    const headers = (t) => (t.match(/<page-type>|<scan-quality>/g) || []).length;
    if (headers(text) > headers(page.ocr.data)) { skip(m, 'more transcription headers than the draft: restarted or refused read'); continue; }
    const d = changedUnits(page.ocr.data, text);
    if (d.changed / Math.max(1, d.draftN) > MAX_CORRECTED) { skip(m, `correction changes ${Math.round(100 * d.changed / Math.max(1, d.draftN))}% of the draft's ${d.unit}: check by eye`); continue; }
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
    run: { job_id: runId, code_version: CODE_VERSION, host: host(), at: new Date(m.finished_at), read_started_at: m.started_at, ...(m.read_site && { read_site: m.read_site, read_call: m.call_id }), reason: REASON },
    input: { ...imageInput({ url: imageUrl, mime: 'image/jpeg', bytes: m.image_bytes }), image_sha256: m.image_sha256,
      ...(correct && { draft: { ...m.draft, ...(yat && { yatags_guard: yat }) } }),
      ...(LANE_GATE && { lane_gate: gateProvenance(LANE_GATE) }),
      ...(byEye && { by_eye: byEye }) },
  });
  const tags = liftOcrTags(text);
  const detectedImages = parseDetectedImages(text);
  console.log(`  ${APPLY ? 'WRITE' : 'would write'} p.${page.page_number} (${page.ocr?.model ?? 'no OCR'} -> ${m.model}, ${text.length} chars)`);
  if (yat) { tally.yatags_hits += yat.hits; tally.yatags_kept += yat.kept; tally.yatags_reverted += yat.reverted; }
  if (!APPLY) { tally.written++; continue; }
  await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'reocr_cli' });
  const r = await db.collection('pages').updateOne(
    // Guard on the OCR timestamp read above: if another writer got in between, write nothing.
    { id: page.id, 'ocr.updated_at': page.ocr?.updated_at ?? { $exists: false } },
    { $set: {
      ocr: { data: text, language: correct ? (page.ocr?.language ?? 'auto-detect') : 'auto-detect', model: m.model, updated_at: new Date(), source: 'ai', prompt_version: ref.version, prompt_id: ref.id, prompt_name: ref.name, ...ocrProvenance(text, engine),
        // A correction is stamped with its own lane, so the reader can tell it from the draft's lane and the hourly
        // withhold sweep (WITHHOLD_LANES) does not take the English down; --mark-stale queues it for re-translation.
        ...(correct && { pipeline: m.lane, ...(page.ocr?.verdict && { verdict: page.ocr.verdict }) }),
        // A gated re-read is stamped with its lane: the stale-translation sweep (arm 1) then finds any page whose
        // English was not redone after it (#6769).
        ...(LANE_GATE && { pipeline: LANE }) },
      ...tags,
      ...(detectedImages.length > 0 && { detected_images: detectedImages }),
      updated_at: new Date(),
    } },
  );
  if (r.modifiedCount !== 1) { skip(m, 'page changed between read and write'); continue; }
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
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_reread', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', models: [...models], pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON, ...(LANE_GATE && { lane: LANE, lane_gate: gateProvenance(LANE_GATE) }) } });
  }
}
console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written}   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? `   run ${runId}` : '   (dry run; add --apply)'}`);
if (metas.some((m) => m.mode === 'correct')) console.log(`ya-btags guard: ${tally.held_yatags} page(s) held (${tally.yatags_held_hits || 0} changes); checked ${tally.yatags_hits} changes, kept ${tally.yatags_kept}, put back ${tally.yatags_reverted}`);
fs.writeFileSync(path.join(OUT, `apply-summary-${APPLY ? runId : 'dry'}.json`), JSON.stringify({ at: new Date().toISOString(), apply: APPLY, run: APPLY ? runId : null, reason: REASON, ...(LANE && { lane: LANE }), ...tally }, null, 1));
await client.close();
