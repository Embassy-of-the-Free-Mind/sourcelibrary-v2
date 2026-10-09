#!/usr/bin/env node
/**
 * Park idle issues that are ideas rather than defects: label `parked`, comment,
 * close. Reopenable.
 *
 * PRIOR ART: none — searched `ls scripts/maintenance scripts/audit`, `git grep
 * -l "gh issue" scripts/`, `gh issue list --search stale`. reap-prs.mjs
 * triages PRs, not issues; doc-staleness.yml checks docs, not the tracker.
 *
 * WHY
 * Measured 2026-09-30: 569 open issues; 305 opened and 100 closed in the last
 * 30 days. The tracker is used as a notebook, and a backlog where two thirds
 * never close is not a backlog — nobody can pick "the next thing" from it.
 *
 * IDLE IS MEASURED FROM THE LAST COMMENT, NOT `updatedAt` (#6285). `updatedAt`
 * moves on every cross-reference and label edit, so one triage pass reset the
 * clock on the whole tracker: on 2026-10-08 the dry run found 0 of 125
 * enhancement issues idle > 45 days while 72 open issues were > 90 days old.
 *
 * WHAT IT DOES (conservatively)
 *   - idle = days since the latest of: the issue's creation, its last comment,
 *     and the last PR (open or merged) that names it in its title
 *   - `enhancement` parks after IDLE_DAYS (default 45); any other issue after
 *     OTHER_IDLE_DAYS (default 90)
 *   - never parks a defect or a commitment: `bug`, `data-quality`,
 *     `user-feedback`, `security`, `ocr-fabrication`, `epic`, `blocked`,
 *     anything assigned, anything with a milestone
 *   - at most MAX per run (default 40), longest-idle first, so a wave is
 *     small enough to read
 *   - for each: add `parked`, comment once, close as "not planned"
 * A parked issue is still findable (`gh issue list --state closed --label
 * parked`) and one click reopens it. Nothing is deleted.
 *
 * USAGE  node scripts/maintenance/park-stale-issues.mjs                 # dry-run: list
 *        node scripts/maintenance/park-stale-issues.mjs --apply          # do it
 *        node scripts/maintenance/park-stale-issues.mjs --idle 60        # enhancement threshold
 *        node scripts/maintenance/park-stale-issues.mjs --other-idle 120 # everything else
 *        node scripts/maintenance/park-stale-issues.mjs --max 20         # cap per run
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NEVER_PARK = ['bug', 'data-quality', 'user-feedback', 'security', 'ocr-fabrication', 'epic', 'blocked', 'parked'];

/** ISO time of the latest of the issue's creation, its last comment, and `prAt` (a PR naming it). */
export function lastActivity(issue, prAt) {
  return [issue.createdAt, prAt, ...(issue.comments || []).map((c) => c.createdAt)].filter(Boolean).sort().pop();
}

/** { issueNumber: latest ISO time } from PRs whose TITLE names the issue as `#N`. */
export function prActivity(prs) {
  const at = {};
  for (const pr of prs) {
    const when = pr.mergedAt || pr.updatedAt;
    for (const m of String(pr.title || '').matchAll(/#(\d+)\b/g)) if (!(at[m[1]] > when)) at[m[1]] = when;
  }
  return at;
}

/** Issues to park, longest-idle first, capped at `max`. Pure: no clock, no network. */
export function selectCandidates(issues, { now, idleDays = 45, otherIdleDays = 90, max = 40, prAt = {} }) {
  const cutoff = (days) => new Date(now - days * 86400e3).toISOString();
  return issues
    .map((i) => ({ ...i, labelNames: i.labels.map((l) => l.name), idleSince: lastActivity(i, prAt[i.number]) }))
    .filter((i) => !i.labelNames.some((l) => NEVER_PARK.includes(l))
      && !(i.assignees || []).length && !i.milestone
      && i.idleSince < cutoff(i.labelNames.includes('enhancement') ? idleDays : otherIdleDays))
    .sort((a, b) => a.idleSince.localeCompare(b.idleSince))
    .slice(0, max);
}

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const APPLY = has('--apply');
  const IDLE_DAYS = parseInt(val('--idle', '45'), 10);
  const OTHER_IDLE_DAYS = parseInt(val('--other-idle', '90'), 10);
  const MAX = parseInt(val('--max', '40'), 10);
  const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...opts });

  const issues = JSON.parse(sh('gh issue list --state open --limit 3000 --json number,title,createdAt,labels,assignees,milestone,comments'));
  // A PR titled for an issue is work on it, even when nobody commented.
  const since = new Date(Date.now() - Math.max(IDLE_DAYS, OTHER_IDLE_DAYS) * 86400e3).toISOString().slice(0, 10);
  const prs = [
    ...JSON.parse(sh(`gh pr list --state merged --search "merged:>=${since}" --limit 3000 --json title,mergedAt`)),
    ...JSON.parse(sh('gh pr list --state open --limit 500 --json title,updatedAt')),
  ];
  const all = selectCandidates(issues, { now: Date.now(), idleDays: IDLE_DAYS, otherIdleDays: OTHER_IDLE_DAYS, max: Infinity, prAt: prActivity(prs) });
  const candidates = all.slice(0, MAX);

  console.log(`${all.length} of ${issues.length} open issues idle (enhancement > ${IDLE_DAYS} days, other > ${OTHER_IDLE_DAYS} days since the last comment or titled PR); this run takes ${candidates.length} (max ${MAX})${APPLY ? '' : ' (dry-run; --apply to park)'}`);
  for (const i of candidates) console.log(`  #${i.number}  ${i.idleSince.slice(0, 10)}  [${i.labelNames.join(',')}]  ${i.title.slice(0, 70)}`);
  if (!APPLY || !candidates.length) return;

  try { sh('gh label create parked --color BFDADC --description "Idle, closed by park-stale-issues.mjs; reopen if still wanted" --force'); } catch { /* exists */ }
  let n = 0;
  for (const i of candidates) {
    const days = i.labelNames.includes('enhancement') ? IDLE_DAYS : OTHER_IDLE_DAYS;
    const body = `Parked: no comment and no PR for ${days} days and nobody assigned. Closed as not planned so the open list stays a list of work someone will do. Reopen if it is still wanted — nothing was lost. (\`scripts/maintenance/park-stale-issues.mjs\`)`;
    sh(`gh issue edit ${i.number} --add-label parked`);
    sh(`gh issue close ${i.number} --reason "not planned" --comment ${JSON.stringify(body)}`);
    n++;
  }
  console.log(`parked ${n}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
