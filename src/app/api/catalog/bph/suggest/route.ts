import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { supabase } from '@/lib/supabase';
import { applyBphFilters, readBphFilters } from '@/lib/bph-catalog-filters';
import {
  BPH_VOCABULARY_COLUMNS,
  buildBphVocabulary,
  suggestBphQueries,
  vocabularyFromWords,
  vocabularyToWords,
  type BphVocabulary,
  type BphVocabularyWords,
} from '@/lib/bph-catalog-suggest';

export const dynamic = 'force-dynamic';

/**
 * "Did you mean?" for the BPH catalogue. The catalogue calls this only after a
 * search has found nothing, with the same query string, so a misspelling costs
 * one extra request and an ordinary search costs none.
 *
 * Read-only: nothing here writes to `bph_works`.
 */

// supabase-js silently caps a response at 1,000 rows, so the table is read in pages.
const PAGE_SIZE = 1000;
const PARALLEL_PAGES = 6;
const VOCABULARY_TTL_MS = 60 * 60 * 1000;

let vocabularyCache: { vocabulary: BphVocabulary; loadedAt: number } | null = null;
let vocabularyLoad: Promise<BphVocabulary> | null = null;

async function loadVocabularyWords(): Promise<BphVocabularyWords> {
  const { count, error } = await supabase
    .from('bph_works')
    .select('uuid', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (error) throw new Error(error.message);

  const offsets: number[] = [];
  for (let from = 0; from < (count ?? 0); from += PAGE_SIZE) offsets.push(from);

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < offsets.length; i += PARALLEL_PAGES) {
    const pages = await Promise.all(
      offsets.slice(i, i + PARALLEL_PAGES).map(async (from) => {
        const page = await supabase
          .from('bph_works')
          .select(BPH_VOCABULARY_COLUMNS.join(', '))
          .is('deleted_at', null)
          .order('uuid')
          .range(from, from + PAGE_SIZE - 1);
        if (page.error) throw new Error(page.error.message);
        return (page.data ?? []) as unknown as Array<Record<string, unknown>>;
      }),
    );
    for (const page of pages) rows.push(...page);
  }
  // A short read would be cached for a day and hide words without any error.
  if (!count || rows.length < count) {
    throw new Error(`read ${rows.length} of ${count} catalogue rows`);
  }
  return vocabularyToWords(buildBphVocabulary(rows));
}

// Reading the table takes many seconds, so the result is shared across instances
// for a day. A thrown load is not cached, so the next search tries again.
const getSharedVocabularyWords = unstable_cache(loadVocabularyWords, ['bph-catalog-vocabulary-v1'], {
  revalidate: 24 * 60 * 60,
});

/** One load at a time per instance, however many searches arrive during it. */
async function getVocabulary(): Promise<BphVocabulary> {
  if (vocabularyCache && Date.now() - vocabularyCache.loadedAt < VOCABULARY_TTL_MS) {
    return vocabularyCache.vocabulary;
  }
  vocabularyLoad ??= getSharedVocabularyWords()
    .then((words) => {
      const vocabulary = vocabularyFromWords(words);
      vocabularyCache = { vocabulary, loadedAt: Date.now() };
      return vocabulary;
    })
    .finally(() => {
      vocabularyLoad = null;
    });
  return vocabularyLoad;
}

export async function GET(req: NextRequest) {
  const filters = readBphFilters(req.nextUrl.searchParams);
  if (filters.q.length < 3) return NextResponse.json({ suggestion: null, total: 0 });

  try {
    const vocabulary = await getVocabulary();

    // A candidate is offered only if searching for it, under the filters the
    // reader has on, finds something. Otherwise the click lands on another
    // empty page, which is worse than no suggestion.
    for (const candidate of suggestBphQueries(filters.q, vocabulary)) {
      const query = supabase.from('bph_works').select('uuid', { count: 'exact', head: true });
      const { count, error } = await applyBphFilters(
        query,
        { ...filters, q: candidate },
        { mode: 'new', hasNormalizedColumns: true, hasFirstTranslationColumn: true },
      );
      if (error) throw new Error(error.message);
      if (count && count > 0) {
        return NextResponse.json(
          { suggestion: candidate, total: count },
          { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } },
        );
      }
    }
    return NextResponse.json(
      { suggestion: null, total: 0 },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } },
    );
  } catch (err) {
    // A failure here costs the reader a hint, not the search. Never cached.
    console.error('[catalog/bph/suggest]', err);
    return NextResponse.json({ suggestion: null, total: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
