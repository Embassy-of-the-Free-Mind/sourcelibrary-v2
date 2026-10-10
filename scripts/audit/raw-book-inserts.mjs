#!/usr/bin/env node
/**
 * Refuse a NEW raw insert into `books` / `books_warehouse` — every new book goes
 * through the acquisition gate (#6019).
 *
 * PRIOR ART: scripts/audit/new-field-writes.mjs — the same baseline-ratchet lint
 * shape for `$set` of unknown fields; this one is about INSERTS bypassing the
 * gate, which that lint does not look at.
 *
 * WHY. The gate exists (src/lib/acquisition-guard.ts `acquisitionGate()`, and
 * scripts/lib/acquire-book.mjs `insertBookIfNew()` for direct importers), but
 * it only protects the paths that call it. Measured 2026-10-06: 53 files under
 * scripts/ insert books raw and 3 of them gate. Most are one-shot importers
 * that already ran, and rewriting them changes nothing. What matters is the
 * NEXT importer: it is usually written by copying one of these, so it inherits
 * the bypass. This lint fails the PR that adds it.
 *
 * WHAT COUNTS AS GATED: the file imports `insertBookIfNew` / `acquisitionGate`
 * (or `acquire-book`). Everything else that inserts into `books` or
 * `books_warehouse` must be in the baseline, each entry with a reason —
 * `one-shot` (ran once, kept as provenance), `move` (relocates a book the gate
 * already admitted, e.g. warehouse→live promotion), `artwork` (single-object
 * art records, not editions), `restore` (undelete), or `fix-me`.
 *
 * LIMITS — a lint, not a proof: it matches `collection('books')`,
 * `collection('books_warehouse')` and `books*` variables followed by
 * `.insertOne(` / `.insertMany(`. A collection name held in a variable is not
 * seen. Over-matching is the safe direction.
 *
 * USAGE
 *   node scripts/audit/raw-book-inserts.mjs                    # exit 1 on a new raw insert
 *   node scripts/audit/raw-book-inserts.mjs --list             # every site, gated or not
 *   node scripts/audit/raw-book-inserts.mjs --write-baseline   # record today's set (keeps reasons)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE = 'scripts/lib/raw-book-insert-baseline.json';
const SCAN = ['scripts', 'src'];
const SKIP_DIR = new Set(['node_modules', '_archived', 'worktrees', '.next', 'output']);
const INSERT = /(collection\(\s*['"`](books|books_warehouse)['"`]\s*\)|\bbooks\w*)\s*\.\s*(insertOne|insertMany)\s*\(/g;
const GATED = /\binsertBookIfNew\b|\bacquisitionGate\b|acquire-book(\.mjs)?['"]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js|ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
  }
  return out;
}

const sites = [];
for (const base of SCAN) {
  if (!existsSync(join(ROOT, base))) continue;
  for (const file of walk(join(ROOT, base))) {
    const src = readFileSync(file, 'utf8');
    const matches = [...src.matchAll(INSERT)];
    if (matches.length === 0) continue;
    // `books` variables that are plainly not the books collection (e.g. an
    // array `books.insertMany` never exists; `booksById` has no insert) are
    // rare enough to baseline rather than special-case.
    sites.push({ file: relative(ROOT, file), count: matches.length, gated: GATED.test(src) });
  }
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const s of sites.sort((a, b) => a.file.localeCompare(b.file))) console.log(`${s.gated ? 'gated  ' : 'RAW    '} ${s.count}  ${s.file}`);
  process.exit(0);
}

const baseline = existsSync(join(ROOT, BASELINE)) ? JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) : { files: {} };
const ungated = sites.filter((s) => !s.gated);

if (args.includes('--write-baseline')) {
  const files = {};
  for (const s of ungated.sort((a, b) => a.file.localeCompare(b.file))) files[s.file] = baseline.files?.[s.file] ?? 'fix-me';
  writeFileSync(join(ROOT, BASELINE), JSON.stringify({ note: baseline.note, files }, null, 2) + '\n');
  console.log(`baseline: ${Object.keys(files).length} ungated files recorded in ${BASELINE}`);
  process.exit(0);
}

const fresh = ungated.filter((s) => !(s.file in (baseline.files || {})));
const healed = Object.keys(baseline.files || {}).filter((f) => !ungated.some((s) => s.file === f));
console.log(`raw-book-inserts: ${sites.length} files insert books; ${sites.length - ungated.length} gated; ${ungated.length} ungated (${ungated.length - fresh.length} baselined).`);
if (healed.length) console.log(`  ${healed.length} baselined file(s) no longer insert raw — remove them from ${BASELINE}: ${healed.join(', ')}`);
if (fresh.length) {
  console.log('\nNEW raw insert(s) into books / books_warehouse — route them through the acquisition gate:');
  for (const s of fresh) console.log(`  ${s.file}`);
  console.log(`\n  scripts: import { insertBookIfNew } from '../lib/acquire-book.mjs'  (see its header)`);
  console.log(`  src/:    acquisitionGate() from '@/lib/acquisition-guard'`);
  console.log(`  A move/restore of an already-admitted book: add the file to ${BASELINE} with its reason.`);
  process.exit(1);
}
