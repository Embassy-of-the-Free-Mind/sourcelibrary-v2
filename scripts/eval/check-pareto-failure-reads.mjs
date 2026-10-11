#!/usr/bin/env node
// PRIOR ART: scripts/eval/experiments-lint.mjs checks experiment headers and scripts/eval/build-index.mjs the index; neither looks at what a published Pareto score is made of. `grep -ril fail_share scripts/eval` found only the page builders.
/**
 * CI check: a Pareto row with more than 10% "over half wrong" pages must carry a recorded read of its raw outputs.
 *
 * Reads src/data/ocr-pareto.json (fail_share per chart, panel and engine) and scripts/eval/pareto-failure-reads.json, and fails when an engine above the threshold has no entry with a finding, or only a pending entry older than 14 days. Translation has no failure share, so only OCR is covered (#6523).
 *
 *   node scripts/eval/check-pareto-failure-reads.mjs [--today YYYY-MM-DD]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THRESHOLD = 0.10;
const PENDING_MAX_DAYS = 14;

const ti = process.argv.indexOf('--today');
const today = ti > 0 ? new Date(process.argv[ti + 1]) : new Date();
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/ocr-pareto.json'), 'utf8'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/pareto-failure-reads.json'), 'utf8')).entries || {};

// worst share per chart + engine, across that chart's panels
const worst = new Map();
for (const chart of data.charts) {
  for (const panel of chart.panels) {
    for (const e of panel.placed || []) {
      if (typeof e.fail_share !== 'number') continue;
      const key = `${chart.id}::${e.engine}`;
      worst.set(key, Math.max(worst.get(key) ?? 0, e.fail_share));
    }
  }
}

const problems = [];
let checked = 0;
for (const [key, share] of worst) {
  if (share <= THRESHOLD) continue;
  checked++;
  const r = reg[key];
  const pct = Math.round(share * 100);
  if (!r) { problems.push(`${key} (${pct}% over half wrong): no entry`); continue; }
  if (r.finding) {
    if (!(r.pages_opened > 0) || !r.reader || !r.read_at || !r.link) problems.push(`${key}: finding without reader, read_at, pages_opened > 0 and link`);
    continue;
  }
  if (r.pending !== true) { problems.push(`${key} (${pct}%): finding is null and not marked pending`); continue; }
  const age = (today - new Date(r.pending_since)) / 86400000;
  if (!(age >= 0 && age <= PENDING_MAX_DAYS)) problems.push(`${key} (${pct}%): pending since ${r.pending_since}, over ${PENDING_MAX_DAYS} days or undated`);
}

if (problems.length) {
  console.error(`Pareto failure reads: ${problems.length} of ${checked} engines above ${THRESHOLD * 100}% over-half-wrong have no current read.`);
  for (const p of problems) console.error('  - ' + p);
  if (process.argv.includes('--annotate')) for (const p of problems) console.log(`::warning title=Pareto failure read missing::${p}`);
  console.error('Open the raw outputs of its worst pages and record what you saw in scripts/eval/pareto-failure-reads.json (#6523: a 41% score was 3 real misreads).');
  process.exit(1);
}
const pend = Object.values(reg).filter((r) => r.pending).length;
console.log(`Pareto failure reads OK: ${checked} engines above ${THRESHOLD * 100}%, ${pend} pending, the rest with a recorded read.`);
