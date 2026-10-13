#!/usr/bin/env node
/**
 * Gate: every NEW experiment write-up carries a valid header (#5939).
 *
 * PRIOR ART: scripts/eval/build-experiments.mjs --check — validates the heading
 * and the generated EXPERIMENTS.md, nothing inside an entry; and
 * scripts/audit/append-only-ledgers.mjs --pr — the PR gate on the generated
 * ledgers, run from the same CI step list. This is the third check of that set:
 * the header that lets the index, /quality and the canon pages read an entry
 * without a person wiring it in by hand.
 *
 * WHAT IT CHECKS (scripts/eval/experiments/, the schema in its README.md):
 *   - every file that HAS a header: it parses and validates (always);
 *   - every dated entry (YYYY-MM-DD-*.md) ADDED by the PR: it has a header (--pr / --base);
 *   - every dated entry: it has a header (--strict; once the backfill has landed).
 * Files without a header that were already on main are grandfathered and listed
 * as a count, until backfilled; the weekly garden (scripts/audit/experiments-garden.mjs)
 * lists them by name.
 *
 *   node scripts/eval/experiments-lint.mjs                   # headers present are valid
 *   node scripts/eval/experiments-lint.mjs --pr 5940         # + files the PR adds have one (needs gh)
 *   node scripts/eval/experiments-lint.mjs --base origin/main # + files added since <ref> have one (git)
 *   node scripts/eval/experiments-lint.mjs --strict          # every dated entry has one
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readExperiment, canonIds } from './lib/experiment-header.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'experiments');
const REL = 'scripts/eval/experiments/';
const DATED = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

/** Lint a directory. `added` = names that must carry a header; strict = all dated entries must. */
export function lintExperiments(dir = DIR, { added = [], strict = false, canons = canonIds() } = {}) {
  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md').sort();
  const exists = (n) => names.includes(n);
  const errors = [];
  const missing = [];
  for (const n of names) {
    const { header, problems } = readExperiment(fs.readFileSync(path.join(dir, n), 'utf8'), { name: n, exists, canons });
    for (const p of problems) errors.push(`${n}: ${p}`);
    if (header || problems.length || !DATED.test(n)) continue;
    if (strict || added.includes(n)) errors.push(`${n}: no header — a new entry starts with the front matter in ${REL}README.md`);
    else missing.push(n);
  }
  return { errors, grandfathered: missing, files: names.length };
}

function addedByPr(pr) {
  const out = execFileSync('gh', ['api', '--paginate', `repos/{owner}/{repo}/pulls/${pr}/files`, '--jq', '.[] | select(.status == "added") | .filename'], { encoding: 'utf8' });
  return out.split('\n').filter((f) => f.startsWith(REL)).map((f) => f.slice(REL.length));
}

function addedSince(ref) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', `${ref}...HEAD`, '--', REL], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((f) => f.slice(REL.length));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const added = val('--pr') ? addedByPr(val('--pr')) : val('--base') ? addedSince(val('--base')) : [];
  const { errors, grandfathered, files } = lintExperiments(DIR, { added, strict: argv.includes('--strict') });
  for (const e of errors) console.error(`experiments-lint: ${e}`);
  if (added.length) console.log(`${added.length} new file(s) checked for a header: ${added.join(', ')}`);
  if (grandfathered.length) console.log(`${grandfathered.length} older entries have no header yet (grandfathered until backfilled)`);
  if (errors.length) {
    console.error(`\n${errors.length} problem(s). The header schema: ${REL}README.md ("The header").`);
    process.exit(1);
  }
  console.log(`experiments-lint: ${files} files, ${files - grandfathered.length} with a valid header or exempt`);
}
