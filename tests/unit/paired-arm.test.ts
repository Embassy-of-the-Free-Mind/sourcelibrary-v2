/**
 * The paired-arm-judge recipe's checks and score (#6553, scripts/eval/route-judge-6740/paired-arm.mjs).
 *
 * The checks are the point: each rule is a mistake the experiment ledger recorded, and a check that passes a broken
 * design is worse than none. So every rule is pinned with a failing fixture next to the passing one, and the score is
 * pinned against hand-counted k/n.
 */
import { describe, it, expect } from 'vitest';
import { checkRun, scoreRun, compareScores, skeleton, RECIPE_TEMPLATE } from '../../scripts/eval/route-judge-6740/paired-arm.mjs';
import { readExperiment } from '../../scripts/eval/lib/experiment-header.mjs';

type Row = { id: string; judged_as: string; cell: string; route: string; kind: string; page_id: string; book_id: string; neighbours?: string[] };
const v = (accept: boolean, fidelity: number, wt = false) => ({ accept, fidelity, defects: wt ? [{ class: 'O1', severity: 'wrong_text', quote: 'x' }] : [] });

// 6 books, one page each; arms live and new; a wrong-page control per arm; 5 repeats of live.
function fixture() {
  const key: Row[] = [];
  const V = new Map<string, ReturnType<typeof v>>();
  let n = 0;
  const add = (route: string, kind: string, b: number, verdict: ReturnType<typeof v>) => {
    const j = `j${(n++).toString(16).padStart(4, '0')}`;
    key.push({ id: `k${n}`, judged_as: j, cell: 'latin', route, kind, page_id: `p${b}`, book_id: `b${b}` });
    V.set(j, verdict);
  };
  for (let b = 0; b < 6; b++) add('live', 'item', b, v(b < 3, b < 3 ? 4 : 2, b >= 4));        // live 3/6, wrong text 2/6
  for (let b = 0; b < 6; b++) add('new', 'item', b, v(b < 5, b < 5 ? 5 : 2));                  // new 5/6, wrong text 0/6
  add('live', 'wrong_page', 9, v(false, 1));
  add('new', 'wrong_page', 9, v(false, 1));
  for (let b = 0; b < 5; b++) add('live', 'repeat', b, v(b < 2, 4));                           // flips on page 2 only
  const recipe = { ...RECIPE_TEMPLATE, issue: 1, arms: ['live', 'new'], baseline: 'live', router_evidence: ['latin-lite'] };
  return { key, packet: null, recipe, verdicts: { opus: V } };
}
const rule = (run: ReturnType<typeof fixture>, r: string) => checkRun(run).find((c: { rule: string }) => c.rule === r);

