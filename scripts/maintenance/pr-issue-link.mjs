#!/usr/bin/env node
/**
 * Fail a PR that names an open issue in its title without saying, in its body,
 * whether it closes that issue or is only part of it.
 *
 * PRIOR ART: none — searched `ls scripts/maintenance scripts/audit`, `git grep
 * -l "Closes #" scripts/ .github/`, `gh issue list --search "closing keyword"`.
 * pr-tier.mjs classifies risk and pr-needs-rebase.mjs reports conflicts; neither
 * reads the title's issue reference.
 *
 * WHY (#6284, measured 2026-10-08): PR titles here name their issue as `(#N)`,
 * which GitHub does not treat as a closing reference. 290 of 776 open issues had
 * a merged PR titled for them; 69 were fully done and still open.
 *
 * Rules:
 *   - For each `#N` in the title that is an OPEN ISSUE, the body must contain
 *     either a closing keyword (`Closes #N`, `Fixes #N`, `Resolves #N`, any
 *     tense) or `Part of #N`.
 *   - Numbers that are PRs or closed issues are ignored. Bot PRs are skipped.
 *   - Exit 1 lists the missing declarations; exit 0 otherwise.
 *
 * Usage:
 *   node scripts/maintenance/pr-issue-link.mjs --pr 6284
 * Needs `gh` authenticated.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLOSING = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';

/** Issue numbers written as `#N` in a PR title, in order, without repeats. */
export function titleRefs(title) {
  return [...new Set([...String(title || '').matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])))];
}

/** 'closes' | 'part' | null — what the body declares about issue `n`. */
export function declared(body, n) {
  const text = String(body || '');
  // A keyword may govern a list: "Closes #1, #2 and #3".
  const list = `((?:\\s*(?:,|and|&)?\\s*#\\d+)+)`;
  const has = (prefix) => [...text.matchAll(new RegExp(`\\b${prefix}:?${list}`, 'gi'))]
    .some((m) => [...m[1].matchAll(/#(\d+)/g)].some((r) => Number(r[1]) === n));
  if (has(CLOSING)) return 'closes';
  if (has('part\\s+of')) return 'part';
  return null;
}

/** Open issues named in the title that the body neither closes nor marks as partial. */
export function missingDeclarations(title, body, openIssues) {
  const open = new Set(openIssues);
  return titleRefs(title).filter((n) => open.has(n) && !declared(body, n));
}

function main() {
  const argv = process.argv.slice(2);
  const pr = argv[argv.indexOf('--pr') + 1];
  if (!argv.includes('--pr') || !/^\d+$/.test(pr || '')) {
    console.error('usage: pr-issue-link.mjs --pr <number>');
    process.exit(2);
  }
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const { title, body, author } = JSON.parse(gh(['pr', 'view', pr, '--json', 'title,body,author']));
  if (author?.is_bot || /\[bot\]$/.test(author?.login || '')) {
    console.log(`PR #${pr} is from a bot (${author.login}); skipped.`);
    return;
  }
  const open = titleRefs(title).filter((n) => {
    try {
      const i = JSON.parse(gh(['api', `repos/{owner}/{repo}/issues/${n}`]));
      return !i.pull_request && i.state === 'open';
    } catch {
      return false; // not an issue in this repo
    }
  });
  const missing = missingDeclarations(title, body, open);
  if (!missing.length) {
    console.log(open.length
      ? `PR #${pr}: ${open.map((n) => `#${n} (${declared(body, n)})`).join(', ')} declared.`
      : `PR #${pr}: the title names no open issue.`);
    return;
  }
  console.error(`PR #${pr} names ${missing.map((n) => `#${n}`).join(', ')} in its title but the description does not say whether it finishes the issue.`);
  console.error('Add one line per issue to the PR description, then this check re-runs:');
  for (const n of missing) console.error(`  Closes #${n}      (this PR finishes it)   or   Part of #${n}   (work remains)`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
