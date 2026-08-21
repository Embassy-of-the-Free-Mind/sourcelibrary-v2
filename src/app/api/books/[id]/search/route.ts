import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { semanticPageSearchScoped, lexicalPageSearchLang } from '@/lib/semantic-search';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { isBookReadable } from '@/lib/book-access';
import { logSearchEvent } from '@/lib/search-event-log';
import { frontMatterVerdict } from '@/lib/front-matter';
import { scorePages } from '@/lib/passage-score';
import { semanticCoverage, type SemanticCoverage } from '@/lib/semantic-coverage';

/**
 * How many pages to pull before scoring. The cap must be applied AFTER ranking,
 * never during retrieval — see the note in the Atlas branch below.
 */
const CANDIDATE_POOL = 400;

interface SearchMatch {
  field: 'ocr' | 'translation';
  snippet: string;
  position: number;
}

interface SearchResult {
  pageId: string;
  pageNumber: number;
  matches: SearchMatch[];
  /**
   * Relevance in 0-1, normalised within its own leg. Surfaced because
   * search_concept documents its 0.70/0.55 calibration and this tool did not,
   * so a caller had no way to tell a real hit at rank 20 from noise
   * (#3653 follow-up #4, item 1c).
   */
  score?: number;
  /** Which leg found this page. Both, when they agree — a strong signal. */
  found_by?: 'keyword' | 'semantic' | 'both';
  /** Introduction / preface / contents rather than the body — see src/lib/front-matter.ts. */
  is_front_matter?: boolean;
  reason?: 'roman-pagination' | 'structural-header' | 'structural-page-type';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip XML/HTML tags and clean up formatting artifacts */
function cleanText(text: string): string {
  return stripEditorialWrappers(text)           // drop <meta>/<summary>/<keywords>/<vocab> prose first
    .replace(/<[^>]+>/g, '')                    // strip remaining tags, keep inner body text
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // strip markdown bold
    .replace(/\*([^*]+)\*/g, '$1')              // strip markdown italic
    .replace(/original:\s*[^;]+;?\s*/gi, '')    // strip "original: Latin;" annotations
    .replace(/\s+/g, ' ')                       // collapse whitespace
    .trim();
}

function generateSnippet(text: string, query: string, contextChars: number = 80): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const cleaned = cleanText(text);
  const lowerText = cleaned.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter(w => w.length > 0);

  const positions: number[] = [];
  for (const word of words) {
    let pos = 0;
    while ((pos = lowerText.indexOf(word, pos)) !== -1) {
      positions.push(pos);
      pos += 1;
    }
  }

  const uniquePositions = [...new Set(positions)].sort((a, b) => a - b);
  const snippetPositions: number[] = [];
  for (const pos of uniquePositions) {
    if (snippetPositions.some(p => Math.abs(p - pos) < contextChars * 2)) continue;
    snippetPositions.push(pos);
    if (snippetPositions.length >= 3) break;
  }

