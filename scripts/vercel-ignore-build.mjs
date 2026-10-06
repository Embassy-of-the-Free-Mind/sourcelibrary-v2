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
// buildInputs() is exported so scripts/audit/vercel-prod-watch.mjs judges "did this commit
// touch build inputs?" with exactly the list Vercel uses.
//
// PRIOR ART: the inline ignoreCommand in vercel.json — it listed fixed paths and could not
// see src/ → scripts/ imports; this script keeps its semantics and adds that closure.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASE_INPUTS = ['src/', 'public/', 'next.config.ts', 'vercel.json', 'package.json', 'package-lock.json'];

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
const CODE_RE = /\.(m?[jt]sx?)$/;

/** Every path whose change should trigger a build: BASE_INPUTS + the scripts/ files src/ imports. */
export function buildInputs(repo = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const read = (f) => readFileSync(path.join(repo, f), 'utf8');
  const seen = new Set();
  const queue = [];
  const add = (fromFile, spec) => {
    if (!spec.startsWith('.')) return;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    if (!target.startsWith('scripts/') || seen.has(target)) return;
    seen.add(target);
    queue.push(target);
  };
  for (const f of git('ls-files', 'src').split('\n').filter((f) => CODE_RE.test(f))) {
    for (const m of read(f).matchAll(IMPORT_RE)) add(f, m[1]);
  }
  // Follow relative imports inside the scripts/ files themselves.
  while (queue.length) {
    const f = queue.shift();
    if (!CODE_RE.test(f) || !existsSync(path.join(repo, f))) continue;
    for (const m of read(f).matchAll(IMPORT_RE)) add(f, m[1]);
  }
  return [...BASE_INPUTS, ...[...seen].sort()];
}

function main() {
  const prev = process.env.VERCEL_GIT_PREVIOUS_SHA || 'HEAD^';
  try {
    execFileSync('git', ['cat-file', '-e', `${prev}^{commit}`]);
  } catch {
    process.exit(1); // previous commit unknown (shallow clone, first deploy): build
  }
  const paths = buildInputs();
  try {
    execFileSync('git', ['diff', '--quiet', prev, 'HEAD', '--', ...paths]);
  } catch {
    console.log('Build: changes under', paths.length, 'watched paths');
    process.exit(1);
  }
  console.log('Skip: no change to src/, config, deps, or the', paths.length - BASE_INPUTS.length, 'scripts/ files src/ imports');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
