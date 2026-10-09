#!/usr/bin/env node
/**
 * PRIOR ART: .github/workflows/post-deploy-warm.yml — waits for ONE push's build (GitHub deployment statuses)
 * and goes red in Actions, but files nothing and never looks at the build after it, so a run of failed builds
 * is N separate red runs nobody reads. scripts/deploy-prod.sh — the manual deploy, polls its own deployment
 * only. scripts/audit/pipeline-next-step-audit.mjs — the issue dedupe followed here (file / comment / close
 * by title). scripts/workers/disk-alarm.sh + scripts/audit/worker-code-drift.mjs — the ntfy channel and the
 * page-once-per-transition state file followed here. None reads production's deployment history.
 *
 * vercel-prod-watch — alarm when production builds fail or production falls behind main (#5708).
 *
 * On 2026-10-02 every production build from 13:28Z to 21:54Z ended `● Error` at the ignore step
 * (`fatal: bad object f718cdd…`, fixed in #5662). The site served 200, stale, for ~8 h, and nothing alarmed.
 *
 * Reads the Vercel REST API (never the CLI's text output) for the newest production deployments of
 * sourcelibrary-v2 and `origin/main` from the local checkout, and FIRES (exit 1) when either:
 *
 *   failing_streak  the newest ≥ 2 settled production builds are ERROR, or CANCELED for a commit that changed
 *                   build inputs. A CANCELED build whose commit changed nothing the ignore step diffs is the
 *                   ignore step skipping a no-op merge (deploy-and-caching.md, "Canceled after ~12s") — it
 *                   neither counts nor breaks the streak. In-flight builds are skipped.
 *   behind_main     the oldest commit on origin/main that touches build inputs and is NOT in production's
 *                   commit is more than 60 min old. "Build inputs" are read from vercel.json's ignoreCommand,
 *                   so this check and Vercel's own skip rule cannot drift apart. This one also catches the
 *                   integration going silent (#4025): no deployment at all is created, so no streak forms.
 *
 * Exit contract (measurement-instruments.md): 0 ran, clean · 1 ran, FIRED · 2 could not measure (no token,
 * API/git failure, production's commit unknown, the self-test did not fire, any throw). Never branch on != 0.
 *
 * WRITES (not with --dry-run): one GitHub issue deduped by title — filed on the first FAIL, commented when the
 * incident changes (a new rule, a new oldest failing commit), closed on the next clean run; one ntfy page
 * (topic sourcelibrary-uptime) on each transition between ok / fail / unknown; a state file holding the last
 * level and incident key. Reads nothing else, writes nothing else, never redeploys (out of scope: #5708).
 *
 * Usage:
 *   node scripts/audit/vercel-prod-watch.mjs --dry-run      # measure + print, no issue, no page, no state
 *   node scripts/audit/vercel-prod-watch.mjs                # cron (infrastructure/hetzner-crontab)
 *   node scripts/audit/vercel-prod-watch.mjs --fixture tests/fixtures/vercel-prod-watch/2026-10-02.json \
 *        --now 2026-10-02T14:00:00Z                         # replay a recorded window (implies --dry-run)
 *   ... --json   the report on stdout
 *
 * Env: VERCEL_TOKEN (required, no fallback). VERCEL_PROJECT_ID / VERCEL_ORG_ID, else .vercel/project.json, else the ids below.
 *      VERCEL_PROD_WATCH_STATE (state file), VERCEL_PROD_WATCH_TOPIC (ntfy URL) for testing the wiring.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInputs as ignoreScriptInputs } from '../vercel-ignore-build.mjs';

export const MIN_STREAK = 2;
export const MAX_BEHIND_MIN = 60;
// Public identifiers (not secrets; Vercel's own PR comments print them). Env or .vercel/project.json override.
const PROJECT_ID = 'prj_rUw0rjkXvVbIo7iwqpRTl31sxA8s'; // sourcelibrary-v2
const TEAM_ID = 'team_lpvBLTNADOdDvzq054wPGov8'; // dereklomas-projects
const MAIN_DEPTH = 400; // commits of origin/main to read; production further back than this is UNKNOWN
const DEPLOYMENT_LIMIT = 30;
const ISSUE_TITLE = 'Vercel production: builds failing or behind main';
const NTFY_TOPIC = process.env.VERCEL_PROD_WATCH_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';
const STATE_FILE = process.env.VERCEL_PROD_WATCH_STATE || '/var/lib/sourcelibrary/vercel-prod-watch.json';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const IN_FLIGHT = new Set(['BUILDING', 'QUEUED', 'INITIALIZING']);
const short = (sha) => (sha ? String(sha).slice(0, 7) : '(no sha)');
const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : '?');

/**
 * The paths Vercel's ignore step diffs. When vercel.json's ignoreCommand runs
 * scripts/vercel-ignore-build.mjs, ask that script for its list (the same function Vercel runs);
 * otherwise parse an inline `… HEAD -- <paths>` command.
 */
