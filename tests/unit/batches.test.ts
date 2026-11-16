/**
 * /admin/pipeline/batches (v3#269): the stage arithmetic, the blocker words, which lane reads a hold, and the shape
 * check the pusher runs before and after its write. Fixtures are shaped like the 2026-11-13 snapshot.
 */
import { describe, it, expect } from 'vitest';
import {
  assertShape, blockersOf, currentStage, isContained, issueRepo, lanesForHold, parseRoutes, routeHolds, sortBatches, stagesOf,
} from '../../scripts/lib/batches.mjs';
import { assembleRows, pickImageBatches } from '../../scripts/maintenance/batches-push.mjs';

const NOW = new Date('2026-11-13T19:00:00Z');

const row = (o: Record<string, unknown> = {}) => ({
  key: 'hold:x', kind: 'hold', name: 'x', books: 10, pages: 1000, read: 400, translated: 0, public_books: 0,
  images: { pages: 1000, as_of: '2026-11-13T18:00:00Z' }, moved_24h: { read: 0, translated: 0 }, not_acquired: false,
  hold: { reason: 'x', issue: 95, issue_repo: 'v3', held_since: '2026-11-13', release: 'when read', release_when: { kind: 'issue', ref: 95 }, release_issue_state: 'OPEN' },
  issue: { repo: 'v3', number: 95, state: 'OPEN' }, recent: [], campaigns: [], lanes: [], frames: [], decisions: [], books_list: [],
  ...o,
});

const ROUTES = [
  'on\tzh-histories-7546\tpaddle-zh\t7546\t/root/jobs/a\tzh-histories-7546\t3\tx',
  '# a comment',
  'off\tla-first-read-armc-7701\teuro-draft\t7701\t/root/jobs/b\tscans-only (FIRST_READ_HOLDS)\t2\tx',
  'on\tjcb-campaign-8049\teuro-draft\t8049\t/root/jobs/c\tjcb-1600-8049\t2\tx',
  'on\teuro-es19-6871\teuro-draft\t6871\t/root/jobs/d\tnone, or scans-only-publish-7270 (kept)\t2\tx',
  'off\tsanskrit-print-surya-95\tgpu-print\t95\t/root/jobs/e\tsanskrit-print-surya-lane (kept)\t3\tx',
].join('\n');

describe('stage arithmetic', () => {
  it('fills a full stage, part-fills the current one, leaves later ones empty', () => {
    const s = stagesOf(row());
    expect(s.map(x => x.key)).toEqual(['imported', 'images', 'read', 'translated', 'public']);
    expect(s.map(x => x.fill)).toEqual(['full', 'full', 'part', 'empty', 'empty']);
    expect(s[2].fraction).toBeCloseTo(0.4);
    expect(currentStage(row())).toBe('read');
  });

  it('counts a stage within the counter lag as full, and caps a counter above its denominator', () => {
    const s = stagesOf(row({ read: 996, translated: 1200 }));
    expect(s[2].fill).toBe('full');
    expect(s[3].fraction).toBe(1);
  });

  it('measures public in books, not pages', () => {
    const s = stagesOf(row({ public_books: 5 }));
    expect(s[4]).toMatchObject({ unit: 'books', of: 10, fill: 'part', fraction: 0.5 });
  });

  it('a batch with zero pages: every page stage empty, no NaN', () => {
    const s = stagesOf(row({ pages: 0, read: 0, translated: 0, images: { pages: 0, as_of: 'x' } }));
    expect(s.slice(0, 4).map(x => x.fill)).toEqual(['empty', 'empty', 'empty', 'empty']);
    for (const x of s) expect(Number.isNaN(x.fraction)).toBe(false);
  });

  it('an image count not yet measured says so instead of showing 0', () => {
    const s = stagesOf(row({ images: { pages: null, why: 'not yet measured' } }));
    expect(s[1]).toMatchObject({ count: null, fill: 'unknown' });
    expect(s[1].note).toBe('not measured: not yet measured');
  });
});

