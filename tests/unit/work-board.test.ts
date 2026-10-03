/**
 * /admin/work (#5705): the rules that decide which section a job lands in. Fixtures are copied from
 * the real sources — claude-job.sh's own echo lines, a real chain script, a real issue comment
 * (#3825, 2026-10-03), and the transcript line `gh issue create` leaves — never written toward an answer.
 */
import { describe, it, expect } from 'vitest';
import {
  createdFromTranscript, decisionLines, firstLine, jobState, parseChainScript, parseJobScriptPaths,
  parseWrapperLog, redact, reportsTo,
} from '../../scripts/maintenance/work-board-push.mjs';
import { buildBoard, verdictFor, type BoxDoc, type GithubDoc, type BoxJob } from '@/lib/work-board';

const NOW = new Date('2026-10-03T12:00:00Z');
const h = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();

describe('work-board-push: box side', () => {
  it('reads the paths from claude-job.sh as written', () => {
    const src = 'set -u\nSL=/root/sourcelibrary\nLOGD=/var/log/sourcelibrary/claude-jobs; WT=$SL/.claude/worktrees; JD=/root/claude-jobs\nMAX_RESUMES=${MAX_RESUMES:-8}\n  local name="$1" d="$WT/job-$1" log="$LOGD/$1.log" why=""';
    expect(parseJobScriptPaths(src)).toEqual({
      SL: '/root/sourcelibrary', LOGD: '/var/log/sourcelibrary/claude-jobs', WT: '/root/sourcelibrary/.claude/worktrees', JD: '/root/claude-jobs',
    });
  });

  it('states: tmux alive is running; done file is done; GAVE UP; marker; else dead', () => {
    const t0 = new Date(h(5)), t1 = new Date(h(1));
    expect(jobState({ tmuxAlive: true, doneAt: null, blockedAt: null, startedAt: t0, gaveUp: false })).toBe('running');
    expect(jobState({ tmuxAlive: true, doneAt: null, blockedAt: t1, startedAt: t0, gaveUp: false })).toBe('blocked');
    // a BLOCKED note from an earlier run does not block the run that is live now
    expect(jobState({ tmuxAlive: true, doneAt: null, blockedAt: t0, startedAt: t1, gaveUp: false })).toBe('running');
    expect(jobState({ tmuxAlive: false, doneAt: t1, blockedAt: null, startedAt: t0, gaveUp: false })).toBe('done');
    expect(jobState({ tmuxAlive: false, doneAt: t0, blockedAt: t1, startedAt: t0, gaveUp: false })).toBe('blocked');
    expect(jobState({ tmuxAlive: false, doneAt: null, blockedAt: null, startedAt: t0, gaveUp: true })).toBe('gave-up');
    expect(jobState({ tmuxAlive: false, doneAt: null, blockedAt: null, startedAt: t0, gaveUp: false })).toBe('dead');
  });

  it('parses the wrapper lines claude-job.sh writes', () => {
    const gave = parseWrapperLog([
      'Final answer text.',
      '[claude-job] exit 0 2026-10-01T12:34:48Z',
      '[claude-job] resume 1/8 2026-10-01T13:09:44Z (no x.done)',
      '[claude-job] exit 1 2026-10-01T13:20:00Z',
      '[claude-job] GAVE UP after 8 resumes 2026-10-01T18:00:00Z',
    ].join('\n'));
    expect(gave).toMatchObject({ gave_up: true, resumes: 1, max_resumes: 8, exit_code: 1, last_said: 'Final answer text.' });
    const done = parseWrapperLog('ok\n[claude-job] exit 0 2026-10-03T10:59:50Z\n[claude-job] DONE 2026-10-03T10:59:54Z\n[claude-job] worktree removed (branch job-seam-ab-5678 kept) 2026-10-03T10:59:56Z');
    expect(done).toMatchObject({ gave_up: false, exit_code: 0 });
    // an empty log has no exit line: killed before it wrote anything
    expect(parseWrapperLog('').exit_code).toBeNull();
  });

  it('reports_to: the name\'s number, the brief\'s repeated issue, and an issue the job opened', () => {
    expect(reportsTo({ name: 'tengyur-ref-5497', brief: 'Reports ONLY as comments on GitHub issue #5497 + its PR. See #5676.' })).toEqual([5497]);
    expect(reportsTo({ name: 'greek-fit', brief: 'proposed on #5619. Claim on #5619. Read PR #5635.' })).toEqual([5619]);
    // one passing mention is background reading, not where the job reports
    expect(reportsTo({ name: 'work-board', brief: 'see #3661 for the lesson', createdIssues: [5705] })).toEqual([5705]);
  });

  it('finds the issue and PR a job created in its transcript', () => {
    const raw = '{"type":"tool_result","content":"https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5705","is_error":false}\n'
      + '{"toolUseResult":{"stdout":"https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/5710\\n","stderr":""}}\n'
      + '{"content":"see https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/3661 for why"}';
    expect(createdFromTranscript(raw)).toEqual({ issues: [5705], prs: [5710] });
  });

  it('reads a chain script: what it waits for, what it starts', () => {
    const src = `#!/bin/bash
# Chain: ref test done -> start quality arms; arms done -> start the full run. Gives up after 96h.
started_arms=0
for i in $(seq 1 1152); do
  if [ $started_arms = 0 ] && [ -f /root/claude-jobs/tengyur-ref-5497.done ]; then
    /root/bin/claude-job.sh start tengyur-arms-5497 /root/claude-jobs/tengyur-arms-5497.txt; started_arms=1
  fi
  if [ -f /root/claude-jobs/tengyur-arms-5497.done ]; then
    /root/bin/claude-job.sh start tengyur-complete-5497 /root/claude-jobs/tengyur-complete-5497.txt; exit 0
  fi
  sleep 300
done`;
    expect(parseChainScript(src)).toMatchObject({
      waits_for: ['tengyur-ref-5497', 'tengyur-arms-5497'],
      starts: ['tengyur-arms-5497', 'tengyur-complete-5497'],
    });
  });

  it('never stores a credential', () => {
    expect(redact('MONGODB_URI=mongodb+srv://u:p@x.net/db and ghp_abcdefghijklmnopqrstuvwxyz123456')).not.toMatch(/mongodb\+srv|ghp_/);
    expect(firstLine('\n\n## **Answer: mostly the MODEL.** rest\nsecond')).toBe('Answer: mostly the MODEL. rest');
  });
});

