/**
 * nextStep(book), pinned rule by rule (#5477, design: .claude/docs/pipeline-next-step.md).
 *
 * Every phase selects on `pipeline_auto.status`, a label written ahead of or behind the work; this
 * function derives the next step from what the book IS. Each rule below has one case, plus the named
 * shapes from the issue — the ones that made the label lie: the #4661 preview book stamped `complete`,
 * a dead source on a book whose images we already hold, an unstamped ladder read as done.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — scripts-side module, no types
import { nextStep, buildPipelineNext, pipelineNextChanged, stepForJobType, stampNextStep, BLOCKED_REASONS, PIPELINE_NEXT_VERSION, OCR_STALL_ATTEMPTS } from '../../scripts/lib/pipeline-next-step.mjs';
// @ts-expect-error — scripts-side module, no types
import { computeTranslationState } from '../../scripts/lib/page-counts.mjs';

const NOW = new Date('2026-10-01T12:00:00Z');

type Counts = { pages_count: number; pages_ocr?: number; pages_translated?: number; pages_blank?: number; pages_translatable?: number };

/** A book whose ladder comes from the real computeTranslationState, so the cases track the ladder's rule. */
function book(counts: Counts, extra: Record<string, unknown> = {}, opts: { language?: string; archived?: number } = {}) {
  const language = opts.language ?? 'Latin';
  return {
    _id: 'oid',
    id: 'b1',
    language,
    pages_count: counts.pages_count,
    pages_archived: opts.archived ?? counts.pages_count,
    translation_state: computeTranslationState(counts, { language }),
    summary: 'A summary.',
    chapters: [{ title: 'I' }],
    pipeline_auto: { status: 'complete', images_done_at: NOW },
    ...extra,
  };
}
const pa = (b: ReturnType<typeof book>, more: Record<string, unknown>) => ({ ...b, pipeline_auto: { ...b.pipeline_auto, ...more } });
const step = (b: object, opts = {}) => nextStep(b, { now: NOW, ...opts });

const DONE = { pages_count: 100, pages_ocr: 100, pages_translated: 100 };

describe('nextStep — rule 1: not a text', () => {
  it('rung no_pages is done (not_a_text)', () => {
    expect(step(book({ pages_count: 0 }))).toMatchObject({ step: 'done', reason: 'not_a_text' });
  });
  it('content_type artwork is done, even unstamped', () => {
    expect(step({ id: 'a', content_type: 'artwork' })).toMatchObject({ step: 'done', reason: 'not_a_text' });
  });
});

describe('nextStep — rule 2: held', () => {
  it('a held book is blocked: held, owned by its issue, re-checked daily', () => {
    const b = pa(book({ pages_count: 250, pages_ocr: 25 }), { status: 'held', hold: { reason: 'ia-wrong-leaf-4790', issue: 4790, release: 'x' } });
    expect(step(b)).toEqual({ step: 'blocked', reason: 'held', in_flight: false, owner: '#4790', recheck_at: new Date(NOW.getTime() + BLOCKED_REASONS.held.recheck) });
  });
  it('the hold wins over an open job and over a missing ladder', () => {
    const b = { id: 'h', pipeline_auto: { hold: { reason: 'x', release: 'y' } } };
    expect(step(b, { openJob: { type: 'translation' } })).toMatchObject({ step: 'blocked', reason: 'held', owner: 'pipeline-hold' });
  });
});

describe('nextStep — unstamped ladder', () => {
  it('no translation_state is blocked: unstamped, never done', () => {
    const b = { ...book(DONE), translation_state: undefined };
    expect(step(b)).toMatchObject({ step: 'blocked', reason: 'unstamped', owner: 'sync-worker' });
  });
  it('an unknown rung is unstamped too', () => {
    const b = { ...book(DONE), translation_state: { rung: 'finished' } };
    expect(step(b)).toMatchObject({ step: 'blocked', reason: 'unstamped' });
  });
});

