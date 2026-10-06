import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { normalizeTitle, normalizeAuthor, sourceFingerprint } from '@/lib/dedup';
import { checkHoldings, candidateFromInput, type HoldingCandidate, type HoldingReason } from '@/lib/holdings-check';
import { semanticBookSearch } from '@/lib/semantic-search';

export const preferredRegion = 'fra1';

/**
 * GET /api/books/check-duplicate?title=X&author=Y&year=Z  (or ?url=…)
 *
 * The PUBLIC "do we already hold this?" — the MCP `check_duplicate` tool's
 * backend. Matching is `checkHoldings()` (src/lib/holdings-check.ts, #6019),
 * the same function behind the admin form and the CLI, plus a semantic tier
 * for cross-lingual titles ("Panchatantra" → Kalila wa-Dimna).
 *
 * PUBLIC, so hidden and warehouse records are NOT described: they are counted
 * (`held_not_public`, with the strongest reason) so a caller still learns we
 * hold a copy, without a title or id of a record we have not published. The
 * full view is /api/admin/holdings-check.
 *
 * Query params:
 *   url        — a library URL or IIIF manifest (title then optional)
 *   title      — book title (required unless url / ia_id / manifest)
 *   author, year, language (semantic hint)
 *   ia_id      — Internet Archive identifier
 *   manifest   — IIIF manifest URL
 *
 * Response (shape kept for MCP clients; `verdict`, `held_not_public`,
 * `limits` added):
 *   { isDuplicate, confidence, verdict, suggestion, matches[], held_not_public, limits, normalization }
 *
 * Read-only: writes nothing (the earlier version logged a
 * `dedup_shadow_decisions` row per lookup, polluting a measurement).
 */

type Confidence = 'exact' | 'high' | 'medium' | 'low';

// Keyed by string, not by HoldingReason: a reason added to holdings-check.ts
// must not break this route's build; an unlisted one reads as 'medium'.
const CONFIDENCE: Record<string, Confidence> = {
  same_book: 'exact',
  same_source_object: 'exact',
  same_iiif_manifest: 'exact',
  same_edition: 'high',
  same_edition_year_unknown: 'high',
  title_author_near_same_year: 'high',
  other_edition: 'medium',
  same_work: 'medium',
  same_work_same_year: 'high',
  title_author_near: 'medium',
  near_title: 'low',
};

const confidenceOf = (reason: string): Confidence => CONFIDENCE[reason] ?? 'medium';

interface Match {
  book_id: string;
  title: string;
  author?: string;
  language?: string;
  year?: number;
  match_type: HoldingReason | 'semantic';
  reason?: string;
  confidence: Confidence;
  similarity?: number;
  url: string;
}

const isPublic = (c: HoldingCandidate) => c.collection === 'books' && c.visible && !c.hidden;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title') || '';
  const author = searchParams.get('author') || '';
  const yearRaw = searchParams.get('year');
  const year = yearRaw ? parseInt(yearRaw, 10) || null : null;
  const iaId = searchParams.get('ia_id');
  const manifest = searchParams.get('manifest');
  const url = searchParams.get('url') || manifest;
  const language = searchParams.get('language');

  if ((!title || title.length < 2) && !url && !iaId) {
    return NextResponse.json(
      { error: 'title (min 2 chars), url, ia_id or manifest required' },
      { status: 400 }
    );
  }

  const db = await getReadDb();
  const input = { url, identifier: iaId, title: title || null, author: author || null, year };
  const holdings = await checkHoldings(db, input);

  const matches: Match[] = holdings.candidates.filter(isPublic).map((c) => ({
    book_id: c.book_id,
    title: c.title,
    author: c.author ?? undefined,
    language: c.language ?? undefined,
    year: c.year ?? undefined,
    match_type: c.reason,
    reason: c.reason_detail,
    confidence: confidenceOf(c.reason),
    url: c.url,
  }));
  const notPublic = holdings.candidates.filter((c) => !isPublic(c));
  const seen = new Set(holdings.candidates.map((c) => c.book_id));

  // Semantic tier — cross-lingual and alternate titles. Low-to-medium
  // evidence; never makes a verdict by itself above "review".
  if (title) {
    try {
      const semanticResults = await semanticBookSearch(`${title}${author ? ' by ' + author : ''}`, 8, {
        language: language || undefined,
        threshold: 0.63, // high recall for a pre-import look
      });
      for (const sem of semanticResults) {
        if (seen.has(sem.book_id)) continue;
        seen.add(sem.book_id);
        matches.push({
          book_id: sem.book_id,
          title: sem.title,
          author: sem.author || undefined,
          language: sem.language || undefined,
          year: sem.year || undefined,
          match_type: 'semantic',
          confidence: sem.similarity >= 0.78 ? 'medium' : 'low',
          similarity: Math.round(sem.similarity * 1000) / 1000,
          url: `https://sourcelibrary.org/book/${encodeURIComponent(sem.book_id)}`,
        });
      }
    } catch {
      // Non-fatal: semantic search can fail
    }
  }

  const order: Record<Confidence, number> = { exact: 0, high: 1, medium: 2, low: 3 };
  const semanticLast = (m: Match) => (m.match_type === 'semantic' ? 1 : 0);
  matches.sort((a, b) => order[a.confidence] - order[b.confidence] || semanticLast(a) - semanticLast(b) || (b.similarity || 0) - (a.similarity || 0));

  const strongestHidden = notPublic.length
    ? notPublic.reduce((a, b) => (order[confidenceOf(b.reason)] < order[confidenceOf(a.reason)] ? b : a))
    : null;
  const best = [matches[0]?.confidence, strongestHidden && confidenceOf(strongestHidden.reason)]
    .filter((c): c is Confidence => !!c)
    .sort((a, b) => order[a] - order[b])[0];
  const overall = best ?? 'none';
  const isDuplicate = overall === 'exact' || overall === 'high';

  const hiddenNote = notPublic.length
    ? ` We also hold ${notPublic.length} cop${notPublic.length === 1 ? 'y' : 'ies'} not yet public (strongest: ${strongestHidden!.reason.replace(/_/g, ' ')}).`
    : '';
  let suggestion: string;
  if (overall === 'exact') suggestion = `Already held (same scan).${matches[0]?.confidence === 'exact' ? ` "${matches[0].title}".` : ''} Do not import.${hiddenNote}`;
  else if (overall === 'high') suggestion = `Likely already held (same edition).${matches[0]?.confidence === 'high' ? ` "${matches[0].title}".` : ''} Check before importing.${hiddenNote}`;
  else if (overall === 'medium') suggestion = `Another edition or a related work is held. Review the matches before importing.${hiddenNote}`;
  else if (overall === 'low') suggestion = `No strong matches; only similar titles. Likely safe to import.${hiddenNote}`;
  else suggestion = 'No matches found. Safe to import.';

  const cand = candidateFromInput(input);
  return NextResponse.json({
    query: { title, author, year, url, language },
    isDuplicate,
    confidence: overall,
    verdict: holdings.verdict,
    suggestion,
    matches: matches.slice(0, 15),
    held_not_public: notPublic.length
      ? { count: notPublic.length, strongest_reason: strongestHidden!.reason }
      : null,
    limits: holdings.limits,
    normalization: {
      normalized_title: normalizeTitle(title),
      normalized_author: normalizeAuthor(author),
      source_fingerprint: sourceFingerprint(cand),
      edition_key: holdings.query.edition_key,
    },
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