describe('work-board-push: decision lines', () => {
  it('finds the open question and its default in a real comment', () => {
    const body = '**Flip the default translation prompt to v16? NO. Recommended default: keep v13.** v16 fails its own pre-registered rule.\n\n| arm | notes |\n|---|---|';
    expect(decisionLines(body)).toEqual([expect.objectContaining({ default: 'keep v13' })]);
    expect(decisionLines('1. Merge #5692 — default yes')[0].default).toBe('yes');
  });

  it('ignores decisions already taken and prose that only mentions one', () => {
    expect(decisionLines('Decision (Derek, 2026-10-01): honour Vatican robots.txt Crawl-delay 10')).toEqual([]);
    expect(decisionLines('Decision 2, Derek: "default".')).toEqual([]);
    expect(decisionLines('Decision clauses for E')).toEqual([]);
    // matches the decision shape, but Derek already answered it (wording from the greek-fit brief)
    expect(decisionLines('**Decision:** Derek said yes 2026-10-02 to the full fitting run (~15 h CPU, $0).')).toEqual([]);
    expect(decisionLines('Recommended default: keep v13 — Derek: "keep v13", 2026-10-03')).toEqual([]);
    expect(decisionLines('```\ndefault: yes\n```')).toEqual([]);
  });
});

function job(p: Partial<BoxJob> & { name: string }): BoxJob {
  return { state: 'done', started: h(3), last_activity: h(1), done_at: h(1), brief_first_line: '', reports_to: [], prs: [], ...p };
}
function box(jobs: BoxJob[], extra: Partial<BoxDoc> = {}): BoxDoc {
  return { _id: 'work-board:hetzner', type: 'work-board', box: 'hetzner', generated_at: h(0.05), jobs, chains: [], ...extra };
}
function github(issues: GithubDoc['issues'] = {}): GithubDoc {
  return { _id: 'work-board:github', type: 'work-board', box: 'github', generated_at: h(0.1), issues, prs: {}, errors: [] };
}

