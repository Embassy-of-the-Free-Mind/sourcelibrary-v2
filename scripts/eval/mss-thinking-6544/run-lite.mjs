#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-run-api.mjs --prompt=production (the same production prompt loader, runner and
// metering) — it walks benchmark-seal stratum directories of <slug>.jpg; #6544's sets are request files with arbitrary
// image paths, and Set B must take the STORED production read where one exists. Same call: production OCR prompt
// (lib/production-prompt.mjs), gemini-3.1-flash-lite, temperature 0.1 and thinkingBudget 0 as the orchestrator sends it.
/**
 * The Flash-Lite arm "as production runs it" for #6544, in the out-row shape of run-cli-arm.py.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/mss-thinking-6544/run-lite.mjs \
 *     --requests $JOB_SCRATCH/setA/req/read.jsonl --out $JOB_SCRATCH/setA/out/lite.jsonl [--stored $JOB_SCRATCH/setB/draw.json] [--cap 2]
 *
 * --stored: a page whose stored read is a Flash-Lite read (draw.json has_lite) is copied, not re-read (route "stored").
 * Every API page is metered (tokens, $) in the row; a refused page is re-asked once, as production does.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { runModel } from '../lib/runners.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
import { REFUSAL_REASONS } from '../lib/refusals.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const REQ = opt('requests'), OUT = opt('out'), STORED = opt('stored'), CAP = Number(opt('cap', 2));
const MODEL = 'gemini-3.1-flash-lite';
if (!REQ || !OUT) throw new Error('--requests and --out are required');

const client = await MongoClient.connect(process.env.MONGODB_URI);
const prompt = await getProductionOcrPrompt(client.db('bookstore'));
await client.close();
console.log(`production OCR prompt v${prompt.version} (${prompt.content_hash})`);

const stored = new Map();
if (STORED) for (const p of JSON.parse(fs.readFileSync(STORED, 'utf8')).picks) if (p.has_lite) stored.set(p.uid, p);
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.text).map((r) => r.uid) : []);
const reqs = fs.readFileSync(REQ, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !done.has(r.uid));
const write = (row) => fs.appendFileSync(OUT, JSON.stringify({ arm: 'lite', model: MODEL, date: new Date().toISOString(), ...row }) + '\n');
let spent = 0;
for (const r of reqs) {
  const s = stored.get(r.uid);
  if (s) { write({ uid: r.uid, route: 'stored', stored_model: s.ocr_model, text: s.ocr_text, secs: null, error: null }); continue; }
  if (spent >= CAP) { console.log(`cap $${CAP} reached; ${r.uid} and the rest unread`); break; }
  const buf = fs.readFileSync(r.image);
  let res = null, err = null, tries = 0, cost = 0;
  for (; tries < 3 && !res; tries++) {
    try { res = await runModel(MODEL, buf, prompt.text, { maxTokens: 16000, thinkingBudget: 0, temperature: 0.1 }); } catch (e) { err = e; await new Promise((ok) => setTimeout(ok, 3000 * (tries + 1))); }
  }
  cost += res?.costUsd || 0;
  if (res && !(res.text || '').trim() && REFUSAL_REASONS.test(res.finishReason || '')) {  // production re-asks a refusal once
    try { res = await runModel(MODEL, buf, prompt.text, { maxTokens: 16000, thinkingBudget: 0, temperature: 0.1 }); cost += res?.costUsd || 0; } catch (e) { err = e; }
  }
  spent += cost;
  write({ uid: r.uid, route: 'api', prompt: `production-v${prompt.version}`, prompt_hash: prompt.content_hash, text: res?.text || '', finishReason: res?.finishReason || null,
    secs: res?.durationMs ? res.durationMs / 1000 : null, inputTokens: res?.inputTokens || 0, outputTokens: res?.outputTokens || 0, thinkingTokens: res?.thinkingTokens || 0,
    costUsd: cost, error: res ? (res.text ? null : `empty: ${res.finishReason}`) : (err?.message || 'unknown').slice(0, 200) });
  console.log(`  ${r.uid} ${(res?.text || '').length} chars $${cost.toFixed(5)}`);
}
console.log(`spent $${spent.toFixed(4)} on ${MODEL}`);
