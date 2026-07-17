/**
 * GET /api/ngrams — term-frequency series for the ngram viewer (issue #3175).
 *
 * ?q=philosophers+stone,alkahest   1–6 comma-separated terms (≤3 words each)
 * &corpus=en                       corpus id (see NGRAM_CORPORA)
 * &smoothing=3                     ±years moving average, 0–10
 * &from=1450&to=1900               year range
 *
 * Reads the precomputed ngram_series / ngram_totals tables in Supabase
 * (written by scripts/analytics/build-ngrams.mjs). Query terms are normalized
 * with the same tokenizer the build used — parity is pinned by
 * tests/unit/ngram-normalize.test.ts. Anonymous, read-only, aggressively
 * CDN-cached: the data only changes when the batch build is re-run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NGRAM_CORPORA, normalizePhrase, MAX_NGRAM_N } from '@/lib/ngram-normalize';
import { buildSeries, MIN_YEAR_TOKENS, type NgramPoint } from '@/lib/ngram-series';

const MAX_TERMS = 6;
const YEAR_FLOOR = 800;
const YEAR_CEIL = 2030;

interface SeriesOut {
  /** The term as the user typed it. */
  term: string;
  /** The normalized ngram key actually looked up ('' if nothing tokenizable). */
  ngram: string;
  /** false = not in the table (below build threshold, or truly absent). */
  found: boolean;
  /** true = more words than the build counts (>3). */
  tooLong: boolean;
  totalCount: number;
  bookCount: number;
  points: NgramPoint[];
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const corpus = sp.get('corpus') || 'en';
  if (!NGRAM_CORPORA.some(c => c.id === corpus)) {
    return NextResponse.json({ error: `Unknown corpus "${corpus}"` }, { status: 400 });
  }

  const rawTerms = (sp.get('q') || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  if (rawTerms.length === 0) {
    return NextResponse.json({ error: 'Provide 1-6 comma-separated terms via ?q=' }, { status: 400 });
  }

  const clamp = (v: number, lo: number, hi: number, def: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  const from = clamp(Number(sp.get('from')), YEAR_FLOOR, YEAR_CEIL, 1450);
  let to = clamp(Number(sp.get('to')), YEAR_FLOOR, YEAR_CEIL, 1950);
  if (to < from) to = Math.min(YEAR_CEIL, from + 50);
  const smoothing = clamp(Number(sp.get('smoothing')), 0, 10, 3);

  const terms = rawTerms.map(term => {
    const ngram = normalizePhrase(term, corpus);
    return { term, ngram, tooLong: ngram.split(' ').length > MAX_NGRAM_N };
  });
  const lookup = [...new Set(terms.filter(t => t.ngram && !t.tooLong).map(t => t.ngram))];

  const [totalsRes, seriesRes] = await Promise.all([
    supabase.from('ngram_totals').select('year, tokens').eq('corpus', corpus),
    lookup.length
      ? supabase.from('ngram_series')
          .select('ngram, counts, total_count, book_count')
          .eq('corpus', corpus)
          .in('ngram', lookup)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (totalsRes.error || seriesRes.error) {
    console.error('[ngrams] supabase error:', totalsRes.error || seriesRes.error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!totalsRes.data?.length) {
    return NextResponse.json(
      { error: `Corpus "${corpus}" has no data yet` },
      { status: 404 },
    );
  }

  const totals = new Map<number, number>(
    totalsRes.data.map(r => [Number(r.year), Number(r.tokens)]),
  );
  const byNgram = new Map(
    (seriesRes.data || []).map(r => [r.ngram as string, r]),
  );

  const series: SeriesOut[] = terms.map(({ term, ngram, tooLong }) => {
    const row = ngram && !tooLong ? byNgram.get(ngram) : undefined;
    return {
      term,
      ngram,
      found: Boolean(row),
      tooLong,
      totalCount: row ? Number(row.total_count) : 0,
      bookCount: row ? Number(row.book_count) : 0,
      points: buildSeries(
        (row?.counts as Record<string, number>) || {},
        totals, from, to, smoothing,
      ),
    };
  });

  const totalsOut = [...totals.entries()]
    .filter(([year]) => year >= from && year <= to)
    .sort((a, b) => a[0] - b[0])
    .map(([year, tokens]) => ({ year, tokens }));

  return NextResponse.json(
    { corpus, from, to, smoothing, minYearTokens: MIN_YEAR_TOKENS, totals: totalsOut, series },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        'CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    },
  );
}
