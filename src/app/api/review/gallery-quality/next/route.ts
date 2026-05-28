import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 15;

/**
 * GET /api/review/gallery-quality/next?volunteer_id=<uuid>
 *
 * Returns one unrated extracted image for the gallery-quality queue.
 * Biased toward the contested 0.5-0.85 quality band where the display
 * threshold matters most. The 0.7 display cutoff makes the band on either
 * side the highest-leverage place for human calibration.
 *
 * Item shape: { item_id, image_url, book, page_number, description, type,
 *   gallery_quality, ... }
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const ratedItemIds = new Set<string>();
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from('volunteer_ratings')
      .select('item_id')
      .eq('queue', 'gallery-quality')
      .eq('volunteer_id', volunteerId)
      .limit(5000);
    if (data) for (const row of data) ratedItemIds.add(row.item_id as string);
  }

  const db = await getReadDb();

  // 70% of samples from the contested band (0.5-0.85), 30% from the full range
  // so we still calibrate the high end occasionally.
  const inContestedBand = Math.random() < 0.7;
  const match: Record<string, unknown> = {
    extracted_url: { $ne: null },
    book_visible: true,
  };
  if (inContestedBand) {
    match.gallery_quality = { $gte: 0.5, $lt: 0.85 };
  } else {
    match.gallery_quality = { $gte: 0.4 };
  }

  const candidates = await db.collection('gallery_images').aggregate([
    { $match: match },
    { $sample: { size: 30 } },
    {
      $project: {
        _id: 0,
        id: 1,
        book_id: 1,
        page_number: 1,
        extracted_url: 1,
        thumbnail_url: 1,
        image_url: 1,
        description: 1,
        type: 1,
        gallery_quality: 1,
        book_title: 1,
        book_author: 1,
        book_year: 1,
        book_language: 1,
      },
    },
  ]).toArray();

  for (const g of candidates) {
    const itemId = String(g.id);
    if (ratedItemIds.has(itemId)) continue;

    // Pull the book slug for the page link
    const book = await db
      .collection('books')
      .findOne({ id: g.book_id }, { projection: { _id: 0, slug: 1 } });

    return NextResponse.json({
      item: {
        item_id: itemId,
        gallery_image_id: g.id,
        book_id: g.book_id,
        page_number: g.page_number,
        image_url: g.extracted_url || g.thumbnail_url || g.image_url,
        full_page_url: g.image_url,
        page_link: `https://sourcelibrary.org/book/${book?.slug || g.book_id}/page/${g.page_number}`,
        description: g.description ?? null,
        type: g.type ?? null,
        gallery_quality: g.gallery_quality ?? null,
        book: {
          title: g.book_title,
          author: g.book_author,
          year: g.book_year,
          language: g.book_language,
        },
      },
    });
  }

  return NextResponse.json({ item: null, message: 'No unrated items in this sample — try again.' });
}
