#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/gemini-arm.mjs (this file, copied: the Chinese prompt replaced by the
// GENERIC prompt of rounds 1–4, read from benchmark-run-api.mjs so the two cannot drift; maxOutputTokens 16,000 as round 4);
// scripts/lib/gemini-script-client.mjs (the call, thinking 0, usage logging: used unchanged).
// Arms L (temperature 0) and L1a / L1b (temperature 1, the noise floor) of the #5924 Latin bake-off (prereg Amendment 4).
//   node --env-file=.env.production.local gemini-arm.mjs <img dir> <out.jsonl> [--temperature 0] [--parallel 8]
import fs from 'node:fs';
import path from 'node:path';
import { callGemini } from '../../lib/gemini-script-client.mjs';

const [imgs, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const model = 'gemini-3.1-flash-lite';
const temperature = Number(arg('temperature', '0'));
const parallel = Number(arg('parallel', '8'));
const src = fs.readFileSync(new URL('../benchmark-run-api.mjs', import.meta.url), 'utf8');
const PROMPT = eval(src.match(/const GENERIC_PROMPT = ([\s\S]*?);\n/)[1]); // two string literals joined by +

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
          temperature, maxOutputTokens: 16000, endpoint: 'scripts/eval/latin-bakeoff-5924/gemini-arm.mjs', type: 'ocr', pageIds: [rec.page_id] });
        Object.assign(rec, { text: r.text, finish: r.finishReason, in_tok: r.inputTokens, out_tok: r.outputTokens });
        delete rec.error; inTok += r.inputTokens; outTok += r.outputTokens;
        break;
      } catch (e) { rec.error = String(e.message).slice(0, 300); await new Promise((s) => setTimeout(s, 5000 * (attempt + 1))); }
    }
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
  }
}
await Promise.all(Array.from({ length: parallel }, worker));
const run = { model, temperature, prompt: PROMPT, wall_secs: (Date.now() - t0) / 1000, in_tok: inTok, out_tok: outTok };
fs.writeFileSync(out + '.run.json', JSON.stringify(run, null, 1));
console.log(JSON.stringify(run));
