#!/usr/bin/env node
/**
 * Merge ONE green `tier:auto` PR, if it is safe to build right now.
 *
 * PRIOR ART: scripts/maintenance/reap-prs.mjs — a TRIAGE report for a human;
 * it deliberately refuses to merge ("MERGE_READY is a review queue, not a
 * merge list"). This is the merge step that the tier system makes safe: the
 * risk decision was already taken by pr-tier.mjs, so what is left is the
 * mechanics of merging without breaking a build. Called by auto-merge.yml.
 *
 * ADMISSION (every line must hold):
 *   - label `tier:auto`, no `blocked`, not a draft, mergeable
 *   - gating checks `test` and `DCO` both SUCCESS (Vercel is not gating —
 *     its first result is often a spurious failure, see reap-prs.mjs), and
 *     `next-build` not running or failed when the PR has it (next-build.yml),
 *     and `issue-link` likewise (pr-issue-link.yml, #6284)
 *   - last updated ≥ SETTLE_MIN minutes ago, so a session that opened the PR
 *     has time to run /review and add `blocked` before the merge lands
 *   - main's tip is ≥ BUILD_GAP_MIN minutes old: merges are serialised so
 *     each gets its own Vercel build (2026-09-25: the newest of two close
 *     merges got NO build while the older kept building)
 *   - the entities-sweep interlock is CLEAR (exit 0). A merge is a prod build,
 *     and a concurrent bulk `entities` writer fails the /explore prerender.
 *     Exit 2 (UNKNOWN) is not clear — see CLAUDE.md.
 *
 * Merges oldest-first, one per run, with --squash --delete-branch (the repo's
 * merge style). Prints what it did and why it skipped the rest.
 *
 * STALLS. A PR skipped for a reason only a push can fix (CI never ran, a failed
 * check, a conflict) and untouched for STALL_HOURS gets ONE comment saying why,
 * per head commit. The skip reasons used to live only in this job's log, so a
 * tier:auto PR could sit unmerged for a day with nobody told (#6188: `test`
 * never ran on its head). The comment reaches the PR's author and wakes any
 * session subscribed to the PR. Draft, `blocked` and `tier:hold` are deliberate
 * holds and never get one.
 *
 * USAGE  node scripts/maintenance/auto-merge.mjs [--dry-run] [--settle 10] [--gap 8] [--stall-hours 6]
 * Needs gh auth and MONGODB_URI (for the interlock).
 */
import { execSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = has('--dry-run');
const SETTLE_MIN = parseInt(val('--settle', '10'), 10);
const BUILD_GAP_MIN = parseInt(val('--gap', '8'), 10);
const MAX_RETRY_MIN = 10;
const STALL_HOURS = parseFloat(val('--stall-hours', '6'));
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const minutesAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;

function gating(pr) {
  const byName = Object.fromEntries((pr.statusCheckRollup || []).map((c) => [c.name, c.conclusion || c.status]));
  return { test: byName.test, DCO: byName.DCO, nextBuild: byName['next-build'], issueLink: byName['issue-link'] };
}

// `next-build` (next-build.yml) gates when present: running or failed holds
// the PR. Absent passes, so PRs opened before the workflow existed still merge.
const NEXT_BUILD_OK = new Set([undefined, 'SUCCESS', 'SKIPPED', 'NEUTRAL']);
// `issue-link` (pr-issue-link.yml) gates the same way: a PR whose title names an
// open issue must say `Closes #N` or `Part of #N` before it merges (#6284).
const ISSUE_LINK_OK = NEXT_BUILD_OK;

// `gh pr list` reports mergeable=UNKNOWN for EVERY open PR right after anything
// lands on main (GitHub invalidates them all at once and recomputes lazily, on a
// per-PR request). Since this job runs after merges by design, reading the list
// alone would find nothing to merge, forever. Asking for one PR forces the
// computation — same fix as reap-prs.mjs resolveMergeable(). First run after
// the 2026-09-30 launch: 7 of 7 candidates UNKNOWN, "nothing to merge".
function resolveMergeable(pr, attempts = 3) {
  for (let i = 0; i < attempts && pr.mergeable === 'UNKNOWN'; i++) {
    if (i) execSync('sleep 2');
    const fresh = JSON.parse(sh(`gh pr view ${pr.number} --json mergeable`));
    if (fresh.mergeable) pr = { ...pr, mergeable: fresh.mergeable };
  }
  return pr;
}

function candidates() {
  const prs = JSON.parse(sh('gh pr list --state open --limit 200 --label tier:auto --json number,title,isDraft,mergeable,labels,updatedAt,createdAt,statusCheckRollup,headRefName,headRefOid,baseRefName'));
  const out = [];
  for (let pr of prs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    pr = resolveMergeable(pr);
    const labels = pr.labels.map((l) => l.name);
    const g = gating(pr);
    const why = [];
    if (pr.isDraft) why.push('draft');
    if (labels.includes('blocked')) why.push('blocked label');
    if (labels.includes('tier:hold')) why.push('tier:hold label');
    if (pr.mergeable !== 'MERGEABLE') why.push(`mergeable=${pr.mergeable}`);
    // `test`/`next-build` never run on a PR into another branch, so `test=missing`
    // below would read as a CI fault. Say what it is (pr-needs-rebase.mjs labels it).
    if (pr.baseRefName && pr.baseRefName !== 'main') why.push(`stacked on ${pr.baseRefName} (merges after its parent)`);
    if (g.test !== 'SUCCESS') why.push(`test=${g.test || 'missing'}`);
    if (g.DCO !== 'SUCCESS') why.push(`DCO=${g.DCO || 'missing'}`);
    if (!NEXT_BUILD_OK.has(g.nextBuild)) why.push(`next-build=${g.nextBuild}`);
    if (!ISSUE_LINK_OK.has(g.issueLink)) why.push(`issue-link=${g.issueLink}`);
    if (minutesAgo(pr.updatedAt) < SETTLE_MIN) why.push(`updated ${minutesAgo(pr.updatedAt).toFixed(0)} min ago (< ${SETTLE_MIN} settle)`);
    out.push({ pr, why });
  }
  return out;
}

// Holds someone chose: never "stalled".
const DELIBERATE = ['draft', 'blocked label', 'tier:hold label'];
const STALL_MARK = (sha) => `<!-- auto-merge-stalled:${sha} -->`;

/** What to do about each skip reason, in the words the comment uses. */
function stallAdvice(why) {
  const out = [];
  if (why.some((w) => /^(test|DCO)=missing$/.test(w))) {
    out.push('CI never ran on this head commit (no `test` or `DCO` result). That usually means the PR conflicted with `main` when it was pushed. Merge `main` into the branch and push, and CI starts.');
  }
  if (why.some((w) => w === 'mergeable=CONFLICTING')) out.push('It conflicts with `main`. Merge `main` into the branch and resolve the conflict.');
  const failed = why.filter((w) => /^(test|DCO|next-build|issue-link)=(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/.test(w));
  if (failed.length) out.push(`A gating check did not pass (${failed.join(', ')}). Fix it and push.`);
  return out;
}

/** One comment per stalled head commit; returns how many were posted. */
function reportStalls(rows) {
  let posted = 0;
  for (const { pr, why } of rows) {
    if (!why.length || why.some((w) => DELIBERATE.includes(w))) continue;
    if (minutesAgo(pr.updatedAt) < STALL_HOURS * 60) continue;
    const advice = stallAdvice(why);
    if (!advice.length) continue; // still running, settling, or UNKNOWN: not stuck yet
    const mark = STALL_MARK(pr.headRefOid);
    const bodies = JSON.parse(sh(`gh pr view ${pr.number} --json comments --jq '[.comments[].body]'`));
    if (bodies.some((b) => b.includes(mark))) continue;
    const body = [
      `This \`tier:auto\` PR has not merged itself and will not until this is fixed. Untouched for ${Math.floor(minutesAgo(pr.updatedAt) / 60)} h on \`${pr.headRefOid.slice(0, 7)}\`:`,
      '',
      ...advice.map((a) => `- ${a}`),
      '',
      `Skip reasons, as auto-merge.mjs reads them: ${why.join(', ')}. One comment per head commit; a new push starts over.`,
      '',
      mark,
    ].join('\n');
    console.log(`#${pr.number} STALLED ${DRY ? '[dry-run] would comment' : 'commenting'}: ${advice.length} reason(s)`);
    if (DRY) continue;
    spawnSync('gh', ['pr', 'comment', String(pr.number), '--body', body], { encoding: 'utf8' });
    posted++;
  }
  return posted;
}

function mainTipAgeMin() {
  const iso = sh('gh api repos/{owner}/{repo}/commits/main --jq .commit.committer.date').trim();
  return minutesAgo(iso);
}

function interlockClear() {
  if (!process.env.MONGODB_URI) return { ok: false, note: 'MONGODB_URI unset — interlock cannot run (UNKNOWN is not clear)' };
  const r = spawnSync('node', ['scripts/audit/entities-sweep-active.mjs'], { encoding: 'utf8' });
  const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' | ');
  return { ok: r.status === 0, note: `entities-sweep-active exit ${r.status}: ${tail}` };
}

function main() {
  const rows = candidates();
  const ready = rows.filter((r) => !r.why.length);
  for (const r of rows) console.log(`#${r.pr.number} ${r.why.length ? 'skip: ' + r.why.join(', ') : 'READY'}  ${r.pr.title.slice(0, 60)}`);
  // A failed comment must never stop a merge.
  try { reportStalls(rows); } catch (e) { console.log(`::warning::stall report failed: ${e.message}`); }
  if (!ready.length) {
    console.log('nothing to merge');
    // A PR held back ONLY by the settle window becomes ready with no event to
    // wake this job — come back when the youngest such PR has settled.
    const settling = rows.filter((r) => r.why.length && r.why.every((w) => w.startsWith('updated ')));
    if (settling.length) return SETTLE_MIN - Math.min(...settling.map((r) => minutesAgo(r.pr.updatedAt))) + 1;
    return null;
  }

  const gap = mainTipAgeMin();
  if (gap < BUILD_GAP_MIN) { console.log(`main tip is ${gap.toFixed(0)} min old (< ${BUILD_GAP_MIN}); a build is likely in flight — retrying once it is ${BUILD_GAP_MIN} min old`); return BUILD_GAP_MIN - gap + 1; }
  const lock = interlockClear();
  console.log(lock.note);
  if (!lock.ok) { console.log('interlock NOT clear — no merge this run'); return MAX_RETRY_MIN; }

  const { pr } = ready[0];
  console.log(`${DRY ? '[dry-run] would merge' : 'merging'} #${pr.number} ${pr.title}`);
  if (DRY) return null;
  sh(`gh pr comment ${pr.number} --body "Auto-merged by auto-merge.yml: tier:auto, test+DCO green, interlock clear, main quiet ${gap.toFixed(0)} min. Rules: scripts/maintenance/pr-tier-rules.json"`);
  sh(`gh pr merge ${pr.number} --squash --delete-branch`);
  console.log(`merged #${pr.number}; the rest wait ${BUILD_GAP_MIN} min for the build`);
  dispatchWarm(pr.number);
  dispatchLedgers(pr.number);
  return ready.length > 1 ? BUILD_GAP_MIN + 1 : null;
}

// GitHub's `schedule` trigger is best-effort, and on 2026-09-30 it was dropped
// almost entirely (1 of 60 runs; 22 ready PRs stalled for hours — #5276). So
// the job books its own next run: main() returns the minutes until a merge
// could succeed (null = nothing waiting), and auto-merge.yml sleeps that long
// and re-dispatches itself. The schedule stays as a backstop.
function emitRetry(minutes) {
  const m = minutes == null || DRY ? '' : String(Math.min(MAX_RETRY_MIN, Math.max(1, Math.ceil(minutes))));
  console.log(m ? `next run in ${m} min` : 'no follow-up run needed');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `retry_in=${m}\n`);
}

