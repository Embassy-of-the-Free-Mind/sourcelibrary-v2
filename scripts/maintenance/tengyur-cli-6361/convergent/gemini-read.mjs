#!/usr/bin/env node
// PRIOR ART: scripts/eval/second-reader/second-reader.mjs cli-requests/cli-assemble + scripts/eval/run-cli-arm.py (the
// Gemini reader through agy, one packet per call, plan mode, the image attached with @./file, a nudge on an empty or
// denied-tool reply). Those build requests from the second-reader run layout (planted errors, redacted records); this
// check's packets are A/B pages from draw.mjs, so this is the same call over that layout.
//
// #6361 convergent check, reader (b): Gemini 3.7 Flash (High) through `agy -p` on the Google subscription. The frozen
// brief (scripts/eval/spot-check/REVIEWER.md, everything below its first comment) + ADDENDUM.md, then the packet. The
// CLI cannot write OUTPUT_FILE in plan mode, so it replies with the JSON; this writes it to reviews/gemini/<slot>.json.
//
//   node scripts/maintenance/tengyur-cli-6361/convergent/gemini-read.mjs --dir=$JOB_SCRATCH/convergent [--slots=s01,s02]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { recoverArray } from '../../../eval/second-reader/lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = arg('dir');
if (!DIR) throw new Error('--dir is required');
const MODEL = arg('model', 'gemini-3.7-flash-high');
const PARALLEL = Number(arg('parallel', 3));
const body = (f) => fs.readFileSync(f, 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
const BRIEF = body(path.join(REPO, 'scripts/eval/spot-check/REVIEWER.md')) + '\n' + body(path.join(HERE, 'ADDENDUM.md'));
const NUDGE = 'Do not write a plan and do not run any command. The images are attached above. Reply now with ONLY the JSON array the brief asks for.';
const QUOTA = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b|Too Many Requests/i;
const OUTD = path.join(DIR, 'reviews', 'gemini');
fs.mkdirSync(path.join(OUTD, 'raw'), { recursive: true });
const want = arg('slots') ? new Set(arg('slots').split(',')) : null;
const slots = fs.readdirSync(path.join(DIR, 'packets')).filter((s) => (!want || want.has(s)) && !fs.existsSync(path.join(OUTD, `${s}.json`))).sort();

function agy(prompt, cwd, conversation) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--model', MODEL, '--mode', 'plan', '--print-timeout', '420s', '--output-format', 'json'];
    if (conversation) args.push('--conversation', conversation);
    const ch = spawn('agy', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => ch.kill('SIGKILL'), 480_000);
    ch.on('close', (code) => { clearTimeout(t); let j = null; try { j = JSON.parse(out.trim()); } catch {} resolve({ j, raw: out, err, code }); });
  });
}

async function one(s) {
  const pdir = path.join(DIR, 'packets', s);
  const packet = fs.readFileSync(path.join(pdir, 'packet.json'), 'utf8');
  const prompt = `${BRIEF}\nPACKET_FILE: packet.json (its full contents follow)\n\n${packet}\n\nThe page image and its crops are attached: @./page.jpg @./c1.jpg @./c2.jpg @./c3.jpg\n\nOUTPUT_FILE: none. You cannot write files here: reply with ONLY the JSON array (schema above, with the addendum's fields), no prose outside it.\n`;
  const calls = [];
  let r = await agy(prompt, pdir);
  calls.push({ nudge: false, code: r.code, status: r.j?.status, conversation_id: r.j?.conversation_id, usage: r.j?.usage, err: r.err.slice(-500), response: r.j?.response ?? r.raw.slice(-2000) });
  if (QUOTA.test(r.err + (r.j ? JSON.stringify({ e: r.j.error, m: r.j.message }) : r.raw))) return { s, quota: true, calls };
  let arr = recoverArray(r.j?.response || '');
  if (!arr && r.j?.conversation_id) {
    r = await agy(NUDGE, pdir, r.j.conversation_id);
    calls.push({ nudge: true, code: r.code, status: r.j?.status, conversation_id: r.j?.conversation_id, usage: r.j?.usage, err: r.err.slice(-500), response: r.j?.response ?? r.raw.slice(-2000) });
    arr = recoverArray(r.j?.response || '');
  }
  fs.writeFileSync(path.join(OUTD, 'raw', `${s}.json`), JSON.stringify({ slot: s, model: MODEL, at: new Date().toISOString(), calls }, null, 1));
  if (arr) fs.writeFileSync(path.join(OUTD, `${s}.json`), JSON.stringify(arr, null, 1));
  return { s, ok: !!arr, nudged: calls.length > 1, calls: calls.length };
}

const queue = [...slots];
const results = [];
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (queue.length) { const s = queue.shift(); const r = await one(s); results.push(r); console.log(JSON.stringify(r.calls ? { ...r, calls: r.calls.length ?? r.calls } : r)); if (r.quota) { queue.length = 0; } }
}));
console.log(`done: ${results.filter((r) => r.ok).length}/${results.length} ok; quota ${results.some((r) => r.quota)}`);
