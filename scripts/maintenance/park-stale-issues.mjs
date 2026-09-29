#!/usr/bin/env node
/**
 * Park idle enhancement issues: label `parked`, comment, close. Reopenable.
 *
 * PRIOR ART: none — searched `ls scripts/maintenance scripts/audit`, `git grep
 * -l "gh issue" scripts/`, `gh issue list --search stale`. reap-prs.mjs
 * triages PRs, not issues; doc-staleness.yml checks docs, not the tracker.
 *
 * WHY
 * Measured 2026-09-30: 569 open issues; 305 opened and 100 closed in the last
 * 30 days. The tracker is used as a notebook, and a backlog where two thirds
 * never close is not a backlog — nobody can pick "the next thing" from it.
 * Most of the churn is bugs and pipeline findings that DO get worked; the part
 * that only accumulates is `enhancement` (133 open, 52 idle > 45 days).
 *
 * WHAT IT DOES (conservatively)
 *   - candidates: open, label `enhancement`, NOT `epic`, no assignee, no
 *     milestone, no `parked`, updated > IDLE_DAYS ago (default 45)
 *   - for each: add `parked`, comment once, close as "not planned"
 *   - never touches bugs, user-feedback, security, or anything assigned
 * A parked issue is still findable (`gh issue list --state closed --label
 * parked`) and one click reopens it. Nothing is deleted.
 *
 * USAGE  node scripts/maintenance/park-stale-issues.mjs            # dry-run: list
 *        node scripts/maintenance/park-stale-issues.mjs --apply     # do it
 *        node scripts/maintenance/park-stale-issues.mjs --idle 60   # threshold
 */
import { execSync } from 'node:child_process';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = has('--apply');
const IDLE_DAYS = parseInt(val('--idle', '45'), 10);
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...opts });

const cutoff = new Date(Date.now() - IDLE_DAYS * 86400e3).toISOString();
const issues = JSON.parse(sh('gh issue list --state open --label enhancement --limit 1000 --json number,title,updatedAt,labels,assignees,milestone'));
const candidates = issues.filter((i) => {
  const labels = i.labels.map((l) => l.name);
  return i.updatedAt < cutoff
    && !labels.includes('epic') && !labels.includes('parked') && !labels.includes('security')
    && !(i.assignees || []).length && !i.milestone;
}).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

console.log(`${candidates.length} of ${issues.length} open enhancement issues idle > ${IDLE_DAYS} days${APPLY ? '' : ' (dry-run; --apply to park)'}`);
for (const i of candidates) console.log(`  #${i.number}  ${i.updatedAt.slice(0, 10)}  ${i.title.slice(0, 70)}`);
if (!APPLY || !candidates.length) process.exit(0);

try { sh('gh label create parked --color BFDADC --description "Idle enhancement, closed by park-stale-issues.mjs; reopen if still wanted" --force'); } catch { /* exists */ }
const body = `Parked: no activity for ${IDLE_DAYS} days and nobody assigned. Closed as not planned so the open list stays a list of work someone will do. Reopen if it is still wanted — nothing was lost. (\`scripts/maintenance/park-stale-issues.mjs\`)`;
let n = 0;
for (const i of candidates) {
  sh(`gh issue edit ${i.number} --add-label parked`);
  sh(`gh issue close ${i.number} --reason "not planned" --comment ${JSON.stringify(body)}`);
  n++;
}
console.log(`parked ${n}`);
