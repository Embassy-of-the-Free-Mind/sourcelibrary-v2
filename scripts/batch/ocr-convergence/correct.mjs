#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-ocr.mjs (the sealed `claude -p --restricted --tools Read` OCR reader on the
// subscription, 10 pages a call under `===== PAGE pNN =====` markers; its splitPages() is imported here and its read
// dir shape is kept so `cli-ocr.mjs apply` can write these texts) — it reads only pages with NO OCR and never sees the
// stored text. scripts/eval/paddle-correct-6561/mkreq.mjs (the draft block: correct a draft against the image, the
// arm that won on Paddle Chinese) — an eval with one page per call and no write path. ./driver.mjs runSealed (the
// stream-json transcript that proves the image was opened). None of them corrects the served text in place across
// languages with an UNCHANGED / CONTAIN answer per page. This is arm B of #6694.
/**
 * #6694 arm B: Opus corrects the STORED transcription against the image, in place. One sealed `claude -p` call per
 * book (at most --per-call pages, default 10), images p01.jpg … and drafts d01.txt … in a folder holding nothing else.
 * Per page the model answers, under `===== PAGE pNN =====`, with the complete corrected transcription, or the single
 * line UNCHANGED, or `CONTAIN: <reason>` (not this leaf's text, or the leaf cannot be read).
 *
 *   node --env-file=.env.production.local scripts/batch/ocr-convergence/correct.mjs --set-dir=DIR [--model=opus]
 *        [--per-call=10] [--concurrency=4] [--job=NAME]
 *
 * Reads DIR/manifest.jsonl (driver.mjs select). Writes DIR/reads/ in the claude-ocr.mjs shape (<page_id>.txt +
 * .meta.json, prompts/<hash>.txt, prompt-ref.json, the image at ws-<id>/<id>.jpg as cli-ocr.mjs keeps it), the stored
 * text it corrected at DIR/stored/<id>.txt, and DIR/calls.jsonl. Writes NOTHING to the database.
 *
 * A page counts as answered only if the reply's markers are exactly p01..pNN in order AND the transcript shows the
 * model opened that page's image and draft. Anything else is "no answer" (never a write): the call is tried once more,
 * then each page alone. A corrected text that fails the chatter guard is no answer too. meta.outcome is one of
 * corrected | unchanged | contain | no-answer; only `corrected` has exit 0 (so `cli-ocr.mjs apply` can only ever
 * write a correction). A usage-limit reply stops the run (exit 3); re-running skips pages already answered.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { contentHash } from '../../lib/write-provenance.mjs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { splitPages } from '../claude-ocr.mjs';

const READ_SITE = 'scripts/batch/ocr-convergence/correct.mjs';
const CLI = 'claude';
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SETDIR = arg('set-dir') && path.resolve(arg('set-dir'));
const OUT = SETDIR && path.join(SETDIR, 'reads');
const MODEL = arg('model', 'opus');
const PER_CALL = Math.max(1, Math.min(10, Number(arg('per-call', 10))));
const CONCURRENCY = Math.max(1, Math.min(8, Number(arg('concurrency', 4))));
const JOB = arg('job', 'opus-correct-6694');
const pageName = (i) => `p${String(i + 1).padStart(2, '0')}`;
const draftName = (i) => `d${String(i + 1).padStart(2, '0')}`;

/** The block that turns the live OCR prompt into a correction. Part of the prompt SENT, so part of what is hashed. */
export function correctInstruction(n) {
  const names = Array.from({ length: n }, (_, i) => `${pageName(i)}.jpg with ${draftName(i)}.txt`);
  return `\n\n**This call: correct ${n} existing transcription${n > 1 ? 's' : ''} against the page image${n > 1 ? 's' : ''}.** In this folder, ${names.join('; ')}. Each image is a page of one book${n > 1 ? ', in order' : ''}; each .txt file is the transcription a library currently gives readers for that page, made by an OCR engine. It may contain misread words, letters or numbers, dropped or repeated lines, a missed column or marginal note, or text that is not on the page. Open every image and every draft with the Read tool. The IMAGE is the authority.
For each page, check the draft against the image line by line and answer with exactly one of:
- \`UNCHANGED\` (that word alone) — the draft is a faithful transcription of this leaf: any differences from the image are spacing, punctuation, line breaks or conventions (tags, abbreviation expansion, the long s) that do not change what a reader learns.
- \`CONTAIN: <one sentence>\` — the draft is not this leaf's text (another page's text, a different work, an invention), or the leaf cannot be read; say which and why.
- The complete corrected transcription of the page, not a list of changes, in the format above: its metadata tags as the format above defines them, always including <page-type>, even where the draft uses older tags (such as <lang>). Keep the draft's conventions and layout where the image does not contradict them; change what the image contradicts, add what the draft left out, remove what the page does not print. Do not change a word the image supports, even where another reading would be more usual. Transcribe each page on its own: never carry text over from a neighbouring page.
Answer with, for each page in order, a line \`===== PAGE pNN =====\` (the image name without .jpg) followed by that page's answer. Output nothing before the first marker and no commentary anywhere.
`;
}

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
const USAGE_LIMIT = /usage limit|limit reached|hit your (?:usage )?limit|out of extra usage|rate.?limit|\b429\b|resets? (?:at )?\d/i;

