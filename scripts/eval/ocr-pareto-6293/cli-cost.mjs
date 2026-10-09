#!/usr/bin/env node
// PRIOR ART: scripts/eval/syriac-pareto-6295/cli-cost.mjs (a CLI arm at the API list price: input as billed to lite
// for the identical request, output from the CLI text's length). This applies the #6293 preregistration's x-axis
// formula instead, which scales lite's metered PRODUCTION tokens per page by the arm's ratios to lite.
/**
 * cli-cost.mjs — $0, read-only. Where a Gemini CLI arm sits on the #6293 cost axis (PREREGISTRATION-ocr-pareto-6293.md,
 * "Cost on the x axis"):
 *
 *   usd_per_1k = 1000 × ½ × [ 3,736 × r_in × price_in + 1,082 × r_out × price_out ] / 1e6
 *
 * The CLI bills nothing and reports no per-request tokens (its usage counts the agent's own turns), so:
 *   r_in  = 1      the identical request (same prompt, same image bytes) to a model of the same family
 *   r_out = Σ CLI characters / Σ lite characters, per chart, over that chart's pages where both returned text
 *          (lite's stored output from the bench; tokens per character assumed equal); thinking unknown and not counted
 *
 *   node scripts/eval/ocr-pareto-6293/cli-cost.mjs --bench <bench> --engine gemini-3.8-flash+antigravity-cli --model gemini-3.8-flash
 * Writes scripts/eval/results/ocr-pareto-6293/cli-cost.json, or --out=<file> for another tier (cli-cost-<model>.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_PRICING, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)) ?? (process.argv.includes(`--${n}`) ? `--${n}=${process.argv[process.argv.indexOf(`--${n}`) + 1]}` : null); return a ? a.slice(n.length + 3) : d; };
const BENCH = argOf('bench'), ENGINE = argOf('engine'), MODEL = argOf('model');
const P = MODEL_PRICING[MODEL];
if (!BENCH || !ENGINE || !P) { console.error('--bench, --engine and a priced --model are required'); process.exit(1); }
const LITE = 'gemini-3.1-flash-lite', LITE_IN = 3736, LITE_OUT = 1082;
const SEL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'ocr-pareto-6293', 'pages.json'), 'utf8'));
const read = (st, e, slug) => { const f = path.join(BENCH, st, 'out', e, `${slug}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const price = (rOut) => r3((1000 * BATCH_MULTIPLIER * (LITE_IN * P.input + LITE_OUT * rOut * P.output)) / 1e6);

const charts = {};
let allCli = 0, allLite = 0, allN = 0;
for (const [id, c] of Object.entries(SEL.charts)) {
  let cli = 0, lite = 0, n = 0;
  for (const k of c.pages) {
    const [st, slug] = k.split('|');
    const a = read(st, ENGINE, slug), b = read(st, LITE, slug);
    if (!a?.trim() || !b?.trim()) continue;
    cli += [...a].length; lite += [...b].length; n++;
  }
  if (!n) continue;
  charts[id] = { pages_both_text: n, r_out: r3(cli / lite), usd_per_1k_batch: price(cli / lite) };
  allCli += cli; allLite += lite; allN += n;
}
const out = {
  issue: 6293, generated_by: 'scripts/eval/ocr-pareto-6293/cli-cost.mjs', engine: ENGINE, model: MODEL, price_per_1m: P, batch_multiplier: BATCH_MULTIPLIER,
  basis: `the preregistered x axis: lite's metered production Batch tokens per page (${LITE_IN} in, ${LITE_OUT} out) scaled by r_in = 1 (identical request) and r_out = CLI characters / lite characters on the same pages, at ${MODEL}'s list price and the Batch rate; thinking not counted (the CLI ran at its "low" level and reports no per-request tokens); $0 was billed (CLI, subscription)`,
  all: { pages_both_text: allN, r_out: r3(allCli / allLite), usd_per_1k_batch: price(allCli / allLite) },
  charts,
};
const OUT = argOf('out') ? path.resolve(argOf('out')) : path.join(__dirname, '..', 'results', 'ocr-pareto-6293', 'cli-cost.json');
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.all), Object.entries(charts).map(([k, v]) => `${k} ${v.usd_per_1k_batch}`).join(', '), '→', path.relative(process.cwd(), OUT));
