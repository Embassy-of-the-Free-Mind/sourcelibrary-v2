import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 15;

/**
 * GET /api/review/scan-quality/next?volunteer_id=<uuid>
 *
 * Returns one unrated full-page scan for the scan-quality queue.
 * Per CLAUDE.md, scan_quality is currently only computed on illustration-
 * candidate pages (~0.2% of pages). Human ratings here generate ground-
 * truth labels we can use to train a classifier on the rest.
 *
 * Sampling strategy: random pages from visible books, weighted toward pages
 * that don't already have a scan_quality classification.
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
      .eq('queue', 'scan-quality')
      .eq('volunteer_id', volunteerId)
      .limit(5000);
    if (data) for (const row of data) ratedItemIds.add(row.item_id as string);
  }

  const db = await getReadDb();

  const candidates = await db.collection('pages').aggregate([
    { $match: { archived_photo: { $exists: true, $ne: null } } },
    { $sample: { size: 30 } },
    {
      $project: {
        _id: 0,
        id: 1,
        book_id: 1,
        page_number: 1,
        page_type: 1,
        archived_photo: 1,
        photo_original: 1,
        photo: 1,
        scan_quality: 1,
      },
    },
  ]).toArray();

  for (const p of candidates) {
    const itemId = String(p.id);
    if (ratedItemIds.has(itemId)) continue;

    // Only include books that are visible (don't show users hidden material)
    const book = await db
      .collection('books')
      .findOne(
        { id: p.book_id, visible: true },
        { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1 } },
      );
    if (!book) continue;

    return NextResponse.json({
      item: {
        item_id: itemId,
        page_id: p.id,
        book_id: p.book_id,
        page_number: p.page_number,
        page_type: p.page_type ?? null,
        image_url: p.archived_photo || p.photo_original || p.photo,
        page_link: `https://sourcelibrary.org/book/${book.slug || p.book_id}/page/${p.page_number}`,
        existing_scan_quality: p.scan_quality ?? null,
        book,
      },
    });
  }

  return NextResponse.json({ item: null, message: 'No unrated items in this sample — try again.' });
}
