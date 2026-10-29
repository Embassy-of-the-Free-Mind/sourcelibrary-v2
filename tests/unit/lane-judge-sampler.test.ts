/**
 * #7611: the lane-judge sampler (scripts/eval/lane-judge-sampler.mjs) — the draw (per-book cap, the rate switch at 60
 * books, seed reproducibility, a judged page never drawn again), the weekly cap, the score.json export on a fixture
 * with known k/n, and the text edit of rules.json that feeds the router.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { drawPages, weeklyBudget, exportScore, planPlanted, plantedBlock, PLANT_BAR, addEvidence, evidenceEntries, bookWeight, isoWeek, paceBlock, validRecord, scriptClass, rebuildInputs, PROMPT_TEMPLATE_SHA, EVIDENCE_PATH, BY_SCRIPT_PATH, LANES, FIRST_READ_CELLS, FIRST_READ_CORRECT_CELLS } from '../../scripts/eval/lane-judge-sampler.mjs';

type Cand = { page_id: string; book_id: string; cell: string; route: string; weight: number };
const cands = (books: number, pagesPerBook: number, cell = 'german-lite', route = 'lite>agy-flash-low'): Cand[] =>
  Array.from({ length: books }, (_, b) => Array.from({ length: pagesPerBook }, (_, p) => ({ page_id: `${cell}-b${b}-p${p}`, book_id: `${cell}-b${b}`, cell, route, weight: 1 + (b % 5) }))).flat();
const empty = () => ({ pagesJudged: new Set<string>(), bookPages: new Map<string, number>(), routeBooks: new Map<string, Set<string>>() });

describe('drawPages', () => {
  it('draws at most one page per book in a run', () => {
    const { drawn } = drawPages(cands(20, 7), empty(), { seed: 1 });
    expect(drawn).toHaveLength(20);
    expect(new Set(drawn.map((d: Cand) => d.book_id)).size).toBe(20);
  });

  it('never draws a book that already has two pages judged', () => {
    const h = empty(); h.bookPages.set('german-lite-b3', 2); h.bookPages.set('german-lite-b4', 1);
    const { drawn, log } = drawPages(cands(6, 3), h, { seed: 2 });
    expect(drawn.map((d: Cand) => d.book_id)).not.toContain('german-lite-b3');
    expect(drawn.map((d: Cand) => d.book_id)).toContain('german-lite-b4');
    expect(log.book_cap).toBe(1);
  });

  it('negative control: a page already judged is never drawn again', () => {
    const c = cands(10, 2), h = empty();
    for (const x of c) if (x.page_id.endsWith('-p0')) h.pagesJudged.add(x.page_id);
    h.pagesJudged.add('german-lite-b9-p1');   // book 9: both pages judged
    for (let seed = 1; seed <= 25; seed++) {
      const { drawn } = drawPages(c, h, { seed });
      for (const d of drawn) expect(h.pagesJudged.has(d.page_id)).toBe(false);
      expect(drawn.map((d: Cand) => d.book_id)).not.toContain('german-lite-b9');
    }
  });

  it('takes every eligible book until the route has 60 books judged in the cell, then 5%', () => {
    const h = empty(); h.routeBooks.set('german-lite|lite>agy-flash-low', new Set(Array.from({ length: 58 }, (_, i) => `old${i}`)));
    const { drawn } = drawPages(cands(400, 1), h, { seed: 3 });
    expect(drawn.filter((d: { rate: number }) => d.rate === 1)).toHaveLength(2);
    const after = drawn.filter((d: { rate: number }) => d.rate === 0.05).length;
    expect(after).toBeGreaterThan(5); expect(after).toBeLessThan(40);   // 5% of 398, binomial
    // A full cell draws at 5% from the first book; another cell keeps its own count.
    const full = empty(); full.routeBooks.set('german-lite|lite>agy-flash-low', new Set(Array.from({ length: 60 }, (_, i) => `old${i}`)));
    const mixed = drawPages([...cands(100, 1), ...cands(10, 1, 'french-lite')], full, { seed: 4 }).drawn;
    expect(mixed.filter((d: Cand) => d.cell === 'french-lite')).toHaveLength(10);
    expect(mixed.filter((d: Cand) => d.cell === 'german-lite').length).toBeLessThan(20);
  });

  it('is reproducible from the seed, whatever order the pages arrive in', () => {
    const c = cands(30, 4), a = drawPages(c, empty(), { seed: 20261028 }), b = drawPages([...c].reverse(), empty(), { seed: 20261028 });
    expect(b.drawn.map((d: Cand) => d.page_id)).toEqual(a.drawn.map((d: Cand) => d.page_id));
    const other = drawPages(c, empty(), { seed: 20261029 });
    expect(other.drawn.map((d: Cand) => d.page_id)).not.toEqual(a.drawn.map((d: Cand) => d.page_id));
    expect(() => drawPages(c, empty(), {})).toThrow(/seed/);
  });

  it('weights books toward the most-read', () => {
    expect(bookWeight({ human_read_count: 0 })).toBe(1);
    expect(bookWeight({ human_read_count: 1000 })).toBeGreaterThan(bookWeight({ human_read_count: 10 }));
    const c = [...Array.from({ length: 50 }, (_, i) => ({ page_id: `lo${i}`, book_id: `lo${i}`, cell: 'x', route: 'r', weight: 1 })),
      ...Array.from({ length: 50 }, (_, i) => ({ page_id: `hi${i}`, book_id: `hi${i}`, cell: 'x', route: 'r', weight: 8 }))];
    let hiFirst = 0;
    for (let seed = 1; seed <= 200; seed++) if (drawPages(c, empty(), { seed }).drawn[0].book_id.startsWith('hi')) hiFirst++;
    expect(hiFirst).toBeGreaterThan(150);
  });
});

describe('scriptClass', () => {
  it('takes the page\'s own tag first, then the field, then the book majority, else unknown', () => {
    expect(scriptClass('<script>handwritten</script> text', 'printed', 'print')).toEqual({ script_type: 'manuscript', script_source: 'ocr tag' });
    expect(scriptClass('no tag', 'printed', 'manuscript')).toEqual({ script_type: 'print', script_source: 'pages.script_type' });
    expect(scriptClass('no tag', undefined, 'manuscript')).toEqual({ script_type: 'manuscript', script_source: 'book majority' });
    expect(scriptClass(undefined, undefined, 'unknown')).toEqual({ script_type: 'unknown', script_source: 'none' });
    expect(scriptClass('<script>mixed</script>', undefined, 'print').script_type).toBe('mixed');
  });
});

describe('weeklyBudget', () => {
  it('caps judge calls at 1% of an account-week priced as the router table prices a call', () => {
    expect(weeklyBudget({ callsLast7d: 0, pointsPerCall: 0.0124, capPoints: 1 })).toMatchObject({ maxCalls: 80, left: 80 });
    expect(weeklyBudget({ callsLast7d: 75, pointsPerCall: 0.0124, capPoints: 1 }).left).toBe(5);
    expect(weeklyBudget({ callsLast7d: 120, pointsPerCall: 0.0124, capPoints: 1 }).left).toBe(0);
    expect(weeklyBudget({ callsLast7d: 0, pointsPerCall: 0.25, capPoints: 1 }).maxCalls).toBe(4);
    expect(() => weeklyBudget({ callsLast7d: 0, pointsPerCall: 0, capPoints: 1 })).toThrow();
  });
  it('the pace guard fails closed on an unreadable meter and stops at the headroom', () => {
    expect(paceBlock(null)).toMatch(/fail closed/);
    expect(paceBlock({ weekly: 99, session: 8 }, { weeklyMax: 85, sessionMax: 95 })).toMatch(/weekly 99%/);
    expect(paceBlock({ weekly: 40, session: 96 }, { weeklyMax: 85, sessionMax: 95 })).toMatch(/5-hour/);
    expect(paceBlock({ weekly: 40, session: 10 }, { weeklyMax: 85, sessionMax: 95 })).toBeNull();
  });
});

describe('exportScore', () => {
  let n = 0;
  const rec = (kind: string, book: number, page: number, accept: boolean, fidelity: number, wrong = false, route = 'lite>agy-flash-low', extra = {}) => ({
    _id: `r${n++}`, kind, page_id: `p${book}-${page}`, book_id: `b${book}`, page_number: page, cell: 'german-lite', route: kind === 'draft' ? 'lite' : route, lane: 'agy-correct-lite-7558', lang: 'German',
    script_type: 'print', write: { revision_id: `rev${book}-${page}` }, judge: { model_reported: 'claude-opus-5-5', prompt_template_sha: 'abc' }, run_id: 'run1', judged_at: '2026-10-28T00:00:00Z', week: '2026-W44',
    verdict: { accept, fidelity, defects: wrong ? [{ class: 'O6', severity: 'wrong_text', quote: 'x' }] : [{ class: 'O8', severity: 'cosmetic', quote: 'y' }], reader_note: '' }, ...extra });
  const fixture = () => {
    n = 0;
    const r = [];
    // 10 pages in 8 books: 8 accepted, 1 wrong text. Drafts: 5 of 10 accepted; one page made worse.
    const pages: [number, number][] = [[0, 1], [0, 2], [1, 1], [1, 2], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]];
    pages.forEach(([b, p], i) => {
      r.push(rec('item', b, p, i < 8, i < 8 ? 5 : 2, i === 9));
      r.push(rec('draft', b, p, i % 2 === 0 || i === 9, i === 9 ? 4 : 3));
    });
    r.push(rec('wrong_page', 0, 1, false, 1), rec('wrong_page', 1, 1, false, 1));
    // a second route whose control failed; a malformed record; a verdict not from Opus
    r.push(rec('item', 20, 1, true, 5, false, 'agy-flash-low-read'), rec('wrong_page', 20, 1, true, 3, false, 'agy-flash-low-read'));
    r.push({ _id: 'bad', kind: 'item', page_id: 'p99' });
    r.push(rec('item', 30, 1, true, 5, false, 'lite>agy-flash-low', { judge: { model_reported: 'gemini-3.8-flash-low' } }));
    return r;
  };

  it('gives known k/n per cell and route, in the route-judge format build.py reads', () => {
    const s = exportScore(fixture(), { generatedAt: 'T' });
    const x = s.cells['german-lite'].routes['lite>agy-flash-low'];
    expect(x.accept).toBe('8/10');
    expect(x.wrong_text_pages).toBe('1/10');
    expect(x.books).toBe(8);
    expect(x.classes_k_of_n.O6).toBe('1/10');
    expect(x.accept_ci.unit).toBe('book');
    expect(s.cells['german-lite'].controls['lite>agy-flash-low'].passed).toBe(true);
    expect(s.calls.malformed_not_counted).toBe(1);
  });

  it('keeps a route whose wrong-page control failed out of the evidence, and drafts out of it too', () => {
    const s = exportScore(fixture());
    const C = s.cells['german-lite'];
    expect(C.routes['agy-flash-low-read']).toBeUndefined();
    expect(C.routes_not_counted['agy-flash-low-read'].accept).toBe('1/1');
    expect(C.routes.lite).toBeUndefined();
    expect(C.drafts_conditioned.lite.accept).toBe('6/10');
    const m = C.made_worse['lite -> lite>agy-flash-low'];
    expect(m.pairs).toBe(10);
    expect(m.worse).toBe('2/10');           // pages 9 and 10: the draft was accepted, the output was not (10 adds wrong text)
    expect(m.accept_lost).toBe('2/10');
    expect(m.wrong_text_added).toBe('1/10');
    expect(m.accept_gained).toBe('4/10');
    const rules = { cells: [{ id: 'german-lite', routes: [{ id: 'lite>agy-flash-low' }, { id: 'agy-flash-low-read' }] }] };
    expect(evidenceEntries(s, rules)).toEqual([{ cell: 'german-lite', route: 'lite>agy-flash-low', entry: { score: EVIDENCE_PATH, cell: 'german-lite', route: 'lite>agy-flash-low' } }]);
  });

  it('splits every k/n by script type, and a print cell counts only its print pages as evidence', () => {
    const r = fixture();
    r.push(rec('item', 40, 1, false, 2, true, 'lite>agy-flash-low', { script_type: 'manuscript' }), rec('item', 41, 1, true, 5, false, 'lite>agy-flash-low', { script_type: 'unknown' }));
    const x = exportScore(r).cells['german-lite'].routes['lite>agy-flash-low'];
    expect(x.accept).toBe('8/10');
    expect(x.evidence_rule).toBe('print cell: print pages only');
    expect(x.by_script).toEqual({ manuscript: { accept: '0/1', wrong_text_pages: '1/1', books: 1 }, print: { accept: '8/10', wrong_text_pages: '1/10', books: 8 }, unknown: { accept: '1/1', wrong_text_pages: '0/1', books: 1 } });
  });

  it('cuts the counted routes by script type in the shape build.py\'s script split reads (mixed counts as print)', () => {
    const r = fixture();
    r.push(rec('item', 42, 1, true, 5, false, 'lite>agy-flash-low', { script_type: 'mixed' }), rec('item', 43, 1, false, 2, true, 'lite>agy-flash-low', { script_type: 'manuscript' }));
    const s = exportScore(r);
    expect(s.by_script_cells['german-lite|print'].routes['lite>agy-flash-low']).toMatchObject({ accept: '9/11', wrong_text_pages: '1/11', books: 9 });
    expect(s.by_script_cells['german-lite|manuscript'].routes['lite>agy-flash-low']).toMatchObject({ accept: '0/1', wrong_text_pages: '1/1', books: 1 });
    expect(s.by_script_cells['german-lite|unknown']).toBeUndefined();
    // a route whose control failed is not router evidence in any script variant
    expect(Object.values(s.by_script_cells).some((c) => (c as { routes: Record<string, unknown> }).routes['agy-flash-low-read'])).toBe(false);
  });

  it('checks the shape of what it reads', () => {
    expect(validRecord({ _id: 'a', kind: 'item', page_id: 'p', book_id: 'b', cell: 'c', route: 'r', lane: 'l', judge: {}, run_id: 'x', judged_at: 't', verdict: { accept: true, fidelity: 9 } })).toBe(false);
    expect(validRecord({ _id: 'a', kind: 'note', page_id: 'p', book_id: 'b', cell: 'c', route: 'r', lane: 'l', judge: {}, run_id: 'x', judged_at: 't' })).toBe(false);
  });
});

describe('addEvidence (rules.json as text)', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../scripts/eval/estimator/router-table/rules.json'), 'utf8');
  const entry = (cell: string, route: string) => ({ score: EVIDENCE_PATH, cell, route });
  it('adds one entry to one route, changes only that line, and is idempotent', () => {
    const out = addEvidence(text, 'french-lite', 'lite>agy-flash-low', entry('french-lite', 'lite>agy-flash-low'));
    const r = JSON.parse(out).cells.find((c: { id: string }) => c.id === 'french-lite').routes.find((x: { id: string }) => x.id === 'lite>agy-flash-low');
    expect(r.evidence.at(-1)).toEqual(entry('french-lite', 'lite>agy-flash-low'));
    const changed = out.split('\n').filter((l, i) => l !== text.split('\n')[i]);
    expect(changed).toHaveLength(1);
    expect(addEvidence(out, 'french-lite', 'lite>agy-flash-low', entry('french-lite', 'lite>agy-flash-low'))).toBe(out);
    // the same route id in another cell is a different route
    const de = JSON.parse(out).cells.find((c: { id: string }) => c.id === 'german-lite').routes.find((x: { id: string }) => x.id === 'lite>agy-flash-low');
    expect(de.evidence.some((e: { score: string }) => e.score === EVIDENCE_PATH)).toBe(false);
  });
  it('gives a route with no evidence list one', () => {
    const out = addEvidence(text, 'french-lite', 'lite>opus', entry('french-lite', 'lite>opus'));
    const r = JSON.parse(out).cells.find((c: { id: string }) => c.id === 'french-lite').routes.find((x: { id: string }) => x.id === 'lite>opus');
    expect(r.evidence).toEqual([entry('french-lite', 'lite>opus')]);
  });
  it('refuses a route rules.json does not have', () => {
    expect(() => addEvidence(text, 'french-lite', 'no-such-route', entry('french-lite', 'x'))).toThrow();
  });
});

describe('rebuildInputs', () => {
  it('copies every file build.py opens, the script split\'s waiting shares too, and never our own evidence', () => {
    const rules = { inputs: { v2: 'scripts/eval/estimator/ocr/v2.json' }, script_split: { on: true, waiting: 'scripts/eval/router-next-7263/results/waiting-split.json' },
      cells: [{ id: 'german-lite', routes: [{ id: 'a', evidence: [{ score: EVIDENCE_PATH }, { score: 'scripts/eval/x/score.json' }] }, { id: 'b' }] }] };
    const need = rebuildInputs(rules);
    expect(need).toContain('scripts/eval/router-next-7263/results/waiting-split.json');
    expect(need).toContain('scripts/eval/x/score.json');
    expect(need).not.toContain(EVIDENCE_PATH); expect(need).not.toContain(BY_SCRIPT_PATH);
    expect(rebuildInputs({ ...rules, script_split: { on: false, waiting: 'w.json' } })).not.toContain('w.json');
  });

  it('reads every input the router table on disk names', () => {
    const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/eval/estimator/router-table/rules.json'), 'utf8'));
    for (const p of rebuildInputs(rules)) expect(fs.existsSync(path.resolve(__dirname, '../..', p)), p).toBe(true);
  });
});

describe('the judge is the router tests\' judge', () => {
  it('pins the route-judge prompt template: a verdict under another rubric does not pool with these', () => {
    // If judgePrompt changes, this hash changes: new verdicts are a new instrument (a new route or a new source),
    // never silently pooled with the old ones. Update the pin only together with that decision.
    expect(PROMPT_TEMPLATE_SHA).toBe('0032976699c6d194');
  });
  it('names weeks for the weekly controls', () => {
    expect(isoWeek(new Date('2026-10-28T12:00:00Z'))).toBe('2026-W44');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});

describe('planted controls (#7611)', () => {
  const page = (i: number) => `<page-num>${i}</page-num>
<header>LIBER PRIMVS</header>
Primus versus capitis qui caput tenet et nihil aliud.
Quod si quis in hac arte veritatem quærit, ex duabus
partibus constare dicitur, quarum prima est ratione
animi, altera corporis operatione perficitur. Hoc anno
1563 scripsit Paracelsus in Basilea de compositione
lapidis, & septem metallorum generatione tractauit.
Quod etiam in Germania multi fecerunt. Nam qui
substantiam rei non intelligit, nihil efficit in hac
Ultimus versus paginae, ubi custos stat.`;
  const src = (n: number, perBook = 1) => Array.from({ length: n }, (_, i) => ({ rec: { _id: `lj${i}`, book_id: `b${Math.floor(i / perBook)}`, page_id: `p${i}`, lang: 'Latin' }, text: page(i) }));

  it('plants the owed number, one per book, rotating the kind from the store\'s count, never reusing a source', () => {
    const a = planPlanted(src(10, 2), { owed: 3, prior: [], seed: 5 });
    expect(a).toHaveLength(3);
    expect(new Set(a.map((x: { rec: { book_id: string } }) => x.rec.book_id)).size).toBe(3);
    expect(a.map((x: { plant: { kind: string } }) => x.plant.kind)).toEqual(['B', 'C', 'D']);
    const prior = [{ planted_from: 'lj0' }, { planted_from: 'lj1' }, { planted_from: 'lj2' }, { planted_from: 'lj3' }, { planted_from: 'lj4' }];
    const b = planPlanted(src(10), { owed: 2, prior, seed: 5 });
    expect(b.map((x: { plant: { kind: string } }) => x.plant.kind)).toEqual(['C', 'D']);   // 5 before: the 6th is C
    for (const x of b) expect(prior.map((p) => p.planted_from)).not.toContain(x.rec._id);
    for (const x of b) expect(x.plantedText).not.toBe(x.text);
  });

  it('holds a kind across pages: a page with no number does not skip B', () => {
    const noNumber = { rec: { _id: 'lj00', book_id: 'bz', page_id: 'pz', lang: 'Latin' }, text: page(0).replace('1563 ', '').replace('duabus', 'multis').replace('septem ', '').replace(/prima/, 'una') };
    const r = planPlanted([noNumber, ...src(3)], { owed: 1, seed: 1 });
    expect(r[0].plant.kind).toBe('B'); expect(r[0].rec._id).not.toBe('lj00');
    expect(planPlanted([noNumber], { owed: 1, seed: 1 })[0].plant.kind).toBe('C');   // no page has a number: the next kind
  });

  it('is deterministic by seed, whatever order the sources arrive in', () => {
    const s = src(12);
    const ids = (r: { rec: { _id: string }; plant: unknown }[]) => r.map((x) => [x.rec._id, x.plant]);
    expect(ids(planPlanted([...s].reverse(), { owed: 4, seed: 9 }))).toEqual(ids(planPlanted(s, { owed: 4, seed: 9 })));
    expect(() => planPlanted(s, { owed: 1 })).toThrow();
  });

  const pl = (i: number, accept: boolean, named = false, at = '2026-10-28T00:00:00Z') => ({ kind: 'planted', judged_at: at, plant: { kind: 'C', before: 'pietatem', after: 'humiditatem' },
    verdict: { accept, fidelity: accept ? 5 : 3, defects: named ? [{ class: 'O6', quote: 'ueram humiditatem', severity: 'misleads' }] : [] } });

  it('scores a route: caught = rejected or named; fails it below the bar only from 8 plants in the window', () => {
    const now = Date.parse('2026-10-29T00:00:00Z');
    const seven = [...Array(4)].map((_, i) => pl(i, true)).concat([...Array(3)].map((_, i) => pl(i, false)));
    expect(plantedBlock(seven, { now }).validated).toBeNull();                  // 3/7 but under 8 plants: no verdict yet
    const eight = [...seven, pl(9, true, true)];
    const b = plantedBlock(eight, { now });
    expect(b.rolling.caught).toBe('4/8'); expect(b.failed).toBe(true); expect(b.validated).toBe(false);
    expect(b.ci95[0]).toBeLessThan(0.5); expect(b.by_kind.C).toBe('4/8');
    const good = [...Array(8)].map((_, i) => pl(i, i === 0));                   // 7/8 caught
    expect(plantedBlock(good, { now }).validated).toBe(true);
    // old plants leave the window: 8 misses two months ago do not fail a route that now catches
    const old = [...Array(8)].map((_, i) => pl(i, true, false, '2026-08-01T00:00:00Z'));
    expect(plantedBlock([...old, ...good], { now }).validated).toBe(true);
    expect(PLANT_BAR).toBe(0.8);
  });

  it('moves a route whose judge misses planted errors to routes_not_counted, and carries the catch rate on every route', () => {
    let n = 0;
    const base = (kind: string, book: number, accept: boolean, extra = {}) => ({ _id: `x${n++}`, kind, page_id: `p${book}`, book_id: `b${book}`, page_number: 1, cell: 'french-lite', route: 'lite>agy-flash-low', lane: 'agy-correct-lite-7558',
      lang: 'French', script_type: 'print', write: {}, judge: { model_reported: 'claude-opus-5-5' }, run_id: 'r', judged_at: '2026-10-28T00:00:00Z', week: '2026-W44', verdict: { accept, fidelity: accept ? 5 : 1, defects: [] }, ...extra });
    const recs = [...Array(10)].map((_, i) => base('item', i, true)).concat([base('wrong_page', 0, false), base('wrong_page', 1, false)]);
    const plants = (k: number) => [...Array(8)].map((_, i) => ({ ...base('planted', i, i >= k), plant: { kind: 'B', before: '3', after: '6' } }));
    const ok = exportScore([...recs, ...plants(7)], { generatedAt: '2026-10-29T00:00:00Z' }).cells['french-lite'];
    expect(ok.routes['lite>agy-flash-low'].judge_planted).toMatchObject({ caught: '7/8', validated: true });
    expect(ok.routes['lite>agy-flash-low'].accept).toBe('10/10');                     // plants are never evidence
    const bad = exportScore([...recs, ...plants(5)], { generatedAt: '2026-10-29T00:00:00Z' }).cells['french-lite'];
    expect(bad.routes['lite>agy-flash-low']).toBeUndefined();
    expect(bad.routes_not_counted['lite>agy-flash-low'].not_counted_because[0]).toMatch(/judge-unvalidated: planted catch 5\/8/);
    expect(bad.controls['lite>agy-flash-low']).toMatchObject({ wrong_page_passed: true, passed: false });
    expect(validRecord({ ...base('planted', 1, true) })).toBe(true);
  });
});

describe('the first-read lane (#7701)', () => {
  it('is drawn as an unread lane: no draft beside it, its pages mapped to the no-stored-text cells', () => {
    const L = LANES.find((l: { lane: string }) => l.lane === 'agy-first-read-7701');
    expect(L.enabled).toBe(true);
    expect(L.unread).toBe(true);
    expect(L.draft_route).toBeNull();
    expect(L.stamp).toEqual({ 'ocr.pipeline': 'agy-first-read-7701' });
    expect(L.reason.test('#7701 first-read lane: visible book held scans-only-publish-7176 (the hold stays)')).toBe(true);
    expect([L.cell('German'), L.route('German')]).toEqual(['german-blank', 'agy-flash-low@4-written']);
    expect([L.cell('de'), L.route('de')]).toEqual(['german-blank', 'agy-flash-low@4-written']);
    expect([L.cell('French'), L.route('French')]).toEqual(['french-blank', 'agy-flash-low-written']);
    expect(L.cell('English')).toBeNull();
  });
  it('the second pass is its own lane, judged beside the first read it corrected', () => {
    const L = LANES.find((l: { lane: string }) => l.lane === 'agy-first-read-correct-7701');
    expect(L.enabled).toBe(true);
    expect(L.unread).toBeFalsy();
    expect(L.draft_models).toEqual(['gemini-3.8-flash-low']);
    expect([L.cell('German'), L.route('German'), L.draft_route('German')]).toEqual(['german-blank', 'agy-flash-low@4>agy-flash-low-written', 'agy-flash-low@4-written']);
    expect(L.reason.test('#7701 first-read lane correction: the first read (agy-first-read-7701) corrected')).toBe(true);
    // the first-read lane's reason does not take the correction's revision rows
    const A = LANES.find((l: { lane: string }) => l.lane === 'agy-first-read-7701');
    expect(A.reason.test('#7701 first-read lane correction: the first read corrected')).toBe(false);
  });
  it('every cell and route it names is in rules.json', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/eval/estimator/router-table/rules.json'), 'utf8'));
    for (const [cell, route] of [...Object.values(FIRST_READ_CELLS), ...Object.values(FIRST_READ_CORRECT_CELLS)] as [string, string][]) {
      expect(rules.cells.find((c: { id: string }) => c.id === cell)?.routes.some((r: { id: string }) => r.id === route)).toBe(true);
    }
  });
});
