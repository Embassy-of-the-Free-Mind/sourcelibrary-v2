#!/usr/bin/env node
/**
 * Metadata spot check (#6056), stage 3: turn the reviewers' per-field verdicts into the round's
 * `findings.json` (one row per wrong or missing field) and `report.json` (defect rate per field with a
 * Wilson 95% interval, by book; and a frame-weighted rate over the provider groups). No Mongo, no model.
 *
 * PRIOR ART: scripts/eval/spot-check/register.mjs — registers PAGE findings (taxonomy class, severity,
 * lane) and clusters them across rounds. Metadata verdicts are per FIELD, with a different unit and
 * vocabulary, so they get their own register; the cluster step for this frame is
 * scripts/audit/catalogue-field-contradictions.mjs.
 *
 *   node scripts/eval/spot-check/meta-register.mjs scripts/eval/results/spot-check/meta-2026-10-19-r1
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2];
if (!DIR) { console.error('usage: meta-register.mjs <round dir>'); process.exit(2); }
const log = JSON.parse(readFileSync(join(DIR, 'draw-log.json'), 'utf8'));
const sample = JSON.parse(readFileSync(join(DIR, 'sample.json'), 'utf8'));
const groupOf = Object.fromEntries(sample.map((s) => [s.id, s.group]));
const books = readdirSync(join(DIR, 'reviews')).filter((f) => f.endsWith('.json')).sort()
  .flatMap((f) => JSON.parse(readFileSync(join(DIR, 'reviews', f), 'utf8')).books.map((b) => ({ ...b, packet: f })));

export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d].map((x) => Math.round(x * 1000) / 1000);
}

const findings = [];
for (const b of books) {
  for (const [field, v] of Object.entries(b.fields || {})) {
    if (!['wrong', 'missing'].includes(v.verdict)) continue;
    findings.push({ book_id: b.id, group: groupOf[b.id], field, verdict: v.verdict, class: v.class || null, severity: v.severity || null,
      catalogued: v.catalogued ?? null, book_shows: v.book_shows ?? null, quote: v.quote ?? null, page: v.page ?? null,
      url: v.page ? `https://sourcelibrary.org/book/${b.id}?page=${v.page}` : `https://sourcelibrary.org/book/${b.id}`, note: v.note || null });
  }
}

const FIELDS = [...new Set(books.flatMap((b) => Object.keys(b.fields || {})))].sort();
const groupSize = Object.fromEntries(Object.entries(log.cell_sizes).map(([g, c]) => [g, Object.values(c).reduce((a, x) => a + x, 0)]));
const total = Object.values(groupSize).reduce((a, x) => a + x, 0);
const perField = {};
for (const f of FIELDS) {
  const ev = books.filter((b) => ['ok', 'wrong', 'missing'].includes(b.fields?.[f]?.verdict));
  const bad = ev.filter((b) => ['wrong', 'missing'].includes(b.fields[f].verdict));
  const serious = ev.filter((b) => b.fields[f].severity === 'serious' && ['wrong', 'missing'].includes(b.fields[f].verdict));
  // Frame-weighted: per provider group rate × the group's share of the live frame.
  let w = 0, wsum = 0;
  for (const g of Object.keys(groupSize)) {
    const ge = ev.filter((b) => groupOf[b.id] === g);
    if (!ge.length) continue;
    w += (groupSize[g] / total) * (ge.filter((b) => ['wrong', 'missing'].includes(b.fields[f].verdict)).length / ge.length);
    wsum += groupSize[g] / total;
  }
  perField[f] = { evaluable: ev.length, wrong: ev.filter((b) => b.fields[f].verdict === 'wrong').length, missing: ev.filter((b) => b.fields[f].verdict === 'missing').length,
    defect_rate: ev.length ? Math.round((bad.length / ev.length) * 1000) / 1000 : null, ci95: wilson(bad.length, ev.length),
    serious: serious.length, serious_rate: ev.length ? Math.round((serious.length / ev.length) * 1000) / 1000 : null, serious_ci95: wilson(serious.length, ev.length),
    frame_weighted_defect_rate: wsum ? Math.round((w / wsum) * 1000) / 1000 : null };
}
const anySerious = books.filter((b) => Object.values(b.fields || {}).some((v) => v.severity === 'serious' && ['wrong', 'missing'].includes(v.verdict)));
const byClass = findings.reduce((m, r) => { const k = r.class || 'unclassed'; (m[k] ||= { n: 0, books: new Set() }).n++; m[k].books.add(r.book_id); return m; }, {});
const classes = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { findings: v.n, books: v.books.size }]).sort((a, b) => b[1].books - a[1].books));

writeFileSync(join(DIR, 'findings.json'), JSON.stringify({ round: DIR.split('/').pop(), seed: log.seed, n_books: books.length, frame: log.frame, findings }, null, 1));
writeFileSync(join(DIR, 'report.json'), JSON.stringify({ seed: log.seed, n_books: books.length, findings: findings.length,
  books_with_serious: { n: anySerious.length, rate: anySerious.length / books.length, ci95: wilson(anySerious.length, books.length) },
  per_field: perField, classes }, null, 1));
console.log(`${books.length} books · ${findings.length} findings · books with a serious field error ${anySerious.length} (${wilson(anySerious.length, books.length).join('–')})`);
for (const [f, v] of Object.entries(perField)) console.log(f.padEnd(18), `${v.wrong + v.missing}/${v.evaluable}`.padStart(6), String(v.defect_rate).padStart(6), JSON.stringify(v.ci95).padEnd(14), 'serious', `${v.serious}/${v.evaluable}`, 'fw', v.frame_weighted_defect_rate);
