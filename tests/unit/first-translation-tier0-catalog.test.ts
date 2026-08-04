import { describe, it, expect } from 'vitest';
import {
  makeTier0Catalog,
  isDecisivePrior,
  langKey,
  type CatalogPrior,
} from '@/lib/first-translation/tier0-catalog';
import type { ResolvableBook, ResolveContext } from '@/lib/first-translation/resolve';

const ctx: ResolveContext = { now: '2026-06-27T00:00:00.000Z' };

const book: ResolvableBook = {
  id: 'b1',
  title: 'De Mysteriis',
  author: 'Iamblichus',
  original_language: 'Latin',
  language: 'Latin',
  work_id: null,
};

const completePrior: CatalogPrior = {
  english_title: 'On the Mysteries',
  translator: 'Emma Clarke',
  pub_year: '2003',
  completeness: 'complete',
  source_language: 'la',
  source_url: 'https://archive.org/x',
  source: 'loeb',
  matched_by: 'author_title',
};

const run = (priors: CatalogPrior[], b: ResolvableBook = book) =>
  makeTier0Catalog(async () => priors)(b, ctx);

describe('langKey', () => {
  it('maps ISO code and name to the same key', () => {
    expect(langKey('la')).toBe(langKey('Latin'));
    expect(langKey('grc')).toBe('greek');
    expect(langKey('Latin-German')).toBe('latin'); // coarse: first token
  });
});

describe('isDecisivePrior', () => {
  it('accepts a complete, same-language, guard-passing prior', () => {
    expect(isDecisivePrior(book, completePrior)).toBe(true);
  });
  it('rejects a partial prior', () => {
    expect(isDecisivePrior(book, { ...completePrior, completeness: 'partial' })).toBe(false);
  });
  it('rejects a different-source-language prior (Greek prior for a Latin text)', () => {
    expect(isDecisivePrior(book, { ...completePrior, source_language: 'grc' })).toBe(false);
  });
  it('rejects a self-match (prior == the book itself)', () => {
    expect(
      isDecisivePrior(book, { ...completePrior, english_title: 'De Mysteriis', translator: 'Iamblichus' }),
    ).toBe(false);
  });
});

describe('makeTier0Catalog', () => {
  it('TERMINATES with not_first/strong when a decisive prior is held', async () => {
    const o = await run([completePrior]);
    expect(o.terminal).toBe(true);
    expect(o.verdict?.verdict).toBe('not_first');
    expect(o.verdict?.evidence_strength).toBe('strong');
    expect(o.verdict?.resolver).toBe('tier0_linked');
    expect(o.attempt.result).toBe('found');
    expect(o.attempt.method).toBe('tier0_linked');
    expect(o.attempt.priors?.[0]?.source_url).toBe('https://archive.org/x');
  });

  it('marks the match_key work_id when matched via the work cluster', async () => {
    const o = await run([{ ...completePrior, matched_by: 'work_id' }]);
    expect(o.verdict?.match_key).toBe('work_id');
  });

  it('ESCALATES (non-terminal, weak) on a partial-only candidate', async () => {
    const o = await run([{ ...completePrior, completeness: 'partial' }]);
    expect(o.terminal).toBe(false);
    expect(o.verdict).toBeNull();
    expect(o.attempt.result).toBe('none');
    expect(o.attempt.evidence_strength).toBe('weak');
    expect(o.attempt.notes).toMatch(/candidate/i);
  });

  it('ESCALATES on no catalog match, recording the miss', async () => {
    const o = await run([]);
    expect(o.terminal).toBe(false);
    expect(o.verdict).toBeNull();
    expect(o.attempt.result).toBe('none');
    expect(o.attempt.match_key).toBe('none');
    expect(o.attempt.notes).toMatch(/No matching row/i);
  });

  it('never terminates on a different-source-language prior (the Iamblichus rule)', async () => {
    const o = await run([{ ...completePrior, source_language: 'grc' }]);
    expect(o.terminal).toBe(false);
    expect(o.verdict).toBeNull();
  });
});
