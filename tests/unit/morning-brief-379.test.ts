/**
 * The morning brief and the LOG SILENT red line (#379). Each rule read both ways:
 * - LOG SILENT: the FT nightly of 2026-11-13..15 (two daily lines, one log, last write 11-13 13:35Z) goes red 24 h
 *   after that write and stays green before; a weekly line 13 days quiet, a monthly line 40 days quiet, a quiet-ok
 *   line, a paused row and a line whose log does not exist yet stay green.
 * - the brief: needs-you takes DECISIONS-PENDING rows first with their default, fills from job questions, never
 *   sends a security row's default; broke names each owner or says NO OWNER, unowned first, policy flags counted
 *   apart; fine reads yesterday in books where books are the unit; the send runs at 07 Amsterdam in both seasons.
 */
import { describe, it, expect } from 'vitest';
import { cronMaxGapMin, judgeCronLine, logSilent, LOG_QUIET_OK, cronRowFor } from '../../scripts/lib/lanes.mjs';
import { pipelineLines } from '../../scripts/maintenance/pipeline-now-push.mjs';
import {
  briefOf, formatBrief, localHour, parseOpenDecisionRows, shortDefault, summarize, who, SENSITIVE,
} from '../../scripts/maintenance/situation.mjs';

const FT_LOG = '/root/ft-batches/nightly.log';
const ftCmd = (acct: string) => `export PATH=/usr/local/bin:/usr/bin:/bin; cd /root/ft-code && git fetch -q origin main && git reset -q --hard origin/main && ENV_FILE=/root/sourcelibrary/.env.production.local FT_CAPW=70 FT_PARALLEL=6 sh scripts/ft-search/nightly.sh /root/.claude-${acct} ${acct}@sourcelibrary.org 1500 >> ${FT_LOG} 2>&1`;
const CRONTAB = [
  `30 1 * * * ${ftCmd('team')}`,
  `30 13 * * * ${ftCmd('derek')}`,
  '40 7 * * 1 cd /root/sourcelibrary && node scripts/audit/hold-release-check.mjs >> /var/log/sourcelibrary/hold-release-check.log 2>&1',
  '0 5 1 * * cd /root/sourcelibrary && node scripts/audit/page-integrity-draw.mjs >> /var/log/sourcelibrary/page-integrity.log 2>&1',
  '*/10 * * * * /root/sourcelibrary/scripts/catalog-coverage/archive-lanes-revive.sh >> /var/log/sourcelibrary/archive-lanes-revive.log 2>&1',
].join('\n') + '\n';

const LAST_FT_WRITE = '2026-11-13T13:35:00Z';
const logs: Record<string, string | null> = {
  [FT_LOG]: LAST_FT_WRITE,
  '/var/log/sourcelibrary/hold-release-check.log': '2026-11-02T07:41:00Z',
  '/var/log/sourcelibrary/page-integrity.log': '2026-10-01T05:02:00Z',
  '/var/log/sourcelibrary/archive-lanes-revive.log': '2026-10-26T09:30:01Z',
};
const silentAt = (now: string, logAtOf = (p: string) => logs[p] ?? null) =>
  (pipelineLines(CRONTAB, { box: 'hetzner', now: new Date(now), logAtOf }) as { script: string; schedule: string; red: { flag: string; why: string }[] }[])
    .filter((r) => r.red.some((x) => x.flag === 'LOG SILENT')).map((r) => `${r.schedule} ${r.script}`);

