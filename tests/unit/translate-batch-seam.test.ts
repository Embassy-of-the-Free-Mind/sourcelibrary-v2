/* eslint-disable @typescript-eslint/no-explicit-any -- a fake Mongo and a fake Batch API are untyped by nature */
/**
 * The Batch API translation lane with a seam-repair pass (scripts/lib/translate-batch-seam.mjs,
 * #4681). No network and no spend: Gemini is a mock that records what it was sent, Mongo is an
 * in-memory fake, and the meter is two spies.
 *
 * What must hold:
 *   - the translate job carries NO continuity seed (the Batch API cannot), and every request
 *     sets thinkingBudget: 0 (#4581);
 *   - the repair prompt is arm Et's, byte for byte — the thing the blind judge measured;
 *   - every page is written through translate-core's door, the seam page with its repair;
 *   - every guard refuses what it should (negative controls: each would write if its guard
 *     were deleted): OCR changed since submit, translated meanwhile, unhealthy repair,
 *     unhealthy draft, shadow run, closed dial, estimate over the approval, held book;
 *   - both jobs are metered: a placeholder at submit, completed from the responses.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  planBlocks, parseBlockResponse, seamRepairPrompt, seamSeed, seamPairs, chooseSeamText,
  startRun, advanceRun, gateAllowsBook, RUNS_COLLECTION, PHASE,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-batch-seam.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { contentHash } from '../../scripts/lib/translate-core.mjs';

type Doc = Record<string, any>;

// ── A small in-memory Mongo: enough of the query language for the lane ──────
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
        insertOne: async (d: Doc) => { coll(name).push(structuredClone(d)); return { insertedId: 'x' }; },
        insertMany: async (ds: Doc[]) => { ds.forEach(d => coll(name).push(structuredClone(d))); return {}; },
        updateOne: async (f: Doc, u: Doc) => {
          const d = coll(name).find(x => matches(x, f));
          if (!d) return { matchedCount: 0, modifiedCount: 0 };
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
// Varied prose: a page that repeats one sentence is (rightly) refused by the loop guard (#4850).
const WORDS = 'materia prima solvitur coagulatur opere magno lapidis philosophorum mercurius sulphur sal aqua ignis terra aer calcinatio sublimatio putrefactio corpus spiritus anima tinctura elixir vas hermeticum'.split(' ');
const ocrFor = (n: number) => `Pagina ${n}. ` + Array.from({ length: 90 }, (_, i) => WORDS[(i * 7 + n * 3 + (i * i) % 11) % WORDS.length]).join(' ') + '.';
const PAGES = Array.from({ length: 20 }, (_, i) => ({ id: `p${i + 1}`, book_id: 'bk1', page_number: i + 1, ocr: { data: ocrFor(i + 1) } }));
const PROMPTS = {
  translation: { text: 'Translate from {source_language} to {target_language}.', ref: { id: 'pr1', name: 'Standard Translation', version: 13, content_hash: 'h13' } },
  english: { text: 'Modernize this English.', ref: { id: 'pr2', name: 'English Modernization', version: 2, content_hash: 'h2' } },
};
const draftFor = (n: number) => `DRAFT ${n}: The first matter is dissolved and coagulated in the great work of the philosophers' stone. `.repeat(5).trim();
const repairFor = (n: number) => `REPAIRED ${n}: ` + draftFor(n);

function batchResponse(key: string, text: string, tokens = { in: 1000, out: 400, thoughts: 0 }) {
  return {
    metadata: { key },
    response: {
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: tokens.in, candidatesTokenCount: tokens.out, thoughtsTokenCount: tokens.thoughts },
    },
  };
}

/** Gemini mock: records submissions; answers the translate job with tagged drafts, the repair job with `repairText`. */
function makeGemini({ repairText = (n: number) => repairFor(n), translateState = 'JOB_STATE_SUCCEEDED', draftText = (n: number) => draftFor(n) } = {}) {
  const submitted: Array<{ model: string; requests: any[]; displayName: string; name: string }> = [];
  return {
    submitted,
    async submit({ model, requests, displayName }: any) {
      const name = `batches/job${submitted.length + 1}`;
      submitted.push({ model, requests, displayName, name });
      return { name, keyIndex: 0 };
    },
    async fetch(name: string) {
      const job = submitted.find(s => s.name === name)!;
      if (job.displayName.startsWith('tbs-translate')) {
        if (translateState !== 'JOB_STATE_SUCCEEDED') return { state: translateState, responses: [] };
        return {
          state: 'JOB_STATE_SUCCEEDED',
          responses: job.requests.map((r: any) => {
            const nums = [...r.contents[0].parts[0].text.matchAll(/--- Page (\d+) ---/g)].map(m => Number(m[1]));
            const body = nums.map(n => `<translation page="${n}">${draftText(n)}</translation>`).join('\n');
            return batchResponse(r.metadata.key, body, { in: 2000, out: 800, thoughts: 5 });
          }),
        };
      }
      return {
        state: 'JOB_STATE_SUCCEEDED',
        responses: job.requests.map((r: any) => batchResponse(r.metadata.key, repairText(Number(r.metadata.key.slice(1))), { in: 900, out: 300, thoughts: 0 })),
      };
    },
  };
}

