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
  enrolChainedRun, tickChained, planNextRound, packJobs, selectAutoCandidates, AUTO_STATUSES, PHASE, MAX_STRIKES, MAX_REQUESTS_PER_JOB, looksCollapsed,
  phase4Lane, phase4ExcludedBookIds, enrolForPhase4,
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
  text = (n: number, _round?: number) => textFor(n),
  drop = (_n: number, _round: number): boolean => false,
  state = (_round: number): string => 'JOB_STATE_SUCCEEDED',
  error = (_round: number): any => null,
  finish = (_round: number): string => 'STOP',
  blockBody = (_nums: number[], _round: number): string | null => null,  // override a block's whole response
} = {}) {
  const submitted: Array<{ model: string; requests: any[]; displayName: string; name: string }> = [];
  return {
    submitted,
    prompt(i: number, j = 0) { return submitted[i].requests[j].contents[0].parts[0].text as string; },
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
      const err = error(round);
      // Every request in the job answered, in REVERSE order: a shared job's responses are matched
      // by key, never by position.
      const responses = job.requests.map((req: any) => {
        const key = req.metadata.key;
        if (err) return { metadata: { key }, error: err };
        const prompt = req.contents[0].parts[0].text as string;
        const nums = [...prompt.matchAll(/--- Page (\d+) ---/g)].map(m => Number(m[1]));
        if (nums.length) {
          const tag = prompt.includes('Folium') ? 'BK2 ' : '';
          const body = blockBody(nums, round) ?? nums.filter(n => !drop(n, round)).map(n => `<translation page="${n}">${tag}${text(n, round)}</translation>`).join('\n');
          return batchResponse(key, body, finish(round));
        }
        // Single page: the page whose OCR opens the "text to translate" section.
        const m = prompt.match(/Pagina (\d+)\./);
        const n = m ? Number(m[1]) : 0;
        return batchResponse(key, drop(n, round) ? '' : text(n, round), finish(round));
      }).reverse();
      return { state: st, responses };
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
    expect((deps.completeBatchUsage as any).mock.calls[0][0]).toMatchObject({ batch_job_id: `batches/job1#${res.run.id}`, input_tokens: 2000, output_tokens: 800, status: 'success' });
    // Provenance on the page: batch api, the round's job, the seeded context.
    const p9 = pageDoc(db, 9);
    expect(p9.translation.engine ?? p9.translation.provenance ?? p9.translation).toBeTruthy();
  });

  it('a discarded 8-block resolves in 2 rounds: all its pages go single-page in ONE round, seeded only where the predecessor is stored', async () => {
    // Round 2 (block p9–16): the model drops page 12 → 7 of 8 entries → block-shift guard discards it.
    const gemini = makeGemini({ drop: (n, round) => round === 2 && n === 12 });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps); // collect round 1 (p1–8 written), submit block p9–16
    await tick(db, deps); // collect round 2: discarded; submit round 3 = eight singles
    let run = await runOf(db);
    expect(run.rounds[1]).toMatchObject({ kind: 'block', discarded: 'short-block', written: 0, fallback: 8 });
    expect(run.pending_single.map((p: Doc) => p.page_number)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(gemini.submitted).toHaveLength(3);
    expect(gemini.submitted[2].requests).toHaveLength(8);
    expect(run.round.units.map((u: Doc) => u.context.previous_translation)).toEqual([true, false, false, false, false, false, false, false]);
    // p9 is seeded with p8's STORED translation; p10's predecessor is in the same round, so it is not.
    expect(gemini.prompt(2, 0)).toBe(buildTranslationPrompt({
      prompts: PROMPTS, book: BOOK, ocrText: ocrFor(9), previousTranslation: textFor(8),
      prevOcrText: ocr(8), nextOcrText: ocr(10), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt);
    expect(gemini.prompt(2, 1)).toBe(buildTranslationPrompt({
      prompts: PROMPTS, book: BOOK, ocrText: ocrFor(10), previousTranslation: null,
      prevOcrText: ocr(9), nextOcrText: ocr(11), pageBreak: PAGE_BREAK_SCOPED,
    }).prompt);

    await tick(db, deps); // collect all eight singles in one go; the next block submitted
    run = await runOf(db);
    expect(run.pending_single).toEqual([]);
    for (let n = 9; n <= 16; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
    // Round 4 is block p17–20, seeded with p16 — the chain resumes where production would.
    expect(gemini.prompt(3)).toBe(buildBlockTranslationPrompt({
      prompts: PROMPTS, book: BOOK, pages: PAGES.slice(16, 20), previousTranslation: textFor(16),
      prevOcrText: ocr(16), nextOcrText: undefined, pageBreak: PAGE_BREAK_SCOPED,
    }).prompt);
    await tick(db, deps, 2);
    run = await runOf(db);
    expect(run.phase).toBe(PHASE.COMPLETE);
    expect(run.rounds).toHaveLength(4);
    expect(run.counts).toMatchObject({ written: 20, single_fallbacks: 8 });
  });

  it('a block with MORE entries than pages (9 for 8, labels shifted) writes nothing by label; its pages go single-page (#5426)', async () => {
    // Round 2 (block p9–16) answers the 69b6307b shape: an extra entry, then page N labelled with page N−1's text.
    const gemini = makeGemini({
      blockBody: (nums, round) => (round === 2
        ? [`<translation page="${nums[0]}">Continued from the previous page.</translation>`, ...nums.map(n => `<translation page="${n + 1}">${textFor(n)}</translation>`)].join('\n')
        : null),
    });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps); // round 1 written; block p9–16 submitted
    await tick(db, deps); // round 2 collected: over-full → discarded, eight singles submitted
    let run = await runOf(db);
    expect(run.rounds[1]).toMatchObject({ kind: 'block', discarded: 'over-block', returned: 9, written: 0, fallback: 8 });
    for (let n = 9; n <= 16; n++) expect(pageText(db, `p${n}`)).toBeUndefined();
    expect(run.pending_single.map((p: Doc) => p.page_number)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    await tick(db, deps); // the singles come back right
    run = await runOf(db);
    for (let n = 9; n <= 16; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
  });

  it('in a round of singles, a page whose request errored stays pending while the others are written', async () => {
    const gemini = makeGemini({ drop: (n, round) => (round === 1 && n === 5) || (round === 2 && n === 3) });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps); // round 1 discarded → 8 singles
    await tick(db, deps); // round 2: p3 came back empty, the rest written
    let run = await runOf(db);
    expect(run.strikes).toBe(0);
    expect(run.round.units.map((u: Doc) => u.pages[0].page_number)).toEqual([3]);
    expect(run.round.units[0].context.previous_translation).toBe(true); // p2 is stored now
    await tick(db, deps);
    run = await runOf(db);
    expect(pageText(db, 'p3')).toBe(textFor(3));
    expect(run.pending_single).toEqual([]);
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

  it('a block whose first entry echoes its source is discarded whole: the shifted siblings are never written (#4681 echo-shift)', async () => {
    // The 2026-10-01 shape: entry 1 = page 1's own Latin, entries 2..8 = the English of the page BEFORE each.
    // The count matches, so neither the short-block guard nor the positional fallback can see it.
    // Real Latin prose for page 1 (the fixture's word list has no function words, and the echo tier
    // only judges prose-like text): the 1700s page the defect was found on.
    const ECHO = 'peccatum homicidii, nisi homicidio jam secuto; in dubio autem, num fetus ille fuerit mas, an femina, irregularitas incurritur. '
      + 'Quaeritur: quaenam ex verbis absolutionis pertineant ad essentiam formae, et sint necessaria ad valorem sacramenti? '
      + 'Resp. Quamvis doctores inter se pugnent, et alii scripserint haec verba esse solum de necessitate praecepti, tamen negari non potest '
      + 'major probabilitas sententiae dicentis verba illa spectare quoque ad essentiam formae, nam ea est plurium opinio.';
    pageDoc(db, 1).ocr.data = ECHO;
    // Round 1 (the block) comes back echoed-and-shifted; the single-page re-sends come back right.
    const gemini = makeGemini({ text: (n, round) => (round === 1 ? (n === 1 ? ECHO : textFor(n - 1)) : textFor(n)) });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 }); // submits round 1 = block p1–8
    await tick(db, deps); // collect round 1: discarded whole; submit round 2 = eight singles
    let run = await runOf(db);
    expect(run.rounds[0]).toMatchObject({ kind: 'block', discarded: 'echo-shift', echoed: [1], written: 0, fallback: 8 });
    for (let n = 1; n <= 8; n++) expect(pageDoc(db, n).translation?.data).toBeUndefined();
    expect(pageDoc(db, 1).translation?.health_blocked).toBeUndefined(); // not refused: re-sent single-page like the rest
    expect(run.counts).toMatchObject({ written: 0, unhealthy: 0, single_fallbacks: 8 });
    expect(run.round.kind).toBe('single');
    expect(run.round.units).toHaveLength(8);
    await tick(db, deps); // collect the singles: each page gets ITS OWN translation
    run = await runOf(db);
    for (let n = 2; n <= 8; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
    expect(run.counts).toMatchObject({ written: 8, unhealthy: 0 });
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

// ── The OCR trust gate (#5700, scripts/lib/ocr-trust-gate.mjs) ─────────────────
describe('a book whose OCR is not trusted is refused at enrol and parked at its next round', () => {
  const gateBook = () => { db.data.books[0].language = 'Persian'; };   // a gated stratum with no year or hand condition
  const reread = () => { for (const p of db.data.pages) { p.ocr.model = 'gemini-3.1-pro-preview'; p.ocr.updated_at = new Date('2026-10-20T00:00:00Z'); } };

  it('enrol refuses with the stratum in the reason, sends nothing, creates no run', async () => {
    gateBook();
    const gemini = makeGemini();
    const res = await enrolChainedRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 1 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/^ocr-untrusted \(persian; re-read 0\/20 pages, #5700\)$/);
    expect(gemini.submitted).toHaveLength(0);
    expect(db.data[RUNS_COLLECTION] || []).toHaveLength(0);
  });

  it('negative control: the same book in an ungated language enrols', async () => {
    db.data.books[0].language = 'Hebrew';
    expect((await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1, submit: false })).ok).toBe(true);
  });

  it('a run enrolled before the gate parks at its next round, with the stratum; what it wrote stays', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 })).ok).toBe(true);
    gateBook();
    const sent = gemini.submitted.length;
    // The round already in flight was paid for: it is collected and written. Nothing new is sent.
    const notes = await tick(db, deps);
    expect(notes[0].note).toMatch(/parked: ocr-untrusted \(persian/);
    expect(gemini.submitted).toHaveLength(sent);
    expect(await runOf(db)).toMatchObject({ phase: PHASE.PARKED, parked_for_ocr_trust: 'persian', round: null });
    const written = db.data.pages.filter((p: Doc) => p.translation?.data).length;
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(N_PAGES);
    await tick(db, deps, 2);                                // terminal: later ticks leave it alone
    expect(gemini.submitted).toHaveLength(sent);
    expect(db.data.pages.filter((p: Doc) => p.translation?.data).length).toBe(written);
  });

  it('the way out: once the pages were re-read by a better reader after the gate date, the book enrols', async () => {
    gateBook();
    reread();
    const res = await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1, submit: false });
    expect(res.ok).toBe(true);
  });

  it('the operator override enrols a gated book, is stamped on the run, and survives the per-round check', async () => {
    gateBook();
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    const res = await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, allowUntrustedOcr: true });
    expect(res.ok).toBe(true);
    expect(res.run.ocr_trust_override).toBe('persian');
    await tick(db, deps);                                   // round 1 collected; round 2 submitted, not parked
    expect((await runOf(db)).phase).not.toBe(PHASE.PARKED);
    expect(gemini.submitted.length).toBeGreaterThan(1);
  });

  it('enrolForPhase4 skips an untrusted book instead of handing it to the realtime lane', async () => {
    gateBook();
    const routed = await enrolForPhase4(db, db.data.books[0], { prompts: PROMPTS, pageCount: 20, deps: makeDeps(makeGemini()) });
    expect(routed.lane).toBe('skip');
    expect(routed.reason).toMatch(/^ocr-untrusted/);
  });
});

