import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

/**
 * GET /api/artwork/search?q=...&limit=...
 *
 * Search artwork items (paintings, prints, sculptures) stored in the books collection.
 * These are distinct from gallery_images (extracted illustrations from book pages).
 * Artworks are identified by having R2 artwork/ thumbnail URLs.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

  if (!query) {
    return NextResponse.json({ error: 'q parameter required' }, { status: 400 });
  }

  const db = await getReadDb();
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const artworks = await db.collection('books')
    .find({
      thumbnail: { $regex: /^https:\/\/images\.sourcelibrary\.org\/artwork\// },
      visible: true,
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { artist: { $regex: pattern, $options: 'i' } },
        { author: { $regex: pattern, $options: 'i' } },
      ],
    }, {
      projection: {
        _id: 0, id: 1, title: 1, artist: 1, author: 1, year: 1,
        thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, slug: 1, medium: 1,
        collections: 1,
      },
    })
    .limit(limit)
    .toArray();

  const items = artworks.map(art => ({
    id: art.id,
    title: art.title,
    artist: art.artist || art.author,
    year: art.year,
    medium: art.medium,
    image_url: art.thumbnail_blob || art.thumbnail,
    thumbnail_url: art.thumbnail,
    url: `https://sourcelibrary.org/book/${art.slug || art.id}`,
    collections: art.collections,
  }));

  return NextResponse.json({
    total: items.length,
    items,
  }, {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
  });
}
