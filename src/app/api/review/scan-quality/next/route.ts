import { NextRequest, NextResponse } from 'next/server';
import { nextCandidate } from '@/lib/review-candidates';

export const maxDuration = 15;

/**
 * GET /api/review/scan-quality/next?volunteer_id=<uuid>
 *
 * Returns one unrated full-page scan for the scan-quality queue.
 * Per CLAUDE.md, scan_quality is currently only computed on illustration-
 * candidate pages (~0.2% of pages). Human ratings here generate ground-truth
 * labels we can use to train a classifier on the rest.
 *
 * Items are served from the pooled `review_candidates` collection. This route
 * previously ran `$sample` over `pages` (19.1M docs), a full collection scan
 * that returned 504 in production. See src/lib/review-candidates.ts.
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const result = await nextCandidate('scan-quality', volunteerId);
  if (!result.item) {
    return NextResponse.json({ item: null, message: result.message });
  }

  const c = result.item;

  return NextResponse.json({
    item: {
      item_id: c.item_id,
      page_id: c.page_id,
      book_id: c.book_id,
      page_number: c.page_number,
      page_type: c.page_type,
      image_url: c.image_url,
      page_link: c.page_link,
      existing_scan_quality: c.payload?.existing_scan_quality ?? null,
      book: c.book,
    },
  });
}
