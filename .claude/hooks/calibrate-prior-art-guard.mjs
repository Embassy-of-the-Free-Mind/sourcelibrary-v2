#!/usr/bin/env node
/**
 * PRIOR ART: .claude/hooks/test-prior-art-guard.sh asserts correctness on 10
 * hand-built cases. This measures the FIRING RATE across the whole repo and
 * sweeps the threshold, which pass/fail tests cannot tell you.
 *
 * A guard that would have blocked a third of the repo gets disabled in a week,
 * so the threshold is chosen from this curve rather than from intuition. The
 * constraint is two-sided: the rate must be livable AND the real 2026-09-02
 * duplications must still fire.
 *
 * SANITY HISTORY — two ways this script lied before it worked:
 *   1. It replayed real paths, which the guard skips as existing files, and
 *      reported a reassuring 0%. A probe needs a positive control.
 *   2. It pointed at the hook in the main checkout, which does not exist in a
 *      worktree, so every spawn failed and `else allowed++` counted the failures
 *      as passes. Absence of a block is not evidence of a pass.
 *
 *   node .claude/hooks/calibrate-prior-art-guard.mjs [--list]
 */
import fs from 'fs';
import path from 'path';
import { scoreCandidates, tokenize } from './prior-art-guard.mjs';

const REPO = '/Users/dereklomas/sourcelibrary';
const SKIP = new Set(['node_modules', '.git', 'results', 'observations', 'dataset', 'transcripts',
  '_archived', 'archive', 'worktrees', 'fixtures', 'ground-truth', 'prompts', 'reference-works',
  'data', 'output', '.next', 'coverage']);

function walk(dir, out, depth = 0) {
  if (depth > 4) return;
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full, out, depth + 1); }
    else if (/\.(mjs|ts|tsx|js|md|py)$/.test(e.name) && !/^_tmp/i.test(e.name)) out.push(full);
  }
}

const corpus = [];
for (const r of ['scripts', 'src/lib', '.claude/docs', '.claude/skills']) walk(path.join(REPO, r), corpus);

/** The real duplications from 2026-09-02. These MUST fire at whatever threshold ships. */
const TRUE_POSITIVES = [
  { file: 'scripts/eval/prompt-ab.mjs', content: 'Paired repeated-measures A/B for OCR prompt versions, two arms over the same pages.' },
  { file: 'scripts/eval/lib/paired-stats.mjs', content: 'Paired statistics: exact sign test, Wilcoxon signed-rank, bootstrap confidence interval on paired deltas.' },
];

function scoreOne(relPath, content) {
  const nameTokens = new Set(tokenize(path.basename(relPath)));
  const newTokens = new Set([...nameTokens, ...tokenize(content.split('\n').slice(0, 25).join(' '))]);
  if (newTokens.size < 2) return [];
  return scoreCandidates({ normalised: relPath, nameTokens, newTokens, files: corpus });
}

const t0 = Date.now();
const rows = [];
for (const f of corpus) {
  let content = '';
  try { content = fs.readFileSync(f, 'utf8').split('\n').slice(0, 25).join('\n'); } catch { continue; }
  content = content.replace(/PRIOR[ -]ART\s*:/gi, 'formerly:');
  const rel = path.relative(REPO, f);
  rows.push({ rel, top: scoreOne(rel, content)[0]?.score ?? 0 });
}
const ms = Date.now() - t0;

console.log(`corpus: ${corpus.length} files   scoring: ${(ms / corpus.length).toFixed(0)} ms/file\n`);
console.log('threshold  would-block   rate    true-positives');
for (const th of [0.6, 0.7, 0.8, 0.9, 1.0]) {
  const blocked = rows.filter((r) => r.top >= th).length;
  const tp = TRUE_POSITIVES.filter((t) => (scoreOne(t.file, t.content)[0]?.score ?? 0) >= th).length;
  console.log(`   ${th.toFixed(2)}    ${String(blocked).padStart(6)}     ${(100 * blocked / rows.length).toFixed(1).padStart(5)}%   ${tp}/${TRUE_POSITIVES.length}`);
}
if (process.argv.includes('--list')) {
  console.log('\nhighest scorers:');
  for (const r of rows.filter((x) => x.top >= 0.9).sort((a, b) => b.top - a.top).slice(0, 20)) {
    console.log(`  ${r.top.toFixed(2)}  ${r.rel}`);
  }
}
