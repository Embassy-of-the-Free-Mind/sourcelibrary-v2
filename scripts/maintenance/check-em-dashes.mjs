#!/usr/bin/env node
/**
 * CI guard: no new em dashes in reader-facing copy (#6215).
 *
 * Derek, 2026-10-07: "no em dashes or AI writing anywhere on the site." The em
 * dash is the most visible tell of machine-written prose, and it kept coming
 * back because every new page was drafted the same way. A prose rule in a doc
 * did not hold (#234, #3038), so this is the check.
 *
 * PRIOR ART: scripts/audit/no-vercel-blob.mjs — same shape (static source scan,
 * no network, gates PRs in unit-tests.yml), but it greps for a host string; an
 * em dash is legitimate in comments, so this one needs a real tokenizer.
 *
 * WHAT IT SCANS. Every tracked .ts/.tsx file under src/app and src/components.
 * Each file is parsed with the TypeScript compiler, and only the tokens a reader
 * can see are counted: JSX text, string literals (including JSX attribute
 * values) and template-literal text. Comments are never tokens, so a dash in a
 * comment is fine. Arguments to console.* are skipped (they reach a log, not a
 * person).
 *
 * THE ALLOWLIST is a RATCHET, not an exemption list:
 *   scripts/maintenance/em-dash-allowlist.txt
 *   <path> <max-count>  # reason
 * A file may hold at most <max-count> em dashes. A file not listed may hold
 * none. Counts only go down: `--tighten` rewrites every allowance to the
 * current count (keeping the reasons) and drops entries that reached zero.
 * Raising a number is a reviewed diff with a reason, never a flag.
 *
 * Justified cases (keep the entry, give the reason): an em dash inside a quoted
 * source title, a placeholder char the reader never sees as prose, a regex or
 * parser that has to MATCH an em dash in OCR text. For an empty table cell use
 * an en dash (–) instead.
 *
 * Usage:
 *   node scripts/maintenance/check-em-dashes.mjs            # check (exit 1 on a new one)
 *   node scripts/maintenance/check-em-dashes.mjs --list     # print every hit, file:line
 *   node scripts/maintenance/check-em-dashes.mjs --tighten  # lower allowances to current counts
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import ts from 'typescript';

// `--root=src/lib` (repeatable) scans another tree for a one-off --list.
const ROOT_ARGS = process.argv.filter((a) => a.startsWith('--root=')).map((a) => a.slice(7));
const ROOTS = ROOT_ARGS.length ? ROOT_ARGS : ['src/app', 'src/components'];
const ALLOWLIST = 'scripts/maintenance/em-dash-allowlist.txt';
const EM = '—';

const LIST = process.argv.includes('--list');
const TIGHTEN = process.argv.includes('--tighten');

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '--', ...ROOTS], { encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));
}

function isConsoleArg(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      return ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression)
        && callee.expression.text === 'console';
    }
    if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

/** Returns [{ line, text }] for each em dash in a reader-visible token. */
function scan(file) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(EM) && !/\\u2014|&mdash;|&#8212;/i.test(src)) return [];
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const record = (node, text) => {
    const n = text.split(EM).length - 1;
    if (!n || isConsoleArg(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const snippet = src.split('\n')[line].trim().slice(0, 140);
    for (let i = 0; i < n; i++) hits.push({ line: line + 1, text: snippet });
  };
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.JsxText:
        // JSX text keeps HTML entities literally; count those too.
        record(node, node.getText(sf).replace(/&mdash;|&#8212;/gi, EM));
        break;
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
        if (node.parent && ts.isImportDeclaration(node.parent)) break;
        record(node, node.text.replace(/&mdash;|&#8212;/gi, EM));
        break;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function readAllowlist() {
  const allow = new Map();
  if (!existsSync(ALLOWLIST)) return allow;
  for (const raw of readFileSync(ALLOWLIST, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [path, count] = line.split(/\s+/);
    allow.set(path, { max: Number(count), raw });
  }
  return allow;
}

const counts = new Map();
let total = 0;
for (const file of trackedFiles()) {
  const hits = scan(file);
  if (!hits.length) continue;
  counts.set(file, hits.length);
  total += hits.length;
  if (LIST) for (const h of hits) console.log(`${file}:${h.line}  ${h.text}`);
}

const allow = readAllowlist();

if (TIGHTEN) {
  const lines = readFileSync(ALLOWLIST, 'utf8').split('\n');
  const out = [];
  for (const raw of lines) {
    const m = raw.match(/^(\S+)\s+(\d+)(\s*#.*)?$/);
    if (!m || m[1].startsWith('#')) { out.push(raw); continue; }
    const now = counts.get(m[1]) ?? 0;
    if (now === 0) continue;
    out.push(`${m[1]} ${Math.min(now, Number(m[2]))}${m[3] ?? ''}`);
  }
  writeFileSync(ALLOWLIST, out.join('\n'));
  console.log(`Tightened ${ALLOWLIST}.`);
  process.exit(0);
}

const failures = [];
let slack = 0;
for (const [file, n] of counts) {
  const max = allow.get(file)?.max ?? 0;
  if (n > max) failures.push(`${file}: ${n} em dash(es), allowed ${max}`);
  else slack += max - n;
}
for (const [file, { max }] of allow) if (!counts.has(file)) slack += max;

console.log(`check-em-dashes: ${total} em dash(es) in reader-visible strings across ${counts.size} file(s) under ${ROOTS.join(', ')}.`);
if (slack) console.log(`  ${slack} allowance(s) are now unused; run with --tighten to lock the progress in.`);

if (failures.length) {
  console.error(`\nNew em dash in reader-facing copy (#6215):\n  ${failures.join('\n  ')}`);
  console.error('\nRewrite the sentence (comma, colon, period, parentheses, or two sentences).');
  console.error('Run with --list to see each line. For an empty table cell use an en dash (–).');
  console.error(`A justified case goes in ${ALLOWLIST} with a reason.`);
  process.exit(1);
}