describe('nextStep — rule 3: in flight', () => {
  it('an open job keeps the step that dispatched it', () => {
    const b = book({ pages_count: 100, pages_ocr: 100 }); // would be translate body
    expect(step(b, { openJob: { type: 'batch_ocr' } })).toMatchObject({ step: 'ocr', reason: 'job_open', in_flight: true, recheck_at: null });
  });
  it('an open job of unknown type keeps the derived step, in flight', () => {
    const b = book({ pages_count: 100, pages_ocr: 100 });
    expect(step(b, { openJob: { type: 'mystery' } })).toMatchObject({ step: 'translate', reason: 'body', in_flight: true });
  });
  it('a bare book.job pointer is not in flight — 4,816 of 4,852 name a cancelled job', () => {
    const b = book({ pages_count: 100, pages_ocr: 100 }, { job: { type: 'realtime', job_id: 'J' } });
    expect(step(b)).toMatchObject({ step: 'translate', in_flight: false });
  });
  it('job types map to steps', () => {
    expect(stepForJobType('image_extraction')).toBe('images');
    expect(stepForJobType('batch_ocr')).toBe('ocr');
    expect(stepForJobType('translation')).toBe('translate');
    expect(stepForJobType('summarize')).toBe('enrich');
    expect(stepForJobType('realtime')).toBeNull();
  });
});

describe('nextStep — rule 4: archive and source health', () => {
  const noImages = (more: Record<string, unknown> = {}) => pa(book({ pages_count: 200 }, {}, { archived: 10 }), more);
  it('images below 90% and no text: archive', () => {
    expect(step(noImages())).toMatchObject({ step: 'archive', reason: 'images_missing' });
  });
  it('verdict dead: blocked source_dead, 30 d', () => {
    expect(step(noImages({ archive_verdict: 'dead' }))).toMatchObject({ step: 'blocked', reason: 'source_dead', recheck_at: new Date(NOW.getTime() + 30 * 86400_000) });
  });
  it('verdict restricted: blocked source_restricted', () => {
    expect(step(noImages({ archive_verdict: 'restricted' }))).toMatchObject({ step: 'blocked', reason: 'source_restricted' });
  });
  it('a stall marker: blocked source_unreachable', () => {
    expect(step(noImages({ archive_stall: { unreachable_since: NOW } }))).toMatchObject({ step: 'blocked', reason: 'source_unreachable', owner: 'archiving-watchdog' });
  });
  it('escalated is dead only when the #4611 confirmation said gone; an unconfirmed escalation is unreachable', () => {
    expect(step(noImages({ archive_verdict: 'escalated', archive_confirm: { verdict: 'gone' } }))).toMatchObject({ reason: 'source_dead' });
    expect(step(noImages({ archive_verdict: 'escalated' }))).toMatchObject({ reason: 'source_unreachable' });
  });
  it('a dead source on a book whose images we already hold is NOT blocked', () => {
    const b = pa(book({ pages_count: 200, pages_ocr: 20 }, {}, { archived: 195 }), { archive_verdict: 'dead' });
    expect(step(b)).toMatchObject({ step: 'ocr', reason: 'transcribing' });
  });
  it('a dead source on a book that already has its text is NOT blocked, even with images missing', () => {
    const b = pa(book({ pages_count: 200, pages_ocr: 200 }, {}, { archived: 0 }), { archive_verdict: 'dead' });
    expect(step(b)).toMatchObject({ step: 'translate', reason: 'body' });
  });
});

describe('nextStep — rule 5: OCR policy', () => {
  it('no approved lane for the script: blocked ocr_policy', () => {
    const b = book({ pages_count: 100, pages_ocr: 0 }, {}, { language: 'Tibetan' });
    expect(step(b, { ocrPolicyBlocked: (x: { language: string }) => x.language === 'Tibetan' })).toMatchObject({ step: 'blocked', reason: 'ocr_policy' });
  });
  it('policy does not block a book that already has its text', () => {
    const b = book({ pages_count: 100, pages_ocr: 100 }, {}, { language: 'Tibetan' });
    expect(step(b, { ocrPolicyBlocked: () => true })).toMatchObject({ step: 'translate' });
  });
  it('with no registry (step 1) nothing is policy-blocked', () => {
    expect(step(book({ pages_count: 100, pages_ocr: 0 }, {}, { language: 'Tibetan' }))).toMatchObject({ step: 'ocr', reason: 'no_text' });
  });
});

