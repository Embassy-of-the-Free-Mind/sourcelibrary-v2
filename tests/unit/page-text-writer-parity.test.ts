/**
 * writePageText twins (#7058): src/lib/page-text-writer.ts (routes) vs
 * scripts/lib/page-text-writer.mjs (workers, maintenance). Runs both over the same fixtures
 * and the same in-memory page store, and fails on any divergence — and pins the behaviour
 * the twins share: every edit is a revision with the whole prior object, an edit to empty is
 * still recorded, human edits are refused, a concurrent change is a conflict, and a writer
 * row restores to exactly the field it replaced.
 */
import { describe, it, expect } from 'vitest';
import * as ts from '@/lib/page-text-writer';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as mjs from '../../scripts/lib/page-text-writer.mjs';

type Doc = Record<string, unknown>;
const get = (doc: Doc, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Doc)[k] : undefined), doc);

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Doc;
      if ('$in' in c) return (c.$in as unknown[]).some((x) => (x === null ? v === null || v === undefined : x === v));
      if ('$ne' in c) return v !== c.$ne;
      if ('$exists' in c) return (v !== undefined) === c.$exists;
    }
    return v === cond;
  });
}

/** Just enough of a Mongo Db for the writer: findOne, insertOne, updateOne with $set/$unset. */
function fakeDb(pages: Doc[]) {
  const store: Record<string, Doc[]> = { pages: structuredClone(pages), page_revisions: [] };
  const hooks: { beforeUpdate?: () => void } = {};
  const collection = (name: string) => {
    store[name] ??= [];
    const rows = store[name];
    return {
      findOne: async (f: Doc) => { const d = rows.find((r) => matches(r, f)); return d ? structuredClone(d) : null; },
      find: (f: Doc) => ({
        sort: () => ({ toArray: async () => rows.filter((r) => matches(r, f)).map((r) => structuredClone(r)) }),
      }),
      insertOne: async (d: Doc) => { rows.push(structuredClone(d)); return { acknowledged: true }; },
      updateOne: async (f: Doc, u: Doc) => {
        if (name === 'pages') hooks.beforeUpdate?.();
        const d = rows.find((r) => matches(r, f));
        if (!d) return { matchedCount: 0, modifiedCount: 0 };
        for (const [k, v] of Object.entries((u.$set as Doc) || {})) d[k] = structuredClone(v);
        for (const k of Object.keys((u.$unset as Doc) || {})) delete d[k];
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
  };
  return { db: { collection } as never, store, hooks };
}

const NOW = new Date('2026-10-21T00:00:00Z');
const OPTS = { by: 'scripts/maintenance/reset-book-ocr.mjs', reason: 'test', run_id: 'run-1', now: NOW, id: 'rev1' };
const AI_OCR = {
  data: 'Lorem ipsum', source: 'batch_api', model: 'gemini-3.1-flash-lite', language: 'Latin', prompt_version: 'v10',
  batch_job_id: 'job9', updated_at: new Date('2026-01-01T00:00:00Z'), content_hash: 'abc', engine: { schema: 'gemini-engine/1' },
  pipeline: { attempt: 2 }, unreadable: false,
};
const PAGES: Doc[] = [
  { id: 'p-ai', book_id: 'b1', ocr: AI_OCR, translation: { data: 'Some text', source_language: 'Latin', source: 'ai' } },
  { id: 'p-empty', book_id: 'b1' },
  { id: 'p-skip', book_id: 'b1', ocr: { source: 'skip' } },
  { id: 'p-manual', book_id: 'b1', ocr: { data: 'Fixed by hand', source: 'manual', edited_by: 'scholar@x' } },
  { id: 'p-edited', book_id: 'b1', translation: { data: 'Hand', source: 'ai', edited_by: 'scholar@x' } },
  { id: 'p-legacy', book_id: 'b1', ocr: 'a bare string' },
];

type Twin = typeof ts;
const TWINS: [string, Twin][] = [['ts', ts], ['mjs', mjs as unknown as Twin]];

async function run(twin: Twin, pageId: string, field: 'ocr' | 'translation', next: ts.NextField, extra: Partial<ts.WritePageTextOpts> = {}, race = false) {
  const { db, store, hooks } = fakeDb(PAGES);
  if (race) hooks.beforeUpdate = () => { const p = store.pages.find((r) => r.id === pageId)!; p[field] = { data: 'someone else', source: 'ai' }; };
  let out: unknown;
  try { out = await twin.writePageText(db, pageId, field, next, { ...OPTS, ...extra }); } catch (e) { out = { threw: (e as Error).message }; }
  return { out, pages: store.pages, revisions: store.page_revisions };
}

const CASES: [string, 'ocr' | 'translation', ts.NextField, Partial<ts.WritePageTextOpts>?, boolean?][] = [
  ['p-ai', 'ocr', null],
  ['p-ai', 'ocr', { data: 'New text', source: 'batch_api' }],
  ['p-ai', 'ocr', { data: '' }],
  ['p-ai', 'translation', null],
  ['p-empty', 'ocr', null],
  ['p-empty', 'ocr', { data: 'First read', source: 'ai', updated_at: new Date('2026-02-02T00:00:00Z'), content_hash: 'given' }],
  ['p-skip', 'ocr', null],
  ['p-manual', 'ocr', null],
  ['p-manual', 'ocr', { data: 'x' }, { overrideHumanEdit: true, by: 'scholar@y' }],
  ['p-edited', 'translation', { data: 'y' }],
  ['p-legacy', 'ocr', null],
  ['p-ai', 'ocr', { data: 'raced' }, {}, true],
  ['missing', 'ocr', null],
  ['p-ai', 'summary' as never, null],
  ['p-ai', 'ocr', { data: 'v' }, { verbatim: true }],
  ['p-ai', 'ocr', { data: 5 } as never],
  ['p-ai', 'ocr', { source: 'skip' }],
  ['p-ai', 'ocr', null, { by: '' }],
  ['p-ai', 'ocr', null, { reason: ' ' }],
];

describe('writePageText twins agree', () => {
  it.each(CASES.map((c, i) => [i, ...c] as const))('case %i: %s %s', async (_i, pageId, field, next, extra, race) => {
    const a = await run(ts, pageId, field, next, extra, race);
    const b = await run(mjs as unknown as Twin, pageId, field, next, extra, race);
    expect(b).toEqual(a);
  });

  it('pure helpers agree', () => {
    for (const p of PAGES) for (const f of ['ocr', 'translation'] as const) {
      expect(mjs.isHumanEditedField(p[f])).toBe(ts.isHumanEditedField(p[f]));
      expect(mjs.textHash(p[f])).toBe(ts.textHash(p[f]));
      expect(mjs.casFilter(p.id, f, p[f])).toEqual(ts.casFilter(p.id as string, f, p[f]));
      expect(mjs.casFilter(p.id, f, p[f], { overrideHumanEdit: true })).toEqual(ts.casFilter(p.id as string, f, p[f], { overrideHumanEdit: true }));
      const rev = ts.buildTextRevision({ page: p, field: f, next: null, opts: OPTS, now: NOW, id: 'r' });
      expect(mjs.buildTextRevision({ page: p, field: f, next: null, opts: OPTS, now: NOW, id: 'r' })).toEqual(rev);
      expect(mjs.priorFieldFromRevision(rev)).toEqual(ts.priorFieldFromRevision(rev));
    }
    expect(mjs.WRITER_ID).toBe(ts.WRITER_ID);
    expect([...mjs.PAGE_TEXT_FIELDS]).toEqual([...ts.PAGE_TEXT_FIELDS]);
  });
});

describe.each(TWINS)('writePageText behaviour (%s)', (_name, twin) => {
  it('an edit to empty keeps the WHOLE prior object, unsets the field, and records next_hash null', async () => {
    const { out, pages, revisions } = await run(twin, 'p-ai', 'ocr', null);
    expect(out).toMatchObject({ status: 'written', revision_id: 'rev1', prior_hash: ts.textHash(AI_OCR), next_hash: null });
    expect(pages.find((p) => p.id === 'p-ai')!.ocr).toBeUndefined();
    expect(revisions).toHaveLength(1);
    const rev = revisions[0];
    expect(rev).toMatchObject({ page_id: 'p-ai', book_id: 'b1', field: 'ocr', data: 'Lorem ipsum', by: OPTS.by, reason: 'test', run_id: 'run-1', writer: ts.WRITER_ID });
    // the full prior field, provenance and pipeline keys included, comes back exactly
    expect(twin.priorFieldFromRevision(rev)).toEqual(AI_OCR);
  });

  it('a write stamps content_hash and the revision carries the new text hash', async () => {
    const { pages, revisions } = await run(twin, 'p-ai', 'ocr', { data: 'New text', source: 'batch_api' });
    const ocr = pages.find((p) => p.id === 'p-ai')!.ocr as Doc;
    expect(ocr).toMatchObject({ data: 'New text', content_hash: revisions[0].next_hash, updated_at: NOW });
  });

  it('a first write records an absent prior that restores to absent', async () => {
    const { out, revisions } = await run(twin, 'p-empty', 'ocr', { data: 'First read' });
    expect(out).toMatchObject({ status: 'written' });
    expect(revisions[0]).toMatchObject({ prior_state: 'absent', data: '', source: 'empty', prior_hash: null });
    expect(twin.priorFieldFromRevision(revisions[0])).toBeNull();
  });

  it('a data-less marker object is written as given and restores exactly (revert of a cleared marker)', async () => {
    const { pages, revisions } = await run(twin, 'p-skip', 'ocr', null);
    expect(pages.find((p) => p.id === 'p-skip')!.ocr).toBeUndefined();
    const prior = twin.priorFieldFromRevision(revisions[0]);
    expect(prior).toEqual({ source: 'skip' });
    const back = await run(twin, 'p-empty', 'ocr', prior as ts.NextField);
    expect((back.pages.find((p) => p.id === 'p-empty')!.ocr as Doc).source).toBe('skip');
    expect(back.revisions[0].next_hash).toBeNull();
  });

  it('clearing an absent field writes nothing', async () => {
    const { out, revisions } = await run(twin, 'p-empty', 'ocr', null);
    expect(out).toMatchObject({ status: 'unchanged' });
    expect(revisions).toHaveLength(0);
  });

  it('refuses a human edit unless overridden', async () => {
    for (const [id, f] of [['p-manual', 'ocr'], ['p-edited', 'translation']] as const) {
      const { out, pages, revisions } = await run(twin, id, f, null);
      expect(out).toMatchObject({ status: 'refused_human_edit' });
      expect(revisions).toHaveLength(0);
      expect(pages.find((p) => p.id === id)![f]).toBeDefined();
    }
    const { out } = await run(twin, 'p-manual', 'ocr', { data: 'x' }, { overrideHumanEdit: true });
    expect(out).toMatchObject({ status: 'written' });
  });

  it('a concurrent change is a conflict: nothing overwritten, row marked aborted', async () => {
    const { out, pages, revisions } = await run(twin, 'p-ai', 'ocr', { data: 'raced' }, {}, true);
    expect(out).toMatchObject({ status: 'conflict' });
    expect((pages.find((p) => p.id === 'p-ai')!.ocr as Doc).data).toBe('someone else');
    expect(revisions[0].aborted).toBe('conflict');
  });

  it('rejects malformed calls', async () => {
    for (const [f, n, o] of [['summary', null, {}], ['ocr', { data: 5 }, {}], ['ocr', 'text', {}], ['ocr', null, { by: '' }], ['ocr', null, { reason: '' }], ['ocr', null, { run_id: '' }]] as const) {
      const { out } = await run(twin, 'p-ai', f as never, n as never, o as never);
      expect(out).toHaveProperty('threw');
    }
  });
});

describe('revertRun (mjs) — undo a run without clobbering anything newer', () => {
  const ORIG_A = { data: 'alpha', source: 'batch_api', engine: { schema: 'gemini-engine/1' }, content_hash: 'h' };
  const START: Doc[] = [
    { id: 'A', book_id: 'b1', ocr: ORIG_A },
    { id: 'B', book_id: 'b1', ocr: { data: 'beta', source: 'ai' } },
    { id: 'C', book_id: 'b2', ocr: { source: 'skip' } },
    { id: 'D', book_id: 'b2' },
  ];
  const by = { by: 'test', reason: 'reset' };

  async function afterRun() {
    const { db, store } = fakeDb(START);
    for (const id of ['A', 'B', 'C', 'D']) await mjs.writePageText(db, id, 'ocr', null, { ...by, run_id: 'X' });
    // a newer edit lands on B after the run
    await mjs.writePageText(db, 'B', 'ocr', { data: 'newer', source: 'manual', edited_by: 'scholar' }, { by: 'scholar', reason: 'fix' });
    return { db, store };
  }

  it('dry run plans the restore and writes nothing', async () => {
    const { db, store } = await afterRun();
    const before = structuredClone(store.pages);
    const res = await mjs.revertRun(db, 'X');
    expect(res).toMatchObject({ rows: 3, targets: 3, restorable: 2, missing: [] });
    expect(res.changed).toEqual([{ page_id: 'B', field: 'ocr', book_id: 'b1' }]);
    expect(store.pages).toEqual(before);
  });

  it('--apply restores exactly what the run replaced, leaves the newer edit alone, and is itself revertible', async () => {
    const { db, store } = await afterRun();
    const res = await mjs.revertRun(db, 'X', { apply: true });
    expect(res.tally).toEqual({ written: 2 });
    expect(new Set(res.book_ids)).toEqual(new Set(['b1', 'b2']));
    const page = (id: string) => store.pages.find((p) => p.id === id)!;
    expect(page('A').ocr).toEqual(ORIG_A);
    expect(page('C').ocr).toEqual({ source: 'skip' });
    expect((page('B').ocr as Doc).data).toBe('newer');
    expect(page('D').ocr).toBeUndefined();
    const again = await mjs.revertRun(db, 'revert:X');
    expect(again.restorable).toBe(2);
  });

  it('a run id with no writer rows reverts nothing', async () => {
    const { db } = await afterRun();
    expect(await mjs.revertRun(db, 'nope', { apply: true })).toMatchObject({ rows: 0, targets: 0, restorable: 0 });
  });
});
