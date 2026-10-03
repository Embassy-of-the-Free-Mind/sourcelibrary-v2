/**
 * Work in flight (/admin/work, #5705): what the headless Claude jobs are doing, which died, and what is
 * waiting on Derek. Answers "is anything waiting on me, and is anything dead?" in one screen.
 *
 * PRIOR ART: src/lib/quality-report.ts / src/lib/spend-report.ts — read ops_reports documents for an
 * admin page (the pattern followed). Neither reads job state. The documents are written by
 * scripts/maintenance/work-board-push.mjs: one per job box (`--box`) and one for GitHub (`--github`).
 *
 * buildBoard() is pure over those documents and the clock, so the page computes nothing else and the
 * section rules are pinned by tests/unit/work-board.test.ts.
 */
import { getDb } from '@/lib/mongodb';

export const WORK_BOARD_TYPE = 'work-board';
/** Boxes that should be pushing. A missing one reads as "no data", red — never as a quiet board. */
export const EXPECTED_SOURCES = ['hetzner', 'cloudlayer', 'github'] as const;
/** A pusher runs every 10 min; older than this and its data is called stale, in red. */
export const STALE_MIN = 30;
/** A running job whose log and transcript have not moved for this long is listed as stuck. */
export const QUIET_MIN = 60;
/** Dead jobs older than this are counted, not listed: Derek looks several times a day. */
export const DEAD_WINDOW_H = 36;
export const FINISHED_WINDOW_H = 24;

export type JobState = 'running' | 'done' | 'dead' | 'blocked' | 'gave-up';

export interface BoxJob {
  name: string;
  state: JobState;
  started: Date | string | null;
  last_activity: Date | string | null;
  done_at?: Date | string | null;
  blocked_at?: Date | string | null;
  brief_first_line: string;
  reports_to: number[];
  prs: number[];
  resumes?: number;
  max_resumes?: number | null;
  exit_code?: number | null;
  last_said?: string;
}

export interface BoxChain {
  name: string;
  started: Date | string;
  about: string;
  waits_for: { job: string; done: boolean }[];
  starts: string[];
  last_line: string;
  last_activity: Date | string | null;
}

export interface BoxDoc {
  _id: string;
  type: typeof WORK_BOARD_TYPE;
  box: string;
  generated_at: Date | string;
  jobs: BoxJob[];
  chains: BoxChain[];
}

export interface GhPr {
  number: number; title: string; state: string; url: string;
  tier: string | null; blocked: boolean; checks: string; merged_at: string | null;
}
export interface GhIssue {
  number: number; title: string; state: string; url: string;
  last_comment: { at: string; url: string; first_line: string } | null;
  recent_comments?: { at: string; url: string; first_line: string }[];
  decisions: { line: string; default: string | null }[];
  prs: GhPr[];
}
export interface GithubDoc {
  _id: string;
  type: typeof WORK_BOARD_TYPE;
  box: 'github';
  generated_at: Date | string;
  issues: Record<string, GhIssue>;
  prs: Record<string, GhPr>;
  errors: string[];
}

export type WorkBoardDoc = BoxDoc | GithubDoc;

export async function getWorkBoardDocs(): Promise<WorkBoardDoc[]> {
  const db = await getDb();
  return (await db.collection('ops_reports').find({ type: WORK_BOARD_TYPE }).toArray()) as unknown as WorkBoardDoc[];
}

// ───────────────────────────────────────────── the board

export interface Freshness { source: string; generated_at: string | null; age_min: number | null; stale: boolean }
export interface IssueRef { number: number; title: string | null; url: string; closed: boolean }
export interface PrRef { number: number; url: string; state: string | null; tier: string | null; checks: string | null; blocked: boolean }

export interface WaitingItem { issue: IssueRef; line: string; default: string | null; url: string; at: string }
export interface DeadItem {
  kind: 'job' | 'chain';
  name: string; box: string; state: JobState | 'stuck';
  why: string; at: string | null; issue: IssueRef | null;
}
export interface RunningItem {
  kind: 'job' | 'chain';
  name: string; box: string; started: string | null; last_activity: string | null;
  what: string; issue: IssueRef | null;
}
export interface FinishedItem {
  name: string; box: string; at: string | null; verdict: string; issue: IssueRef | null; pr: PrRef | null;
}
export interface Board {
  freshness: Freshness[];
  waiting: WaitingItem[];
  dead: DeadItem[];
  running: RunningItem[];
  finished: FinishedItem[];
  /** Dead jobs left off the list because a later job took over the same issue, or they are old. */
  hidden: { superseded: number; older: number; closed: number };
  errors: string[];
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);
const REPO_URL = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';