export function buildInputsFromIgnoreCommand(cmd, repo = REPO) {
  if (/scripts\/vercel-ignore-build\.mjs/.test(String(cmd ?? ''))) return ignoreScriptInputs(repo);
  const m = /\bHEAD\s+--\s+(.+?)\s*$/.exec(String(cmd ?? ''));
  const paths = m ? m[1].split(/\s+/).filter(Boolean) : [];
  if (!paths.length) throw new Error(`could not read build-input paths from vercel.json ignoreCommand: ${JSON.stringify(cmd)}`);
  return paths;
}

/** One Vercel API deployment → the fields the judge reads. */
export function normalizeDeployment(d) {
  return {
    uid: d.uid ?? d.id,
    url: d.url ?? null,
    state: String(d.readyState ?? d.state ?? 'UNKNOWN').toUpperCase(),
    createdAt: Number(d.createdAt ?? d.created),
    sha: d.meta?.githubCommitSha ?? null,
    subject: String(d.meta?.githubCommitMessage ?? '').split('\n')[0],
    errorLine: d.errorLine ?? d.errorMessage ?? null,
  };
}

/**
 * The verdict. Pure: deployments as the Vercel API returns them, main's history as an ordered list.
 * @param {object[]} deployments  production deployments, any order
 * @param {{ mainCommits: {sha:string,date:string,subject?:string,touches_inputs:boolean}[], now: Date,
 *           minStreak?: number, maxBehindMin?: number }} opts  mainCommits oldest → newest
 */
export function judge(deployments, { mainCommits, now, minStreak = MIN_STREAK, maxBehindMin = MAX_BEHIND_MIN }) {
  const deps = deployments.map(normalizeDeployment).filter((d) => Number.isFinite(d.createdAt))
    .sort((a, b) => b.createdAt - a.createdAt);
  const pos = new Map(mainCommits.map((c, i) => [c.sha, i]));
  const findPos = (sha) => {
    if (!sha) return -1;
    if (pos.has(sha)) return pos.get(sha);
    const hit = mainCommits.findIndex((c) => c.sha.startsWith(sha) || sha.startsWith(c.sha));
    return hit;
  };
  const unknown = [];

  const prod = deps.find((d) => d.state === 'READY') ?? null;
  const prodPos = prod ? findPos(prod.sha) : -1;
  if (!deps.length) unknown.push('the Vercel API returned no production deployments (wrong project/team, or the token cannot see it)');
  else if (!prod) unknown.push(`no READY production deployment among the newest ${deps.length}: production's commit is unknown`);
  else if (!prod.sha) unknown.push(`production deployment ${prod.uid} carries no githubCommitSha`);
  else if (prodPos < 0) unknown.push(`production commit ${short(prod.sha)} is not among the newest ${mainCommits.length} commits of origin/main (a promoted non-main build, or > ${mainCommits.length} behind)`);

  /** Did any commit after production's, up to and including `sha`, change build inputs? */
  const changedInputs = (sha) => {
    const p = findPos(sha);
    if (p < 0) return true; // not on main: cannot prove it was a skip, so it counts
    const from = prodPos >= 0 && prodPos < p ? prodPos + 1 : p;
    for (let i = from; i <= p; i++) if (mainCommits[i].touches_inputs) return true;
    return false;
  };

  // ── failing streak
  const streak = [];
  const skipped = [];
  for (const d of deps) {
    if (d.state === 'READY') break;
    if (IN_FLIGHT.has(d.state)) { skipped.push({ ...d, why: 'in flight' }); continue; }
    if (d.state === 'CANCELED' && !changedInputs(d.sha)) { skipped.push({ ...d, why: 'ignore-step skip (no build-input change)' }); continue; }
    if (d.state === 'ERROR' || d.state === 'CANCELED') streak.push(d);
    else skipped.push({ ...d, why: `state ${d.state}` });
  }

  // ── behind main
  let behind = null;
  if (prodPos >= 0) {
    const unshipped = mainCommits.slice(prodPos + 1).filter((c) => c.touches_inputs);
    const oldest = unshipped[0] ?? null;
    const lagMin = oldest ? Math.floor((now.getTime() - Date.parse(oldest.date)) / 60e3) : 0;
    behind = { commits_behind: mainCommits.length - 1 - prodPos, unshipped_inputs: unshipped, oldest, lag_min: lagMin };
  }

  const fails = [];
  if (streak.length >= minStreak) {
    fails.push({
      rule: 'failing_streak',
      text: `the newest ${streak.length} production builds failed (${streak.map((d) => `${short(d.sha)} ${d.state}`).join(', ')})`,
      first_error: streak[streak.length - 1].errorLine ?? streak[0].errorLine ?? null,
    });
  }
  if (behind && behind.oldest && behind.lag_min > maxBehindMin) {
    fails.push({
      rule: 'behind_main',
      text: `production (${short(prod.sha)}) is missing ${behind.unshipped_inputs.length} build-input commit(s) on main; the oldest, ${short(behind.oldest.sha)}, merged ${behind.lag_min} min ago (> ${maxBehindMin})`,
    });
  }

  // A finding stands on its own even when the other check is unknown; only a clean verdict needs both.
  const status = fails.length ? 'FAIL' : unknown.length ? 'UNKNOWN' : 'PASS';
  const incidentSha = streak.length >= minStreak ? streak[streak.length - 1].sha : behind?.oldest?.sha;
  return {
    status,
    generated_at: now.toISOString(),
    fails,
    unknown,
    incident_key: fails.length ? `${fails.map((f) => f.rule).join('+')}@${short(incidentSha)}` : null,
    production: prod ? { uid: prod.uid, url: prod.url, sha: prod.sha, subject: prod.subject, created: iso(prod.createdAt) } : null,
    streak: streak.map((d) => ({ uid: d.uid, sha: d.sha, subject: d.subject, state: d.state, created: iso(d.createdAt), error: d.errorLine })),
    skipped: skipped.map((d) => ({ uid: d.uid, sha: d.sha, state: d.state, why: d.why })),
    behind: behind && {
      commits_behind: behind.commits_behind, lag_min: behind.lag_min,
      unshipped_inputs: behind.unshipped_inputs.map((c) => ({ sha: c.sha, date: c.date, subject: c.subject })),
    },
    deployments_read: deps.length,
    main_read: mainCommits.length,
  };
}

