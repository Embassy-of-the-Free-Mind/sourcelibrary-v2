import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';
import {
  IMAGE_CANDIDATE_PAGE_TYPES,
  extractImageDescTags,
  shouldSkipPageByMarkup,
} from '@/lib/image-extraction-filter';

export const maxDuration = 15;

/**
 * GET /api/review/hallucination/next?volunteer_id=<uuid>
 *
 * Returns the next unrated page from the hallucination-check queue.
 * The queue consists of pages that:
 *   - Have <image-desc> markup in OCR
 *   - Would NOT be skipped by the trivial-markup filter (so they're real
 *     candidates for vision extraction — we want humans to confirm the
 *     description matches reality before we spend the call).
 *   - Are from books the user hasn't seen in this queue.
 *
 * Response: { item } with image_url, page metadata, OCR descriptions, etc.
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  // Pull list of item_ids this volunteer has already rated in this queue.
  const ratedItemIds = new Set<string>();
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from('volunteer_ratings')
      .select('item_id')
      .eq('queue', 'hallucination')
      .eq('volunteer_id', volunteerId)
      .limit(2000);
    if (data) for (const row of data) ratedItemIds.add(row.item_id as string);
  }

  const db = await getReadDb();

  // Random-sample candidate pages: visible books, pages with <image-desc>
  // markup, page_type either a candidate type (would extract) or non-candidate
  // type with markup. Use $sample for randomness across the corpus.
  // Over-fetch since we'll discard ones that fail the skip filter or are
  // already rated.
  const pipeline: Record<string, unknown>[] = [
    { $match: { 'ocr.data': { $regex: '<image-desc', $options: '' } } },
    { $sample: { size: 60 } },
    {
      $project: {
        _id: 0,
        book_id: 1,
        id: 1,
        page_number: 1,
        page_type: 1,
        archived_photo: 1,
        photo_original: 1,
        photo: 1,
        cropped_photo: 1,
        'ocr.data': 1,
      },
    },
  ];

  const candidates = await db.collection('pages').aggregate(pipeline).toArray();

  for (const p of candidates) {
    const itemId = `${p.book_id}:${p.page_number}`;
    if (ratedItemIds.has(itemId)) continue;

    // Only show pages the worker would KEEP. Pages in IMAGE_CANDIDATE_PAGE_TYPES
    // always extract regardless of markup; for others, apply the skip filter.
    const ocrData = p.ocr?.data ?? '';
    const inCandidateType = IMAGE_CANDIDATE_PAGE_TYPES.includes(p.page_type);
    const wouldSkip = !inCandidateType && shouldSkipPageByMarkup(ocrData);
    if (wouldSkip) continue;

    const tags = extractImageDescTags(ocrData);
    if (tags.length === 0) continue;

    // Pull lightweight book metadata.
    const book = await db
      .collection('books')
      .findOne(
        { id: p.book_id },
        { projection: { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1, slug: 1 } },
      );

    const imgUrl =
      p.archived_photo ||
      p.photo_original ||
      p.photo ||
      `https://images.sourcelibrary.org/archived/${p.book_id}/${p.page_number}.jpg`;

    return NextResponse.json({
      item: {
        item_id: itemId,
        book_id: p.book_id,
        page_number: p.page_number,
        page_type: p.page_type ?? null,
        image_url: imgUrl,
        page_link: `https://sourcelibrary.org/book/${book?.slug || p.book_id}/page/${p.page_number}`,
        book: book ?? null,
        descriptions: tags.map(t => ({
          type: t.type,
          significance: t.significance,
          size: t.size,
          description: t.description,
        })),
      },
    });
  }

  return NextResponse.json({ item: null, message: 'No unrated items in this sample — try again.' });
}