describe('nextStep — rule 6: OCR', () => {
  it('the #4661 shape: 250 pages, 25 OCR\'d, status complete, gives ocr', () => {
    const b = book({ pages_count: 250, pages_ocr: 25, pages_translated: 25 });
    expect(b.pipeline_auto.status).toBe('complete');
    expect(step(b)).toMatchObject({ step: 'ocr', reason: 'transcribing', in_flight: false });
  });
  it('no OCR at all: ocr (no_text)', () => {
    expect(step(book({ pages_count: 50 }))).toMatchObject({ step: 'ocr', reason: 'no_text' });
  });
  it(`${OCR_STALL_ATTEMPTS} OCR issues without progress: blocked ocr_stalled`, () => {
    const b = pa(book({ pages_count: 250, pages_ocr: 200 }), { attempts: { ocr: { n: OCR_STALL_ATTEMPTS, last_progress: 0 } } });
    expect(step(b)).toMatchObject({ step: 'blocked', reason: 'ocr_stalled' });
    const once = pa(book({ pages_count: 250, pages_ocr: 200 }), { attempts: { ocr: { n: 1 } } });
    expect(step(once)).toMatchObject({ step: 'ocr' });
  });
});

describe('nextStep — rules 7–8: translate', () => {
  it('transcribed, not English: translate body', () => {
    expect(step(book({ pages_count: 100, pages_ocr: 100 }))).toMatchObject({ step: 'translate', reason: 'body' });
  });
  it('translating: translate body', () => {
    expect(step(book({ pages_count: 100, pages_ocr: 100, pages_translated: 40 }))).toMatchObject({ step: 'translate', reason: 'body' });
  });
  it('the readable tail gives translate with reason tail', () => {
    const b = book({ pages_count: 100, pages_ocr: 100, pages_translated: 95 });
    expect(b.translation_state.rung).toBe('readable');
    expect(step(b)).toMatchObject({ step: 'translate', reason: 'tail' });
  });
  it('an English original at transcribed skips translate', () => {
    const b = book({ pages_count: 100, pages_ocr: 100 }, {}, { language: 'English' });
    expect(b.translation_state).toMatchObject({ rung: 'transcribed', english_original: true });
    expect(step(b)).toMatchObject({ step: 'done' });
  });
  it('an English original at readable skips the tail too', () => {
    expect(step(book({ pages_count: 100, pages_ocr: 100, pages_translated: 95 }, {}, { language: 'English' }))).toMatchObject({ step: 'done' });
  });
});

describe('nextStep — rule 9: enrich', () => {
  it('no summary: enrich', () => {
    expect(step(book(DONE, { summary: undefined }))).toMatchObject({ step: 'enrich', reason: 'summary' });
  });
  it('no chapters: enrich', () => {
    expect(step(book(DONE, { chapters: [] }))).toMatchObject({ step: 'enrich', reason: 'chapters' });
  });
  it('a recorded summary_skipped_reason satisfies enrich', () => {
    const b = pa(book(DONE, { summary: undefined }), { summary_skipped_reason: 'too_short' });
    expect(step(b)).toMatchObject({ step: 'done' });
  });
  it('a recorded chapters_skipped_reason satisfies enrich', () => {
    expect(step(pa(book(DONE, { chapters: undefined }), { chapters_skipped_reason: 'single_work' }))).toMatchObject({ step: 'done' });
  });
  it('reads the scan projection shape (_has_summary / _chapters_n) the same way', () => {
    const b = { ...book(DONE), summary: undefined, chapters: undefined, _has_summary: true, _chapters_n: 0 };
    expect(step(b)).toMatchObject({ step: 'enrich', reason: 'chapters' });
    expect(step({ ...b, _chapters_n: 3 })).toMatchObject({ step: 'done' });
  });
});

