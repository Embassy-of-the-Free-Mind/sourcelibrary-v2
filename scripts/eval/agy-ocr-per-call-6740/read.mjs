#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs `read` (the one-page agy OCR request and correct mode, #6523/#6560) — it has
// no multi-page mode and records no token usage, so neither arm could be metered through it; scripts/batch/claude-ocr.mjs
// (the `===== PAGE pNN =====` block format, Opus only); scripts/eval/agy-per-call-7503 (block TRANSLATION, #7518).
// This is an EVAL-ONLY reader: at k = 1 it sends cli-ocr's request byte for byte (same prompt, image name, CLI args,
// tool gate, nudge and one re-read); at k > 1 it sends k adjacent pages in one call. It writes no page, keeps no read.
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/agy-ocr-per-call-6740/read.mjs \
 *        --task=T1|T2 --arm=A1|A1b|B2|C3 --scratch=DIR [--concurrency=3]
 *
 * T1 fresh read: the live OCR prompt (liveOcrPrompt) + cli-ocr's sentinel image instruction.
 * T2 correction: the #5924 one-page template (fc-prompt.mjs, the router tests' lite>agy-flash-low request) with the
 *    draft frozen at draw time. k > 1: correctInstruction(k) adapted the way fc-prompt.mjs adapts correctInstruction(1).
 * A block reply must carry exactly p01..pNN markers, in order, inside <<<BEGIN>>>/<<<END>>>. A reply that fails is
 * read once more; a second failure is a REFUSED BLOCK and each of its pages is read alone (counted: it is paid for).
 * Every call's usage (agy's input/output/thinking/cache_read tokens) goes to DIR/<task>/<arm>/calls.jsonl.
 * The first quota reply stops the arm (exit 3); re-running resumes. `agy -p /quota` is read before and after the arm.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { CLI, CLI_SAFE_ARGS, agyCall, installToolGate, gateCalls, unwrapRead, agyUsage } from '../../lib/agy-cli.mjs';
import { OCR_SENTINEL_INSTRUCTION, ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { checkWrittenText } from '../../lib/write-text-guard.mjs';
import { correctInstruction } from '../../batch/ocr-convergence/correct.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const TASK = arg('task'), ARM = arg('arm'), S = arg('scratch');
const K = { A1: 1, A1b: 1, B2: 2, C3: 3 }[ARM];
if (!['T1', 'T2'].includes(TASK) || !K || !S) { console.error('usage: read.mjs --task=T1|T2 --arm=A1|A1b|B2|C3 --scratch=DIR'); process.exit(2); }
const MODEL = 'gemini-3.8-flash-low';
const CONC = Number(arg('concurrency') || 3);
const OUT = path.join(S, TASK, ARM); fs.mkdirSync(OUT, { recursive: true });
const JOB = `agy-ocr-per-call-6740-${TASK}-${ARM}`;
process.env.AGY_JOB = JOB;
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const meter = (row) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: new Date().toISOString(), job: JOB, kind: 'ocr', model: MODEL, ...row }) + '\n'); } catch { /* advisory */ } };
const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'))[TASK];
const drafts = TASK === 'T2' ? new Map(zlib.gunzipSync(fs.readFileSync(path.join(S, 'drafts.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.page_id, r.draft])) : null;

// ── prompts ──────────────────────────────────────────────────────────────────
let base;
if (TASK === 'T1') {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  ({ base } = await liveOcrPrompt(c.db('bookstore'))); await c.close();
} else {
  const tpl = path.join(S, 'fc-correct-prompt.txt');
  if (!fs.existsSync(tpl)) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), tpl], { stdio: 'inherit', env: process.env, cwd: ROOT });
    if (r.status !== 0) process.exit(1);
  }
  base = fs.readFileSync(tpl, 'utf8');
}
const pName = (i) => `p${String(i + 1).padStart(2, '0')}`;
const SENT_BLOCK = 'Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.';
/** The request for one call. k = 1 is cli-ocr.mjs's (plain read: base + imageInstruction; correct: template + attachment). */
function request(pages, files) {
  const k = pages.length;
  if (TASK === 'T1') {
    if (k === 1) return `${base}\n\nThe page image to transcribe is attached: @./${files[0]} Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
    return `${base}\n\n**This call: ${k} page images.** The attached files ${files.map((f) => `@./${f}`).join(' ')} are consecutive pages of one book, in order. Transcribe each page separately and completely, following every rule above as if it were the only page: never carry text, a header or a heading over from a neighbouring page.\nBetween two marker lines, <<<BEGIN>>> and <<<END>>>, answer with, for each page in order, a line \`===== PAGE pNN =====\` (the file name without .jpg) followed by that page's transcription in the format above. ${SENT_BLOCK}\n`;
  }
  if (k === 1) return `${base.split('{draft}').join(drafts.get(pages[0].page_id))} @./${files[0]}`;
  const names = pages.map((_, i) => pName(i));
  const blockBase = base.slice(0, base.indexOf('\n\n**This call: correct one existing transcription'));
  if (blockBase.length === base.length || blockBase.length < 1000) throw new Error('fc template layout changed: the base prompt could not be cut out');
  const ins = correctInstruction(k)
    .replace(`In this folder, ${names.map((n, i) => `${n}.jpg with d${String(i + 1).padStart(2, '0')}.txt`).join('; ')}. Each image is a page of one book, in order; each .txt file is the transcription a library currently gives readers for that page, made by an OCR engine.`,
      `The images ${names.map((n) => `${n}.jpg`).join(', ')}, attached at the end of this message, are consecutive pages of one book, in order. The drafts, each between the lines DRAFT pNN START and DRAFT pNN END below, are the transcriptions a library currently gives readers for those pages, made by an OCR engine.`)
    .replace('Open every image and every draft with the Read tool. The IMAGE is the authority.', 'Open every image. The IMAGE is the authority.')
    .replace("Answer with, for each page in order, a line `===== PAGE pNN =====` (the image name without .jpg) followed by that page's answer. Output nothing before the first marker and no commentary anywhere.",
      `Between two marker lines, <<<BEGIN>>> and <<<END>>>, answer with, for each page in order, a line \`===== PAGE pNN =====\` (the image name without .jpg) followed by that page's answer (UNCHANGED, CONTAIN: …, or the corrected transcription). ${SENT_BLOCK}`);
  if (/Read tool|d01\.txt|nothing before the first marker/.test(ins)) throw new Error('correctInstruction(k) changed; the block adaptation no longer applies');
  return `${blockBase}${ins}${pages.map((p, i) => `\nDRAFT ${names[i]} START\n${drafts.get(p.page_id)}\nDRAFT ${names[i]} END\n`).join('')}\nThe page images: ${files.map((f) => `@./${f}`).join(' ')}`;
}

