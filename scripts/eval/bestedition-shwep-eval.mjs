#!/usr/bin/env node
/**
 * Eval gate for the #3888 bestEdition ranking change.
 *
 * Fixture: scripts/eval/fixtures/bestedition-shwep-labeled.json — 30 hand-labeled
 * multi-edition works from the SHWEP cited-works set (467 works / 890 held editions),
 * a mix of cited-edition cases (the citation names an editor we hold), critical-vs-
 * translation cases, and omnibus cases. Each work carries the full held-edition metas
 * (a snapshot of catalog metadata, 2026-08-11) and an `acceptable` set: the edition(s)
 * a scholar following the citation should land on, with a `note` giving the rationale.
 *
 * Reports agreement for the LEGACY ranking (no opts) vs the NEW ranking (workLanguage
 * + citedEdition passed). Pure and offline — no DB, no network. Run:
 *   node scripts/eval/bestedition-shwep-eval.mjs
 * Exits non-zero if the new ranking scores below the legacy one (regression gate).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bestEdition } from '../lib/holdings-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bestedition-shwep-labeled.json'), 'utf8'));

let legacyOk = 0, newOk = 0;
const rows = [];
for (const w of fixture) {
  const legacy = bestEdition(w.editions);
  const next = bestEdition(w.editions, {
    workLanguage: w.workLanguage || undefined,
    citedEdition: w.citedEditions && w.citedEditions.length ? w.citedEditions : undefined,
    workAuthor: w.author,
    workTitle: w.work,
  });
  const ok = (pick) => !!pick && w.acceptable.includes(pick.id);
  if (ok(legacy)) legacyOk++;
  if (ok(next)) newOk++;
  rows.push({
    work: `${w.work} — ${w.author}`,
    legacy: legacy ? `${ok(legacy) ? 'OK ' : 'MISS'} ${legacy.title.slice(0, 48)} (${legacy.year || '?'} ${legacy.language})` : 'none',
    new: next ? `${ok(next) ? 'OK ' : 'MISS'} ${next.title.slice(0, 48)} (${next.year || '?'} ${next.language})` : 'none',
    changed: legacy?.id !== next?.id,
  });
}

for (const r of rows) {
  console.log(`${r.changed ? '≠' : '='} ${r.work}`);
  console.log(`    legacy: ${r.legacy}`);
  console.log(`    new:    ${r.new}`);
}
console.log(`\nAgreement with hand labels (n=${fixture.length}):`);
console.log(`  legacy ranking: ${legacyOk}/${fixture.length}`);
console.log(`  new ranking:    ${newOk}/${fixture.length}`);
console.log(`  picks changed:  ${rows.filter(r => r.changed).length}`);

if (newOk < legacyOk) {
  console.error('\nREGRESSION: new ranking scores below legacy — do not ship.');
  process.exit(1);
}