/** One sealed call with a stream-json transcript, so the files the model opened can be checked. */
function claudeCall(prompt, cwd, transcript) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const fd = fs.openSync(transcript, 'w');
    const child = spawn(CLI, ['-p', prompt, '--model', MODEL, '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd, stdio: ['ignore', fd, 'pipe'], env: claudeEnv() });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 45 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(fd);
      const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const res = lines.findLast((l) => l.type === 'result') || {};
      const opened = new Set();
      for (const l of lines) for (const c of (l.type === 'assistant' && Array.isArray(l.message?.content) ? l.message.content : [])) if (c.type === 'tool_use' && c.name === 'Read' && c.input?.file_path) opened.add(path.basename(c.input.file_path));
      const text = String(res.result ?? '').trim();
      const models = Object.keys(res.modelUsage || {});
      const failed = res.is_error || code !== 0;
      const all = text + err + lines.filter((l) => l.type === 'assistant').map((l) => JSON.stringify(l.message?.content || '')).join('').slice(-2000);
      const cls = failed && USAGE_LIMIT.test(all) ? 'usage_limit' : code === null ? 'timeout' : failed ? `exit_${code}` : !text ? 'empty' : null;
      resolve({ text, opened, model: models.find((m) => /opus|sonnet|haiku|fable/.test(m)) || models[0] || null, usage: res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens, cache_read: res.usage.cache_read_input_tokens, turns: res.num_turns, list_cost_usd: res.total_cost_usd } : null, code, cls, err: (err || (failed ? text : '')).slice(-300), secs: (Date.now() - t0) / 1000 });
    });
  });
}

/**
 * The reply split into its n answers (splitPages: markers exactly p01..pNN, or null). A short lead-in before the first
 * marker ("Corrections follow") is dropped and returned as `preamble`; anything longer, or with a tag in it, is left in
 * place, and splitPages() refuses the whole reply.
 */
export function splitAnswers(text, n) {
  const t = String(text || '');
  const first = t.search(/^[ \t]*=====\s*PAGE\s+p01\s*=====/m);
  const preamble = first > 0 && first < 300 && !/[<>]/.test(t.slice(0, first)) ? t.slice(0, first).trim() : null;
  return { answers: splitPages(preamble ? t.slice(first) : t, n), preamble };
}

