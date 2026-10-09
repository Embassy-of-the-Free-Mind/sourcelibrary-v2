#!/usr/bin/env node
// PRIOR ART: scripts/lib/model-pricing.mjs (the one price table and BATCH_MULTIPLIER, used as is);
// build-translation-pareto.mjs's #6182 CLI panel, which places C38 at what the API run of the same model billed on
// the same pages (G38). No API run of gemini-3.8-flash exists on these Syriac pages (the 2026-10-08 spend rule
// forbids one), so this estimates that bill from the tokens the lite arms were billed for the SAME requests.
/**
 * cli-cost.mjs — $0, no model call. What the CLI arms (#6295: gemini-3.8-flash through `agy -p`, subscription,
 * $0 billed) would have cost on the API at list price, Batch rate, for the cost axis.
 *
 *   node scripts/eval/syriac-pareto-6295/cli-cost.mjs --work <dir>
 *
 * Per page: input tokens = what gemini-3.1-flash-lite was billed for the byte-identical request (same prompt, same
 * page image or text; L-ocr for OCR, T-R / T-K for translation); output tokens = the CLI arm's output characters ×
 * the tokens per character lite was billed for on the same kind of output (Syriac transcription, English
 * translation), pooled over the arm. Thinking is priced at 0, which is how the API arms run (thinking budget 0);
 * the CLI ran the model at its "low" level and reports no token counts, so its own thinking is not in the figure.
 * Writes results/syriac-pareto-6295/cli-cost.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_PRICING, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';

const args = process.argv.slice(2);
const W = args[args.indexOf('--work') + 1];
const OUT = 'scripts/eval/results/syriac-pareto-6295/cli-cost.json';
const MODEL = 'gemini-3.8-flash';
// Later CLI tiers (job cli-queue-6293): each priced at its own list price, same method; the C38 block stays top-level.
const TIERS = { C37: 'gemini-3.7-flash', C36: 'gemini-3.6-flash' };
const jl = (f) => fs.readFileSync(path.join(W, 'arms', `${f}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function estimate(cliArm, liteArms, model = MODEL) {
  const P = MODEL_PRICING[model];
  const lite = new Map(); for (const a of liteArms) for (const r of jl(a)) lite.set(r.uid, r);
  const pool = [...lite.values()].filter((r) => r.text && r.out);
  const tpc = pool.reduce((s, r) => s + r.out, 0) / pool.reduce((s, r) => s + [...r.text].length, 0);
  const rows = jl(cliArm).map((r) => {
    const l = lite.get(r.uid); if (!l) throw new Error(`${cliArm} ${r.uid}: no lite request to take the input tokens from`);
    const out = Math.round([...(r.text || '')].length * tpc);
    return { uid: r.uid, in: l.in, out_est: out, usd_batch: ((l.in * P.input + out * P.output) / 1e6) * BATCH_MULTIPLIER };
  });
  const mean = rows.reduce((s, r) => s + r.usd_batch, 0) / rows.length;
  return { arm: cliArm, pages: rows.length, tokens_per_char_out: r4(tpc), usd_per_1k_batch: Math.round(mean * 1000 * 1000) / 1000,
    usd_per_1k_standard: Math.round((mean / BATCH_MULTIPLIER) * 1000 * 1000) / 1000, per_page: rows.map((r) => ({ ...r, usd_batch: +r.usd_batch.toFixed(6) })) };
}

const have = (a) => fs.existsSync(path.join(W, 'arms', `${a}.jsonl`));
const tiers = Object.fromEntries(Object.entries(TIERS).filter(([t]) => have(`${t}-ocr`) && have(`T-${t}-R`) && have(`T-${t}-K`)).map(([t, m]) => [t, {
  model: m, price_per_1m: MODEL_PRICING[m],
  ocr: estimate(`${t}-ocr`, ['L-ocr', 'L-ocr-b'], m),
  translation: { R: estimate(`T-${t}-R`, ['T-R', 'T-R2'], m), K: estimate(`T-${t}-K`, ['T-K', 'T-K2'], m) },
}]));
const out = {
  issue: 6295, generated_by: 'scripts/eval/syriac-pareto-6295/cli-cost.mjs', model: MODEL, price_per_1m: MODEL_PRICING[MODEL], batch_multiplier: BATCH_MULTIPLIER,
  basis: 'API list price at the Batch rate, thinking 0; input tokens as billed to gemini-3.1-flash-lite for the identical request, output tokens from the CLI text length at lite\'s billed tokens per character; $0 was billed (CLI, subscription)',
  ocr: estimate('C38-ocr', ['L-ocr', 'L-ocr-b']),
  translation: { R: estimate('T-C38-R', ['T-R', 'T-R2']), K: estimate('T-C38-K', ['T-K', 'T-K2']) },
  ...(Object.keys(tiers).length ? { tiers } : {}),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('OCR', out.ocr.usd_per_1k_batch, '$/1K Batch;', 'R', out.translation.R.usd_per_1k_batch, 'K', out.translation.K.usd_per_1k_batch, '→', OUT);
