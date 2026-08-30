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
 *   - It attributes a `$set` to `books` by proximity to a `collection('books')`
 *     call in the same file, so a file touching several collections can
 *     over-report. Over-reporting is the safe direction for a lint.
 *
 * USAGE
 *   node scripts/audit/new-field-writes.mjs                 # exit 1 on unknown keys
 *   node scripts/audit/new-field-writes.mjs --list          # print every key found
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

/** Read a balanced { … } starting at `open`, skipping strings/templates. */
function readBraces(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') { i += 2; continue; } i++; } continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return src.slice(open + 1, i); }
  }
  return null;
}

/** Top-level keys of an object-literal body. */
function topKeys(body) {
  const keys = []; let d = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"') {
      if (d === 0) {
        const m = /^(['"])([^'"]+)\1\s*:/.exec(body.slice(i));
        if (m) { keys.push(m[2]); i += m[0].length - 1; continue; }
      }
      const q = c; i++; while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '`') { i++; while (i < body.length && body[i] !== '`') { if (body[i] === '\\') { i += 2; continue; } i++; } continue; }
    if (c === '{' || c === '[' || c === '(') { d++; continue; }
    if (c === '}' || c === ']' || c === ')') { d--; continue; }
    if (d === 0) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
      if (m && (i === 0 || /[\s,{]/.test(body[i - 1]))) { keys.push(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}

const unknown = [];
const computed = [];
let scanned = 0, setBlocks = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    if (!/collection\(\s*['"]books['"]\s*\)/.test(src)) continue;
    scanned++;

    // Attribute each $set to the collection of ITS OWN update call. A
    // file-wide sweep blamed `pages`, `analytics_events` and `batch_jobs`
    // writes on `books` and produced 814 false positives — a lint that cries
    // wolf is worse than no lint, and is exactly how the worktree reaper
    // trained everyone to pass --force. So: walk forward from each
    // collection('books') call only, within one statement's reach, and bail
    // if another collection() intervenes.
    const WINDOW = 900;
    const collRe = /collection\(\s*['"]books['"]\s*\)/g;
    const regions = [];
    let cm;
    while ((cm = collRe.exec(src))) regions.push([cm.index, cm.index + WINDOW]);

    const re = /\$set(?:OnInsert)?\s*:\s*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const region = regions.find(([a, b]) => m.index > a && m.index < b);
      if (!region) continue;
      const between = src.slice(region[0] + 1, m.index);
      if (/collection\(\s*['"](?!books['"])/.test(between)) continue;
      const body = readBraces(src, m.index + m[0].length - 1);
      if (body === null) continue;
      setBlocks++;
      const line = src.slice(0, m.index).split('\n').length;
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
console.log(`$set blocks examined : ${setBlocks}`);
console.log(`computed-key blocks  : ${computed.length}${computed.length ? ' (cannot be checked statically)' : ''}`);
console.log(`UNKNOWN field writes : ${unknown.length}`);
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
