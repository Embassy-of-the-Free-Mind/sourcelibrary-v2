import { NextRequest, NextResponse } from 'next/server';
import { Db } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { cosineSimilarity } from '@/lib/embeddings';

export const preferredRegion = 'fra1';

/**
 * GET /api/gallery/similar?id={pageId}-{detectionIndex}&limit=12
 *
 * Find gallery images similar to the given image using text embeddings.
 * Falls back to metadata-based matching when no embedding exists.
 *
 * Response is cached 24 hours — similarity is stable.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '12'), 24);

    if (!id) {
      return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
    }

    const db = await getDb();

    // Try embedding-based similarity first
    const targetEmb = await db.collection('gallery_embeddings').findOne({ id });

    let results;

    if (targetEmb) {
      results = await embeddingSimilarity(
        db,
        targetEmb as unknown as { id: string; book_id: string; embedding: number[] },
        limit
      );
    } else {
      results = await metadataFallback(db, id, limit);
    }

    const response = NextResponse.json({
      items: results,
      total: results.length,
      method: targetEmb ? 'embedding' : 'metadata',
    });

    // Cache 24 hours
    response.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');

    return response;
  } catch (error) {
    console.error('Similar images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Embedding-based similarity: cosine rank all candidates in memory.
 */
async function embeddingSimilarity(
  db: Db,
  targetEmb: { id: string; book_id: string; embedding: number[] },
  limit: number
) {
  // Fetch candidates (exclude same book for diversity)
  const candidates = await db
    .collection('gallery_embeddings')
    .find(
      { id: { $ne: targetEmb.id }, book_id: { $ne: targetEmb.book_id } },
      { projection: { id: 1, page_id: 1, book_id: 1, detection_index: 1, embedding: 1 } }
    )
    .limit(500)
    .toArray();

  // Score and rank
  const scored = candidates
    .map((c) => ({
      id: c.id as string,
      pageId: c.page_id as string,
      bookId: c.book_id as string,
      detectionIndex: c.detection_index as number,
      similarity: cosineSimilarity(targetEmb.embedding, c.embedding as number[]),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  // Diversity: max 2 per book
  const byBook = new Map<string, number>();
  const topIds: string[] = [];
  for (const item of scored) {
    if (topIds.length >= limit) break;
    const count = byBook.get(item.bookId) ?? 0;
    if (count >= 2) continue;
    byBook.set(item.bookId, count + 1);
    topIds.push(item.id);
  }

  // Resolve to full gallery items
  return resolveGalleryItems(db, topIds, scored);
}

/**
 * Metadata fallback: match on shared subjects, type, and figures.
 */
async function metadataFallback(
  db: Db,
  targetId: string,
  limit: number
) {
  // Parse target ID to get page + detection
  const parts = targetId.split('-');
  const detectionIndex = parseInt(parts.pop()!);
  const pageId = parts.join('-');

  const page = await db.collection('pages').findOne(
    { id: pageId },
    { projection: { book_id: 1, detected_images: 1 } }
  );

  if (!page || !page.detected_images?.[detectionIndex]) {
    return [];
  }

  const det = page.detected_images[detectionIndex];
  const subjects = det.metadata?.subjects || [];
  const type = det.type;

  // Find pages with overlapping subjects or same type
  const matchConditions: Record<string, unknown>[] = [];
  if (subjects.length > 0) {
    matchConditions.push({ 'detected_images.metadata.subjects': { $in: subjects } });
  }
  if (type) {
    matchConditions.push({ 'detected_images.type': type });
  }

  if (matchConditions.length === 0) return [];

  const pages = await db
    .collection('pages')
    .aggregate([
      {
        $match: {
          book_id: { $ne: page.book_id },
          'detected_images.0': { $exists: true },
          $or: matchConditions,
        },
      },
      { $limit: 100 },
      {
        $lookup: {
          from: 'books',
          let: { bookId: '$book_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$id', '$$bookId'] } } },
            { $project: { title: 1, display_title: 1, author: 1, year: 1 } },
          ],
          as: 'book',
        },
      },
      { $unwind: '$book' },
    ])
    .toArray();

  // Score and rank detections by metadata overlap
  const items: Array<{
    pageId: string;
    bookId: string;
    pageNumber: number;
    detectionIndex: number;
    imageUrl: string;
    bookTitle: string;
    author?: string;
    year?: number;
    description: string;
    type?: string;
    extractedUrl?: string;
    thumbnailUrl?: string;
    galleryQuality?: number;
    museumDescription?: string;
    similarity: number;
  }> = [];

  const byBook = new Map<string, number>();

  for (const p of pages) {
    const dets = (p.detected_images || []) as Record<string, unknown>[];
    for (let idx = 0; idx < dets.length; idx++) {
      const d = dets[idx];
      if (!d.gallery_quality || (d.gallery_quality as number) < 0.5) continue;
      if (!d.bbox) continue;

      // Score overlap
      let score = 0;
      const dSubjects = ((d.metadata as Record<string, unknown>)?.subjects as string[]) || [];
      for (const s of dSubjects) {
        if (subjects.includes(s)) score += 2;
      }
      if (d.type === type) score += 1;

      if (score === 0) continue;

      const bCount = byBook.get(p.book_id as string) ?? 0;
      if (bCount >= 2) continue;
      byBook.set(p.book_id as string, bCount + 1);

      const book = p.book as Record<string, unknown>;
      items.push({
        pageId: p.id as string,
        bookId: p.book_id as string,
        pageNumber: p.page_number as number,
        detectionIndex: idx,
        imageUrl: (d.extracted_url || d.thumbnail_url || p.cropped_photo || p.archived_photo || p.photo) as string,
        bookTitle: (book.display_title || book.title) as string,
        author: book.author as string | undefined,
        year: book.year as number | undefined,
        description: (d.description || '') as string,
        type: d.type as string | undefined,
        extractedUrl: d.extracted_url as string | undefined,
        thumbnailUrl: d.thumbnail_url as string | undefined,
        galleryQuality: d.gallery_quality as number | undefined,
        museumDescription: d.museum_description as string | undefined,
        similarity: score,
      });

      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }

  items.sort((a, b) => b.similarity - a.similarity);
  return items.slice(0, limit);
}

