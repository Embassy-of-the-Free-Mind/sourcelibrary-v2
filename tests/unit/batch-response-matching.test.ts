/**
 * #4685(b): the batch-lane translation collector (scripts/batch/collect-batch-results.mjs,
 * cron'd every 30 min in production — scripts/workers/crontab.production) used to fall
 * back to positional matching (`result.metadata?.key || job.page_ids[idx]`) whenever a
 * Gemini Batch API response was missing its metadata.key. That is the same fallback that
 * caused the 2026-03-24 cross-book contamination incident (see
 * scripts/maintenance/fix-batch-contamination.mjs) and was already removed from the
 * sibling collector scripts/workers/batch-collector.mjs at the time — this collector
 * never got the same fix, and kept silently dropping pages at consistent-looking indices
 * for 4 more months, with the job itself reporting 100% success (measured on production
 * data: job.completed_pages === job.page_ids.length, job.failed_pages === 0, while 5-8
 * of those page_ids never received a translation).
 *
 * These tests exercise the extracted, pure matching logic in
 * scripts/lib/batch-response-matching.mjs directly — no Mongo, no Gemini API.
 */
import { describe, it, expect } from 'vitest';
import { resolveSinglePageBatchResponses, findUnresolvedPageIds } from '../../scripts/lib/batch-response-matching.mjs';

function fakeResponse(pageId: string | undefined, text: string | undefined) {
  return {
    metadata: pageId ? { key: pageId } : undefined,
    response: {
      candidates: [{ content: { parts: [{ text }] } }],
    },
  };
}

describe('resolveSinglePageBatchResponses (#4685b)', () => {
  it('matches every response to its own page by metadata.key when nothing is missing', () => {
    const jobPageIds = ['p1', 'p2', 'p3'];
    const responses = [
      fakeResponse('p1', 'translation one'),
      fakeResponse('p2', 'translation two'),
      fakeResponse('p3', 'translation three'),
    ];
    const reasons: string[] = [];
    const { pageResults, failCount } = resolveSinglePageBatchResponses(responses, jobPageIds, (r) => reasons.push(r));

    expect(failCount).toBe(0);
    expect(pageResults).toEqual([
      { pageId: 'p1', text: 'translation one', usage: undefined },
      { pageId: 'p2', text: 'translation two', usage: undefined },
      { pageId: 'p3', text: 'translation three', usage: undefined },
    ]);
  });

  it('drops a response with no metadata.key WITHOUT falling back to its array index (the core #4685b bug)', () => {
    const jobPageIds = ['p1', 'p2', 'p3'];
    // Response for p2 comes back with no metadata.key — e.g. Gemini omitted it.
    // The old buggy code would have resolved this to job.page_ids[1] === 'p2'
    // by luck here, so make the missing entry sit where a naive index fallback
    // would resolve to the WRONG page — p3's slot in the array carries no key,
    // which under the old code would silently write p3's response as page p3's
    // own text keyed on job.page_ids[1] ('p2'), clobbering p2 while leaving p3
    // truly blank.
    const responses = [
      fakeResponse('p1', 'translation one'),
      fakeResponse(undefined, 'translation for the missing-key response'), // would misresolve to p2 under index fallback
      fakeResponse('p3', 'translation three'),
    ];
    const reasons: string[] = [];
    const { pageResults, failCount } = resolveSinglePageBatchResponses(responses, jobPageIds, (r) => reasons.push(r));

    // p1 and p3 (the ones with real metadata.key) are the only pages resolved.
    expect(pageResults.map(r => r.pageId).sort()).toEqual(['p1', 'p3']);
    // Never resolved to p2 via array index — p2 must stay unresolved, not
    // silently overwritten with someone else's translation.
    expect(pageResults.find(r => r.pageId === 'p2')).toBeUndefined();
    expect(failCount).toBe(1);
    expect(reasons).toContain('missing-metadata-key');

    // The reconciliation step must be able to see p2 as unresolved so it gets
    // a failure marker instead of vanishing without a trace.
    const written = new Set(pageResults.map(r => r.pageId));
    const unresolved = findUnresolvedPageIds(jobPageIds, written);
    expect(unresolved).toEqual(['p2']);
  });

  it('rejects a metadata.key that points outside this job\'s own page_ids (stray/duplicate response)', () => {
    const jobPageIds = ['p1', 'p2'];
    const responses = [
      fakeResponse('p1', 'translation one'),
      fakeResponse('page-from-a-different-job', 'contamination'),
    ];
    const reasons: string[] = [];
    const { pageResults, failCount } = resolveSinglePageBatchResponses(responses, jobPageIds, (r) => reasons.push(r));

    expect(pageResults).toEqual([{ pageId: 'p1', text: 'translation one', usage: undefined }]);
    expect(failCount).toBe(1);
    expect(reasons).toContain('metadata-key-not-in-job');

    const unresolved = findUnresolvedPageIds(jobPageIds, new Set(pageResults.map(r => r.pageId)));
    expect(unresolved).toEqual(['p2']);
  });

  it('keeps only the first response when the same metadata.key repeats (never double-writes one page while starving another)', () => {
    const jobPageIds = ['p1', 'p2'];
    const responses = [
      fakeResponse('p1', 'first p1 text'),
      fakeResponse('p1', 'a SECOND response also claiming to be p1'),
    ];
    const reasons: string[] = [];
    const { pageResults, failCount } = resolveSinglePageBatchResponses(responses, jobPageIds, (r) => reasons.push(r));

    expect(pageResults).toEqual([{ pageId: 'p1', text: 'first p1 text', usage: undefined }]);
    expect(failCount).toBe(1);
    expect(reasons).toContain('duplicate-metadata-key');

    // p2 never got a response of its own at all — reconciliation must catch it.
    const unresolved = findUnresolvedPageIds(jobPageIds, new Set(pageResults.map(r => r.pageId)));
    expect(unresolved).toEqual(['p2']);
  });

  it('reproduces the production shape: a job with N page_ids and only N-1 responses reports a real gap, not silent success', () => {
    // This is the exact shape measured on production batch_jobs docs for
    // #4685(b): job.page_ids.length === 300, but the Gemini output file only
    // contained usable responses for a subset — page 104's own response never
    // came back from Gemini at all (not an error line, just absent).
    const jobPageIds = Array.from({ length: 10 }, (_, i) => `page-${i}`);
    const responses = jobPageIds
      .filter(id => id !== 'page-4') // Gemini silently omitted this one's response
      .map(id => fakeResponse(id, `translation of ${id}`));

    const reasons: string[] = [];
    const { pageResults, failCount } = resolveSinglePageBatchResponses(responses, jobPageIds, (r) => reasons.push(r));

    expect(pageResults).toHaveLength(9);
    expect(failCount).toBe(0); // nothing ERRORED — it was simply never there to fail
    const unresolved = findUnresolvedPageIds(jobPageIds, new Set(pageResults.map(r => r.pageId)));
    expect(unresolved).toEqual(['page-4']);
  });
});

describe('findUnresolvedPageIds (#4685b)', () => {
  it('excludes protected (human-edited) pages from the unresolved set', () => {
    const jobPageIds = ['p1', 'p2', 'p3'];
    const written = new Set(['p1']);
    const protectedIds = new Set(['p2']); // human-edited — deliberately skipped, not a failure
    expect(findUnresolvedPageIds(jobPageIds, written, protectedIds)).toEqual(['p3']);
  });

  it('returns an empty array when every page_id was written', () => {
    const jobPageIds = ['p1', 'p2'];
    expect(findUnresolvedPageIds(jobPageIds, new Set(jobPageIds))).toEqual([]);
  });
});
