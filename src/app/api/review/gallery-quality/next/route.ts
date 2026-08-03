import { NextRequest, NextResponse } from 'next/server';
import { nextCandidate } from '@/lib/review-candidates';

export const maxDuration = 15;

/**
 * GET /api/review/gallery-quality/next?volunteer_id=<uuid>
 *
 * Returns one unrated extracted image for the gallery-quality queue.
 * The pool is built from images at gallery_quality >= 0.4, capped per book so
 * one heavily-illustrated volume can't dominate the sample. That selection now
 * lives in the builder (scripts/maintenance/build-review-candidates.mjs)
 * rather than in the request path.
 *
 * This route never 504'd, but `$sample` over `gallery_images` (207K docs) cost
 * ~8.2s per item, which is its own kind of unusable. It now reads the pooled
 * `review_candidates` collection like the other two queues.
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const result = await nextCandidate('gallery-quality', volunteerId);
  if (!result.item) {
    return NextResponse.json({ item: null, message: result.message });
  }

  const c = result.item;
  const p = c.payload ?? {};

  return NextResponse.json({
    item: {
      item_id: c.item_id,
      gallery_image_id: p.gallery_image_id ?? c.item_id,
      book_id: c.book_id,
      page_number: c.page_number,
      image_url: c.image_url,
      full_page_url: p.full_page_url ?? null,
      page_link: c.page_link,
      description: p.description ?? null,
      type: p.type ?? null,
      gallery_quality: p.gallery_quality ?? null,
      book: c.book,
    },
  });
}
