import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { CLIP_URL } from '@/lib/clip';

export const maxDuration = 15;

/**
 * GET /api/search/visual?q=ouroboros&limit=20
 *
 * Text-to-image search using CLIP embeddings.
 * Encodes the text query via CLIP text encoder, then searches
 * against CLIP image embeddings in Supabase for visual matches.
 *
 * This finds images by what they LOOK like, not just their metadata.
 * "skeleton playing music" finds skeleton images even if no metadata says "skeleton".
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 100);
  const offset = parseInt(searchParams.get('offset') || '0');
  // Default floor raised 0.20 → 0.26 (#4338): at 0.20–0.25 CLIP returns
  // confidently unrelated images (an oud player and Wikipedia-vandalism
  // screenshots for "ancient egyptian"), and users read them as broken search.
  // Callers that want the speculative tail can still pass ?threshold= lower.
  const threshold = parseFloat(searchParams.get('threshold') || '0.26');

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], query: '', total: 0 });
  }

  // Tenant context — when present, only return images whose book is in this
  // tenant. Required for tenant subdomain lockdown (e.g. bph.sourcelibrary.org).
  const { slug: tenantSlug, id: tenantId } = getTenantContextFromRequest(request.headers);
  if (tenantSlug && !tenantId) {
    return NextResponse.json({ results: [], query, total: 0 });
  }

  try {
    // Encode text query via CLIP text encoder on Hetzner
    const clipResp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(5000),
    });

    if (!clipResp.ok) {
      return NextResponse.json(
        { error: 'Visual search unavailable', results: [], query, total: 0 },
        { status: 502 },
      );
    }

    const { embedding } = await clipResp.json();
    if (!embedding) {
      return NextResponse.json(
        { error: 'Failed to encode query', results: [], query, total: 0 },
        { status: 502 },
      );
    }

    // Search Supabase for visually matching images. The CLIP RPC has no
    // tenant column, so when a tenant filter is active we post-filter the
    // matches in MongoDB below — oversample here so enough survive the
    // filter (top-N globally would otherwise leave only a handful for niche
    // tenant queries). Until the RPC gains a tenant column, this is the
    // pragmatic fix.
    const baseCount = offset + limit + 10;
    const { data, error } = await supabase.rpc('match_clip_text', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: tenantId ? Math.min(baseCount * 10, 1000) : baseCount,
    });

    if (error) {
      console.error('[visual-search] Supabase error:', error.message);
      return NextResponse.json(
        { error: 'Search failed', results: [], query, total: 0 },
        { status: 500 },
      );
    }

    const matches = (data || []) as Array<{
      id: string;
      source_type: string;
      book_id: string;
      image_url: string;
      title: string;
      author: string;
      resource_type: string;
      thumbnail_url: string;
      similarity: number;
    }>;

    // Tenant filter: keep only matches whose book is in this tenant.
    let scoped = matches;
    if (tenantId) {
      const bookIds = Array.from(new Set(matches.map(m => m.book_id).filter(Boolean)));
      if (bookIds.length === 0) {
        scoped = [];
      } else {
        const db = await getReadDb();
        const allowedDocs = await db.collection('books')
          .find({ id: { $in: bookIds }, tenantId }, { projection: { id: 1 } })
          .toArray();
        const allowed = new Set(allowedDocs.map(d => d.id as string));
        scoped = matches.filter(m => allowed.has(m.book_id));
      }
    }

    // Deduplicate by book — max 3 per book for diversity
    const byBook = new Map<string, number>();
    const deduped = scoped.filter(m => {
      const count = byBook.get(m.book_id) || 0;
      if (count >= 3) return false;
      byBook.set(m.book_id, count + 1);
      return true;
    });

    const page = deduped.slice(offset, offset + limit);

    return NextResponse.json({
      results: page.map(m => ({
        id: m.id,
        sourceType: m.source_type,
        bookId: m.book_id,
        imageUrl: m.thumbnail_url || m.image_url,
        fullImageUrl: m.image_url,
        title: m.title,
        author: m.author,
        resourceType: m.resource_type,
        similarity: Math.round(m.similarity * 1000) / 1000,
      })),
      query,
      total: deduped.length,
      limit,
      offset,
      mode: 'visual',
    }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[visual-search] Error:', msg);
    return NextResponse.json(
      { error: 'Visual search failed', results: [], query, total: 0 },
      { status: 500 },
    );
  }
}