/** The per-page answers of a block reply, or why it is not one. */
function splitBlock(inside, k) {
  const parts = String(inside).split(/^\s*=====\s*PAGE\s+(p\d\d)\s*=====\s*$/m);
  const labels = parts.filter((_, i) => i % 2 === 1);
  if (parts[0].trim()) return { problem: 'text before the first PAGE marker' };
  if (labels.join() !== Array.from({ length: k }, (_, i) => pName(i)).join()) return { problem: `markers ${labels.join(',') || 'none'}` };
  return { texts: parts.filter((_, i) => i > 0 && i % 2 === 0).map((t) => t.trim()) };
}
const pageProblem = (t) => {
  if (TASK === 'T2' && (/^UNCHANGED\s*$/.test(t) || /^CONTAIN:/.test(t))) return null;
  return ocrReadProblem(t, { header: TASK === 'T1' }) || (checkWrittenText(t, { kind: 'ocr' }).verdict === 'truncated' ? 'truncated' : null);
};

// ── calls ────────────────────────────────────────────────────────────────────
const callsFile = path.join(OUT, 'calls.jsonl');
let stopped = null;
async function images(pages, ws, files) {
  for (let i = 0; i < pages.length; i++) {
    const r = await fetch(pages[i].image);
    if (!r.ok) throw new Error(`${pages[i].page_id}: image HTTP ${r.status}`);
    fs.writeFileSync(path.join(ws, files[i]), Buffer.from(await r.arrayBuffer()));
  }
}
/** One logical read of `pages` (1..k), with cli-ocr's nudge and one re-read. Resolves {texts|null, problem, attempts}. */
async function readBlock(pages, callId) {
  const k = pages.length;
  const ws = path.join(OUT, `ws-${callId}`); fs.mkdirSync(ws, { recursive: true });
  const files = k === 1 ? [`${pages[0].page_id}.jpg`] : pages.map((_, i) => `${pName(i)}.jpg`);
  await images(pages, ws, files);
  const sent = request(pages, files);
  fs.writeFileSync(path.join(OUT, `${callId}.prompt.txt`), sent);
  const gateLog = installToolGate(ws);
  let attempts = 0, nudged = false, last = null;
  for (let reread = 0; reread < 2; reread++) {
    if (stopped) return { texts: null, problem: 'stopped', attempts };
    let r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], ws); attempts++;
    const log = (r, kind) => { meter({ seconds: Math.round(r.secs * 10) / 10, ok: !r.cls, error_class: r.cls }); fs.appendFileSync(callsFile, JSON.stringify({ call_id: callId, kind, pages: pages.map((p) => p.page_id), cls: r.cls, secs: Math.round(r.secs * 10) / 10, usage: agyUsage(r.usage), not_called: !!r.not_called, at: new Date().toISOString() }) + '\n'); };
    if (r.cls === 'quota') { if (!r.not_called) log(r, 'quota'); stopped = r.err || 'quota'; return { texts: null, problem: 'quota', attempts }; }
    log(r, reread ? 'reread' : 'first');
    if (r.cls === 'denied_tool' && r.conversation && !nudged) { nudged = true; r = await agyCall(['-p', NUDGE, '--model', MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws); attempts++; log(r, 'nudge'); }
    fs.writeFileSync(path.join(OUT, `${callId}.raw${reread ? '-2' : ''}.txt`), r.text || '');
    if (r.cls) { last = r.cls; continue; }
    const { text, problem } = unwrapRead(r.text);
    if (problem) { last = problem; continue; }
    let texts;
    if (k === 1) texts = [text];
    else { const b = splitBlock(text, k); if (b.problem) { last = b.problem; continue; } texts = b.texts; }
    const bad = texts.map(pageProblem).find(Boolean);
    if (bad) { last = bad; if (reread === 0) continue; }
    return { texts, problem: bad || null, attempts, tools: gateCalls(gateLog) };
  }
  return { texts: null, problem: last, attempts, tools: gateCalls(gateLog) };
}