// A push made with GITHUB_TOKEN never triggers `push` workflows (GitHub's
// recursion guard), so post-deploy-warm.yml — the Cloudflare purge + re-warm
// that stops stale HTML pointing at dead CSS chunks for 24h — must be started
// by hand here for any merge Vercel will build. Paths mirror that workflow's
// `on.push.paths`. deploy-hetzner.yml is not dispatched: Hetzner pulls hourly.
const WARM_PATHS = [/^src\//, /^public\//, /^next\.config\.ts$/, /^vercel\.json$/, /^package(-lock)?\.json$/];
function dispatchWarm(number) {
  const view = JSON.parse(sh(`gh pr view ${number} --json files,mergeCommit`));
  const paths = (view.files || []).map((f) => f.path);
  if (!paths.some((p) => WARM_PATHS.some((re) => re.test(p)))) { console.log('no app files changed — no Vercel build, no warm needed'); return; }
  const sha = view.mergeCommit?.oid;
  if (!sha) { console.log('::warning::merge commit SHA unknown — run post-deploy-warm.yml by hand'); return; }
  sh(`gh workflow run post-deploy-warm.yml --ref main -f sha=${sha}`);
  console.log(`dispatched post-deploy-warm.yml for ${sha}`);
}

// Same recursion guard, second victim: eval-ledgers-regenerate.yml rebuilds the
// generated scripts/eval/EXPERIMENTS.md and INDEX.md on push to main, and a
// token merge never fires it (#5390 on 2026-10-01 landed an entry nobody
// regenerated). Dispatch it for any merge that touched scripts/eval/.
function dispatchLedgers(number) {
  const view = JSON.parse(sh(`gh pr view ${number} --json files`));
  const paths = (view.files || []).map((f) => f.path);
  if (!paths.some((p) => p.startsWith('scripts/eval/'))) return;
  sh('gh workflow run eval-ledgers-regenerate.yml --ref main');
  console.log('dispatched eval-ledgers-regenerate.yml (scripts/eval/ changed)');
}

emitRetry(main());
