#!/usr/bin/env node
// PRIOR ART: scripts/audit/new-field-writes.mjs — same walk, same file::key ratcheting baseline, and it calls this
// gate so the existing `field-write-lint` CI step enforces it. It checks that a column is KNOWN; this checks that a
// write of a known imprint column goes through the one path that stamps it (#6327).
/**
 * Fail on a write of an imprint field (year, place, printer) on `books` outside setCatalogueFields().
 *
 * WHY: a citation is only as good as the record of where its imprint came from. On 2026-10-08 a featured book
 * read "Venice, Aldus Manutius, 1516" with no field_provenance stamp on the place or the printer; the title page
 * says Lyon, 1549. The rule is in scripts/lib/catalogue-fields.mjs; detection limits in imprint-write-lint.mjs.
 *
 * The baseline (scripts/lib/imprint-write-baseline.json) is today's writers. It may only SHRINK: a file::field
 * not in it fails, and an entry that no longer matches is reported so the next PR removes it. To fix a new
 * violation, route the write through setCatalogueFields(); if the line is not a books write at all, mark it
 * `// imprint-write-ok: <reason>`. Do not add to the baseline.
 *
 *   node scripts/audit/imprint-field-writes.mjs                    # exit 1 on a write not in the baseline
 *   node scripts/audit/imprint-field-writes.mjs --list             # every write found, baselined or not
 *   node scripts/audit/imprint-field-writes.mjs --write-baseline   # regenerate (only to SHRINK it)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imprintWritesIn, imprintWriteId, IMPRINT_WRITE_EXEMPT } from '../lib/imprint-write-lint.mjs';

export const IMPRINT_BASELINE = 'scripts/lib/imprint-write-baseline.json';
const ROOTS = ['src', 'scripts'];
const SKIP = /(_archived|node_modules|\.next|worktrees|\/vendor\/)/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (SKIP.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(mjs|ts|tsx|js)$/.test(p)) out.push(p);
  }
  return out;
}

export function scanImprintWrites() {
  const found = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (IMPRINT_WRITE_EXEMPT.has(file)) continue;
      for (const w of imprintWritesIn(readFileSync(file, 'utf8'))) found.push({ file, ...w });
    }
  }
  return found;
}

/** Run the gate; returns the number of NEW violations (0 = pass). Prints its own report. */
export function runImprintGate({ list = false, writeBaseline = false, log = console.log } = {}) {
  const found = scanImprintWrites();
  const ids = [...new Set(found.map((w) => imprintWriteId(w.file, w.field)))].sort();
  if (writeBaseline) {
    writeFileSync(IMPRINT_BASELINE, JSON.stringify({
      _comment: [
        'Writes of gated catalogue fields (scripts/lib/catalogue-fields.mjs CATALOGUE_FIELDS: imprint, title, author) on books outside',
        'setCatalogueFields(), as of the PRs that introduced the gate (#6327 imprint, #7673 title and author). Each can leave a',
        'value with no field_provenance stamp. This list may only SHRINK: move a writer onto the helper and',
        'delete its line. A new writer fails CI; it does not get added here.',
      ],
      count: ids.length,
      files: new Set(found.map((w) => w.file)).size,
      accepted: ids,
    }, null, 2) + '\n');
    log(`wrote ${IMPRINT_BASELINE} (${ids.length} file::field entries)`);
    return 0;
  }
  const accepted = new Set(existsSync(IMPRINT_BASELINE) ? JSON.parse(readFileSync(IMPRINT_BASELINE, 'utf8')).accepted || [] : []);
  const fresh = found.filter((w) => !accepted.has(imprintWriteId(w.file, w.field)));
  const stale = [...accepted].filter((id) => !ids.includes(id));
  log(`imprint writes outside setCatalogueFields : ${found.length} sites in ${new Set(found.map((w) => w.file)).size} files`);
  log(`baselined (accepted)                      : ${found.length - fresh.length}`);
  log(`NEW imprint writes                        : ${fresh.length}`);
  if (list) for (const w of found) log(`  ${w.how.padEnd(6)} ${w.file}:${w.line} ${w.field}`);
  for (const w of fresh) log(`   !! NEW ${w.file}:${w.line}  ${w.how} '${w.field}'`);
  if (stale.length) log(`\nimprint baseline entries no longer present (remove them from ${IMPRINT_BASELINE}): ${stale.join(', ')}`);
  if (fresh.length) {
    log('\nA catalogue field (year, place, printer, title, display_title, english_title, author) must be written with its provenance stamp — use');
    log('setCatalogueFields() from scripts/lib/catalogue-fields.mjs (#6327, #7673). If the line is not a books write,');
    log('mark it `// imprint-write-ok: <reason>`. Do not add it to the baseline.');
  }
  return fresh.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exit(runImprintGate({
    list: process.argv.includes('--list'),
    writeBaseline: process.argv.includes('--write-baseline'),
  }) ? 1 : 0);
}
