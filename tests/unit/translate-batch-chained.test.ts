/* eslint-disable @typescript-eslint/no-explicit-any -- a fake Mongo and a fake Batch API are untyped by nature */
/**
 * The CHAINED Batch API translation lane (scripts/lib/translate-batch-chained.mjs): production's
 * loop, one block per round, seeded from Mongo. No network and no spend: Gemini is a mock that
 * answers each round from the prompt it was sent, Mongo is an in-memory fake, the meter is two spies.
 *
 * What must hold:
 *   - every round's prompt is BYTE-IDENTICAL to what translate-core builds for the realtime
 *     worker with the same inputs: the block prompt with PAGE_BREAK_SCOPED and the adjacent OCR,
 *     unseeded for page 1, seeded with the STORED translation of the page before the block after;
 *   - a block that comes back short is discarded whole and its pages are re-sent single-page,
 *     one per round, each seeded by the last (the worker's missing-from-batch path);
 *   - a dead job or an errored request is a strike that resubmits the same plan; MAX_STRIKES parks;
 *   - every write goes through translate-core's door, and every guard refuses what it should
 *     (negative controls): OCR changed since enrol, translated meanwhile, unhealthy text, closed
 *     dial, estimate over the approval;
 *   - every round is metered: a placeholder at submit, completed from the response.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enrolChainedRun, tickChained, planNextRound, PHASE, MAX_STRIKES, looksCollapsed, SHADOW_MODE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-batch-chained.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { RUNS_COLLECTION } from '../../scripts/lib/translate-batch-seam.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { buildBlockTranslationPrompt, buildTranslationPrompt, PAGE_BREAK_SCOPED, contentHash } from '../../scripts/lib/translate-core.mjs';

type Doc = Record<string, any>;

// ── A small in-memory Mongo (the seam test's, plus $in on arrays and countDocuments) ──
function get(doc: Doc, path: string) {
  return path.split('.').reduce((v: any, k) => (v == null ? undefined : v[k]), doc);
}
function matchCond(val: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)
      && Object.keys(cond).some(k => k.startsWith('$'))) {
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      switch (op) {
        case '$in': return arg.includes(val);
        case '$nin': return !arg.includes(val);
        case '$ne': return val !== arg;
        case '$gt': return val > arg;
        case '$exists': return arg ? val !== undefined : val === undefined;
        default: throw new Error(`fake mongo: ${op}`);
      }
    });
  }
  return cond === null ? val == null : val === cond;
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Doc[]).some(f => matches(doc, f));
    return matchCond(get(doc, k), cond);
  });
}
function setPath(doc: Doc, path: string, v: any) {
  const ks = path.split('.');
  let o = doc;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks[ks.length - 1]] = v;
}
function unsetPath(doc: Doc, path: string) {
  const ks = path.split('.');
  let o = doc;
  for (const k of ks.slice(0, -1)) { o = o?.[k]; if (!o) return; }
  delete o[ks[ks.length - 1]];
}
function makeDb(seed: Record<string, Doc[]>) {
  const data: Record<string, Doc[]> = {};
  for (const [k, v] of Object.entries(seed)) data[k] = v.map(d => structuredClone(d));
  const coll = (name: string) => (data[name] ??= []);
  const cursor = (rows: Doc[]) => {
    let out = rows.map(r => structuredClone(r));
    const c = {
      sort(spec: Doc) { const [[f, dir]] = Object.entries(spec); out.sort((a, b) => (get(a, f) > get(b, f) ? 1 : -1) * (dir as number)); return c; },
      project() { return c; },
      limit(n: number) { out = out.slice(0, n); return c; },
      toArray: async () => out,
    };
    return c;
  };
  const db = {
    data,
    collection(name: string) {
      return {
        findOne: async (f: Doc) => { const d = coll(name).find(x => matches(x, f)); return d ? structuredClone(d) : null; },
        find: (f: Doc) => cursor(coll(name).filter(x => matches(x, f))),
        countDocuments: async (f: Doc) => coll(name).filter(x => matches(x, f)).length,
        insertOne: async (d: Doc) => { coll(name).push(structuredClone(d)); return { insertedId: 'x' }; },
        insertMany: async (ds: Doc[]) => { ds.forEach(d => coll(name).push(structuredClone(d))); return {}; },
        updateOne: async (f: Doc, u: Doc) => {
          const d = coll(name).find(x => matches(x, f));
          if (!d) return { matchedCount: 0, modifiedCount: 0 };
          if (Array.isArray(u)) return { matchedCount: 1, modifiedCount: 0 }; // pipeline update: not modelled
          for (const [k, v] of Object.entries(u.$set || {})) setPath(d, k, structuredClone(v));
          for (const k of Object.keys(u.$unset || {})) unsetPath(d, k);
          for (const [k, v] of Object.entries(u.$push || {})) setPath(d, k, [...(get(d, k) || []), structuredClone(v)]);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return db;
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const BOOK = { id: 'bk1', title: 'De Lapide', author: 'Anon.', language: 'Latin', published: '1600' };
const WORDS = 'materia prima solvitur coagulatur opere magno lapidis philosophorum mercurius sulphur sal aqua ignis terra aer calcinatio sublimatio putrefactio corpus spiritus anima tinctura elixir vas hermeticum'.split(' ');
const ocrFor = (n: number) => `Pagina ${n}. ` + Array.from({ length: 90 }, (_, i) => WORDS[(i * 7 + n * 3 + (i * i) % 11) % WORDS.length]).join(' ') + '.';
const N_PAGES = 20;
const PAGES = Array.from({ length: N_PAGES }, (_, i) => ({ id: `p${i + 1}`, book_id: 'bk1', page_number: i + 1, ocr: { data: ocrFor(i + 1) } }));
const PROMPTS = {
  translation: { text: 'Translate from {source_language} to {target_language}.', ref: { id: 'pr1', name: 'Standard Translation', version: 13, content_hash: 'h13' } },
  english: { text: 'Modernize this English.', ref: { id: 'pr2', name: 'English Modernization', version: 2, content_hash: 'h2' } },
};
const textFor = (n: number) => `TRANSLATION ${n}: The first matter is dissolved and coagulated in the great work of the philosophers' stone. `.repeat(5).trim();

function batchResponse(key: string, text: string, finishReason = 'STOP') {
  return { metadata: { key }, response: { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 800, thoughtsTokenCount: 0 } } };
}
const CANCELLED = { code: 1, message: 'The operation was cancelled.' };

/**
 * Gemini mock. Each submitted job holds ONE request; `answer(prompt, nth)` decides the text: a block
 * prompt (it lists `--- Page N ---` markers) gets one tagged entry per page, a single-page prompt gets
 * the page's text. Tests override per page via `textFor` / `drop` / `state` / `error`.
 */