describe('blocker text', () => {
  it('a batch with no hold (a released campaign) says the router takes it, and names no owner problem', () => {
    const b = blockersOf(row({ kind: 'campaign', key: 'campaign:c', name: 'c', hold: null, issue: null }), { now: NOW });
    expect(b.map(x => x.text)).toEqual(['No hold: the router\'s lanes take these books like any other.']);
  });

  it('a batch whose lane is off: the lane in amber, then no owner in red', () => {
    const lanes = [{ name: 'sanskrit-print-surya-95', kind: 'gpu-route', box: 'gex45', issue: 95, state: 'off', why: 'switched off in ocr-filler-routes.tsv' }];
    const b = blockersOf(row({ lanes }), { now: NOW });
    expect(b[0]).toEqual({ tone: 'amber', text: 'Lane sanskrit-print-surya-95 (gex45): off. switched off in ocr-filler-routes.tsv' });
    expect(b[1]).toEqual({ tone: 'red', text: 'No owner: every lane that reads it is off, and no decision is asked.' });
    expect(b.at(-1)!.text).toBe('Held x since 2026-11-13; released when #95 closes. when read');
  });

  it('a decision for Derek comes first and replaces "no owner"', () => {
    const b = blockersOf(row({ decisions: [{ text: 'May we use Surya 2 weights?', default: 'no decision needed yet', url: 'u', source: 'issue comment' }] }), { now: NOW });
    expect(b[0]).toEqual({ tone: 'amber', text: 'Waiting on you: May we use Surya 2 weights? (default: no decision needed yet)', href: 'u' });
    expect(b.some(x => x.text.startsWith('No owner'))).toBe(false);
  });

  it('a hold with no lane and no decision has no owner', () => {
    const b = blockersOf(row(), { now: NOW });
    expect(b[0]).toEqual({ tone: 'red', text: 'No owner: no lane reads this hold and no decision is asked.' });
  });

  it('a lane that is on but moved nothing in 24 h is flagged; one that moved is not', () => {
    const lanes = [{ name: 'zh-shi-ji-8053', kind: 'gpu-route', box: 'gex45', issue: 8053, state: 'on', why: 'first on route' }];
    expect(blockersOf(row({ lanes }), { now: NOW }).some(x => x.text.startsWith('A lane is on but nothing'))).toBe(true);
    expect(blockersOf(row({ lanes, moved_24h: { read: 5, translated: 0 } }), { now: NOW }).some(x => x.text.startsWith('A lane is on but nothing'))).toBe(false);
  });

  it('says a release is due when its issue closed or its date passed', () => {
    const closed = blockersOf(row({ hold: { ...row().hold, release_issue_state: 'CLOSED' } }), { now: NOW });
    expect(closed).toContainEqual({ tone: 'red', text: 'Hold x: release is due: #95 is closed.' });
    const dated = blockersOf(row({ hold: { ...row().hold, issue_repo: 'v2', release_when: { kind: 'date', ref: '2026-10-24' } } }), { now: NOW });
    expect(dated).toContainEqual({ tone: 'red', text: 'Hold x: release was due on 2026-10-24.' });
  });

  it('the decision kind of release_when reads as a decision', () => {
    const b = blockersOf(row({ hold: { ...row().hold, release_when: { kind: 'decision', ref: 'release zh-shi-ji-8053' } } }), { now: NOW });
    expect(b.at(-1)!.text).toContain('released by decision "release zh-shi-ji-8053"');
  });
});

