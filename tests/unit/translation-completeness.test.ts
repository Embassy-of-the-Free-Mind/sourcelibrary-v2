/**
 * The clamp is the point of this file. A translation percentage above 100 has shipped
 * repeatedly — the Blue Qur'an at 1000%, 6,228 live books over 100 at once — and every
 * time the cause was a numerator counting pages the denominator excluded. These tests
 * assert the displayed number cannot exceed 100 no matter how inconsistent the inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  translationCompleteness,
  translationPercent,
  TRANSLATABLE_PAGES_EXPR,
  TRANSLATED_PAGES_CAPPED_EXPR,
  aggregateTranslationPercent,
} from '@/lib/translation-completeness';

describe('translationCompleteness', () => {
  it('uses pages_translatable as the denominator when present', () => {
    const r = translationCompleteness({ pages_count: 200, pages_translated: 179, pages_translatable: 179, pages_blank: 21 });
    expect(r.percent).toBe(100); // every translatable page done
    expect(r.exact).toBe(true);
    expect(r.translatable).toBe(179);
  });

  it('reports the honest number where the naive one understates', () => {
    // Hugh of Santalla, real values: 190 visible pages, 179 translatable, all done.
    const honest = translationPercent({ pages_count: 190, pages_translated: 179, pages_translatable: 179 });
    const naive = Math.round((179 / 190) * 100);
    expect(honest).toBe(100);
    expect(naive).toBe(94); // what the reader saw before
  });

  it('NEVER returns more than 100, however inconsistent the inputs', () => {
    // The Blue Qur'an shape: blank placeholders counted as translations against a
    // denominator that excluded them. This produced 1000% in production.
    expect(translationPercent({ pages_count: 60, pages_translated: 60, pages_translatable: 6 })).toBe(100);
    // Numerator larger than the book.
    expect(translationPercent({ pages_count: 10, pages_translated: 999, pages_translatable: 10 })).toBe(100);
    // Fallback path, blank-adjusted denominator, still inconsistent.
    expect(translationPercent({ pages_count: 60, pages_translated: 60, pages_blank: 54 })).toBe(100);
  });

  it('never returns a negative percentage', () => {
    expect(translationPercent({ pages_count: 10, pages_translated: -5, pages_translatable: 10 })).toBe(0);
  });

  it('reports 0, not 100, when nothing is translatable', () => {
    // A book of plates, or one not yet OCR'd. An empty denominator must not read as
    // "complete" — that is how a book with no text at all gets badged finished.
    expect(translationPercent({ pages_count: 40, pages_translated: 0, pages_translatable: 0 })).toBe(0);
    expect(translationPercent({ pages_count: 0, pages_translated: 0 })).toBe(0);
  });

  it('falls back to pages_count - pages_blank, and says it is not exact', () => {
    const r = translationCompleteness({ pages_count: 100, pages_translated: 90, pages_blank: 10 });
    expect(r.exact).toBe(false);
    expect(r.translatable).toBe(90);
    expect(r.percent).toBe(100);
  });

  it('the fallback understates rather than overstates', () => {
    // Fallback denominator (count - blank) is larger than the true translatable set,
    // because it does not exclude ex-libris, bookplates, notices or un-OCR'd pages.
    // A larger denominator means a smaller percentage — the safe direction.
    const book = { pages_count: 100, pages_translated: 80, pages_blank: 5 };
    const fallback = translationPercent(book);
    const exact = translationPercent({ ...book, pages_translatable: 80 });
    expect(fallback).toBeLessThan(exact);
    expect(exact).toBe(100);
  });

  it('handles missing fields without throwing', () => {
    expect(translationPercent({})).toBe(0);
    expect(translationPercent({ pages_count: null, pages_translated: null })).toBe(0);
  });
});

// The aggregate surfaces (analytics/canon, the admin dashboard) compute the formula in
// Mongo, so there are two copies of it. This evaluates the $group expressions over the
// operators they use and asserts each book contributes what the TS helper says — if
// one copy changes without the other, these go red.
type Doc = Record<string, unknown>;
function evalExpr(e: unknown, doc: Doc): unknown {
  if (typeof e === 'string' && e.startsWith('$')) return doc[e.slice(1)];
  if (e === null || typeof e !== 'object') return e;
  const [op, raw] = Object.entries(e as Record<string, unknown>)[0];
  const args = (Array.isArray(raw) ? raw : [raw]).map(a => evalExpr(a, doc));
  switch (op) {
    case '$cond': return args[0] ? args[1] : args[2];
    case '$and': return args.every(Boolean);
    case '$isNumber': return typeof args[0] === 'number';
    case '$gte': return (args[0] as number) >= (args[1] as number);
    case '$ifNull': return args[0] ?? args[1];
    case '$max': return Math.max(...(args as number[]));
    case '$min': return Math.min(...(args as number[]));
    case '$subtract': return (args[0] as number) - (args[1] as number);
    default: throw new Error(`unhandled operator ${op}`);
  }
}

describe('the Mongo $group expressions', () => {
  const books: Doc[] = [
    { pages_count: 200, pages_translated: 179, pages_translatable: 179, pages_blank: 21 },
    { pages_count: 100, pages_translated: 80, pages_blank: 5 },
    { pages_count: 60, pages_translated: 60, pages_blank: 54 }, // the 1000% Blue Qur'an inputs
    { pages_count: 10, pages_translated: 50, pages_translatable: 10 },
    { pages_count: 40, pages_translated: 0, pages_translatable: 0 },
    { pages_count: 12, pages_translated: 3, pages_translatable: null, pages_blank: null },
    { pages_count: 5, pages_blank: 9 },
    {},
  ];

  it('match translationCompleteness() book by book', () => {
    for (const b of books) {
      const c = translationCompleteness(b);
      expect(evalExpr(TRANSLATABLE_PAGES_EXPR, b)).toBe(c.translatable);
      expect(evalExpr(TRANSLATED_PAGES_CAPPED_EXPR, b)).toBe(c.translatable === 0 ? 0 : c.translated);
    }
  });

  it('sum to a total that never exceeds 100 and is 0 over an empty denominator', () => {
    const translated = books.reduce((s, b) => s + (evalExpr(TRANSLATED_PAGES_CAPPED_EXPR, b) as number), 0);
    const translatable = books.reduce((s, b) => s + (evalExpr(TRANSLATABLE_PAGES_EXPR, b) as number), 0);
    expect(translated).toBeLessThanOrEqual(translatable);
    expect(aggregateTranslationPercent(translated, translatable)).toBeLessThanOrEqual(100);
    expect(aggregateTranslationPercent(5, 0)).toBe(0);
    expect(aggregateTranslationPercent(50, 10)).toBe(100);
    expect(aggregateTranslationPercent(1, 3)).toBe(33.3);
  });
});
