import { describe, it, expect } from 'vitest';
import {
  makeTier0Catalog,
  isDecisivePrior,
  langKey,
  type CatalogPrior,
} from '@/lib/first-translation/tier0-catalog';
import type { ResolvableBook, ResolveContext } from '@/lib/first-translation/tier';

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

  it('resolves every ISO bucket translation_catalogs stores, not a private ten-entry map (#3785)', () => {
    // These buckets are stored by translation-catalog-record.mjs and were
    // invisible to the old private map — 'fa' vs 'Persian' silently never matched.
    expect(langKey('fa')).toBe(langKey('Persian'));
    expect(langKey('bo')).toBe(langKey('Tibetan'));
    expect(langKey('syc')).toBe(langKey('Syriac'));
    expect(langKey('es')).toBe(langKey('Spanish'));
  });

  it('returns "" (UNKNOWN) for an unresolvable label instead of the raw token', () => {
    expect(langKey('Q35497')).toBe('');
    expect(langKey('Quechua')).toBe('');
    expect(langKey('')).toBe('');
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
  it('matches an ISO bucket the old private map missed (Persian book, "fa" prior) (#3785)', () => {
    const persian: ResolvableBook = { ...book, title: 'Rubaiyat', author: 'Omar Khayyam', original_language: 'Persian', language: 'Persian' };
    expect(
      isDecisivePrior(persian, { ...completePrior, english_title: 'Rubaiyat of Omar Khayyam', translator: 'E. FitzGerald', source_language: 'fa' }),
    ).toBe(true);
  });
  it('UNKNOWN never reads as MISMATCH: an unresolvable catalog language does not block', () => {
    // Old code compared raw unmapped strings ('junk' !== 'latin' → blocked a
    // real complete prior). Unknown must keep the language screen open; the
    // completeness + evidence-quality guards still apply.
    expect(isDecisivePrior(book, { ...completePrior, source_language: 'zz-unmapped' })).toBe(true);
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