function issueRef(n: number | undefined, gh: GithubDoc | null): IssueRef | null {
  if (!n) return null;
  const i = gh?.issues?.[String(n)];
  return { number: n, title: i?.title ?? null, url: i?.url ?? `${REPO_URL}/issues/${n}`, closed: i?.state === 'CLOSED' };
}
function prRef(n: number, gh: GithubDoc | null, issue?: GhIssue): PrRef {
  const p = gh?.prs?.[String(n)] ?? issue?.prs?.find(x => x.number === n);
  return { number: n, url: p?.url ?? `${REPO_URL}/pull/${n}`, state: p?.state ?? null, tier: p?.tier ?? null, checks: p?.checks ?? null, blocked: p?.blocked ?? false };
}

/** Why a job is on the dead list, in words Derek can act on. */
export function deadReason(j: BoxJob): string {
  if (j.state === 'gave-up') return `gave up after ${j.max_resumes ?? j.resumes ?? '?'} resumes, no done file`;
  if (j.state === 'blocked') return 'wrote a BLOCKED / outbox note — needs an answer';
  if (j.exit_code == null) return 'killed before it wrote a word (empty log), no done file';
  if (j.exit_code === 0) return 'exited without its done file';
  return `exited ${j.exit_code} without its done file`;
}

type Placed = BoxJob & { box: string };

/** Grace after the done file for the report comment, which some jobs post just after touching it. */
const VERDICT_GRACE_MS = 15 * 60_000;
/**
 * A finished job's verdict: the LAST comment on its issue written during its own run. The issue's
 * latest comment is often a later job's claim ("taking the quality arms…"), not this job's answer.
 */
export function verdictFor(j: BoxJob, i: GhIssue | undefined, nextStart = Infinity): { first_line: string; url: string } | null {
  if (!i) return null;
  const from = ms(j.started), to = Math.min(ms(j.done_at ?? j.last_activity) + VERDICT_GRACE_MS, nextStart);
  const list = i.recent_comments?.length ? i.recent_comments : i.last_comment ? [i.last_comment] : [];
  // A claim ("taking this …") opens a run; it is never the answer.
  const mine = list.filter(c => ms(c.at) >= from && ms(c.at) < to && !/^taking\b/i.test(c.first_line));
  return mine[mine.length - 1] ?? null;
}

