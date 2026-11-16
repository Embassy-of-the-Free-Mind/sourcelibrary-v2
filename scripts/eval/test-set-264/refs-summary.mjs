#!/usr/bin/env node
// #264 stage 2: per frame cell, how many frame pages have an accepted same-edition reference
// before stage 2 (stage 1 reference rows) and after (plus the accepted records in refs/),
// what the rest stay judged-only for, and the canonical share of accepted references.
// Sealed-reserve rows are counted, never listed.
//
// PRIOR ART: scripts/eval/test-set-264/inventory.mjs — counts the inventory by cell before the draw, not
// references against the sealed frame; scripts/eval/test-set-264/refs-lib.mjs — writes records, no summary.
//
// Usage: node scripts/eval/test-set-264/refs-summary.mjs [--md | --pricing]
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../dataset/test-set-264');
const frame = fs.readFileSync(path.join(DIR, 'frame.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const coverage = fs.readFileSync(path.join(DIR, 'refs/coverage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const records = fs.readdirSync(path.join(DIR, 'refs')).filter((n) => /^ts264-[0-9a-f]+\.json$/.test(n))
  .map((n) => JSON.parse(fs.readFileSync(path.join(DIR, 'refs', n), 'utf8')));
const accepted = new Map(records.filter((r) => r.accepted === true).map((r) => [r.row, r]));
const covByRow = new Map(coverage.map((c) => [c.row, c]));

const cells = new Map();
for (const r of frame) {
  const c = cells.get(r.frame_cell) ?? { cell: r.frame_cell, pages: 0, reserve: 0, before: 0, after: 0, canonical: 0, why: {} };
  cells.set(r.frame_cell, c);
  c.pages++;
  if (r.reserve) c.reserve++;
  const had = (r.truth_available ?? []).some((t) => t.kind === 'reference');
  const rec = accepted.get(r.row);
  if (had) c.before++;
  if (had || rec) {
    c.after++;
    if (rec ? rec.canonical === true : (r.truth_available.find((t) => t.kind === 'reference')?.canonical ?? r.canonical) === true) c.canonical++;
    continue;
  }
  const cov = covByRow.get(r.row);
  const ms = r.observed?.kind === 'manuscript' || /manuscript/.test(r.frame_cell);
  c[ms ? 'leftMs' : 'leftPrint'] = (c[ms ? 'leftMs' : 'leftPrint'] ?? 0) + 1;
  const why = r.origin === 'judged' ? 'existing judged truth, not searched' : cov ? cov.outcome : 'no coverage line';
  c.why[why] = (c.why[why] ?? 0) + 1;
}

const rows = [...cells.values()].sort((a, b) => b.pages - a.pages);
const tot = rows.reduce((t, c) => { for (const k of ['pages', 'reserve', 'before', 'after', 'canonical']) t[k] += c[k]; for (const [k, v] of Object.entries(c.why)) t.why[k] = (t.why[k] ?? 0) + v; return t; },
  { cell: 'TOTAL', pages: 0, reserve: 0, before: 0, after: 0, canonical: 0, why: {} });
const fmtWhy = (w) => Object.entries(w).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');

if (process.argv.includes('--md')) {
  console.log('| cell | frame pages (reserve) | with reference before | after | judged-only | canonical share of refs | why judged-only |');
  console.log('|---|---|---|---|---|---|---|');
  for (const c of [...rows, tot]) {
    console.log(`| ${c.cell} | ${c.pages} (${c.reserve}) | ${c.before} | ${c.after} | ${c.pages - c.after} | ${pct(c.canonical, c.after)} | ${fmtWhy(c.why)} |`);
  }
} else if (process.argv.includes('--pricing')) {
  // eval-design section 4.2: 20 min a printed page, 45 min a manuscript page. Hourly rates (published, 2026-11-14):
  // École nationale des chartes student service EUR 23/h; Ancestral Deeds GBP 25-30/h; Borthwick Institute GBP 50/h.
  // In USD at ~1.15 EUR and ~1.30 GBP: low 26.5, high 65.
  const LOW = 26.5, HIGH = 65;
  console.log('| cell | judged-only print | judged-only manuscript | hours | USD (low-high) |');
  console.log('|---|---|---|---|---|');
  let P = 0, M = 0;
  for (const c of rows) {
    const p = c.leftPrint ?? 0, m = c.leftMs ?? 0; P += p; M += m;
    const h = (p * 20 + m * 45) / 60;
    console.log(`| ${c.cell} | ${p} | ${m} | ${h.toFixed(0)} | ${Math.round(h * LOW)}-${Math.round(h * HIGH)} |`);
  }
  const h = (P * 20 + M * 45) / 60;
  console.log(`| TOTAL | ${P} | ${M} | ${h.toFixed(0)} | ${Math.round(h * LOW)}-${Math.round(h * HIGH)} |`);
} else {
  console.log(JSON.stringify({ rows, total: tot }, null, 1));
}