function makeDeps(gemini: any, over: Doc = {}) {
  return {
    gemini,
    logUsage: vi.fn(async () => {}),
    completeBatchUsage: vi.fn(async () => 'updated'),
    budgetAllows: vi.fn(async () => true),
    log: () => {},
    ...over,
  };
}

async function runToEnd(db: any, deps: any) {
  const run = await db.collection(RUNS_COLLECTION).findOne({ book_id: 'bk1' });
  for (let i = 0; i < 5; i++) {
    const r = await advanceRun(db, run, deps);
    if (!r.advanced) break;
  }
  return db.collection(RUNS_COLLECTION).findOne({ id: run.id });
}

const pageText = (db: any, id: string) => db.data.pages.find((p: Doc) => p.id === id)?.translation?.data;

// ── Pure helpers ───────────────────────────────────────────────────────────
describe('planBlocks mirrors the realtime worker partition', () => {
  it('cuts blocks of 8, ends a block at a short page, and sends a short first page alone', () => {
    const pages = PAGES.slice(0, 12).map(p => ({ ...p }));
    pages[5] = { ...pages[5], ocr: { data: 'short' } };
    const sizes = planBlocks(pages).map((b: any[]) => b.length);
    expect(sizes).toEqual([5, 1, 6]);
  });
  it('ends a block when it would pass 20,000 OCR chars', () => {
    const big = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, page_number: i + 1, ocr: { data: 'x'.repeat(6000) } }));
    expect(planBlocks(big).map((b: any[]) => b.length)).toEqual([3, 3, 2]);
  });
});

describe('parseBlockResponse mirrors the worker parse', () => {
  const pages = [PAGES[0], PAGES[1]];
  it('reads tagged pages and rejects a page under 15% of its OCR', () => {
    const m = parseBlockResponse(`<translation page="1">${draftFor(1)}</translation><translation page="2">tiny</translation>`, pages);
    expect([...m.keys()]).toEqual([1]);
  });
  it('maps by position when the model renumbers pages', () => {
    const m = parseBlockResponse(`<translation page="7">${draftFor(1)}</translation><translation page="8">${draftFor(2)}</translation>`, pages);
    expect(m.get(1)).toContain('DRAFT 1');
    expect(m.get(2)).toContain('DRAFT 2');
  });
});

