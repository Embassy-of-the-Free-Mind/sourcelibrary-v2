/**
 * `situation` (#368): each new line read both ways from fixture reports — a lane that wrote and one that is
 * silent, a job that is working and one that is QUIET, an ops checkout behind and one level, a STANDING alarm
 * and a new one, a box with unmarked DECISION lines and one without, the stage line with a STALLED and a BROKEN
 * stage. Report shapes are copied from live ops_reports rows of 2026-11-15 (gex45 pipeline-now, cloudlayer
 * work-board, the 2026-11-14 stage snapshot), trimmed to the fields read.
 */
import { describe, it, expect } from 'vitest';
import {
  alarmKey, corpusRate, cronMaxGapMin, format, groupAlarms, jobClock, laneSummary, parseOpenDecisions, summarize,
} from '../../scripts/maintenance/situation.mjs';
import { heartbeatAt, mergeAlarmLog, summarizeDecisions } from '../../scripts/maintenance/work-board-push.mjs';
import { untriagedDecisions } from '../../scripts/maintenance/ntfy-morning-digest.mjs';

const NOW = Date.parse('2026-11-15T00:40:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const sec = (hAgo: number) => Math.round(NOW / 1000 - hAgo * 3600);

const lane = (o: Record<string, unknown>) => ({ stage: 'ocr', disabled: false, one_shot: false, mode: 'run', red: [], ...o });
const pnGex45 = {
  generated_at: iso(10),
  lines: [
    lane({ script: 'scripts/batch/cli-ocr-lane.mjs', schedule: '50 * * * *', log: '/var/log/sourcelibrary/cli-ocr-first.log', log_at: iso(42) }),
    lane({ stage: 'translate', script: 'scripts/batch/cli-translate-lane.mjs', schedule: '40 * * * *', log: '/var/log/sourcelibrary/cli-translate-finish.log', log_at: iso(20) }),
    lane({ stage: 'import', script: 'scripts/catalog-coverage/archive-lanes-revive.sh', mode: null, schedule: '*/10 * * * *', log: '/var/log/sourcelibrary/archive-lanes-revive.log', log_at: '2026-10-26T09:30:01.200Z' }),
    lane({ script: 'scripts/batch/cli-ocr-lane.mjs', mode: 'armc-plan', schedule: '35 * * * *', disabled: true, log: '/var/log/sourcelibrary/cli-ocr-armc-first.log', log_at: '2026-11-04T12:22:38.796Z' }),
    lane({ stage: 'qc', script: 'scripts/audit/bph-access-probes.mjs', mode: null, schedule: '17 6 * * *', log: '/var/log/sourcelibrary/bph-access-probes.log', log_at: iso(18 * 60 + 23) }),
  ],
};

const job = (o: Record<string, unknown>) => ({ state: 'running', reports_to: [361], resumes: 0, last_said: '', ...o });
const alarm = (id: string, hAgo: number, title: string, priority = 4) => ({ id, time: sec(hAgo), priority, title, message: `${title} body` });

function fixtureReports() {
  return {
    'work-board:hetzner': {
      generated_at: iso(4),
      jobs: [job({ name: 'pecha-split-304', last_activity: iso(80), heartbeat_at: iso(70) })],
      decisions: { unmarked: 2, oldest: '2026-11-13', jobs: ['pr-sweep-361', 'wrong-page-149'], oldest_rows: [
        { day: '2026-11-13', job: 'wrong-page-149', text: 'withhold the 1,000 wrong-page pages now? — default: yes (#149)' },
        { day: '2026-11-14', job: 'pr-sweep-361', text: 'merge #185 without its dependency? — default: no (#361)' },
      ] },
      // Root disk paged yesterday 10:46 and 22:22, again 2 h ago; the CI queue is new tonight.
      alarm_log: [
        alarm('a1', 14, 'Root disk 13% free: hetzner'),
        alarm('a2', 2.3, 'Job refused, root disk 13% free: bath-sb-reads-2 (hetzner)'),
        alarm('a3', 30, 'Job refused, root disk 12% free: siku-pilot (hetzner)'),
        alarm('a4', 1.2, 'CI queue stuck: 106 queued, oldest 61 min'),
      ],
    },
    'work-board:gex45': {
      generated_at: iso(3),
      jobs: [job({ name: 'pr-sweep-361', last_activity: iso(76), heartbeat_at: iso(0.5) })],
      decisions: { unmarked: 0, oldest: null, jobs: [], oldest_rows: [] },
    },
    'pipeline-now:gex45': pnGex45,
    'pipeline-now:corpus': {
      generated_at: '2026-11-14T02:50:02.769Z',
      ocr_per_day: [
        { day: '2026-11-13', lane: 'agy-flash-ocr', pages: 50000 }, { day: '2026-11-13', lane: 'claude-opus-ocr', pages: 501 },
        { day: '2026-11-14', lane: 'agy-flash-ocr', pages: 900 },
      ],
      translated_per_day: [{ day: '2026-11-13', lane: 'agy-flash-translate', pages: 10694 }],
      stalls: [],
    },
  };
}
const snapshot = {
  timestamp: new Date('2026-11-14T04:19:33.660Z'),
  stalled: ['images'],
  stages: [
    { stage: 'ocr', status: 'probe_broken', covered: null, total: null, queue_depth: null, delta: null },
    { stage: 'summaries', status: 'ok', covered: 25199, total: 71313, queue_depth: 46114, delta: 29 },
    { stage: 'images', status: 'ok', covered: 235714, total: 236908, queue_depth: 532, delta: 0 },
  ],
};
const opsLevel = { dir: '/root/work/sourcelibrary-ops', ref: 'origin/main', fetch_error: null, behind: 0, ahead: 0, runningAt: iso(30), openDecisions: ['Four security steps (v3 #90)'] };
const opsBehind = { ...opsLevel, dir: '/Users/derek/sourcelibrary-ops', behind: 68, ahead: 4 };

const run = (ops: Record<string, unknown> = opsLevel, live: Record<string, unknown> = { rows: [] }) =>
  format(summarize({ reports: fixtureReports(), live, ops, snapshot }, { now: NOW, hours: 12 }));

describe('situation: lanes (#368 item 1)', () => {
  it('reads a cron schedule as its longest gap between runs', () => {
    expect(cronMaxGapMin('*/10 * * * *')).toBe(10);
    expect(cronMaxGapMin('50 * * * *')).toBe(60);
    expect(cronMaxGapMin('10 */2 * * *')).toBe(120);
    expect(cronMaxGapMin('17 6 * * *')).toBe(1440);
    expect(cronMaxGapMin('*/10 9-17 * * *')).toBe(15 * 60 + 10);
    expect(cronMaxGapMin('20 7 * * 1')).toBe(7 * 1440);
    expect(cronMaxGapMin('0 5 1 * *')).toBe(31 * 1440);
    expect(cronMaxGapMin('@reboot')).toBeNull();
  });

  it('counts a lane that wrote, and names one silent past its schedule', () => {
    const s = laneSummary(pnGex45)!;
    expect(s.on).toBe(4); // the disabled line is not on
    expect(s.wrote_1h).toBe(2);
    expect(s.page_lanes_wrote_1h).toBe(2);
    expect(s.silent.map((x) => x.script)).toEqual(['scripts/catalog-coverage/archive-lanes-revive.sh']);
    const out = run();
    expect(out).toMatch(/lanes \(report 10m ago\): 4 on · 2 wrote in the hour before \(2 OCR\/translate\) · 1 silent/);
    expect(out).toMatch(/SILENT archive-lanes-revive\.sh .*'\*\/10 \* \* \* \*'.*last written 20d ago/);
    expect(out).not.toMatch(/SILENT cli-ocr-lane/);
    expect(out).not.toMatch(/SILENT bph-access-probes/); // daily, wrote 18 h ago: inside its gap
  });

  it('leaves an other line (a script no stage rule names) out of the lanes, silent or not (v3#428)', () => {
    const silentLine = pnGex45.lines.find((l: { script: string }) => l.script === 'scripts/catalog-coverage/archive-lanes-revive.sh')!;
    const s = laneSummary({ ...pnGex45, lines: [...pnGex45.lines, { ...silentLine, stage: 'other', script: 'scripts/workers/disk-alarm.sh' }] })!;
    expect(s.on).toBe(4);
    expect(s.silent.map((x) => x.script)).toEqual(['scripts/catalog-coverage/archive-lanes-revive.sh']);
  });

  it('prints the fleet pages per day from complete days only', () => {
    const r = corpusRate(fixtureReports()['pipeline-now:corpus'])!;
    expect(r.ocr).toEqual([{ day: '2026-11-13', pages: 50501 }]);
    expect(run()).toMatch(/pages per day, all lanes .*OCR 11-13 50,501; translated 11-13 10,694/);
  });
});

describe('situation: the job clock (#368 item 2)', () => {
  it('a job inside a long tool call is working: the heartbeat is the clock', () => {
    const c = jobClock({ last_activity: iso(76), heartbeat_at: iso(0.5) }, NOW);
    expect(c.quiet).toBe(false);
    expect(c.by).toBe('heartbeat');
    expect(run()).toMatch(/RUN {3}pr-sweep-361 .*active 1m ago \(heartbeat; log 76m\)/);
  });
  it('a job whose log and heartbeat are both past 45 min is QUIET', () => {
    expect(jobClock({ last_activity: iso(80), heartbeat_at: iso(70) }, NOW).quiet).toBe(true);
    expect(jobClock({ last_activity: iso(80), heartbeat_at: null }, NOW).quiet).toBe(true);
    const out = run();
    expect(out).toMatch(/RUN {3}pecha-split-304 .*QUIET 70m \(log 80m, heartbeat 70m\)/);
    expect(out).toMatch(/jobs: 1 running \(1 QUIET\)/);
  });
  it('reads the wrapper heartbeat file (epoch seconds), else its mtime', () => {
    expect(heartbeatAt('1763167000\n')?.toISOString()).toBe(new Date(1763167000 * 1000).toISOString());
    const m = new Date('2026-11-15T00:00:00Z');
    expect(heartbeatAt('garbage', m)).toBe(m);
  });
});

describe('situation: ops repo drift (#368 item 3)', () => {
  it('says a checkout is behind and has unpushed commits', () => {
    expect(run(opsBehind)).toMatch(/ops repo \/Users\/derek\/sourcelibrary-ops read from origin\/main {3}!! checkout 68 behind, 4 not pushed/);
  });
  it('says nothing about drift when the checkout is level', () => {
    const out = run(opsLevel);
    expect(out).toMatch(/ops repo \/root\/work\/sourcelibrary-ops read from origin\/main\n/);
    expect(out).not.toMatch(/behind/);
  });
  it('says a failed fetch rather than passing old files as current', () => {
    expect(run({ ...opsLevel, fetch_error: 'Could not resolve host' })).toMatch(/fetch FAILED: Could not resolve host; may be old/);
  });
  it('reads open decisions under "## Open" only', () => {
    expect(parseOpenDecisions('# D\n## Open\n### One (#1)\ntext\n### Two\n## Closed\n### Old\n')).toEqual(['One (#1)', 'Two']);
  });
});

describe('situation: job DECISION lines (#368 item 4)', () => {
  const txt = [
    '2026-10-10 | old-job | DECISION: predates marking — default: x (#1)',
    '[TRIAGED 2026-11-14 #90] 2026-11-12 | sweep | DECISION: marked already — default: y (#90)',
    '2026-11-13 | wrong-page-149 | DECISION: withhold? — default: yes (#149)',
    '2026-11-14 | pr-sweep-361 | DECISION: merge? — default: no (#361)',
    '2026-11-14 | pr-sweep-361 | DECISION: second — default: no (#361)',
  ].join('\n');
  it('summarizes the same rows the morning digest counts', () => {
    const d = summarizeDecisions(txt);
    expect(d.unmarked).toBe(untriagedDecisions(txt, '2026-11-15').total);
    expect(d).toMatchObject({ unmarked: 3, oldest: '2026-11-13', jobs: ['wrong-page-149', 'pr-sweep-361'] });
    expect(d.oldest_rows[0].text).toBe('withhold? — default: yes (#149)');
  });
  it('prints the count per box and the oldest rows; a box that has not pushed reads ?, not 0', () => {
    const out = run();
    expect(out).toMatch(/job DECISION lines nobody has marked .*: 2\+ · main 2 since 11-13, gex45 0, l7a \? \(not pushed\), cloudlayer \? \(not pushed\)/);
    expect(out).toMatch(/ {3}11-13 main wrong-page-149: withhold the 1,000 wrong-page pages now\?/);
  });
});

describe('situation: STANDING alarms (#368 item 5)', () => {
  it('folds one alarm across job names and percentages', () => {
    expect(alarmKey('Job refused, root disk 13% free: bath-sb-reads-2 (hetzner)')).toBe('Job refused, root disk #% free');
    expect(alarmKey('Job refused, root disk 12% free: siku-pilot (hetzner)')).toBe('Job refused, root disk #% free');
  });
  it('marks an alarm that also fired 12–48 h ago STANDING and lists it first; a new one is not', () => {
    const rows = fixtureReports()['work-board:hetzner'].alarm_log;
    const g = groupAlarms(rows, NOW, 12);
    expect(g.map((x) => [x.key, x.standing])).toEqual([
      ['Job refused, root disk #% free', true],
      ['CI queue stuck', false],
    ]);
    const out = run();
    const lines = out.split('\n');
    const i = lines.findIndex((l) => /STANDING since .*Job refused, root disk 13% free/.test(l));
    const j = lines.findIndex((l) => /CI queue stuck/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(lines[j]).not.toMatch(/STANDING/);
    expect(out).toMatch(/2 high, 1 STANDING/);
  });
  it('alarms print before the boxes', () => {
    const out = run();
    expect(out.indexOf('== alarms')).toBeLessThan(out.indexOf('== main'));
  });
  it('the live poll and the 48 h log are one row per message id', () => {
    const rows = fixtureReports()['work-board:hetzner'].alarm_log;
    const g = groupAlarms([...rows, ...rows], NOW, 12);
    expect(g.find((x) => x.key === 'CI queue stuck')!.count).toBe(1);
  });
  it('main keeps a rolling 48 h log: dedupes by id, drops what is older', () => {
    const now = new Date(NOW);
    const prev = [{ id: 'old', time: sec(50), priority: 4, title: 't', message: '' }, { id: 'keep', time: sec(20), priority: 4, title: 'k', message: '' }];
    const jsonl = [JSON.stringify({ id: 'keep', time: sec(20), event: 'message', title: 'k' }), JSON.stringify({ id: 'new', time: sec(1), event: 'message', title: 'n', priority: 5 }), JSON.stringify({ id: 'o', event: 'open', time: sec(0) })].join('\n');
    expect(mergeAlarmLog(prev, jsonl, now).map((r) => r.id)).toEqual(['keep', 'new']);
    expect(mergeAlarmLog(prev, '', now).map((r) => r.id)).toEqual(['keep']); // a failed poll keeps the log
  });
  it('says when there is no 48 h log rather than calling every alarm new', () => {
    const reports = fixtureReports() as Record<string, Record<string, unknown>>;
    delete reports['work-board:hetzner'].alarm_log;
    const out = format(summarize({ reports, live: { rows: [] }, ops: opsLevel, snapshot }, { now: NOW, hours: 12 }));
    expect(out).toMatch(/NO 48 h log .*STANDING cannot be told/);
  });
});

describe('situation: the stage snapshot line (#368 item 6)', () => {
  it('prints each stage with its change, STALLED and BROKEN ones marked', () => {
    const out = run();
    expect(out).toMatch(/stage snapshot 20h ago/);
    expect(out).toMatch(/ocr PROBE BROKEN · summaries 25,199\/71,313 \+29 \(queue 46,114\) · images 235,714\/236,908 \+0 \(queue 532\) STALLED/);
    expect(out).not.toMatch(/summaries [^·]*STALLED/);
  });
  it('shows a residue number when the snapshot carries one', () => {
    const snap = { ...snapshot, stalled: [], stages: [{ stage: 'images', status: 'ok', covered: 235714, total: 235714, queue_depth: 0, delta: 0, residue: 532 }] };
    const out = format(summarize({ reports: fixtureReports(), live: { rows: [] }, ops: opsLevel, snapshot: snap }, { now: NOW, hours: 12 }));
    expect(out).toMatch(/images 235,714\/235,714 \+0 \(residue 532 no worker takes\)/);
  });
  it('says when no snapshot is readable', () => {
    expect(format(summarize({ reports: fixtureReports(), live: { rows: [] }, ops: opsLevel, snapshot: null }, { now: NOW, hours: 12 }))).toMatch(/stage snapshot: none readable/);
  });
});
