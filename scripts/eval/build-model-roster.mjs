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
 * The rules, and the sources they quote, are in scripts/eval/lib/model-availability.mjs (shared with the pareto builds,
 * so a verdict sentence names only engines we can run). Availability is per MODEL by the route we can run it on: Claude
 * measured through the API runs on the subscription; a Gemini model measured on the paid API runs on the CLI when
 * `agy models` lists it (Derek 2026-10-16). Whether each drawn dot matches its row is pinned by
 * tests/unit/model-roster.test.ts, which renders the charts.
 *
 * Writes src/data/model-roster.json. No timestamps beyond the recorded check date: unchanged inputs, identical file.
 *   node scripts/eval/build-model-roster.mjs           # write
 *   node scripts/eval/build-model-roster.mjs --check   # exit 1 if the committed file is stale or an engine has no row
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGY, AGY_SOURCE, CHECKED, GROUPS, PRODUCTION_LANE_NOTE, REPO, availabilityOf as ruleFor } from './lib/model-availability.mjs';

const OUT = path.join(REPO, 'src', 'data', 'model-roster.json');

// ── the engines on the page ──────────────────────────────────────────────────────────────────
const engines = new Map();   // id → { label, stages:Set }
for (const [stage, f] of [['ocr', 'ocr-pareto.json'], ['translation', 'translation-pareto.json']]) {
  const d = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'data', f), 'utf8'));
  for (const c of d.charts) for (const p of c.panels) for (const x of [...p.placed, ...p.no_cost]) {
    const id = x.engine.split('|')[0];   // "<engine>|kraken" is the same engine on another input
    if (id.includes('>')) continue;   // a chained route (#6740) is two engines, each with its own row
    const label = x.label.replace(/ on the (Kraken text|typed e-text)$/, '');
    if (!engines.has(id)) engines.set(id, { label, stages: new Set() });
    engines.get(id).stages.add(stage);
  }
}

const rows = [];
const missing = [];
for (const [id, e] of [...engines].sort((a, b) => a[0].localeCompare(b[0]))) {
  const r = ruleFor(id);
  if (!r) { missing.push(id); continue; }
  rows.push({ engine: id, label: e.label, stages: [...e.stages].sort(), ...r, checked: CHECKED });
}
if (missing.length) throw new Error(`no roster rule for: ${missing.join(', ')} — add one to ruleFor() in ${path.relative(REPO, fileURLToPath(import.meta.url))}`);

// The newest model the CLI offers: each chart that has not measured it says so under the chart (Derek 2026-10-16).
const NEWEST = 'gemini-4-argon-low+antigravity-cli';
if (!rows.some(r => r.engine === NEWEST)) throw new Error(`${NEWEST}: not on any chart; update NEWEST`);

const out = {
  issue: 6776,
  generated_by: 'scripts/eval/build-model-roster.mjs',
  checked: CHECKED,
  agy_models: { source: AGY_SOURCE, models: AGY },
  route_labels: { api: 'API, billed per request', subscription: 'CLI on a subscription, $0 billed', gpu: 'leased GPU, billed by the hour', own: 'our own server' },
  production_lane_note: PRODUCTION_LANE_NOTE,
  newest: { engine: NEWEST, label: rows.find(r => r.engine === NEWEST).label },
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
