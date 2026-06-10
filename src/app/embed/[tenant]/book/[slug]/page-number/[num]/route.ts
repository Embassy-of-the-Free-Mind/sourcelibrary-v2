import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { resolveTenantId } from '@/lib/tenant-context';
import { resolvePageByNumber } from '@/lib/page-number-resolve';

interface RouteContext {
  params: Promise<{ tenant: string; slug: string; num: string }>;
}

/**
 * /embed/[tenant]/book/[slug]/page-number/[num] → 308 to the canonical
 * /embed/[tenant]/book/[slug]/page/[pageId].
 *
 * Mirror of the global /book/[id]/page-number/[num] route — printed-page
 * citations circulate on the tenant subdomains too, and without this route
 * they hard-404'd (seen in not_found_reports from real BPH readers). The
 * redirect stays on the embed path, so it never leaves the tenant subdomain
 * (Tenant Subdomain Lockdown invariant 1).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { tenant, slug, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const tenantId = await resolveTenantId(tenant);
  if (!tenantId) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const db = await getReadDb();
  const result = await findBookByIdOrSlug(db, slug, { id: 1, slug: 1 }, tenantId);
  if (!result) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const bookSlug = (result.book.slug || bookId) as string;

  // Nearest-page fallback, same as the global route: a printed page number
  // that doesn't land exactly still puts the reader on the closest page.
  const page = await resolvePageByNumber(db, bookId, pageNumber);
  if (!page) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const pageId = page.id || page._id?.toString();
  const destination = new URL(`/embed/${tenant}/book/${bookSlug}/page/${pageId}`, request.url);
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}
