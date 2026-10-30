/**
 * #7089: the runner that drains the ocr-flash-cli-7075 hold (scripts/batch/cli-ocr-lane.mjs) — which books it must not
 * read with the plain prompt, the queue order, the routed → CLI model map, and the reader's quota stop.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { spreadReason, byQueueOrder, CLI_MODEL_FOR, perCallFor, quotaFloor, isInterior, lastPageNumber, correctMode, FALLBACK, CORRECT_MODEL, parseAgyHome, claimLive, claimBook, releaseBookClaim, liveReaderBooks, bookShard, parseShard, firstReadSkip, manuscriptReason, byFirstReadOrder, firstReadLanguage, FIRST_READ_BOOKS, FIRST_READ_HOLDS, FIRST_READ_LANE, FIRST_READ_MODEL, FIRST_READ_CORRECT_LANE } from '../../scripts/batch/cli-ocr-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { isApiOcrModel } from '../../scripts/lib/ocr-routing.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { quotaBuckets, parseQuota, agyEnv, choosePool } from '../../scripts/lib/agy-pools.mjs';
import os from 'os';

describe('spreadReason', () => {
  const cropped = [{ crop: { x: 0 } }, { cropped_photo: 'https://x/1.jpg' }];
  const bare = [{}, {}];
  it('holds back a needs_splitting book whatever its pages carry', () => {
    expect(spreadReason({ needs_splitting: true, pipeline_auto: { split_checked: true } }, cropped)).toMatch(/needs_splitting/);
  });
  it('holds back a book with no crop data that Phase 1.25 has not checked (#523)', () => {
    expect(spreadReason({}, bare)).toMatch(/#523/);
  });
  it('reads a split-checked single-page book and a cropped one', () => {
    expect(spreadReason({ pipeline_auto: { split_checked: true } }, bare)).toBeNull();
    expect(spreadReason({}, cropped)).toBeNull();
  });
});

describe('byQueueOrder', () => {
  it('priority first, then visible, then the oldest hold', () => {
    const books = [
      { id: 'old-hidden', processing_priority: 27, pipeline_auto: { hold: { held_at: '2026-10-21' } } },
      { id: 'new-hidden', processing_priority: 27, pipeline_auto: { hold: { held_at: '2026-10-25' } } },
      { id: 'visible', processing_priority: 27, visible: true, pipeline_auto: { hold: { held_at: '2026-10-26' } } },
      { id: 'urgent', processing_priority: 90, pipeline_auto: { hold: { held_at: '2026-10-26' } } },
      { id: 'none', pipeline_auto: { hold: { held_at: '2026-10-01' } } },
    ];
    expect(books.sort(byQueueOrder).map((b) => b.id)).toEqual(['urgent', 'visible', 'old-hidden', 'new-hidden', 'none']);
  });
});

describe('CLI_MODEL_FOR', () => {
  it('maps only CLI-channel models, and never to an API model', () => {
    for (const [routed, cli] of Object.entries(CLI_MODEL_FOR as Record<string, string>)) {
      expect(isApiOcrModel(routed)).toBe(false);
      expect(isApiOcrModel(cli)).toBe(false);
    }
  });
});

describe('the lane stops on quota instead of sleeping', () => {
  const lane = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr-lane.mjs'), 'utf8');
  const reader = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
  it('passes --stop-on-quota and stops the run on exit 3', () => {
    expect(lane).toContain("'--stop-on-quota'");
    // #7558: books read in parallel; exit 3 sets the shared stop that every worker checks before its next book.
    expect(lane).toMatch(/read === 3\) \{ stop \?\?= 'quota'/);
    expect(lane).toMatch(/while \(queue\.length && !stop\)/);
  });
  it('cli-ocr.mjs read exits 3 on a quota reply or a locked model before any sleep', () => {
    expect(reader).toMatch(/process\.exit\(3\)/);
    expect(reader.indexOf("r.not_called && STOP_ON_QUOTA")).toBeLessThan(reader.indexOf('if (r.not_called) { quotaUntil'));
    expect(reader.indexOf("r.cls === 'quota' && STOP_ON_QUOTA")).toBeLessThan(reader.indexOf("if (r.cls === 'quota') { quotaUntil"));
  });
});

describe('pages a call by script (#7558)', () => {
  const opts = { perCall: 4, perCallArabic: 2 };
  it('Latin-script books take --per-call, Arabic-script books --per-call-arabic', () => {
    expect(perCallFor({ language: 'German' }, opts)).toBe(4);
    expect(perCallFor({ language: 'Latin' }, opts)).toBe(4);
    expect(perCallFor({ language: 'Arabic' }, opts)).toBe(2);
    expect(perCallFor({ language: 'Persian' }, opts)).toBe(2);
  });
  it('every other script reads one page a call: no block test covered it', () => {
    for (const language of ['Sanskrit', 'Chinese', 'Greek', 'Tibetan', 'Judeo-Arabic', 'Hebrew']) expect(perCallFor({ language }, opts)).toBe(1);
  });
  it('defaults to one page a call', () => {
    expect(perCallFor({ language: 'German' })).toBe(1);
  });
});

describe('the correction lane quota floor (#7558)', () => {
  const now = Date.parse('2026-10-27T16:00:00Z');
  const reset = '2026-10-30T22:00:00Z'; // 3.25 days left: the pace line is 3.25 / 7 = 46.4%
  const b = (weekly: number, fiveH: number | null = 0.9) => [{ id: 'gemini-weekly', remaining_fraction: weekly, reset_time: reset }, ...(fiveH === null ? [] : [{ id: 'gemini-5h', remaining_fraction: fiveH, reset_time: '2026-10-27T20:00:00Z' }])];
  it('runs while the week is above the straight line to its reset', () => {
    const q = quotaFloor(b(0.63), { now });
    expect(q.ok).toBe(true);
    expect(q.line).toBeCloseTo(3.25 / 7, 3);
  });
  it('stops under the line', () => {
    expect(quotaFloor(b(0.45), { now }).ok).toBe(false);
  });
  it('stops when the 5-hour bucket is under its floor, so the other lanes keep their window', () => {
    expect(quotaFloor(b(0.63, 0.2), { now }).ok).toBe(false);
    expect(quotaFloor(b(0.63, 0.2), { now, floor5h: 0.1 }).ok).toBe(true);
  });
  it('--pace-off-until drops the pace line until that time, never the 5-hour floor', () => {
    const until = now + 3600_000;
    expect(quotaFloor(b(0.2), { now, paceOffUntil: until }).ok).toBe(true);
    expect(quotaFloor(b(0.2), { now: until + 1, paceOffUntil: until }).ok).toBe(false);
    expect(quotaFloor(b(0.2, 0.1), { now, paceOffUntil: until }).ok).toBe(false);
  });
  it('fails closed on an unreadable /quota', () => {
    expect(quotaFloor(null, { now }).ok).toBe(false);
    expect(quotaFloor([], { now }).ok).toBe(false);
    expect(quotaFloor(b(0.63, null), { now }).ok).toBe(false);
  });
});

describe('the Claude fallback of the correction lane (#7545)', () => {
  const now = Date.parse('2026-10-27T16:00:00Z');
  const reset = '2026-10-30T22:00:00Z';
  const b = (weekly: number) => [{ id: 'gemini-weekly', remaining_fraction: weekly, reset_time: reset }, { id: 'gemini-5h', remaining_fraction: 0.9, reset_time: '2026-10-27T20:00:00Z' }];
  const open = () => ({ ok: true, reason: 'open' }), closed = () => ({ ok: false, reason: 'main Claude weekly 8.0% left (< 10%)' });
  it('runs the Gemini lane while the Gemini pool is above its line, whatever the Claude gate says', () => {
    const m = correctMode({ buckets: b(0.63), gate: open, now });
    expect(m).toMatchObject({ mode: 'gemini', model: CORRECT_MODEL });
    expect(m.languages.test('Latin')).toBe(false);
  });
  it('switches to Opus through agy on Latin only when the Gemini weekly bucket reads 0 and the gate opens', () => {
    const m = correctMode({ buckets: b(0), gate: open, now });
    expect(m).toMatchObject({ mode: 'fallback', model: 'claude-opus-5-5-low', lane: FALLBACK.lane });
    expect(m.languages.test('Latin')).toBe(true);
    expect(m.languages.test('German')).toBe(false);
    // A spent pool keeps a residue (0.00028 read on 2026-10-30, /quota shows 0%): still empty.
    expect(correctMode({ buckets: b(0.00028), gate: open, now }).mode).toBe('fallback');
  });
  it('does not run when the Gemini pool is low but not empty, or empty with the gate closed', () => {
    expect(correctMode({ buckets: b(0.01), gate: open, now }).mode).toBeNull();
    expect(correctMode({ buckets: b(0), gate: closed, now })).toMatchObject({ mode: null, why: expect.stringMatching(/fallback is closed.*< 10%/) });
    expect(correctMode({ buckets: null, gate: open, now }).mode).toBeNull();
  });
});

describe('correction pages are drawn where the router test drew (#7558)', () => {
  it('interior: 15% to 95% of the book', () => {
    expect(isInterior(15, 100)).toBe(false);
    expect(isInterior(16, 100)).toBe(true);
    expect(isInterior(95, 100)).toBe(true);
    expect(isInterior(96, 100)).toBe(false);
  });

  it('the window is cut from the last page_number, so hidden repeats do not drop the tail (#5056)', async () => {
    // 100 leaves, 30 of them hidden repeats: pages_count is 70, but the pages still run to 100.
    const db = { collection: () => ({ findOne: async (q: any, o: any) => {
      expect(q.page_number).toEqual({ $gt: 0 });
      expect(o.sort).toEqual({ page_number: -1 });
      return { page_number: 100 };
    } }) };
    const last = await lastPageNumber(db, 'b1');
    expect(last).toBe(100);
    expect(isInterior(90, last)).toBe(true);
    expect(isInterior(90, 70)).toBe(false); // what pages_count would have cut
    expect(await lastPageNumber({ collection: () => ({ findOne: async () => null }) }, 'b2')).toBe(0);
  });
});

describe('the correction lane on a second pool (#7263)', () => {
  const now = Date.parse('2026-10-28T09:00:00Z');
  const reset = '2026-11-03T22:25:00Z'; // 6.56 days left
  const b = (weekly: number) => [{ id: 'gemini-weekly', remaining_fraction: weekly, reset_time: reset }, { id: 'gemini-5h', remaining_fraction: 0.9 }];
  it('--weekly-end bends the pace line to end at that fraction, not 0', () => {
    const plain = quotaFloor(b(0.9), { now }), bent = quotaFloor(b(0.9), { now, weeklyEnd: 0.1 });
    expect(bent.line).toBeCloseTo(0.1 + 0.9 * plain.line, 6);
    expect(quotaFloor(b(0.1), { now: Date.parse(reset) - 1000, weeklyEnd: 0.1 }).ok).toBe(false);
    expect(quotaFloor(b(0.12), { now: Date.parse(reset) - 1000, weeklyEnd: 0.1 }).ok).toBe(true);
  });
  it('--agy-home: no flag keeps the default login (as before), a DIR or auto picks another', () => {
    expect(parseAgyHome(undefined, {})).toEqual({ home: null });
    expect(parseAgyHome('default', { AGY_HOME: '/x' })).toEqual({ home: null });
    expect(parseAgyHome(undefined, { AGY_HOME: '/root/.agy-james' })).toEqual({ home: '/root/.agy-james' });
    expect(parseAgyHome('/root/.agy-james', {})).toEqual({ home: '/root/.agy-james' });
    expect(parseAgyHome('auto', {})).toEqual({ auto: true });
  });
  it('children run on the chosen login and are marked as sharing it', () => {
    expect(agyEnv('/root/.agy-james', { PATH: '/bin' })).toMatchObject({ AGY_HOME: '/root/.agy-james', AGY_POOL_SHARED: '1' });
    expect(agyEnv(null, { AGY_HOME: '/root/.agy-james' }).AGY_HOME).toBeUndefined();
  });
  it('the picker reads the same /quota reply both lanes read, and takes the open pool with most weekly left', () => {
    const out = JSON.stringify({ status: 'SUCCESS', command: { data: { groups: [{ name: 'Gemini Models', buckets: [
      { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.97, reset_time: reset }, { id: 'gemini-5h', window: '5h', remaining_fraction: 0.94 }] }, { name: 'Claude', buckets: [{ id: 'c', window: 'weekly', remaining_fraction: 0.1 }] }] } } });
    expect(quotaBuckets(out)).toHaveLength(2);
    expect(parseQuota(out)).toMatchObject({ weekly: 0.97, fiveHour: 0.94 });
    const pools = [{ home: null, reading: { weekly: 0.42 } }, { home: '/j', reading: { weekly: 0.97 } }, { home: '/k', busy: 9, reading: { weekly: 0.99 } }];
    expect(choosePool(pools, () => ({ open: true })).home).toBe('/j');
    expect(choosePool(pools, () => ({ open: false }))).toBeNull();
    // the fullest pool under its pace line does not shut a smaller open one
    expect(choosePool(pools, (r) => ({ open: r.weekly < 0.5 })).home).toBeNull();
  });
  it('two runs never hold one book: a live claim refuses, a dead or old claim is taken over', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
    expect(claimBook(dir, 'b1', { pid: process.pid, pool: 'default' })).toBe(true);
    expect(claimBook(dir, 'b1', { pid: process.pid, pool: '.agy-james' })).toBe(false);
    releaseBookClaim(dir, 'b1');
    expect(claimBook(dir, 'b1', { pid: process.pid, pool: '.agy-james' })).toBe(true);
    fs.writeFileSync(path.join(dir, 'b2.json'), JSON.stringify({ pid: 2 ** 22 + 7, at: new Date().toISOString() }));
    expect(claimBook(dir, 'b2', { pid: process.pid })).toBe(true);
    expect(claimLive({ pid: 1, at: new Date(Date.now() - 4 * 3600e3).toISOString() }, { alive: () => true })).toBe(false);
    expect(claimLive({ pid: 1, at: new Date().toISOString() }, { alive: () => true })).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('a book a correction reader is reading now is seen, whichever run started it', () => {
    const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
    const put = (pid: string, argv: string[]) => { fs.mkdirSync(path.join(proc, pid)); fs.writeFileSync(path.join(proc, pid, 'cmdline'), argv.join('\0') + '\0'); };
    put('11', ['node', '/r/scripts/batch/cli-ocr.mjs', 'read', '--page-ids-file=/d/2026-10-28/bookA/page-ids-1.json', '--lane=agy-correct-lite-7558']);
    put('12', ['node', '/r/scripts/batch/cli-ocr.mjs', 'apply', '--out=/d/2026-10-28/bookB', '--lane=agy-correct-lite-7558']);
    put('13', ['node', '/r/scripts/batch/cli-ocr.mjs', 'read', '--page-ids-file=/x/bookC/ids.json', '--lane=route-judge-6740-eval']);
    expect([...liveReaderBooks(proc)]).toEqual(['bookA']);
    fs.rmSync(proc, { recursive: true, force: true });
  });
  it('--shard splits the books between boxes: every book in exactly one shard, stably', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `6a${i.toString(16).padStart(22, '0')}`);
    const a = ids.filter((id) => bookShard(id, 2) === 0), b = ids.filter((id) => bookShard(id, 2) === 1);
    expect(a.length + b.length).toBe(400);
    expect(a.length).toBeGreaterThan(150);
    expect(b.length).toBeGreaterThan(150);
    expect(bookShard(ids[7], 2)).toBe(bookShard(ids[7], 2));
    expect(parseShard('1/2')).toEqual({ k: 1, n: 2 });
    expect(parseShard(undefined)).toBeNull();
    expect(() => parseShard('2/2')).toThrow();
    expect(() => parseShard('x')).toThrow();
  });
});

describe('the first-read cohort (#7701)', () => {
  const held = (over: Record<string, unknown> = {}, hold = 'scans-only-publish-7176') => ({
    id: 'b', visible: true, pages_count: 300, pages_ocr: 0, language: 'Latin', title: 'Opera omnia', published: '1580',
    image_source: { provider: 'e-rara' }, pipeline_auto: { status: 'held', hold: { reason: hold } }, ...over,
  });
  it('reads a visible Latin print book held as scans only', () => {
    expect(firstReadSkip(held())).toBeNull();
    for (const h of FIRST_READ_HOLDS) expect(firstReadSkip(held({}, h))).toBeNull();
  });
  it('the hold is what keeps new OCR from queueing paid work: a book that is not held, or held for another reason, is not read', () => {
    expect(firstReadSkip(held({ pipeline_auto: { status: 'archive_complete' } }))).toMatch(/not held/);
    expect(firstReadSkip(held({ pipeline_auto: { status: 'held' } }))).toMatch(/not held/);
    expect(firstReadSkip(held({}, 'invented-ocr-6056'))).toMatch(/other hold/);
    expect(firstReadSkip(held({ pipeline_auto: { status: 'held', held: true, hold: { reason: 'scans-only-publish-7176' } } }))).toMatch(/held/);
    expect(firstReadSkip(held({ visible: false }))).toMatch(/not visible/);
    // the run selector carries the same rules a query can
    expect(FIRST_READ_BOOKS['pipeline_auto.status']).toBe('held');
    expect(FIRST_READ_BOOKS['pipeline_auto.hold.reason']).toEqual({ $in: FIRST_READ_HOLDS });
    expect(FIRST_READ_BOOKS.visible).toBe(true);
  });
  it('print only: a manuscript library, a manuscript title or a date before print is skipped', () => {
    expect(manuscriptReason(held({ image_source: { provider: 'vatican' } }))).toMatch(/vatican/);
    expect(manuscriptReason(held({ title: 'Peshitta Gospels (Vat.sir.622)' }))).toMatch(/title/);
    expect(manuscriptReason(held({ title: 'Cod. Pal. germ. 329' }))).toMatch(/title/);
    expect(manuscriptReason(held({ published: '1298' }))).toMatch(/before print/);
    expect(manuscriptReason(held())).toBeNull();
    expect(firstReadSkip(held({ image_source: { provider: 'heidelberg' } }))).toBe('manuscript');
  });
  it('an unsplit spread book is skipped; a split one is read', () => {
    expect(firstReadSkip(held({ needs_splitting: true }))).toMatch(/unsplit spread/);
    expect(firstReadSkip(held({ needs_splitting: true, split_completed: true }))).toBeNull();
    expect(FIRST_READ_BOOKS.$nor).toEqual([{ needs_splitting: true, split_completed: { $ne: true } }]);
    // the page-level check (possible spreads, #523) is the lane's spreadReason, run on the unread pages
    expect(spreadReason(held(), [{}, {}])).toMatch(/#523/);
    expect(spreadReason(held({ pipeline_auto: { status: 'held', hold: { reason: 'x' }, split_checked: true } }), [{}, {}])).toBeNull();
  });
  it('--languages narrows the cohort, by code or name', () => {
    expect(firstReadLanguage(held({ language: 'de' }))).toBe('deu');
    expect(firstReadLanguage(held({ language: 'Latin' }))).toBe('lat');
    expect(firstReadSkip(held({ language: 'English' }), { languages: ['lat', 'deu', 'fra'] })).toMatch(/language/);
    expect(firstReadSkip(held({ language: 'French' }), { languages: ['lat', 'deu', 'fra'] })).toBeNull();
  });
  it('no OCR first, then Latin and German, then priority, then the fewest pages read', () => {
    const books = [
      held({ id: 'fr-0', language: 'French', processing_priority: 90 }),
      held({ id: 'de-partly', language: 'German', pages_ocr: 12, processing_priority: 90 }),
      held({ id: 'la-0-low', processing_priority: 1 }),
      held({ id: 'la-0-high', processing_priority: 50 }),
      held({ id: 'de-partly-less', language: 'German', pages_ocr: 3, processing_priority: 90 }),
    ];
    expect(books.sort(byFirstReadOrder).map((b) => b.id)).toEqual(['la-0-high', 'la-0-low', 'fr-0', 'de-partly-less', 'de-partly']);
  });
  it('writes through cli-ocr.mjs apply as first reads of printed pages, stamped with the lane, never releasing the book', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr-lane.mjs'), 'utf8');
    const body = src.slice(src.indexOf('async function firstReadMain'), src.indexOf('async function main()'));
    expect(body).toMatch(/'--first-read-only', '--print-only'/);
    expect(body).toContain('--lane=${FIRST_READ_LANE}');
    expect(body).not.toMatch(/releaseBook\(|\$set|\$unset/);
    expect(body).not.toMatch(/updateOne|updateMany|insertOne/);
    expect(FIRST_READ_LANE).toBe('agy-first-read-7701');
    // every read is agy Flash-low (never flash-lite, Derek 2026-10-29); the second pass is the correction lane's call
    expect(FIRST_READ_MODEL).toBe('gemini-3.8-flash-low');
    expect([...body.matchAll(/--model=\$\{(\w+)\}/g)].map((m) => m[1])).toEqual(['FIRST_READ_MODEL', 'FIRST_READ_MODEL']);
    expect(body).toContain('--correct-prompt=${TPL}');
    expect(body).toContain('--lane=${FIRST_READ_CORRECT_LANE}');
    expect(FIRST_READ_CORRECT_LANE).toBe('agy-first-read-correct-7701');
    const cli = fs.readFileSync(path.join(__dirname, '../../scripts/batch/cli-ocr.mjs'), 'utf8');
    expect(cli).toMatch(/FIRST_READ_ONLY && page\.ocr\?\.data\?\.trim\(\)/);
    expect(cli).toMatch(/!correct && LANE && \{ pipeline: LANE \}/);
  });
});
