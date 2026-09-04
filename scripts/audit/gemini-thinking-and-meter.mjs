#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/spend-reconcile.mjs — reconciles metered vs billed totals
 * after the fact; it cannot say WHICH call site under-reports, and it needs a bill to
 * run. This is the static counterpart: it fails on the two code shapes that produce the
 * gap, before any money is spent. Also checked: scripts/audit/r2-key-book-scope.mjs
 * (same "standing detector for a known-recurring bug" pattern, different subsystem).
 *
 * gemini-thinking-and-meter — guard the two halves of #4581.
 *
 * The defect recurs because it is INVISIBLE: nothing errors, nothing looks wrong, the
 * pages come out fine. It has now shipped three times — `src/lib/ai.ts` (Dec 2025 →
 * fixed #4591), and the whole Hetzner `.mjs` worker stack (fixed alongside this file).
 * August metered $499.74 against $8,389.32 billed.
 *
 * Two checks, matching the two halves:
 *
 *   1. THINKING — every `getGenerativeModel({...})` must reach an explicit
 *      `thinkingConfig`. Gemini 3.x thinks by default and bills reasoning at the
 *      output rate. Measured 2026-09-04: `gemini-3-flash-preview` emits ~1.5 thought
 *      tokens per visible output token with no config; `gemini-3.1-flash-lite` emits
 *      none on realistic prompts — so the exposure depends on which model a call
 *      happens to route to, which is exactly why it must be explicit.
 *
 *   2. METER — anywhere `candidatesTokenCount` is summed into an output-token figure,
 *      `thoughtsTokenCount` must be summed too (in practice: call `outputTokensFrom`).
 *      Google bills both.
 *
 * A deliberate exception (grounded search needs a POSITIVE budget — flash-lite does not
 * ground at all, and `-1` silently suppresses grounding) is declared with a waiver
 * comment on the line above:  // thinking-ok: <reason>
 *
 * Usage: node scripts/audit/gemini-thinking-and-meter.mjs
 * Exit 0 = clean, 1 = findings. Cheap and offline — safe in CI or a pre-push hook.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['scripts/workers', 'scripts/lib', 'scripts/batch', 'src/lib'];
const EXTS = ['.mjs', '.ts', '.js'];
const WAIVER = /\/\/\s*thinking-ok:/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (e === 'node_modules' || e === '_archived' || e.startsWith('.')) continue;
      walk(p, out);
    } else if (EXTS.some((x) => e.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

/** Extract the balanced `{...}` object literal that starts at `open`. */
function objectAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open); // unbalanced — treat as the rest of the file
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
// Look back a few lines, not one: the waiver is as likely to sit above the enclosing
// function as above the call itself, and a one-line window silently ignores it — the
// failure mode being that a DECLARED exception reads as an undeclared one.
const priorLines = (src, idx, n = 4) => {
  const lines = src.slice(0, idx).split('\n');
  return lines.slice(Math.max(0, lines.length - 1 - n), lines.length - 1).join('\n');
};

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

// ── Baseline ──
// The same defect exists at call sites outside this fix's scope (`src/lib/*` TS paths
// and the `scripts/batch/*` one-shots) — inventoried under #4599, whose sweep is a
// separate decision because turning thinking off changes OUTPUT on the creative paths
// (tweet copy, email digests), not just cost. They are recorded here so this guard can
// go green and start failing on NEW violations today, which is the whole point of a
// standing detector; a guard that has always been red teaches nothing.
//
// Removing a line from the baseline as you fix it is the intended workflow. Do NOT add
// to it: `// thinking-ok: <reason>` at the call site is how a DELIBERATE exception is
// declared, and it says why. --update-baseline rewrites the file from current findings.
const BASELINE_PATH = join(ROOT, 'scripts/audit/gemini-thinking-and-meter.baseline.txt');
const baseline = new Set(
  existsSync(BASELINE_PATH)
    ? readFileSync(BASELINE_PATH, 'utf8').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
    : [],
);

// Resolve `generationConfig: SOME_CONST` — the config may be hoisted into a shared
// constant in another file (SUMMARY_GEN_CONFIG was, and a fixed-width window would
// have missed it: a guard's coverage must not track code style).
const constDefs = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*\{/g)) {
    constDefs.set(m[1], objectAt(src, src.indexOf('{', m.index)));
  }
}