describe('the repair prompt is arm Et, byte for byte', () => {
  it('matches the eval harness run with --tail (#4973)', async () => {
    vi.resetModules();
    const saved = process.argv;
    process.argv = [...saved, '--tail'];
    try {
      const evalMod = await import('../../scripts/eval/translation-batch-continuity-ab.mjs');
      const prev = 'x'.repeat(500) + '<summary>s</summary>' + 'The end of the previous page runs on into'.repeat(80);
      const book = { language: 'Latin' };
      expect(seamRepairPrompt({ book, prevTranslation: prev, ocr: 'SOURCE', draft: 'DRAFT' }))
        .toBe(evalMod.seamRepairPrompt(book, prev, 'SOURCE', 'DRAFT'));
      expect(seamSeed(prev)).toBe(evalMod.seedSlice(prev, true));
      // Negative control: the head-seeded arm (E, no --tail) is a DIFFERENT prompt, so the
      // equality above is not vacuous.
      expect(seamRepairPrompt({ book, prevTranslation: prev, ocr: 'SOURCE', draft: 'DRAFT' }))
        .not.toBe(evalMod.seamRepairPrompt(book, prev, 'SOURCE', 'DRAFT').replace(' (its end)', ''));
    } finally {
      process.argv = saved;
    }
  });
  it('shows the END of a long previous page, not its head (#4968)', () => {
    const prev = 'HEAD '.repeat(1000) + 'THE SENTENCE CARRIED OVER THE BREAK';
    const p = seamRepairPrompt({ book: BOOK, prevTranslation: prev, ocr: 'o', draft: 'd' });
    expect(p).toContain('THE SENTENCE CARRIED OVER THE BREAK');
    expect(seamSeed(prev).length).toBe(2003);
  });
});

describe('seamPairs and chooseSeamText', () => {
  it('pairs the last page of each block with the first of the next, and records a boundary it cannot repair', () => {
    const blocks = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], [{ id: 'd' }]];
    const { pairs, skipped } = seamPairs(blocks, new Map([['a', 1], ['b', 1], ['c', 1]]));
    expect(pairs).toEqual([{ prevId: 'b', seamId: 'c' }]);
    expect(skipped).toEqual([{ prevId: 'c', seamId: 'd', reason: 'seam-draft-missing' }]);
  });
  it('falls back to the draft when the repair is a runaway (negative control)', () => {
    const ocr = ocrFor(9);
    const choice = chooseSeamText({ ocr, draft: draftFor(9), repaired: 'loop '.repeat(6000) });
    expect(choice).toMatchObject({ source: 'draft', reason: 'repair-runaway' });
    expect(chooseSeamText({ ocr, draft: draftFor(9), repaired: repairFor(9) }).source).toBe('repair');
  });
});