describe('paired-arm check', () => {
  it('passes a sound design', () => {
    expect(checkRun(fixture()).filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
  });

  it('R1 refuses two pages of one book in an arm', () => {
    const run = fixture();
    run.key.find((k) => k.route === 'new' && k.book_id === 'b1')!.book_id = 'b0';
    expect(rule(run, 'R1')).toMatchObject({ ok: false });
  });

  it('R2 refuses an id or packet field that names an arm', () => {
    const run = fixture();
    run.key[0].judged_as = 'live-0001';
    expect(rule(run, 'R2')).toMatchObject({ ok: false });
    const r2 = fixture();
    (r2 as { packet: unknown }).packet = [{ id: 'j0000', text: 'live text is fine here', route: 'live' }];
    expect(rule(r2, 'R2')).toMatchObject({ ok: false });
    (r2 as { packet: unknown }).packet = [{ id: 'j0000', text: 'the live text is fine here' }];
    expect(rule(r2, 'R2')).toMatchObject({ ok: true });
  });

  it('R3 refuses an arm without a wrong-page control', () => {
    const run = fixture();
    run.key = run.key.filter((k) => !(k.kind === 'wrong_page' && k.route === 'new'));
    expect(rule(run, 'R3')).toMatchObject({ ok: false, detail: expect.stringContaining('latin/new') });
  });

  it('R4 needs 5 repeats or a named earlier floor; a waiver passes and says so', () => {
    const run = fixture();
    run.key = run.key.filter((k) => k.kind !== 'repeat');
    expect(rule(run, 'R4')).toMatchObject({ ok: false });
    run.recipe = { ...run.recipe, noise_floor: { repeat_kind: 'repeat', from: 'scripts/eval/route-judge-6740/judge.mjs' } };
    expect(rule(run, 'R4')).toMatchObject({ ok: true });
    run.recipe = { ...run.recipe, noise_floor: { repeat_kind: 'repeat', from: null }, waive: { R4: 'one-off pilot' } };
    expect(rule(run, 'R4')).toMatchObject({ ok: true, waived: true, detail: expect.stringContaining('WAIVED: one-off pilot') });
  });

  it('R5 needs the batch stated, and tested when above 1', () => {
    const run = fixture();
    run.recipe = { ...run.recipe, batch: { pages_per_call: 4, tested: null } };
    expect(rule(run, 'R5')).toMatchObject({ ok: false });
    run.recipe = { ...run.recipe, batch: { pages_per_call: 4, tested: 'not tested — the live lane reads 4 a call' } };
    expect(rule(run, 'R5')).toMatchObject({ ok: true });
    run.recipe = { ...run.recipe, batch: { pages_per_call: null as unknown as number, tested: null } };
    expect(rule(run, 'R5')).toMatchObject({ ok: false });
  });

  it('R6 asks for neighbouring scans only on a leaf question', () => {
    const run = fixture();
    expect(rule(run, 'R6')).toBeUndefined();
    run.recipe = { ...run.recipe, question: 'leaf' };
    expect(rule(run, 'R6')).toMatchObject({ ok: false });
    for (const k of run.key) k.neighbours = ['prev', 'next'];
    expect(rule(run, 'R6')).toMatchObject({ ok: true });
  });
});

describe('paired-arm score', () => {
  const rep = scoreRun(fixture());
  const C = rep.judges.opus.cells.latin;

  it('counts k/n per arm, the controls and the noise floor', () => {
    expect(C.routes.live).toMatchObject({ n: 6, books: 6, accept: '3/6', wrong_text_pages: '2/6' });
    expect(C.routes.new).toMatchObject({ accept: '5/6', wrong_text_pages: '0/6', fidelity_mean: 4.5 });
    expect(C.controls).toEqual({ live: { n: 1, passed: true }, new: { n: 1, passed: true } });
    expect(C.noise_floor).toMatchObject({ pairs: 5, accept_flips: '1/5' });
  });

  it('compares each arm with the baseline on shared pages', () => {
    expect(C.against_baseline['live -> new']).toMatchObject({ shared_pages: 6, accept_gained: 2, accept_lost: 0, better: '5/6', worse: '0/6' });
  });

  it('compareScores flags a published k/n that does not re-derive', () => {
    const published = { cells: { latin: { routes: { live: { accept: '3/6', wrong_text_pages: '2/6' }, new: { accept: '4/6', wrong_text_pages: '0/6' } } } } };
    const bad = compareScores(rep, published).filter((r: { ok: boolean }) => !r.ok);
    expect(bad).toEqual([expect.objectContaining({ route: 'new', field: 'accept', published: '4/6', rescored: '5/6' })]);
  });

  it('the skeleton carries a header the experiments lint reads', () => {
    const text = skeleton(rep, { date: '2026-11-05', slug: 'x-1' });
    const { header, problems } = readExperiment(text, { name: '2026-11-05-x-1.md' });
    expect(header).toMatchObject({ stage: 'ocr', measure: 'judged', feeds: 'route', n_books: 6, n_pages: 6, router_evidence: ['latin-lite'] });
    expect(problems.filter((p: string) => !p.includes('router_evidence cell'))).toEqual([]);
    expect(text).toContain('| new | 5/6 |');
  });
});
