import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { withApiAuth, type ApiIdentity } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/vectors/[store]
 *
 * The embedding vectors themselves — the coordinates behind semantic and
 * visual search, so a consumer can run their own UMAP, clustering, or
 * nearest-neighbour work instead of being limited to our ranked results.
 *
 * Until now every embedding surface returned RANKED RESULTS and never the
 * vectors, which is fine for search and useless for a corpus map: you cannot
 * project a top-k list. (Requested by an external visualization app, #4509.)
 *
 * Stores (see .claude/docs/embeddings.md for how each is built; row counts
 * measured 2026-08-31):
 *   books    book_embeddings          768    35,801  one per book
 *   gallery  gallery_text_embeddings  768   212,433  illustration descriptions
 *   clip     clip_embeddings          512   313,249  CLIP VISUAL vectors — the
 *                                                    ones for "looks alike"
 *   artworks artwork_embeddings      3072    21,925  standalone artworks
 *
 * Page-level vectors (3.9M rows) are deliberately NOT exposed here: that is a
 * bulk dataset transfer, not an API read. Ask for a dump.
 *
 * Pagination is KEYSET, not offset — offset over a few hundred thousand rows
 * walks every skipped row and blows the request deadline (the lesson from
 * /api/dataset/v1/pages, #4508). Echo `next_cursor` back as `after` until it
 * stops being returned.
 *
 * Query params:
 *   after   - keyset cursor: the last id from the previous page
 *   limit   - rows per page (default 200, max 1000)
 *   format  - "json" (default) plain float arrays, or "base64" float32
 *             little-endian, ~2.5x smaller on the wire
 */

interface StoreSpec {
  table: string;
  idColumn: string;
  dims: number;
  /** Extra columns worth returning so a vector is identifiable without a join. */
  extra: string[];
}

// Column names verified against the live tables 2026-08-31 — `gallery` and
// `clip` are keyed on their own `id`, NOT on an image id, and the label fields
// differ per store. A vector with no label is a dot you cannot annotate, so
// each store carries just enough to plot and caption without a join.
const STORES: Record<string, StoreSpec> = {
  books: {
    table: 'book_embeddings', idColumn: 'book_id', dims: 768,
    extra: ['title', 'author', 'year', 'language'],
  },
  gallery: {
    table: 'gallery_text_embeddings', idColumn: 'id', dims: 768,
    extra: ['book_id', 'page_id', 'detection_index'],
  },
  clip: {
    table: 'clip_embeddings', idColumn: 'id', dims: 512,
    extra: ['book_id', 'title', 'author', 'source_type', 'thumbnail_url'],
  },
  artworks: {
    table: 'artwork_embeddings', idColumn: 'book_id', dims: 3072,
    extra: ['title', 'author', 'period', 'culture', 'genre'],
  },
};

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

/** Supabase returns pgvector as a JSON-ish string; accept both shapes. */
function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toBase64(vec: number[]): string {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf.toString('base64');
}

export const GET = withApiAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ store: string }> },
  identity: ApiIdentity,
) => {
  try {
    const { store } = await params;
    const spec = STORES[store];
    if (!spec) {
      return NextResponse.json(
        { error: `Unknown vector store "${store}"`, available: Object.keys(STORES) },
        { status: 404 },
      );
    }

    const { searchParams } = request.nextUrl;
    const after = searchParams.get('after');
    const format = searchParams.get('format') === 'base64' ? 'base64' : 'json';
    const limitRaw = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT);

    const columns = [spec.idColumn, ...spec.extra, 'embedding'].join(', ');
    let query = supabase
      .from(spec.table)
      .select(columns)
      // Keyset order. Ordering by the id column makes `after` a simple >.
      .order(spec.idColumn, { ascending: true })
      // .range() is mandatory: supabase-js silently truncates at 1,000 rows
      // otherwise — no error, just a short array (CLAUDE.md).
      .range(0, limit - 1);
    if (after) query = query.gt(spec.idColumn, after);

    const { data, error } = await query;
    if (error) {
      console.error(`/api/vectors/${store}:`, error.message);
      return NextResponse.json({ error: 'Failed to read vectors' }, { status: 500 });
    }

    const rows = (data || []) as unknown as Array<Record<string, unknown>>;
    const vectors = rows.map((r) => {
      const vec = parseVector(r.embedding);
      const base: Record<string, unknown> = { id: r[spec.idColumn] };
      for (const e of spec.extra) base[e] = r[e] ?? null;
      if (!vec) { base.embedding = null; return base; }
      base.embedding = format === 'base64' ? toBase64(vec) : vec;
      return base;
    });

    const last = rows[rows.length - 1];
    const nextCursor = rows.length === limit && last ? String(last[spec.idColumn]) : null;

    return NextResponse.json({
      store,
      dims: spec.dims,
      format,
      // float32 little-endian when base64 — stated so a consumer can decode
      // without guessing the byte order.
      ...(format === 'base64' ? { encoding: 'float32-le' } : {}),
      returned: vectors.length,
      next_cursor: nextCursor,
      vectors,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}),
      },
    });
  } catch (error) {
    console.error('Error in /api/vectors:', error);
    return NextResponse.json({ error: 'Failed to read vectors' }, { status: 500 });
  }
}, { route: 'vectors.get' });
