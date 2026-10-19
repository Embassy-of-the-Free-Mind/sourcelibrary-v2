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
 *   read   node --env-file=.env.production.local scripts/batch/cli-translate.mjs read --page-ids-file=F --out=DIR [--model=gemini-3.8-flash-low] [--ocr-checked="..."]
 *          Builds translate-core's single-page prompt from the stored OCR, asks the CLI, saves DIR/<page_id>.txt + .meta.json.
 *          Writes NOTHING to the database. Skips pages already read, pages with no translatable OCR, and blank pages.
 *          [--instructions-file=F]: JSON { page_id: "one line" } appended to that page's prompt (#6559: a Maya numeral the
 *          first read got wrong, named with its value from Beltrán's table). Recorded as `instruction` in the meta.
 *
 *   apply  node --env-file=.env.production.local scripts/batch/cli-translate.mjs apply --out=DIR --reason="..." [--apply]
 *          Dry run unless --apply. Per page refuses: a CLI failure, an empty read, chatter or a refusal in place of a
 *          translation, a page whose OCR changed since the read, and (inside the door) a human-edited translation or a
 *          read that fails the health check. Writes through writePageTranslation (translate-core: snapshot to
 *          page_revisions, provenance block with api 'cli', the CLI name and version, model and prompt hash), leaves a
 *          sweep_log row per page and one book_events row per book, and recounts the book.
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
 * HOW IT FAILS: a CLI that is not signed in, out of quota or timing out leaves an empty .txt and a non-zero `exit`
 * (up to 3 attempts in place); a quota error is logged to agy-calls.jsonl and the run STOPS rather than burning the
 * other jobs' quota. `apply` skips what it refuses and says why. Nothing is retried silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { readPageIdsFile } from '../lib/ocr-targeting.mjs';
import { ocrFirstGate } from '../lib/ocr-first-gate.mjs';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts, isTranslatablePage, sameLanguageReason, sanitizeTranslationTags, writePageTranslation, syncBookTranslationCounters, contentHash } from '../lib/translate-core.mjs';
import { cliChatterReason } from '../lib/cli-chatter.mjs';
import { CLI, gatedTextCall, TRANSLATE_SUFFIX } from '../lib/agy-cli.mjs';
import { geminiEngine, engineNameForCli, translationInput, notRecorded, codeVersion, host } from '../lib/write-provenance.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

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
const CLI_SUFFIX = TRANSLATE_SUFFIX;
const PAGE_PROJECTION = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 };
const logCall = (rec) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: JOB, model: MODEL, ...rec }) + '\n'); } catch { /* the box has the log dir; a laptop need not */ } };
const INSTRUCTIONS = arg('instructions-file') ? JSON.parse(fs.readFileSync(arg('instructions-file'), 'utf8')) : {};
const readOf = (id) => { try { return fs.readFileSync(path.join(OUT, `${id}.txt`), 'utf8').trim(); } catch { return ''; } };

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');

