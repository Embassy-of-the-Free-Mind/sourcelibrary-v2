#!/usr/bin/env node
/**
 * PR risk tier — AUTO or HOLD — from the files and diff a PR touches.
 *
 * PRIOR ART: scripts/maintenance/reap-prs.mjs — classifies MERGEABILITY
 * (checks, conflicts, superseded), not RISK; it has no notion of what a human
 * must read. This script answers the other question: may a green PR merge on
 * its own? The two compose: reap-prs shows the tier label this script applies.
 *
 * WHY
 * Measured 2026-09-30: 300 PRs merged in 30 days, every one clicked by Derek,
 * 11 open. A gate that admits ten PRs a day is a delay, not a review. The hold
 * list Derek already uses for other repos (deletions/migrations, money,
 * auth/security, unseen public copy, irreversible) is here made mechanical:
 * a PR that touches none of it is `tier:auto` and auto-merge.yml merges it
 * when green; a PR that touches any of it is `tier:hold` and waits for him.
 * The rules live in pr-tier-rules.json so tuning is a JSON edit, not code.
 *
 * A HOLD is sticky in one direction only: a session may add `tier:hold`
 * (or `blocked`) by hand and this script will never downgrade it to auto —
 * the label expresses judgement the globs cannot. Re-running only ever
 * upgrades hold→auto when the label was applied BY THIS SCRIPT (marker
 * comment present) and the triggering paths are gone.
 *
 * USAGE
 *   node scripts/maintenance/pr-tier.mjs --pr 5273            # print tier + reasons
 *   node scripts/maintenance/pr-tier.mjs --pr 5273 --label    # also apply tier:auto / tier:hold + comment
 *   node scripts/maintenance/pr-tier.mjs --all [--label]      # every open PR
 *   node scripts/maintenance/pr-tier.mjs --paths a.ts b.md    # classify paths without a PR (tests)
 * Exit 0 = AUTO, 3 = HOLD, 1 = error. Needs `gh` authenticated.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = JSON.parse(readFileSync(join(HERE, 'pr-tier-rules.json'), 'utf8'));
const MARKER = '<!-- pr-tier -->';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });

// Minimal glob → regex: ** = any path segment(s), * = within a segment, everything else literal.
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}
const compiled = RULES.hold.map((r) => ({ ...r, res: (r.globs || []).map(globToRe), diffRes: (r.diffPatterns || []).map((p) => new RegExp(p)) }));

export function classifyPaths(paths, addedLines = []) {
  const reasons = [];
  for (const rule of compiled) {
    const hitPaths = paths.filter((p) => rule.res.some((re) => re.test(p)));
    const hitLines = rule.diffRes.length ? addedLines.filter((l) => rule.diffRes.some((re) => re.test(l))) : [];
    if (hitPaths.length || hitLines.length) {
      reasons.push({ reason: rule.reason, paths: hitPaths.slice(0, 8), lines: hitLines.slice(0, 4).map((l) => l.trim().slice(0, 120)) });
    }
  }
  return { tier: reasons.length ? 'HOLD' : 'AUTO', reasons };
}

function addedLinesOf(diff) {
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
}

function dependabotMajor(title) {
  // "Bump stripe from 20.4.1 to 22.6.2" / grouped "Bump the security group ... with 2 updates"
  const m = title.match(/from (\d+)\.[\d.]+ to (\d+)\./);
  if (m) return m[1] !== m[2];
  return /with \d+ updates/.test(title) ? 'group' : false;
}

function classifyPR(number) {
  const pr = JSON.parse(sh(`gh pr view ${number} --json number,title,author,isDraft,labels,files,url,comments`));
  const paths = (pr.files || []).map((f) => f.path);
  const diff = sh(`gh pr diff ${number}`);
  const result = classifyPaths(paths, addedLinesOf(diff));
  const author = pr.author?.login || '';
  const isBot = /dependabot/.test(author);
  if (!RULES.autoMergeAuthors.some((a) => a === author || a.replace('app/', '') === author)) {
    result.reasons.push({ reason: `author ${author} is not on the auto-merge list`, paths: [], lines: [] });
  }
  if (isBot && RULES.dependabotMajorHolds) {
    const maj = dependabotMajor(pr.title);
    if (maj === true) result.reasons.push({ reason: 'dependabot MAJOR version bump', paths: [], lines: [] });
    if (maj === 'group') {
      // A grouped PR hides its members in the body; count package.json version lines for a human to eyeball.
      const jumps = addedLinesOf(diff).filter((l) => /"[^"]+": "\^?\d+\./.test(l));
      result.reasons.push({ reason: `dependabot grouped bump — ${jumps.length} version lines; verify no major jump by eye`, paths: [], lines: jumps.slice(0, 4).map((l) => l.trim()) });
    }
  }
  const labels = (pr.labels || []).map((l) => l.name);
  const manualHold = labels.includes('blocked') || (labels.includes('tier:hold') && !(pr.comments || []).some((c) => (c.body || '').includes(MARKER)));
  if (manualHold) result.reasons.push({ reason: 'held by hand (blocked / tier:hold without a pr-tier comment) — never downgraded', paths: [], lines: [] });
  result.tier = result.reasons.length ? 'HOLD' : 'AUTO';
  return { pr, result, labels };
}

function ensureLabels() {
  for (const [name, color, desc] of [
    ['tier:auto', '0E8A16', 'Touches nothing on the hold list; auto-merge.yml merges it when green'],
    ['tier:hold', 'B60205', 'Touches the hold list (auth, money, deletions, public copy, doctrine); a human merges'],
  ]) {
    try { sh(`gh label create "${name}" --color ${color} --description "${desc}" --force`); } catch { /* exists */ }
  }
}

