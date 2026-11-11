import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs worker lib, no types
import { gapFilter, REALTIME_LANE_STATUSES, enrichPauseMode, READABLE_ENOUGH_TO_ENRICH, hasWithheldPages, enrichmentSkip, ENRICHABLE_HOLD_REASONS, WITHHELD_MAX_SHARE } from '../../scripts/workers/lib/enrich-batch-lane.mjs';

/**
 * A tiny matcher for the handful of Mongo operators these filters use, so the assertions below EXERCISE the predicate
 * against documents instead of pinning how it is spelled (tests-that-are-not-guards.md: assert the relationship, not
 * the expression). It deliberately supports only what is used here; an unknown operator throws rather than passing.
 */
function matches(filter: Record<string, unknown>, doc: Record<string, unknown>): boolean {
  const get = (d: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), d);
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Array<Record<string, unknown>>).some((c) => matches(c, doc));
    if (k === '$and') return (cond as Array<Record<string, unknown>>).every((c) => matches(c, doc));
    if (k === '$nor') return !(cond as Array<Record<string, unknown>>).some((c) => matches(c, doc));
    const v = get(doc, k);
    if (cond === null || typeof cond !== 'object') return v === cond;
    return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
      switch (op) {
        case '$in': return (arg as unknown[]).includes(v as never);
        case '$nin': return !(arg as unknown[]).includes(v as never);
        case '$exists': return (v !== undefined) === arg;
        case '$gt': return typeof v === 'number' && v > (arg as number);
        case '$gte': return typeof v === 'number' && v >= (arg as number);
        case '$ne': return v !== arg;
        case '$size': return Array.isArray(v) && v.length === arg;
        default: throw new Error(`matcher: unsupported operator ${op}`);
      }
    });
  });
}

/**
 * The Batch API enrich lane (#2141) selects books by MISSING OUTPUT. Its exclusions are what keep
 * it off books whose derived lane must wait (held #4790, bad reads) and off books the realtime
 * status-driven lane owns (so the two never pay twice for one book).
 */
