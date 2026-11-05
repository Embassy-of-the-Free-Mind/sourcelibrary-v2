#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/opus.mjs (one call per {uid, image, prompt} row, resumable out file,
// call ledger with a cap) — same row shape and resume rule, but it drives `claude -p`; this calls the paid Gemini API
// through scripts/lib/gemini-script-client.mjs (thinking default, usage logging), which opus.mjs has no route to.
// scripts/eval/lib/runners.mjs runGemini is the cross-provider eval harness; not used because the call config here
// must be production lite OCR's exactly (bulk-reocr-local.mjs OCR_GENERATION_CONFIG + BLOCK_NONE), set below.
//
// #7263: gemini-3.1-flash-lite corrects a GPU draft. Usage (cwd = scratch):
//   node --env-file=/root/sourcelibrary/.env.production.local run-lite.mjs --req=<req.jsonl> --out=<out.jsonl>
//        --arm=<label> [--no-image] [--uids=<json array file>] [--zh-agy-suffix] [--cap=400] [--par=4]
// --zh-agy-suffix: the request is a #6561 Opus correct row; swap its Opus suffix for the #6561 agy suffix (the
// Gemini arms' bytes) and refuse unless the head and suffix hash to paddle-correct-6561/results/prompt-ref.json.
// Nothing is written to Mongo; each call writes one gemini_usage row (endpoint below).
import fs from 'node:fs';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { sha, OPUS_SUFFIX, FMT, draftBlock } from '../paddle-correct-6561/batch/prompt.mjs';

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const REQ = arg('req'), OUT = arg('out'), ARM = arg('arm'), CAP = +arg('cap', 400), PAR = +arg('par', 4);
const NOIMG = has('no-image'), ZH = has('zh-agy-suffix');
if (!REQ || !OUT || !ARM) { console.error('need --req --out --arm'); process.exit(2); }
const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'scripts/eval/lite-correct-gpu-7263/run-lite.mjs';
const LEDGER = 'lite-calls.jsonl';
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY'].map((category) => ({ category, threshold: 'BLOCK_NONE' }));
// #6561 mkreq.mjs agySuffix, byte for byte (hash-checked below)
const AGY_SUFFIX = '\n\nThe page image to transcribe is the attached file. Output only the three sentinel lines and the transcription between them, with no preamble and no commentary.';
const REF = JSON.parse(fs.readFileSync(new URL('../paddle-correct-6561/results/prompt-ref.json', import.meta.url), 'utf8'));

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
let reqs = readJsonl(REQ);
if (arg('uids')) { const u = new Set(JSON.parse(fs.readFileSync(arg('uids'), 'utf8'))); reqs = reqs.filter((r) => u.has(r.uid)); }
if (ZH) {
  if (sha(AGY_SUFFIX) !== REF.agy_suffix_sha) { console.error('agy suffix hash drift'); process.exit(3); }
  reqs = reqs.map((r) => {
    if (!r.prompt.endsWith(OPUS_SUFFIX)) throw new Error(`${r.uid}: not an Opus correct row`);
    const i = r.prompt.indexOf(draftBlock('').split('===DRAFT===')[0]);
    if (sha(r.prompt.slice(0, i)) !== REF.head_sha) throw new Error(`${r.uid}: head hash drift`);
    if (!r.prompt.slice(0, -OPUS_SUFFIX.length).endsWith(FMT)) throw new Error(`${r.uid}: reply format drift`);
    return { ...r, prompt: r.prompt.slice(0, -OPUS_SUFFIX.length) + AGY_SUFFIX };
  });
}
const done = new Set(readJsonl(OUT).filter((r) => r.text && !r.error).map((r) => r.uid));
const used = () => readJsonl(LEDGER).length;
const todo = reqs.filter((r) => !done.has(r.uid));
console.log(`${ARM}: ${todo.length} to run of ${reqs.length}; ledger ${used()} / cap ${CAP}; image ${!NOIMG}`);

async function one(r) {
  const t0 = Date.now();
  let res, error = null, attempts = 0;
  for (; attempts < 3; ) {
    attempts++;
    try {
      res = await callGemini({
        model: MODEL, prompt: r.prompt, endpoint: ENDPOINT, type: 'ocr', promptVersion: `eval-7263-${ARM}`,
        imageParts: NOIMG ? undefined : [fs.readFileSync(r.image)],
        thinkingBudget: 0, temperature: 0.1, maxOutputTokens: 16384, safetySettings: SAFETY,
      });
      error = null; break;
    } catch (e) { error = String(e.message || e).slice(0, 300); await new Promise((s) => setTimeout(s, 5000 * attempts)); }
  }
  return {
    uid: r.uid, arm: ARM, model: MODEL, image: !NOIMG, date: new Date().toISOString(), text: res?.text || '',
    secs: (Date.now() - t0) / 1000, attempts, finish: res?.finishReason ?? null,
    input_tokens: res?.inputTokens ?? 0, output_tokens: res?.outputTokens ?? 0, thinking_tokens: res?.thinkingTokens ?? 0,
    generation_config: res?.generationConfig ?? null, error,
  };
}
let i = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (i < todo.length) {
    const r = todo[i++];
    if (used() >= CAP) { console.log('CAP BINDS'); return; }
    fs.appendFileSync(LEDGER, JSON.stringify({ uid: r.uid, arm: ARM, at: new Date().toISOString() }) + '\n');
    const row = await one(r);
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(r.uid, row.error ? `ERR ${row.error.slice(0, 120)}` : `${row.text.length} chars ${row.finish} in ${row.input_tokens} out ${row.output_tokens}`, `${Math.round(row.secs)}s`);
  }
}));
console.log('DONE ledger', used());