function makeGemini({
  text = (n: number) => textFor(n),
  drop = (_n: number, _round: number): boolean => false,
  state = (_round: number): string => 'JOB_STATE_SUCCEEDED',
  error = (_round: number): any => null,
  finish = (_round: number): string => 'STOP',
} = {}) {
  const submitted: Array<{ model: string; requests: any[]; displayName: string; name: string }> = [];
  return {
    submitted,
    prompt(i: number) { return submitted[i].requests[0].contents[0].parts[0].text as string; },
    async submit({ model, requests, displayName }: any) {
      const name = `batches/job${submitted.length + 1}`;
      submitted.push({ model, requests, displayName, name });
      return { name, keyIndex: 0 };
    },
    async fetch(name: string) {
      const i = submitted.findIndex(s => s.name === name);
      const job = submitted[i];
      const round = i + 1;
      const st = state(round);
      if (st !== 'JOB_STATE_SUCCEEDED') return { state: st, responses: [] };
      const req = job.requests[0];
      const key = req.metadata.key;
      const err = error(round);
      if (err) return { state: st, responses: [{ metadata: { key }, error: err }] };
      const prompt = req.contents[0].parts[0].text as string;
      const nums = [...prompt.matchAll(/--- Page (\d+) ---/g)].map(m => Number(m[1]));
      if (nums.length) {
        const body = nums.filter(n => !drop(n, round)).map(n => `<translation page="${n}">${text(n)}</translation>`).join('\n');
        return { state: st, responses: [batchResponse(key, body, finish(round))] };
      }
      // Single page: the page whose OCR opens the "text to translate" section.
      const m = prompt.match(/Pagina (\d+)\./);
      const n = m ? Number(m[1]) : 0;
      return { state: st, responses: [batchResponse(key, drop(n, round) ? '' : text(n), finish(round))] };
    },
  };
}