function savePage(p, text, extra) {
  let out = text ?? '', unchanged = false, contain = null;
  if (TASK === 'T2' && /^UNCHANGED\s*$/.test(out)) { unchanged = true; out = drafts.get(p.page_id); }
  else if (TASK === 'T2' && /^CONTAIN:/.test(out)) { contain = out; out = ''; }
  fs.writeFileSync(path.join(OUT, `${p.page_id}.txt`), out);
  fs.writeFileSync(path.join(OUT, `${p.page_id}.meta.json`), JSON.stringify({ page_id: p.page_id, page_number: p.page_number, task: TASK, arm: ARM, k: K, model: MODEL, cli: CLI, chars: out.length, unchanged, contain, sha: contentHash(out), ...extra }, null, 1));
}

const units = [];
for (const b of draw.books) {
  if (K === 1) for (const p of b.pages) units.push({ id: p.page_id, pages: [p], book: b.book_id });
  else units.push({ id: `${b.book_id}-${b.pages[0].page_number}`, pages: b.pages.slice(0, K), book: b.book_id });
}
if (process.argv.includes('--dry')) { const u = units[0]; console.log(request(u.pages, K === 1 ? [`${u.pages[0].page_id}.jpg`] : u.pages.map((_, j) => `${pName(j)}.jpg`))); process.exit(0); }
const quota = (tag) => { const r = spawnSync(CLI, ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8' }); try { fs.writeFileSync(path.join(OUT, `quota-${tag}.json`), JSON.stringify({ at: new Date().toISOString(), buckets: JSON.parse(r.stdout).command.data.groups.flatMap((g) => g.buckets.map((x) => ({ group: g.name, id: x.id, remaining: x.remaining_fraction, reset: x.reset_time }))) })); } catch { /* reading only */ } };
const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout?.trim();
if (!fs.existsSync(path.join(OUT, 'quota-start.json'))) quota('start');
const todo = units.filter((u) => !u.pages.every((p) => fs.existsSync(path.join(OUT, `${p.page_id}.meta.json`))));
console.log(`${TASK}/${ARM}: k=${K}, ${todo.length} of ${units.length} calls to make; ${MODEL}; ${CLI} ${version}`);
let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (!stopped && i < todo.length) {
    const u = todo[i++];
    const t0 = new Date();
    const r = await readBlock(u.pages, u.id);
    if (r.problem === 'stopped' || r.problem === 'quota') return;
    const common = { call_id: u.id, started_at: t0.toISOString(), finished_at: new Date().toISOString(), attempts: r.attempts, tools: r.tools };
    if (r.texts) { u.pages.forEach((p, j) => savePage(p, r.texts[j], { ...common, pos: j, problem: r.problem, alone: false })); console.log(`  ${u.id}: ok (${r.attempts} call${r.attempts > 1 ? 's' : ''})${r.problem ? ` [${r.problem}]` : ''}`); continue; }
    if (K === 1) { savePage(u.pages[0], '', { ...common, pos: 0, problem: r.problem, alone: false, failed: true }); console.log(`  ${u.id}: FAILED ${r.problem}`); continue; }
    // A refused block: each page alone, as claude-ocr.mjs does. Counted (refused_block) and paid for.
    console.log(`  ${u.id}: block refused (${r.problem}); reading its pages alone`);
    for (const [j, p] of u.pages.entries()) {
      const a = await readBlock([p], `${u.id}-alone${j + 1}`);
      if (a.problem === 'stopped' || a.problem === 'quota') return;
      savePage(p, a.texts?.[0] ?? '', { ...common, pos: j, problem: a.problem, alone: true, refused_block: r.problem, attempts_alone: a.attempts, failed: !a.texts });
    }
  }
}));
if (stopped) { console.log(`QUOTA: arm stopped (${String(stopped).slice(0, 160)}); re-run to resume`); process.exit(3); }
quota('end');
console.log(`${TASK}/${ARM}: done`);