// ── A whole run, mocked ────────────────────────────────────────────────────
describe('a full run: translate job → repair job → write', () => {
  let db: any;
  beforeEach(() => { db = makeDb({ books: [BOOK], pages: PAGES }); });

  it('submits unseeded blocks, repairs every seam, writes every page through the door, and meters both jobs', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    const started = await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    expect(started.ok).toBe(true);

    const [translateJob] = gemini.submitted;
    expect(translateJob.requests.map((r: any) => r.metadata.key)).toEqual(['b0', 'b1', 'b2']);
    for (const r of translateJob.requests) {
      expect(r.contents[0].parts[0].text).not.toMatch(/for continuity/); // the Batch API cannot carry a seed
      expect(r.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    }

    const run = await runToEnd(db, deps);
    expect(run.phase).toBe(PHASE.WRITTEN);

    const repairJob = gemini.submitted[1];
    expect(repairJob.requests.map((r: any) => r.metadata.key)).toEqual(['p9', 'p17']);
    expect(repairJob.requests[0].contents[0].parts[0].text).toContain(draftFor(8).slice(-200)); // page 8's draft is the context
    expect(repairJob.requests[0].config.thinkingConfig).toEqual({ thinkingBudget: 0 });

    expect(run.write_counts).toMatchObject({ written: 20, repaired: 2 });
    expect(pageText(db, 'p9')).toBe(repairFor(9));
    expect(pageText(db, 'p17')).toBe(repairFor(17));
    expect(pageText(db, 'p8')).toBe(draftFor(8)); // context page: written, not rewritten
    expect(pageText(db, 'p10')).toBe(draftFor(10));
    const p9 = db.data.pages.find((p: Doc) => p.id === 'p9').translation;
    expect(p9).toMatchObject({ source: 'ai', prompt_version: '13', prompt_id: 'pr1', model: 'gemini-3.1-flash-lite' });

    // Metering: a placeholder per job at submit, completed from the responses (thinking counted).
    const placeholders = deps.logUsage.mock.calls.map((c: any[]) => c[0]);
    expect(placeholders.map((p: Doc) => [p.status, p.mode, p.batch_job_id, p.endpoint])).toEqual([
      ['submitted', 'batch', 'batches/job1', 'hetzner/translate-batch-seam/translate'],
      ['submitted', 'batch', 'batches/job2', 'hetzner/translate-batch-seam/repair'],
    ]);
    const done = deps.completeBatchUsage.mock.calls.map((c: any[]) => c[0]);
    expect(done[0]).toMatchObject({ batch_job_id: 'batches/job1', input_tokens: 6000, output_tokens: 2415, mode: 'batch' });
    expect(done[1]).toMatchObject({ batch_job_id: 'batches/job2', input_tokens: 1800, output_tokens: 600 });
  });

  it('writes the draft when the repair comes back as a runaway (negative control)', async () => {
    const gemini = makeGemini({ repairText: () => 'loop '.repeat(6000) });
    const deps = makeDeps(gemini);
    await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    const run = await runToEnd(db, deps);
    expect(pageText(db, 'p9')).toBe(draftFor(9));
    expect(run.write_counts).toMatchObject({ written: 20, repaired: 0, repair_rejected: 2 });
  });

  it('refuses an unhealthy draft, keeps it as evidence, and stamps the page out of the queue (negative control)', async () => {
    const gemini = makeGemini({ draftText: (n: number) => (n === 3 ? 'loop '.repeat(6000) : draftFor(n)) });
    const deps = makeDeps(gemini);
    await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    const run = await runToEnd(db, deps);
    const p3 = db.data.pages.find((p: Doc) => p.id === 'p3');
    expect(p3.translation?.data).toBeUndefined();
    expect(p3.translation?.health_blocked).toBe('runaway');
    expect(db.data.page_revisions.some((r: Doc) => r.page_id === 'p3' && r.source === 'health-gate-refused')).toBe(true);
    expect(run.write_counts).toMatchObject({ written: 19, unhealthy: 1 });
  });

  it('does not write a page whose OCR changed, or one translated meanwhile (negative controls)', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    // Between submit and collect: page 4 re-OCRed, page 5 translated by someone else.
    const p4 = db.data.pages.find((p: Doc) => p.id === 'p4'); p4.ocr.data = 'A different reading of the page. '.repeat(10);
    const p5 = db.data.pages.find((p: Doc) => p.id === 'p5'); p5.translation = { data: 'HUMAN TEXT', source: 'manual' };
    const run = await runToEnd(db, deps);
    expect(pageText(db, 'p4')).toBeUndefined();
    expect(pageText(db, 'p5')).toBe('HUMAN TEXT');
    expect(run.write_counts).toMatchObject({ written: 18, ocr_changed: 1, already_translated: 1 });
    expect(contentHash(p4.ocr.data)).not.toBe(run.blocks[0].pages[3].ocr_hash);
  });

  it('a shadow run writes nothing to pages and keeps its texts on the run (negative control)', async () => {
    const gemini = makeGemini();
    const deps = makeDeps(gemini);
    await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1, shadow: true });
    const run = await runToEnd(db, deps);
    expect(run.phase).toBe(PHASE.SHADOW_COMPLETE);
    expect(db.data.pages.every((p: Doc) => p.translation === undefined)).toBe(true);
    expect(run.drafts).toHaveLength(20);
    expect(run.repairs.map((r: Doc) => r.id)).toEqual(['p9', 'p17']);
    expect(run.seam_outcomes.every((o: Doc) => o.source === 'repair')).toBe(true);
  });

  it('a dead translate job writes nothing and closes its meter row as failed', async () => {
    const gemini = makeGemini({ translateState: 'JOB_STATE_FAILED' });
    const deps = makeDeps(gemini);
    await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    const run = await runToEnd(db, deps);
    expect(run.phase).toBe(PHASE.FAILED);
    expect(gemini.submitted).toHaveLength(1);
    expect(db.data.pages.every((p: Doc) => p.translation === undefined)).toBe(true);
    expect(deps.completeBatchUsage.mock.calls[0][0]).toMatchObject({ status: 'failed', insertIfMissing: false });
  });

  it('a job still running leaves the run where it is', async () => {
    const gemini = makeGemini({ translateState: 'JOB_STATE_RUNNING' });
    const deps = makeDeps(gemini);
    await startRun(db, 'bk1', deps, { prompts: PROMPTS, approvedUsd: 1 });
    const run = await db.collection(RUNS_COLLECTION).findOne({ book_id: 'bk1' });
    expect(await advanceRun(db, run, deps)).toMatchObject({ advanced: false, phase: PHASE.TRANSLATE_SUBMITTED });
  });
});

