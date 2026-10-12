import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

/**
 * GET /api/gallery/facets?facet=symbol&contains=ouro&limit=50
 *
 * The legal values of /api/gallery's type / subject / figure / symbol filters,
 * with image counts (#4287). Those filters are EXACT string matches on the
 * extractor's tags, and the vocabularies run to tens of thousands of strings, so
 * an MCP agent guessing free text mostly matches nothing; this lets it look the
 * string up first (MCP tool `list_image_facets`).
 *
 * Reads system_config.gallery_facet_vocab, written weekly by
 * scripts/maintenance/refresh-gallery-filters.mjs: every string on ≥min_count
 * book illustrations of visible books. Museum artworks are not counted.
 *
 * Global vocabulary only: a partner subdomain gets a 404 rather than a list of
 * tags drawn from books outside its shelf.
 */

const FACETS = ['type', 'subject', 'figure', 'symbol'] as const;
type Facet = typeof FACETS[number];
type VocabEntry = { terms: Array<[string, number]>; distinct: number };
type Vocab = Record<Facet, VocabEntry> & { min_count: number; updated_at: string | null };

const CACHE_TTL_MS = 30 * 60 * 1000;
let cached: { data: Vocab; at: number } | null = null;

async function loadVocab(): Promise<Vocab | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const db = await getReadDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await db.collection('system_config').findOne({ _id: 'gallery_facet_vocab' } as any);
  if (!doc?.data) return null;
  const data = {
    ...(doc.data as Omit<Vocab, 'updated_at'>),
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null,
  } as Vocab;
  cached = { data, at: Date.now() };
  return data;
}

function facetResult(v: VocabEntry, contains: string, limit: number) {
  const needle = contains.toLowerCase();
  const matched = needle ? v.terms.filter(([t]) => t.toLowerCase().includes(needle)) : v.terms;
  return {
    distinct_values: v.distinct,
    listed_values: v.terms.length,
    matched: matched.length,
    terms: matched.slice(0, limit).map(([value, count]) => ({ value, count })),
  };
}

export async function GET(request: NextRequest) {
  const tenant = getTenantContextFromRequest(request);
  if (tenant.id || tenant.slug) {
    return NextResponse.json({ error: 'Facet vocabulary is only served on the main site' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const facetParam = searchParams.get('facet');
  if (facetParam && !FACETS.includes(facetParam as Facet)) {
    return NextResponse.json({ error: `facet must be one of: ${FACETS.join(', ')}` }, { status: 400 });
  }
  const contains = (searchParams.get('contains') || '').trim().slice(0, 100);
  const defaultLimit = facetParam ? 100 : 25;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '') || defaultLimit, 1), 500);

  try {
    const vocab = await loadVocab();
    if (!vocab) {
      return NextResponse.json({ error: 'Facet vocabulary has not been computed yet' }, { status: 503 });
    }
    const facets = (facetParam ? [facetParam as Facet] : FACETS).filter((f) => vocab[f]);
    return NextResponse.json({
      min_count: vocab.min_count,
      updated_at: vocab.updated_at,
      contains: contains || undefined,
      facets: Object.fromEntries(facets.map((f) => [f, facetResult(vocab[f], contains, limit)])),
    }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('Gallery facets error:', error);
    return NextResponse.json({ error: 'Failed to load facet vocabulary' }, { status: 500 });
  }
}