describe('enrich batch lane gap filter', () => {
  const f = gapFilter();

  it('selects only live books', () => {
    expect(f.visible).toBe(true);
    expect(f.pages_count).toEqual({ $gt: 0 });
  });

  /**
   * The gate that replaced `pages_translated > 0`. A summary is derived from the book's English, so the book has to be
   * readable in English: the `readable`/`complete` rungs, or an English original from `transcribed` up (its English is
   * its own transcription, #6559). Both halves are real production shapes measured on 2026-11-02.
   */
  describe('readable enough to summarise', () => {
    const rung = (r: string, englishOriginal = false) => ({ translation_state: { rung: r, english_original: englishOriginal } });

    it('takes a book that is readable or complete', () => {
      for (const r of ['readable', 'complete']) expect(matches(READABLE_ENOUGH_TO_ENRICH, rung(r)), r).toBe(true);
    });

    it('refuses a part-translated book: a summary of one page is not a summary of the book', () => {
      // The 431-page Walras with ONE translated page, enriched on 2026-11-02 before this gate existed.
      for (const r of ['transcribing', 'translating', 'transcribed', 'no_text', 'no_pages']) {
        expect(matches(READABLE_ENOUGH_TO_ENRICH, rung(r)), r).toBe(false);
      }
    });

    it('takes an English original from `transcribed` up, which pages_translated > 0 could never do', () => {
      for (const r of ['transcribed', 'translating', 'readable', 'complete']) {
        expect(matches(READABLE_ENOUGH_TO_ENRICH, rung(r, true)), r).toBe(true);
      }
      // ...but not one that has no readable text yet.
      for (const r of ['transcribing', 'no_text']) expect(matches(READABLE_ENOUGH_TO_ENRICH, rung(r, true)), r).toBe(false);
    });

    it('is inside $and, so it cannot collide with the missing-output $or', () => {
      expect(f.$and).toContainEqual(READABLE_ENOUGH_TO_ENRICH);
      expect(f.$or).toBeDefined();           // the missing-output clause still stands
      expect(f.$or).not.toEqual(READABLE_ENOUGH_TO_ENRICH.$or);
    });

    /**
     * The clause above only proves the CONSTANT is right. This runs the whole of `gapFilter()` against documents, so it
     * goes red if the filter stops applying the gate however it is spelled — the negative control the constant's own
     * tests cannot give (tests-that-are-not-guards.md: a test of the policy object is not a test of its call site).
     */
    it('gapFilter itself refuses a part-translated book and takes a readable one', () => {
      const book = (ts: object, extra: object = {}) => ({
        visible: true, pages_count: 431, summary: null, translation_state: ts,
        pipeline_auto: { status: 'complete' }, needs_resplit: false, source_unrecoverable: false,
        spread_translation_crisis: false, translation_stale_reason: '', ...extra,
      });
      // The Walras: 431 pages, 1 translated. Admitted before this gate, and summarised from that one page.
      expect(matches(f, book({ rung: 'translating', english_original: false }))).toBe(false);
      expect(matches(f, book({ rung: 'readable', english_original: false }))).toBe(true);
      expect(matches(f, book({ rung: 'complete', english_original: false }))).toBe(true);
      // Brinton's Cakchiquel grammar: English original, 0 translated pages, readable at `transcribed` (#6559).
      expect(matches(f, book({ rung: 'transcribed', english_original: true }))).toBe(true);
      expect(matches(f, book({ rung: 'transcribed', english_original: false }))).toBe(false);
      // The other exclusions still bite, so this is not matching everything.
      expect(matches(f, book({ rung: 'complete' }, { visible: false }))).toBe(false);
      expect(matches(f, book({ rung: 'complete' }, { pipeline_auto: { status: 'summarizing' } }))).toBe(false);
      expect(matches(f, book({ rung: 'complete' }, { summary: 'already written', 'index.generatedAt': '2026-01-01', chapters_extracted_at: '2026-01-01' }))).toBe(false);
    });
  });

  it('refuses held books by marker and by status', () => {
    expect(f['pipeline_auto.hold']).toEqual({ $exists: false });
    expect(f['pipeline_auto.status'].$nin).toContain('held');
  });

  it('leaves the realtime lane its own statuses', () => {
    for (const s of ['translate_complete', 'summarizing', 'summary_indexed', 'chapters']) {
      expect(REALTIME_LANE_STATUSES).toContain(s);
    }
    expect(f['pipeline_auto.status'].$nin).toEqual(REALTIME_LANE_STATUSES);
  });

  it('excludes bad-read flags', () => {
    for (const k of ['needs_resplit', 'source_unrecoverable', 'spread_translation_crisis', 'translation_stale_reason']) {
      expect(f[k]).toBeDefined();
    }
  });

  it('a scope confines, it never widens', () => {
    const scoped = gapFilter({ id: { $in: ['a', 'b'] } });
    expect(scoped.id).toEqual({ $in: ['a', 'b'] });
    expect(scoped.visible).toBe(true);
  });
});

// #5496 review B2: enrich_batch_jobs in `submitted` are already paid. A pause must stop the
// lane from SUBMITTING, never from COLLECTING, or Gemini expires the jobs at 48 h.
describe('enrichPauseMode — a pause never strands a paid batch', () => {
  const ctl = (c: object) => ({ _id: 'processing_control', ...c });
  const paused: Array<[string, object]> = [
    ['enrich key', { paused_phases: ['enrich'] }],
    ['legacy name', { paused_phases: ['enrichment'] }],
    ['legacy number 6', { paused_phases: [6] }],
    ['global pause, no scope', { paused: true }],
  ];
  for (const [label, c] of paused) {
    it(`${label}: --batch runs collect-only, realtime skips`, () => {
      expect(enrichPauseMode(ctl(c), { batchMode: true })).toMatchObject({ mode: 'collect-only' });
      expect(enrichPauseMode(ctl(c), { batchMode: false })).toMatchObject({ mode: 'skip' });
    });
  }
  it('no pause, or an unrelated key: full run', () => {
    for (const c of [{}, { paused_phases: ['ocr', 'images'] }]) {
      expect(enrichPauseMode(ctl(c), { batchMode: true })).toEqual({ mode: 'run', reason: null });
      expect(enrichPauseMode(ctl(c), { batchMode: false })).toEqual({ mode: 'run', reason: null });
    }
  });
  it('a global pause with a scope runs (the scope confines books later); a step pause beats a scope', () => {
    expect(enrichPauseMode(ctl({ paused: true, allow_book_ids: ['b1'] }), { batchMode: false }).mode).toBe('run');
    expect(enrichPauseMode(ctl({ paused_phases: ['enrich'], allow_book_ids: ['b1'] }), { batchMode: true }).mode).toBe('collect-only');
  });
});


/**
 * `translation_withheld` is an ARCHIVE (it holds the OLD English), not a state. Reading it as a state made
 * hasWithheldPages true for every book that had EVER had a page withheld — 343 of 343 queued books on 2026-11-02 —
 * so both enrichment lanes skipped the whole backlog. The reader checks the text first; so must this.
 */