const findings = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f);

  // ── 1. thinking ──
  for (const m of src.matchAll(/getGenerativeModel\s*\(\s*\{/g)) {
    const open = src.indexOf('{', m.index + 'getGenerativeModel('.length - 1);
    const obj = objectAt(src, open);
    if (WAIVER.test(priorLines(src, m.index))) continue;
    // Embedding models have no reasoning stage — `getGenerativeModel` is merely how the
    // SDK hands back an embedding handle. Not a thinking site.
    if (/embedding/i.test(obj)) continue;
    let hasThinking = /thinkingConfig/.test(obj);
    if (!hasThinking) {
      const ref = obj.match(/generationConfig\s*:\s*([A-Za-z_$][\w$]*)/);
      if (ref && constDefs.has(ref[1])) hasThinking = /thinkingConfig/.test(constDefs.get(ref[1]));
    }
    if (!hasThinking) {
      findings.push({ file: rel, line: lineOf(src, m.index), kind: 'thinking', detail: 'getGenerativeModel with no explicit thinkingConfig' });
    }
  }

  // ── 2. meter ──
  const srcLines = src.split('\n');
  for (const m of src.matchAll(/^.*candidatesTokenCount.*$/gm)) {
    const line = m[0];
    // The sum is frequently spread over two lines (`... || 0) +` then the thoughts term).
    // Judge the window, not the line — a line-scoped test would flag the FIXED shape in
    // src/lib/ai.ts, which is exactly the style-sensitivity this guard is meant to avoid.
    const ln = lineOf(src, m.index);
    const window = [line, srcLines[ln] || ''].join('\n');
    if (/thoughtsTokenCount|outputTokensFrom/.test(window)) continue;
    if (WAIVER.test(line)) continue;
    // Only flag lines that FEED a token/cost figure — a console.log or a comment is fine.
    if (!/(output|tokens|cost|usage)\s*[:+=]/i.test(line)) continue;
    findings.push({ file: rel, line: lineOf(src, m.index), kind: 'meter', detail: line.trim().slice(0, 100) });
  }
}

const key = (f) => `${f.file}:${f.kind}`;

if (process.argv.includes('--update-baseline')) {
  const lines = [
    '# Known #4581-class call sites outside the worker-stack fix. Tracked by #4599.',
    '# One `<path>:<kind>` per line. Delete a line when you fix that file; never add one',
    '# by hand — declare a deliberate exception with `// thinking-ok: <reason>` instead.',
    ...[...new Set(findings.map(key))].sort(),
  ];
  writeFileSync(BASELINE_PATH, lines.join('\n') + '\n');
  console.log(`Baseline written: ${new Set(findings.map(key)).size} entr(ies) from ${findings.length} finding(s).`);
  process.exit(0);
}

const fresh = findings.filter((f) => !baseline.has(key(f)));
const known = findings.length - fresh.length;

if (!fresh.length) {
  console.log(`✔ ${files.length} files scanned — no new findings.`);
  if (known) console.log(`  (${known} baselined finding(s) still open — see #4599 and the baseline file.)`);
  process.exit(0);
}

console.log(`✘ ${fresh.length} NEW finding(s) — see #4581.${known ? ` (${known} baselined, not shown.)` : ''}\n`);
findings.length = 0;
findings.push(...fresh);
for (const kind of ['thinking', 'meter']) {
  const rows = findings.filter((x) => x.kind === kind);
  if (!rows.length) continue;
  console.log(kind === 'thinking'
    ? 'THINKING — Gemini 3.x thinks by default and bills it at the output rate:'
    : 'METER — candidatesTokenCount excludes thoughtsTokenCount; Google bills both:');
  for (const r of rows) console.log(`  ${r.file}:${r.line}  ${r.detail}`);
  console.log('');
}
console.log('Fix: add `thinkingConfig: { thinkingBudget: 0 }`, or call `outputTokensFrom(usage)`');
console.log('from scripts/workers/lib/supabase-usage-logger.mjs. Deliberate exception:');
console.log('put `// thinking-ok: <reason>` on the line above.');
process.exit(1);
