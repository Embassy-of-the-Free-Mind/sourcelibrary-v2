#!/usr/bin/env node
// Vercel "Ignored Build Step" (vercel.json ignoreCommand).
// Exit 0 = skip the build, exit 1 = build.
//
// A build is needed when anything the app bundles changed: src/, public/, config, deps —
// AND any file under scripts/ that src/ imports (data JSON such as the canon-gap results,
// shared .mjs helpers), followed through their own relative imports. Before this, a
// scripts-only data refresh (#5889) was skipped and /research/canon-gap served
// 17-hour-old figures while main held the new ones.
//
// PRIOR ART: the inline ignoreCommand in vercel.json — it listed fixed paths and could not
// see src/ → scripts/ imports; this script keeps its semantics and adds that closure.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

const prev = process.env.VERCEL_GIT_PREVIOUS_SHA || 'HEAD^';
try {
  git('cat-file', '-e', `${prev}^{commit}`);
} catch {
  process.exit(1); // previous commit unknown (shallow clone, first deploy): build
}

const BASE = ['src/', 'public/', 'next.config.ts', 'vercel.json', 'package.json', 'package-lock.json'];

// Every module specifier in src/ that climbs into scripts/.
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
const files = git('ls-files', 'src').split('\n').filter((f) => /\.(m?[jt]sx?)$/.test(f));

const seen = new Set();
const queue = [];
function addSpecifier(fromFile, spec) {
  if (!spec.startsWith('.')) return;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  if (!target.startsWith('scripts/') || seen.has(target)) return;
  seen.add(target);
  queue.push(target);
}
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) addSpecifier(f, m[1]);
}
// Follow relative imports inside the scripts/ files themselves.
while (queue.length) {
  const f = queue.shift();
  if (!existsSync(f) || !/\.(m?[jt]sx?)$/.test(f)) continue;
  for (const m of readFileSync(f, 'utf8').matchAll(IMPORT_RE)) addSpecifier(f, m[1]);
}

const paths = [...BASE, ...seen];
try {
  git('diff', '--quiet', prev, 'HEAD', '--', ...paths);
} catch {
  console.log('Build: changes under', paths.length, 'watched paths');
  process.exit(1);
}
console.log('Skip: no change to src/, config, deps, or the', seen.size, 'scripts/ files src/ imports');
process.exit(0);
