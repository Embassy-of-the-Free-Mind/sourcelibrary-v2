#!/usr/bin/env node
/**
 * Read the Tier-1 attribution checkpoint file and report (#3444).
 *
 * Separate from the runner so scoring can be redone offline — model calls cost
 * money, the analysis does not, and the raw per-page rows are kept precisely so
 * a changed question does not require re-buying the data.
 *
 * TWO OUTCOMES, and the second exists because the first is blind.
 *
 *   untagged AI spans — model-authored prose sitting outside every annotation
 *                       tag. This is the Tier-1 hypothesis: does regrouping the
 *                       tag list by provenance get commentary tagged?
 *
 *   text on a blank page — a page whose own OCR declares `<page-type>blank</page-type>`
 *                       should yield almost no body text. Anything substantial
 *                       is invented. This is a FABRICATION proxy, and it is
 *                       reported because the attribution metric cannot see
 *                       fabrication at all: a silent reconstruction emits no
 *                       marker and scores a perfect zero. The very first row of
 *                       this study made the point — 47,785 characters of body
 *                       text on a blank page, zero untagged spans.
 *
 * Usage: node scripts/eval/report-tier1-attribution.mjs [--file=path]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));

function newest() {
  const dir = path.join(__dirname, 'results');
  const f = fs.readdirSync(dir).filter(x => /^tier1-attribution-.*\.jsonl$/.test(x)).sort().pop();
  if (!f) { console.error('No tier1-attribution-*.jsonl in scripts/eval/results/'); process.exit(1); }
  return path.join(dir, f);
}

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : '—';

function main() {
  const file = args.file || newest();
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* truncated tail */ }
  }
  const arms = [...new Set(rows.flatMap(r => Object.keys(r.arms || {})))].sort();
  const ok = rows.filter(r => r.arms && arms.every(k => r.arms[k] && !r.arms[k].error));

  console.log(`\n  ${path.basename(file)} — ${rows.length} rows, ${ok.length} scored on all arms\n`);
  console.log('  ATTRIBUTION — model prose emitted OUTSIDE every annotation tag');
  console.log('  arm   pages with ≥1 untagged span    total spans');
  for (const k of arms) {
    const w = ok.filter(r => r.arms[k].total > 0).length;
    const t = ok.reduce((n, r) => n + r.arms[k].total, 0);
    console.log(`   ${k}    ${String(w).padStart(4)} / ${ok.length}   (${pct(w, ok.length).padStart(6)})      ${String(t).padStart(6)}`);
  }

  // Which marker kinds drive it — a single dominant kind means the metric is
  // measuring one habit, not "attribution" in general.
  console.log('\n  by marker kind');
  const kinds = [...new Set(ok.flatMap(r => arms.flatMap(k => Object.keys(r.arms[k].byKind || {}))))].sort();
  console.log(`    ${'kind'.padEnd(18)}${arms.map(k => k.padStart(9)).join('')}`);
  for (const kind of kinds) {
    const cells = arms.map(k => String(ok.reduce((n, r) => n + (r.arms[k].byKind?.[kind] || 0), 0)).padStart(9)).join('');
    console.log(`    ${kind.padEnd(18)}${cells}`);
  }

  // Fabrication proxy. A blank page should produce ~nothing.
  const blanks = ok.filter(r => (r.page.difficulty || []).includes('blank_page'));
  if (blanks.length) {
    console.log(`\n  FABRICATION PROXY — body text on ${blanks.length} pages whose OCR declares them BLANK`);
    console.log('  (the attribution metric is blind to this: invented text carries no marker)');
    console.log('  arm   median body chars   pages >2000 chars   max');
    for (const k of arms) {
      const v = blanks.map(r => r.arms[k].body_chars || 0);
      const big = v.filter(x => x > 2000).length;
      console.log(`   ${k}    ${String(median(v)).padStart(10)}       ${String(big).padStart(6)} / ${blanks.length}      ${String(Math.max(...v)).padStart(8)}`);
    }
  }

  // Per class — the reason for using the difficulty corpus at all.
  const byClass = new Map();
  for (const r of ok) for (const d of (r.page.difficulty || [])) {
    if (!byClass.has(d)) byClass.set(d, []);
    byClass.get(d).push(r);
  }
  console.log('\n  ATTRIBUTION by difficulty class (pages with ≥1 untagged span)');
  console.log(`    ${'class'.padEnd(20)}${arms.map(k => k.padStart(9)).join('')}     n`);
  for (const [cls, rs] of [...byClass.entries()].sort()) {
    const cells = arms.map(k => `${rs.filter(r => r.arms[k].total > 0).length}/${rs.length}`.padStart(9)).join('');
    console.log(`    ${cls.padEnd(20)}${cells}  ${String(rs.length).padStart(4)}`);
  }

  const errs = rows.length - ok.length;
  if (errs) console.log(`\n  ${errs} row(s) errored (image fetch or model call)`);
  console.log();
}

main();
