import { NextRequest, NextResponse } from 'next/server';
import { nextCandidate } from '@/lib/review-candidates';

export const maxDuration = 15;

/**
 * GET /api/review/page-check/next?volunteer_id=<uuid>
 *
 * The generic queue: returns a URL and the question to answer about it.
 * Everything task-specific lives in the candidate's `payload`, so a new kind of
 * check is rows in `review_candidates`, not code here.
 *
 * Pool: scripts/maintenance/build-page-check-candidates.mjs
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const result = await nextCandidate('page-check', volunteerId);
  if (!result.item) {
    return NextResponse.json({ item: null, message: result.message });
  }

  const p = (result.item.payload ?? {}) as {
    url?: string;
    prompt?: string;
    label?: string;
    campaign?: string;
  };

  return NextResponse.json({
    item: {
      item_id: result.item.item_id,
      url: p.url ?? '',
      prompt: p.prompt ?? 'Have a look at this page. Is anything wrong with it?',
      label: p.label ?? '',
      campaign: p.campaign ?? '',
    },
  });
}