describe('lanes for a hold', () => {
  const routes = parseRoutes(ROUTES);
  it('parses the routes table in rank order with its holds', () => {
    expect(routes.map(r => r.route)).toEqual(['zh-histories-7546', 'la-first-read-armc-7701', 'jcb-campaign-8049', 'euro-es19-6871', 'sanskrit-print-surya-95']);
    expect(routes[3].holds).toEqual(['scans-only-publish-7270']);
    expect(routeHolds('gpu-backlog-5660,paddle-zh-5600-ocr-only,paddle-zh-6388-ocr-only')).toHaveLength(3);
  });
  it('off, queued and on, from the live off-list when given', () => {
    expect(lanesForHold('sanskrit-print-surya-lane', { routes })[0]).toMatchObject({ name: 'sanskrit-print-surya-95', state: 'off' });
    expect(lanesForHold('zh-histories-7546', { routes, offRoutes: new Set() })[0].state).toBe('on');
    expect(lanesForHold('jcb-1600-8049', { routes, offRoutes: new Set(['la-first-read-armc-7701']) })[0]).toMatchObject({ state: 'queued', why: expect.stringContaining('zh-histories-7546') });
    // gex45 lists only its off routes: one missing from that list is not on when the repo says off
    expect(lanesForHold('sanskrit-print-surya-lane', { routes, offRoutes: new Set() })[0].state).toBe('off');
    expect(lanesForHold('zh-histories-7546', { routes, offRoutes: new Set(['zh-histories-7546']) })[0]).toMatchObject({ state: 'off', why: expect.stringContaining('live') });
  });
  it('cron lanes by routes.hold, and the Siku translate lane off while its line is paused', () => {
    const lanes = [{ name: 'agy-flash-ocr', routes: { hold: 'ocr-flash-cli-7075' } }];
    const cronRows = [
      { id: 'main-cli-ocr-run', box: 'main', lane: 'agy-flash-ocr', issue: 7089, status: 'current' },
      { id: 'main-siku-translate', box: 'main', lane: 'agy-flash-translate', issue: 5600, status: 'paused', note: 'STOP file since 2026-10-30' },
      { id: 'gex45-cli-translate', box: 'gex45', lane: 'agy-flash-translate', issue: 7075, status: 'current' },
    ];
    expect(lanesForHold('ocr-flash-cli-7075', { lanes, cronRows })).toEqual([{ name: 'agy-flash-ocr', kind: 'cron', box: 'main', issue: 7089, state: 'on', why: 'cron main-cli-ocr-run' }]);
    expect(lanesForHold('gpu-backlog-5660', { lanes, cronRows, sikuHolds: ['gpu-backlog-5660'] })).toEqual([{ name: 'siku-translate', kind: 'cron', box: 'main', issue: 5600, state: 'off', why: 'STOP file since 2026-10-30' }]);
  });
});

