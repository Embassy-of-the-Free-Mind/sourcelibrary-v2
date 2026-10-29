#!/usr/bin/env node
// PRIOR ART: run-arms.mjs --collect (this directory) — writes a Batch arm's reads into the bench as
// out/<engine>/<slug>.txt + _meter.jsonl, the contract benchmark-score.mjs reads. The CLI arm (Amendment 1) comes back
// as scripts/eval/run-cli-arm.py rows with no tokens and no finishReason, so this is that collect step for them.
/**
 * import-cli-arm.mjs — $0. Amendment 1 of PREREGISTRATION-ocr-pareto-6293.md.
 *
 *   node scripts/eval/ocr-pareto-6293/import-cli-arm.mjs --raw <C38-ocr-6293.raw.jsonl> --bench <bench root>
 *
 * Per page (last row per uid): Gemini's safety-filter message is cut and the text before it kept (meter
 * finishReason SAFETY, so an EMPTY stub counts as a refusal under #5581 and a non-empty one is scored as returned);
 * a row the CLI left without text after its attempts is written empty with error 'cli-empty' (an empty read).
 * Writes results/ocr-pareto-6293/cli-cost.json: the arm's list-price point by the preregistered formula, r_in = 1,
 * r_out = this arm's output characters over lite's stored output characters on the same pages; thinking 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_PRICING, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const RAW = opt('raw'), BENCH = opt('bench');
const ENGINE = 'gemini-3.8-flash+antigravity-cli', MODEL = 'gemini-3.8-flash', LITE = 'gemini-3.1-flash-lite';
const BLOCK = "This request was blocked by Gemini's filters";
// Lite's metered production Batch tokens per page (ocr-cost-2026-10-06.json), as the preregistration fixes.
const LITE_IN = 3736, LITE_OUT = 1082;
const strip = (t) => (t.includes(BLOCK) ? t.slice(0, t.indexOf(BLOCK)).trimEnd().replace(/<[^>\n]*$/, '').trimEnd() : t);

const rows = new Map();
for (const l of fs.readFileSync(RAW, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); rows.set(r.uid, r); }
const meters = new Map();
const tally = { pages: 0, blocked: 0, blocked_empty: 0, cli_empty: 0, retried: 0, by_stratum: {} };
let charsCli = 0, charsLite = 0, pairs = 0;
for (const [uid, r] of rows) {
  const [st, slug] = uid.split('|');
  const dir = path.join(BENCH, st, 'out', ENGINE);
  fs.mkdirSync(dir, { recursive: true });
  const blocked = (r.text || '').includes(BLOCK);
  const text = strip(r.text || '');
  fs.writeFileSync(path.join(dir, `${slug}.txt`), text);
  tally.pages++; tally.by_stratum[st] = (tally.by_stratum[st] || 0) + 1;
  if (blocked) { tally.blocked++; if (!text.trim()) tally.blocked_empty++; }
  if (!r.text) tally.cli_empty++;
  if (r.attempts > 1) tally.retried++;
  const lite = path.join(BENCH, st, 'out', LITE, `${slug}.txt`);
  if (fs.existsSync(lite)) { charsCli += [...text].length; charsLite += [...fs.readFileSync(lite, 'utf8')].length; pairs++; }
  (meters.get(dir) || meters.set(dir, []).get(dir)).push({ ...(st === 'latin-period-5126' ? { prompt: 'production-v19.1', prompt_hash: '9d8f959e053491362b2c4acec1e20c9a' } : {}),
    slug, engine: ENGINE, mode: 'cli', route: 'agy -p (Antigravity CLI, subscription)', model: r.model, finishReason: blocked ? 'SAFETY' : r.text ? 'STOP' : null,
    inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, chars: text.length, attempts: r.attempts, seconds: r.secs,
    error: r.text ? null : (r.error || 'cli-empty'), safety_filter_stub: blocked || undefined, at: r.date });
}
for (const [dir, ms] of meters) fs.writeFileSync(path.join(dir, '_meter.jsonl'), ms.map((m) => JSON.stringify(m)).join('\n') + '\n');

const P = MODEL_PRICING[MODEL];
const rOut = charsCli / charsLite;
const usd = 1000 * BATCH_MULTIPLIER * (LITE_IN * 1 * P.input + LITE_OUT * rOut * P.output) / 1e6;
const out = {
  issue: 6293, generated_by: 'scripts/eval/ocr-pareto-6293/import-cli-arm.mjs', engine: ENGINE, model: MODEL, cli_model: 'gemini-3.8-flash-low', price_per_1m: P, batch_multiplier: BATCH_MULTIPLIER,
  basis: 'API list price at the Batch rate for comparison; $0 billed (Antigravity CLI on the subscription). Preregistered formula (Amendment 1): lite\'s production tokens per page, r_in = 1, r_out = this arm\'s output characters / lite\'s on the same pages, thinking 0',
  lite_tokens_per_page: { in: LITE_IN, out: LITE_OUT }, r_in: 1, r_out: Math.round(rOut * 1000) / 1000, pages_for_r_out: pairs,
  usd_per_1k_batch: Math.round(usd * 1000) / 1000, usd_per_1k_standard: Math.round((usd / BATCH_MULTIPLIER) * 1000) / 1000, usd_billed: 0, tally,
};
const OUT = path.join(__dirname, '..', 'results', 'ocr-pareto-6293', 'cli-cost.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
