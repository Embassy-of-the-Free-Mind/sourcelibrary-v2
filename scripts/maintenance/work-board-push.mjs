#!/usr/bin/env node
/**
 * Work board pusher (/admin/work, #5705): what the headless Claude jobs on each box are doing,
 * which died, and which issue each one reports to — one `ops_reports` document per box.
 *
 * PRIOR ART: scripts/maintenance/daily-digest.mjs (PR #5445, branch job-daily-digest, unmerged) —
 * collects claude-job tmux sessions + logs touched in 24 h for a once-a-day text message; it cannot
 * tell done from dead (never reads *.done, GAVE UP, BLOCKED), links no issue or PR, and writes no
 * document a page can read. `/root/bin/claude-job.sh status` prints tmux sessions + log tails for a
 * human at a shell. src/lib/spend-report.ts / quality-report.ts are the pattern followed: the box
 * writes one ops_reports document, the admin page renders it and needs no deploy to refresh.
 *
 * Two modes, both every 10 min from cron:
 *   --box <name>   on EACH job box (main Hetzner, cloudlayer). Reads the box's claude-job.sh for its
 *                  paths (SL / LOGD / JD / WT), then per job: tmux session alive, <name>.done,
 *                  <name>.BLOCKED.md / <name>.outbox, the wrapper's GAVE UP line, last activity
 *                  (log + the session transcript), issues and PRs it reports to; plus live chain-*.sh
 *                  scripts and what each waits for. Upserts {_id:'work-board:<box>', type:'work-board'}.
 *   --github       on the main box only (it has gh). For every issue the boxes' jobs report to (and
 *                  issues labelled `in-flight`, if that label exists): title, state, last comment time
 *                  + its first line (the verdict line), decision lines, linked PRs (tier label, checks).
 *                  Upserts {_id:'work-board:github', type:'work-board', box:'github'}.
 *   --dry-run      print the document, write nothing.
 *
 * Privacy: a brief is stored as its FIRST LINE only, clipped; every stored string goes through
 * redact(). No env, no paths beyond job names. Nothing else reads these documents — the page is the
 * only consumer, so a write here actuates nothing.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/work-board-push.mjs --box hetzner
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/work-board-push.mjs --github
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
export const COLLECTION = 'ops_reports';
/** Jobs whose last activity is older than this are left out (running/blocked are always kept). */
export const WINDOW_DAYS = 7;
/** --github also sweeps open issues whose last comment (this recent) asks for a decision. */
export const RECENT_DECISION_HOURS = 48;
const TRANSCRIPT_CAP_BYTES = 40 * 1024 * 1024;

// ───────────────────────────────────────────── pure helpers (unit-tested)