describe('nothing is sent to Gemini when a pre-flight refuses', () => {
  const cases: Array<[string, Doc, Doc]> = [
    ['estimate over the approval', {}, { approvedUsd: 0.000001 }],
    ['no approval given', {}, {}],
    ['spend dial closed', { budgetAllows: vi.fn(async () => false) }, { approvedUsd: 1 }],
  ];
  for (const [label, depOver, opts] of cases) {
    it(label, async () => {
      const db = makeDb({ books: [BOOK], pages: PAGES });
      const gemini = makeGemini();
      const res = await startRun(db, 'bk1', makeDeps(gemini, depOver), { prompts: PROMPTS, ...opts });
      expect(res.ok).toBe(false);
      expect(gemini.submitted).toHaveLength(0);
      expect(db.data[RUNS_COLLECTION] ?? []).toHaveLength(0);
    });
  }

  it('a held book, a book the realtime lane owns, and a book with an open run', async () => {
    for (const book of [
      { ...BOOK, pipeline_auto: { hold: { reason: 'ia-wrong-leaf-4790' } } },
      { ...BOOK, pipeline_auto: { status: 'translate_submitted' } },
    ]) {
      const db = makeDb({ books: [book], pages: PAGES });
      const gemini = makeGemini();
      expect((await startRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 1 })).ok).toBe(false);
      expect(gemini.submitted).toHaveLength(0);
    }
    const db = makeDb({ books: [BOOK], pages: PAGES, [RUNS_COLLECTION]: [{ id: 'r0', book_id: 'bk1', phase: PHASE.REPAIR_SUBMITTED }] });
    const gemini = makeGemini();
    expect((await startRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 1 })).reason).toMatch(/open-run r0/);
    expect(gemini.submitted).toHaveLength(0);
  });

  it('skips pages that are untranslatable or already translated', async () => {
    const pages = PAGES.map(p => ({ ...p }));
    pages[0] = { ...pages[0], translation: { data: 'already' } };
    pages[1] = { ...pages[1], ocr: { data: 'ba '.repeat(3000) } }; // a looping source (#4850)
    const db = makeDb({ books: [BOOK], pages });
    const gemini = makeGemini();
    const res = await startRun(db, 'bk1', makeDeps(gemini), { prompts: PROMPTS, approvedUsd: 1 });
    expect(res.run.page_count).toBe(18);
    expect(res.run.excluded).toEqual({ 'ocr-loop': 1 });
  });
});

describe('gateAllowsBook mirrors the realtime worker: envelopes open a closed dial for their books only', () => {
  it('open dial covers every book; closed dial covers only envelope books; all closed covers none', () => {
    expect(gateAllowsBook({ allowed: true, envelopeIds: null }, 'bk1')).toBe(true);
    expect(gateAllowsBook({ allowed: true, envelopeIds: new Set(['bk1', 'bk2']) }, 'bk1')).toBe(true);
    expect(gateAllowsBook({ allowed: true, envelopeIds: new Set(['bk2']) }, 'bk1')).toBe(false); // another lane's envelope is not ours
    expect(gateAllowsBook({ allowed: false, envelopeIds: null }, 'bk1')).toBe(false);
    expect(gateAllowsBook(undefined, 'bk1')).toBe(false);
  });
});
