#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs (the CLI OCR writer, this file's template) and scripts/lib/translate-batch-chained.mjs
// (the production single-page request and write). The chained lane and the realtime worker call the paid Gemini API;
// since 2026-10-08 every model but flash-lite runs through the subscription CLI (`agy -p`) instead, and nothing
// translated through it and wrote a page (scripts/eval/pareto-6182/RUNBOOK-cli38-xl.md writes none). Prompt and write door are translate-core's.
/**
 * Translate a page list through the Gemini subscription CLI, in two stages, so a read can be looked at before it is written.
 *
 * WHO RUNS IT: a person or session at a machine where `agy` is installed and signed in (the Hetzner box). About 30 s a
 * page, one page per call, strictly in page order, ONE call at a time: each page is seeded with the page before it,
 * exactly as the worker seeds, and that page's English is the read just made (nothing is stored yet), else the stored one.
 * No API key, no API spend.
 *
 * FOLIO MARKERS (#7118, on by default; TRANSLATE_FOLIO_MARKERS_CLI=0 turns them off): two consecutive Latin-script pages
 * that both need a read go in ONE call as continuous English with <pb n="N"/> where each page begins
 * (translate-core FOLIO_MARKER_RULE), and each page keeps its own span (folio-markers.mjs splitMarkedReply). Measured
 * on this lane: broken joins 35.5 → 16.4 per 100, majors 10 → 3 (scripts/eval/experiments/2026-10-29-seam-prevent-markers-7118.md).
 * A reply that does not split cleanly, or splits far out of balance, is dropped and the two pages are read one by one.
 *
 *   read   node --env-file=.env.production.local scripts/batch/cli-translate.mjs read --page-ids-file=F --out=DIR [--model=gemini-3.8-flash-low] [--ocr-checked="..."]
 *          Builds translate-core's single-page prompt from the stored OCR, asks the CLI, saves DIR/<page_id>.txt + .meta.json.
 *          Writes no page or book (only the job's book list, lane_job_books, #7301). Skips pages already read, pages
 *          with no translatable OCR, and blank pages.
 *          [--instructions-file=F]: JSON { page_id: "one line" } appended to that page's prompt (#6559: a Maya numeral the
 *          first read got wrong, named with its value from Beltrán's table). Recorded as `instruction` in the meta.
 *
 *   apply  node --env-file=.env.production.local scripts/batch/cli-translate.mjs apply --out=DIR --reason="..." [--apply]
 *          Dry run unless --apply. Per page refuses: a CLI failure, an empty read, chatter or a refusal in place of a
 *          translation, a page whose OCR changed since the read, a read that is mostly English already printed on the
 *          page (a Loeb's facing translation, #7075), and (inside the door) a human-edited translation or a
 *          read that fails the health check. Writes through writePageTranslation (translate-core: snapshot to
 *          page_revisions, provenance block with api 'cli', the CLI name and version, model and prompt hash), leaves a
 *          sweep_log row per page and one book_events row per book, and recounts the book.
 *          Each written page also gets a page-text-writer revision row with the run id (#7503), so the run is undone by
 *          `scripts/maintenance/revert-run.mjs --run-id <run> [--apply]` (it restores, or removes, only English still as written).
 *          It also writes the reads of scripts/batch/claude-translate.mjs (Opus through the Claude CLI, #6559): their meta
 *          says `cli: 'claude'`, so the engine block is recorded as 'anthropic', and the exact prompt each call sent is
 *          kept beside the reads (`prompt_sent_file`), so a read whose hash does not match it is refused. A meta's
 *          `passes` (a draft and its review, scripts/batch/twopass-review.mjs) is copied into engine.run.passes.
 *
 * THE CALL (#6523, the OCR runner's config, shared code in scripts/lib/agy-cli.mjs): the prompt asks for the translation
 * between <<<BEGIN>>> / <<<END>>> markers and nothing outside them; a PreToolUse hook in the call's empty workspace
 * (scripts/lib/agy-tool-gate.py, task 'translate') denies every tool with a reason, so the turn goes on to the
 * translation instead of ending empty. The raw reply is kept as <page_id>.raw.txt; .txt holds the text between the
 * markers. `apply` refuses a reply with text outside the markers or cut before <<<END>>>, and still runs the chatter
 * guard on every read.
 *
 * KEPT AND REUSED (#7075, scripts/lib/candidate-reads.mjs): every usable read is copied to R2 candidate-reads/ when it
 * is made, and `read` first asks for a kept read of the same page by the same model on the same prompt template and
 * variant, the same OCR (by hash) and the same --instructions-file line, and uses it instead of calling (meta
 * `reused_from`). The neighbouring context (the page before's English) is not part of that key. `--fresh` always
 * calls: a repeat-noise eval needs fresh reads.
 *
 * HOW IT FAILS: a CLI that is not signed in, out of quota or timing out leaves an empty .txt and a non-zero `exit`
 * (up to 3 attempts in place); a quota error is logged to agy-calls.jsonl and the run STOPS rather than burning the
 * other jobs' quota. `apply` skips what it refuses and says why. Nothing is retried silently.
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { readPageIdsFile } from '../lib/ocr-targeting.mjs';
import { ocrFirstGate } from '../lib/ocr-first-gate.mjs';
import { cliFolioMarkersEnabled, splitMarkedReply } from '../lib/folio-markers.mjs';
import { sourceProse } from '../lib/block-drift.mjs';
import { PAGE_BREAK_SCOPED, pageBreakVariant, buildTranslationPrompt, buildBlockTranslationPrompt, loadTranslationPrompts, isTranslatablePage, sameLanguageReason, sanitizeTranslationTags, writePageTranslation, syncBookTranslationCounters, contentHash } from '../lib/translate-core.mjs';
import { cliChatterReason } from '../lib/cli-chatter.mjs';
import { CLI, gatedTextCall, TRANSLATE_SUFFIX, agyUsage } from '../lib/agy-cli.mjs';
import { geminiEngine, engineNameForCli, translationInput, notRecorded, codeVersion, host } from '../lib/write-provenance.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { checkWrittenText } from '../lib/write-text-guard.mjs';
import { copiesPrintedEnglish, dominantScript } from '../lib/page-integrity.mjs';
import { keepRead, findRead, reuseInto, translationReuseKey, wantsFresh } from '../lib/candidate-reads.mjs';
import { laneForWrite } from '../lib/lanes.mjs';
import { recordLaneBooks, laneJob } from '../lib/lane-book-list.mjs';
import { buildTextRevision } from '../lib/page-text-writer.mjs';
import { unsplitReadRefusal } from '../lib/pipeline-hold.mjs';

const CALL_SITE = 'scripts/batch/cli-translate.mjs';
const JOB = process.env.CLI_JOB_NAME || 'xunzi-translate-6307';
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const STAGE = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
const MODEL = arg('model') || 'gemini-3.8-flash-low';
const APPLY = process.argv.includes('--apply');
if (!['read', 'apply'].includes(STAGE) || !OUT) { console.error('usage: cli-translate.mjs read|apply --out=DIR ... (see the header)'); process.exit(2); }

// Part of the prompt SENT, so part of what is hashed: the CLI is an agent and must answer with text, not tool use.
// #6523: the answer between <<<BEGIN>>> / <<<END>>> markers, nothing outside them (the OCR runner's config), with the
// tool gate in the call's empty workspace (scripts/lib/agy-cli.mjs). A read made before that records no
// `prompt_variant`; apply checks it with the chatter guard alone, as before.
const PROMPT_VARIANT = 'sentinels-6523';
// #7118: two consecutive Latin-script pages in one call, continuous English with folio markers (see readMarkedPair).
const PROMPT_VARIANT_MARKED = 'sentinels-6523+folio-markers-7118';
const MARKERS = cliFolioMarkersEnabled();
const CLI_SUFFIX = TRANSLATE_SUFFIX;
const PAGE_PROJECTION = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, split_from_spread: 1, split_from_pecha: 1, cropped_photo: 1, crop: 1 };
const logCall = (rec) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: JOB, model: MODEL, ...rec }) + '\n'); } catch { /* the box has the log dir; a laptop need not */ } };
const INSTRUCTIONS = arg('instructions-file') ? JSON.parse(fs.readFileSync(arg('instructions-file'), 'utf8')) : {};
const readOf = (id) => { try { return fs.readFileSync(path.join(OUT, `${id}.txt`), 'utf8').trim(); } catch { return ''; } };
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
  // A reuse-only run makes no call, so it does not need the CLI installed (a cron PATH may not have it).
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim() || (REUSE_ONLY ? 'not needed (reuse-only)' : '');
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  const prompts = await loadTranslationPrompts(db);
  fs.mkdirSync(OUT, { recursive: true });
  const found = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: PAGE_PROJECTION }).toArray()).map((p) => [p.id, p]));
  console.log(`${found.size} of ${ids.length} page ids found; model ${MODEL}; ${CLI} ${version}`);
  // Check the transcription before paying for a translation on top of it (#6865).
  // --reuse-only spends nothing, and the paid lane it stands in front of would translate the same OCR anyway: the
  // OCR-first gate (#6865) is a spend gate, so it does not apply to handing back a read already paid for.
  const gate = REUSE_ONLY ? { ok: true, message: 'reuse-only: OCR-first gate not applied (no call is made)' } : ocrFirstGate([...found.values()], arg('ocr-checked'));
  console.log(gate.message);
  if (!gate.ok) { await client.close(); process.exit(2); }
  // The job's book list, recorded with the job for the lane registry (#7301 item 5): no page or book is written.
  await recordLaneBooks(db, { lane: laneForWrite('translation', { call_site: CALL_SITE, name: engineNameForCli(CLI) }), ...laneJob(process.env.CLI_JOB_NAME), pages: [...found.values()] });
  const books = new Map();
  let reused = 0, paired = 0, pairFallbacks = 0;
  const latinScript = (...ocrs) => dominantScript(ocrs.map((o) => sourceProse(o || '')).join(' ')) === 'latin';
  /** One marked call for page p and the page after it (#7118). 'read' | 'fallback' (called, unusable) | null (no pair). */
  async function readMarkedPair({ p, book, prev, previousTranslation, prevRead, nextId }) {
    const q = found.get(nextId);
    if (!q || q.book_id !== p.book_id || q.page_number !== p.page_number + 1 || INSTRUCTIONS[nextId]) return null;
    if (!latinScript(p.ocr.data, q.ocr.data)) return null;
    if (!(await prepare(nextId, { quiet: true }))) return null;
    const after = await db.collection('pages').findOne({ book_id: p.book_id, page_number: q.page_number + 1 }, { projection: { 'ocr.data': 1 } });
    const built = buildBlockTranslationPrompt({ prompts, book, pages: [{ page_number: p.page_number, ocr: p.ocr.data }, { page_number: q.page_number, ocr: q.ocr.data }],
      previousTranslation: previousTranslation || undefined, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: after?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED, folioMarkers: true });
    // A kept one-page read of the second page is used as before (it is picked up on its own turn): no pair then.
    if (!FRESH) {
      const key = translationReuseKey({ prompt_ref: built.promptRef, ocr_hash: contentHash(q.ocr.data), prompt_variant: PROMPT_VARIANT, instruction: null });
      if (await findRead({ page_id: nextId, book_id: q.book_id, field: 'translation', model: MODEL, prompt_hash: key, derive: (m) => (m.cli === CLI ? translationReuseKey(m) : null) })) return null;
    }
    const sent = built.prompt + CLI_SUFFIX;
    const t0 = new Date();
    const r = await gatedTextCall(sent, { model: MODEL, task: 'translate', onCall: (c) => logCall({ kind: 'translate-pair', seconds: Math.round(c.secs), ok: !c.cls, error_class: c.cls, usage: c.usage }) });
    if (r.cls === 'quota') { console.error(`QUOTA reached at p.${p.page_number}: stopping. ${r.err}`); await client.close(); process.exit(3); }
    const fail = r.cls || r.problem || cliChatterReason(r.answer || '');
    const split = fail ? null : splitMarkedReply(r.answer, [p.page_number, q.page_number], { sources: [p.ocr.data, q.ocr.data] });
    const cut = split?.ok && split.texts.some((t, k) => checkWrittenText(t, { kind: 'translation', source: [p, q][k].ocr.data, lang: book?.language, type: [p, q][k].page_type }).verdict === 'truncated');
    if (fail || !split.ok || cut) {
      console.log(`  ${p.page_number}+${q.page_number} marked pair not usable (${fail || (!split.ok ? split.why : 'a span looks cut')}): one page per call`);
      return 'fallback';
    }
    for (const [k, pg] of [p, q].entries()) {
      const text = split.texts[k];
      fs.writeFileSync(path.join(OUT, `${pg.id}.raw.txt`), r.text);
      fs.writeFileSync(path.join(OUT, `${pg.id}.txt`), text);
      const reuseKey = translationReuseKey({ prompt_ref: built.promptRef, ocr_hash: contentHash(pg.ocr.data), prompt_variant: PROMPT_VARIANT_MARKED, instruction: null });
      const meta = {
        page_id: pg.id, book_id: pg.book_id, page_number: pg.page_number, cli: CLI, cli_version: version, model: MODEL,
        started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: r.code === null ? -9 : r.code, error_class: null, attempts: r.calls, chars: text.length,
        prompt_variant: PROMPT_VARIANT_MARKED, wrapper: null, tool_calls: r.tool_calls,
        ocr_hash: contentHash(pg.ocr.data), ocr_updated_at: pg.ocr.updated_at ?? null, prompt_ref: built.promptRef, is_english_book: built.isEnglish,
        prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), call_usage: agyUsage(r.usage),
        // Both pages came from ONE call: the raw reply is the same file beside each, and so is its token count.
        folio_block: { pages: [p.page_number, q.page_number], page_ids: [p.id, q.id], reading: split.reading },
        context: k === 0
          ? { previous_translation: !!previousTranslation, previous_from: prevRead && previousTranslation !== prev?.translation?.data ? 'cli-read' : previousTranslation ? 'stored' : null, prev_ocr: !!prev?.ocr?.data, next_ocr: true, page_break: pageBreakVariant(PAGE_BREAK_SCOPED), prompt_variant: PROMPT_VARIANT_MARKED, folio_markers: true }
          : { previous_translation: true, previous_from: 'same-call', prev_ocr: true, next_ocr: !!after?.ocr?.data, page_break: pageBreakVariant(PAGE_BREAK_SCOPED), prompt_variant: PROMPT_VARIANT_MARKED, folio_markers: true },
        stderr_tail: r.err,
      };
      fs.writeFileSync(path.join(OUT, `${pg.id}.meta.json`), JSON.stringify(meta, null, 1));
      await keepRead({ page_id: pg.id, book_id: pg.book_id, page_number: pg.page_number, field: 'translation', text, model: MODEL, prompt_hash: reuseKey, job: JOB, meta, source_path: path.join(OUT, `${pg.id}.txt`) });
    }
    console.log(`  ${p.page_number}+${q.page_number} marked pair ok (${split.reading}) ${split.texts[0].length}+${split.texts[1].length} chars ${Math.round((Date.now() - t0) / 1000)}s calls ${r.calls}`);
    return 'read';
  }
  // Everything that keeps a page from being read, before any call; `quiet` for the look-ahead at a pair's second page.
  const prepare = async (id, { quiet = false } = {}) => {
    const p = found.get(id);
    const say = (s) => { if (!quiet) console.log(s); };
    if (!p) return null;
    if (fs.existsSync(path.join(OUT, `${id}.meta.json`)) && readOf(id).length > 5) { say(`  ${p.page_number} already read`); return null; }
    const tr = isTranslatablePage(p);
    if (!tr.ok) { say(`  ${p.page_number} not translatable (${tr.reason}); skipped`); return null; }
    if (!books.has(p.book_id)) books.set(p.book_id, await db.collection('books').findOne({ id: p.book_id }));
    const book = books.get(p.book_id);
    const unsplit = unsplitReadRefusal(book, p);
    if (unsplit) { say(`  ${p.page_number} skipped: ${unsplit}`); return null; }
    const same = sameLanguageReason({ book, page: p });
    if (same) { say(`  ${p.page_number} skipped: ${same}`); return null; }
    return { p, book };
  };
  for (let i = 0; i < ids.length; i++) {   // the file's order, which is page order
    const id = ids[i];
    const prepared = await prepare(id);
    if (!prepared) continue;
    const { p, book } = prepared;
    // Context exactly as the worker seeds it: the page before. Its English is the read just made if there is one
    // (nothing is stored until apply), else the stored translation; the neighbours' OCR feeds the scoped page-break devices.
    const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: PAGE_PROJECTION }).toArray();
    const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
    const prevRead = prev ? readOf(prev.id) : '';
    const previousTranslation = prevRead && !cliChatterReason(prevRead) ? sanitizeTranslationTags(prevRead) : prev?.translation?.data || null;
    const built = buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data, previousTranslation, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const instruction = INSTRUCTIONS[id] || null;
    const sent = built.prompt + (instruction ? `\n\n${instruction}` : '') + CLI_SUFFIX;
    const reuseKey = translationReuseKey({ prompt_ref: built.promptRef, ocr_hash: contentHash(p.ocr.data), prompt_variant: PROMPT_VARIANT, instruction });
    if (!FRESH) {
      const hit = await findRead({ page_id: id, book_id: p.book_id, field: 'translation', model: MODEL, prompt_hash: reuseKey, derive: (m) => (m.cli === CLI ? translationReuseKey(m) : null) });
      if (hit && await reuseInto(OUT, id, hit)) { reused++; console.log(`  ${p.page_number} reused a kept read (${hit.body.job ?? '?'}, ${hit.body.read_at?.slice(0, 10) ?? '?'}): no call`); continue; }
    }
    // --reuse-only (#7075): a paid lane hands its pages here first; a page with no kept read is left to that lane.
    if (REUSE_ONLY) { noKept++; continue; }
    // Folio markers (#7118): this page and the next one in the list, when it is page N+1 of the same book and needs a
    // read too, go in ONE call as continuous English with <pb n="N"/> where each page begins; each page keeps its span.
    // Measured on Latin-script prose only, so only there. Any reply that does not split cleanly falls back to the
    // one-page read below, so a pair is never worse off than the lane without markers.
    if (MARKERS && !instruction && i + 1 < ids.length) {
      const pair = await readMarkedPair({ p, book, prev, previousTranslation, prevRead, nextId: ids[i + 1] });
      if (pair === 'read') { paired++; i++; continue; }
      if (pair === 'fallback') pairFallbacks++;
    }
    const t0 = new Date();
    // Plan mode, never auto-approve, the tool gate in an empty workspace, up to 3 calls on an empty or failed reply.
    const call = () => gatedTextCall(sent, { model: MODEL, task: 'translate', onCall: (c) => logCall({ kind: 'translate', seconds: Math.round(c.secs), ok: !c.cls, error_class: c.cls, usage: c.usage }) });
    let r = await call();
    // #5055: a reply the write guard calls cut (a tag left open at its tail, the text ending inside a tag, English far
    // shorter than its source) is read once more; apply's door refuses it if the second read is cut too.
    if (!r.cls && !r.problem && checkWrittenText(r.answer, { kind: 'translation', source: p.ocr.data, lang: book?.language, type: p.page_type }).verdict === 'truncated') {
      console.log(`  ${p.page_number} read looks cut (write guard): reading once more`);
      const again = await call();
      r = { ...again, calls: (r.calls || 1) + (again.calls || 1), usage_first_read: r.usage };
    }
    if (r.cls === 'quota') { console.error(`QUOTA reached at p.${p.page_number}: stopping. ${r.err}`); await client.close(); process.exit(3); }
    // The raw reply is kept beside the translation; `.txt` holds only what was between the markers.
    const text = r.cls ? '' : r.answer;
    fs.writeFileSync(path.join(OUT, `${id}.raw.txt`), r.text);
    fs.writeFileSync(path.join(OUT, `${id}.txt`), text);
    const meta = {
      page_id: id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, model: MODEL,
      started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: r.code === null ? -9 : r.code, error_class: r.cls, attempts: r.calls, chars: text.length,
      prompt_variant: PROMPT_VARIANT, wrapper: r.cls ? null : r.problem, tool_calls: r.tool_calls,
      ocr_hash: contentHash(p.ocr.data), ocr_updated_at: p.ocr.updated_at ?? null, prompt_ref: built.promptRef, is_english_book: built.isEnglish,
      prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), ...(instruction && { instruction }),
      // agy's own token counts for the call that produced this read (the last attempt; a cut first read's are kept
      // beside it). The quota is charged by token cost, so this is what a page costs (#7503).
      call_usage: agyUsage(r.usage), ...(r.usage_first_read && { call_usage_first_read: agyUsage(r.usage_first_read) }),
      context: { previous_translation: !!previousTranslation, previous_from: prevRead && previousTranslation !== prev?.translation?.data ? 'cli-read' : previousTranslation ? 'stored' : null, prev_ocr: !!prev?.ocr?.data, next_ocr: !!next?.ocr?.data, page_break: pageBreakVariant(PAGE_BREAK_SCOPED), prompt_variant: PROMPT_VARIANT },
      stderr_tail: r.err,
    };
    fs.writeFileSync(path.join(OUT, `${id}.meta.json`), JSON.stringify(meta, null, 1));
    // Kept the moment it is paid for (#7075); best effort, never fails the read.
    if (!meta.error_class && !meta.wrapper && meta.exit === 0) await keepRead({ page_id: id, book_id: p.book_id, page_number: p.page_number, field: 'translation', text, model: MODEL, prompt_hash: reuseKey, job: JOB, meta, source_path: path.join(OUT, `${id}.txt`) });
    console.log(`  ${p.page_number} ${r.cls || r.problem || 'ok'} ${text.length} chars ${Math.round((Date.now() - t0) / 1000)}s calls ${r.calls}`);
  }
  if (MARKERS) console.log(`folio markers: ${paired} page pair(s) read in one marked call; ${pairFallbacks} pair(s) fell back to one page per call`);
  console.log(`reused ${reused} kept read(s) instead of calling${FRESH ? ' (--fresh: none looked up)' : ''}`);
  if (REUSE_ONLY) console.log(`reuse-only: ${noKept} page(s) had no matching kept read and were not called`);
  await client.close();
  process.exit(0);
}

