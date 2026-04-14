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

  // Purge Cloudflare edge cache for these paths too
  await purgeCloudflareUrls([`/book/${slug}`, `/book/${slug}/search`, `/book/${id}`]);

  return NextResponse.json({
    success: true,
    revalidated: [`/book/${slug}`, `/book/${id}`],
    timestamp: new Date().toISOString(),
  });
}
