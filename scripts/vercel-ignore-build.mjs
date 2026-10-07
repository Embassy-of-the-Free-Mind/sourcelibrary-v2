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

/**
 * Previews are opt-in (Derek, 2026-10-06: "minimize vercel costs everywhere"; #5976). The project
 * builds one deployment at a time and production goes first, so ~20 previews per 3 h, mostly from
 * headless job branches nobody opens, queued for an hour and held up hand merges. A preview builds
 * only when the commit message contains [preview] or the branch starts with preview/. Since #5976's
 * follow-up, vercel.json `git.deploymentEnabled` stops every branch except main and preview/** from
 * creating a deployment at all (a skip here still waited in the one-slot queue), so in practice a
 * preview means pushing to preview/<name>; this check stays as the second line. To check a page
 * without one, run `next dev --webpack` locally (Turbopack rejects the worktree's symlinked
 * node_modules).
 */
export function previewWanted({ ref = '', message = '' } = {}) {
  return /\[preview\]/i.test(message) || ref.startsWith('preview/');
}

/** Build inputs changed between the merge base of `base` and HEAD (next-build.yml). */
export function changedBuildInputs(base, repo = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const from = git('merge-base', base, 'HEAD');
  return git('diff', '--name-only', from, 'HEAD', '--', ...buildInputs(repo)).split('\n').filter(Boolean);
}

function main() {
  // `--changed-since <sha>`: the PR build check asks the same question for a whole PR.
  // Prints the changed inputs and `build=yes|no`; always exits 0.
  const since = process.argv.indexOf('--changed-since');
  if (since > 0) {
    const changed = changedBuildInputs(process.argv[since + 1]);
    console.log(changed.length ? `Build inputs changed:\n${changed.join('\n')}` : 'No build inputs changed');
    console.log(`build=${changed.length ? 'yes' : 'no'}`);
    return;
  }
  // Only git-triggered previews: a CLI `vercel` deploy has no VERCEL_GIT_COMMIT_REF and is always wanted.
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF && !previewWanted({
    ref: process.env.VERCEL_GIT_COMMIT_REF, message: process.env.VERCEL_GIT_COMMIT_MESSAGE,
  })) {
    console.log('Skip: previews are opt-in — add [preview] to the commit message or push a preview/ branch (#5976)');
    process.exit(0);
  }
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
