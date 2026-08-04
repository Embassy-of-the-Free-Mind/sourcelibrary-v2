import { NextRequest, NextResponse } from 'next/server';
import { nextCandidate } from '@/lib/review-candidates';

export const maxDuration = 15;

/**
 * GET /api/review/hallucination/next?volunteer_id=<uuid>
 *
 * Returns the next unrated page from the hallucination-check queue: a page
 * whose OCR claims an illustration, which the extraction worker would keep.
 * The volunteer confirms the description matches the image before we spend a
 * vision call on it.
 *
 * Items are served from the pooled `review_candidates` collection. This route
 * previously ran `$sample` over `pages` (19.1M docs) with a regex on
 * `ocr.data` — an unindexable full collection scan that returned 504 in
 * production. See src/lib/review-candidates.ts.
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const result = await nextCandidate('hallucination', volunteerId);
  if (!result.item) {
    return NextResponse.json({ item: null, message: result.message });
  }

  const c = result.item;
  const descriptions =
    (c.payload?.descriptions as Array<Record<string, unknown>> | undefined) ?? [];

  return NextResponse.json({
    item: {
      item_id: c.item_id,
      book_id: c.book_id,
      page_number: c.page_number,
      page_type: c.page_type,
      image_url: c.image_url,
      page_link: c.page_link,
      book: c.book,
      descriptions,
    },
  });
}