if (STAGE === 'read') {
  const ids = readPageIdsFile(arg('page-ids-file'));
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  const prompts = await loadTranslationPrompts(db);
  fs.mkdirSync(OUT, { recursive: true });
  const found = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: PAGE_PROJECTION }).toArray()).map((p) => [p.id, p]));
  console.log(`${found.size} of ${ids.length} page ids found; model ${MODEL}; ${CLI} ${version}`);
  // Check the transcription before paying for a translation on top of it (#6865).
  const gate = ocrFirstGate([...found.values()], arg('ocr-checked'));
  console.log(gate.message);
  if (!gate.ok) { await client.close(); process.exit(2); }
  const books = new Map();
  for (const id of ids) {   // the file's order, which is page order
    const p = found.get(id);
    if (!p) continue;
    if (fs.existsSync(path.join(OUT, `${id}.meta.json`)) && readOf(id).length > 5) { console.log(`  ${p.page_number} already read`); continue; }
    const tr = isTranslatablePage(p);
    if (!tr.ok) { console.log(`  ${p.page_number} not translatable (${tr.reason}); skipped`); continue; }
    if (!books.has(p.book_id)) books.set(p.book_id, await db.collection('books').findOne({ id: p.book_id }));
    const book = books.get(p.book_id);
    const same = sameLanguageReason({ book, page: p });
    if (same) { console.log(`  ${p.page_number} skipped: ${same}`); continue; }
    // Context exactly as the worker seeds it: the page before. Its English is the read just made if there is one
    // (nothing is stored until apply), else the stored translation; the neighbours' OCR feeds the scoped page-break devices.
    const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: PAGE_PROJECTION }).toArray();
    const prev = near.find((n) => n.page_number === p.page_number - 1), next = near.find((n) => n.page_number === p.page_number + 1);
    const prevRead = prev ? readOf(prev.id) : '';
    const previousTranslation = prevRead && !cliChatterReason(prevRead) ? sanitizeTranslationTags(prevRead) : prev?.translation?.data || null;
    const built = buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data, previousTranslation, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const instruction = INSTRUCTIONS[id] || null;
    const sent = built.prompt + (instruction ? `\n\n${instruction}` : '') + CLI_SUFFIX;
    const t0 = new Date();
    // Plan mode, never auto-approve, the tool gate in an empty workspace, up to 3 calls on an empty or failed reply.
    const r = await gatedTextCall(sent, { model: MODEL, task: 'translate', onCall: (c) => logCall({ kind: 'translate', seconds: Math.round(c.secs), ok: !c.cls, error_class: c.cls }) });
    if (r.cls === 'quota') { console.error(`QUOTA reached at p.${p.page_number}: stopping. ${r.err}`); await client.close(); process.exit(3); }
    // The raw reply is kept beside the translation; `.txt` holds only what was between the markers.
    const text = r.cls ? '' : r.answer;
    fs.writeFileSync(path.join(OUT, `${id}.raw.txt`), r.text);
    fs.writeFileSync(path.join(OUT, `${id}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${id}.meta.json`), JSON.stringify({
      page_id: id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, model: MODEL,
      started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: r.code === null ? -9 : r.code, error_class: r.cls, attempts: r.calls, chars: text.length,
      prompt_variant: PROMPT_VARIANT, wrapper: r.cls ? null : r.problem, tool_calls: r.tool_calls,
      ocr_hash: contentHash(p.ocr.data), ocr_updated_at: p.ocr.updated_at ?? null, prompt_ref: built.promptRef, is_english_book: built.isEnglish,
      prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), ...(instruction && { instruction }),
      context: { previous_translation: !!previousTranslation, previous_from: prevRead && previousTranslation !== prev?.translation?.data ? 'cli-read' : previousTranslation ? 'stored' : null, prev_ocr: !!prev?.ocr?.data, next_ocr: !!next?.ocr?.data, page_break: 'scoped' },
      stderr_tail: r.err,
    }, null, 1));
    console.log(`  ${p.page_number} ${r.cls || r.problem || 'ok'} ${text.length} chars ${Math.round((Date.now() - t0) / 1000)}s calls ${r.calls}`);
  }
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
  // the backstop, for every read: chatter where the translation should be
  const chatter = cliChatterReason(text);
  if (chatter) { skip(m, `not a translation: ${chatter}`); continue; }
  const page = await db.collection('pages').findOne({ id: m.page_id }, { projection: PAGE_PROJECTION });
  if (!page) { skip(m, 'page not found'); continue; }
  if (contentHash(page.ocr?.data || '') !== m.ocr_hash) { skip(m, 'OCR changed since the read'); continue; }
  const book = await db.collection('books').findOne({ id: page.book_id });
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
    input: translationInput({ ocrText: page.ocr?.data ?? '', ocrUpdatedAt: page.ocr?.updated_at, context: m.context }),
  });
  const res = await writePageTranslation(db, { page, book, text, promptRef: m.prompt_ref, model: m.model, jobId: runId, note: 'translate_cli', refuseUnhealthy: true, engine });
  if (res.protected) { skip(m, 'human-edited translation'); continue; }
  if (res.unhealthy) { skip(m, `refused by the door: ${res.reason}`); continue; }
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
