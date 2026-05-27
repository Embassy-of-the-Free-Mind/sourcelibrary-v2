import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Optional: verify a simple shared secret for pipeline calls
  const authHeader = request.headers.get('x-revalidate-secret');
  const secret = process.env.REVALIDATE_SECRET;
  if (secret && authHeader !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await getDb();
  const result = await findBookByIdOrSlug(db, id);

  if (!result) {
    return NextResponse.json({ error: 'Book not found' }, { status: 404 });
  }

  const book = result.book;
  const slug = book.slug || id;

  // Revalidate the book page and all sub-pages
  revalidatePath(`/book/${slug}`);
  revalidatePath(`/book/${slug}/search`);
  // Also revalidate by ID in case both are cached
  revalidatePath(`/book/${id}`);

  // Revalidate individual page routes via layout invalidation
  revalidatePath(`/book/${slug}`, 'layout');

  const revalidated = [`/book/${slug}`, `/book/${id}`];

  // Also revalidate tenant-scoped paths if book belongs to a tenant.
  const bookTenantUuid = book.tenantId as string | undefined;
  let tenantSlug: string | null = null;
  if (bookTenantUuid) {
    const tenant = await db.collection('tenants').findOne(
      { id: bookTenantUuid },
      { projection: { slug: 1 } }
    );
    tenantSlug = (tenant?.slug as string) || null;
  }
  if (tenantSlug) {
    // Regular tenant route
    revalidatePath(`/${tenantSlug}/book/${slug}`);
    revalidatePath(`/${tenantSlug}/book/${slug}/search`);
    revalidatePath(`/${tenantSlug}/book/${slug}`, 'layout');
    revalidatePath(`/${tenantSlug}/book/${id}`);
    // Tenant subdomains route to /embed/[tenant]/book/[slug] via proxy.ts.
    // Without this, Vercel's edge cache happily keeps serving the stale 404
    // after a visibility flip — that's how the Bhutan promotion bit us.
    revalidatePath(`/embed/${tenantSlug}/book/${slug}`);
    revalidatePath(`/embed/${tenantSlug}/book/${slug}`, 'layout');
    revalidatePath(`/embed/${tenantSlug}/book/${id}`);
    revalidated.push(
      `/${tenantSlug}/book/${slug}`,
      `/${tenantSlug}/book/${id}`,
      `/embed/${tenantSlug}/book/${slug}`,
      `/embed/${tenantSlug}/book/${id}`,
    );
  }

  // Purge Cloudflare edge cache for these paths too
  await purgeCloudflareUrls(revalidated);

  return NextResponse.json({
    success: true,
    revalidated,
    timestamp: new Date().toISOString(),
  });
}
