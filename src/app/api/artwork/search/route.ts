import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { artistAuthorRegex } from '@/lib/artist-match';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { semanticArtworkSearch } from '@/lib/semantic-search';
import { resolveTitle } from '@/lib/title-provenance';

export const maxDuration = 30;

const VISUAL_RESOURCE_TYPES = ['painting', 'drawing', 'print', 'fresco', 'engraving', 'woodcut', 'emblem', 'map', 'tablet', 'object'];

/**
 * GET /api/artwork/search
 *
 * Search standalone artworks (paintings, frescoes, prints, sculptures, manuscripts) —
 * the museum-tier layer imported from Met, Rijksmuseum, Wikimedia, NGA, AIC.
 * Distinct from /api/gallery, which searches illustrations extracted from book pages.
 *
 * Query params:
 *   q          — semantic + regex search across title/author/medium/description
 *   type       — resource_type filter (painting, drawing, print, fresco, engraving, woodcut, emblem, map)
 *   subject    — post-filter on semantic result subjects (only applied when q is set)
 *   figure     — post-filter on semantic result figures (only applied when q is set)
 *   symbol     — post-filter on semantic result symbols (only applied when q is set)
 *   period     — period filter (e.g. "Baroque", "Renaissance") — passed to semanticArtworkSearch
 *   culture    — culture filter (e.g. "Italian", "Dutch") — passed to semanticArtworkSearch
 *   genre      — genre filter (e.g. "religious", "mythological") — passed to semanticArtworkSearch
 *   year_from  — published year >= (string-compared, since published is stored as string)
 *   year_to    — published year <=
 *   artist     — artist slug ("albrecht-durer"), the API twin of
 *                /artwork/artist/[slug]; resolved via the shared
 *                artistAuthorRegex so both surfaces return the same set
 *   book_id    — return a specific artwork
 *   limit      — max results (default 20, max 50)
 *   offset     — pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantCtx = getTenantContextFromRequest(request);
    let tenantId = tenantCtx.id;
    if (!tenantId && tenantCtx.slug) {
      tenantId = await resolveTenantId(tenantCtx.slug);
    }

    const q = searchParams.get('q');
    const typeFilter = searchParams.get('type');
    const subjectFilter = searchParams.get('subject');
    const figureFilter = searchParams.get('figure');
    const symbolFilter = searchParams.get('symbol');
    const period = searchParams.get('period');
    const culture = searchParams.get('culture');
    const genre = searchParams.get('genre');
    const yearStart = searchParams.get('year_from') || searchParams.get('yearStart');
    const yearEnd = searchParams.get('year_to') || searchParams.get('yearEnd');
    const bookId = searchParams.get('book_id') || searchParams.get('bookId');
    const artistSlug = (searchParams.get('artist') || '').trim();
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getReadDb();
    const tenantScope = tenantId ? { tenantId } : {};

    // `artist=<slug>` resolved ONCE, and applied in BOTH lanes below. A filter
    // honoured only when the caller omits `q` is inert exactly where it is most
    // likely to be used, while still reading as active
    // (search-filters-and-lanes.md). A placeholder slug ("various",
    // "anonymous") resolves to null: return empty rather than match everything.
    const artistRegex = artistSlug ? artistAuthorRegex(artistSlug) : null;
    if (artistSlug && !artistRegex) {
      return NextResponse.json({ total: 0, showing: 0, items: [], artist: null });
    }
    const artistTest = artistRegex ? new RegExp(artistRegex.$regex, artistRegex.$options) : null;

    // ── Path A: book_id direct lookup ─────────────────────────────────
    if (bookId) {
      const artwork = await db.collection('books').findOne({
        id: bookId,
        ...tenantScope,
        resource_type: { $in: VISUAL_RESOURCE_TYPES },
        visible: true,
      });
      const items = artwork ? [shapeArtworkRow(artwork)] : [];
      return NextResponse.json({ total: items.length, showing: items.length, items });
    }

    // ── Path B: semantic + post-filter (when q present) ───────────────
    if (q) {
      const semanticLimit = Math.min(limit + offset + 30, 120);
      const semanticResults = await semanticArtworkSearch(q, semanticLimit, {
        period: period ?? undefined,
        culture: culture ?? undefined,
        genre: genre ?? undefined,
        threshold: 0.25,
      });

      // Resolve full Mongo docs for slug, image URLs, year, tenant scope
      let docs: Array<Record<string, unknown>> = [];
      if (semanticResults.length > 0) {
        const ids = semanticResults.map(r => r.book_id);
        docs = await db.collection('books').find({
          id: { $in: ids },
          ...tenantScope,
          visible: true,
          resource_type: { $in: VISUAL_RESOURCE_TYPES },
        }).toArray();
      }
      const docMap = new Map(docs.map(d => [d.id as string, d]));

      let merged = semanticResults
        .map(r => {
          const doc = docMap.get(r.book_id);
          if (!doc) return null;
          return shapeArtworkRow(doc, r);
        })
        .filter((row): row is ArtworkRow => row !== null);

      // Apply post-filters that the RPC doesn't support
      if (typeFilter) merged = merged.filter(r => r.type === typeFilter);
      if (subjectFilter) merged = merged.filter(r => (r.subjects ?? []).some(s => matchesIgnoreCase(s, subjectFilter)));
      if (figureFilter) merged = merged.filter(r => (r.figures ?? []).some(f => matchesIgnoreCase(f, figureFilter)));
      if (symbolFilter) merged = merged.filter(r => (r.symbols ?? []).some(s => matchesIgnoreCase(s, symbolFilter)));
      if (yearStart) merged = merged.filter(r => !r.published || r.published >= yearStart);
      if (yearEnd) merged = merged.filter(r => !r.published || r.published <= yearEnd);
      if (artistTest) merged = merged.filter(r => artistTest.test(r.author ?? ''));

      // Fallback: if semantic returned nothing usable, do a regex fallback
      if (merged.length === 0) {
        const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexFilter: Record<string, unknown> = {
          ...tenantScope,
          visible: true,
          resource_type: typeFilter
            ? typeFilter
            : { $in: VISUAL_RESOURCE_TYPES },
          ...(artistRegex ? { author: artistRegex } : {}),
          $or: [
            { title: { $regex: pattern, $options: 'i' } },
            { display_title: { $regex: pattern, $options: 'i' } },
            { author: { $regex: pattern, $options: 'i' } },
            { medium: { $regex: pattern, $options: 'i' } },
          ],
        };
        const regexDocs = await db.collection('books')
          .find(regexFilter)
          .limit(limit + offset + 1)
          .toArray();
        merged = regexDocs.map(d => shapeArtworkRow(d));
      }

      const page = merged.slice(offset, offset + limit);
      return NextResponse.json({
        total: merged.length,
        showing: page.length,
        items: page,
      });
    }

    // ── Path C: browse (no q) — Mongo direct ──────────────────────────
    const filter: Record<string, unknown> = {
      ...tenantScope,
      visible: true,
      resource_type: typeFilter
        ? typeFilter
        : { $in: VISUAL_RESOURCE_TYPES },
    };
    if (artistRegex) filter.author = artistRegex;
    if (yearStart || yearEnd) {
      const yf: Record<string, string> = {};
      if (yearStart) yf.$gte = yearStart;
      if (yearEnd) yf.$lte = yearEnd;
      filter.published = yf;
    }

    const docs = await db.collection('books')
      .find(filter, { projection: artworkProjection })
      .sort({ published: 1, title: 1 })
      .skip(offset)
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    if (hasMore) docs.splice(limit);

    const items = docs.map(d => shapeArtworkRow(d));
    // A REAL count on the browse lane, not the limit+1 probe this used to
    // report. That probe answered "how many works by Goltzius?" with `3` when
    // the answer is 685 — tolerable while the only browse was an infinite
    // scroll, misleading now that `artist=` makes cardinality the natural
    // question a caller asks (agent-tool-results.md: a top-k list cannot
    // answer "how many"). The q-lane above stays an estimate by construction —
    // it ranks, so its total is "matches we retrieved", not "matches that
    // exist".
    const total = await db.collection('books').countDocuments(filter, { maxTimeMS: 10000 });

    return NextResponse.json({
      total,
      showing: items.length,
      items,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('Artwork search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search artworks' },
      { status: 500 }
    );
  }
}

const artworkProjection = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
  // #4288: the stamp that says whether `display_title` is the source record's
  // title or a label a vision model wrote from the image. Without it in the
  // projection every consumer treats the two as the same kind of thing.
  'field_provenance.display_title': 1, content_type: 1,
  published: 1, year: 1, resource_type: 1, medium: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
  image_full: 1, summary: 1, current_location: 1, collections: 1,
};

interface ArtworkRow {
  id: string;
  source: 'artwork';
  title: string;
  /**
   * Where `title` came from (#4288). `descriptive` means a vision model wrote
   * it by looking at the image — it is a caption, not a work anyone published,
   * and must not be cited as one. `source` means the museum/Commons record's
   * own title. `derived` means it was mechanically shortened from that title.
   */
  title_provenance: 'source' | 'descriptive' | 'derived';
  /** The title on the source record — the one that is safe to cite. */
  source_record_title: string;
  author: string | null;
  published: string | null;
  year: number | null;
  type: string | null;
  medium: string | null;
  description: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  url: string;
  collections: string[];
  current_location?: string | null;
  period?: string | null;
  culture?: string | null;
  genre?: string | null;
  technique?: string | null;
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  similarity?: number;
}

