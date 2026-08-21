#!/usr/bin/env node
/**
 * Triage the open-PR backlog.
 *
 * PRs accumulate for the same structural reason worktrees do: the session that
 * opens one ends before it merges, and nothing is left around to finish the job.
 * `reap-worktrees.mjs` solved that for checkouts. This is the sibling for PRs.
 *
 * On 2026-07-28 the backlog was 33 open PRs against a healthy 300-merged-in-30-days
 * throughput — not a jam, a *tail*. The tail included a security dependency bump
 * (#2946: next / axios / nodemailer) that had been mergeable-clean and unreviewed
 * for 25 days while `npm audit` reported 3 criticals in production dependencies.
 * Nobody was ignoring it; it had simply fallen out of every session's context.
 *
 * Design, following the worktree reaper's lesson (a noisy safety check doesn't
 * fail closed — it trains people to bypass it):
 *
 *   - JUDGE EACH PR ON ITS OWN FACTS, never on a global "too many PRs" heuristic.
 *     Every classification below is a question with an exact answer for that one
 *     PR, so the report is trustworthy even while other sessions push branches.
 *   - REPORT ONLY. This script never merges, closes, or pushes anything. Merging
 *     is a judgment call with production consequences (see MERGE_READY caveats),
 *     and an auto-merger would be exactly the kind of tool people learn to
 *     distrust. It tells you what is safe to look at; you decide.
 *   - SUPERSEDED IS MEASURED, NOT GUESSED. A PR whose files are already identical
 *     on main is reported as such — that shape is common here, because work often
 *     gets copied into the main checkout and pushed separately from its branch.
 *
 * Classifications:
 *   MERGE_READY  mergeable, checks green, not a draft — the pile to review first
 *   SUPERSEDED   every changed file already matches main; likely close, not merge
 *   NEEDS_WORK   a blocking review or a `blocked` label — do not merge yet
 *   CONFLICTING  needs a rebase before anything else can happen
 *   CHECKS_RED   a required check is failing (note: Vercel's FIRST result is
 *                unreliable here — see CLAUDE.md; this reads `test` and `DCO`)
 *   DRAFT        author has not marked it ready
 *
 * Usage:
 *   node scripts/maintenance/reap-prs.mjs                # full report
 *   node scripts/maintenance/reap-prs.mjs --stale 14     # only PRs older than N days (default 7)
 *   node scripts/maintenance/reap-prs.mjs --json         # machine-readable
 *   node scripts/maintenance/reap-prs.mjs --no-supersede # skip the (slower) file-identity check
 */
import { execSync } from 'child_process';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const JSON_OUT = has('--json');
const CHECK_SUPERSEDE = !has('--no-supersede');
const STALE_DAYS = parseInt(val('--stale', '7'), 10);

const sh = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }); }
  catch (e) { return e.stdout || ''; }
};

// Checks that actually gate a merge. Vercel is deliberately excluded: its first
// result is frequently a spurious FAILURE that an automatic retry flips to pass
// (the deployment is often still Building when GitHub reports it), so treating
// it as blocking would misclassify healthy PRs. See CLAUDE.md, PR Conventions.
const GATING_CHECKS = new Set(['test', 'DCO']);

function loadPRs() {
  const raw = sh('gh pr list --state open --limit 200 --json number,title,createdAt,updatedAt,isDraft,mergeable,mergeStateStatus,headRefName,author,labels,statusCheckRollup,reviewDecision');
  if (!raw.trim()) {
    console.error('Could not read PRs from gh. Is the GitHub CLI authenticated (`gh auth status`)?');
    process.exit(1);
  }
  return JSON.parse(raw);
}

/**
 * `gh pr list` reports mergeable=UNKNOWN whenever GitHub hasn't computed the
 * merge commit yet — which is *guaranteed* right after anything lands on main,
 * since every open PR's mergeability is invalidated at once. Reading the list
 * alone would then classify the entire backlog as UNKNOWN, i.e. exactly when a
 * triage tool is most likely to be run, it would be useless.
 *
 * Requesting a single PR forces the computation, so re-ask per PR and give
 * GitHub a moment to finish. Returns the last answer even if still UNKNOWN
 * rather than blocking forever.
 */
function resolveMergeable(pr, { attempts = 3, waitMs = 1500 } = {}) {
  if (pr.mergeable !== 'UNKNOWN') return pr;
  for (let i = 0; i < attempts; i++) {
    const raw = sh(`gh pr view ${pr.number} --json mergeable,mergeStateStatus`);
    if (raw.trim()) {
      const fresh = JSON.parse(raw);
      if (fresh.mergeable && fresh.mergeable !== 'UNKNOWN') {
        return { ...pr, mergeable: fresh.mergeable, mergeStateStatus: fresh.mergeStateStatus };
      }
    }
    if (i < attempts - 1) execSync(`sleep ${waitMs / 1000}`);
  }
  return pr;
}

