#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-engine-gpu-costs.json (the quote-checked cost table build-ocr-pareto.mjs reads; this
// file copies its "every claim quotes its source, and the build fails if the quote is gone" rule) — it prices engines,
// it does not say which ones we can run. scripts/lib/agy-cli.mjs assertGeminiModel enforces one rule at call time;
// nothing lists them all. Searched scripts/eval, scripts/lib, src/data for "roster|available" (#6776).
/**
 * Which engines on /quality/pareto we can actually run today, and by what route (#6776, Derek 2026-10-15: "we need to
 * understand what models we actually have available").
 *
 * One row per engine that appears in src/data/ocr-pareto.json or src/data/translation-pareto.json: its route, how we
 * would run it, available today yes/no, why not, the date checked and the source of the rule. Every rule below quotes
 * a passage of its source file, and the build fails if that passage is no longer there, so a rule cannot outlive its
 * doctrine silently. Which Gemini models the subscription CLI offers is read from a recorded `agy models` run
 * (scripts/eval/results/model-roster/agy-models-<date>.txt; re-record it and rebuild when the CLI changes).
 *
 * The rules (first match wins):
 *   Tesseract                         banned (Derek)
 *   Claude through the Claude CLI     available: subscription only, `claude -p`
 *   Claude billed through the API     not available: Claude runs only on the subscription
 *   Gemini through agy                available if `agy models` lists the model (any of its -low/-medium/-high)
 *   Gemini 3.1 Flash-Lite, API        available: the one model on the paid API
 *   any other paid API                not available: the paid API is Flash-Lite only since 2026-10-08
 *   Kraken family                     available: our own server (CPU)
 *   GPU engines                       available: a leased Scaleway GPU, under the lease watchdog
 *   production-*                      the stored production reads / each book's engine: what is in use
 *
 * Writes src/data/model-roster.json. No timestamps beyond the recorded check date: unchanged inputs, identical file.
 *   node scripts/eval/build-model-roster.mjs           # write
 *   node scripts/eval/build-model-roster.mjs --check   # exit 1 if the committed file is stale or an engine has no row
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(REPO, 'src', 'data', 'model-roster.json');
const AGY_DIR = path.join(__dirname, 'results', 'model-roster');

// ── the evidence: the newest recorded `agy models` run ───────────────────────────────────────
const agyFile = fs.readdirSync(AGY_DIR).filter(f => /^agy-models-\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort().at(-1);
if (!agyFile) throw new Error(`no agy-models-<date>.txt in ${path.relative(REPO, AGY_DIR)}`);
const CHECKED = agyFile.match(/(\d{4}-\d{2}-\d{2})/)[1];
const AGY_SOURCE = path.relative(REPO, path.join(AGY_DIR, agyFile));
const AGY = fs.readFileSync(path.join(AGY_DIR, agyFile), 'utf8').split('\n')
  .filter(l => /^[a-z0-9.-]+\t/.test(l)).map(l => l.split('\t')[0]);
if (!AGY.length) throw new Error(`${AGY_SOURCE}: no models parsed`);
const agyHas = model => AGY.some(m => m === model || m.replace(/-(low|medium|high)$/, '') === model);

// ── the rules' sources, each with a passage that must still be in it ─────────────────────────
const flat = s => s.replace(/\s+/g, ' ');
const SRC = {
  tesseract: { source: '.claude/docs/ocr-lane-decision-tree.md', quote: '**No Tesseract**, as an engine or as a free reference (Derek)' },
  claude: { source: 'scripts/lib/agy-cli.mjs', quote: 'Claude runs only through the Claude subscription (`claude -p`, subagents), never through agy' },
  geminiApi: { source: 'scripts/batch/cli-ocr.mjs', quote: 'Since 2026-10-08 every Gemini model except flash-lite runs through the subscription CLI instead' },
  paidApi: { source: 'scripts/eval/experiments/2026-10-08-syriac-print-pareto-6295.md', quote: 'spend rule of 2026-10-08: only `gemini-3.1-flash-lite` on the paid API' },
  kraken: { source: '.claude/docs/ocr-lane-decision-tree.md', quote: 'Kraken lane on Hetzner (`syriac-kraken-lane.mjs`)' },
  gpu: { source: 'CLAUDE.md', quote: 'lease it (`scripts/maintenance/gpu-lease-watchdog.mjs --lease' },
  production: { source: 'scripts/lib/ocr-routing.mjs', quote: null },
};
// a passage may run across comment lines: compare with the comment markers and line breaks removed
const plain = s => flat(s.replace(/^\s*(\/\/|\*)\s?/gm, ''));
for (const [k, s] of Object.entries(SRC)) {
  if (s.quote && !plain(fs.readFileSync(path.join(REPO, s.source), 'utf8')).includes(flat(s.quote))) throw new Error(`rule "${k}": the passage "${s.quote}" is no longer in ${s.source}`);
}
const AGY_RULE = { source: AGY_SOURCE, quote: null };

// ── the engines on the page ──────────────────────────────────────────────────────────────────
const engines = new Map();   // id → { label, stages:Set }
for (const [stage, f] of [['ocr', 'ocr-pareto.json'], ['translation', 'translation-pareto.json']]) {
  const d = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'data', f), 'utf8'));
  for (const c of d.charts) for (const p of c.panels) for (const x of [...p.placed, ...p.no_cost]) {
    const id = x.engine.split('|')[0];   // "<engine>|kraken" is the same engine on another input
    const label = x.label.replace(/ on the (Kraken text|typed e-text)$/, '');
    if (!engines.has(id)) engines.set(id, { label, stages: new Set() });
    engines.get(id).stages.add(stage);
  }
}

const GPU = /^(deepseek-ocr|chandra-ocr|qwen3-vl|cllg-qwen3vl|surya|olmocr|paddleocr-vl|dots-mocr|ndlkotenocr|mineru)/;
const KRAKEN = /^(kraken|omnisyr|qoruyo|sophro)/;
const CLAUDE_SUB = /\+claude-cli$|^claude-(sonnet-5\.5|haiku-4\.5|opus)$/;   // translation's Claude arms ran as subagents
const plainText = s => (s == null ? s : s.replace(/`/g, ''));   // shown as plain text on the page
const row = (group, route, how, available, why_not, src) => ({ group, route, how: plainText(how), available, why_not: plainText(why_not), source: src.source, ...(src.quote ? { rule: src.quote } : {}) });
// The roster table on /quality/pareto shows one line per group of engines we can run today.
const GROUPS = [
  { id: 'gemini-api', title: 'Gemini 3.1 Flash-Lite', route: 'api', how: 'the paid Gemini API, Batch', cost_basis: 'billed per page at the Batch rate' },
  { id: 'gemini-cli', title: 'Gemini through the Antigravity CLI', route: 'subscription', how: 'agy -p on the Google subscription', cost_basis: '$0 billed; costs time and subscription quota' },
  { id: 'claude-cli', title: 'Claude through the Claude CLI', route: 'subscription', how: 'claude -p on the Claude subscription', cost_basis: '$0 billed; costs time and subscription quota' },
  { id: 'gpu', title: 'Open models on a rented GPU', route: 'gpu', how: 'a leased Scaleway GPU under the lease watchdog', cost_basis: 'rental billed by the hour, shared over the pages read' },
  { id: 'kraken', title: 'Kraken models', route: 'own', how: 'our own server, CPU', cost_basis: 'no per-page bill' },
  { id: 'production', title: 'What production already stored', route: 'api', how: 'the reads already in the library', cost_basis: 'already paid' },
  { id: 'other-api', title: 'Other paid APIs', route: 'api', how: 'billed per request', cost_basis: 'billed per request' },
  { id: 'banned', title: 'Banned', route: 'own', how: '—', cost_basis: '—' },
];

function ruleFor(id) {
  if (/^tesseract/.test(id)) return row('banned', 'own', 'Tesseract on our own server', false, 'banned: Tesseract is not used, as an engine or as a reference', SRC.tesseract);
  if (CLAUDE_SUB.test(id)) return row('claude-cli', 'subscription', '`claude -p` on the Claude subscription, $0 billed', true, null, SRC.claude);
  if (/^claude-/.test(id)) return row('other-api', 'api', 'the Anthropic API, billed per request', false, 'Claude runs only on the Claude subscription (`claude -p`), never through the API or agy', SRC.claude);
  const cli = id.match(/^(gemini-[a-z0-9.-]+)\+antigravity-cli$/);
  if (cli) {
    const ok = agyHas(cli[1]);
    return row('gemini-cli', 'subscription', `\`agy -p --model ${cli[1]}\` on the Google subscription, $0 billed`, ok,
      ok ? null : `no longer offered by the Antigravity CLI (\`agy models\`, ${CHECKED})`, AGY_RULE);
  }
  if (id === 'gemini-3.1-flash-lite') return row('gemini-api', 'api', 'the paid Gemini API (Batch)', true, null, SRC.geminiApi);
  if (/^gemini-/.test(id)) {
    const model = id.replace(/-preview$/, '').replace(/\+.*$/, '').replace(/-preview$/, '');
    return row('other-api', 'api', 'the paid Gemini API', false, `the paid Gemini API runs Flash-Lite only since 2026-10-08${agyHas(model) ? '; the same model runs today through the Antigravity CLI, $0 billed, measured in its own runs' : ', and the Antigravity CLI does not offer this model'}`, SRC.geminiApi);
  }
  if (KRAKEN.test(id)) return row('kraken', 'own', 'Kraken on our own server (CPU)', true, null, SRC.kraken);
  if (GPU.test(id)) return row('gpu', 'gpu', 'a leased Scaleway GPU, under the lease watchdog; billed by the hour', true, null, SRC.gpu);
  if (id === 'production-stored') return row('production', 'api', 'the production OCR already stored for each page', true, null, SRC.production);
  if (id === 'production-per-book') return row('production', 'api', 'each book’s production engine', true, null, SRC.production);
  if (/^mistral-/.test(id)) return row('other-api', 'api', 'the Mistral API, billed per page', false, 'the paid API is for Gemini 3.1 Flash-Lite only since 2026-10-08', SRC.paidApi);
  return null;
}

const rows = [];
const missing = [];
for (const [id, e] of [...engines].sort((a, b) => a[0].localeCompare(b[0]))) {
  const r = ruleFor(id);
  if (!r) { missing.push(id); continue; }
  rows.push({ engine: id, label: e.label, stages: [...e.stages].sort(), ...r, checked: CHECKED });
}
if (missing.length) throw new Error(`no roster rule for: ${missing.join(', ')} — add one to ruleFor() in ${path.relative(REPO, fileURLToPath(import.meta.url))}`);

const out = {
  issue: 6776,
  generated_by: 'scripts/eval/build-model-roster.mjs',
  checked: CHECKED,
  agy_models: { source: AGY_SOURCE, models: AGY },
  route_labels: { api: 'API, billed per request', subscription: 'CLI on a subscription, $0 billed', gpu: 'leased GPU, billed by the hour', own: 'our own server' },
  groups: GROUPS.filter(g => rows.some(r => r.group === g.id)),
  engines: rows,
};
const json = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== json) { console.error(`${path.relative(REPO, OUT)} is stale — run node scripts/eval/build-model-roster.mjs`); process.exit(1); }
  console.log('model-roster.json is current');
  process.exit(0);
}
fs.writeFileSync(OUT, json);
for (const r of rows) console.log(`${r.available ? 'yes' : ' no'}  ${r.route.padEnd(12)} ${r.engine.padEnd(42)} ${r.why_not || ''}`);
console.log(`wrote ${path.relative(REPO, OUT)} (${rows.length} engines, agy checked ${CHECKED})`);
