import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

/**
 * POST /api/books/[id]/visibility
 *
 * Toggle book visibility for curation.
 * Body: { hidden: boolean, reason?: string }
 */
export const POST = withCuratorAuth(async (
  request: NextRequest,
) => {
  try {
    // Extract book ID from URL path: /api/books/[id]/visibility
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.indexOf('books') + 1];
    const body = await request.json();
    const { hidden, reason } = body;

    if (typeof hidden !== 'boolean') {
      return NextResponse.json(
        { error: 'hidden must be a boolean' },
        { status: 400 }
      );
    }

    const db = await getDb();

    const update: Record<string, unknown> = {
      hidden,
      visible: !hidden,
      updated_at: new Date(),
    };

    if (hidden && reason) {
      update.hidden_reason = reason;
    }

    if (!hidden) {
      // When un-hiding, clear the reason
      await db.collection('books').updateOne(
        { id },
        { $set: update, $unset: { hidden_reason: '' } }
      );
    } else {
      await db.collection('books').updateOne(
        { id },
        { $set: update }
      );
    }

    const book = await db.collection('books').findOne(
      { id },
      { projection: { id: 1, slug: 1, title: 1, hidden: 1, hidden_reason: 1 } }
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // A flip that does not evict the cache is only half a flip (#4843). While a
    // book is hidden, every reader URL anyone touched is cached as a 404 — and
    // that 404 is raised in the reader's route-group LAYOUT (it has to be, to
    // set a real status above loading.tsx), so it survives ordinary page-level
    // revalidation of the book paths and is served for the full 24h ISR window
    // after the book goes public. Measured 2026-09-15: 9 of 81 links into 16
    // freshly published books still 404'd after revalidate-book + a Cloudflare
    // purge; the origin returned 200 to a cache-busted request throughout.
    //
    // The route-pattern + 'layout' call is the one that clears them. It is
    // broad (every reader page of every book), which is why it runs HERE, on a
    // rare curatorial flip, and not in the per-book revalidation the pipeline
    // calls after each OCR/translation batch.
    const paths = [`/book/${book.slug || id}`, `/book/${id}`];
    for (const p of paths) {
      revalidatePath(p);
      revalidatePath(p, 'layout');
    }
    revalidatePath('/book/[id]/page/[pageId]', 'layout');
    // Cloudflare caches the same 404s in front of Vercel; purging the book
    // landing pages is cheap and the page URLs refill from the origin.
    await purgeCloudflareUrls(paths).catch(() => {});

    return NextResponse.json({
      id: book.id,
      title: book.title,
      hidden: book.hidden,
      hidden_reason: book.hidden_reason,
    });
  } catch (error) {
    console.error('Visibility toggle error:', error);
    return NextResponse.json(
      { error: 'Failed to update visibility' },
      { status: 500 }
    );
  }
});