function gatingFailures(pr) {
  return (pr.statusCheckRollup || [])
    .filter((c) => GATING_CHECKS.has(c.name))
    .filter((c) => (c.conclusion || c.status) === 'FAILURE');
}

/**
 * Is every file this PR touches already byte-identical on main?
 *
 * This is the "work was copied into the main checkout and pushed separately"
 * shape. Measured, never inferred from the description: we diff each changed
 * file's blob on the branch against main's. A PR that only DELETES files, or
 * whose branch is empty, is not called superseded (nothing was compared).
 */
function isSuperseded(pr) {
  const files = sh(`git diff --name-only origin/main...origin/${pr.headRefName}`).trim().split('\n').filter(Boolean);
  if (!files.length) return false;
  for (const f of files) {
    const onBranch = sh(`git show origin/${pr.headRefName}:"${f}" 2>/dev/null`);
    const onMain = sh(`git show origin/main:"${f}" 2>/dev/null`);
    if (onBranch !== onMain) return false;
  }
  return true;
}

function classify(pr, superseded) {
  if (pr.isDraft) return 'DRAFT';
  if (pr.mergeable === 'CONFLICTING') return 'CONFLICTING';
  if (gatingFailures(pr).length) return 'CHECKS_RED';
  if (superseded) return 'SUPERSEDED';
  // Someone has already said "not yet". Mechanically mergeable, but listing it
  // beside genuinely untouched PRs is how a review gets merged straight past —
  // #2956 was mergeable-and-green with an unaddressed security finding on it.
  //
  // Two signals, because in practice only the second one is available here:
  // GitHub REFUSES `--request-changes` on your own PR, and nearly every PR in
  // this repo is self-authored, so `reviewDecision` is almost always null even
  // when a blocking review exists. The `blocked` label is the signal that
  // actually survives. If you review a PR and find a problem, label it.
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'NEEDS_WORK';
  if ((pr.labels || []).some((l) => l.name === 'blocked')) return 'NEEDS_WORK';
  if (pr.mergeable === 'MERGEABLE') return 'MERGE_READY';
  return 'UNKNOWN';
}

const ageDays = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

function main() {
  sh('git fetch origin --quiet');
  const prs = loadPRs();
  const stale = prs.filter((p) => ageDays(p.createdAt) >= STALE_DAYS);

  const rows = stale.map((raw) => {
    const pr = resolveMergeable(raw);
    const superseded = CHECK_SUPERSEDE ? isSuperseded(pr) : false;
    return {
      number: pr.number,
      title: pr.title,
      author: pr.author?.login || '?',
      branch: pr.headRefName,
      ageDays: ageDays(pr.createdAt),
      idleDays: ageDays(pr.updatedAt),
      state: classify(pr, superseded),
      failing: gatingFailures(pr).map((c) => c.name),
      labels: (pr.labels || []).map((l) => l.name),
    };
  });

  const ORDER = ['MERGE_READY', 'SUPERSEDED', 'NEEDS_WORK', 'CONFLICTING', 'CHECKS_RED', 'DRAFT', 'UNKNOWN'];
  rows.sort((a, b) => (ORDER.indexOf(a.state) - ORDER.indexOf(b.state)) || (b.ageDays - a.ageDays));

  if (JSON_OUT) {
    console.log(JSON.stringify({ totalOpen: prs.length, staleThresholdDays: STALE_DAYS, rows }, null, 2));
    return;
  }

  const counts = ORDER.map((s) => [s, rows.filter((r) => r.state === s).length]).filter(([, n]) => n);
  console.log(`\nopen PRs: ${prs.length}  |  older than ${STALE_DAYS}d: ${rows.length}`);
  console.log(counts.map(([s, n]) => `${s.toLowerCase()}: ${n}`).join('  |  ') || 'nothing stale');

  for (const state of ORDER) {
    const group = rows.filter((r) => r.state === state);
    if (!group.length) continue;
    console.log(`\n${state}`);
    for (const r of group) {
      const flags = [
        `${r.ageDays}d old`,
        r.idleDays !== r.ageDays ? `${r.idleDays}d idle` : null,
        r.failing.length ? `failing: ${r.failing.join(',')}` : null,
        r.labels.includes('security') ? 'SECURITY' : null,
      ].filter(Boolean).join(', ');
      console.log(`  #${r.number}  ${r.title.slice(0, 62)}`);
      console.log(`      ${flags}  [${r.branch}]`);
    }
  }

  if (rows.some((r) => r.state === 'MERGE_READY')) {
    console.log(`\nMERGE_READY means mergeable + gating checks green — it does NOT mean reviewed.`);
    console.log(`Read the diff before merging: a stale PR has had main move under it, and`);
    console.log(`green checks say nothing about whether the code is still correct or safe.`);
  }
  console.log();
}

main();