// ── apply ──
const REASON = arg('reason');
if (!REASON) { console.error('--reason is required: say why these pages are being translated through the CLI'); process.exit(2); }
const metas = fs.readdirSync(OUT).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))).sort((a, b) => a.page_number - b.page_number);
const runId = `cli-translate-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const tally = { written: 0, skipped: {} };
const skip = (m, why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; console.log(`  skip p.${m.page_number}: ${why}`); };
const books = {};
for (const m of metas) {
  const text = readOf(m.page_id);
  if (m.exit !== 0 && text.length < 5) { skip(m, `cli exit ${m.exit}`); continue; }
  if (m.error_class) { skip(m, `cli ${m.error_class}`); continue; }
  // #6523: text outside the markers, or a reply cut before <<<END>>> (often a recitation-filter cut), is never written
  if (m.wrapper) { skip(m, `reply wrapper: ${m.wrapper}`); continue; }
  // #5055: a claude-translate / twopass-review read whose raw reply the write guard called cut (its .txt is already
  // tag-repaired, so only the meta can say); a Gemini read's raw .txt is checked by the door itself.
  if (m.write_guard === 'truncated') { skip(m, `write-guard:truncated:${(m.write_guard_reasons || [])[0]?.replace(/[:(].*$/, '') ?? ''}`); continue; }
  // the backstop, for every read: chatter where the translation should be
  const chatter = cliChatterReason(text);
  if (chatter) { skip(m, `not a translation: ${chatter}`); continue; }
  const page = await db.collection('pages').findOne({ id: m.page_id }, { projection: PAGE_PROJECTION });
  if (!page) { skip(m, 'page not found'); continue; }
  if (contentHash(page.ocr?.data || '') !== m.ocr_hash) { skip(m, 'OCR changed since the read'); continue; }
  const book = await db.collection('books').findOne({ id: page.book_id });
  if (unsplitReadRefusal(book, page)) { skip(m, 'unsplit spread book (#7605)'); continue; }
  // #7075: on a bilingual page whose facing side is printed English (a Loeb), a read can hand that English back instead
  // of translating (Plutarch Loeb 99 p.94: 77% of the read was one verbatim run of the page). The door's echo tier
  // exempts English already in the source, so it is asked here, for the CLI readers only.
  if (copiesPrintedEnglish({ ocr: page.ocr?.data || '', tr: text, lang: book?.language })) { skip(m, 'copies the English printed on the page'); continue; }
  const sentHash = m.prompt_sent_hash;
  // A claude-translate.mjs read names the file holding the exact prompt its call sent: hash that, not the meta's word.
  if (m.prompt_sent_file && contentHash(fs.readFileSync(path.join(OUT, m.prompt_sent_file), 'utf8')) !== sentHash) { skip(m, 'prompt sent does not match its recorded hash'); continue; }
  console.log(`  ${APPLY ? 'WRITE' : 'would write'} p.${page.page_number} (${page.translation?.model ?? 'no translation'} -> ${m.model}, ${text.length} chars)`);
  if (!APPLY) { tally.written++; continue; }
  // The door builds an engine block from `call`, which has no CLI field; build it here so the CLI's name and version are recorded.
  const engine = geminiEngine({
    // `cli: 'claude'` is Anthropic's model through the Claude CLI on the subscription (scripts/batch/claude-translate.mjs).
    name: engineNameForCli(m.cli), call_site: CALL_SITE, api: 'cli', cli: { name: m.cli, version: m.cli_version }, model: m.model,
    prompt: { id: m.prompt_ref?.id, name: m.prompt_ref?.name, version: m.prompt_ref?.version, hash: m.prompt_ref?.content_hash, sent_hash: sentHash, sent_chars: m.prompt_sent_chars },
    generationConfig: notRecorded(`${m.cli} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
    // A two-pass read (#6865: a Gemini draft reviewed by Opus against the image) lists both passes in its meta.
    run: { job_id: runId, code_version: await codeVersion(), host: host(), at: new Date(m.finished_at), read_started_at: m.started_at, ...(m.read_site && { read_site: m.read_site, read_call: m.call_id }), ...(m.passes && { passes: m.passes }), reason: REASON },
    // The lane's suffix (#7499): a read made before the context carried it still names it in its meta.
    input: translationInput({ ocrText: page.ocr?.data ?? '', ocrUpdatedAt: page.ocr?.updated_at, context: m.prompt_variant && m.context ? { prompt_variant: m.prompt_variant, ...m.context } : m.context }),
  });
  const res = await writePageTranslation(db, { page, book, text, promptRef: m.prompt_ref, model: m.model, jobId: runId, note: 'translate_cli', refuseUnhealthy: true, engine });
  if (res.protected) { skip(m, 'human-edited translation'); continue; }
  if (res.truncated) { skip(m, res.reason); continue; }
  if (res.unhealthy) { skip(m, `refused by the door: ${res.reason}`); continue; }
  // #7503: the door snapshots only a page that HAD English, with no run id, so revert-run.mjs found nothing to undo. A
  // page-text-writer row (the prior field, whole or absent, and the hash of what landed) makes `revert-run.mjs --run-id`
  // work on this run; it is read back after the write, so next_hash is the stored text, not the read.
  const landed = await db.collection('pages').findOne({ id: page.id }, { projection: { translation: 1 } });
  await db.collection('page_revisions').insertOne(buildTextRevision({ page, field: 'translation', next: landed?.translation ?? null, opts: { by: CALL_SITE, reason: REASON, run_id: runId }, now: new Date(), id: randomBytes(6).toString('hex') }));
  await recordSweepAction(db, { sweep: 'cli-translate', book_id: page.book_id, action: 'translated-through-cli', detail: { page_id: page.id, page_number: page.page_number, from_model: page.translation?.model ?? null, to_model: m.model, cli: `${m.cli} ${m.cli_version}`, run: runId, reason: REASON } });
  (books[page.book_id] ??= { nums: [], models: new Set() }).nums.push(page.page_number);
  books[page.book_id].models.add(m.model);
  tally.written++;
}
if (APPLY) {
  for (const [bookId, { nums, models }] of Object.entries(books)) {
    await syncBookTranslationCounters(db, bookId);
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'translated_cli', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', models: [...models], pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON } });
  }
}
console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written}   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? `   run ${runId}` : '   (dry run; add --apply)'}`);
await client.close();
