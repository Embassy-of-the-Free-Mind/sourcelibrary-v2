import { NextRequest, NextResponse } from 'next/server';
import { getPageAtVersion, getPagesAtVersion } from '@/lib/edition-reader';
import { markForExport } from '@/lib/provenance';
import { getDb } from '@/lib/mongodb';
import { gatePagesForRequest, meteredSignInResponse } from '@/lib/metered-gate';
import { meteredReaderEnabled, type GateInfo } from '@/lib/free-preview';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/books/[id]/edition-page?page_id=X&v=1.0.0
 *
 * Returns the translation text for a page as it was when the given edition was published.
 * Supports batch mode: page_id=X&page_id=Y&page_id=Z (or comma-separated).
 *
 * An edition's text is the page's text, so the metered reader's free sample
 * holds here as on /api/pages (#4357): a single gated page answers the
 * sign-in 401; in a batch, a gated page comes back with no translation and
 * `gated: true`.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId } = await context.params;
    const { searchParams } = new URL(request.url);
    const version = searchParams.get('v');
    const pageIds = searchParams.getAll('page_id');

    // Also support comma-separated: ?page_id=a,b,c
    const allPageIds = pageIds.flatMap(id => id.split(',').map(s => s.trim())).filter(Boolean);

    if (!version) {
      return NextResponse.json({ error: 'Missing ?v= version parameter' }, { status: 400 });
    }
    if (allPageIds.length === 0) {
      return NextResponse.json({ error: 'Missing ?page_id= parameter' }, { status: 400 });
    }

    const gated = await gatedPageIds(request, allPageIds.slice(0, 200));

    // Single page — simpler response
    if (allPageIds.length === 1) {
      const gate = gated.get(allPageIds[0]);
      if (gate) return meteredSignInResponse(gate);
      const result = await getPageAtVersion(bookId, allPageIds[0], version);
      if (!result) {
        return NextResponse.json(
          { error: 'Page not found in this edition version' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        page_id: allPageIds[0],
        // Reader-path provenance mark (invisible, deterministic) — this route
        // feeds the version-pinned reader the same way /api/pages does.
        translation: typeof result.translation === 'string'
          ? markForExport(result.translation, bookId)
          : result.translation,
        is_current_version: result.isCurrentVersion,
        edition: result.edition,
      });
    }

    // Batch mode
    const results = await getPagesAtVersion(bookId, allPageIds, version);
    const pages = allPageIds
      .filter(id => results.has(id))
      .map(id => {
        const r = results.get(id)!;
        if (gated.has(id)) return { page_id: id, translation: null, is_current_version: r.isCurrentVersion, gated: true as const, gate: gated.get(id) };
        return {
          page_id: id,
          translation: typeof r.translation === 'string'
            ? markForExport(r.translation, bookId)
            : r.translation,
          is_current_version: r.isCurrentVersion,
        };
      });

    // Use edition info from first result
    const firstResult = results.values().next().value;

    return NextResponse.json({
      pages,
      edition: firstResult?.edition ?? null,
    });
  } catch (error) {
    console.error('Error fetching edition page:', error);
    return NextResponse.json({ error: 'Failed to fetch edition page' }, { status: 500 });
  }
}

/** The page ids, among these, whose text this caller may not read (with each one's gate info). */
async function gatedPageIds(request: NextRequest, pageIds: string[]): Promise<Map<string, GateInfo>> {
  const out = new Map<string, GateInfo>();
  if (pageIds.length === 0 || !meteredReaderEnabled()) return out;
  const db = await getDb();
  const pages = await db.collection('pages').find(
    { id: { $in: pageIds } },
    { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, seo_indexable: 1 } },
  ).toArray();
  for (const p of await gatePagesForRequest(db, request, pages)) {
    const g = p as typeof p & { gated?: boolean; gate?: GateInfo };
    if (g.gated && g.gate) out.set(g.id as string, g.gate);
  }
  return out;
}
