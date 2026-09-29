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

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = has('--dry-run');
const SETTLE_MIN = parseInt(val('--settle', '10'), 10);
const BUILD_GAP_MIN = parseInt(val('--gap', '8'), 10);
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const minutesAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;

function gating(pr) {
  const byName = Object.fromEntries((pr.statusCheckRollup || []).map((c) => [c.name, c.conclusion || c.status]));
  return { test: byName.test, DCO: byName.DCO };
}

function candidates() {
  const prs = JSON.parse(sh('gh pr list --state open --limit 200 --label tier:auto --json number,title,isDraft,mergeable,labels,updatedAt,createdAt,statusCheckRollup,headRefName'));
  const out = [];
  for (const pr of prs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
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
  if (!ready.length) { console.log('nothing to merge'); return; }

  const gap = mainTipAgeMin();
  if (gap < BUILD_GAP_MIN) { console.log(`main tip is ${gap.toFixed(0)} min old (< ${BUILD_GAP_MIN}); a build is likely in flight — try next run`); return; }
  const lock = interlockClear();
  console.log(lock.note);
  if (!lock.ok) { console.log('interlock NOT clear — no merge this run'); return; }

  const { pr } = ready[0];
  console.log(`${DRY ? '[dry-run] would merge' : 'merging'} #${pr.number} ${pr.title}`);
  if (DRY) return;
  sh(`gh pr comment ${pr.number} --body "Auto-merged by auto-merge.yml: tier:auto, test+DCO green, interlock clear, main quiet ${gap.toFixed(0)} min. Rules: scripts/maintenance/pr-tier-rules.json"`);
  sh(`gh pr merge ${pr.number} --squash --delete-branch`);
  console.log(`merged #${pr.number}; the rest wait ${BUILD_GAP_MIN} min for the build`);
}

main();
