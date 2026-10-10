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

const ignoreRes = (RULES.diffIgnoreGlobs || []).map(globToRe);
// A line that is only a comment: `//`, `*` / `/*` (block comment body), `#` (shell, yaml), `<!--`.
const COMMENT_LINE = /^\s*(\/\/|\/?\*|#(\s|!|$)|<!--)/;

/**
 * The added lines a diffPattern may fire on: lines that can EXECUTE. Measured
 * 2026-10-08 on 13 PRs held for "data deletion or migration in the diff":
 * several fired only on a comment (`* 3. $unset the stale fields`) or on prose
 * and result files (an eval write-up quoting a script name). A comment and a
 * markdown file delete nothing. Real `$unset` / `deleteMany` code still holds,
 * including in a script that "already ran": merging cannot know that.
 */
export function scannableAddedLines(diff) {
  const out = [];
  let file = '';
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    if (ignoreRes.some((re) => re.test(file))) continue;
    const line = l.slice(1);
    if (RULES.diffIgnoreCommentLines && COMMENT_LINE.test(line)) continue;
    out.push(line);
  }
  return out;
}

function dependabotMajor(title) {
  // "Bump stripe from 20.4.1 to 22.6.2" / grouped "Bump the security group ... with 2 updates"
  const m = title.match(/from (\d+)\.[\d.]+ to (\d+)\./);
  if (m) return m[1] !== m[2];
  return /with \d+ updates/.test(title) ? 'group' : false;
}

/**
 * A grouped dependabot PR hides its members, so read them from the diff: every
 * `"name": "^1.2.3"` line removed and re-added under the same name is one bump.
 * A bump is breaking when the major changes, or the minor changes on a 0.x
 * package (semver gives 0.x no compatibility promise). Returns the breaking
 * bumps and how many pairs were read; zero pairs means the diff could not be
 * read this way and the caller keeps the hold.
 */
export function groupedBumps(diff) {
  const VERSION_LINE = /^\s*"([^"]+)":\s*"[\^~]?(\d+)\.(\d+)\.[^"]*",?\s*$/;
  const removed = new Map();
  const bumps = [];
  let inManifest = false;
  for (const l of diff.split('\n')) {
    // Only package.json states what was asked for. A lockfile repeats `"version": "…"`
    // under every package, which pairs unrelated packages with each other.
    if (l.startsWith('+++ ')) { inManifest = /(^|\/)package\.json$/.test(l.slice(4).replace(/^b\//, '')); removed.clear(); continue; }
    if (l.startsWith('---') || !inManifest) continue;
    const m = l.slice(1).match(VERSION_LINE);
    if (!m) continue;
    if (l.startsWith('-')) removed.set(m[1], [m[2], m[3]]);
    else if (l.startsWith('+') && removed.has(m[1])) {
      const [maj, min] = removed.get(m[1]);
      removed.delete(m[1]);
      bumps.push({ name: m[1], from: `${maj}.${min}`, to: `${m[2]}.${m[3]}`, breaking: maj !== m[2] || (maj === '0' && min !== m[3]) });
    }
  }
  return { pairs: bumps.length, breaking: bumps.filter((b) => b.breaking) };
}

// The first line of a failed command's stderr, e.g. `HTTP 406: Sorry, the diff exceeded the maximum number of files (300)`.
const errLine = (e) => (String(e?.stderr || '').split('\n').find((l) => l.trim()) || e?.message || String(e)).trim().slice(0, 200);

/**
 * `run` is injectable so a test can stand in for `gh`. A diff GitHub will not
 * serve (#6324: HTTP 406 `too_large` past 300 files or 20K lines) used to throw
 * out of `--all` partway through the list. A diff we cannot read is a diff
 * nobody checked, so it HOLDs with the reason instead.
 */
export function classifyPR(number, run = sh) {
  const pr = JSON.parse(run(`gh pr view ${number} --json number,title,author,isDraft,labels,files,url,comments`));
  const paths = (pr.files || []).map((f) => f.path);
  let diff = '';
  let diffError = null;
  try { diff = run(`gh pr diff ${number}`); } catch (e) { diffError = errLine(e); }
  const result = classifyPaths(paths, scannableAddedLines(diff));
  if (diffError) result.reasons.push({ reason: `diff could not be read, so its lines were not checked — ${diffError}`, paths: [], lines: [] });
  const author = pr.author?.login || '';
  const isBot = /dependabot/.test(author);
  if (!RULES.autoMergeAuthors.some((a) => a === author || a.replace('app/', '') === author)) {
    result.reasons.push({ reason: `author ${author} is not on the auto-merge list`, paths: [], lines: [] });
  }
  if (isBot && RULES.dependabotMajorHolds) {
    const maj = dependabotMajor(pr.title);
    if (maj === true) result.reasons.push({ reason: 'dependabot MAJOR version bump', paths: [], lines: [] });
    if (maj === 'group') {
      // A grouped PR hides its members in the body, so the bumps are read from the diff.
      // It holds when one of them is breaking, or when no bump could be read at all.
      const { pairs, breaking } = groupedBumps(diff);
      if (breaking.length) {
        result.reasons.push({ reason: `dependabot grouped bump with ${breaking.length} breaking jump${breaking.length === 1 ? '' : 's'} (of ${pairs} read)`, paths: [], lines: breaking.slice(0, 6).map((b) => `${b.name} ${b.from} → ${b.to}`) });
      } else if (!pairs) {
        const jumps = addedLinesOf(diff).filter((l) => /"[^"]+": "\^?\d+\./.test(l));
        result.reasons.push({ reason: `dependabot grouped bump — ${jumps.length} version lines, none readable as a from/to pair; verify no major jump by eye`, paths: [], lines: jumps.slice(0, 4).map((l) => l.trim()) });
      }
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
    let c;
    try { c = classifyPR(n); } catch (e) {
      // `gh pr view` itself failed: nothing to label, but `--all` carries on.
      // A single `--pr` (pr-tier.yml) still exits 1, so the check goes red rather than passing unlabelled.
      console.log(`#${n} HOLD  (could not classify)\n   - ${errLine(e)}`);
      if (numbers.length === 1) process.exit(1);
      anyHold = true;
      continue;
    }
    print(c);
    if (has('--label')) {
      try { applyLabel(c); } catch (e) { console.log(`   label NOT applied — ${errLine(e)}`); }
    }
    if (c.result.tier === 'HOLD') anyHold = true;
  }
  process.exit(numbers.length === 1 && anyHold ? 3 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
