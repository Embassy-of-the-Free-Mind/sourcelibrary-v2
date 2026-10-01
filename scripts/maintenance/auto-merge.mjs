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
 *     its first result is often a spurious failure, see reap-prs.mjs)
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
 * USAGE  node scripts/maintenance/auto-merge.mjs [--dry-run] [--settle 10] [--gap 8]
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
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const minutesAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;

function gating(pr) {
  const byName = Object.fromEntries((pr.statusCheckRollup || []).map((c) => [c.name, c.conclusion || c.status]));
  return { test: byName.test, DCO: byName.DCO };
}

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
  const prs = JSON.parse(sh('gh pr list --state open --limit 200 --label tier:auto --json number,title,isDraft,mergeable,labels,updatedAt,createdAt,statusCheckRollup,headRefName'));
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
    if (g.test !== 'SUCCESS') why.push(`test=${g.test || 'missing'}`);
    if (g.DCO !== 'SUCCESS') why.push(`DCO=${g.DCO || 'missing'}`);
    if (minutesAgo(pr.updatedAt) < SETTLE_MIN) why.push(`updated ${minutesAgo(pr.updatedAt).toFixed(0)} min ago (< ${SETTLE_MIN} settle)`);
    out.push({ pr, why });
  }
  return out;
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