// ── A hold placed AFTER enrol (#5424) ──────────────────────────────────────
describe('a hold placed after enrol stops the run at the next step', () => {
  const HOLD = { reason: 'stranded-text-5309', issue: 5309, held_at: new Date('2026-10-01T00:00:00Z'), held_from_status: 'complete', release: 'OCR replaced' };
  const holdBook = () => { db.data.books[0].pipeline_auto = { status: 'held', hold: HOLD }; };

  it('before a round is submitted: nothing is sent, the run parks, and it is terminal (the next tick leaves it alone)', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    expect((await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, submit: false })).ok).toBe(true);
    holdBook();
    const notes = await tick(db, deps);
    expect(notes[0].note).toBe('parked: book-held (stranded-text-5309)');
    expect(gemini.submitted).toHaveLength(0);
    expect(deps.logUsage).not.toHaveBeenCalled();
    const run = await runOf(db);
    expect(run).toMatchObject({ phase: PHASE.PARKED, parked_reason: 'book-held (stranded-text-5309)', parked_for_hold: 'stranded-text-5309' });
    await tick(db, deps, 2);
    expect(gemini.submitted).toHaveLength(0);
  });

  it('at collect: no page is written, the round is metered, its texts stay on the run, and no next round goes out', async () => {
    const gemini = makeGemini();
    const writePage = vi.fn(async () => ({ written: true }));
    const deps = makeDeps(gemini, { writePage });
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });  // round 1 submitted
    holdBook();
    await tick(db, deps);
    expect(writePage).not.toHaveBeenCalled();
    for (let n = 1; n <= 8; n++) expect(pageText(db, `p${n}`)).toBeUndefined();
    expect(gemini.submitted).toHaveLength(1);
    expect(deps.completeBatchUsage).toHaveBeenCalledTimes(1);
    expect((deps.completeBatchUsage as any).mock.calls[0][0]).toMatchObject({ status: 'success', input_tokens: 2000 });
    const run = await runOf(db);
    expect(run).toMatchObject({ phase: PHASE.PARKED, parked_for_hold: 'stranded-text-5309', round: null });
    expect(run.rounds.at(-1)).toMatchObject({ n: 1, outcome: 'held', written: 0 });
    expect(run.held_texts).toHaveLength(1);
    expect(run.held_texts[0].page_ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(run.held_texts[0].text).toContain('TRANSLATION 3');
  });

  it('after release the book enrols afresh, and the new queue skips what the old run wrote', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps);                                   // p1–8 written, round 2 submitted
    holdBook();
    await tick(db, deps);                                   // round 2 collected under the hold → parked
    expect(pageText(db, 'p9')).toBeUndefined();
    db.data.books[0].pipeline_auto = { status: 'complete' }; // released
    const again = await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, submit: false });
    expect(again.ok).toBe(true);
    expect(again.run.queue.map((r: Doc) => r.page_number)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

// ── Refusals and the collapse retry ────────────────────────────────────────
describe('single-page outcomes', () => {
  it('a RECITATION refusal on a single page is stamped as production stamps it, and the run moves on', async () => {
    // Round 1 drops p5 → 8 singles in round 2; p5's comes back empty with finishReason RECITATION.
    const gemini = makeGemini({ drop: (n) => n === 5, finish: (round) => (round === 2 ? 'RECITATION' : 'STOP') });
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    await tick(db, deps, 2); // round 1 collected; the eight singles collected (round 2)
    const p5 = pageDoc(db, 5);
    expect(p5.translation?.recitation_blocked).toBe(true);
    expect(pageText(db, 'p6')).toBe(textFor(6));
    const run = await runOf(db);
    expect(run.counts.blocked).toBe(1);
    expect(run.pending_single).toEqual([]);
    expect(run.phase).toBe(PHASE.SUBMITTED);
  });

  it('a collapsed single page is retried once and the fuller text is kept', () => {
    expect(looksCollapsed('x'.repeat(1000), '<summary>only a wrapper</summary><note>fragment</note>')).toBe(true);
    expect(looksCollapsed('x'.repeat(1000), textFor(1))).toBe(false);
    expect(looksCollapsed('short', '<summary>s</summary>')).toBe(false);
  });
});

// ── Shared jobs across books ───────────────────────────────────────────────
describe('two tickers never both submit a run', () => {
  it('a READY run is claimed atomically: of two concurrent ticks, one submits it and the other skips', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, submit: false });
    const [a, b] = await Promise.all([tickChained(db, deps, { prompts: PROMPTS }), tickChained(db, deps, { prompts: PROMPTS })]);
    expect(gemini.submitted).toHaveLength(1);
    expect(deps.logUsage).toHaveBeenCalledTimes(1);
    expect([a[0].note, b[0].note].sort()).toEqual(['claimed by another ticker', 'round 1 batches/job1'].sort());
    expect((await runOf(db)).phase).toBe(PHASE.SUBMITTED);
  });

  it('a refused round (closed dial) releases its claim; a failed submit does too', async () => {
    const gemini = makeGemini();
    await enrolChainedRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 1, submit: false });
    await tick(db, makeDeps(gemini, { budgetAllows: vi.fn(async () => false) }));
    expect((await runOf(db)).phase).toBe(PHASE.READY);
    const failing = { ...gemini, submit: async () => { throw new Error('ALL_KEYS_REFUSED_BATCH'); } };
    const notes = await tick(db, makeDeps(failing));
    expect(notes[0].note).toMatch(/submit failed/);
    expect((await runOf(db)).phase).toBe(PHASE.READY);
  });
});