/** Self-test, every run: two ERROR builds after a READY must fire. If not, the judge is broken (exit 2). */
export function selfTest() {
  const now = new Date('2026-01-01T12:00:00Z');
  const main = ['a', 'b', 'c'].map((s, i) => ({ sha: s.repeat(40), date: new Date(now - (3 - i) * 3600e3).toISOString(), touches_inputs: true }));
  const dep = (s, state, h) => ({ uid: `dpl_${s}`, readyState: state, createdAt: now - h * 3600e3, meta: { githubCommitSha: s.repeat(40) } });
  const r = judge([dep('a', 'READY', 3), dep('b', 'ERROR', 2), dep('c', 'ERROR', 1)], { mainCommits: main, now });
  return r.fails.some((f) => f.rule === 'failing_streak') && r.fails.some((f) => f.rule === 'behind_main');
}

export function renderText(r) {
  const L = [`vercel-prod-watch — ${r.generated_at} — ${r.status}`];
  L.push(`read: ${r.deployments_read} production deployments, ${r.main_read} commits of origin/main`);
  L.push(r.production
    ? `production: ${short(r.production.sha)} ${r.production.subject} (READY, created ${r.production.created}, ${r.production.url ?? r.production.uid})`
    : 'production: unknown');
  if (r.behind) {
    L.push(`behind main: ${r.behind.commits_behind} commits, ${r.behind.unshipped_inputs.length} touching build inputs`
      + (r.behind.unshipped_inputs.length ? `, oldest unshipped ${r.behind.lag_min} min ago` : ''));
    for (const c of r.behind.unshipped_inputs.slice(0, 10)) L.push(`  ${short(c.sha)} ${c.date} ${c.subject ?? ''}`);
  }
  if (r.streak.length) {
    L.push(`failed builds since production (newest first): ${r.streak.length}`);
    for (const d of r.streak.slice(0, 20)) L.push(`  ${short(d.sha)} ${d.state.padEnd(8)} ${d.created} ${d.subject}${d.error ? `\n           first error: ${d.error}` : ''}`);
  }
  if (r.skipped.length) L.push(`not counted: ${r.skipped.map((d) => `${short(d.sha)} ${d.state} (${d.why})`).join('; ')}`);
  for (const f of r.fails) L.push(`FAIL ${f.rule}: ${f.text}${f.first_error ? `\n  first error line: ${f.first_error}` : ''}`);
  for (const u of r.unknown) L.push(`UNKNOWN: ${u}`);
  return L.join('\n');
}

