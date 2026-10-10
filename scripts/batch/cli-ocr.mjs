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
 * HOW IT FAILS: a CLI that is not signed in, or a refusal, leaves an empty .txt and a non-zero `exit` in the meta;
 * `apply` skips those and says so. Nothing is retried silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { readPageIdsFile } from '../lib/ocr-targeting.mjs';
import { saveRevisionBeforeOverwrite } from '../lib/page-revisions.mjs';
import { geminiEngine, imageInput, ocrProvenance, notRecorded, contentHash, codeVersion, host } from '../lib/write-provenance.mjs';
import { liftOcrTags, parseDetectedImages } from '../lib/ocr-result-parse.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { ocrReadProblem } from '../lib/cli-chatter.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { markTranslationsStale } from '../lib/syriac-kraken-lane.mjs';

const CALL_SITE = 'scripts/batch/cli-ocr.mjs';
const CLI = 'agy';
const STAGE = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') && path.resolve(arg('out'));
const MODEL = arg('model') || 'gemini-3.8-flash-low';
const APPLY = process.argv.includes('--apply');
if (!['read', 'apply'].includes(STAGE) || !OUT) { console.error('usage: cli-ocr.mjs read|apply --out=DIR ... (see the header)'); process.exit(2); }

const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';
// The sentence that points the CLI at the image. It is part of the prompt SENT, so it is part of what is hashed.
// The image is ATTACHED with the CLI's `@file` syntax (relative to cwd), so the model needs no tool to open it.
const imageInstruction = (imagePath) => `\n\nThe page image to transcribe is attached: @./${path.basename(imagePath)} Transcribe it. Output only the transcription in the format above, with no preamble and no commentary.\n`;
// The CLI is an AGENT. Plan mode stops it running tools; without it the model sometimes tries a shell command
// (seen: cropping a Chinese page into columns in /tmp), and the auto-approve flag this script used to pass let it
// run as root on the box. Never auto-approve; tests/unit/no-cli-auto-approve.test.ts sweeps for the flag.
const CLI_SAFE_ARGS = ['--mode', 'plan', '--print-timeout', '120s', '--output-format', 'json'];
const workspaceImage = (key) => path.join(OUT, `ws-${key}`, `${key}.jpg`);
// Even in plan mode the model sometimes asks for a shell command (to crop the image); headless mode denies it and the
// turn ends empty with `denied_actions` set. The #6331 fix: continue THAT conversation once with this nudge
// (scripts/eval/run-cli-arm.py, same words).
const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
const QUOTA = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b/i;
// The account's shared call meter (run-cli-arm.py writes the same rows): every job's calls, one line each.
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const JOB = arg('job') || 'cli-ocr';
const logCall = (row) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: JOB, kind: 'ocr', ...row }) + '\n'); } catch { /* the meter is advisory */ } };

