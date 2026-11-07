#!/usr/bin/env node
/**
 * Close idle PRs that cannot merge as they are: conflicting or failing a
 * required check, untouched for 14+ days. Reopenable; the branch stays.
 *
 * PRIOR ART: scripts/maintenance/reap-prs.mjs — it only REPORTS (by design, and
 * runs its logic at import so a test cannot require it), and
 * park-stale-issues.mjs — it handles issues, not PRs. This is the PR sibling and
 * reuses the parker's shape (pure selector, dry-run default, --apply, cap).
 *
 * WHY (#8353 item 3): jobs open a PR and finish, then nobody owns it. On
 * 2026-11-07, 18 of about 30 open PRs had been idle 7+ days, several failing or
 * conflicting for 10+ days. Rule: give an idle PR an owner or close it.
 *
 * IDLE IS MEASURED FROM THE LAST COMMIT OR COMMENT, NOT `updatedAt` (#6285):
 * labels and cross-references bump `updatedAt`.
 *
 * A PR is closed only if ALL hold:
 *   - last commit and last comment both older than IDLE_DAYS (default 14)
 *   - conflicting, or `test`/`DCO` failing on the latest commit (a green
 *     mergeable PR is never closed; it should be merged)
 *   - not a draft, not dependabot/bot-authored
 *   - no `blocked` or `keep` label; `tier:hold` only if no human comment in 30 days
 *   - at most MAX per run (default 10), longest-idle first
 * Never deletes a branch.
 *
 * USAGE  node scripts/maintenance/close-stale-prs.mjs          # dry-run
 *        node scripts/maintenance/close-stale-prs.mjs --apply
 *        node scripts/maintenance/close-stale-prs.mjs --idle 21 --max 5
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NEVER_CLOSE = ['blocked', 'keep'];
export const REQUIRED_CHECKS = ['test', 'DCO'];
const HOLD_GRACE_DAYS = 30;

const isBot = (a) => !a || a.is_bot || /\[bot\]$|^app\//.test(a.login || '') || a.login === 'dependabot';

/** ISO time of the latest commit or comment (creation if neither). */
export function lastActivity(pr) {
  const commits = (pr.commits || []).map((c) => c.committedDate || c.authoredDate);
  const comments = (pr.comments || []).map((c) => c.createdAt);
  return [pr.createdAt, ...commits, ...comments].filter(Boolean).sort().pop();
}

/** True when a required check on the latest commit has failed. */
export function hasFailingRequiredCheck(pr) {
  return (pr.statusCheckRollup || []).some((c) =>
    REQUIRED_CHECKS.includes(c.name || c.context)
    && ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ERROR', 'STARTUP_FAILURE'].includes(c.conclusion || c.state));
}

/** Issue numbers named as `#N` in the title (for the comment's issue link). */
export function titleIssues(title) {
  return [...String(title || '').matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]));
}

/** PRs to close, longest-idle first, capped at `max`. Pure: no clock, no network. */
export function selectCandidates(prs, { now, idleDays = 14, max = 10 }) {
  const cutoff = (days) => new Date(now - days * 86400e3).toISOString();
  return prs
    .map((p) => ({ ...p, labelNames: (p.labels || []).map((l) => l.name), idleSince: lastActivity(p) }))
    .filter((p) => {
      if (p.isDraft || isBot(p.author)) return false;
      if (p.labelNames.some((l) => NEVER_CLOSE.includes(l))) return false;
      if (p.idleSince >= cutoff(idleDays)) return false;
      if (p.labelNames.includes('tier:hold')
        && (p.comments || []).some((c) => !isBot(c.author) && c.createdAt >= cutoff(HOLD_GRACE_DAYS))) return false;
      return p.mergeable === 'CONFLICTING' || hasFailingRequiredCheck(p);
    })
    .sort((a, b) => a.idleSince.localeCompare(b.idleSince))
    .slice(0, max);
}

export function closeComment(pr, idleDays) {
  const why = pr.mergeable === 'CONFLICTING' ? 'it conflicts with `main`' : 'a required check (`test` or `DCO`) is failing on its latest commit';
  const issues = titleIssues(pr.title);
  const link = issues.length ? ` The work it was for is tracked in #${issues[0]}.` : '';
  return `Closing: no commit or comment for ${idleDays}+ days and ${why}, so it cannot merge as it stands and nobody owns it.${link} This is reopenable and the branch \`${pr.headRefName}\` is kept. Rebase and reopen if it is still wanted. (\`scripts/maintenance/close-stale-prs.mjs\`, #8353)`;
}

function main() {
  const argv = process.argv.slice(2);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const APPLY = argv.includes('--apply');
  const IDLE = parseInt(val('--idle', '14'), 10);
  const MAX = parseInt(val('--max', '10'), 10);
  const repo = process.env.GITHUB_REPOSITORY || 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
  const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

  // Two stages: the list query cannot carry commits and comments for every PR
  // (GitHub's 500k-node cap), so shortlist on the cheap fields, then fetch the
  // activity history only for PRs that are otherwise closeable.
  const prs = JSON.parse(sh(`gh pr list --repo ${repo} --state open --limit 100 --json number,title,createdAt,isDraft,author,labels,mergeable,statusCheckRollup,headRefName`));
  const shortlist = selectCandidates(prs, { now: Date.now(), idleDays: 0, max: Infinity });
  const enriched = shortlist.map((p) => ({ ...p, ...JSON.parse(sh(`gh pr view ${p.number} --repo ${repo} --json commits,comments`)) }));
  const all = selectCandidates(enriched, { now: Date.now(), idleDays: IDLE, max: Infinity });
  const picked = all.slice(0, MAX);
  console.log(`${all.length} of ${prs.length} open PRs idle ${IDLE}+ days and conflicting/failing; this run takes ${picked.length} (max ${MAX})${APPLY ? '' : ' (dry-run; --apply to close)'}`);
  for (const p of picked) console.log(`  #${p.number}  ${p.idleSince.slice(0, 10)}  ${p.mergeable === 'CONFLICTING' ? 'conflicting' : 'checks-red'}  [${p.labelNames.join(',')}]  ${p.title.slice(0, 70)}`);
  if (!APPLY) return;
  let n = 0;
  for (const p of picked) {
    sh(`gh pr close ${p.number} --repo ${repo} --comment ${JSON.stringify(closeComment(p, IDLE))}`);
    n++;
  }
  console.log(`closed ${n}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
