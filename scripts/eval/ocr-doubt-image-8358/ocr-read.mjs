#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs `read` (the live one-page agy OCR call: live prompt, sentinels-6523 image line,
// narrow read_file agent, tool gate, the denied-tool nudge, one re-read on chatter) and its --instruction-file knob.
// It does not fit as is: it records the job's book list (lane_job_books) and copies every read to R2 candidate-reads,
// and this eval (#8358) writes nothing to production. This is that call, on images already on disk, saving locally.
//   node --env-file=.env.production.local ocr-read.mjs <pages.json> <page-ids.json> <outdir> [--extra=FILE] [--model=…] [--conc=3]
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { CLI_SAFE_ARGS, agyCall, agyUsage, installToolGate, installNarrowAgent, gateCalls, unwrapRead } from '../../lib/agy-cli.mjs';
import { OCR_SENTINEL_INSTRUCTION } from '../../lib/cli-chatter.mjs';
const [PAGES, IDS, OUT] = process.argv.slice(2);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const MODEL = arg('model') || 'gemini-3.8-flash-low';
const CONC = Number(arg('conc') || 3);
const extra = arg('extra') ? `\n\n${fs.readFileSync(arg('extra'), 'utf8').trim()}` : '';
const pages = JSON.parse(fs.readFileSync(PAGES, 'utf8'));
const ids = JSON.parse(fs.readFileSync(IDS, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const { base, ref } = await liveOcrPrompt(c.db('bookstore')); await c.close();
fs.writeFileSync(path.join(OUT, 'prompt-base.txt'), base); fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify(ref));
if (extra) fs.writeFileSync(path.join(OUT, 'prompt-extra.txt'), extra);
// cli-ocr.mjs imageInstruction('sentinels-6523') and NUDGE, word for word.
const imageLine = (f) => `\n\nThe page image to transcribe is attached: @./${f} Transcribe it in the format above. ${OCR_SENTINEL_INSTRUCTION}\n`;
const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
let quota = false;
async function one(id) {
  const f = path.join(OUT, `${id}.json`);
  if (fs.existsSync(f) || quota) return;
  const p = pages[id];
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'doubt-ocr-'));
  const img = `${id}.jpg`; fs.copyFileSync(p.image_file, path.join(ws, img));
  const log = installToolGate(ws); const agent = installNarrowAgent(ws);
  const sent = base + extra + imageLine(img);
  const usage = []; let r, calls = 0, nudged = false, rereads = 0; const t0 = Date.now();
  for (;;) {
    r = await agyCall(['-p', sent, '--model', MODEL, ...agent, ...CLI_SAFE_ARGS], ws); calls++; usage.push(agyUsage(r.usage));
    if (r.cls === 'quota') { quota = true; console.error('QUOTA', r.err); break; }
    if (r.cls === 'denied_tool' && r.conversation && !nudged) { nudged = true; r = await agyCall(['-p', NUDGE, '--model', MODEL, ...agent, ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws); calls++; usage.push(agyUsage(r.usage)); }
    if ((r.cls || unwrapRead(r.text).problem) && rereads === 0) { rereads++; continue; }
    break;
  }
  const tools = gateCalls(log); fs.rmSync(ws, { recursive: true, force: true });
  if (quota) return;
  const { text, problem } = unwrapRead(r.text);
  fs.writeFileSync(f, JSON.stringify({ page_id: id, model: MODEL, prompt_ref: ref, prompt_sent_hash: createHash('sha256').update(sent).digest('hex').slice(0, 16), extra: !!extra,
    text, raw: r.text, problem, cls: r.cls, calls, nudged, rereads, tool_calls: tools, usage, secs: Math.round((Date.now() - t0) / 1000) }));
  console.log(id, r.cls || problem || 'ok', text.length, 'chars', tools.join(','));
}
const q = ids.slice();
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !quota) await one(q.shift()); }));
if (quota) process.exit(3);
