import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { rescueSearch } from '@/lib/search-rescue';
import { queryTerms } from '@/lib/search-grounding';
import { gallerySearchStage, gallerySearchMatch, parseGalleryNarrowing } from '@/lib/gallery-query';
import { browseCatalog } from '@/lib/catalog/query';

export const maxDuration = 20;

const wordRe = (t: string) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');

/**
 * GET /api/search/rescue?q=…&scope=gallery|library — when a search found
 * nothing, what the reader probably meant (src/lib/search-rescue.ts), each
 * checked against the page's own search. Global only: a partner host gets
 * nothing rather than suggestions drawn from books it does not show.
 */
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const q = (sp.get('q') || '').trim();
  const scope = sp.get('scope') === 'library' ? 'library' : 'gallery';
  const tenant = getTenantContextFromRequest(request);
  if (!q || tenant.id || tenant.slug) return NextResponse.json({ rescues: [] });

  try {
    const db = await getReadDb();
    const rescues = await rescueSearch(db, q, {
      kind: scope,
      count: scope === 'library'
        ? async (c) => (await browseCatalog({ q: c.q }, 'relevance', 1, 1)).total
        : async (c) => {
          // Plates through the gallery's own Atlas lane, plus artworks whose title
          // holds every word (the gallery's title lane shows those first).
          const terms = queryTerms(c.q);
          if (!terms.judgeable) return 0;
          const narrowing = parseGalleryNarrowing(new URLSearchParams(c.type ? { type: c.type } : {}));
          const [plates, artworks] = await Promise.all([
            db.collection('gallery_images').aggregate([
              gallerySearchStage(terms.terms, 0.7),
              gallerySearchMatch({ tenantBooks: null, bookId: null, bookIds: null, maxPerBook: 1000, narrowing }),
              { $count: 'n' },
            ], { maxTimeMS: 5000 }).toArray().then((r) => (r[0]?.n as number | undefined) ?? 0),
            c.type ? Promise.resolve(0) : db.collection('books').countDocuments({
              content_type: 'artwork', visible: true,
              $and: terms.terms.map((t) => ({ $or: [{ title: wordRe(t) }, { display_title: wordRe(t) }] })),
            }, { maxTimeMS: 5000 }),
          ]);
          return plates + artworks;
        },
    });
    return NextResponse.json({ rescues }, { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (err) {
    console.error('[search/rescue]', (err as Error)?.message);
    return NextResponse.json({ rescues: [] });
  }
}