export function buildBoard(docs: WorkBoardDoc[], now: Date = new Date()): Board {
  const t = now.getTime();
  const gh = (docs.find(d => d.box === 'github') as GithubDoc | undefined) ?? null;
  const boxes = docs.filter((d): d is BoxDoc => d.box !== 'github');

  const sources = [...new Set([...EXPECTED_SOURCES, ...docs.map(d => d.box)])];
  const freshness: Freshness[] = sources.map(source => {
    const d = docs.find(x => x.box === source);
    const at = iso(d?.generated_at);
    const age = at ? Math.max(0, Math.round((t - ms(at)) / 60_000)) : null;
    return { source, generated_at: at, age_min: age, stale: age == null || age > STALE_MIN };
  });

  const jobs: Placed[] = boxes.flatMap(b => (b.jobs ?? []).map(j => ({ ...j, box: b.box })));
  const live = new Set<JobState>(['running', 'done', 'blocked']);
  /** A later job on the same issue that ran or is running took over from this one. */
  const supersededBy = (j: Placed) => jobs.find(o =>
    o !== j && live.has(o.state) && ms(o.started) > ms(j.started) &&
    o.reports_to?.some(n => j.reports_to?.includes(n)));

  // 1. Waiting on you
  const waiting: WaitingItem[] = [];
  for (const i of Object.values(gh?.issues ?? {})) {
    if (i.state !== 'OPEN' || !i.last_comment || !i.decisions?.length) continue;
    for (const d of i.decisions) {
      waiting.push({ issue: { number: i.number, title: i.title, url: i.url }, line: d.line, default: d.default, url: i.last_comment.url, at: i.last_comment.at });
    }
  }
  waiting.sort((a, b) => ms(b.at) - ms(a.at));

  // 2. Dead or stuck
  const dead: DeadItem[] = [];
  const hidden = { superseded: 0, older: 0, closed: 0 };
  for (const j of jobs) {
    if (j.state === 'dead' || j.state === 'gave-up' || j.state === 'blocked') {
      if (j.state !== 'blocked' && supersededBy(j)) { hidden.superseded++; continue; }
      const ref = issueRef(j.reports_to?.[0], gh);
      if (j.state !== 'blocked' && ref?.closed) { hidden.closed++; continue; }
      if (j.state !== 'blocked' && t - ms(j.last_activity) > DEAD_WINDOW_H * 3600_000) { hidden.older++; continue; }
      dead.push({ kind: 'job', name: j.name, box: j.box, state: j.state, why: deadReason(j), at: iso(j.blocked_at ?? j.last_activity), issue: ref });
    } else if (j.state === 'running' && t - ms(j.last_activity) > QUIET_MIN * 60_000) {
      const quiet = Math.round((t - ms(j.last_activity)) / 60_000);
      dead.push({ kind: 'job', name: j.name, box: j.box, state: 'stuck', why: `running, but no log or transcript activity for ${quiet >= 120 ? `${Math.round(quiet / 60)} h` : `${quiet} min`}`, at: iso(j.last_activity), issue: issueRef(j.reports_to?.[0], gh) });
    }
  }
  const byName = new Map(jobs.map(j => [`${j.box}:${j.name}`, j]));
  for (const b of boxes) for (const c of b.chains ?? []) {
    const blocker = c.waits_for.find(w => !w.done && ['dead', 'gave-up'].includes(byName.get(`${b.box}:${w.job}`)?.state ?? ''));
    if (blocker) {
      dead.push({ kind: 'chain', name: c.name, box: b.box, state: 'stuck', why: `waits for ${blocker.job}, which ${byName.get(`${b.box}:${blocker.job}`)?.state === 'gave-up' ? 'gave up' : 'died'} — will never fire`, at: iso(c.last_activity), issue: null });
    } else if (/gave up/i.test(c.last_line)) {
      dead.push({ kind: 'chain', name: c.name, box: b.box, state: 'gave-up', why: c.last_line, at: iso(c.last_activity), issue: null });
    }
  }
  const rank = { blocked: 0, 'gave-up': 1, stuck: 2, dead: 3, running: 4, done: 5 } as Record<string, number>;
  dead.sort((a, b) => rank[a.state] - rank[b.state] || ms(b.at) - ms(a.at));

  // 3. Running
  const stuck = new Set(dead.filter(d => d.kind === 'job').map(d => `${d.box}:${d.name}`));
  const running: RunningItem[] = jobs
    .filter(j => j.state === 'running' && !stuck.has(`${j.box}:${j.name}`))
    .sort((a, b) => ms(b.started) - ms(a.started))
    .map(j => {
      const issue = issueRef(j.reports_to?.[0], gh);
      return { kind: 'job' as const, name: j.name, box: j.box, started: iso(j.started), last_activity: iso(j.last_activity), what: issue?.title || j.brief_first_line, issue };
    });
  for (const b of boxes) for (const c of b.chains ?? []) {
    if (dead.some(d => d.kind === 'chain' && d.box === b.box && d.name === c.name)) continue;
    const next = c.waits_for.find(w => !w.done);
    const what = next ? `waits for ${next.job} → then starts ${c.starts[c.waits_for.indexOf(next)] ?? c.starts[c.starts.length - 1] ?? '—'}` : c.about;
    running.push({ kind: 'chain', name: c.name, box: b.box, started: iso(c.started), last_activity: iso(c.last_activity), what, issue: null });
  }

  // 4. Finished recently
  const finished: FinishedItem[] = jobs
    .filter(j => j.state === 'done' && t - ms(j.done_at ?? j.last_activity) <= FINISHED_WINDOW_H * 3600_000)
    .sort((a, b) => ms(b.done_at ?? b.last_activity) - ms(a.done_at ?? a.last_activity))
    .map(j => {
      const n = j.reports_to?.[0];
      const i = n ? gh?.issues?.[String(n)] : undefined;
      // Stop at the next job on the same issue: what it posts is its own, not this job's verdict.
      const next = Math.min(...jobs.filter(o => o !== j && ms(o.started) > ms(j.started) && n != null && o.reports_to?.includes(n)).map(o => ms(o.started)));
      const v = verdictFor(j, i, next);
      const prN = j.prs?.length ? j.prs[j.prs.length - 1] : i?.prs?.[0]?.number;
      return { name: j.name, box: j.box, at: iso(j.done_at ?? j.last_activity), verdict: v?.first_line || j.last_said || '', verdict_url: v?.url ?? null, issue: issueRef(n, gh), pr: prN ? prRef(prN, gh, i) : null };
    });

  return { freshness, waiting, dead, running, finished, hidden, errors: gh?.errors ?? [] };
}

/** "4 min", "3 h", "2 d" — relative, so the page never prints a timezone. */
export function ago(at: string | null, now: Date = new Date()): string {
  if (!at) return '—';
  const m = Math.max(0, Math.round((now.getTime() - ms(at)) / 60_000));
  if (m < 60) return `${m} min`;
  const h = m / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}
