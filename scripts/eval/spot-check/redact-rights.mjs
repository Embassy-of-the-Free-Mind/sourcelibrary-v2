#!/usr/bin/env node
/**
 * PRIOR ART: ROUTINE.md step 7 (does this by hand, per run). This makes the step one command so no run commits a
 * reviewer's rights wording to this public repo.
 *
 * redact-rights — replace every non-null `rights_flag` note with `true` in review/result JSON files.
 *   node scripts/eval/spot-check/redact-rights.mjs <file.json>...
 */
import { readFileSync, writeFileSync } from 'node:fs';

for (const f of process.argv.slice(2)) {
  const books = JSON.parse(readFileSync(f, 'utf8'));
  let n = 0;
  for (const b of books) if (b.rights_flag && b.rights_flag !== true) { b.rights_flag = true; n++; }
  writeFileSync(f, JSON.stringify(books, null, 2));
  console.log(`${f}: ${books.length} books, ${n} rights note(s) redacted`);
}