describe('nextStep — rules 10–11: images, done', () => {
  it('no images stamp and no skip: images', () => {
    expect(step(pa(book(DONE), { images_done_at: undefined }))).toMatchObject({ step: 'images', reason: 'not_extracted' });
  });
  it('a recorded images_skipped_reason satisfies images', () => {
    expect(step(pa(book(DONE), { images_done_at: undefined, images_skipped_reason: 'no_candidates' }))).toMatchObject({ step: 'done', reason: 'finished' });
  });
  it('everything present: done', () => {
    expect(step(book(DONE))).toEqual({ step: 'done', reason: 'finished', in_flight: false, recheck_at: null, owner: null });
  });
});

describe('stored shape', () => {
  it('carries inputs, version and computed_at', () => {
    const b = pa(book({ pages_count: 200, pages_ocr: 20 }, {}, { archived: 196 }), { archive_verdict: 'dead' });
    expect(buildPipelineNext(b, { now: NOW })).toEqual({
      step: 'ocr', reason: 'transcribing', in_flight: false, recheck_at: null, owner: null,
      inputs: { rung: 'transcribing', archived: 0.98, verdict: 'dead', hold: null, job: null },
      version: PIPELINE_NEXT_VERSION, computed_at: NOW,
    });
  });
  it('keeps recheck_at while the book stays on the same blocked reason', () => {
    const b = { ...book(DONE), translation_state: undefined };
    const first = buildPipelineNext(b, { now: NOW });
    const later = buildPipelineNext({ ...b, pipeline_next: first }, { now: new Date(NOW.getTime() + 3600_000) });
    expect(later.recheck_at).toEqual(first.recheck_at);
    expect(pipelineNextChanged(first, later)).toBe(false);
  });
  it('a moved input or version is a change; computed_at alone is not', () => {
    const a = buildPipelineNext(book({ pages_count: 100, pages_ocr: 100 }), { now: NOW });
    expect(pipelineNextChanged(a, { ...a, computed_at: new Date() })).toBe(false);
    expect(pipelineNextChanged(a, { ...a, inputs: { ...a.inputs, archived: 0.5 } })).toBe(true);
    expect(pipelineNextChanged({ ...a, version: 0 }, a)).toBe(true);
    expect(pipelineNextChanged(undefined, a)).toBe(true);
  });
});

describe('stampNextStep', () => {
  function fakeDb(doc: object | null, openJobs: Array<{ id: string; type: string }> = []) {
    const writes: unknown[] = [];
    return {
      writes,
      collection: (name: string) => ({
        findOne: async () => (name === 'books' ? doc : null),
        find: () => ({ toArray: async () => (name === 'jobs' ? openJobs : []) }),
        updateOne: async (filter: unknown, update: unknown) => { writes.push({ filter, update }); return { modifiedCount: 1 }; },
      }),
    };
  }
  it('writes pipeline_next only, and resolves the open job from `jobs`', async () => {
    const db = fakeDb(book({ pages_count: 100, pages_ocr: 100 }, { job: { type: 'realtime', job_id: 'J' } }), [{ id: 'J', type: 'translation' }]);
    const r = await stampNextStep(db, { id: 'b1' }, { now: NOW });
    expect(r.pipeline_next).toMatchObject({ step: 'translate', in_flight: true, inputs: { job: 'J' } });
    expect(db.writes).toEqual([{ filter: { _id: 'oid' }, update: { $set: { pipeline_next: r.pipeline_next } } }]);
  });
  it('does not write an unchanged stamp, nor in dry run', async () => {
    const b = book(DONE);
    const stamped = { ...b, pipeline_next: buildPipelineNext(b, { now: NOW }) };
    const db = fakeDb(stamped);
    expect((await stampNextStep(db, { id: 'b1' }, { now: NOW })).changed).toBe(false);
    const db2 = fakeDb(b);
    expect((await stampNextStep(db2, { id: 'b1' }, { now: NOW, dryRun: true })).changed).toBe(true);
    expect(db.writes.length + db2.writes.length).toBe(0);
  });
});
