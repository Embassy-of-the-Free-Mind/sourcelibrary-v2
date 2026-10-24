#!/usr/bin/env node
/**
 * Backlog triage, "already done" pass: find open issues whose work has shipped,
 * and close the ones nobody has to look at again, each with a link to its evidence.
 *
 * PRIOR ART: scripts/maintenance/park-stale-issues.mjs — closes issues that are IDLE,
 * not issues that are DONE, and never reads PRs beyond their titles. Its NEVER_PARK
 * list is reused here as the hold list. scripts/maintenance/pr-issue-link.mjs links
 * PRs to issues; it does not close anything. The 2026-09-25 pass (#5092) used a paid
 * model screen; this one is $0 and deterministic.
 *
 * WHY (#7277)
 * 753 open issues on 2026-10-24. 128 of them had a merged `Closes #N` PR on main and
 * were still open: auto-merge.yml merges as `github-actions` (GITHUB_TOKEN), and
 * GitHub does not run closing keywords for that merger. Of October's 38 issues linked
 * from bot-merged PRs, 32 were still open.
 *
 * EVIDENCE (any one makes an issue a candidate)
 *   - a merged PR into main that names it with a closing keyword (closedByPullRequestsReferences)
 *   - a commit on origin/main that says `fix/close/resolve #N`, or is titled `fix(#N): …`
 *   - an auto-filed detector issue whose latest scheduled run finished without filing (DETECTORS)
 *
 * CLASSES
 *   close   evidence, no hold, and nothing after the evidence says the work is unfinished
 *   review  evidence, but the issue was reopened after it, or a later comment / the PR body
 *           says something is left. A human reads these.
 *   hold    evidence, but a protected label, an assignee, a milestone, or a money/auth/
 *           deletion subject. Listed, never closed (#7277 rule 6).
 *
 * USAGE  node scripts/maintenance/issue-triage-done-pass.mjs                  # dry run: write report
 *        node scripts/maintenance/issue-triage-done-pass.mjs --from dump.jsonl # reuse a dump
 *        node scripts/maintenance/issue-triage-done-pass.mjs --out DIR         # report dir (default $JOB_SCRATCH or .)
 *        node scripts/maintenance/issue-triage-done-pass.mjs --apply --only 1,2 # close these `close` rows
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NEVER_PARK } from './park-stale-issues.mjs';

const REPO = ['Embassy-of-the-Free-Mind', 'sourcelibrary-v2'];
export const HOLD_LABELS = [...new Set([...NEVER_PARK.filter((l) => l !== 'parked'), 'contained'])];
export const HOLD_SUBJECT = /\b(money|donat|stripe|invoice|billing|spend|budget|\$\d|auth|login|session cookie|password|permission|role|credential|secret|delet|purge|remov(e|al) (books?|pages?))/i;
export const UNFINISHED = /\b(not done|not yet|still (open|missing|broken|failing|live)|remain(s|ing)|left to do|what'?s left|reopen|partial(ly)?|follow-?up needed|needs? a human|not fixed|half)\b/i;

/** Detector issues: title prefix → the workflow job whose skipped "File findings" step means a clean run. */
export const DETECTORS = [
  { prefix: 'Pages served from R2 with no master held — ', workflow: 'master-copy-watch.yml' },
  { prefix: 'Field sprawl breach on books — ', workflow: 'field-sprawl-watch.yml', job: 'field-sprawl' },
  { prefix: 'Image/text misalignment found in weekly sample — ', workflow: 'corpus-integrity-watch.yml', job: 'alignment-sample' },
  { prefix: 'Unmapped library providers on /libraries — ', workflow: 'library-coverage-watch.yml' },
  { prefix: 'Prompt defaults drift — ', workflow: 'prompt-defaults-watch.yml' },
  { prefix: 'Placeholder book slugs are live', workflow: 'corpus-integrity-watch.yml', job: 'placeholder-slugs' },
];

