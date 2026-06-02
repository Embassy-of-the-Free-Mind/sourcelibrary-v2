import { NextRequest, NextResponse } from 'next/server';
import { hybridSearch } from '@/lib/search/librarian-search';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { supabase } from '@/lib/supabase';
import { CLIP_URL } from '@/lib/clip';
import { stripAnnotations } from '@/lib/semantic-alignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/embassy/voice-search — search endpoint for the voice Librarian.
 *
 * Runs the SAME hybrid search (RRF over keyword + semantic, optional rerank)
 * the text Librarian uses, plus a gallery-image search, and returns:
 *   - `spoken`: a short natural-language summary for the voice agent to read
 *   - `sources`: rich passage cards (with book-cover thumbnails) for the UI
 *   - `images`: gallery illustrations (with image URLs) for the UI
 *
 * Replaces the voice client's old raw /api/search calls so voice matches the
 * text Librarian's result quality and gains pictures. See CLAUDE.md (search
 * has three surfaces — this is a new voice surface routed through hybridSearch).
 */

type GalleryImage = {
  id: string;
  imageUrl: string;
  description: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber?: number;
  type?: string;
};

// Mirrors executeSearchImages() in src/lib/embassy/librarian.ts: CLIP
// text-to-image first, keyword fallback on gallery_images.
async function searchImages(query: string): Promise<GalleryImage[]> {
  const db = await getDb();
  const clipIds = new Map<string, number>();
  try {
    const resp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const { embedding } = await resp.json();
      if (embedding) {
        const { data } = await supabase.rpc('match_clip_images', {
          query_embedding: embedding,
          match_threshold: 0.2,
          match_count: 8,
        });
        if (data) {
          for (const match of data) {
            if (match.source_type === 'gallery_image' && match.id) clipIds.set(match.id, match.similarity);
          }
        }
      }
    }
  } catch {
    // CLIP unavailable — fall through to keyword search.
  }

  const projection = {
    image_url: 1, description: 1, museum_description: 1,
    book_id: 1, book_title: 1, book_author: 1, book_slug: 1, page_number: 1, type: 1,
  };

  let images: Record<string, unknown>[] = [];
  if (clipIds.size > 0) {
    const ids = [...clipIds.keys()].filter((id) => /^[a-f0-9]{24}$/.test(id)).map((id) => new ObjectId(id));
    if (ids.length) {
      images = await db.collection('gallery_images').find({ _id: { $in: ids } }).project(projection).toArray();
    }
  }
  // Keyword fallback whenever CLIP gave us nothing usable (down, or returned
  // ids that no longer resolve to gallery_images). The original librarian
  // logic returned [] in that case — this surfaces images far more reliably.
  if (images.length === 0) {
    const regex = query.split(/\s+/).map((w) => `(?=.*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`).join('');
    images = await db.collection('gallery_images')
      .find({
        gallery_quality: { $gte: 0.7 },
        $or: [
          { description: { $regex: regex, $options: 'i' } },
          { museum_description: { $regex: regex, $options: 'i' } },
          { 'metadata.subjects': { $regex: regex, $options: 'i' } },
        ],
      })
      .sort({ gallery_quality: -1 })
      .limit(6)
      .project(projection)
      .toArray();
  }

  return images.slice(0, 6).map((img) => ({
    id: String(img._id),
    imageUrl: img.image_url as string,
    description: String(img.museum_description || img.description || '').slice(0, 200),
    bookTitle: (img.book_title as string) || 'Unknown',
    bookAuthor: (img.book_author as string) || 'Unknown',
    bookSlug: img.book_slug as string | undefined,
    pageNumber: img.page_number as number | undefined,
    type: img.type as string | undefined,
  }));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'missing q' }, { status: 400 });
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 6, 10);
  const wantImages = req.nextUrl.searchParams.get('images') !== 'false';

  const [hits, images] = await Promise.all([
    hybridSearch(q, { tenantId: null, limit }).catch((e) => {
      console.error('[voice-search] hybridSearch failed:', e);
      return { passages: [], books: [] };
    }),
    wantImages ? searchImages(q).catch((e) => { console.error('[voice-search] images failed:', e); return []; }) : Promise.resolve([] as GalleryImage[]),
  ]);

  // Enrich passages with book-cover thumbnails (hybridSearch omits them).
  const db = await getDb();
  const bookIds = [...new Set(hits.passages.map((p) => p.book_id))];
  const coverDocs = bookIds.length
    ? await db.collection('books').find({ id: { $in: bookIds } }).project({ id: 1, thumbnail: 1, image_thumb: 1 }).toArray()
    : [];
  const coverById = new Map(coverDocs.map((b) => [b.id as string, (b.thumbnail || b.image_thumb || null) as string | null]));

  const sources = hits.passages.slice(0, limit).map((p) => ({
    bookId: p.book_id,
    title: p.bookTitle,
    author: p.bookAuthor,
    slug: p.bookSlug,
    pageNumber: p.page_number,
    snippet: stripAnnotations(p.text).slice(0, 240),
    thumbnail: coverById.get(p.book_id) || null,
  }));

  // A concise, speakable summary so the agent can answer without inventing detail.
  const spoken = sources.length
    ? `Found ${sources.length} passage${sources.length === 1 ? '' : 's'} across ${bookIds.length} book${bookIds.length === 1 ? '' : 's'}. ` +
      sources.slice(0, 4).map((s) => `"${s.title}" by ${s.author}${s.pageNumber ? `, page ${s.pageNumber}` : ''}`).join('; ') + '.' +
      (images.length ? ` ${images.length} illustration${images.length === 1 ? '' : 's'} also found.` : '')
    : 'No matching passages found in the library for that query.';

  return NextResponse.json({ spoken, found: sources.length, sources, images });
}