describe('rows', () => {
  const g = (o: Record<string, unknown>) => ({ kind: 'hold', books: 100, pages: 1000, read: 0, translated: 0, public_books: 0, held_from_status: 0, held_since: new Date('2026-11-13'), issue: 95, release: 'r', release_when: { kind: 'issue', ref: 95 }, campaigns: [], list: [], frames: {}, ...o });
  it('rolls small containments into one row, keeps small imports and not-acquired holds as their own', () => {
    expect(isContained({ name: 'leak-contained-5026', books: 3, held_from_status: 3 })).toBe(true);
    expect(isContained({ name: 'markets-cli-reads', books: 5, held_from_status: 0 })).toBe(false);
    expect(isContained({ name: 'big', books: 34, held_from_status: 34 })).toBe(false);
    const rows = assembleRows([
      g({ name: 'a', books: 3, held_from_status: 3, issue: 5026, held_since: new Date('2026-10-01') }),
      g({ name: 'b', books: 4, held_from_status: 4, issue: 7947, held_since: new Date('2026-10-01') }),
      g({ name: 'imp', books: 5 }),
      g({ name: 'big', books: 900 }),
      { ...g({ name: 'small-campaign', books: 7 }), kind: 'campaign' },
    ]);
    expect(rows.map(r => r.key)).toEqual(['hold:big', 'hold:imp', 'contained']);
    const c = rows.at(-1)!;
    expect(c.books).toBe(7);
    expect(c.members!.map(m => m.reason)).toEqual(['b', 'a']);
    expect(c.members![0].issue_repo).toBe('v2');
    expect(assertShape({ _id: 'batches:latest', type: 'batches', generated_at: NOW, batches: rows }, { heldBooks: 912 })).toBe(true);
  });
  it('the shape check refuses a row that does not add up', () => {
    const rows = assembleRows([g({ name: 'big', books: 900 })]);
    expect(() => assertShape({ _id: 'b', type: 'batches', generated_at: NOW, batches: rows }, { heldBooks: 901 })).toThrow(/add up/);
    expect(() => assertShape({ _id: 'b', type: 'batches', generated_at: NOW, batches: [{ ...rows[0], public_books: 901 }] })).toThrow(/more public/);
    expect(() => assertShape({ _id: 'b', type: 'batches', generated_at: NOW, batches: [] })).toThrow(/no batches/);
  });
  it('issue repo: v2 before the move or past 1000, v3 after', () => {
    expect(issueRepo(95, new Date('2026-11-13'))).toBe('v3');
    expect(issueRepo(99, new Date('2026-10-01'))).toBe('v2');
    expect(issueRepo(8632, new Date('2026-11-13'))).toBe('v2');
    expect(issueRepo(null, null)).toBe(null);
  });
  it('sorts largest first, contained last', () => {
    expect(sortBatches([{ kind: 'contained', books: 99 }, { kind: 'hold', books: 1 }, { kind: 'campaign', books: 50 }]).map(r => r.kind)).toEqual(['campaign', 'hold', 'contained']);
  });
  it('picks never-measured batches first and stops at the budget', () => {
    const groups = [g({ name: 'old' }), g({ name: 'new' }), g({ name: 'never' })];
    const prev = new Map([['hold:old', { as_of: '2026-11-13T10:00:00Z', ms: 100_000 }], ['hold:new', { as_of: '2026-11-13T18:00:00Z', ms: 100_000 }]]);
    expect(pickImageBatches(groups, prev, 150).map(x => x.name)).toEqual(['never', 'old']);
    expect(pickImageBatches(groups, prev, 1, { full: true })).toHaveLength(3);
  });
});

describe('assembled lanes and decisions', () => {
  const routes = parseRoutes(ROUTES);
  const g = { kind: 'hold', name: 'scans-only-publish-7270', books: 100, pages: 1000, read: 0, translated: 0, public_books: 0, held_from_status: 0, held_since: new Date('2026-10-01'), issue: 7270, release: 'r', release_when: { kind: 'decision', ref: 'release scans-only-publish-7270' }, campaigns: [], list: [], frames: {} };
  it('a queued GPU route whose batch moved in 24 h is the one running', () => {
    const [r] = assembleRows([g], { laneCtx: { routes, offRoutes: new Set() }, moved: new Map([['hold:scans-only-publish-7270', { read: 829, translated: 0 }]]) });
    expect(r.lanes[0]).toMatchObject({ name: 'euro-es19-6871', state: 'on' });
    const [q] = assembleRows([g], { laneCtx: { routes, offRoutes: new Set() } });
    expect(q.lanes[0].state).toBe('queued');
  });
  it('names the hold\'s decision and the issue\'s DECISION lines without their lead and default', () => {
    const gh = new Map([['v2#7270', { state: 'OPEN', recent: [], decisions: [{ line: 'DECISION: May we use Surya 2 weights? — default: no decision needed until a route passes (#95)', default: 'no decision needed until a route passes', url: 'u', at: 'x' }] }]]);
    const [r] = assembleRows([g], { gh });
    expect(r.decisions.map(d => d.text)).toEqual(['the hold\'s release decision: "release scans-only-publish-7270"', 'May we use Surya 2 weights?']);
    expect(r.issue).toEqual({ repo: 'v2', number: 7270, state: 'OPEN' });
  });
});
