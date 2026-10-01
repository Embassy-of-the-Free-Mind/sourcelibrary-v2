/**
 * #4719: a book whose OCR is the 25-page preview must not be advanced to a post-OCR
 * status. On 2026-10-01, 947 such books reached `images_complete` (Phase 8 and the
 * batch collector). Each paid for a stage run over 25 pages, and each status ran
 * further ahead of the work.
 *
 * The first test is the exact shape: a stub at `chapters_complete` whose image
 * extraction finished. If the guard is removed or the bar loosened back to the
 * Phase 3.5 10% floor, it fails.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { previewStubVerdict, resolvePreviewStub, POST_OCR_STATUSES, REQUEUE_STATUS, GUARD_PROJECTION } from '../../scripts/lib/preview-stub-guard.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { MAX_STALLED_REQUEUES } from '../../scripts/lib/finalize-decision.mjs';

type Book = Record<string, unknown>;
const stub = (over: Book = {}): Book => ({
  id: 'b1', pages_count: 250, pages_ocr: 25, pages_blank: 0,
  pipeline_auto: { status: 'chapters_complete' }, ...over,
});

/** recountBook stand-in: returns these counters as the fresh count. */
const recountTo = (after: Book) => vi.fn(async () => ({ matched: true, after }));

describe('preview stub → back to the OCR queue', () => {
  it('a stub at chapters_complete whose image job finished goes to archive_complete, not images_complete', async () => {
    const book = stub();
    const recount = recountTo({ pages_count: 250, pages_ocr: 25, pages_blank: 0 });
    const v = await resolvePreviewStub({}, 'b1', book, 'images_complete', { recount });
    expect(v?.action).toBe('requeue');
    expect(v?.status).toBe(REQUEUE_STATUS);
    expect(REQUEUE_STATUS).toBe('archive_complete'); // the only status Phase 2 Pass 2 reads
    expect(recount).toHaveBeenCalledOnce();
  });

  it('records why, on the document, and keeps the refused status', () => {
    const v = previewStubVerdict(stub(), 'images_complete');
    expect(v.extra.reentered_reason).toMatch(/#4719/);
    expect(v.extra.reentered_reason).toMatch(/25\/250/);
    expect(v.extra.reentered_from).toEqual({ attempted: 'images_complete', from: 'chapters_complete' });
    expect(v.extra.retry_count).toBe(0);
  });

  it('catches a stub the Phase 3.5 10% floor lets through (25 of 200 = 12.5%)', () => {
    expect(previewStubVerdict(stub({ pages_count: 200 }), 'cover_selected')?.action).toBe('requeue');
  });

  it('guards every post-OCR completion status', () => {
    for (const s of POST_OCR_STATUSES) expect(previewStubVerdict(stub(), s)?.status).toBe('archive_complete');
  });
});

describe('books that must still advance', () => {
  it('a fully OCRd book advances, and is not recounted', async () => {
    const recount = recountTo({});
    const v = await resolvePreviewStub({}, 'b1', stub({ pages_ocr: 250 }), 'images_complete', { recount });
    expect(v).toBeNull();
    expect(recount).not.toHaveBeenCalled();
  });

  it('a book with many blank pages advances: blanks leave the denominator', () => {
    // 140 OCRd of 300, 120 of them blank leaves: 140/180 = 78%. Read against the raw
    // page count (47%) it would be sent back forever. Blank pages carry OCR, so they
    // can only make the guard more lenient.
    const book = stub({ pages_count: 300, pages_ocr: 140, pages_blank: 120 });
    expect(previewStubVerdict(book, 'images_complete')).toBeNull();
    expect(previewStubVerdict({ ...book, pages_blank: 0 }, 'images_complete')?.action).toBe('requeue');
  });

  it('a stale counter does not send back a book whose full OCR just landed', async () => {
    // Stored pages_ocr still reads the preview. The live recount sees the finished OCR.
    const recount = recountTo({ pages_count: 250, pages_ocr: 248, pages_blank: 0 });
    const v = await resolvePreviewStub({}, 'b1', stub({ pipeline_auto: { status: 'ocr_submitted' } }), 'ocr_complete', { recount });
    expect(v).toBeNull();
    expect(recount).toHaveBeenCalledOnce();
  });

  it('leaves the 50–90% band alone, as Phase 9 does', () => {
    expect(previewStubVerdict(stub({ pages_ocr: 150 }), 'complete')).toBeNull();
  });

  it('does not touch statuses outside the post-OCR completion set', () => {
    // *_submitted: a job is already in flight, and redirecting would orphan it (#4839).
    for (const s of ['archive_complete', 'archiving', 'ocr_submitted', 'translate_submitted', 'images_submitted', 'needs_attention', 'failed', 'held']) {
      expect(previewStubVerdict(stub(), s)).toBeNull();
    }
  });

  it('skips artwork, zero-page and zero-OCR records (other guards own them)', () => {
    expect(previewStubVerdict(stub({ resource_type: 'image' }), 'complete')).toBeNull();
    expect(previewStubVerdict(stub({ content_type: 'artwork' }), 'complete')).toBeNull();
    expect(previewStubVerdict(stub({ pages_count: 0 }), 'complete')).toBeNull();
    expect(previewStubVerdict(stub({ pages_ocr: 0 }), 'complete')).toBeNull();
  });
});

describe('the requeue terminates', () => {
  it('shares the requeue counter with Phase 9 and advances it', () => {
    const v = previewStubVerdict(stub({ pipeline_auto: { status: 'chapters_complete', finalize_ocr_requeues: 1, finalize_last_ocr: 10 } }), 'images_complete');
    expect(v.extra.finalize_ocr_requeues).toBe(2);
    expect(v.extra.finalize_last_ocr).toBe(25);
  });

  it('parks a stub whose requeues added no pages, with the numbers in the message', () => {
    const v = previewStubVerdict(stub({ pipeline_auto: { status: 'chapters_complete', finalize_ocr_requeues: MAX_STALLED_REQUEUES, finalize_last_ocr: 25 } }), 'images_complete');
    expect(v.action).toBe('needs_attention');
    expect(v.status).toBe('needs_attention');
    expect(v.extra.error).toMatch(/stalled at 25\/250/);
  });
});

describe('the writers actually call it', () => {
  const root = path.resolve(__dirname, '../..');
  const orch = readFileSync(path.join(root, 'scripts/workers/pipeline-orchestrator.mjs'), 'utf8');
  const coll = readFileSync(path.join(root, 'scripts/workers/batch-collector.mjs'), 'utf8');

  it('setPipelineStatus runs the guard, after the hold check and before the output guard', () => {
    const body = orch.slice(orch.indexOf('async function setPipelineStatus('), orch.indexOf('async function markFailed('));
    const hold = body.indexOf('holdViolation(');
    const guard = body.indexOf('resolvePreviewStub(');
    const output = body.indexOf('statusOutputViolation(');
    expect(hold).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(hold);
    expect(output).toBeGreaterThan(guard);
    // A projected-away counter reads as 0, and a 0 would push back every book.
    for (const f of Object.keys(GUARD_PROJECTION)) expect(body).toMatch(new RegExp(`\\b${f}: 1`));
  });

  it('the batch collector routes all three write-backs through the guard', () => {
    for (const s of ['ocr_complete', 'translate_complete', 'images_complete']) {
      expect(coll).toContain(`guardedStatusSet(db, bookId, '${s}', status)`);
    }
    expect(coll).not.toMatch(/'pipeline_auto\.status': '(ocr_complete|translate_complete|images_complete)'/);
  });
});