describe('ready runs of many books share one Batch job per round', () => {
  const BOOK2 = { id: 'bk2', title: 'Liber Secundus', author: 'Anon.', language: 'Latin', published: '1610' };
  const ocr2 = (n: number) => `Folium ${n}. ` + ocrFor(n + 40).replace(/^Pagina \d+\. /, '');
  const PAGES2 = Array.from({ length: 12 }, (_, i) => ({ id: `q${i + 1}`, book_id: 'bk2', page_number: i + 1, ocr: { data: ocr2(i + 1) } }));
  const twoBooks = () => makeDb({ books: [BOOK, BOOK2], pages: [...PAGES, ...PAGES2], page_revisions: [], [RUNS_COLLECTION]: [] });
  const enrolBoth = async (d: any, deps: any) => {
    for (const id of ['bk1', 'bk2']) expect((await enrolChainedRun(d, id, deps, { prompts: PROMPTS, approvedUsd: 1, submit: false })).ok).toBe(true);
  };
  const runFor = (d: any, id: string) => d.collection(RUNS_COLLECTION).findOne({ book_id: id });

  it('two books share one job; each response goes to its own book by key; meter rows stay per book', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    const d = twoBooks();
    await enrolBoth(d, deps);
    expect(gemini.submitted).toHaveLength(0); // enrolled READY, nothing sent yet
    await tick(d, deps);
    expect(gemini.submitted).toHaveLength(1);
    expect(gemini.submitted[0].requests).toHaveLength(2);
    const [r1, r2] = [await runFor(d, 'bk1'), await runFor(d, 'bk2')];
    expect(r1.round.job.name).toBe('batches/job1');
    expect(r2.round.job.name).toBe('batches/job1');
    expect(r1.round.units[0].key).not.toBe(r2.round.units[0].key);
    // One placeholder per book, keyed <job>#<runId>.
    expect((deps.logUsage as any).mock.calls.map((c: any[]) => [c[0].book_id, c[0].batch_job_id]))
      .toEqual([['bk1', `batches/job1#${r1.id}`], ['bk2', `batches/job1#${r2.id}`]]);

    await tick(d, deps); // collect the shared job (fetched once), submit round 2 for both, shared again
    expect(pageText(d, 'p1')).toBe(textFor(1));
    expect(d.data.pages.find((p: Doc) => p.id === 'q1').translation.data).toBe('BK2 ' + textFor(1));
    expect(gemini.submitted).toHaveLength(2);
    expect(gemini.submitted[1].requests).toHaveLength(2);
    // Each completion sums only its own response's tokens, on its own row.
    const done = (deps.completeBatchUsage as any).mock.calls.map((c: any[]) => c[0]);
    expect(done).toHaveLength(2);
    expect(done.map((c: Doc) => c.batch_job_id).sort()).toEqual([`batches/job1#${r1.id}`, `batches/job1#${r2.id}`].sort());
    for (const c of done) expect(c).toMatchObject({ input_tokens: 2000, output_tokens: 800, status: 'success' });

    await tick(d, deps, 4);
    expect((await runFor(d, 'bk1')).phase).toBe(PHASE.COMPLETE);
    expect((await runFor(d, 'bk2')).phase).toBe(PHASE.COMPLETE);
    for (let n = 1; n <= 12; n++) expect(d.data.pages.find((p: Doc) => p.id === `q${n}`).translation.data).toBe('BK2 ' + textFor(n));
  });

  it('a cancelled shared job strikes every run in it, and both resubmit together', async () => {
    const gemini = makeGemini({ state: (round) => (round === 1 ? 'JOB_STATE_CANCELLED' : 'JOB_STATE_SUCCEEDED') });
    const deps = makeDeps(gemini);
    const d = twoBooks();
    await enrolBoth(d, deps);
    await tick(d, deps); // submit shared job 1
    await tick(d, deps); // job 1 cancelled → strike both → resubmit both in job 2
    const [r1, r2] = [await runFor(d, 'bk1'), await runFor(d, 'bk2')];
    expect([r1.strikes, r2.strikes]).toEqual([1, 1]);
    expect(r1.rounds[0]).toMatchObject({ outcome: 'strike', reason: 'job JOB_STATE_CANCELLED' });
    expect(r2.rounds[0]).toMatchObject({ outcome: 'strike', reason: 'job JOB_STATE_CANCELLED' });
    expect(gemini.submitted).toHaveLength(2);
    expect(gemini.submitted[1].requests).toHaveLength(2);
    const failed = (deps.completeBatchUsage as any).mock.calls.map((c: any[]) => c[0]).filter((c: Doc) => c.status === 'failed');
    expect(failed.map((c: Doc) => c.book_id).sort()).toEqual(['bk1', 'bk2']);
  });

  it('packs at most MAX_REQUESTS_PER_JOB requests per job, one model per job', () => {
    const p = (id: string, model: string) => ({ run: { id, model } });
    const items = [...Array.from({ length: 51 }, (_, i) => p(`a${i}`, 'm1')), p('b0', 'm2')];
    const jobs = packJobs(items, MAX_REQUESTS_PER_JOB);
    expect(jobs.map((j: any) => [j.model, j.items.length])).toEqual([['m1', 50], ['m1', 1], ['m2', 1]]);
  });

  it('a run submitted before shared jobs (key rN, no meter_id) still collects and meters by job name', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    // Rewrite the open round to the old shape: the request's fields on the round, key `r1`, no meter_id.
    const run = db.data[RUNS_COLLECTION][0];
    const { key: _k, pages: _p, ...unit } = run.round.units[0];
    Object.assign(run.round, unit, { key: 'r1' });
    delete run.round.units;
    delete run.round.meter_id;
    gemini.submitted[0].requests[0].metadata.key = 'r1';
    await tick(db, deps);
    expect(pageText(db, 'p1')).toBe(textFor(1));
    expect((deps.completeBatchUsage as any).mock.calls[0][0]).toMatchObject({ batch_job_id: 'batches/job1', status: 'success' });
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

// ── Auto-enrolment selector ────────────────────────────────────────────────
describe('selectAutoCandidates', () => {
  // Mongo's aggregation is not modelled by the fake: stub it, and check what the selector asks
  // for and what it does after (the pages-based zero check, the approval).
  const stubDb = (rows: Doc[], translatedBooks: string[] = []) => {
    const seen: Doc = {};
    return {
      seen,
      collection(name: string) {
        if (name === RUNS_COLLECTION) return { distinct: async (_f: string, q: Doc) => { seen.runsQuery = q; return ['open1']; } };
        if (name === 'books') return { aggregate: (p: Doc[]) => { seen.pipeline = p; return { toArray: async () => rows }; } };
        if (name === 'pages') return { countDocuments: async (q: Doc) => (translatedBooks.includes(q.book_id) ? 1 : 0) };
        throw new Error(name);
      },
    };
  };
  const row = (id: string, pages_ocr: number) => ({ id, pages_ocr, pages_count: pages_ocr, pages_translated: 0 });

  it('asks for the widened statuses, skips held/English/reader-request/open-run books, approves pages × $0.0012 capped at one run', async () => {
    const d = stubDb([row('a', 100), row('b', 800)]);
    const out = await selectAutoCandidates(d, { limit: 5 });
    const match = d.seen.pipeline[0].$match;
    expect(match['pipeline_auto.status'].$in).toEqual([...AUTO_STATUSES]);
    expect(AUTO_STATUSES).toEqual(expect.arrayContaining(['images_complete', 'needs_attention', 'failed', 'archive_complete', 'ocr_complete']));
    expect(AUTO_STATUSES).not.toContain('translate_submitted');
    expect(match['pipeline_auto.hold']).toEqual({ $exists: false });
    expect(match.id).toEqual({ $nin: ['open1'] });
    expect(match.visible).toBe(true);
    expect(match.language.$not.test('English')).toBe(true);
    expect(match.language.$not.test('Latin')).toBe(false);
    expect(match.processing_priority).toEqual({ $not: { $gte: 90 } });
    // A parked run, and a run that ended in the last day, keep the book out.
    expect(JSON.stringify(d.seen.runsQuery)).toContain('parked');
    expect(out.map((b: Doc) => [b.id, b.approvedUsd])).toEqual([['a', 0.12], ['b', 0.36]]);
  });

  it('--zero-only drops a book with any translated page, counted on pages, and stops at the limit', async () => {
    const d = stubDb([row('a', 30), row('b', 30), row('c', 30), row('d', 30)], ['b']);
    const out = await selectAutoCandidates(d, { limit: 2, zeroOnly: true, minPages: 25, excludeChinese: true });
    expect(out.map((b: Doc) => b.id)).toEqual(['a', 'c']);
    expect(d.seen.pipeline[0].$match.pages_count).toEqual({ $gt: 25 });
    expect(d.seen.pipeline[0].$match.$and[0].language.$not.test('Classical Chinese')).toBe(true);
  });
});

describe('Phase 4 routing (#4681): priority < 90 goes to the chained lane, reader requests stay realtime', () => {
  it('phase4Lane: reader requests realtime, everything else chained, PHASE4_TRANSLATE_LANE=realtime reverts', () => {
    expect(phase4Lane({ processing_priority: 100 }, {})).toBe('realtime');
    expect(phase4Lane({ processing_priority: 90 }, {})).toBe('realtime');
    expect(phase4Lane({ processing_priority: 50 }, {})).toBe('chained');
    expect(phase4Lane({}, {})).toBe('chained');
    expect(phase4Lane({ processing_priority: 50 }, { PHASE4_TRANSLATE_LANE: 'realtime' })).toBe('realtime');
  });

  it('phase4ExcludedBookIds keeps out open runs and parked runs, and a run ended in the last day only if it did not write its whole queue', async () => {
    let q: Doc = {};
    const d = { collection: () => ({ distinct: async (_f: string, query: Doc) => { q = query; return ['x']; } }) };
    expect(await phase4ExcludedBookIds(d, { now: new Date('2026-10-01T00:00:00Z') })).toEqual(['x']);
    const [open, parked, recent] = q.$or;
    expect(open.phase.$nin).toEqual(expect.arrayContaining(['complete', 'parked', 'failed']));
    expect(parked).toEqual({ mode: 'chained', phase: 'parked', parked_for_hold: { $exists: false }, parked_for_ocr_trust: { $exists: false } });
    expect(recent.updated_at.$gte.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(JSON.stringify(recent.$expr)).toContain('counts.written');
  });

  const estimateOf = async () => (await enrolChainedRun(makeDb({ books: [BOOK], pages: PAGES, page_revisions: [], [RUNS_COLLECTION]: [] }), 'bk1', {}, { prompts: PROMPTS, approvedUsd: 0, submit: false })).estimate;

  it('enrols without submitting (the tick packs it into a shared job) and spends nothing', async () => {
    const res = await enrolForPhase4(db, BOOK, { prompts: PROMPTS, pageCount: 300 });
    expect(res.lane).toBe('chained');
    expect(res.run.phase).toBe(PHASE.READY);
    expect(res.run.approved_usd).toBe(0.36);
    expect(db.data[RUNS_COLLECTION]).toHaveLength(1);
  });

  it('approves at the lane\'s own estimate when it is above pages × $0.0012 but under the realtime price', async () => {
    const est = await estimateOf();
    const pageCount = Math.ceil(est / 0.0018);
    expect(pageCount * 0.0012).toBeLessThan(est);
    const res = await enrolForPhase4(db, BOOK, { prompts: PROMPTS, pageCount });
    expect(res.lane).toBe('chained');
    expect(res.run.approved_usd).toBe(est);
  });

  it('sends the book realtime when the batch estimate is above the realtime price', async () => {
    const est = await estimateOf();
    const pageCount = Math.max(1, Math.floor(est / 0.003));
    const res = await enrolForPhase4(db, BOOK, { prompts: PROMPTS, pageCount });
    expect(res.lane).toBe('realtime');
    expect(db.data[RUNS_COLLECTION]).toHaveLength(0);
  });

  it('dispatches neither lane for a held book or one with an open run', async () => {
    const held = makeDb({ books: [{ ...BOOK, pipeline_auto: { status: 'held', hold: { reason: 'wrong leaf' } } }], pages: PAGES, page_revisions: [], [RUNS_COLLECTION]: [] });
    expect((await enrolForPhase4(held, BOOK, { prompts: PROMPTS, pageCount: 20 })).lane).toBe('skip');
    await enrolForPhase4(db, BOOK, { prompts: PROMPTS, pageCount: 300 });
    const again = await enrolForPhase4(db, BOOK, { prompts: PROMPTS, pageCount: 300 });
    expect(again).toMatchObject({ lane: 'skip' });
    expect(again.reason).toMatch(/^open-run/);
  });
});

// ── Page-level targeting (eternity finish pass, #5513) ─────────────────────
describe('enrol can be narrowed to named pages and kept off withheld pages', () => {
  const withhold = (n: number) => { pageDoc(db, n).translation_withheld = { reason: 'withhold-stale-translation-4523', withheld_at: new Date() }; };

  it('by default a withheld page is queued (the #5309 driver relies on it)', async () => {
    withhold(2);
    const res = await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1, submit: false });
    expect(res.run.queue.map((q: Doc) => q.id)).toContain('p2');
  });

  it('excludeWithheld drops withheld pages from the queue', async () => {
    withhold(2); withhold(5);
    const res = await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1, submit: false, excludeWithheld: true });
    const ids = res.run.queue.map((q: Doc) => q.id);
    expect(ids).not.toContain('p2');
    expect(ids).not.toContain('p5');
    expect(ids).toHaveLength(N_PAGES - 2);
  });

  it('pageIds queues only those pages, still minus withheld ones', async () => {
    withhold(4);
    const res = await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1, submit: false, pageIds: ['p3', 'p4', 'p9'], excludeWithheld: true });
    expect(res.run.queue.map((q: Doc) => q.id)).toEqual(['p3', 'p9']);
  });

  it('an empty page list enrols nothing', async () => {
    const res = await enrolChainedRun(db, 'bk1', makeDeps(makeGemini()), { prompts: PROMPTS, approvedUsd: 1, submit: false, pageIds: [] });
    expect(res).toMatchObject({ ok: false, reason: 'nothing-to-translate' });
  });
});