// ─────────────────────────────────────────── inputs (Vercel API, git)

function projectIds() {
  let file = {};
  try { file = JSON.parse(readFileSync(join(REPO, '.vercel/project.json'), 'utf8')); } catch { /* optional */ }
  return { projectId: process.env.VERCEL_PROJECT_ID || file.projectId || PROJECT_ID, teamId: process.env.VERCEL_ORG_ID || file.orgId || TEAM_ID };
}

async function vercel(path, token, teamId) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Vercel API ${url.pathname} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** First line of a failed build that names an error: the build events, else the deployment's errorMessage. */
async function firstErrorLine(uid, token, teamId) {
  try {
    const events = await vercel(`/v3/deployments/${uid}/events?builds=1&limit=-1`, token, teamId);
    for (const e of Array.isArray(events) ? events : []) {
      const text = String(e.payload?.text ?? e.text ?? '');
      const line = text.split('\n').find((l) => /\b(error|fatal|failed)\b/i.test(l));
      if (line) return line.trim().slice(0, 300);
    }
  } catch { /* fall through to errorMessage */ }
  try {
    const d = await vercel(`/v13/deployments/${uid}`, token, teamId);
    return d.errorMessage ? String(d.errorMessage).split('\n')[0].slice(0, 300) : null;
  } catch (e) {
    return `(error line unavailable: ${e.message.slice(0, 120)})`;
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).trim();
}

function readMain(inputs, { fetchFirst }) {
  if (fetchFirst) git(['fetch', '--quiet', 'origin', 'main']);
  const touching = new Set(git(['log', '--format=%H', `-n${MAIN_DEPTH}`, 'origin/main', '--', ...inputs]).split('\n').filter(Boolean));
  return git(['log', '--format=%H%x09%cI%x09%s', `-n${MAIN_DEPTH}`, 'origin/main']).split('\n').filter(Boolean).reverse()
    .map((l) => { const [sha, date, subject] = l.split('\t'); return { sha, date, subject, touches_inputs: touching.has(sha) }; });
}

// ─────────────────────────────────────────── outputs (issue, page, state)

function gh(args) {
  return execFileSync('gh', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}
function openIssue() {
  const list = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title', '--limit', '20']) || '[]');
  return list.find((i) => i.title.startsWith(ISSUE_TITLE)) || null;
}
function issueBody(r, text) {
  return `${r.fails.map((f) => `- **${f.text}**${f.first_error ? `\n  first error: \`${f.first_error}\`` : ''}`).join('\n')}\n\n\`\`\`\n${text}\n\`\`\`\n\n`
    + 'Filed by `scripts/audit/vercel-prod-watch.mjs` (Hetzner cron, every 15 min; #5708). It comments here when the incident '
    + 'changes and closes this on the next clean run. Recovery: `.claude/docs/invariants/deploy-and-caching.md` '
    + '("Did my merge actually ship?"); `npm run deploy:prod` when a merge demonstrably did not ship.';
}
function syncIssue(r, text, prev) {
  const open = openIssue();
  if (r.status === 'FAIL') {
    if (!open) return `filed ${gh(['issue', 'create', '--title', `${ISSUE_TITLE} — ${r.generated_at.slice(0, 10)}`, '--body', issueBody(r, text)])}`;
    if (prev.key === r.incident_key) return `#${open.number} already open for ${r.incident_key}`;
    gh(['issue', 'comment', String(open.number), '--body', issueBody(r, text)]);
    return `commented on #${open.number}`;
  }
  if (!open) return 'no open issue';
  gh(['issue', 'close', String(open.number), '--comment',
    `Production is READY at ${short(r.production?.sha)} (${r.production?.url ?? r.production?.uid}) and not behind main — vercel-prod-watch passed at ${r.generated_at}. Closing.`]);
  return `closed #${open.number}`;
}

async function page(r, level) {
  const titles = {
    fail: `Vercel production: ${r.fails.map((f) => f.rule).join(' + ')}`,
    unknown: 'Vercel production watch UNKNOWN',
    ok: `Vercel production recovered: ${short(r.production?.sha)}`,
  };
  const body = level === 'fail' ? r.fails.map((f) => `${f.text}${f.first_error ? `\n${f.first_error}` : ''}`).join('\n')
    : level === 'unknown' ? `${r.unknown.join('\n')}\nTreat as not-clear until checked (#5708).`
      : 'Newest production build is READY and production is not behind main.';
  const res = await fetch(NTFY_TOPIC, {
    method: 'POST',
    headers: { Title: titles[level], Priority: level === 'ok' ? 'low' : level === 'fail' ? 'urgent' : 'high', Tags: 'rocket' },
    body, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

function readState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { level: 'ok', key: null }; } }
function writeState(s) { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s)); }