  for (const pos of snippetPositions) {
    const start = Math.max(0, pos - contextChars);
    const end = Math.min(cleaned.length, pos + contextChars + query.length);
    let snippet = cleaned.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < cleaned.length) snippet = snippet + '...';
    matches.push({ field: 'ocr', snippet, position: pos });
  }

  return matches;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    // Which EDITION of the page text to search and quote. `en` (the default)
    // is Mongo's `translation.data` + `ocr.data` via Atlas; anything else is
    // the language-keyed `page_texts` store (#4095). The reader's own search
    // bar is already Spanish under `/es` — searching English text behind a
    // Spanish input is the mismatch this closes.
    const langParam = (searchParams.get('lang') || '').trim().toLowerCase();
    const textLang = /^[a-z]{2,3}$/.test(langParam) ? langParam : 'en';
    const isLocalized = textLang !== 'en';
    const tenantContext = getTenantContextFromRequest(request.headers);

    if (tenantContext.slug && !tenantContext.id) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    const trimmedQuery = query.trim();
    // Strip surrounding quotes for matching — buildPageSearchStage handles phrase detection internally
    const isPhrase = /^".*"$/.test(trimmedQuery);
    const matchQuery = isPhrase ? trimmedQuery.slice(1, -1) : trimmedQuery;
    const db = await getDb();

    // Hidden (visible:false) books are not public — gate before searching their
    // text. 404 unless editor session or CRON_SECRET (pipeline / Claude Code).
    // A book is only "hidden" if its books doc exists with visible:false; if no
    // doc is found we preserve prior behavior (just search pages) rather than 404.
    const gateBook = await db.collection('books').findOne(
      { $or: [{ id: bookId }, { slug: bookId }] },
      { projection: { id: 1, visible: 1, pages_translated: 1 } }
    );
    if (gateBook && !(await isBookReadable(gateBook, request))) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Full page text per result, kept for the scoring pass below. Held outside
    // the two branches so a page found semantically is scored the same way as a
    // page found by keyword — otherwise the merge compares two different scales.
    const scoreText = new Map<string, string>();
    /** Keyword relevance before normalisation: Atlas searchScore, or BM25 in the fallback. */
    const rawKeywordScore = new Map<string, number>();
    /** Semantic relevance — cosine similarity, already 0-1. */
    const rawSemanticScore = new Map<string, number>();

    // Run keyword search and semantic search in parallel
    const [keywordResults, semanticResults] = await Promise.all([
      // --- Keyword search (Atlas Search with regex fallback) ---
      (async (): Promise<SearchResult[]> => {
        // Localized keyword leg. Atlas's `pages_search` index maps
        // `translation.data` / `ocr.data` only, so it cannot see
        // `translations.es.data`; the Spanish text is already in Supabase with
        // a Spanish-stemmed GIN index, which is a better lexical match for it
        // than lucene.standard would have been anyway. Front-matter demotion
        // still reads the ENGLISH OCR — front matter is a property of the
        // physical page, not of the language it is read in.
        if (isLocalized) {
          try {
            const hits = await lexicalPageSearchLang(matchQuery, textLang, CANDIDATE_POOL, { bookIds: [bookId] });
            if (hits.length === 0) return [];
            const meta = await db.collection('pages')
              .find({ id: { $in: hits.map(h => h.page_id) } }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } })
              .toArray();
            const ocrById = new Map(meta.map(d => [d.id as string, (d.ocr as { data?: string } | undefined)?.data]));
            const badIds = new Set(
              meta.filter(d => (NON_CONTENT_PAGE_TYPES as readonly string[]).includes(d.page_type as string))
                .map(d => d.id as string),
            );
            const out: SearchResult[] = [];
            for (const h of hits) {
              if (badIds.has(h.page_id)) continue;
              const text = h.full_text || h.snippet;
              const matches = generateSnippet(text, matchQuery).map(m => ({ ...m, field: 'translation' as const }));
              if (matches.length === 0) continue;
              out.push({ pageId: h.page_id, pageNumber: h.page_number, matches, ...frontMatterVerdict(ocrById.get(h.page_id)) });
              // ts_rank_cd, normalised against this leg's own best hit below —
              // the same treatment Atlas's BM25 gets, for the same reason: the
              // two scales have no common unit.
              rawKeywordScore.set(h.page_id, h.score);
              scoreText.set(h.page_id, cleanText(text));
            }
            return out;
          } catch (e) {
            // Loud, not silent: an empty result here is indistinguishable from
            // "the book says nothing about that" unless we say which happened.
            console.warn(`[book-search] localized keyword leg failed (${textLang}):`, e instanceof Error ? e.message : String(e));
            return [];
          }
        }

        let pages: Record<string, unknown>[];
        let usedAtlas = false;

        try {
          pages = await db.collection('pages').aggregate([
            buildPageSearchStage(trimmedQuery, bookId),
            { $match: { page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
            // NO { $sort: { page_number: 1 } }, { $limit: 50 }. Atlas returns in
            // score order; re-sorting by page number threw that away and then
            // cut at 50, so on a long book the cap was spent inside the front
            // matter before the body was reached. That is the exact shape the
            // reporter measured — "results 1-48: pages 8,9,10,11...57, STRICT
            // ASCENDING PAGE ORDER" — and it is why it read as a ranking
            // problem when it was a retrieval problem.
            //
            // This was fixed in the regex fallback first and MISSED here, which
            // is the branch that actually runs. Over-fetch, score, then cut.
            { $limit: CANDIDATE_POOL },
            {
              $project: {
                id: 1,
                page_number: 1,
                book_id: 1,
                'ocr.data': 1,
                'translation.data': 1,
                highlights: { $meta: 'searchHighlights' },
                searchScore: { $meta: 'searchScore' },
              },
            },
          ], { maxTimeMS: 10000 }).toArray();
          usedAtlas = true;
        } catch {
          const regex = new RegExp(escapeRegex(matchQuery), 'i');
          const regexFilter: Record<string, unknown> = {
            book_id: bookId,
            page_type: { $nin: NON_CONTENT_PAGE_TYPES },
            $or: [
              { 'ocr.data': { $regex: regex } },
              { 'translation.data': { $regex: regex } }
            ]
          };
          if (tenantContext.id) regexFilter.tenantId = tenantContext.id;
          // NO .sort({ page_number: 1 }).limit(50) here. That took the first 50
          // matching pages in PAGE ORDER, so on any long book the cap was spent
          // before the body was reached — which is why front matter appeared to
          // dominate and why it looked like a ranking problem.
          //
          // Measured on the Taylor Metaphysics (536pp): 138 pages match "whole".
          // Page 264 carries the wanted passage (whole x2, parts x4, heap x2) and
          // never appeared, because page-ordered retrieval stopped at page 56.
          // Diogenes Laertius "worked" only because its front matter is short
          // enough that page order reached the body by accident.
          //
          // Over-fetch instead, then let the scoring and the front-matter demotion
          // below decide what survives — the same over-fetch pattern searchPassages
          // and searchConcept already use for their own filters.
          pages = await db.collection('pages')
            .find(regexFilter, {
              projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 }
            })
            .limit(CANDIDATE_POOL)
            .toArray();
        }

        const results: SearchResult[] = [];
        for (const page of pages) {
          const matches: SearchMatch[] = [];

          if (usedAtlas && Array.isArray(page.highlights) && page.highlights.length > 0) {
            // Generate the snippet from the FULL field text, not from the Atlas
            // highlight fragments. The fragments are a window around the hit, so
            // when the hit lands inside a <meta>/<summary>/<keywords>/<vocab>
            // block the fragment carries the editorial prose WITHOUT its wrapper
            // tags — stripEditorialWrappers (which needs the tags) then can't
            // remove it, and the AI page-description gets served as a quote (the
            // "mercury on page 89" leak; PRs #2232/#2233 only fixed the full-field
            // path). generateSnippet runs cleanText over the complete field, where
            // both tags are present, so the block is stripped. If the only hit was
            // inside an editorial block it's now gone, generateSnippet finds
            // nothing, and the page correctly drops out of results.
            const ocr = page.ocr as { data?: string } | undefined;
            const translation = page.translation as { data?: string } | undefined;
            for (const hl of page.highlights as Array<{ path: string; texts: Array<{ value: string; type: string }> }>) {
              const field: 'ocr' | 'translation' = hl.path === 'translation.data' ? 'translation' : 'ocr';
              const fullData = (field === 'translation' ? translation?.data : ocr?.data) || '';
              if (!fullData) continue;
              const hitText = hl.texts.find(t => t.type === 'hit')?.value || matchQuery;
              const snips = generateSnippet(fullData, hitText);
              matches.push(...snips.map(m => ({ ...m, field })));
            }
          } else {
            const ocr = page.ocr as { data?: string } | undefined;
            const translation = page.translation as { data?: string } | undefined;
            if (ocr?.data) {
              const ocrMatches = generateSnippet(ocr.data, matchQuery);
              matches.push(...ocrMatches.map(m => ({ ...m, field: 'ocr' as const })));
            }
            if (translation?.data) {
              const translationMatches = generateSnippet(translation.data, matchQuery);
              matches.push(...translationMatches.map(m => ({ ...m, field: 'translation' as const })));
            }
          }

          if (matches.length > 0) {
            const ocrData = (page.ocr as { data?: string } | undefined)?.data;
            const translationData = (page.translation as { data?: string } | undefined)?.data;
            results.push({
              pageId: page.id as string,
              pageNumber: page.page_number as number,
              matches,
              ...frontMatterVerdict(ocrData),
            });
            // Score against the CLEANED text of both fields — the same text the
            // reader sees. cleanText drops the editorial <meta>/<summary> blocks,
            // so an AI page-description can't win a search for its own subject.
            // Atlas's own relevance is BM25 over the whole corpus, so its IDF is
            // better than anything computable from one book's candidate pool.
            // Keep it. Where Atlas is unavailable the fallback scorer fills in
            // below.
            if (usedAtlas) rawKeywordScore.set(page.id as string, (page.searchScore as number) ?? 0);
            scoreText.set(page.id as string, cleanText(`${ocrData || ''} ${translationData || ''}`));
          }
        }
        // Regex fallback has no relevance signal of its own — every match is
        // just "the pattern appeared". Score it locally so the fallback is not
        // arbitrary. See src/lib/passage-score.ts for why the IDF is measured
        // over the pool rather than taken from a stopword list.
        if (!usedAtlas) {
          for (const s of scorePages(matchQuery, results.map((r) => ({ item: r, text: scoreText.get(r.pageId) ?? '' })))) {
            rawKeywordScore.set(s.item.pageId, s.score);
          }
        }
        return results;
      })(),

      // --- Semantic search (conceptual matches via page embeddings) ---
      (async (): Promise<SearchResult[]> => {
        try {
          const pages = await semanticPageSearchScoped(trimmedQuery, [bookId], 10, { textLang });
          const filtered = pages.filter(p => p.snippet && p.snippet.length > 20);
          if (filtered.length === 0) return [];
          // Look up page_type to drop boilerplate (title-page, blank, illustration, etc.)
          // — these have embeddings in Supabase but aren't real book content.
          const pageIds = filtered.map(p => p.page_id);
          // Also pull the OCR so the same front-matter judgement can be made
          // here. This is the path the report was actually about — "EVERY
          // semantic search on a 400+ page book returned ~45 pages of front
          // matter" — so flagging only the keyword path would fix the quieter
          // half of the complaint.
          const pageTypeDocs = await db.collection('pages')
            .find({ id: { $in: pageIds } }, { projection: { id: 1, page_type: 1, 'ocr.data': 1 } })
            .toArray();
          const ocrById = new Map(pageTypeDocs.map((d) => [d.id as string, (d.ocr as { data?: string } | undefined)?.data]));
          const badIds = new Set(
            pageTypeDocs
              .filter(d => (NON_CONTENT_PAGE_TYPES as readonly string[]).includes(d.page_type as string))
              .map(d => d.id as string),
          );
          const kept = filtered.filter(p => !badIds.has(p.page_id));
          for (const p of kept) {
            scoreText.set(p.page_id, cleanText(ocrById.get(p.page_id) || p.snippet));
            rawSemanticScore.set(p.page_id, p.score ?? 0);
          }
          return kept.map(p => ({
            pageId: p.page_id,
            pageNumber: p.page_number,
            matches: [{
              field: 'translation' as const,
              snippet: p.snippet,
              position: 0,
            }],
            ...frontMatterVerdict(ocrById.get(p.page_id)),
          }));
        } catch {
          return [];
        }
      })(),
    ]);

    // ---- Merge ----
    //
    // Reported (#3653 follow-up #4, item 1): "The tool description states it
    // merges them. It does not. It concatenates keyword-block-first, and the
    // keyword block is not even score-sorted — it is page-sorted. So on any long
    // book the caller reads 48 sequential pages of Book I before reaching the
    // semantic hits."
    //
    // Correct on both counts. Each leg is now normalised against its own best
    // hit, which is the only honest way to compare an Atlas BM25 score with a
    // cosine similarity — the two have no common unit. A page found by BOTH legs
    // takes the higher of the two and is marked, because agreement between an
    // exact-term match and a semantic match is the strongest evidence available.
    const byPage = new Map<number, SearchResult>();
    for (const r of [...keywordResults, ...semanticResults]) {
      const existing = byPage.get(r.pageNumber);
      if (!existing) { byPage.set(r.pageNumber, r); continue; }
      // Same page from both legs: keep the keyword entry (it carries real
      // snippets rather than an embedding window) and record the agreement.
      existing.found_by = 'both';
      for (const m of r.matches) {
        if (!existing.matches.some((e) => e.snippet === m.snippet)) existing.matches.push(m);
      }
    }
    const results = [...byPage.values()];

    const maxKeyword = Math.max(0, ...rawKeywordScore.values());
    const maxSemantic = Math.max(0, ...rawSemanticScore.values());
    for (const r of results) {
      const kw = maxKeyword > 0 ? (rawKeywordScore.get(r.pageId) ?? 0) / maxKeyword : 0;
      const sem = maxSemantic > 0 ? (rawSemanticScore.get(r.pageId) ?? 0) / maxSemantic : 0;
      r.score = Math.round(Math.max(kw, sem) * 1000) / 1000;
      if (!r.found_by) r.found_by = rawSemanticScore.has(r.pageId) && !rawKeywordScore.has(r.pageId) ? 'semantic' : 'keyword';
    }

    // ---- Rank ----
    //
    // Front matter last. A conceptual query was returning 50 consecutive hits
    // from a translator's introduction with the wanted passage at #52 (#3653
    // item 3). DEMOTED, never dropped — a reader asking what the translator said
    // about his own method is asking a real question, and the total stays honest.
    //
    // Within each group, by relevance. Note what this does NOT do: it does not
    // re-score the pages itself. Measured on all five of the reporter's own
    // regression cases, Atlas already ranked the wanted page #1 in every one;
    // a local BM25 rescoring pass moved Taylor's p264 from #1 to #366, because
    // Taylor's 1801 wording contains none of the query's words and Atlas was
    // relying on corpus-wide evidence the single-book pool cannot see. The bug
    // was never the scorer — it was the $sort that threw the scorer's answer
    // away. Rescoring here would be re-introducing it in a subtler form.
    const byScore = (a: SearchResult, b: SearchResult) =>
      (b.score ?? 0) - (a.score ?? 0) || a.pageNumber - b.pageNumber;
    const ranked = [
      ...results.filter((r) => !r.is_front_matter).sort(byScore),
      ...results.filter((r) => r.is_front_matter).sort(byScore),
    ];
    const RESULT_CAP = 50;
    const totalMatched = ranked.length;
    const capped = ranked.slice(0, RESULT_CAP);
    results.length = 0;
    results.push(...capped);

    // Was the semantic leg able to run at all? Only checked when it produced
    // NOTHING — that is the one case where a caller could mistake a blind index
    // for an absent passage, and checking unconditionally would put a Supabase
    // round-trip on every search that is already working. See
    // src/lib/semantic-coverage.ts for the measurement that motivated this.
    // Coverage is measured against `page_translations`, the English store, so
    // it can only speak for an English request. Reporting it for a Spanish one
    // would answer a question nobody asked — and a "full" verdict there would
    // be actively misleading about the Spanish index.
    let coverage: SemanticCoverage | undefined;
    if (semanticResults.length === 0 && !isLocalized) {
      coverage = await semanticCoverage(
        (gateBook?.id as string) || bookId,
        (gateBook?.pages_translated as number) || 0,
      );
      if (coverage.status === 'full' || coverage.status === 'unknown') coverage = undefined;
    }

    let ocrPages = 0;
    let translationPages = 0;
    for (const result of results) {
      if (result.matches.some(m => m.field === 'ocr')) ocrPages++;
      if (result.matches.some(m => m.field === 'translation')) translationPages++;
    }

    // Log search query (fire-and-forget) — see src/lib/search-event-log.ts
    logSearchEvent({
      request, db, query: trimmedQuery, resultsCount: results.length, source: 'book_search',
      tenantId: tenantContext.id || null,
      filters: { book_id: bookId, lang: textLang },
    });

    return NextResponse.json({
      query: trimmedQuery,
      // Which edition answered. Never leave this to be inferred: a caller that
      // asked for `es` and silently got English text has no way to tell.
      lang: textLang,
      // total is what MATCHED, not what is being returned — a caller that sees
      // 50 and assumes that is everything will stop looking too early.
      total: totalMatched,
      returned: results.length,
      ocrPages,
      translationPages,
      front_matter_results: results.filter((r) => r.is_front_matter).length,
      ...(coverage ? { semantic_coverage: coverage } : {}),
      results
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