function applyLabel({ pr, result, labels }) {
  // hold → auto is NEVER automatic. On 2026-09-30 a hand-applied tier:hold on
  // #5294 (reader copy the path rules miss) was flipped back to auto by the
  // `labeled` re-run, because the PR already carried a pr-tier comment from its
  // first (AUTO) classification and so looked "script-applied". Lifting a hold
  // is a human act: remove tier:hold by hand, then re-run `--label`.
  if (result.tier === 'AUTO' && labels.includes('tier:hold')) {
    console.log(`   tier:hold kept — a hold is never lifted automatically (remove the label by hand to re-tier)`);
    return;
  }
  const want = result.tier === 'AUTO' ? 'tier:auto' : 'tier:hold';
  const args = [`--add-label "${want}"`];
  if (result.tier === 'HOLD' && labels.includes('tier:auto')) args.push('--remove-label "tier:auto"');
  sh(`gh pr edit ${pr.number} ${args.join(' ')}`);
  const already = (pr.comments || []).some((c) => (c.body || '').includes(MARKER) && (c.body || '').includes(`pr-tier: ${result.tier}`));
  if (!already) {
    const body = [
      MARKER,
      `**pr-tier: ${result.tier}**`,
      result.tier === 'AUTO'
        ? 'Touches nothing on the hold list. `auto-merge.yml` will squash-merge this PR once `test` and `DCO` are green and the entities-sweep interlock is clear. Add the `blocked` label to stop that.'
        : 'Waits for a human merge because it touches:',
      ...result.reasons.map((r) => `- ${r.reason}${r.paths.length ? ': ' + r.paths.map((p) => '`' + p + '`').join(', ') : ''}${r.lines.length ? '\n  ' + r.lines.map((l) => '`' + l + '`').join('\n  ') : ''}`),
      '',
      '_Rules: `scripts/maintenance/pr-tier-rules.json`._',
    ].join('\n');
    sh(`gh pr comment ${pr.number} --body-file -`, { input: body, stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

function print({ pr, result }) {
  console.log(`#${pr.number} ${result.tier}  ${pr.title.slice(0, 70)}`);
  for (const r of result.reasons) console.log(`   - ${r.reason}${r.paths.length ? ': ' + r.paths.join(', ') : ''}${r.lines.length ? '\n     ' + r.lines.join('\n     ') : ''}`);
}

function main() {
  if (has('--paths')) {
    const paths = argv.slice(argv.indexOf('--paths') + 1).filter((a) => !a.startsWith('--'));
    const r = classifyPaths(paths);
    console.log(r.tier); for (const x of r.reasons) console.log(` - ${x.reason}: ${x.paths.join(', ')}`);
    process.exit(r.tier === 'AUTO' ? 0 : 3);
  }
  const numbers = has('--all')
    ? JSON.parse(sh('gh pr list --state open --limit 200 --json number')).map((p) => p.number)
    : [parseInt(val('--pr'), 10)].filter(Boolean);
  if (!numbers.length) { console.error('usage: --pr N | --all | --paths ...'); process.exit(1); }
  if (has('--label')) ensureLabels();
  let anyHold = false;
  for (const n of numbers) {
    const c = classifyPR(n);
    print(c);
    if (has('--label')) applyLabel(c);
    if (c.result.tier === 'HOLD') anyHold = true;
  }
  process.exit(numbers.length === 1 && anyHold ? 3 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