describe('LOG SILENT (#379)', () => {
  it('a log shared by two lines is due on the union of their schedules', () => {
    expect(cronMaxGapMin('30 13 * * *')).toBe(1440);
    expect(cronMaxGapMin(['30 1 * * *', '30 13 * * *'])).toBe(720);
    expect(cronMaxGapMin(['0 5 1 * *'])).toBe(31 * 1440);
  });

  it('the FT nightly of 2026-11-13..15 is green before 24 h of silence and red after, on both lines', () => {
    expect(silentAt('2026-11-14T13:00:00Z')).toEqual([]);
    const red = silentAt('2026-11-14T14:00:00Z');
    expect(red).toEqual(['30 1 * * * scripts/ft-search/nightly.sh', '30 13 * * * scripts/ft-search/nightly.sh']);
    // Still red when the stall alarm paged (11-15 02:54Z), 9 h before anyone restarted it by hand.
    expect(silentAt('2026-11-15T02:54:00Z')).toHaveLength(2);
  });

  it('judged alone, one daily line would have stayed green through the 42 h outage (why the log is shared)', () => {
    const line = { cmd: ftCmd('derek'), schedule: '30 13 * * *', script: 'scripts/ft-search/nightly.sh', stage: 'research' };
    expect(judgeCronLine('main', line, { now: new Date('2026-11-15T07:30:00Z'), logAt: LAST_FT_WRITE })).toEqual([]);
    expect(judgeCronLine('main', line, { now: new Date('2026-11-15T07:30:00Z'), logAt: LAST_FT_WRITE, logSchedules: ['30 1 * * *', '30 13 * * *'] })
      .map((r: { flag: string }) => r.flag)).toEqual(['LOG SILENT']);
  });

  it('weekly and monthly lines do not false-alarm inside two of their intervals', () => {
    // 2026-11-15: the weekly line last wrote 13 days ago, the monthly one 45 days ago; revive is quiet-ok.
    expect(silentAt('2026-11-15T13:00:00Z')).toEqual(['30 1 * * * scripts/ft-search/nightly.sh', '30 13 * * * scripts/ft-search/nightly.sh']);
    expect(logSilent({ cmd: 'x >> l', schedule: '40 7 * * 1' }, { now: new Date('2026-11-17T08:00:00Z'), logAt: '2026-11-02T07:41:00Z' })?.flag).toBe('LOG SILENT');
    expect(logSilent({ cmd: 'x >> l', schedule: '0 5 1 * *' }, { now: new Date('2026-12-03T00:00:00Z'), logAt: '2026-10-01T05:02:00Z' })?.flag).toBe('LOG SILENT');
  });

  it('a line with no log file yet, a paused row, a disabled line and a quiet-ok line are not judged', () => {
    const now = new Date('2026-11-15T13:00:00Z');
    expect(logSilent({ cmd: 'x >> l', schedule: '*/10 * * * *' }, { now, logAt: null })).toBeNull();
    expect(logSilent({ cmd: 'x >> l', schedule: '*/10 * * * *' }, { now, logAt: '2026-11-01T00:00:00Z', row: { status: 'paused' } })).toBeNull();
    expect(logSilent({ cmd: 'x >> l', schedule: '*/10 * * * *', disabled: true }, { now, logAt: '2026-11-01T00:00:00Z' })).toBeNull();
    for (const q of LOG_QUIET_OK as { match: string; reason: string }[]) {
      expect(q.reason.length).toBeGreaterThan(20);
      expect(logSilent({ cmd: `${q.match} >> l`, schedule: '*/5 * * * *' }, { now, logAt: '2026-11-01T00:00:00Z' })).toBeNull();
    }
  });

  it('the FT nightly and the brief lines have registry rows (an owner for the brief)', () => {
    expect(cronRowFor('hetzner', { cmd: ftCmd('team'), script: 'scripts/ft-search/nightly.sh', mode: null })?.id).toBe('main-ft-nightly');
    const brief = 'cd /root/sourcelibrary && node --env-file=.env.production.local scripts/maintenance/situation.mjs --brief --send --at-local=7';
    expect(cronRowFor('main', { cmd: brief, script: 'scripts/maintenance/situation.mjs', mode: null })?.id).toBe('main-morning-brief');
  });
});

// ── the brief