/**
 * Resolve embedding IDs to full gallery items with book data.
 */
async function resolveGalleryItems(
  db: Db,
  ids: string[],
  scored: Array<{ id: string; similarity: number }>
) {
  if (ids.length === 0) return [];

  // Parse IDs to get page IDs
  const pageIds = [...new Set(ids.map((id) => {
    const parts = id.split('-');
    parts.pop(); // remove detection index
    return parts.join('-');
  }))];

  const pages = await db
    .collection('pages')
    .aggregate([
      { $match: { id: { $in: pageIds } } },
      {
        $lookup: {
          from: 'books',
          let: { bookId: '$book_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$id', '$$bookId'] } } },
            { $project: { title: 1, display_title: 1, author: 1, year: 1 } },
          ],
          as: 'book',
        },
      },
      { $unwind: '$book' },
    ])
    .toArray();

  const pageMap = new Map(pages.map((p) => [p.id as string, p]));
  const scoreMap = new Map(scored.map((s) => [s.id, s.similarity]));

  return ids
    .map((id) => {
      const parts = id.split('-');
      const detIdx = parseInt(parts.pop()!);
      const pageId = parts.join('-');
      const page = pageMap.get(pageId);
      if (!page) return null;

      const det = (page.detected_images as Record<string, unknown>[])?.[detIdx];
      if (!det) return null;

      const book = page.book as Record<string, unknown>;

      return {
        pageId,
        bookId: page.book_id as string,
        pageNumber: page.page_number as number,
        detectionIndex: detIdx,
        imageUrl: (det.extracted_url || det.thumbnail_url || page.cropped_photo || page.archived_photo || page.photo) as string,
        bookTitle: (book.display_title || book.title) as string,
        author: book.author as string | undefined,
        year: book.year as number | undefined,
        description: (det.description || '') as string,
        type: det.type as string | undefined,
        extractedUrl: det.extracted_url as string | undefined,
        thumbnailUrl: det.thumbnail_url as string | undefined,
        galleryQuality: det.gallery_quality as number | undefined,
        museumDescription: det.museum_description as string | undefined,
        similarity: scoreMap.get(id) ?? 0,
      };
    })
    .filter(Boolean);
}
