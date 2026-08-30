import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOK_SELECT } from '@/lib/books-catalog';
import { hasLocalizedEdition } from '@/lib/localized';

/**
 * #4166 — the Supabase `books_catalog` mirror must carry the per-language page
 * counter, or every catalog-fed card links a Spanish-readable book to its
 * ENGLISH page.
 *
 * `hasLocalizedEdition` answers from two signals: a native `language` match
 * (#4120) or `pages_translated_es > 0`. The catalog carried `language` and not
 * the counter, so natives resolved and translated-into-Spanish books did not —
 * a correct guard with nothing behind it (#4159).
 *
 * The read half is a value assertion below. The write half is a source
 * assertion, which is only ever legitimate for an ABSENCE invariant
 * (.claude/docs/invariants/tests-that-are-not-guards.md) — and this is one:
 * the failure mode is literally one of a pair going missing. Comments are
 * stripped before matching, because both files explain the pairing in prose
 * that would otherwise satisfy the match on its own. Negative control was run
 * for every assertion here: each fails with its guarded token removed.
 */
describe('books_catalog carries the Spanish page counter', () => {
  it('BOOK_SELECT asks Supabase for it', () => {
    expect(BOOK_SELECT.split(/\s*,\s*/)).toContain('pages_translated_es');
  });

  // Both catalog writers build a full row from a Mongo projection and upsert on
  // `id`. A field in the row builder but NOT in the projection reads `undefined`
  // and writes 0 for EVERY book — which would un-localize every /es card while
  // looking like a successful sync. The two edits are a pair; this is the guard
  // that they stay one.
  const WRITERS = [
    'scripts/workers/sync-books-catalog.mjs',
    'scripts/migration/rebuild-books-catalog.mjs',
  ];

  for (const rel of WRITERS) {
    it(`${rel} projects AND writes it`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Row builder: `pages_translated_es: book.pages_translated_es || 0,`
      expect(src).toMatch(/pages_translated_es:\s*book\.pages_translated_es/);
      // Mongo projection: `pages_translated_es: 1`
      expect(src).toMatch(/pages_translated_es:\s*1\b/);
    });
  }

  // The two production cases the issue was measured on, as the catalog now
  // holds them. Neither is a Spanish original, so the native path cannot save
  // them — the counter is the only thing that keeps their /es link.
  it('resolves the measured cases from catalog-shaped rows', () => {
    // libro-de-chilam-balam-de-kaua-scribes
    expect(hasLocalizedEdition({ language: 'Yucatec Maya', pages_translated_es: 39 }, 'es')).toBe(true);
    // the-books-of-chilan-balam-the-prophetic-and-historic-brinton
    expect(hasLocalizedEdition({ language: 'English', pages_translated_es: 19 }, 'es')).toBe(true);
    // Positive control: the native Spanish edition in the same rail, which
    // resolved correctly before this change and must still.
    expect(hasLocalizedEdition({ language: 'Spanish', pages_translated_es: 0 }, 'es')).toBe(true);
    // And an English-only neighbour, which must stay English.
    expect(hasLocalizedEdition({ language: 'Latin', pages_translated_es: 0 }, 'es')).toBe(false);
  });
});
