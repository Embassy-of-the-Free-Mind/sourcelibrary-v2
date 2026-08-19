import { NextRequest, NextResponse } from 'next/server';
import { nextCandidate } from '@/lib/review-candidates';

export const maxDuration = 15;

/**
 * GET /api/review/spanish-copy/next?volunteer_id=<uuid>
 *
 * Returns one translated interface string for a Spanish reader to judge.
 *
 * Unlike the other queues there is no page, book or image here — the item under
 * review is our own UI copy. `nextCandidate()` matches on `queue` alone, so the
 * only thing this route does differently is project `payload` instead of the
 * page fields.
 *
 * Pool is built by scripts/maintenance/build-spanish-copy-candidates.mjs.
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const result = await nextCandidate('spanish-copy', volunteerId);
  if (!result.item) {
    return NextResponse.json({ item: null, message: result.message });
  }

  const p = (result.item.payload ?? {}) as {
    key?: string;
    en?: string;
    es?: string;
    where?: string;
  };

  return NextResponse.json({
    item: {
      item_id: result.item.item_id,
      key: p.key ?? result.item.item_id,
      en: p.en ?? '',
      es: p.es ?? '',
      where: p.where ?? '',
    },
  });
}
