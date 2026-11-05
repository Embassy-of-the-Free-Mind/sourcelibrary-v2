/**
 * The terms a person agrees to before downloading a book from a protected
 * partner's collection, and the record that they did.
 *
 * PRIOR ART: src/lib/partner-access.ts decides which books are protected and how
 * much of one a caller may read; this reuses its test and adds the agreement.
 * src/lib/download-cap.ts records downloads to enforce a cap, and is not evidence
 * of what anyone agreed to. src/app/terms/page.tsx holds the words.
 *
 * The server decides, so the rule is the same on the apex, the subdomain, the
 * Embassy's iframe and any client we do not know about. A browser asks for the
 * file; a 403 `terms_required` makes DownloadButton show the agreement; the retry
 * carries `terms=<version>`. No cookie is involved, because a cookie set inside a
 * cross-site iframe is not reliably sent back.
 *
 * THIS RECORDS AGREEMENT. IT DOES NOT STOP A DETERMINED COPIER. A script can send
 * the parameter too, and by sending it has made the same statement, which is what
 * the record is for. What limits bulk copying is partner-access.ts and the budgets.
 *
 * Changing the words on /terms in a way that matters means a new version here,
 * and readers are asked again.
 *
 * Switch: PARTNER_TERMS_ENFORCE=0 stops asking, everywhere, at once.
 */
import { NextResponse } from 'next/server';
import { hasCronAuth } from '@/lib/book-access';
import { anonymousDownloadCapKey } from '@/lib/partner-embed-download-server';
import { isProtectedPartnerBook } from '@/lib/partner-access';
import { getDb } from '@/lib/mongodb';
import { PARTNER_TERMS_URL, PARTNER_TERMS_VERSION } from '@/lib/partner-terms-version';

export function partnerTermsEnforced(): boolean {
  return process.env.PARTNER_TERMS_ENFORCE !== '0';
}

/** Which door a download came through, for the record. */
function surfaceOf(headers: Headers): 'embed' | 'subdomain' | 'apex' {
  const host = (headers.get('host') || '').split(':')[0];
  if (/\/embed\//.test(headers.get('referer') || '')) return 'embed';
  return host === 'sourcelibrary.org' || host === 'www.sourcelibrary.org' ? 'apex' : 'subdomain';
}

/**
 * A 403 when the caller must agree first, or null to carry on. An agreement that
 * cannot be written does not cost the reader their download: the row is evidence,
 * and its absence is logged.
 */
export async function partnerTermsRefusal(
  request: Request,
  book: { id?: string; tenantId?: string | null } | null | undefined,
  { userId, format }: { userId: string | null; format: string },
): Promise<NextResponse | null> {
  if (!book || !partnerTermsEnforced() || hasCronAuth(request)) return null;
  if (!(await isProtectedPartnerBook(book))) return null;

  const stated = new URL(request.url).searchParams.get('terms');
  if (stated !== PARTNER_TERMS_VERSION) {
    return NextResponse.json(
      {
        error: 'This book is from the Embassy of the Free Mind\'s collection. Agree to its terms of use to download it.',
        terms_required: true,
        terms_version: PARTNER_TERMS_VERSION,
        terms_url: PARTNER_TERMS_URL,
      },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  try {
    const db = await getDb();
    await db.collection('partner_terms_acceptances').insertOne({
      terms_version: PARTNER_TERMS_VERSION,
      book_id: book.id ?? null,
      tenant_id: book.tenantId,
      format,
      surface: surfaceOf(request.headers),
      user_id: userId,
      // The address is hashed, not stored, by the same rule as the download cap.
      client_key: anonymousDownloadCapKey(request.headers),
      user_agent: (request.headers.get('user-agent') || '').slice(0, 200),
      accepted_at: new Date(),
    });
  } catch (error) {
    console.error('[partner-terms] could not record an agreement', error);
  }
  return null;
}