const NOW = Date.parse('2026-11-16T06:23:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const DP = `# Decisions pending

## Open (2026-11-15)

### Withhold the served English across the Hebrew manuscript cell, about 14,400 pages (v2#8632)
**Default: yes.** Hold the remaining 24 books.

### Four security steps from the 2026-11-12 audit (v3 #90)
**Default: yes to all four, in this order.** (1) Revoke anon writes on the 24 tables with RLS off.

### A row with no default (v3 #5)
Just prose.

## Done
### Old row (v3 #1)
**Default: no.**
`;

function fixture(extraJobs: Record<string, unknown>[] = []) {
  const reports = {
    'work-board:hetzner': {
      generated_at: iso(5),
      jobs: [
        { name: 'bath-sb-reads-2', state: 'dead', last_activity: iso(300), reports_to: [] },
        { name: 'bath-sb-reads-3', state: 'dead', last_activity: iso(290), reports_to: [] },
        { name: 'pecha-split-304', state: 'gave-up', last_activity: iso(200), reports_to: [304] },
        ...extraJobs,
      ],
      decisions: { unmarked: 2, oldest: '2026-11-13', jobs: ['wrong-page-149'], oldest_rows: [
        { day: '2026-11-13', job: 'wrong-page-149', text: 'withhold the 1,000 wrong-page pages now? — default: yes (#149)' },
      ] },
      alarm_log: [
        { id: 'a1', time: Math.round(NOW / 1000 - 3600), priority: 4, title: 'CI queue stuck: 106 queued, oldest 61 min', message: '' },
        { id: 'a2', time: Math.round(NOW / 1000 - 7200), priority: 4, title: 'Job GAVE UP: pecha-split-304 (hetzner)', message: '' },
        { id: 'a3', time: Math.round(NOW / 1000 - 7200), priority: 5, title: 'Crawler reading the library: 1 new', message: '' },
        { id: 'a4', time: Math.round(NOW / 1000 - 9000), priority: 4, title: 'cloudlayer / 85% full', message: 'Root disk at 85% (#6223)' },
      ],
    },
    'pipeline-now:hetzner': {
      generated_at: iso(20),
      lines: [
        { stage: 'research', script: 'scripts/ft-search/nightly.sh', schedule: '30 13 * * *', disabled: false, one_shot: false,
          registry: { id: 'main-ft-nightly', issue: 7598 }, red: [{ flag: 'LOG SILENT', why: 'log last written 37 h ago; it is due at least every 12 h' }] },
        { stage: 'qc', script: 'scripts/audit/convergent-audit-weekly.sh', schedule: '0 4 * * 0', disabled: false, one_shot: false,
          registry: { id: 'main-convergent-audit', issue: 6420 }, red: [{ flag: 'MATCHES A RETIRED PATTERN', why: 'single-page-qa' }] },
      ],
      agy_pools: [{ pool: 'default', weekly: 0.28 }, { pool: '.agy-james', weekly: 0.63 }],
    },
    'pipeline-now:corpus': {
      generated_at: iso(200),
      ocr_per_day: [{ day: '2026-11-15', lane: 'agy-flash-ocr', pages: 145366 }],
      translated_per_day: [{ day: '2026-11-15', lane: 'agy-flash-translate', pages: 18609 }],
      stalls: [{ edge: 'ft_search->ft_ingest', label: 'first-translation searches are not being ingested', stalled: true }],
      dial: { paused: false, daily_budget_usd: 0 },
    },
    'claude-limits:latest': { checked_at: iso(10), accounts: [
      { email: 'team@sourcelibrary.org', ok: true, limits: [{ key: 'weekly_all:all', percent: 89 }] },
      { email: 'someone123@gmail.com', ok: false, error: 'HTTP 400' },
    ] },
  };
  const ops = { dir: '/root/work/sourcelibrary-ops', ref: 'origin/main', openDecisions: [], openDecisionRows: parseOpenDecisionRows(DP) };
  return summarize({ reports, live: { rows: [] }, ops, snapshot: null }, { now: NOW, hours: 24 });
}
const extra = {
  day: '2026-11-15',
  handoffs: [{ day: '2026-11-15', enrich_books: 1088, ft_ingest: 781 }],
  qa: { books: 0, last: '2026-11-09' },
  done: { books: 1343, delta: 4 },
  spend: { day: '2026-11-15', paid_usd: 12.24, status: 'FAIL' },
};

describe('morning brief (#379)', () => {
  it('reads the Open rows with their default, not the Done ones', () => {
    const rows = parseOpenDecisionRows(DP);
    expect(rows.map((r: { title: string }) => r.title)).toEqual([
      'Withhold the served English across the Hebrew manuscript cell, about 14,400 pages (v2#8632)',
      'Four security steps from the 2026-11-12 audit (v3 #90)', 'A row with no default (v3 #5)',
    ]);
    expect(rows[0].default).toBe('yes.');
    expect(rows[2].default).toBeNull();
    expect(shortDefault('yes to all four, in this order. (1) more')).toBe('yes to all four, in this order');
  });

  it('needs you: three rows, triaged ones first, each with its default; a security default is not sent', () => {
    const b = briefOf(fixture(), extra);
    expect(b.needs.map((n: { ref: string }) => n.ref)).toEqual(['v2#8632', 'v3#90', 'v3#5']);
    expect(b.needs[0].default).toBe('yes');
    expect(b.needs[1].default).toMatch(/not sent/);
    expect(b.needs[2].default).toBe('no default stated');
    expect(formatBrief(b)).not.toMatch(/RLS|Revoke/);
    expect(SENSITIVE.test('Four security steps')).toBe(true);
    expect(SENSITIVE.test('Withhold the served English')).toBe(false);
  });

  it('needs you: job questions fill the list when fewer than three rows are open', () => {
    const s = fixture();
    s.ops.openDecisionRows = s.ops.openDecisionRows.slice(0, 1);
    const b = briefOf(s, extra);
    expect(b.needs).toHaveLength(2);
    expect(b.needs[1]).toMatchObject({ title: 'withhold the 1,000 wrong-page pages now?', default: 'yes', ref: '#149' });
  });

  it('broke: every item names its owner or says NO OWNER, unowned first; policy flags are counted, not listed', () => {
    const b = briefOf(fixture(), extra);
    const by = Object.fromEntries(b.broke.map((x: { what: string; owner: string | null }) => [x.what.split(' (')[0].slice(0, 40), x.owner]));
    expect(b.broke.findIndex((x: { owner: string | null }) => x.owner)).toBeGreaterThan(b.broke.findLastIndex((x: { owner: string | null }) => !x.owner));
    expect(by['main: 2 jobs dead']).toBeNull();
    expect(by['main: job pecha-split-304 gave-up']).toBe('#304');
    expect(b.broke.find((x: { what: string }) => x.what.includes('nightly LOG SILENT'))?.owner).toBe('#7598');
    expect(b.broke.find((x: { what: string }) => x.what.startsWith('stalled'))?.owner).toBe('#7598');
    expect(b.broke.find((x: { what: string }) => x.what.includes('85% full'))?.owner).toBe('#6223');
    expect(b.broke.find((x: { what: string }) => x.what.includes('unreadable'))?.what).toBe('Claude account someo@gmail unreadable');
    // The GAVE UP alarm is the stuck job's row; the crawler is watched, not broken; the retired pattern is policy.
    expect(b.broke.some((x: { what: string }) => /GAVE UP|Crawler|convergent/.test(x.what))).toBe(false);
    expect(b.watch).toEqual(['Crawler reading the library']);
    expect(b.policy_flags).toBe(1);
  });

  it('broke: a running job that names the item\'s issue is its owner', () => {
    const b = briefOf(fixture([{ name: 'ft-fix-7598', state: 'running', last_activity: iso(2), reports_to: [7598] }]), extra);
    expect(b.broke.find((x: { what: string }) => x.what.includes('LOG SILENT'))?.owner).toBe('job ft-fix-7598');
  });

  it('fine: yesterday per stage, books where books are the unit, no email address on a public topic', () => {
    const text = formatBrief(briefOf(fixture(), extra));
    const fine = text.split('\n').find((l: string) => l.startsWith('FINE'))!;
    expect(fine).toContain('FINE 11-15: OCR 145K pages, translated 19K pages, enriched 1,088 books, FT 781 books, QA 0 books (last 11-09), finished +4 books');
    expect(fine).toContain('agy week left: default 28%, james 63%');
    expect(fine).toContain('Claude week used: team 89%');
    expect(fine).toContain('paid 11-15: $12.24, dial $0/day');
    expect(text).not.toMatch(/@sourcelibrary\.org|@gmail\.com/);
    expect(who('derek@sourcelibrary.org')).toBe('derek');
  });

  it('fine: an unread source reads ?, never 0', () => {
    const fine = formatBrief(briefOf(fixture(), { day: '2026-11-15' })).split('\n').find((l: string) => l.startsWith('FINE'))!;
    expect(fine).toContain('enriched ? books, FT ? books, QA ? books, finished ? books');
    expect(fine).toContain('paid spend unread');
  });

  it('the 05:23Z and 06:23Z cron runs: exactly one is 07 in Amsterdam, in winter and in summer', () => {
    const tz = 'Europe/Amsterdam';
    expect([localHour(Date.parse('2026-11-16T05:23:00Z'), tz), localHour(Date.parse('2026-11-16T06:23:00Z'), tz)]).toEqual([6, 7]);
    expect([localHour(Date.parse('2027-06-16T05:23:00Z'), tz), localHour(Date.parse('2027-06-16T06:23:00Z'), tz)]).toEqual([7, 8]);
  });
});
