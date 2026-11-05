#!/usr/bin/env node
// PRIOR ART: translate-cli-lane-7075/sample.mjs judge (Opus and Gemini over a packet, resumable: parseJson imported, its packets
// are translations); agy-ocr-per-call-6740/judge.mjs (the claude -p call shape). Same shape here for span panels.
// #6552: one reader over one tag's packets. --reader=opus|gemini|opus-noimage. Verdicts: $JOB_SCRATCH/<c>/tags/<tag>/verdicts-<reader>.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RULES, parse, claudeCall } from './reader.mjs';
import { agyCall, installToolGate, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const C = arg('c'), TAG = arg('tag'), READER = arg('reader'), CONC = +arg('conc', READER === 'gemini' ? 4 : 3), LIMIT = +arg('limit', 1e9);
const OUT = path.join(process.env.JOB_SCRATCH, C, 'tags', TAG), F = path.join(OUT, `verdicts-${READER}.jsonl`);
const packs = JSON.parse(fs.readFileSync(path.join(OUT, 'packets.json'), 'utf8'));
const done = new Set(fs.existsSync(F) ? fs.readFileSync(F, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.items).map((r) => r.packet) : []);

const WITH_IMAGE = (p, file) => `The image ${file} has up to six numbered panels (red numbers), each cropped from a page of a Chinese manuscript or print. Look at it first; zoom is not available. Vertical columns read top to bottom, columns right to left; small double-line notes run inside a column.\n\n${RULES}\n\n${p.text}`;
const NO_IMAGE = (p) => `No image is available. These are positions in classical Chinese texts. For each entry say which reading is the likelier text from your knowledge and the sense of the context alone.\n\n${RULES.replace('answer from the leaf, not from what the text ought to say', 'answer from your knowledge of the text and the sense')}\n\n${p.text}`;

const claude = (prompt, withRead) => claudeCall(prompt, withRead, path.join(OUT, 'sheets'));
async function gemini(prompt) {
  const dir = path.join(OUT, 'sheets'); installToolGate(dir, { task: 'ocr' });
  const r = await agyCall(['-p', prompt, '--model', 'gemini-3.8-flash-high', ...CLI_SAFE_ARGS], dir);
  return { text: r.text, usage: r.usage, err: r.cls && r.cls !== 'ok' ? `${r.cls} ${String(r.err || '').slice(0, 200)}` : null };
}
// --limit on a scarce reader takes the packets richest in controls, so a subset still measures that reader; the items stay blind.
const key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'), 'utf8')), ctl = {}; for (const it of key) if (it.kind !== 'real' && it.kind !== 'agreed') ctl[it.packet] = (ctl[it.packet] || 0) + 1;
const todo = packs.filter((p) => !done.has(p.packet)).sort((a, b) => LIMIT < 1e9 ? (ctl[b.packet] || 0) - (ctl[a.packet] || 0) : 0).slice(0, LIMIT); let next = 0, fails = 0;
async function worker() {
  while (next < todo.length && fails < 8) {
    const p = todo[next++];
    const prompt = READER === 'opus-noimage' ? NO_IMAGE(p) : WITH_IMAGE(p, READER === 'opus' ? path.join(OUT, 'sheets', p.file) : p.file);
    let r, items = null;
    for (let a = 0; a < 2 && !items; a++) {
      r = READER === 'gemini' ? await gemini(prompt) : await claude(prompt, READER === 'opus');
      items = parse(r.text, p.n);
      if (r.err && /quota/i.test(r.err)) { fails = 99; break; }
    }
    if (!items) fails++;
    fs.appendFileSync(F, JSON.stringify({ packet: p.packet, reader: READER, items, err: items ? null : (r.err || String(r.text).slice(0, 200)), usage: r.usage ?? null, cost: r.cost ?? null }) + '\n');
    console.log(READER, p.packet, items ? 'ok' : 'FAILED', items ? '' : (r.err || '').slice(0, 120));
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
