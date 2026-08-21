import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { assembleBookHistory, BOOK_HISTORY_PROJECTION } from '@/lib/book-history';

/**
 * GET /api/books/[id]/history/public
 *
 * A PUBLIC, trimmed provenance timeline. Same events as the staff
 * `/history` route but with everything sensitive stripped: AI costs, model
 * identities, prompt versions, triggering user, and admin actions are removed.
 * Edge-cached so the aggregation only runs occasionally; the reader component
 * fetches it lazily (on expand). The full, cost/model-bearing timeline stays
 * behind auth in the sibling `route.ts`.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const result = await findBookByIdOrSlug(db, id, BOOK_HISTORY_PROJECTION);
    if (!result) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Internal/curatorial event types that aren't meaningful reader
    // provenance — admin restores/hides, and field-level metadata changes
    // (which leak internal schema field names like "image_thumb,
    // cover_selected_at" and "AI enrichment: translation_verification").
    const HIDDEN_TYPES = new Set(['admin_action', 'metadata_change']);
    const seen = new Set<string>();
    const full = await assembleBookHistory(db, result.book);
    const events = (full.events || [])
      .filter((e) => !HIDDEN_TYPES.has(e.type))
      // Collapse same-step duplicates on the same day (e.g. two enrichment runs).
      .filter((e) => {
        const k = `${e.type}|${e.description}|${String(e.timestamp).slice(0, 10)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
        description: e.description,
        pages: e.pages,
        provider: e.provider,
        source_url: e.source_url,
        version: e.version,
        doi: e.doi,
      }));

    const res = NextResponse.json({ book_id: full.book_id, events });
    res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return res;
  } catch (error) {
    console.error('Error fetching public book history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
