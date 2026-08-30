import { describe, it, expect } from 'vitest';
import { effortToAttempt, VERDICT, SCREEN } from '../../scripts/lib/search-effort.mjs';

const baseEffort = (over = {}) => ({
  effort_id: 'e1',
  book_id: 'b1',
  work_id: 'w1',
  run_at: '2026-08-10T00:00:00.000Z',
  verdict: VERDICT.NONE_FOUND,
  reference_set: { version: 'v9', sources: [{ id: 'loc' }, { id: 'estc' }] },
  queries: [{ source: 'loc', query: 'author:"X"', result_count: 3 }],
  candidates: [],
  counts: { queries: 1, records_returned: 3, candidates_screened: 0, by_screen: {} },
  code_version: 'abc1234',
  ...over,
});

describe('effortToAttempt — the one-ledger bridge (#3881)', () => {
  it('not_searchable maps to NOTHING: "we could not ask" must never enter the ledger', () => {
    expect(effortToAttempt(baseEffort({ verdict: VERDICT.NOT_SEARCHABLE }))).toBeNull();
  });

  it('none_found maps to a weak absence row with the search trail attached', () => {
    const a = effortToAttempt(baseEffort());
    expect(a.result).toBe('none');
    expect(a.evidence_strength).toBe('weak'); // catalogue-only recall is 32.1% — never higher
    expect(a.method).toBe('tier1_catalog');
    expect(a.sources_checked).toEqual(['loc', 'estc']);
    expect(a.queries[0]).toContain('author:"X"');
    expect(a.transcript_ref).toBe('e1');
    // Deterministic id: re-ingesting a generation is idempotent under $setOnInsert.
    expect(a.attempt_id).toBe('b1:tier1_catalog:e1');
  });

  it('prior_found maps to a strong found row with a citable prior', () => {
    const a = effortToAttempt(baseEffort({
      verdict: VERDICT.PRIOR_FOUND,
      candidates: [{
        screen: SCREEN.PRIOR, title: 'The Works, Englished', year: 1650,
        identifiers: { lccn: '55004252' },
      }],
    }));
    expect(a.result).toBe('found');
    expect(a.evidence_strength).toBe('strong');
    expect(a.found_refs).toEqual(['55004252']);
    expect(a.priors[0].source_url).toBe('https://lccn.loc.gov/55004252');
    expect(a.priors[0].completeness).toBe('complete');
  });

  it('only_partial_found is a found row whose priors are marked partial (supports first_complete, does not defeat)', () => {
    const a = effortToAttempt(baseEffort({
      verdict: VERDICT.ONLY_PARTIAL_FOUND,
      candidates: [{ screen: SCREEN.PARTIAL, title: 'Selections', year: 1890, identifiers: { estc_id: 'S1234' } }],
    }));
    expect(a.result).toBe('found');
    expect(a.evidence_strength).toBe('moderate');
    expect(a.priors[0].completeness).toBe('partial');
  });

  it('screened-out candidates (different work, wrong language) contribute no priors', () => {
    const a = effortToAttempt(baseEffort({
      candidates: [
        { screen: SCREEN.DIFFERENT_WORK, title: 'Other', identifiers: { lccn: 'x' } },
        { screen: SCREEN.WRONG_LANGUAGE, title: 'French tr.', identifiers: { lccn: 'y' } },
      ],
    }));
    expect(a.priors).toEqual([]);
    expect(a.found_refs).toEqual([]);
    expect(a.result).toBe('none');
  });
});
