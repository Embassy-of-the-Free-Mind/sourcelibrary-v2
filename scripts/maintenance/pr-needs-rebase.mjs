#!/usr/bin/env node
/**
 * Label every open PR that conflicts with main `needs-rebase`, and tell it which
 * files collided and which merges did it. Remove the label when it merges clean.
 *
 * PRIOR ART: scripts/maintenance/reap-prs.mjs — triages CONFLICTING on demand,
 * in whichever session happens to run it, days later. This runs on every push to
 * main so the PR hears about the conflict within the hour, and leaves a durable
 * label reap-prs then reads instead of re-asking GraphQL.
 *
 * WHY (#5415, measured 2026-09-30): 12 of 22 open PRs were CONFLICTING, 7 of them
 * `tier:auto` opened that day. auto-merge.yml never merges a conflicting PR and
 * nothing said so — the PR sat until a stale sweep closed it (32 since August).
 * ~10 sessions branch from main and work for hours while main takes ~10 merges a
 * day; the second PR to land on a hot file conflicts every time.
 *
 * Rules:
 *   - CONFLICTING → add `needs-rebase`; if the label was absent, post ONE comment
 *     naming the overlapping files (PR's files ∩ files main changed since the
 *     merge-base) and the merges on main that changed them.
 *   - MERGEABLE  → remove `needs-rebase`.
 *   - UNKNOWN after retries → leave the PR as it is (never guess).
 *   - Never re-comment on a PR that already carries the label.
 *   - Informational only: the label changes no tier and blocks nothing.
 *
 * Usage:
 *   node scripts/maintenance/pr-needs-rebase.mjs            # dry run: print what would change
 *   node scripts/maintenance/pr-needs-rebase.mjs --apply    # label + comment
 *   node scripts/maintenance/pr-needs-rebase.mjs --pr 5269  # one PR
 * Needs `gh` authenticated and `origin/main` + the PR branches fetched (the
 * workflow does `git fetch origin`; locally run it first for accurate overlaps).
 */
import { execFileSync, execSync } from 'node:child_process';

const LABEL = 'needs-rebase';
const MARKER = '<!-- pr-needs-rebase -->';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = has('--apply');

const sh = (cmd, opts = {}) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts }); }
  catch (e) { return e.stdout || ''; }
};
const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); }
  catch { return ''; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GitHub computes `mergeable` lazily; a single-PR view forces it. Re-ask until it settles. */
async function mergeableOf(number, { attempts = 6, waitMs = 2500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const raw = sh(`gh pr view ${number} --json mergeable,labels,headRefName,files,isDraft,baseRefName`);
    if (raw.trim()) {
      const pr = JSON.parse(raw);
      if (pr.mergeable && pr.mergeable !== 'UNKNOWN') return pr;
    }
    if (i < attempts - 1) await sleep(waitMs);
  }
  return null;
}

/** Files this PR touches that main has also changed since they diverged, with the merges that did it. */
export function overlapFor(headRef, prFiles, base = 'origin/main') {
  const head = `origin/${headRef}`;
  const mergeBase = git('merge-base', base, head).trim();
  if (!mergeBase) return { mergeBase: null, files: [] };
  const mainChanged = new Set(git('diff', '--name-only', mergeBase, base).split('\n').filter(Boolean));
  const files = [];
  for (const f of prFiles) {
    if (!mainChanged.has(f)) continue;
    const log = git('log', '--format=%h %s', `${mergeBase}..${base}`, '--', f).split('\n').filter(Boolean);
    // Squash merges carry "(#NNNN)" in the subject; keep that, fall back to the short sha.
    const merges = [...new Set(log.map((l) => (l.match(/\(#(\d+)\)\s*$/) || [])[1] ? `#${l.match(/\(#(\d+)\)\s*$/)[1]}` : l.slice(0, 7)))];
    files.push({ file: f, merges });
  }
  return { mergeBase, files };
}

function commentBody(number, overlap) {
  const lines = [MARKER, `**needs-rebase** — this PR conflicts with \`main\` and \`auto-merge.yml\` will not merge it until it is rebased.`, ''];
  if (overlap.files.length) {
    lines.push('Files this PR changes that `main` has also changed since the branch point:');
    for (const { file, merges } of overlap.files.slice(0, 20)) {
      lines.push(`- \`${file}\`${merges.length ? ' — ' + merges.slice(0, 6).join(', ') : ''}`);
    }
    if (overlap.files.length > 20) lines.push(`- …and ${overlap.files.length - 20} more`);
  } else {
    lines.push('Could not compute the overlapping files (branch not fetched, or a fork); `git diff --name-only origin/main...HEAD` on the branch shows them.');
  }
  lines.push('', 'When resolving: `main` wins every line you did not set out to change, then re-read the whole hunk for facts that now disagree with their neighbours (#5415). The label is informational and comes off by itself once the PR merges clean.');
  return lines.join('\n');
}

function ensureLabel() {
  try { execSync(`gh label create "${LABEL}" --color FBCA04 --description "Conflicts with main; rebase before auto-merge or a human can merge it (pr-needs-rebase.yml)" --force`, { stdio: 'ignore' }); } catch { /* exists */ }
}

async function main() {
  const numbers = val('--pr')
    ? [parseInt(val('--pr'), 10)]
    : JSON.parse(sh('gh pr list --state open --limit 200 --json number')).map((p) => p.number);
  if (APPLY) ensureLabel();
  const report = { labelled: [], unlabelled: [], unknown: [], unchanged: 0 };
  for (const n of numbers) {
    const pr = await mergeableOf(n);
    if (!pr) { report.unknown.push(n); continue; }
    const labels = (pr.labels || []).map((l) => l.name);
    const hasLabel = labels.includes(LABEL);
    if (pr.mergeable === 'CONFLICTING') {
      if (hasLabel) { report.unchanged++; continue; }
      const overlap = overlapFor(pr.headRefName, (pr.files || []).map((f) => f.path));
      report.labelled.push({ number: n, files: overlap.files.map((f) => f.file) });
      console.log(`#${n} CONFLICTING → +${LABEL}  (${overlap.files.map((f) => f.file).join(', ') || 'overlap unknown'})`);
      if (APPLY) {
        sh(`gh pr edit ${n} --add-label "${LABEL}"`);
        sh(`gh pr comment ${n} --body-file -`, { input: commentBody(n, overlap) });
      }
    } else if (pr.mergeable === 'MERGEABLE') {
      if (!hasLabel) { report.unchanged++; continue; }
      report.unlabelled.push(n);
      console.log(`#${n} MERGEABLE → -${LABEL}`);
      if (APPLY) sh(`gh pr edit ${n} --remove-label "${LABEL}"`);
    } else {
      report.unknown.push(n);
    }
  }
  console.log(`\n${APPLY ? 'applied' : 'dry run'}: +${report.labelled.length} labelled, -${report.unlabelled.length} cleared, ${report.unchanged} unchanged, ${report.unknown.length} still UNKNOWN${report.unknown.length ? ' (' + report.unknown.map((n) => '#' + n).join(' ') + ')' : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('pr-needs-rebase.mjs')) main().catch((e) => { console.error(e.message); process.exit(1); });
