#!/usr/bin/env node
// PRIOR ART: none — scripts/eval/estimator/provenance.mjs labelLegacy is the rule; this applies it to the row files
// committed before rows carried provenance (#6740). Looked in scripts/eval/estimator/, scripts/maintenance/.
/**
 * Label every committed legacy estimator row with provenance: "legacy-not-recorded" and the statement
 * provenance-legacy.json holds for its source (#6740). Idempotent: a rerun rewrites the statement from the registry.
 * Throws on a row whose source has no registry entry, so an unread source cannot be labelled by default.
 *
 *   node scripts/eval/estimator/label-legacy-rows.mjs [--check]     (--check: validate only, write nothing)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelLegacy, legacyStated, validateFile } from './provenance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes('--check');
/** file (relative to this directory) -> [registry table, row -> candidate keys] */
export const LEGACY_FILES = {
  'ocr/failure-observations.jsonl': ['failure-observations', (r) => [r.source]],
  'ocr/results/arabic-rows.jsonl': ['arabic-rows', (r) => [r.source]],
  ...Object.fromEntries(['failures', 'ocr-table', 'refs-scored', 'reference-pairs', 'corrections', 'throughput']
    .map((f) => [`ocr/results/route-census-6740/${f}.jsonl`, ['route-census-6740', () => [`${f}.jsonl`]]])),
};

for (const [rel, [table, keys]] of Object.entries(LEGACY_FILES)) {
  const file = path.join(HERE, rel);
  if (!CHECK) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      const row = JSON.parse(l);
      if (row._doc !== undefined && Object.keys(row).length === 1) return l;
      if (row.provenance && row.provenance !== 'legacy-not-recorded') return l;   // a measured row keeps its block
      const { provenance, provenance_stated, ...rest } = row;
      return JSON.stringify(labelLegacy(rest, legacyStated(table, keys(rest))));
    });
    fs.writeFileSync(file, out.join('\n'));
  }
  const r = validateFile(file);
  console.log(`${rel}: ${r.rows} rows, ${r.legacy} legacy`);
}