describe('hasWithheldPages — the archive is not the state', () => {
  /** A fake `pages` collection that answers findOne by running the real query through the matcher. */
  const dbOf = (pages: Array<Record<string, unknown>>) => ({
    collection: (name: string) => {
      if (name !== 'pages') throw new Error(`unexpected collection ${name}`);
      return { findOne: async (q: Record<string, unknown>) => pages.find((p) => matches(q, p)) ?? null };
    },
  });

  const archived = { book_id: 'b', page_number: 1, translation_withheld: { reason: 'wrong leaf (#5274)' }, translation: { data: 'the repaired English' } };
  const withheld = { book_id: 'b', page_number: 2, translation_withheld: { reason: 'wrong leaf (#5274)' } };
  const plain = { book_id: 'b', page_number: 3, translation: { data: 'English' } };

  it('a repaired page keeps its archive record and must NOT block the book', async () => {
    expect(await hasWithheldPages(dbOf([plain, archived]), 'b')).toBe(false);
  });

  it('a page whose English is actually gone DOES block the book', async () => {
    expect(await hasWithheldPages(dbOf([plain, archived, withheld]), 'b')).toBe(true);
  });

  it('an empty string is withheld too, not text', async () => {
    expect(await hasWithheldPages(dbOf([{ ...withheld, translation: { data: '' } }]), 'b')).toBe(true);
  });

  it('a book with no withheld history at all is clear', async () => {
    expect(await hasWithheldPages(dbOf([plain]), 'b')).toBe(false);
  });

  it('scopes to the book: another book\'s withheld page is not ours', async () => {
    expect(await hasWithheldPages(dbOf([{ ...withheld, book_id: 'other' }]), 'b')).toBe(false);
  });
});

/** #8482 part B: a small withheld share and an allowlisted lane hold no longer keep a translated book out. */
describe('enrichmentSkip — withheld share and lane holds', () => {
  const dbOf = (withheldIds: string[], untranslated: boolean) => ({
    collection: () => ({
      find: () => ({ toArray: async () => withheldIds.map((id) => ({ id })) }),
      findOne: async () => (untranslated ? { _id: 1 } : null),
    }),
  });
  const book = (over: Record<string, unknown> = {}) => ({ id: 'b', pages_translatable: 100, pages_count: 100, ...over });
  const opts = { allowHeld: true, tolerateWithheld: true };

  it('admits a book with withheld pages at or under the share and returns their ids to leave out', async () => {
    expect(WITHHELD_MAX_SHARE).toBe(0.02);
    expect(await enrichmentSkip(dbOf(['p1', 'p2'], false), book(), opts)).toEqual({ skip: null, withheldIds: ['p1', 'p2'] });
  });
  it('skips a book over the share', async () => {
    expect((await enrichmentSkip(dbOf(['p1', 'p2', 'p3'], false), book(), opts)).skip).toBe('withheld>2%');
  });
  it('without tolerance any withheld page skips (the batch lane)', async () => {
    expect((await enrichmentSkip(dbOf(['p1'], false), book(), { allowHeld: false })).skip).toBe('withheld>2%');
  });
  it('an allowlisted hold is admitted only when nothing is left untranslated', async () => {
    const reason = Object.keys(ENRICHABLE_HOLD_REASONS)[0];
    const held = book({ pipeline_auto: { hold: { reason } } });
    expect((await enrichmentSkip(dbOf([], false), held, opts)).skip).toBeNull();
    expect((await enrichmentSkip(dbOf([], true), held, opts)).skip).toBe(`held-untranslated:${reason}`);
  });
  it('an unknown or containment hold stays out, and so does every hold when allowHeld is off', async () => {
    expect((await enrichmentSkip(dbOf([], false), book({ pipeline_auto: { hold: { reason: 'invented-page-7991' } } }), opts)).skip).toBe('held:invented-page-7991');
    const reason = Object.keys(ENRICHABLE_HOLD_REASONS)[0];
    expect((await enrichmentSkip(dbOf([], false), book({ pipeline_auto: { hold: { reason } } }), { allowHeld: false })).skip).toBe(`held:${reason}`);
  });
  it('the allowlist names no containment, rights or approval-pending hold', () => {
    for (const r of Object.keys(ENRICHABLE_HOLD_REASONS)) expect(r).not.toMatch(/invent|wrong-leaf|contain|leak|tengyur|kangyur|unsettled|scans-only/);
  });
});
