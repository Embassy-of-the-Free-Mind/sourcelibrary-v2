/**
 * GET /api/ngrams — term-frequency series for the ngram viewer (issue #3175).
 *
 * ?q=philosophers+stone,mercurius:la   1–6 comma-separated terms (≤3 words
 *                                      each); a `:corpus` suffix charts that
 *                                      term against a specific corpus, enabling
 *                                      cross-language overlays (mercury vs
 *                                      mercurius:la on one chart)
 * &corpus=en                           default corpus for untagged terms
 * &mode=tokens|docs                    tokens (default): occurrences per
 *                                      million tokens; docs: % of that year's
 *                                      books mentioning the term at least once
 *                                      (#3217 — immune to one wordy treatise
 *                                      dominating a thin year)
 * &smoothing=3                         ±years moving average, 0–10
 * &from=1450&to=1930                   year range (1930 default: later years
 *                                      are thin and skew toward reprint noise)
 *
 * Reads the precomputed ngram_series / ngram_totals tables in Supabase
 * (written by scripts/analytics/build-ngrams.mjs). Query terms are normalized
 * with the same tokenizer the build used — parity is pinned by
 * tests/unit/ngram-normalize.test.ts. Per-million normalization is against
 * each term's OWN corpus totals, which is what makes cross-corpus curves
 * comparable on one axis. Anonymous, read-only, aggressively CDN-cached.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NGRAM_CORPORA, normalizePhrase, MAX_NGRAM_N } from '@/lib/ngram-normalize';
import {
  buildSeries, buildDocSeries, parseTermSpec, MIN_YEAR_TOKENS,
  type NgramPoint, type DocPoint,
} from '@/lib/ngram-series';

const MAX_TERMS = 6;
const YEAR_FLOOR = 800;
const YEAR_CEIL = 2030;

interface SeriesOut {
  /** The term as the user typed it (without any corpus tag). */
  term: string;
  /** Corpus this term was charted against. */
  corpus: string;
  corpusLabel: string;
  /** The normalized ngram key actually looked up ('' if nothing tokenizable). */
  ngram: string;
  /** false = not in the table (below build threshold, or truly absent).
   *  In docs mode, also false while books_by_year hasn't been loaded yet. */
  found: boolean;
  /** true = more words than the build counts (>3). */
  tooLong: boolean;
  totalCount: number;
  bookCount: number;
  points: NgramPoint[] | DocPoint[];
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const defaultCorpus = sp.get('corpus') || 'en';
  if (!NGRAM_CORPORA.some(c => c.id === defaultCorpus)) {
    return NextResponse.json({ error: `Unknown corpus "${defaultCorpus}"` }, { status: 400 });
  }
  const mode: 'tokens' | 'docs' = sp.get('mode') === 'docs' ? 'docs' : 'tokens';

  const rawTerms = (sp.get('q') || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  if (rawTerms.length === 0) {
    return NextResponse.json({ error: 'Provide 1-6 comma-separated terms via ?q=' }, { status: 400 });
  }

  // Note: Number(null) is 0, not NaN — an absent param must fall to the
  // default BEFORE numeric coercion or every default collapses to the floor.
  const clamp = (raw: string | null, lo: number, hi: number, def: number) => {
    if (raw === null || raw.trim() === '') return def;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  };
  const from = clamp(sp.get('from'), YEAR_FLOOR, YEAR_CEIL, 1450);
  let to = clamp(sp.get('to'), YEAR_FLOOR, YEAR_CEIL, 1930);
  if (to < from) to = Math.min(YEAR_CEIL, from + 50);
  const smoothing = clamp(sp.get('smoothing'), 0, 10, 3);

  const terms = rawTerms.map(raw => {
    const spec = parseTermSpec(raw, defaultCorpus);
    const ngram = normalizePhrase(spec.term, spec.corpus);
    return { ...spec, ngram, tooLong: ngram.split(' ').length > MAX_NGRAM_N };
  });

  // One series lookup per distinct corpus; totals for every corpus involved
  // (each term normalizes against its own corpus) plus the default corpus
  // (whose totals draw the backdrop even if every term is tagged elsewhere).
  const lookupByCorpus = new Map<string, string[]>();
  for (const t of terms) {
    if (!t.ngram || t.tooLong) continue;
    const list = lookupByCorpus.get(t.corpus) ?? [];
    if (!list.includes(t.ngram)) list.push(t.ngram);
    lookupByCorpus.set(t.corpus, list);
  }
  const totalsCorpora = [...new Set([defaultCorpus, ...lookupByCorpus.keys()])];

  // One totals query PER corpus: supabase-js caps a response at 1,000 rows, and
  // a combined .in('corpus', [...]) query for 2+ corpora exceeds that (~500-800
  // year-rows each) — it truncated alphabetically, silently zeroing whole
  // corpora (mercurius:la charted flat while "found"). Per-corpus queries stay
  // under the cap.
  const [totalsResList, seriesRes] = await Promise.all([
    Promise.all(totalsCorpora.map(corpus =>
      supabase.from('ngram_totals').select('corpus, year, tokens, books').eq('corpus', corpus),
    )),
    Promise.all([...lookupByCorpus.entries()].map(([corpus, ngrams]) =>
      supabase.from('ngram_series')
        // Static select string: supabase-js types the rows by parsing this
        // literal, and a template literal degrades it to ParserError. At most
        // 6 rows per request, so always carrying books_by_year is negligible.
        .select('corpus, ngram, counts, total_count, book_count, books_by_year')
        .eq('corpus', corpus)
        .in('ngram', ngrams),
    )),
  ]);
  const firstError =
    totalsResList.find(r => r.error)?.error || seriesRes.find(r => r.error)?.error;
  if (firstError) {
    console.error('[ngrams] supabase error:', firstError);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const totalsByCorpus = new Map<string, Map<number, number>>();
  // Per-corpus book counts: the docs-mode denominator (every term normalizes
  // against its own corpus). The default corpus's map also drives the UI's
  // per-year "N books" readout.
  const booksByCorpus = new Map<string, Map<number, number>>();
  for (const res of totalsResList) {
    for (const r of res.data || []) {
      let m = totalsByCorpus.get(r.corpus);
      if (!m) { m = new Map(); totalsByCorpus.set(r.corpus, m); }
      m.set(Number(r.year), Number(r.tokens));
      let bm = booksByCorpus.get(r.corpus);
      if (!bm) { bm = new Map(); booksByCorpus.set(r.corpus, bm); }
      bm.set(Number(r.year), Number(r.books));
    }
  }
  const booksByYear = booksByCorpus.get(defaultCorpus) ?? new Map<number, number>();
  if (!totalsByCorpus.get(defaultCorpus)?.size) {
    return NextResponse.json(
      { error: `Corpus "${defaultCorpus}" has no data yet` },
      { status: 404 },
    );
  }

  const rowByKey = new Map(
    seriesRes.flatMap(r => (r.data || []).map(row => [`${row.corpus}${row.ngram}`, row])),
  );
  const labelOf = (id: string) => NGRAM_CORPORA.find(c => c.id === id)?.label || id;

  const series: SeriesOut[] = terms.map(({ term, corpus, ngram, tooLong }) => {
    let row = ngram && !tooLong ? rowByKey.get(`${corpus}${ngram}`) : undefined;
    // Docs mode needs books_by_year; a null there means this row predates the
    // #3217 load re-run. Zeros would chart as a real "nobody mentioned it" —
    // report not-found instead until the load has reached the row.
    if (mode === 'docs' && row && row.books_by_year == null) row = undefined;
    const points = mode === 'docs'
      ? buildDocSeries(
          (row?.books_by_year as Record<string, number>) || {},
          totalsByCorpus.get(corpus) || new Map(),
          booksByCorpus.get(corpus) || new Map(),
          from, to, smoothing,
        )
      : buildSeries(
          (row?.counts as Record<string, number>) || {},
          totalsByCorpus.get(corpus) || new Map(),
          from, to, smoothing,
        );
    return {
      term,
      corpus,
      corpusLabel: labelOf(corpus),
      ngram,
      found: Boolean(row),
      tooLong,
      totalCount: row ? Number(row.total_count) : 0,
      bookCount: row ? Number(row.book_count) : 0,
      points,
    };
  });

  const defaultTotals = totalsByCorpus.get(defaultCorpus)!;
  const totalsOut = [...defaultTotals.entries()]
    .filter(([year]) => year >= from && year <= to)
    .sort((a, b) => a[0] - b[0])
    .map(([year, tokens]) => ({ year, tokens, books: booksByYear.get(year) ?? 0 }));

  return NextResponse.json(
    {
      corpus: defaultCorpus, mode, from, to, smoothing,
      minYearTokens: MIN_YEAR_TOKENS, totals: totalsOut, series,
    },
    {
      headers: {
        // max-age=0 is load-bearing: without it a browser applies HEURISTIC
        // freshness and honours the 7-day stale-while-revalidate, so a response
        // captured mid-backfill (docs mode reports found:false until
        // books_by_year lands) kept rendering "no data" in an already-open tab
        // for days after the data was live and the CDN had been purged.
        // The CDN keeps its own 24h window via s-maxage.
        'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
        'CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    },
  );
}
