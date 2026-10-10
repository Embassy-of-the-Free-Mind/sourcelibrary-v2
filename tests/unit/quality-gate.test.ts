import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import * as qg from '../../scripts/lib/quality-gate.mjs';
// @ts-expect-error — plain .mjs helper, no types
import * as sc from '../../scripts/lib/quality-gate-screens.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { LANES } from '../../scripts/lib/lanes.mjs';

/**
 * The standing quality gate (#5826, decision 8 of .claude/docs/pipeline-next-step.md): 300 books or 7
 * days per paid step, 10 books × 3 pages by eye, a NO-GO pauses ENROLMENT until a person records a GO
 * naming the fix. These pin the cadence rule, the record's validation, the brake and its actuation, the
 * screens, the draw, and — the part that rots — that every unattended enroler actually asks the brake.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
type Doc = Record<string, any>;

// ── a minimal Mongo double: dotted $set / $unset, findOne by fields, sort by `at` ──
function makeDb(seed: Record<string, Doc[]> = {}) {
  const data: Record<string, Doc[]> = {};
  for (const [k, v] of Object.entries(seed)) data[k] = v.map((d) => structuredClone(d));
  const coll = (n: string) => (data[n] ??= []);
  const matches = (d: Doc, f: Doc) => Object.entries(f).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
    return d[k] === v;
  });
  const setPath = (d: Doc, p: string, v: any) => { const ks = p.split('.'); let o = d; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks[ks.length - 1]] = v; };
  const unsetPath = (d: Doc, p: string) => { const ks = p.split('.'); let o: any = d; for (const k of ks.slice(0, -1)) { o = o?.[k]; if (!o) return; } delete o[ks[ks.length - 1]]; };
  return {
    data,
    collection(name: string) {
      return {
        findOne: async (f: Doc, opts: Doc = {}) => {
          let rows = coll(name).filter((d) => matches(d, f));
          if (opts.sort?.at) rows = [...rows].sort((a, b) => (a.at > b.at ? 1 : -1) * opts.sort.at);
          return rows[0] ? structuredClone(rows[0]) : null;
        },
        insertOne: async (d: Doc) => { coll(name).push(structuredClone(d)); return {}; },
        updateOne: async (f: Doc, u: Doc, opts: Doc = {}) => {
          let d = coll(name).find((x) => matches(x, f));
          if (!d && opts.upsert) { d = { ...f }; coll(name).push(d); }
          if (!d) return { matchedCount: 0 };
          for (const [k, v] of Object.entries(u.$set || {})) setPath(d, k, structuredClone(v));
          for (const k of Object.keys(u.$unset || {})) unsetPath(d, k);
          return { matchedCount: 1 };
        },
      };
    },
  };
}
const control = (extra: Doc = {}) => ({ _id: 'processing_control', paused_phases: [], ...extra });
const SAMPLE = [{ book_id: 'b1', language: 'Latin', page_ids: ['p1', 'p2', 'p3'], page_numbers: [1, 2, 3] }];

describe('failure classes are the taxonomy doc’s, both ways', () => {
  it('every code is a heading of page-error-taxonomy.md and every heading is a code', () => {
    const doc = read('.claude/docs/page-error-taxonomy.md');
    const headings = [...doc.matchAll(/^### ([IOTDE]\d+) ·/gm)].map((m) => m[1]);
    expect([...qg.TAXONOMY_CLASSES].sort()).toEqual([...new Set(headings)].sort());
  });
  it('parses code:pages and rejects an unknown code or severity', () => {
    expect(qg.parseFailureClasses('O6:3, T7')).toEqual([{ code: 'O6', pages: 3 }, { code: 'T7', pages: null }]);
    expect(qg.failureClassProblems([{ code: 'X9' }])).toHaveLength(1);
    expect(qg.failureClassProblems([{ code: 'O6', severity: 'awful' }])).toHaveLength(1);
    expect(qg.failureClassProblems([{ code: 'O6', severity: 'major', pages: 2 }])).toEqual([]);
  });
});

describe('steps', () => {
  it('only ocr, translate and test-<name> drill steps are gated', () => {
    expect(() => qg.assertStep('translate')).not.toThrow();
    expect(() => qg.assertStep('test-drill')).not.toThrow();
    expect(() => qg.assertStep('enrich')).toThrow();
    expect(() => qg.assertStep('test-')).toThrow();
  });
});

describe('cadence: due at 300 books or 7 days, overdue after 100 more books, missing = overdue', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  const books = (n: number, start: number, stepMs = 60_000) => Array.from({ length: n }, (_, i) => ({ book_id: `b${start + i}`, at: new Date(from.getTime() + (start + i) * stepMs) }));
  it('no gate recorded fails closed', () => {
    expect(qg.gateState([], { from: null }).state).toBe('overdue');
  });
  it('ok under 300 books and 7 days', () => {
    expect(qg.gateState(books(299, 0), { from, now: new Date('2026-10-03T00:00:00Z') }).state).toBe('ok');
  });
  it('due at the 300th book, with grace counted from that moment', () => {
    const s = qg.gateState(books(350, 0), { from, now: new Date('2026-10-03T00:00:00Z') });
    expect(s.state).toBe('due');
    expect(s.books_past_due).toBe(50);
  });
  it('overdue once 100 books are past due', () => {
    expect(qg.gateState(books(400, 0), { from, now: new Date('2026-10-03T00:00:00Z') }).state).toBe('overdue');
  });
  it('due at 7 days with few books; overdue after 100 books past day 7', () => {
    const now = new Date('2026-10-09T00:00:00Z');
    expect(qg.gateState(books(10, 0), { from, now }).state).toBe('due');
    const late = Array.from({ length: 100 }, (_, i) => ({ book_id: `l${i}`, at: new Date('2026-10-08T06:00:00Z') }));
    expect(qg.gateState([...books(10, 0), ...late], { from, now }).state).toBe('overdue');
  });
  it('the standing driver idles on overdue and on a NO-GO, enrols otherwise', () => {
    expect(qg.driverGate({ state: 'overdue', enrol_paused: null }).enrol).toBe(false);
    expect(qg.driverGate({ state: 'ok', enrol_paused: { gate_id: 'g' } })).toMatchObject({ enrol: false, gate: 'NO-GO' });
    expect(qg.driverGate({ state: 'due', enrol_paused: null })).toMatchObject({ enrol: true, gate: 'due' });
  });
});

describe('the brake', () => {
  const paused = control({ lane_budgets: { translate: { enrol_paused: { gate_id: 'g1', at: new Date(), by: 'Derek' } } } });
  it('reads lane_budgets.<step>.enrol_paused and nothing else', () => {
    expect(qg.enrolPausedFor(paused, 'translate')?.gate_id).toBe('g1');
    expect(qg.enrolPausedFor(paused, 'ocr')).toBeNull();
    expect(qg.enrolPausedFor(control({ lane_budgets: { translate: { usd_per_day: 39 } } }), 'translate')).toBeNull();
    expect(qg.enrolPausedFor(null, 'translate')).toBeNull();
  });
  it('enrolBrake logs one line naming the gate and the resume path', async () => {
    const log = vi.fn();
    const r = await qg.enrolBrake(null, 'translate', { control: paused, log, env: {} });
    expect(r).toMatchObject({ paused: true, gate_id: 'g1' });
    expect(log.mock.calls[0][0]).toMatch(/translate ENROLMENT PAUSED by NO-GO gate g1.*verdict=GO/);
  });
  it('a drill step only ADDS a brake (QUALITY_GATE_DRILL_STEP, test-* only)', async () => {
    const drill = control({ lane_budgets: { 'test-drill': { enrol_paused: { gate_id: 'gd', at: new Date() } } } });
    expect((await qg.enrolBrake(null, 'translate', { control: drill, log: null, env: {} })).paused).toBe(false);
    expect((await qg.enrolBrake(null, 'translate', { control: drill, log: null, env: { QUALITY_GATE_DRILL_STEP: 'test-drill' } })).paused).toBe(true);
    expect(qg.drillSteps({ QUALITY_GATE_DRILL_STEP: 'translate,test-x' })).toEqual(['test-x']);
  });
});

describe('recording a verdict', () => {
  it('a NO-GO needs a failure class; nothing is written when the record is refused', async () => {
    const db = makeDb({ system_config: [control()] });
    const r = await qg.recordGate(db, { step: 'translate', verdict: 'NO-GO', by: 'Derek', sample_ids: SAMPLE, failure_classes: [] }, { push: vi.fn(), log: () => {} });
    expect(r.problems.join()).toMatch(/at least one failure class/);
    expect(db.data.quality_gates ?? []).toHaveLength(0);
  });
  it('a real-step gate must name its sample', () => {
    expect(qg.recordProblems({ step: 'ocr', verdict: 'GO', by: 'Derek', sample_ids: [] }).join()).toMatch(/sample_ids is empty/);
  });
  it('NO-GO: row, versioned enrol_paused, high-priority ntfy', async () => {
    const db = makeDb({ system_config: [control({ lane_budgets: { translate: { usd_per_day: 39 } } })] });
    const push = vi.fn(async () => ({ ok: true, status: 200 }));
    const { gate, problems } = await qg.recordGate(db, { step: 'translate', verdict: 'NO-GO', by: 'Claude (headless, by eye)', sample_ids: SAMPLE, failure_classes: [{ code: 'O1', pages: 4 }] }, { push, log: () => {} });
    expect(problems).toEqual([]);
    const ctl = db.data.system_config[0];
    expect(ctl.lane_budgets.translate.enrol_paused.gate_id).toBe(gate.id);
    expect(ctl.lane_budgets.translate.usd_per_day).toBe(39); // a dotted $set: R8's fields survive
    expect(db.data.system_config_revisions).toHaveLength(1);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high' }));
    expect(db.data.quality_gates[0].actuation.ntfy.ok).toBe(true);
  });
  it('a GO that lifts a NO-GO must come from a person and name the fix', async () => {
    const db = makeDb({ system_config: [control()] });
    const { gate: nogo } = await qg.recordGate(db, { step: 'translate', verdict: 'NO-GO', by: 'Claude session', sample_ids: SAMPLE, failure_classes: [{ code: 'T7' }] }, { push: vi.fn(async () => ({ ok: true })), log: () => {} });
    const bot = await qg.recordGate(db, { step: 'translate', verdict: 'GO', by: 'Claude session', fix: 'x', sample_ids: SAMPLE }, { push: vi.fn(), log: () => {} });
    expect(bot.problems.join()).toMatch(/only a person can lift it/);
    const nofix = await qg.recordGate(db, { step: 'translate', verdict: 'GO', by: 'Derek', sample_ids: SAMPLE }, { push: vi.fn(), log: () => {} });
    expect(nofix.problems.join()).toMatch(/must name the fix/);
    expect(db.data.system_config[0].lane_budgets.translate.enrol_paused.gate_id).toBe(nogo.id);
    const push = vi.fn(async () => ({ ok: true }));
    const ok = await qg.recordGate(db, { step: 'translate', verdict: 'GO', by: 'Derek', fix: 'MS books routed to the trust gate (#5700)', sample_ids: SAMPLE }, { push, log: () => {} });
    expect(ok.problems).toEqual([]);
    expect(ok.gate.resumes_gate_id).toBe(nogo.id);
    expect(db.data.system_config[0].lane_budgets.translate.enrol_paused).toBeUndefined();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ priority: 'low' }));
  });
  it('a drill NO-GO pushes low, and its GO removes the whole test lane key', async () => {
    const db = makeDb({ system_config: [control()] });
    const push = vi.fn(async () => ({ ok: true }));
    await qg.recordGate(db, { step: 'test-drill', verdict: 'NO-GO', by: 'quality-gate drill', failure_classes: [{ code: 'O4' }] }, { push, log: () => {} });
    expect(push.mock.calls[0][0]).toMatchObject({ priority: 'low' });
    expect(push.mock.calls[0][0].title).toMatch(/^\[DRILL\]/);
    await qg.recordGate(db, { step: 'test-drill', verdict: 'GO', by: 'quality-gate drill' }, { push, log: () => {} });
    expect(db.data.system_config[0].lane_budgets['test-drill']).toBeUndefined();
  });
  it('pushNtfy never throws', async () => {
    const r = await qg.pushNtfy({ title: 't', body: 'b', fetchImpl: async () => { throw new Error('offline'); } });
    expect(r).toEqual({ ok: false, error: 'offline' });
  });
});

describe('every unattended enroler of a paid step asks the brake', () => {
  // The brake is a belief until each enrolment path asks it (spend-controls.md, failure mode 2/5).
  const SITES: Array<[string, string, RegExp]> = [
    ['scripts/lib/translate-batch-chained.mjs', 'translate', /enrolBrake\(db, 'translate'/],
    ['scripts/workers/translate-batch-worker.mjs', 'translate', /enrolBrake\(db, 'translate'/],
    ['scripts/workers/translate-worker.mjs', 'translate', /enrolBrake\(db, 'translate'/],
    ['scripts/workers/pipeline-orchestrator.mjs', 'translate', /const translateGate = await enrolBrake\(db, 'translate'\);\s+const effectiveLimit = translateGate\.paused \? 0/],
    ['scripts/workers/pipeline-orchestrator.mjs', 'ocr', /shouldRun\(1\.5\) && !\(await enrolBrake\(db, 'ocr'\)\)\.paused/],
    ['scripts/workers/pipeline-orchestrator.mjs', 'ocr', /shouldRun\(2\) && !\(await enrolBrake\(db, 'ocr'\)\)\.paused/],
  ];
  it.each(SITES)('%s asks for %s', (file, _step, re) => {
    expect(read(file)).toMatch(re);
  });
  it('the chained enrol asks before it inserts a run', () => {
    const src = read('scripts/lib/translate-batch-chained.mjs');
    const fn = src.slice(src.indexOf('export async function enrolChainedRun'), src.indexOf('export function unitsOf'));
    expect(fn.indexOf("enrolBrake(db, 'translate'")).toBeGreaterThan(-1);
    expect(fn.indexOf("enrolBrake(db, 'translate'")).toBeLessThan(fn.indexOf('insertOne(run)'));
  });
  it('every scheduled, metered ocr/translate lane in the registry has a file that asks', () => {
    const exempt: Record<string, string> = {
      'specialist-ocr': 'free CPU / leased GPU, one approved script each; its lease or relaunch line is its switch',
    };
    const lanes = (LANES as Doc[]).filter((l) => ['ocr', 'translate'].includes(l.serves) && !/^manual/.test(l.trigger) && !exempt[l.name]);
    expect(lanes.length).toBeGreaterThanOrEqual(5);
    for (const l of lanes) {
      const asks = (l.files as string[]).some((f) => /enrolBrake\(/.test(read(f)));
      expect(asks, `${l.name} enrols into ${l.serves} without asking enrolBrake`).toBe(true);
    }
  });
});

describe('screens', () => {
  // Varied text (a pseudo-random walk over a word list): a `.repeat()` fixture IS a loop.
  const walk = (words: string[], n: number, seed: number) => { let x = seed; return Array.from({ length: n }, () => { x = (x * 1103515245 + 12345) % 2147483648; return words[x % words.length]; }).join(' '); };
  const LA = 'materia prima solvitur coagulatur opere magno lapidis philosophorum mercurius sulphur sal aqua ignis terra aer calcinatio sublimatio corpus spiritus anima tinctura elixir vas et cum ad per'.split(' ');
  const EN = 'the first matter is dissolved and coagulated in great work of stone philosophers mercury sulphur salt water fire earth air body spirit soul tincture vessel with by for to'.split(' ');
  const latin = walk(LA, 110, 7) + '.';
  const english = walk(EN, 120, 11) + '.';
  it('a faithful page passes', () => {
    expect(sc.screenTranslatedPage({ ocr: latin, translation: english, language: 'Latin' }).flags).toEqual([]);
  });
  it('empty, collapsed, wrong language and ratio', () => {
    expect(sc.screenTranslatedPage({ ocr: latin, translation: '', language: 'Latin' }).flags).toContain('empty');
    expect(sc.screenTranslatedPage({ ocr: latin + ' ' + walk(LA, 110, 3), translation: 'The first matter.', language: 'Latin' }).flags).toContain('collapsed');
    expect(sc.screenTranslatedPage({ ocr: latin, translation: latin, language: 'Latin' }).flags).toContain('wrong-lang');
    expect(sc.screenTranslatedPage({ ocr: latin, translation: walk(EN, 500, 5), language: 'Latin' }).flags).toContain('ratio');
  });
  it('a loop is attributed to the side it is on', () => {
    const loop = 'ומה המזון '.repeat(80);
    const f = sc.screenTranslatedPage({ ocr: loop, translation: 'and what the food '.repeat(80), language: 'Hebrew' }).flags;
    expect(f).toContain('loop-ocr');
    expect(f).toContain('loop-translation');
  });
  it('OCR screens: empty, English prose on a Latin book, ratio against the book median', () => {
    expect(sc.screenOcrPage({ ocr: '', language: 'Latin' }).flags).toContain('empty');
    expect(sc.screenOcrPage({ ocr: english, language: 'Latin', bookMedian: english.length }).flags).toEqual(['wrong-lang']);
    expect(sc.screenOcrPage({ ocr: latin, language: 'Latin', bookMedian: latin.length * 20 }).flags).toContain('ratio');
  });
  it('the summary counts flags and keeps examples', () => {
    const s = sc.summariseScreens([{ id: 'p1', book: 'b', pg: 1, flags: ['empty'] }, { id: 'p2', book: 'b', pg: 2, flags: [] }]);
    expect(s).toMatchObject({ pages: 2, books: 1, flagged_pages: 1, by_flag: { empty: 1 } });
  });
});

describe('the draw', () => {
  it('every language present gets a seat before any gets a second', () => {
    expect(sc.allocateSeats({ latin: 200, german: 80, greek: 3, hebrew: 2 }, 10)).toEqual({ latin: 6, german: 2, greek: 1, hebrew: 1 });
    expect(Object.values(sc.allocateSeats({ a: 1, b: 1 }, 10)).reduce((x: number, y: number) => x + y, 0)).toBe(2);
  });
  const books = Array.from({ length: 40 }, (_, i) => ({ id: `b${String(i).padStart(2, '0')}`, language: i < 25 ? 'Latin' : i < 35 ? 'German' : i < 38 ? 'Greek' : 'Hebrew' }));
  const pages = new Map(books.map((b) => [b.id, Array.from({ length: 12 }, (_, j) => ({ id: `${b.id}p${j + 1}`, page_number: j + 1, ol: j === 4 ? 10 : 500 }))]));
  it('is reproducible from the seed, 10 books, 3 consecutive pages each, all languages', () => {
    const a = sc.drawSample(books, pages, { seed: 5826 });
    expect(sc.drawSample(books, pages, { seed: 5826 })).toEqual(a);
    expect(sc.drawSample(books, pages, { seed: 1 })).not.toEqual(a);
    expect(a).toHaveLength(10);
    expect(new Set(a.map((s: Doc) => s.bucket))).toEqual(new Set(['latin', 'german', 'greek', 'hebrew']));
    for (const s of a) {
      expect(s.page_numbers[1] - s.page_numbers[0]).toBe(1);
      expect(s.page_numbers[2] - s.page_numbers[1]).toBe(1);
      expect(s.page_numbers).not.toContain(5); // the short page is avoided while a full run exists
    }
  });
});
