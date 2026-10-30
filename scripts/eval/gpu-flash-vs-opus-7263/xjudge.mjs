#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-per-call-7522/judge.mjs (`judgePrompt`, `parseVerdict`, imported unchanged: the same
// prompt the Opus judge gets) and #7568's "agy judge" cross-check (a Gemini judge beside Opus to bracket self-
// preference). The call is agy-cli.mjs `agyCall` with the tool gate, the image in the workspace as this.jpg.
/**
 * xjudge.mjs — #7263 metric 5: agy gemini-3.8-flash-high judges packets already built for the Opus judge.
 *   node xjudge.mjs --set=test --only=<slug file> [--conc=3]
 * Reads $J/judge-<set>/judge/packets/<slug>.json; writes $J/judge-<set>/xjudge/out/<slug>.json (same shape as judge.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgePrompt, parseVerdict } from '../ocr-per-call-7522/judge.mjs';
import { agyCall, installToolGate, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/gpu-flash-vs-opus-7263';
if (process.env.AGY_HOME) { console.error('AGY_HOME set: main pool only'); process.exit(2); }
const SET = arg('set', 'test'); const CONC = Number(arg('conc', '3')); const MODEL = 'gemini-3.8-flash-high';
const PK = path.join(J, `judge-${SET}`, 'judge', 'packets'); const OUT = path.join(J, `judge-${SET}`, 'xjudge', 'out'); fs.mkdirSync(OUT, { recursive: true });
const slugs = fs.readFileSync(arg('only'), 'utf8').split('\n').filter(Boolean).filter((s) => fs.existsSync(path.join(PK, `${s}.json`)) && !fs.existsSync(path.join(OUT, `${s}.json`)));
console.log(`xjudge ${MODEL}: ${slugs.length} packets`);
// The Opus prompt names claude's Read tool; agy's is view_file and the gate allows only that. The image is attached.
const AGY_NOTE = '\n\n(In this environment the tool to open the image is view_file, and this.jpg is attached: @./this.jpg . There are no neighbouring page images here.)';
let stop = null;
const queue = [...slugs];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop) {
    const s = queue.shift(); const p = JSON.parse(fs.readFileSync(path.join(PK, `${s}.json`), 'utf8'));
    let verdict = null; let r = null;
    for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'xj-'));
      fs.copyFileSync(p.image, path.join(ws, 'this.jpg')); installToolGate(ws);
      r = await agyCall(['-p', judgePrompt({ ...p, prev_image: null, next_image: null }) + AGY_NOTE, '--model', MODEL, ...CLI_SAFE_ARGS], ws);
      fs.rmSync(ws, { recursive: true, force: true });
      if (r.cls === 'quota') { stop = r.err; break; }
      verdict = parseVerdict(r.text);
      if (verdict && !p.versions.every((v) => verdict.versions?.[v.label])) verdict = null;
    }
    if (stop) break;
    fs.writeFileSync(path.join(OUT, `${s}.json`), JSON.stringify({ page_id: s, verdict, raw: r.text.slice(0, 4000), usage: r.usage, secs: r.secs, model: MODEL }, null, 1));
  }
}));
console.log(`done${stop ? `; STOPPED ${stop}` : ''}`);