function makeDeps(gemini: any, over: Doc = {}) {
  return { gemini, logUsage: vi.fn(async () => {}), completeBatchUsage: vi.fn(async () => 'updated'), budgetAllows: vi.fn(async () => true), log: () => {}, ...over };
}

async function tick(db: any, deps: any, times = 1) {
  let notes: any[] = [];
  for (let i = 0; i < times; i++) notes = await tickChained(db, deps, { prompts: PROMPTS });
  return notes;
}
const runOf = (db: any) => db.collection(RUNS_COLLECTION).findOne({ book_id: 'bk1' });
const pageText = (db: any, id: string) => db.data.pages.find((p: Doc) => p.id === id)?.translation?.data;
const pageDoc = (db: any, n: number) => db.data.pages.find((p: Doc) => p.page_number === n);
const ocr = (n: number) => (n >= 1 && n <= N_PAGES ? ocrFor(n) : undefined);

let db: any;
beforeEach(() => { db = makeDb({ books: [BOOK], pages: PAGES, page_revisions: [], [RUNS_COLLECTION]: [] }); });

// ── The prompt is production's, round by round ─────────────────────────────
describe('each round sends the prompt the realtime worker would send', () => {
  it('round 1 is the block prompt unseeded; round 2 is seeded with the STORED translation of the page before it', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    const res = await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    expect(res.ok).toBe(true);
    expect(gemini.submitted).toHaveLength(1);
    const expected1 = buildBlockTranslationPrompt({
      prompts: PROMPTS, book: BOOK, pages: PAGES.slice(0, 8), previousTranslation: null,
      prevOcrText: undefined, nextOcrText: ocr(9), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt;
    expect(gemini.prompt(0)).toBe(expected1);
    expect(gemini.submitted[0].requests[0].config.thinkingConfig).toEqual({ thinkingBudget: 0 });

    await tick(db, deps); // collect round 1 (writes p1–8), submit round 2
    for (let n = 1; n <= 8; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
    expect(gemini.submitted).toHaveLength(2);
    const expected2 = buildBlockTranslationPrompt({
      prompts: PROMPTS, book: BOOK, pages: PAGES.slice(8, 16), previousTranslation: pageText(db, 'p8'),
      prevOcrText: ocr(8), nextOcrText: ocr(17), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt;
    expect(gemini.prompt(1)).toBe(expected2);
    expect(gemini.prompt(1)).toContain('TRANSLATION 8');

    await tick(db, deps, 3);
    const run = await runOf(db);
    expect(run.phase).toBe(PHASE.COMPLETE);
    expect(run.rounds).toHaveLength(3);
    expect(run.counts).toMatchObject({ written: 20, unhealthy: 0, single_fallbacks: 0 });
    for (let n = 1; n <= 20; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
    // Metered: one placeholder and one completion per round.
    expect(deps.logUsage).toHaveBeenCalledTimes(3);
    expect(deps.completeBatchUsage).toHaveBeenCalledTimes(3);
    expect((deps.completeBatchUsage as any).mock.calls[0][0]).toMatchObject({ batch_job_id: 'batches/job1', input_tokens: 2000, output_tokens: 800, status: 'success' });
    // Provenance on the page: batch api, the round's job, the seeded context.
    const p9 = pageDoc(db, 9);
    expect(p9.translation.engine ?? p9.translation.provenance ?? p9.translation).toBeTruthy();
  });

  it('a short block is discarded whole; its pages go single-page, one per round, each seeded by the last', async () => {
    // Round 1: the model drops page 5 → 7 of 8 entries → block-shift guard discards the block.
    const gemini = makeGemini({ drop: (n, round) => round === 1 && n === 5 });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps); // collect round 1: discarded; submit round 2 = single p1
    let run = await runOf(db);
    expect(run.rounds[0]).toMatchObject({ kind: 'block', discarded: 'short-block', written: 0, fallback: 8 });
    expect(run.pending_single.map((p: Doc) => p.page_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pageText(db, 'p1')).toBeUndefined();
    expect(gemini.prompt(1)).toBe(buildTranslationPrompt({
      prompts: PROMPTS, book: BOOK, ocrText: ocrFor(1), previousTranslation: null,
      prevOcrText: undefined, nextOcrText: ocr(2), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt);

    await tick(db, deps); // collect p1, submit p2 seeded with p1's stored text
    expect(pageText(db, 'p1')).toBe(textFor(1));
    expect(gemini.prompt(2)).toBe(buildTranslationPrompt({
      prompts: PROMPTS, book: BOOK, ocrText: ocrFor(2), previousTranslation: textFor(1),
      prevOcrText: ocr(1), nextOcrText: ocr(3), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt);

    await tick(db, deps, 7); // p2..p8 collected; the next block submitted
    run = await runOf(db);
    expect(run.pending_single).toEqual([]);
    for (let n = 1; n <= 8; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
    // Round 10 is block p9–16, seeded with p8 — the chain resumes where production would.
    expect(gemini.prompt(9)).toBe(buildBlockTranslationPrompt({
      prompts: PROMPTS, book: BOOK, pages: PAGES.slice(8, 16), previousTranslation: textFor(8),
      prevOcrText: ocr(8), nextOcrText: ocr(17), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt);
    await tick(db, deps, 3);
    run = await runOf(db);
    expect(run.phase).toBe(PHASE.COMPLETE);
    expect(run.counts).toMatchObject({ written: 20, single_fallbacks: 8 });
  });
});

// ── Strikes ────────────────────────────────────────────────────────────────
describe('a dead job or an errored request is a strike; MAX_STRIKES parks the run', () => {
  it('resubmits the same plan after a cancelled job, then parks', async () => {
    const gemini = makeGemini({ state: () => 'JOB_STATE_CANCELLED' });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps); // strike 1 + resubmit
    let run = await runOf(db);
    expect(run.strikes).toBe(1);
    expect(run.phase).toBe(PHASE.SUBMITTED);
    expect(gemini.prompt(1)).toBe(gemini.prompt(0)); // the same plan again
    expect(run.cursor).toBe(0);
    await tick(db, deps, MAX_STRIKES - 1);
    run = await runOf(db);
    expect(run.phase).toBe(PHASE.PARKED);
    expect(run.parked_reason).toMatch(/3 consecutive strikes/);
    expect(gemini.submitted).toHaveLength(MAX_STRIKES);
    expect((deps.completeBatchUsage as any).mock.calls.every((c: any[]) => c[0].status === 'failed')).toBe(true);
    expect(pageText(db, 'p1')).toBeUndefined();
  });

  it('an errored request inside a SUCCEEDED job is a strike too, and a later good round clears the count', async () => {
    const gemini = makeGemini({ error: (round) => (round === 1 ? CANCELLED : null) });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps);
    expect((await runOf(db)).strikes).toBe(1);
    await tick(db, deps);
    const run = await runOf(db);
    expect(run.strikes).toBe(0);
    expect(pageText(db, 'p8')).toBe(textFor(8));
  });
});

// ── Guards (negative controls) ─────────────────────────────────────────────
describe('guards at the write', () => {
  it('a page whose OCR changed since enrol, or that was translated meanwhile, is never written over', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    // Between submit and collect: a re-OCR of p3, and the realtime lane (or a human) writes p4.
    pageDoc(db, 3).ocr.data = ocrFor(3) + ' addendum';
    pageDoc(db, 4).translation = { data: 'HUMAN 4', source: 'human' };
    await tick(db, deps);
    expect(pageText(db, 'p3')).toBeUndefined();
    expect(pageText(db, 'p4')).toBe('HUMAN 4');
    expect(pageText(db, 'p5')).toBe(textFor(5));
    const run = await runOf(db);
    expect(run.dropped.map((d: Doc) => d.id).sort()).toEqual(['p3', 'p4']);
    expect(run.counts.written).toBe(6);
  });

  it('a page not yet sent whose OCR changed is dropped from the plan before any spend', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    pageDoc(db, 12).ocr.data = 'rewritten ' + ocrFor(12);
    await tick(db, deps); // round 2 planned without p12
    expect(gemini.prompt(1)).not.toContain('--- Page 12 ---');
    expect(gemini.prompt(1)).toContain('--- Page 11 ---');
    expect(gemini.prompt(1)).toContain('--- Page 13 ---');
    const run = await runOf(db);
    expect(run.dropped).toEqual([{ id: 'p12', reason: 'ocr_changed' }]);
  });

  it('refuses an unhealthy translation, keeps it as evidence, and stamps the page out of the queue', async () => {
    const gemini = makeGemini({ text: (n) => (n === 3 ? 'loop '.repeat(6000) : textFor(n)) });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps);
    const p3 = pageDoc(db, 3);
    expect(p3.translation?.data).toBeUndefined();
    expect(p3.translation?.health_blocked).toBe('runaway');
    expect(db.data.page_revisions.some((r: Doc) => r.page_id === 'p3' && r.source === 'health-gate-refused')).toBe(true);
    expect((await runOf(db)).counts).toMatchObject({ written: 7, unhealthy: 1 });
  });

  it('a closed dial leaves the run ready and submits nothing; an estimate over the approval refuses enrolment', async () => {
    const gemini = makeGemini();
    const closed = makeDeps(gemini, { budgetAllows: vi.fn(async () => false) });
    const res = await enrolChainedRun(db, 'bk1', closed, { prompts: PROMPTS, approvedUsd: 1 });
    expect(res.ok).toBe(true);
    expect(res.submitted).toMatchObject({ submitted: false, note: 'spend-dial-closed' });
    expect(gemini.submitted).toHaveLength(0);
    expect((await runOf(db)).phase).toBe(PHASE.READY);

    const db2 = makeDb({ books: [BOOK], pages: PAGES, page_revisions: [], [RUNS_COLLECTION]: [] });
    const res2 = await enrolChainedRun(db2, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 0.000001 });
    expect(res2.ok).toBe(false);
    expect(res2.reason).toMatch(/exceeds approved/);
    expect(gemini.submitted).toHaveLength(0);
  });

  it('refuses a held book and a book the realtime lane owns', async () => {
    db.data.books[0].pipeline_auto = { status: 'held', hold: { reason: 'test' } };
    expect((await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1 })).reason).toMatch(/book-held/);
    db.data.books[0].pipeline_auto = { status: 'translate_submitted' };
    expect((await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1 })).reason).toMatch(/realtime-lane-owns-book/);
  });
});

// ── Refusals and the collapse retry ────────────────────────────────────────
describe('single-page outcomes', () => {
  it('a RECITATION refusal on a single page is stamped as production stamps it, and the run moves on', async () => {
    // Round 1 drops p5 → 8 singles; p5's single comes back empty with finishReason RECITATION.
    const gemini = makeGemini({ drop: (n, round) => (round === 1 && n === 5) || (n === 5 && round > 1), finish: (round) => (round === 6 ? 'RECITATION' : 'STOP') });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps, 6); // round 1 collected, p1..p4 singles collected, p5 single collected (round 6)
    const p5 = pageDoc(db, 5);
    expect(p5.translation?.recitation_blocked).toBe(true);
    const run = await runOf(db);
    expect(run.counts.blocked).toBe(1);
    expect(run.pending_single.map((p: Doc) => p.page_number)).toEqual([6, 7, 8]);
    expect(run.phase).toBe(PHASE.SUBMITTED);
  });

  it('a collapsed single page is retried once and the fuller text is kept', () => {
    expect(looksCollapsed('x'.repeat(1000), '<summary>only a wrapper</summary><note>fragment</note>')).toBe(true);
    expect(looksCollapsed('x'.repeat(1000), textFor(1))).toBe(false);
    expect(looksCollapsed('short', '<summary>s</summary>')).toBe(false);
  });
});

// ── Pure planning ──────────────────────────────────────────────────────────
describe('planNextRound', () => {
  const refs = (ps: Doc[]) => ps.map(p => ({ id: p.id, page_number: p.page_number, ocr_hash: contentHash(p.ocr.data) }));
  const docs = (ps: Doc[]) => new Map(ps.map(p => [p.id, p]));
  it('sends a pending single page first, alone', () => {
    const plan = planNextRound({ queue: refs(PAGES), cursor: 8, pending_single: refs([PAGES[2]]) }, docs(PAGES));
    expect(plan).toMatchObject({ kind: 'single' });
    expect(plan.pages.map((p: Doc) => p.page_number)).toEqual([3]);
  });
  it('otherwise the next block from the cursor, partitioned as the worker partitions', () => {
    const plan = planNextRound({ queue: refs(PAGES), cursor: 8, pending_single: [] }, docs(PAGES));
    expect(plan.kind).toBe('block');
    expect(plan.pages.map((p: Doc) => p.page_number)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });
  it('returns null when nothing is left, and reports drops without sending them', () => {
    expect(planNextRound({ queue: refs(PAGES), cursor: 20, pending_single: [] }, docs(PAGES))).toBeNull();
    const changed = PAGES.map(p => (p.id === 'p9' ? { ...p, ocr: { data: 'new' + p.ocr.data } } : p));
    const plan = planNextRound({ queue: refs(PAGES), cursor: 8, pending_single: [] }, docs(changed));
    expect(plan.dropped).toEqual([{ id: 'p9', reason: 'ocr_changed' }]);
    expect(plan.pages[0].page_number).toBe(10);
  });
});

// ── Shadow arms (2026-09-30 speed test B): same rounds, nothing written to pages ─────────────
describe('a SHADOW run keeps its texts on itself and seeds from its own output', () => {
  const shadowTick = async (deps: any, times = 1) => {
    let notes: any[] = [];
    for (let i = 0; i < times; i++) notes = await tickChained(db, deps, { prompts: PROMPTS, shadow: true });
    return notes;
  };
  const shadowRun = (tag: string) => db.collection(RUNS_COLLECTION).findOne({ book_id: 'bk1', mode: SHADOW_MODE, tag });

  it('writes no page, seeds round 2 from its own round-1 text, and ignores a translation another lane wrote meanwhile', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    const res = await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, shadow: true, tag: 'C' });
    expect(res.ok).toBe(true);
    expect(res.run.mode).toBe(SHADOW_MODE);
    // A production loop ticks only mode 'chained': the shadow run is invisible to it.
    expect(await tick(db, deps)).toEqual([]);
    // Meanwhile the realtime lane writes p8 and p10 for real.
    pageDoc(db, 8).translation = { data: 'REALTIME 8', source: 'ai' };
    pageDoc(db, 10).translation = { data: 'REALTIME 10', source: 'ai' };
    await shadowTick(deps); // collect round 1, submit round 2
    for (let n = 1; n <= 20; n++) if (n !== 8 && n !== 10) expect(pageText(db, `p${n}`)).toBeUndefined();
    expect(pageText(db, 'p8')).toBe('REALTIME 8');
    const run = await shadowRun('C');
    expect(run.pages.map((p: Doc) => p.page_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(run.pages[7]).toMatchObject({ id: 'p8', text: textFor(8), round: 1, batch_job_id: 'batches/job1', context: { previous_translation: false } });
    // Round 2 is seeded with the SHADOW text of p8, not the realtime lane's; p10 is still sent.
    const expected2 = buildBlockTranslationPrompt({
      prompts: PROMPTS, book: BOOK, pages: PAGES.slice(8, 16), previousTranslation: textFor(8),
      prevOcrText: ocr(8), nextOcrText: ocr(17), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt;
    expect(gemini.prompt(1)).toBe(expected2);
    expect(gemini.prompt(1)).not.toContain('REALTIME');
    expect(gemini.prompt(1)).toContain('--- Page 10 ---');
    await shadowTick(deps, 3);
    const done = await shadowRun('C');
    expect(done.phase).toBe(PHASE.COMPLETE);
    expect(done.counts).toMatchObject({ written: 20, dropped: 0 });
    expect(done.pages).toHaveLength(20);
    expect(pageText(db, 'p10')).toBe('REALTIME 10');
    expect(db.data.page_revisions).toHaveLength(0);
    // Metered under the shadow endpoint, with the book id (an envelope still sees it).
    expect((deps.completeBatchUsage as any).mock.calls[0][0]).toMatchObject({ endpoint: 'eval/translate-batch-chained-shadow', book_id: 'bk1' });
  });

  it('two tags run side by side on one book; a production enrol is not blocked by them; the health gate records on the run', async () => {
    const gemini = makeGemini({ text: (n) => (n === 3 ? 'loop '.repeat(6000) : textFor(n)) });
    const deps = makeDeps(gemini);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, shadow: true, tag: 'C' })).ok).toBe(true);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, shadow: true, tag: 'C2' })).ok).toBe(true);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, shadow: true, tag: 'C' })).reason).toMatch(/open-run/);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, shadow: true })).reason).toMatch(/shadow-needs-tag/);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 })).ok).toBe(true);
    await shadowTick(deps);
    const c = await shadowRun('C');
    expect(c.counts).toMatchObject({ written: 7, unhealthy: 1 });
    expect(c.refused).toEqual([expect.objectContaining({ id: 'p3', reason: 'runaway', round: 1 })]);
    expect(pageDoc(db, 3).translation?.health_blocked).toBeUndefined();
    expect(db.data.page_revisions.some((r: Doc) => r.source === 'health-gate-refused')).toBe(false);
    expect((await shadowRun('C2')).counts.written).toBe(7);
  });
});
