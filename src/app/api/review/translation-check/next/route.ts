import { NextRequest, NextResponse } from 'next/server';
import { nextCandidate } from '@/lib/review-candidates';

export const maxDuration = 15;

/**
 * GET /api/review/translation-check/next?volunteer_id=<uuid>
 *
 * One page for a reader of the original language to judge. Same generic pool as
 * page-check, different queue and a different set of verdicts: this one asks
 * about the transcription and the translation SEPARATELY, because a faithful
 * English rendering of an invented Latin line is not a good translation, and a
 * single verdict cannot tell those apart.
 *
 * Pool: scripts/maintenance/build-page-check-candidates.mjs translations
 *       --language=Latin --n=40 --apply
 */
export async function GET(request: NextRequest) {
  const volunteerId = request.nextUrl.searchParams.get('volunteer_id');
  if (!volunteerId) {
    return NextResponse.json({ error: 'volunteer_id required' }, { status: 400 });
  }

  const result = await nextCandidate('translation-check', volunteerId);
  if (!result.item) {
    return NextResponse.json({ item: null, message: result.message });
  }

  const p = (result.item.payload ?? {}) as {
    url?: string;
    prompt?: string;
    label?: string;
    campaign?: string;
    language?: string;
  };

  return NextResponse.json({
    item: {
      item_id: result.item.item_id,
      url: p.url ?? '',
      prompt: p.prompt ?? '',
      label: p.label ?? 'the page',
      campaign: p.campaign ?? '',
      language: p.language ?? '',
    },
  });
}
