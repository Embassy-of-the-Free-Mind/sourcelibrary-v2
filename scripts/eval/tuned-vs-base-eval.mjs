#!/usr/bin/env node
// Held-out eval: tuned sl-greek-translator-v1 vs base gemini-2.5-flash-lite
// on the whole-book validation split (issue #4320). chrF (char 6-gram F1)
// against the pipeline reference translation. Writes per-example JSONL and a
// summary. Cost: ~pennies (400 flash-lite calls).
//
// Run: node scripts/eval/tuned-vs-base-eval.mjs \
//        --val scripts/output/vertex-sft-v1/validation.jsonl \
//        --out scripts/output/vertex-sft-v1/eval-results.jsonl

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const VAL = arg('--val', 'scripts/output/vertex-sft-v1/validation.jsonl');
const OUT = arg('--out', 'scripts/output/vertex-sft-v1/eval-results.jsonl');
const CONC = Number(arg('--concurrency', 4));

const LOC = 'us-central1', PN = '877864597985';
const API = `https://${LOC}-aiplatform.googleapis.com/v1`;
const TUNED = `projects/${PN}/locations/${LOC}/endpoints/6705829608584904704`;
const BASE = `projects/${PN}/locations/${LOC}/publishers/google/models/gemini-2.5-flash-lite`;
const SYSTEM = 'You are a translator for Source Library, a digital library of historical primary sources. Translate the given text into clear, accurate English, preserving the structure, register, and meaning of the original.';

let tok = { v: null, at: 0 };
const token = () => {
  if (!tok.v || Date.now() - tok.at > 45 * 60e3) tok = { v: execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim(), at: Date.now() };
  return tok.v;
};

// chrF: character 6-gram precision/recall F-score (beta=2), whitespace-collapsed.
function chrF(ref, hyp, n = 6, beta = 2) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const grams = (s, k) => { const m = new Map(); for (let i = 0; i <= s.length - k; i++) { const g = s.slice(i, i + k); m.set(g, (m.get(g) || 0) + 1); } return m; };
  let precSum = 0, recSum = 0, levels = 0;
  const R = norm(ref), H = norm(hyp);
  for (let k = 1; k <= n; k++) {
    const rg = grams(R, k), hg = grams(H, k);
    let overlap = 0, hTot = 0, rTot = 0;
    for (const [g, c] of hg) { hTot += c; overlap += Math.min(c, rg.get(g) || 0); }
    for (const c of rg.values()) rTot += c;
    if (hTot === 0 || rTot === 0) continue;
    precSum += overlap / hTot; recSum += overlap / rTot; levels++;
  }
  if (!levels) return 0;
  const p = precSum / levels, r = recSum / levels;
  if (p + r === 0) return 0;
  return (1 + beta * beta) * p * r / (beta * beta * p + r);
}

async function generate(target, text, retries = 2) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(`${API}/${target}:generateContent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { role: 'system', parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      });
      const j = await r.json();
      const out = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
      if (out == null) throw new Error(JSON.stringify(j.error || j).slice(0, 200));
      return out;
    } catch (e) {
      if (a >= retries) return `__ERROR__ ${String(e).slice(0, 200)}`;
      await new Promise((res) => setTimeout(res, 2000 * (a + 1)));
    }
  }
}

const examples = fs.readFileSync(VAL, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
console.log(`[eval] ${examples.length} held-out examples, concurrency ${CONC}`);
const out = fs.createWriteStream(OUT);
let done = 0, tSum = 0, bSum = 0, errs = 0, tWins = 0, bWins = 0;

async function worker(queue) {
  for (;;) {
    const i = queue.shift();
    if (i == null) return;
    const ex = examples[i];
    const prompt = ex.contents[0].parts[0].text;
    const ref = ex.contents[1].parts[0].text;
    const [t, b] = await Promise.all([generate(TUNED, prompt), generate(BASE, prompt)]);
    if (t.startsWith('__ERROR__') || b.startsWith('__ERROR__')) { errs++; done++; continue; }
    const tf = chrF(ref, t), bf = chrF(ref, b);
    tSum += tf; bSum += bf; done++;
    if (tf > bf) tWins++; else if (bf > tf) bWins++;
    out.write(JSON.stringify({ i, chrf_tuned: +tf.toFixed(4), chrf_base: +bf.toFixed(4), ref_len: ref.length }) + '\n');
    if (done % 25 === 0) console.log(`[eval] ${done}/${examples.length} | mean chrF tuned ${(tSum / (done - errs)).toFixed(4)} vs base ${(bSum / (done - errs)).toFixed(4)}`);
  }
}

const queue = examples.map((_, i) => i);
await Promise.all(Array.from({ length: CONC }, () => worker(queue)));
out.end();
const n = done - errs;
const summary = {
  examples: examples.length, scored: n, errors: errs,
  mean_chrf_tuned: +(tSum / n).toFixed(4), mean_chrf_base: +(bSum / n).toFixed(4),
  tuned_wins: tWins, base_wins: bWins, ties: n - tWins - bWins,
};
fs.writeFileSync(OUT.replace(/\.jsonl$/, '-summary.json'), JSON.stringify(summary, null, 2));
console.log('[eval] done:', JSON.stringify(summary));