/** One `agy -p` call, async so several pages can be in flight. Resolves {text, conversation, denied, code, cls, secs}. */
function agyCall(args, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(CLI, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON: an error or an old CLI */ }
      const text = String((j && j.response) ?? (Object.keys(j).length ? '' : out)).trim();
      const denied = (j.denied_actions || []).map((d) => d.action);
      const cls = QUOTA.test(out + err) ? 'quota' : code === null ? 'timeout' : code !== 0 ? `exit_${code}` : !text ? (denied.length ? 'denied_tool' : 'empty') : null;
      resolve({ text, conversation: j.conversation_id || null, denied, code, cls, err: err.slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');

if (STAGE === 'read') {
  const ids = readPageIdsFile(arg('page-ids-file'));
  const prompt = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');
  const base = prompt.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prompt-base.txt'), base);
  fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify({ id: prompt._id?.toString(), name: prompt.name, version: String(prompt.version ?? ''), hash: prompt.content_hash ?? null }));
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not installed or not on PATH`); process.exit(1); }
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray();
  const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('concurrency') || 1)));
  const QUOTA_SLEEP_S = Number(arg('quota-sleep') || 1800);
  console.log(`${pages.length} of ${ids.length} page ids found; model ${MODEL}; ${CLI} ${version}; ${CONCURRENCY} at a time`);
  let quotaUntil = 0;
  const readOne = async (p) => {
    const key = p.id;
    if (fs.existsSync(path.join(OUT, `${key}.meta.json`)) && fs.readFileSync(path.join(OUT, `${key}.txt`), 'utf8').length > 5) { console.log(`  ${p.page_number} already read`); return; }
    // The page's own image, split-aware (#6420): on a page split from a spread `archived_photo` is the WHOLE spread,
    // and a read of it transcribes both pages onto one. getPageSource() is the resolver the OCR lanes use.
    const src = getPageSource(p);
    if (!src) { console.log(`  ${p.page_number} has no usable image; skipped`); return; }
    const res = await fetch(src);
    if (!res.ok) { console.log(`  ${p.page_number} image HTTP ${res.status}; skipped`); return; }
    const buf = Buffer.from(await res.arrayBuffer());
    // One directory per page, so the CLI's workspace holds exactly the one image it is asked to read.
    const img = workspaceImage(key);
    fs.mkdirSync(path.dirname(img), { recursive: true });
    fs.writeFileSync(img, buf);
    const sent = base + imageInstruction(img);
    const t0 = new Date();
    // Attempt 1; a denied tool continues that conversation once with the nudge; a reply that fails the chatter guard
    // (plan note, refusal, restarted or duplicated read) is read once more from scratch (#6420 rule 4). A quota error
    // sleeps until the window resets and tries the same page again: it is the account's limit, not the page's.
    let r, nudged = false, rereads = 0, calls = 0;
    for (;;) {
      while (Date.now() < quotaUntil) await new Promise((s) => setTimeout(s, 30_000));
      r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], path.dirname(img)); calls++;
      logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls });
      if (r.cls === 'quota') { quotaUntil = Date.now() + QUOTA_SLEEP_S * 1000; console.log(`  QUOTA at p.${p.page_number}: sleeping ${QUOTA_SLEEP_S}s`); continue; }
      if (r.cls === 'denied_tool' && r.conversation && !nudged) {
        nudged = true;
        r = await agyCall(['-p', NUDGE, '--model', MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], path.dirname(img)); calls++;
        logCall({ model: MODEL, seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls });
      }
      if (!r.cls && ocrReadProblem(r.text) && rereads === 0) { rereads++; continue; }
      break;
    }
    const text = r.text;
    fs.writeFileSync(path.join(OUT, `${key}.txt`), text);
    fs.writeFileSync(path.join(OUT, `${key}.meta.json`), JSON.stringify({
      page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, model: MODEL,
      started_at: t0.toISOString(), finished_at: new Date().toISOString(), exit: r.code === null ? -9 : r.code, error_class: r.cls,
      chars: text.length, nudged, rereads, calls, chatter: text ? ocrReadProblem(text) : null,
      image_url: src, image_bytes: buf.length, image_sha256: createHash('sha256').update(buf).digest('hex'),
      prompt_sent_chars: sent.length, prompt_sent_hash: contentHash(sent), stderr_tail: r.err,
    }, null, 1));
    console.log(`  ${p.page_number} ${r.cls || 'ok'}${nudged ? ' (nudged)' : ''}${rereads ? ' (re-read)' : ''} ${text.length} chars ${Math.round((Date.now() - t0) / 1000)}s`);
  };
  const queue = [...pages];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await readOne(queue.shift()); }));
  await client.close();
  process.exit(0);
}

// ── apply ──
const REASON = arg('reason');
if (!REASON) { console.error('--reason is required: say why these pages are being re-read'); process.exit(2); }
const base = fs.readFileSync(path.join(OUT, 'prompt-base.txt'), 'utf8');
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
const tally = { written: 0, skipped: {} };
const skip = (m, why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; console.log(`  skip p.${m.page_number}: ${why}`); };
const books = {};

for (const m of metas.sort((a, b) => a.page_number - b.page_number)) {
  const text = fs.readFileSync(path.join(OUT, `${m.key}.txt`), 'utf8').trim();
  if (m.exit !== 0) { skip(m, `cli exit ${m.exit}`); continue; }
  if (text.length < 5) { skip(m, 'empty read (refusal or blank)'); continue; }
  if (text.length > 25000) { skip(m, 'over 25k chars'); continue; }
  if (!/<page-type>/.test(text)) { skip(m, 'no <page-type> tag: not a transcription in the prompt format'); continue; }
  // The CLI is an agent, not an endpoint: a refusal arrives as exit 0 with prose. Aldine 1516 p.34 came back as two
  // false starts and then "I cannot provide a verbatim transcription ... Summary of the Page Content" (2026-10-08).
  if ((text.match(/<page-type>/g) || []).length !== 1 || (text.match(/<scan-quality>/g) || []).length > 1) { skip(m, 'more than one transcription header: restarted or refused read'); continue; }
  if (REFUSAL.test(text)) { skip(m, 'refusal or summary in place of a transcription'); continue; }
  const chatter = ocrReadProblem(text);
  if (chatter) { skip(m, `chatter guard: ${chatter}`); continue; }
  const loop = loopVerdict(text);
  if (loop.refuse) { skip(m, 'repetition loop'); continue; }
  const page = await db.collection('pages').findOne(m.page_id ? { id: m.page_id } : { book_id: m.book_id, page_number: m.page_number }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.data': 1 } });
  if (!page) { skip(m, 'page not found'); continue; }
  if (page.ocr?.edited_by || page.ocr?.source === 'manual') { skip(m, 'human-edited page'); continue; }
  // A re-read of a page that already has text should mostly agree with it. Below 40% shared words it is a different
  // text (a summary, a neighbouring leaf, an invention) or the stored read was: either way a person looks first.
  if (page.ocr?.data) {
    const was = longWords(page.ocr.data), now = longWords(text);
    const shared = [...now].filter((w) => was.has(w)).length / Math.max(1, now.size);
    if (was.size >= 40 && shared < MIN_SHARED) { skip(m, `only ${Math.round(shared * 100)}% of its words are in the stored read: check by eye`); continue; }
  }
  if (page.ocr?.updated_at && new Date(page.ocr.updated_at) > new Date(m.started_at)) { skip(m, `OCR was rewritten after this read (${page.ocr.model})`); continue; }
  // The prompt hashed is the prompt sent: rebuild it and require it to match what the read stage recorded.
  const sent = base + imageInstruction(workspaceImage(m.key));
  if (contentHash(sent) !== m.prompt_sent_hash) { skip(m, 'prompt sent cannot be reconstructed (hash mismatch)'); continue; }
  const imageUrl = m.image_url || page.archived_photo;
  const engine = geminiEngine({
    call_site: CALL_SITE, api: 'cli', cli: { name: m.cli, version: m.cli_version }, model: m.model,
    prompt: { ...ref, text: sent },
    generationConfig: notRecorded(`${m.cli} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
    run: { job_id: runId, code_version: CODE_VERSION, host: host(), at: new Date(m.finished_at), read_started_at: m.started_at, reason: REASON },
    input: { ...imageInput({ url: imageUrl, mime: 'image/jpeg', bytes: m.image_bytes }), image_sha256: m.image_sha256 },
  });
  const tags = liftOcrTags(text);
  const detectedImages = parseDetectedImages(text);
  console.log(`  ${APPLY ? 'WRITE' : 'would write'} p.${page.page_number} (${page.ocr?.model ?? 'no OCR'} -> ${m.model}, ${text.length} chars)`);
  if (!APPLY) { tally.written++; continue; }
  await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: 'reocr_cli' });
  const r = await db.collection('pages').updateOne(
    // Guard on the OCR timestamp read above: if another writer got in between, write nothing.
    { id: page.id, 'ocr.updated_at': page.ocr?.updated_at ?? { $exists: false } },
    { $set: {
      ocr: { data: text, language: 'auto-detect', model: m.model, updated_at: new Date(), source: 'ai', prompt_version: ref.version, prompt_id: ref.id, prompt_name: ref.name, ...ocrProvenance(text, engine) },
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
}

if (APPLY) {
  for (const [bookId, { nums, models }] of Object.entries(books)) {
    // The one counter writer (#5325): three of these pages may have had no OCR before.
    await recountBook(db, bookId, { reason: 'cli-ocr' });
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_reread', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', models: [...models], pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON } });
  }
}
console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written}   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? `   run ${runId}` : '   (dry run; add --apply)'}`);
await client.close();