const Q = `query($c:String){repository(owner:"${REPO[0]}",name:"${REPO[1]}"){issues(states:OPEN,first:40,after:$c,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor}
nodes{number title body createdAt author{login} labels(first:20){nodes{name}} assignees(first:5){nodes{login}} milestone{title}
comments(last:3){totalCount nodes{author{login} createdAt body}}
timelineItems(last:20,itemTypes:[REOPENED_EVENT]){nodes{... on ReopenedEvent{createdAt}}}
closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number title state merged mergedAt baseRefName body}}}}}}`;

function gh(args, tries = 6) {
  for (let t = 0; ; t++) {
    try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { if (t >= tries - 1) throw e; execFileSync('sleep', [String(5 * (t + 1))]); } // connection resets
  }
}

export function fetchIssues() {
  const out = []; let c = null;
  for (;;) {
    const d = JSON.parse(gh(['api', 'graphql', '-f', `query=${Q}`, ...(c ? ['-f', `c=${c}`] : [])])).data.repository.issues;
    out.push(...d.nodes);
    if (!d.pageInfo.hasNextPage) return out;
    c = d.pageInfo.endCursor;
  }
}

/** { issueNumber: [{sha, subject}] } from origin/main commit messages that close or fix #N. */
export function commitEvidence(log) {
  const at = {};
  for (const raw of log.split('\x1e')) {
    const [sha, subject = '', body = ''] = raw.trim().split('\x1f');
    if (!sha) continue;
    const nums = new Set();
    for (const m of `${subject}\n${body}`.matchAll(/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b:?\s+((?:#\d+[,\s]*(?:and\s+)?)+)/gi)) for (const n of m[1].matchAll(/#(\d+)/g)) nums.add(+n[1]);
    const t = subject.match(/^fix\([^)]*?#(\d+)\)/);
    if (t) nums.add(+t[1]);
    for (const n of nums) (at[n] ||= []).push({ sha: sha.slice(0, 9), subject: subject.slice(0, 100) });
  }
  return at;
}

/** Latest scheduled run of a detector: { url, clean } where clean = success and its File-findings step skipped. */
export function detectorRun({ workflow, job }) {
  const runs = JSON.parse(gh(['run', 'list', '-R', REPO.join('/'), '--workflow', workflow, '--event', 'schedule', '--limit', '1', '--json', 'databaseId,conclusion,createdAt,url']));
  if (!runs.length) return null;
  const r = runs[0];
  const jobs = JSON.parse(gh(['api', `repos/${REPO.join('/')}/actions/runs/${r.databaseId}/jobs`])).jobs.filter((j) => !job || j.name === job);
  const filing = jobs.flatMap((j) => j.steps || []).filter((s) => /^File/.test(s.name));
  const clean = r.conclusion === 'success' && filing.length > 0 && filing.every((s) => s.conclusion === 'skipped');
  return { url: r.url, at: r.createdAt, clean };
}

/** Pure: one issue + its evidence → { cls, why, evidence }. */
export function classify(issue, { commits = [], detector = null } = {}) {
  const labels = issue.labels.nodes.map((l) => l.name);
  const prs = issue.closedByPullRequestsReferences.nodes.filter((p) => p.merged && p.baseRefName === 'main');
  const evidence = [
    ...prs.map((p) => ({ kind: 'pr', ref: `#${p.number}`, at: p.mergedAt, text: p.title, body: p.body || '' })),
    ...commits.map((c) => ({ kind: 'commit', ref: c.sha, at: null, text: c.subject, body: '' })),
    ...(detector?.clean ? [{ kind: 'detector', ref: detector.url, at: detector.at, text: 'latest scheduled run passed (did not file)', body: '' }] : []),
  ];
  if (!evidence.length) return { cls: 'none' };
  const hold = labels.filter((l) => HOLD_LABELS.includes(l));
  if (issue.assignees.nodes.length) hold.push('assigned');
  if (issue.milestone) hold.push('milestone');
  if (HOLD_SUBJECT.test(issue.title)) hold.push('subject');
  if (hold.length) return { cls: 'hold', why: hold.join(','), evidence };
  const last = evidence.map((e) => e.at).filter(Boolean).sort().pop() || '';
  const reopened = issue.timelineItems.nodes.some((r) => r.createdAt > last);
  const laterSays = issue.comments.nodes.filter((c) => c.createdAt > last && UNFINISHED.test(c.body)).length;
  const prSays = prs.some((p) => /^#+\s*(not done|what'?s left|remaining|left for)/im.test(p.body || ''));
  if (reopened || laterSays || prSays) return { cls: 'review', why: [reopened && 'reopened after the merge', laterSays && 'a later comment says work remains', prSays && 'the PR lists work not done'].filter(Boolean).join('; '), evidence };
  return { cls: 'close', evidence };
}

export function closeComment(evidence) {
  const lines = evidence.map((e) => e.kind === 'pr' ? `- merged ${e.ref}: ${e.text}` : e.kind === 'commit' ? `- commit ${e.ref} on main: ${e.text}` : `- detector: ${e.text} (${e.ref})`);
  const why = evidence.some((e) => e.kind === 'pr') ? ' A `Closes` line in a PR merged by `github-actions` does not close the issue, so this one stayed open.' : '';
  return `Closing as done: the work shipped.\n\n${lines.join('\n')}\n${why ? `\n${why.trim()}` : ''}\nReopen if something is left. (\`scripts/maintenance/issue-triage-done-pass.mjs\`, #7277)`;
}

function main() {
  const argv = process.argv.slice(2);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const OUT = val('--out', process.env.JOB_SCRATCH || '.');
  const FROM = val('--from', null);
  const ONLY = new Set(String(val('--only', '')).split(',').filter(Boolean).map(Number));
  const issues = FROM ? readFileSync(FROM, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : fetchIssues();
  const log = execFileSync('git', ['log', 'origin/main', '--since=2026-04-01', '--format=%H%x1f%s%x1f%b%x1e'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const commits = commitEvidence(log);
  const det = new Map();
  for (const d of DETECTORS) { try { det.set(d.prefix, detectorRun(d)); } catch (e) { console.error(`detector ${d.workflow}: ${e.message.split('\n')[0]}`); } }

  const rows = issues.map((i) => {
    const d = DETECTORS.find((x) => i.title.startsWith(x.prefix) && i.author?.login === 'github-actions');
    return { number: i.number, title: i.title, labels: i.labels.nodes.map((l) => l.name), ...classify(i, { commits: commits[i.number] || [], detector: d ? det.get(d.prefix) : null }) };
  }).filter((r) => r.cls !== 'none');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/done-pass.json`, JSON.stringify(rows.map(({ evidence, ...r }) => ({ ...r, evidence: evidence.map(({ body, ...e }) => e) })), null, 1));
  for (const cls of ['close', 'review', 'hold']) {
    const set = rows.filter((r) => r.cls === cls);
    console.log(`\n${cls}: ${set.length}`);
    for (const r of set) console.log(`  #${r.number} [${r.labels.join(',')}] ${r.title.slice(0, 80)}${r.why ? ` — ${r.why}` : ''} ← ${r.evidence.map((e) => e.ref).join(' ')}`);
  }
  if (!argv.includes('--apply')) return console.log(`\ndry run; report in ${OUT}/done-pass.json. --apply --only N,N closes those \`close\` rows.`);
  for (const r of rows.filter((x) => x.cls === 'close' && ONLY.has(x.number))) {
    gh(['issue', 'close', String(r.number), '-R', REPO.join('/'), '--reason', 'completed', '--comment', closeComment(r.evidence)]);
    console.log(`closed #${r.number}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