const SECRET_RES = [
  /mongodb(?:\+srv)?:\/\/\S+/gi,
  /\b(?:sk|pk|rk)[-_](?:live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=\S+/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/g,
];
/** Strip anything shaped like a credential; collapse whitespace; clip. */
export function redact(s, max = 240) {
  if (typeof s !== 'string') return '';
  let out = s;
  for (const re of SECRET_RES) out = out.replace(re, '[redacted]');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

/** First non-empty line, markdown heading/bold markers stripped, redacted. */
export function firstLine(text, max = 240) {
  if (typeof text !== 'string') return '';
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  return redact(line.replace(/^#+\s*/, '').replace(/\*\*|__/g, ''), max);
}

/** SL / LOGD / JD / WT as claude-job.sh sets them (first assignment wins, $VAR expanded). */
export function parseJobScriptPaths(src) {
  const vars = {};
  for (const m of src.matchAll(/(?:^|[;\s])(SL|LOGD|WT|JD)=("?)([^\s;"]+)\2/gm)) {
    if (m[1] in vars) continue;
    vars[m[1]] = m[3].replace(/\$\{?(\w+)\}?/g, (_, v) => vars[v] ?? '');
  }
  return vars;
}

/**
 * The issues a job reports to, most specific first: the number its name ends in (`tengyur-ref-5497`),
 * the issue its brief names most (only if named twice — one-off mentions are background reading),
 * and any issue the job itself opened (`gh issue create` output in its transcript).
 */
export function reportsTo({ name, brief = '', createdIssues = [] }) {
  const out = [];
  const add = n => { const v = Number(n); if (v > 0 && !out.includes(v)) out.push(v); };
  const m = name.match(/-(\d{3,5})[a-z]?$/);
  if (m) add(m[1]);
  const counts = new Map();
  for (const x of brief.matchAll(/#(\d{3,5})\b/g)) counts.set(x[1], (counts.get(x[1]) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked[0] && ranked[0][1] >= 2) add(ranked[0][0]);
  for (const n of createdIssues) add(n);
  return out.slice(0, 4);
}

/** Issue and PR numbers this job CREATED, from the raw transcript (gh prints the bare URL). */
export function createdFromTranscript(raw) {
  const esc = REPO.replace(/[/-]/g, c => '\\' + c);
  const issues = [], prs = [];
  const re = new RegExp(`"(?:stdout|content)":"https://github\\.com/${esc}/(issues|pull)/(\\d+)(?:\\\\n)?"`, 'g');
  for (const m of raw.matchAll(re)) {
    const list = m[1] === 'issues' ? issues : prs;
    const n = Number(m[2]);
    if (!list.includes(n)) list.push(n);
  }
  return { issues, prs };
}

/** The wrapper's own lines in a job log: exits, resumes, DONE, GAVE UP, worktree reaping. */
export function parseWrapperLog(tail) {
  const lines = tail.split('\n');
  const wrapper = lines.filter(l => l.startsWith('[claude-job]'));
  const last = wrapper[wrapper.length - 1] ?? '';
  let resumes = 0, maxResumes = null;
  for (const l of wrapper) {
    const r = l.match(/resume (\d+)\/(\d+)/);
    if (r) { resumes = Number(r[1]); maxResumes = Number(r[2]); }
    if (/manual resume/.test(l)) resumes = 0;
  }
  const gaveUp = wrapper.some(l => /GAVE UP/.test(l)) && !wrapper.slice(wrapper.findLastIndex(l => /GAVE UP/.test(l))).some(l => /DONE|manual resume/.test(l));
  const said = [...lines].reverse().find(l => l.trim() && !l.startsWith('[claude-job]')) ?? '';
  // `exit N` of the last claude run. An empty log has none: the process was killed before it wrote a word.
  const ex = [...wrapper].reverse().map(l => l.match(/\] exit (\d+)/)).find(Boolean);
  return {
    last_wrapper_line: redact(last, 160), resumes, max_resumes: maxResumes, gave_up: gaveUp,
    exit_code: ex ? Number(ex[1]) : null, last_said: redact(said, 240),
  };
}

/**
 * One job's state. A live tmux session is running (a BLOCKED/outbox marker written during this run
 * makes it blocked). Otherwise: a done file is done unless a marker is newer; GAVE UP is gave-up; a
 * marker is blocked; anything else stopped without a done file — dead.
 */
export function jobState({ tmuxAlive, doneAt, blockedAt, startedAt, gaveUp }) {
  if (tmuxAlive) return blockedAt && (!startedAt || blockedAt >= startedAt) ? 'blocked' : 'running';
  if (doneAt && !(blockedAt && blockedAt > doneAt)) return 'done';
  if (gaveUp) return 'gave-up';
  if (blockedAt) return 'blocked';
  return 'dead';
}

/** A chain script's plan: which jobs' .done files it waits on, which jobs it starts. */
export function parseChainScript(src) {
  const starts = [...new Set([...src.matchAll(/claude-job\.sh\s+start\s+([\w.-]+)/g)].map(m => m[1]))];
  const waits = [...new Set([...src.matchAll(/([\w.-]+)\.done\b/g)].map(m => m[1]))].filter(n => !/[$*]/.test(n));
  const comment = src.split('\n').find(l => /^#\s*\S/.test(l) && !l.startsWith('#!')) ?? '';
  return { waits_for: waits, starts, about: redact(comment.replace(/^#\s*/, ''), 200) };
}

const LEAD = String.raw`^(?:[-*>]\s*|\d+[.)]\s*|#+\s*)*(?:\*\*|__)?\s*`;
const DECISION_RES = [
  new RegExp(LEAD + String.raw`(?:flip\b|decision\s*(?:\d+\s*)?(?:needed|for derek|[:?—–-])|decide\b)`, 'i'),
  /\brecommended default\b/i,
  /\bdefault\s*[:=]\s*\**\s*(?:yes|no|keep|flip|run|merge|hold|ship|go|stop|[A-Z])/i,
  /^\s*\d+[.)].*\bdefault\s+(?:yes|no)\b/i,
];
/** A decision already taken and written down ("Decision (Derek, 2026-10-01): …") is not waiting on anyone. */
const RECORDED_RE = /\(Derek,|\bDerek\s*(?:[:—–]|said|decided|approved|chose|answered|replied|picked)|\bDerek's (?:decision|answer)\b|\bdecided\b/i;
/** Lines in a comment that ask Derek to decide. Each: the line (clipped) and its default, if stated. */
export function decisionLines(body) {
  if (typeof body !== 'string') return [];
  const out = [];
  let fenced = false;
  for (const raw of body.split('\n')) {
    if (/^\s*```/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const l = raw.trim();
    if (!l || RECORDED_RE.test(l) || !DECISION_RES.some(re => re.test(l))) continue;
    const plain = l.replace(/\*\*|__/g, '');
    const d = plain.match(/recommended default\s*(?:[:=]|is)?\s*([^.;|()?]{1,80})/i)
      ?? plain.match(/\bdefault\s*[:=]\s*([^.;|()?]{1,80})/i)
      ?? plain.match(/\bdefault\s+(yes|no)\b/i);
    out.push({ line: redact(plain.replace(/^[-*>#\s]+/, ''), 240), default: d ? redact(d[1], 80) : null });
    if (out.length >= 5) break;
  }
  return out;
}

/** GitHub's check rollup → one word. */
export function checksWord(state) {
  switch (state) {
    case 'SUCCESS': return 'green';
    case 'FAILURE': case 'ERROR': return 'red';
    case 'PENDING': case 'EXPECTED': return 'pending';
    default: return state ? String(state).toLowerCase() : 'none';
  }
}

// ───────────────────────────────────────────── box side

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 64 * 1024 * 1024, ...opts });
}
const mtime = p => { try { return fs.statSync(p).mtime; } catch { return null; } };
const readTail = (p, bytes = 64 * 1024) => {
  try {
    const fd = fs.openSync(p, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - buf.length));
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
};
const maxDate = (...ds) => ds.filter(Boolean).reduce((a, b) => (!a || b > a ? b : a), null);

function tmuxSessions() {
  try {
    const out = sh('tmux', ['ls', '-F', '#{session_name} #{session_created}']);
    return new Map(out.split('\n').filter(Boolean).map(l => { const [n, t] = l.split(' '); return [n, new Date(Number(t) * 1000)]; }));
  } catch { return new Map(); } // no server running = no sessions
}

/** Claude Code keeps a session's transcript under ~/.claude/projects/<cwd with / and . as ->. */
function transcriptDir(worktree) {
  return path.join(os.homedir(), '.claude', 'projects', worktree.replace(/[/.]/g, '-'));
}

function readTranscripts(dir, since) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f)); } catch { return { last: null, raw: '' }; }
  let last = null, raw = '', budget = TRANSCRIPT_CAP_BYTES;
  for (const f of files) {
    const st = fs.statSync(f);
    last = maxDate(last, st.mtime);
    if (since && st.mtime < since) continue;
    if (st.size > budget) continue;
    budget -= st.size;
    raw += fs.readFileSync(f, 'utf8');
  }
  return { last, raw };
}

function collectChains(JD) {
  let ps = '';
  try { ps = sh('ps', ['-eo', 'pid=,lstart=,args=']); } catch { return []; }
  const out = [];
  for (const line of ps.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (!m) continue;
    const args = m[3];
    const script = args.split(/\s+/).find(a => /chain[^/\s]*\.sh$/.test(a));
    if (!script || !/^(?:\/bin\/)?(?:ba)?sh\b|^\/usr\/bin\/(?:ba)?sh\b/.test(args)) continue;
    let cwd = JD;
    try { cwd = fs.readlinkSync(`/proc/${m[1]}/cwd`); } catch { /* gone */ }
    const file = path.resolve(cwd, script);
    let plan = { waits_for: [], starts: [], about: '' };
    try { plan = parseChainScript(fs.readFileSync(file, 'utf8')); } catch { /* unreadable */ }
    const logFile = file.replace(/\.sh$/, '.log');
    const tail = readTail(logFile, 4096).split('\n').filter(Boolean);
    out.push({
      name: path.basename(file, '.sh'),
      pid: Number(m[1]),
      started: new Date(m[2]),
      about: plan.about,
      waits_for: plan.waits_for.map(n => ({ job: n, done: fs.existsSync(path.join(JD, `${n}.done`)) })),
      starts: plan.starts,
      last_line: redact(tail[tail.length - 1] ?? '', 200),
      last_activity: mtime(logFile),
    });
  }
  return out;
}

export function collectBox({ box, jobScript = '/root/bin/claude-job.sh', now = new Date() }) {
  const P = parseJobScriptPaths(fs.readFileSync(jobScript, 'utf8'));
  const { LOGD, JD, WT } = P;
  if (!LOGD || !JD || !WT) throw new Error(`could not read SL/LOGD/JD/WT from ${jobScript}`);
  const sessions = tmuxSessions();
  const names = new Set();
  for (const f of fs.readdirSync(JD)) { const m = f.match(/^(.+)\.brief\.txt$/); if (m) names.add(m[1]); }
  for (const s of sessions.keys()) if (s.startsWith('job-')) names.add(s.slice(4));
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * 86400_000);
  const jobs = [];
  for (const name of [...names].sort()) {
    const briefPath = path.join(JD, `${name}.brief.txt`);
    const logPath = path.join(LOGD, `${name}.log`);
    const wt = path.join(WT, `job-${name}`);
    const tmuxAlive = sessions.has(`job-${name}`);
    const doneAt = mtime(path.join(JD, `${name}.done`));
    const blockedAt = maxDate(
      mtime(path.join(JD, `${name}.BLOCKED.md`)), mtime(path.join(JD, `${name}.outbox`)),
      mtime(path.join(wt, 'BLOCKED.md')),
    );
    const logM = mtime(logPath);
    const briefM = mtime(briefPath);
    // Cheap pre-filter before reading transcripts: nothing touched in the window and not running.
    const quickLast = maxDate(logM, briefM, doneAt, blockedAt);
    const tdir = transcriptDir(wt);
    const tdirM = mtime(tdir);
    if (!tmuxAlive && !blockedAt && maxDate(quickLast, tdirM) < cutoff) continue;
    const { last: transcriptAt, raw } = readTranscripts(tdir, cutoff);
    const lastActivity = maxDate(quickLast, transcriptAt);
    if (!tmuxAlive && !blockedAt && lastActivity < cutoff) continue;
    let birth = null;
    try { const b = fs.statSync(logPath).birthtime; if (b.getTime() > 0) birth = b; } catch { /* no log */ }
    const started = sessions.get(`job-${name}`) ?? birth ?? briefM;
    const log = parseWrapperLog(readTail(logPath));
    let brief = '';
    try { brief = fs.readFileSync(briefPath, 'utf8'); } catch { /* none */ }
    const created = createdFromTranscript(raw);
    jobs.push({
      name,
      state: jobState({ tmuxAlive, doneAt, blockedAt, startedAt: started, gaveUp: log.gave_up }),
      started,
      last_activity: lastActivity,
      done_at: doneAt,
      blocked_at: blockedAt,
      brief_first_line: firstLine(brief, 200),
      reports_to: reportsTo({ name, brief, createdIssues: created.issues }),
      prs: created.prs.slice(-3),
      resumes: log.resumes,
      max_resumes: log.max_resumes,
      exit_code: log.exit_code,
      last_wrapper_line: log.last_wrapper_line,
      last_said: log.last_said,
    });
  }
  return {
    _id: `work-board:${box}`,
    type: 'work-board',
    box,
    generated_at: now,
    generated_by: 'scripts/maintenance/work-board-push.mjs',
    host: os.hostname(),
    window_days: WINDOW_DAYS,
    jobs,
    chains: collectChains(JD),
  };
}

// ───────────────────────────────────────────── github side

const ISSUE_FIELDS = `number title state url
  comments(last: 10) { nodes { createdAt url body author { login } } }
  timelineItems(last: 25, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) { nodes {
    ... on CrossReferencedEvent { source { ... on PullRequest { PRFIELDS } } }
    ... on ConnectedEvent { subject { ... on PullRequest { PRFIELDS } } }
  } }`;
const PR_FIELDS = `number title state url updatedAt mergedAt headRefName labels(first: 15) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

function gql(query) {
  const out = sh('gh', ['api', 'graphql', '-f', `query=${query}`], { timeout: 120_000 });
  const j = JSON.parse(out);
  if (j.errors?.length && !j.data) throw new Error(j.errors.map(e => e.message).join('; '));
  return j.data;
}

export function shapePr(p) {
  if (!p?.number) return null;
  const labels = (p.labels?.nodes ?? []).map(l => l.name);
  return {
    number: p.number,
    title: redact(p.title, 160),
    state: p.state,
    url: p.url,
    updated_at: p.updatedAt ?? null,
    merged_at: p.mergedAt ?? null,
    tier: labels.find(l => l.startsWith('tier:')) ?? null,
    blocked: labels.includes('blocked'),
    checks: checksWord(p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
  };
}

export function shapeIssue(i) {
  const nodes = i.comments?.nodes ?? [];
  const c = nodes[nodes.length - 1] ?? null;
  const prs = new Map();
  for (const n of i.timelineItems?.nodes ?? []) {
    const pr = shapePr(n?.source ?? n?.subject);
    if (pr) prs.set(pr.number, pr);
  }
  // A PR that names the issue in its title is the issue's own; one that only mentions it in passing sorts after.
  const own = p => (new RegExp(`#${i.number}\\b`).test(p.title) ? 1 : 0);
  const sorted = [...prs.values()].sort((a, b) => own(b) - own(a) || String(b.updated_at).localeCompare(String(a.updated_at)));
  return {
    number: i.number,
    title: redact(i.title, 200),
    state: i.state,
    url: i.url,
    last_comment: c ? { at: c.createdAt, url: c.url, first_line: firstLine(c.body), author: c.author?.login ?? null } : null,
    // First lines only: the page picks the comment a job wrote during its own run as that job's verdict.
    recent_comments: nodes.map(x => ({ at: x.createdAt, url: x.url, first_line: firstLine(x.body) })),
    decisions: c ? decisionLines(c.body) : [],
    prs: sorted.slice(0, 5),
  };
}

export async function collectGithub(db, now = new Date()) {
  const boxes = await db.collection(COLLECTION).find({ type: 'work-board', box: { $ne: 'github' } }).toArray();
  const issueNums = new Set(), prNums = new Set();
  for (const b of boxes) for (const j of b.jobs ?? []) {
    for (const n of j.reports_to ?? []) issueNums.add(n);
    for (const n of j.prs ?? []) prNums.add(n);
  }
  let inFlight = [];
  try {
    inFlight = JSON.parse(sh('gh', ['issue', 'list', '--repo', REPO, '--label', 'in-flight', '--state', 'open', '--json', 'number', '--limit', '50'])).map(x => x.number);
  } catch { /* label does not exist */ }
  for (const n of inFlight) issueNums.add(n);

  const issueFields = ISSUE_FIELDS.replaceAll('PRFIELDS', PR_FIELDS);
  const issues = {}, prs = {}, errors = [];
  const nums = [...issueNums];
  for (let k = 0; k < nums.length; k += 15) {
    const chunk = nums.slice(k, k + 15);
    const q = `{ repository(owner: "${REPO.split('/')[0]}", name: "${REPO.split('/')[1]}") { ${chunk.map(n => `i${n}: issueOrPullRequest(number: ${n}) { ... on Issue { ${issueFields} } ... on PullRequest { ${PR_FIELDS} } }`).join('\n')} } }`;
    try {
      const d = gql(q).repository;
      for (const n of chunk) {
        const x = d[`i${n}`];
        if (!x) continue;
        if (x.comments) issues[n] = shapeIssue(x);
        else { const p = shapePr(x); if (p) prs[n] = p; } // a job that "reports to" a PR number
      }
    } catch (e) { errors.push(`issues ${chunk.join(',')}: ${redact(String(e.message), 200)}`); }
  }
  // Decisions are not only posted by tracked jobs: chat sessions and the other box post them too. One
  // search over open issues touched in the last 48 h; only those whose LAST comment asks something are kept.
  const recent = [];
  try {
    const since = new Date(now.getTime() - RECENT_DECISION_HOURS * 3600_000).toISOString().slice(0, 10);
    const q = `{ search(type: ISSUE, first: 60, query: "repo:${REPO} is:issue is:open updated:>=${since} sort:updated-desc") { nodes { ... on Issue { ${issueFields} } } } }`;
    for (const x of gql(q).search.nodes ?? []) {
      if (!x?.number || issues[x.number]) continue;
      const shaped = shapeIssue(x);
      if (!shaped.decisions.length) continue;
      if (Date.parse(shaped.last_comment.at) < now.getTime() - RECENT_DECISION_HOURS * 3600_000) continue;
      issues[x.number] = shaped;
      recent.push(x.number);
    }
  } catch (e) { errors.push(`recent decisions: ${redact(String(e.message), 200)}`); }

  const prList = [...prNums].filter(n => !prs[n]);
  for (let k = 0; k < prList.length; k += 25) {
    const chunk = prList.slice(k, k + 25);
    const q = `{ repository(owner: "${REPO.split('/')[0]}", name: "${REPO.split('/')[1]}") { ${chunk.map(n => `p${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join('\n')} } }`;
    try {
      const d = gql(q).repository;
      for (const n of chunk) { const p = shapePr(d[`p${n}`]); if (p) prs[n] = p; }
    } catch (e) { errors.push(`prs ${chunk.join(',')}: ${redact(String(e.message), 200)}`); }
  }
  return {
    _id: 'work-board:github',
    type: 'work-board',
    box: 'github',
    generated_at: now,
    generated_by: 'scripts/maintenance/work-board-push.mjs --github',
    host: os.hostname(),
    in_flight_label: inFlight,
    recent_decision_issues: recent,
    issues,
    prs,
    errors,
  };
}

// ───────────────────────────────────────────── main

async function main() {
  const argv = process.argv.slice(2);
  const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dry = argv.includes('--dry-run');
  const github = argv.includes('--github');
  const box = arg('--box');
  if (!github && !box) { console.error('usage: work-board-push.mjs --box <name> | --github [--dry-run]'); process.exit(2); }
  if (!process.env.MONGODB_URI && (github || !dry)) { console.error('MONGODB_URI not set — use node --env-file=…/.env.production.local'); process.exit(2); }

  let client = null, db = null;
  if (process.env.MONGODB_URI) {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
    await client.connect();
    db = client.db('bookstore');
  }
  try {
    const doc = github ? await collectGithub(db) : collectBox({ box, jobScript: arg('--job-script') ?? '/root/bin/claude-job.sh' });
    if (dry) { console.log(JSON.stringify(doc, null, 2)); return; }
    const { _id, ...rest } = doc;
    await db.collection(COLLECTION).replaceOne({ _id }, rest, { upsert: true });
    const summary = github
      ? `${Object.keys(doc.issues).length} issues, ${Object.keys(doc.prs).length} prs, ${doc.errors.length} errors`
      : `${doc.jobs.length} jobs (${['running', 'blocked', 'dead', 'gave-up', 'done'].map(s => `${doc.jobs.filter(j => j.state === s).length} ${s}`).join(', ')}), ${doc.chains.length} chains`;
    console.log(`[work-board] ${new Date().toISOString()} ${_id}: ${summary}`);
  } finally {
    await client?.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error(`[work-board] ${new Date().toISOString()} FAILED: ${e.stack || e}`); process.exit(1); });
}
