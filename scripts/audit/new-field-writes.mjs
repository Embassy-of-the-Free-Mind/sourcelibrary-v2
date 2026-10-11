#!/usr/bin/env node

/**
 * Catch a NEW `books` field at review time, before it is ever written.
 *
 * WHY THIS LAYER EXISTS
 * The other guards miss the actual mechanism of field sprawl:
 *   - `scripts/lib/book-docs.mjs` constrains INSERT documents in importers.
 *     Sprawl came from maintenance sweeps doing `$set`, not from inserts.
 *   - The weekly watch (`field-sprawl-watch.yml`) DETECTS drift — but a week
 *     after the sweep already ran, on a collection it already changed.
 *   - The `$jsonSchema` validator is the real gate, but it lands in `warn`
 *     mode first and needs a dbAdmin action to install.
 * So there is a window where a sweep can add its column and nothing objects.
 * This closes it statically: unknown keys fail the build on the PR that
 * introduces them, which is the cheapest possible moment to notice.
 *
 * WHAT IT DOES
 * Finds `$set` / `$setOnInsert` blocks in files that talk to `books` and
 * reports literal top-level keys not on the known-field list. Nested keys
 * (`'first_translation.verdict'`) are checked at their ROOT, since that is what
 * `additionalProperties:false` constrains.
 *
 * DELIBERATE LIMITS — this is a lint, not a proof:
 *   - It cannot see computed keys (`$set: { [name]: v }`); those are reported
 *     separately as unverifiable rather than passed silently.
 *   - It attributes a `$set` to `books` by the HANDLE the write goes through:
 *     an inline `collection('books').updateOne(…)`, a hoisted
 *     `const books = db.collection('books')` used any distance below (#4493 —
 *     the old 900-character proximity rule never saw this, the dominant idiom
 *     in scripts/), or an update/ops array built one hop from the call. What
 *     it still cannot see is listed in scripts/lib/books-set-attribution.mjs.
 *   - `--list` also prints `$set: someVariable` sites it could not resolve.
 *
 * USAGE
 *   node scripts/audit/new-field-writes.mjs                 # exit 1 on unknown keys
 *   node scripts/audit/new-field-writes.mjs --list          # print every key found
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { booksSetBlocks, topKeys } from '../lib/books-set-attribution.mjs';

const LIST = process.argv.includes('--list');
// --baseline <file>: a recorded set of violations that already exist. The gate
// then fails only on NEW ones. Without this the linter would red-X every build
// on day one over 24 pre-existing writes, and a check that always fails is a
// check everyone disables. --write-baseline regenerates it.
const BASELINE = (() => { const i = process.argv.indexOf('--baseline'); return i > -1 ? process.argv[i + 1] : null; })();
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const ROOTS = ['src', 'scripts'];
const SKIP = /(_archived|node_modules|\.next|worktrees|\/vendor\/)/;

// The known surface — the FULL-SCAN enumeration of production, tracked in the
// repo so the linter and the $jsonSchema validator share ONE list. Using the
// importer whitelist here instead produced 180 false positives, because plenty
// of real book fields (doi, job, summary_candidate) are written by app and
// maintenance paths that importers never touch.
const knownDoc = JSON.parse(readFileSync('scripts/lib/books-known-fields.json', 'utf8'));
const known = new Set(knownDoc.fields);
const retired = new Set(knownDoc.retired || []);

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

const unknown = [];
const computed = [];
const opaque = [];
let scanned = 0, setBlocks = 0, hoisted = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    if (!/collection(?:<[^>()]*>)?\(\s*['"`]books['"`]\s*\)/.test(src)) continue;
    scanned++;

    // Attribute each $set to the collection of ITS OWN update call. A
    // file-wide sweep blamed `pages`, `analytics_events` and `batch_jobs`
    // writes on `books` and produced 814 false positives — a lint that cries
    // wolf is worse than no lint, and is exactly how the worktree reaper
    // trained everyone to pass --force. The rules (inline window, hoisted
    // handle, one-hop built update) live in scripts/lib/books-set-attribution.mjs
    // so tests/unit/new-field-writes-attribution.test.ts can pin each idiom.
    const { sets, opaque: opq } = booksSetBlocks(src);
    for (const at of opq) opaque.push(`${file}:${src.slice(0, at).split('\n').length}`);
    for (const { index, body, via } of sets) {
      setBlocks++;
      const line = src.slice(0, index).split('\n').length;
      if (via !== 'inline') hoisted++;
      if (/\[\s*[A-Za-z_$]/.test(body)) computed.push(`${file}:${line}`);
      for (const k of topKeys(body)) {
        const root2 = k.split('.')[0];
        if (retired.has(root2)) unknown.push({ file, line, key: k, root: root2, retired: true });
        else if (!known.has(root2)) unknown.push({ file, line, key: k, root: root2 });
        else if (LIST) console.log(`  ok  ${file}:${line} ${k}`);
      }
    }
  }
}

console.log(`files touching books : ${scanned}`);
console.log(`$set blocks examined : ${setBlocks} (${hoisted} reached through a hoisted handle or a built update)`);
console.log(`computed-key blocks  : ${computed.length}${computed.length ? ' (cannot be checked statically)' : ''}`);
console.log(`opaque $set blocks    : ${opaque.length}${opaque.length ? ' ($set: someVariable — built elsewhere, not checked)' : ''}`);
console.log(`UNKNOWN field writes : ${unknown.length}`);
if (LIST) for (const o of opaque) console.log(`  opaque  ${o}`);
for (const u of unknown) console.log(`   !! ${u.file}:${u.line}  $set '${u.key}'  (${u.retired ? `root '${u.root}' is RETIRED — re-growing a deleted field` : `root '${u.root}' is not a known books field`})`);

// A violation's identity is file+key, NOT the line number — otherwise every
// unrelated edit above it reads as a new violation.
const idOf = (u) => `${u.file}::${u.root}`;

if (WRITE_BASELINE && BASELINE) {
  writeFileSync(BASELINE, JSON.stringify({
    _comment: [
      'Pre-existing $set writes of fields absent from scripts/lib/books-known-fields.json.',
      'The gate fails only on entries NOT listed here, so new drift is caught while the',
      'existing backlog stays visible instead of turning the check into noise.',
      'Shrink this list; never grow it. Each entry is either a field that should be',
      'added to the known list deliberately, or a write that should become a sweep_log row.',
    ],
    count: [...new Set(unknown.map(idOf))].length,
    accepted: [...new Set(unknown.map(idOf))].sort(),
  }, null, 2));
  console.log(`\nwrote baseline ${BASELINE}`);
  process.exit(0);
}

let accepted = new Set();
if (BASELINE && existsSync(BASELINE)) accepted = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).accepted || []);

const fresh = unknown.filter((u) => !accepted.has(idOf(u)));
const stale = [...accepted].filter((id) => !unknown.some((u) => idOf(u) === id));

if (BASELINE) {
  console.log(`baselined (accepted) : ${unknown.length - fresh.length}`);
  console.log(`NEW violations       : ${fresh.length}`);
  for (const u of fresh) console.log(`   !! NEW ${u.file}:${u.line}  $set '${u.key}'`);
  if (stale.length) console.log(`\nbaseline entries no longer present (remove them): ${stale.join(', ')}`);
}

const failing = BASELINE ? fresh : unknown;
if (failing.length) {
  console.log('\nA sweep must record a ROW, not a COLUMN — see .claude/docs/invariants/field-sprawl.md.');
  console.log('If the field is genuinely needed, add it to scripts/lib/books-known-fields.json in this PR');
  console.log('(regenerate from a full scan) and re-emit the validator.');
  console.log('If it records what a job DID, use scripts/lib/sweep-log.mjs instead.');
}
process.exit(failing.length ? 1 : 0);