// ─────────────────────────────────────────── main

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const fixturePath = arg('--fixture');
  const DRY = argv.includes('--dry-run') || !!fixturePath;
  const JSON_OUT = argv.includes('--json');
  const now = arg('--now') ? new Date(arg('--now')) : new Date();
  if (Number.isNaN(now.getTime())) { console.error('--now must be an ISO timestamp'); process.exit(2); }

  if (!selfTest()) { console.error('SELF-TEST DID NOT FIRE — the judge is broken. Exit 2 (could not measure).'); process.exit(2); }

  let deployments, mainCommits;
  if (fixturePath) {
    const fx = JSON.parse(readFileSync(resolve(fixturePath), 'utf8'));
    // Replay: only what existed at --now.
    deployments = fx.deployments.filter((d) => (d.createdAt ?? d.created) <= now.getTime())
      .map((d) => (d.readyAt && d.readyAt > now.getTime() ? { ...d, readyState: 'BUILDING' } : d));
    mainCommits = fx.main_commits.filter((c) => Date.parse(c.date) <= now.getTime());
  } else {
    const token = process.env.VERCEL_TOKEN;
    if (!token) { console.error('UNKNOWN: VERCEL_TOKEN not set — source .env.production.local first. Exit 2.'); process.exit(2); }
    const inputs = buildInputsFromIgnoreCommand(JSON.parse(readFileSync(join(REPO, 'vercel.json'), 'utf8')).ignoreCommand);
    mainCommits = readMain(inputs, { fetchFirst: !argv.includes('--no-fetch') });
    const { projectId, teamId } = projectIds();
    const q = new URLSearchParams({ projectId, target: 'production', limit: String(DEPLOYMENT_LIMIT) });
    deployments = (await vercel(`/v6/deployments?${q}`, token, teamId)).deployments ?? [];
    // Name the error for the builds that will be reported: the newest failures, capped.
    let n = 0;
    for (const d of deployments) {
      const st = String(d.readyState ?? d.state).toUpperCase();
      if (st === 'READY') break;
      if ((st === 'ERROR' || st === 'CANCELED') && n++ < 5) d.errorLine = await firstErrorLine(d.uid, token, teamId);
    }
  }

  const r = judge(deployments, { mainCommits, now });
  const text = renderText(r);
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2)); else console.log(text);
  let exitCode = r.status === 'FAIL' ? 1 : r.status === 'UNKNOWN' ? 2 : 0;

  if (DRY) {
    console.error(`\n(dry run — nothing written.${exitCode === 1 ? ' Live, this would file/update the issue and page ntfy.' : ''})`);
    process.exit(exitCode);
  }

  const prev = readState();
  const level = exitCode === 1 ? 'fail' : exitCode === 2 ? 'unknown' : 'ok';
  const next = { level, key: r.incident_key ?? prev.key, at: r.generated_at };
  if (level !== 'unknown') {
    try {
      console.error(syncIssue(r, text, prev));
    } catch (e) {
      console.error(`GitHub issue step failed: ${String(e.stderr || e.message).split('\n')[0]}`);
      if (exitCode === 0) exitCode = 2;
      next.key = prev.key; // retry the comment next run
    }
  }
  if (level !== prev.level || (level === 'fail' && r.incident_key !== prev.key)) {
    try { await page(r, level); console.error(`paged ntfy: ${level}`); } catch (e) {
      console.error(`ntfy page failed (${e.message}); state left at ${prev.level} so the next run retries`);
      next.level = prev.level; next.key = prev.key;
    }
  }
  if (level === 'ok') next.key = null;
  writeState(next);
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  // An uncaught throw is an instrument failure (2), never a finding (1).
  main().catch((e) => { console.error(`vercel-prod-watch could not run: ${e.message}`); process.exit(2); });
}