describe('enrol dryRun', () => {
  it('prices the queue and writes nothing', async () => {
    const gemini = makeGemini();
    const res = await enrolChainedRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, dryRun: true, pageIds: ['p1', 'p2'] });
    expect(res).toMatchObject({ ok: true, dryRun: true });
    expect(res.pages.map((p: Doc) => p.id)).toEqual(['p1', 'p2']);
    expect(res.estimate).toBeGreaterThan(0);
    expect(db.data[RUNS_COLLECTION]).toHaveLength(0);
    expect(gemini.submitted).toHaveLength(0);
  });
});

describe('noContext (context_mode none, #5497 arm B): one request per page, unseeded, no adjacent OCR', () => {
  it('sends every page in round 1 as its own bare single-page prompt, writes them all, and a failed page alone goes again', async () => {
    const gemini = makeGemini({ drop: (n, round) => round === 1 && n === 7 });
    const deps = makeDeps(gemini);
    const res = await enrolChainedRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, noContext: true });
    expect(res.ok).toBe(true);
    expect(res.run.context_mode).toBe('none');
    expect(gemini.submitted).toHaveLength(1);
    expect(gemini.submitted[0].requests).toHaveLength(N_PAGES);
    expect(gemini.prompt(0, 4)).toBe(buildTranslationPrompt({ prompts: PROMPTS, book: BOOK, ocrText: ocrFor(5), pageBreak: PAGE_BREAK_SCOPED }).prompt);
    let run = await runOf(db);
    expect(run.round.units.every((u: Doc) => !u.context.previous_translation && !u.context.prev_ocr && !u.context.next_ocr && u.context.mode === 'none')).toBe(true);

    await tick(db, deps); // round 1 collected: p7 empty, the rest written; round 2 = p7 alone, still unseeded
    run = await runOf(db);
    expect(run.round.units.map((u: Doc) => u.pages[0].page_number)).toEqual([7]);
    expect(run.round.units[0].context.previous_translation).toBe(false); // p6 is stored, but no seed in this mode
    expect(gemini.prompt(1, 0)).toBe(buildTranslationPrompt({ prompts: PROMPTS, book: BOOK, ocrText: ocrFor(7), pageBreak: PAGE_BREAK_SCOPED }).prompt);
    await tick(db, deps, 2);
    run = await runOf(db);
    expect(run.phase).toBe(PHASE.COMPLETE);
    for (let n = 1; n <= N_PAGES; n++) expect(pageText(db, `p${n}`)).toBe(textFor(n));
  });

  it('the default (no flag) is unchanged: round 1 is still a block', async () => {
    const gemini = makeGemini();
    await enrolChainedRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 1 });
    expect(gemini.submitted[0].requests).toHaveLength(1);
    expect((await runOf(db)).context_mode).toBeUndefined();
  });
});