/** One page's answer: { outcome, text?, reason? }. */
export function parseAnswer(ans) {
  const a = String(ans || '').trim();
  if (/^UNCHANGED\.?$/i.test(a)) return { outcome: 'unchanged' };
  const c = a.match(/^CONTAIN\s*:\s*([\s\S]+)$/i);
  if (c && c[1].length < 600 && !/<page-type>/.test(a)) return { outcome: 'contain', reason: c[1].trim() };
  if (!a) return { outcome: 'no-answer', reason: 'empty answer' };
  const problem = ocrReadProblem(a);
  if (problem) return { outcome: 'no-answer', reason: `chatter guard: ${problem}` };
  return { outcome: 'corrected', text: a };
}

async function main() {
  if (!SETDIR) { console.error('--set-dir=DIR is required (see the header)'); process.exit(2); }
  const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
  if (!version) { console.error(`${CLI} is not on PATH`); process.exit(1); }
  const manifest = fs.readFileSync(path.join(SETDIR, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const db = client.db('bookstore');
  const pages = await db.collection('pages').find({ id: { $in: manifest.map((m) => m.page_id) } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.model': 1 } }).sort({ book_id: 1, page_number: 1 }).toArray();
  const { base, ref } = await liveOcrPrompt(db);
  await client.close();
  fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(SETDIR, 'stored'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify(ref));
  const done = (p) => { const f = path.join(OUT, `${p.id}.meta.json`); return fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).outcome !== 'no-answer'; };
  const todo = pages.filter((p) => !done(p));
  const calls = [];
  for (const p of todo) { const last = calls[calls.length - 1]; if (last && last[0].book_id === p.book_id && last.length < PER_CALL) last.push(p); else calls.push([p]); }
  console.log(`${pages.length} pages; ${todo.length} to correct in ${calls.length} calls; ${MODEL}; ${CLI} ${version}; ${CONCURRENCY} at a time; prompt ${ref.name} v${ref.version}`);

  const sealRoot = path.join(process.env.TMPDIR || os.tmpdir(), 'ocr-correct-sealed', path.basename(SETDIR));
  const callLog = path.join(SETDIR, 'calls.jsonl');
  fs.mkdirSync(path.join(SETDIR, 'transcripts'), { recursive: true });
  let stop = null, nCalls = 0;
  const imgs = new Map();
  const fetchImage = async (p) => {
    if (imgs.has(p.id)) return imgs.get(p.id);
    const src = getPageSource(p);
    if (!src) return { error: 'no usable image' };
    const res = await fetch(src);
    if (!res.ok) return { error: `image HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const v = { src, buf, sha: createHash('sha256').update(buf).digest('hex') };
    const ws = path.join(OUT, `ws-${p.id}`); fs.mkdirSync(ws, { recursive: true }); fs.writeFileSync(path.join(ws, `${p.id}.jpg`), buf);
    imgs.set(p.id, v);
    return v;
  };
  const writePage = (p, ans, meta) => {
    fs.writeFileSync(path.join(OUT, `${p.id}.txt`), ans.outcome === 'corrected' ? ans.text : '');
    fs.writeFileSync(path.join(OUT, `${p.id}.meta.json`), JSON.stringify({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cli: CLI, cli_version: version, read_site: READ_SITE, ...meta, outcome: ans.outcome, reason: ans.reason ?? null, exit: ans.outcome === 'corrected' ? 0 : 1, error_class: ans.outcome === 'corrected' ? null : ans.outcome, chars: ans.text?.length ?? 0, stored_model: p.ocr?.model ?? null, stored_updated_at: p.ocr?.updated_at ?? null, stored_sha256: contentHash(p.ocr?.data || '') }, null, 1));
  };

  /** One call over a group. Returns the pages left unanswered. */
  const correctGroup = async (group, attempt) => {
    const im = [];
    for (const p of group) { const v = await fetchImage(p); if (v.error) { writePage(p, { outcome: 'no-answer', reason: v.error }, { model: MODEL, started_at: new Date().toISOString() }); return group.filter((q) => q !== p); } im.push(v); }
    const callId = `${JOB}-${group[0].book_id}-${group[0].page_number}-${group.length}-${attempt}`;
    const dir = path.join(sealRoot, callId);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    group.forEach((p, i) => {
      fs.writeFileSync(path.join(dir, `${pageName(i)}.jpg`), im[i].buf);
      fs.writeFileSync(path.join(dir, `${draftName(i)}.txt`), p.ocr?.data || '');
      fs.writeFileSync(path.join(SETDIR, 'stored', `${p.id}.txt`), p.ocr?.data || '');
    });
    const sent = base + correctInstruction(group.length);
    const sentHash = contentHash(sent);
    const promptFile = path.join('prompts', `${sentHash}.txt`);
    if (!fs.existsSync(path.join(OUT, promptFile))) fs.writeFileSync(path.join(OUT, promptFile), sent);
    const t0 = new Date();
    const r = await claudeCall(sent, dir, path.join(SETDIR, 'transcripts', `${callId}.jsonl`)); nCalls++;
    fs.rmSync(dir, { recursive: true, force: true });
    const { answers, preamble } = r.cls ? { answers: null, preamble: null } : splitAnswers(r.text, group.length);
    fs.appendFileSync(callLog, JSON.stringify({ ts: new Date().toISOString(), call_id: callId, book_id: group[0].book_id, pages: group.map((p) => p.page_number), model: r.model, secs: Math.round(r.secs), cls: r.cls || (answers ? null : 'page_count_mismatch'), preamble, opened: [...r.opened].sort(), usage: r.usage }) + '\n');
    if (r.cls === 'usage_limit') { stop = `usage limit: ${r.err || r.text.slice(0, 200)}`; return group; }
    if (!answers) { console.log(`  ${group[0].book_id} p.${group[0].page_number}+${group.length}: ${r.cls || 'markers do not match'} (${Math.round(r.secs)}s)`); return group; }
    const left = [];
    const common = { model: r.model || MODEL, model_requested: MODEL, call_id: callId, call_pages: group.length, started_at: t0.toISOString(), finished_at: new Date().toISOString(), prompt_sent_chars: sent.length, prompt_sent_hash: sentHash, prompt_sent_file: promptFile, call_usage: r.usage };
    const tally = {};
    group.forEach((p, i) => {
      // An answer the model gave without opening this page's image and draft is no answer.
      if (!r.opened.has(`${pageName(i)}.jpg`) || !r.opened.has(`${draftName(i)}.txt`)) { left.push(p); tally['not-opened'] = (tally['not-opened'] || 0) + 1; return; }
      const ans = parseAnswer(answers[i]);
      if (ans.outcome === 'no-answer') { left.push(p); tally[ans.reason] = (tally[ans.reason] || 0) + 1; return; }
      writePage(p, ans, { ...common, call_position: i + 1, image_url: im[i].src, image_bytes: im[i].buf.length, image_sha256: im[i].sha });
      tally[ans.outcome] = (tally[ans.outcome] || 0) + 1;
    });
    console.log(`  ${group[0].book_id} p.${group[0].page_number}+${group.length}: ${JSON.stringify(tally)} (${Math.round(r.secs)}s)`);
    return left;
  };

  const queue = [...calls];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length && !stop) {
      const group = queue.shift();
      let left = await correctGroup(group, 0);
      if (left.length && !stop) left = await correctGroup(left, 1);
      if (left.length > 1 && !stop) { const still = []; for (const p of left) { if (stop) break; still.push(...await correctGroup([p], 2)); } left = still; }
      if (!stop) for (const p of left) writePage(p, { outcome: 'no-answer', reason: 'no usable answer after 3 tries' }, { model: MODEL, started_at: new Date().toISOString() });
    }
  }));
  const metas = pages.map((p) => path.join(OUT, `${p.id}.meta.json`)).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const t = {}; for (const m of metas) t[m.outcome] = (t[m.outcome] || 0) + 1;
  console.log(`\n${JSON.stringify(t)}; ${pages.length - metas.length} not reached; ${nCalls} calls this run`);
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
