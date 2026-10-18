#!/usr/bin/env node
// PRIOR ART: scripts/lib/gemini-script-client.mjs (the call, thinking 0, usage logging: used unchanged);
// scripts/eval/lib/runners.mjs `runGemini` (an eval harness across five providers, more than one model needs).
// The paid baseline arm (B1, B1r) of the #6871 item 3 bake-off: one image per call, the preregistered prompt
// (read.py PROMPT, read from that file so the two cannot drift).
//   node --env-file=.env.production.local gemini-arm.mjs <img dir> <out.jsonl> [--model gemini-3.1-flash-lite] [--temperature 0] [--parallel 8]
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../lib/gemini-script-client.mjs';

const [imgs, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const model = arg('model', 'gemini-3.1-flash-lite');
const temperature = Number(arg('temperature', '0'));
const parallel = Number(arg('parallel', '8'));
const src = fs.readFileSync(new URL('./read.py', import.meta.url), 'utf8');
const PROMPT = src.match(/PROMPT = \(([\s\S]*?)\)\n/)[1].split('\n').map((l) => l.trim().replace(/^'|'$/g, '')).join('');

const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((r) => !r.error).map((r) => r.page_id) : []);
const todo = fs.readdirSync(imgs).filter((f) => f.endsWith('.jpg')).sort().filter((f) => !done.has(f.slice(0, -4)));
let inTok = 0, outTok = 0;
const t0 = Date.now();
async function worker() {
  while (todo.length) {
    const f = todo.shift();
    const rec = { page_id: f.slice(0, -4) };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await callGemini({ model, prompt: PROMPT, imageParts: [{ mimeType: 'image/jpeg', data: fs.readFileSync(path.join(imgs, f)) }],
          temperature, maxOutputTokens: 8192, endpoint: 'scripts/eval/zh-residue-bakeoff-6871/gemini-arm.mjs', type: 'ocr', pageIds: [rec.page_id] });
        Object.assign(rec, { text: r.text, finish: r.finishReason, in_tok: r.inputTokens, out_tok: r.outputTokens });
        delete rec.error; inTok += r.inputTokens; outTok += r.outputTokens;
        break;
      } catch (e) { rec.error = String(e.message).slice(0, 300); await new Promise((s) => setTimeout(s, 5000 * (attempt + 1))); }
    }
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  }
}
await Promise.all(Array.from({ length: parallel }, worker));
const run = { model, temperature, wall_secs: (Date.now() - t0) / 1000, in_tok: inTok, out_tok: outTok };
fs.writeFileSync(out + '.run.json', JSON.stringify(run, null, 1));
console.log(JSON.stringify(run));
