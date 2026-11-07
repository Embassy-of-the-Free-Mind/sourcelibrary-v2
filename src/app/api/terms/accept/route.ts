import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonymousDownloadCapKey } from '@/lib/partner-embed-download-server';
import {
  READER_TERMS_COOKIE,
  READER_TERMS_MAX_AGE_SECONDS,
  READER_TERMS_VERSION,
  pathFromSameOriginUrl,
  readerTermsReturnPath,
} from '@/lib/reader-terms';

/**
 * POST /api/terms/accept: the form on the page Cloudflare shows a browser that
 * opens a deep book page cold (#8286; src/lib/reader-terms.ts).
 *
 * An agreement that cannot be written does not cost the reader their page: the row
 * is evidence, and its absence is logged.
 */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const statedOrigin = request.headers.get('origin');
  if (statedOrigin && statedOrigin !== origin) {
    return new NextResponse('This form can only be sent from Source Library.', { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (form?.get('agree') !== 'on') {
    return new NextResponse('Tick the box to agree, then send the form again.', { status: 400 });
  }

  const stated = form.get('next');
  const returnPath = readerTermsReturnPath(
    typeof stated === 'string' && stated
      ? stated
      : pathFromSameOriginUrl(request.headers.get('referer'), origin),
  );

  try {
    const db = await getDb();
    await db.collection('reader_terms_acceptances').insertOne({
      terms_version: READER_TERMS_VERSION,
      path: returnPath,
      // The address is hashed, not stored, by the same rule as partner-terms.ts.
      client_key: anonymousDownloadCapKey(request.headers),
      user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
      accepted_at: new Date(),
    });
  } catch (error) {
    console.error('[reader-terms] could not record an agreement', error);
  }

  const response = NextResponse.redirect(new URL(returnPath, origin), { status: 303 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.cookies.set(READER_TERMS_COOKIE, READER_TERMS_VERSION, {
    path: '/',
    maxAge: READER_TERMS_MAX_AGE_SECONDS,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  return response;
}