describe('buildBoard', () => {
  it('a missing or silent pusher reads red, not as a quiet board', () => {
    const b = buildBoard([box([], { generated_at: h(1) }), github()], NOW);
    const by = Object.fromEntries(b.freshness.map(f => [f.source, f]));
    expect(by.hetzner.stale).toBe(true);
    expect(by.cloudlayer).toMatchObject({ age_min: null, stale: true });
    expect(by.github.stale).toBe(false);
  });

  it('a dead job replaced by a later job on the same issue is counted, not listed', () => {
    const b = buildBoard([box([
      job({ name: 'tengyur-5497', state: 'dead', started: h(10), last_activity: h(9), done_at: null, reports_to: [5497] }),
      job({ name: 'tengyur-5497b', state: 'done', started: h(8), reports_to: [5497] }),
      job({ name: 'translate-ab-5606', state: 'dead', started: h(10), last_activity: h(9), done_at: null, reports_to: [5606] }),
    ]), github()], NOW);
    expect(b.dead.map(d => d.name)).toEqual(['translate-ab-5606']);
    expect(b.hidden.superseded).toBe(1);
  });

  it('a running job gone quiet is stuck; a chain waiting on a dead job will never fire', () => {
    const b = buildBoard([box([
      job({ name: 'greek-fit', state: 'running', started: h(15), last_activity: h(3), done_at: null }),
      job({ name: 'arms', state: 'dead', started: h(2), last_activity: h(1.5), done_at: null }),
    ], { chains: [{ name: 'chain-x', started: h(4), about: '', waits_for: [{ job: 'ref', done: true }, { job: 'arms', done: false }], starts: ['arms', 'full'], last_line: '', last_activity: h(2) }] }), github()], NOW);
    expect(b.dead.find(d => d.name === 'greek-fit')?.state).toBe('stuck');
    expect(b.dead.find(d => d.name === 'chain-x')?.why).toMatch(/waits for arms, which died/);
    expect(b.running).toEqual([]);
  });

  it('a finished job\'s verdict is the comment it wrote, not the next job\'s claim', () => {
    const issue = {
      number: 5497, title: 'Tengyur', state: 'OPEN', url: 'u', decisions: [], prs: [],
      last_comment: { at: h(0.1), url: 'c3', first_line: 'taking the quality arms (Hetzner job tengyur-arms-5497)' },
      recent_comments: [
        { at: h(2.5), url: 'c1', first_line: 'taking this' },
        { at: h(1.05), url: 'c2', first_line: 'Verdict: run the full Tengyur with arm B' },
        { at: h(0.1), url: 'c3', first_line: 'taking the quality arms (Hetzner job tengyur-arms-5497)' },
      ],
    };
    const ref = job({ name: 'tengyur-ref-5497', started: h(3), done_at: h(1), reports_to: [5497] });
    expect(verdictFor(ref, issue)?.url).toBe('c2');
    const b = buildBoard([box([ref, job({ name: 'tengyur-arms-5497', state: 'running', started: h(0.12), last_activity: h(0.01), done_at: null, reports_to: [5497] })]), github({ 5497: issue })], NOW);
    expect(b.finished[0]).toMatchObject({ name: 'tengyur-ref-5497', verdict: 'Verdict: run the full Tengyur with arm B', verdict_url: 'c2' });
    expect(b.running[0]).toMatchObject({ name: 'tengyur-arms-5497', what: 'Tengyur' });
  });

  it('waiting on you lists open issues whose last comment asks, newest first', () => {
    const mk = (n: number, at: string, state = 'OPEN') => ({
      number: n, title: `t${n}`, state, url: `u${n}`, prs: [],
      last_comment: { at, url: `c${n}`, first_line: '' }, decisions: [{ line: 'Flip?', default: 'no' }],
    });
    const b = buildBoard([box([]), github({ 1: mk(1, h(5)), 2: mk(2, h(1)), 3: mk(3, h(1), 'CLOSED') })], NOW);
    expect(b.waiting.map(w => w.issue.number)).toEqual([2, 1]);
  });
});