function shapeArtworkRow(
  doc: Record<string, unknown>,
  semantic?: {
    period: string | null; culture: string | null; genre: string | null;
    technique: string | null; subjects: string[]; figures: string[];
    symbols: string[]; similarity: number; summary_text: string | null;
  }
): ArtworkRow {
  const slug = (doc.slug as string) || (doc.id as string);
  // Resolve, don't collapse (#4288): `display_title || title` erases the
  // difference between a museum's title and an AI caption of the picture.
  const resolvedTitle = resolveTitle(doc as Parameters<typeof resolveTitle>[0]);
  const title = resolvedTitle.display;
  const description = semantic?.summary_text
    || (typeof doc.summary === 'string' ? (doc.summary as string) : null);
  const thumbnail = (doc.image_thumb as string) || (doc.thumbnail_blob as string)
    || (doc.thumbnail as string) || null;
  const image = (doc.image_display as string) || (doc.image_full as string)
    || (doc.thumbnail as string) || thumbnail;

  return {
    id: doc.id as string,
    source: 'artwork',
    title,
    title_provenance: resolvedTitle.provenance,
    source_record_title: resolvedTitle.citation,
    author: (doc.author as string) ?? null,
    published: (doc.published as string) ?? null,
    year: (doc.year as number) ?? null,
    type: (doc.resource_type as string) ?? null,
    medium: (doc.medium as string) ?? null,
    description: description ? description.slice(0, 500) : null,
    image_url: image,
    thumbnail_url: thumbnail,
    url: `https://sourcelibrary.org/book/${slug}`,
    collections: (doc.collections as string[]) ?? [],
    current_location: (doc.current_location as string) ?? null,
    ...(semantic ? {
      period: semantic.period,
      culture: semantic.culture,
      genre: semantic.genre,
      technique: semantic.technique,
      subjects: semantic.subjects,
      figures: semantic.figures,
      symbols: semantic.symbols,
      similarity: Math.round(semantic.similarity * 1000) / 1000,
    } : {}),
  };
}

function matchesIgnoreCase(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}
