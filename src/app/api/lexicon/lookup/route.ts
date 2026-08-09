/**
 * GET /api/lexicon/lookup?word=cœlum — dictionary lookup for the parsing
 * reader (issue #3823, Phase 1).
 *
 * Resolves a (possibly early modern, possibly OCR-noisy) Latin word to Lewis
 * & Short entries via the tiered chain in src/lib/lexicon/lookup.ts:
 * exact → variant → irregular → generated paradigm → suffix heuristic →
 * loose orthography. Uncertain tiers return `confident: false`; a miss is a
 * structured `found: false`, never a wrong entry dressed up as an answer.
 *
 * &lang=la is accepted and required to be Latin for now — the parameter
 * exists so Greek (LSJ) can slot in later without a URL change.
 *
 * Anonymous, read-only, aggressively CDN-cached: word → entry is immutable
 * short of a re-import, so cache hard and let deploys purge.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { lookupLatinWord } from '@/lib/lexicon/lookup';

export const dynamic = 'force-dynamic';

const CACHE_HEADERS = {
  // max-age matters: a Cache-Control without it survives CDN purges in
  // browser caches (see lesson on s-maxage-only headers).
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  'CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
} as const;

export async function GET(request: NextRequest) {
  const word = request.nextUrl.searchParams.get('word') ?? '';
  const lang = request.nextUrl.searchParams.get('lang') ?? 'la';

  if (lang !== 'la') {
    return NextResponse.json(
      { error: `Unsupported lang "${lang}" — only "la" (Latin) is available.` },
      { status: 400 }
    );
  }
  if (!word.trim() || word.length > 80) {
    return NextResponse.json({ error: 'Provide ?word= (1–80 chars).' }, { status: 400 });
  }

  try {
    const db = await getReadDb();
    const result = await lookupLatinWord(db, word);
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[lexicon/lookup] failed:', err);
    return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
  }
}
