import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { withCuratorAuth } from '@/lib/auth-helpers';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';
import {
  setPublication, mapLegacyReason, bookRefFilter, PUBLICATION_REASONS,
  type PublicationOpts, type PublicationReason,
} from '@/lib/publication';

/**
 * POST /api/books/[id]/visibility
 *
 * Toggle book visibility for curation, through the publication writer (#5340).
 * Body: { hidden: boolean, reason?: string, issue?: number, override?: 'rights-cleared' }
 *   hidden: false → state public
 *   hidden: true  → state hidden; `reason` may be an enum value or legacy free
 *                   text (mapped by the reviewed table, text kept in `note`). A
 *                   rights-class reason is a takedown and needs `issue`.
 * Leaving takedown needs { override: 'rights-cleared', issue } — the writer refuses otherwise.
 */
export const POST = withCuratorAuth(async (
  request: NextRequest,
  session,
) => {
  try {
    // Extract book ID from URL path: /api/books/[id]/visibility
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.indexOf('books') + 1];
    const body = await request.json();
    const { hidden, reason, issue, override } = body;

    if (typeof hidden !== 'boolean') {
      return NextResponse.json(
        { error: 'hidden must be a boolean' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const by = `route:/api/books/[id]/visibility${session?.user?.email ? ` (${session.user.email})` : ''}`;

    let opts: PublicationOpts;
    if (!hidden) {
      opts = { state: 'public', by, issue, override };
    } else {
      const enumReason = (PUBLICATION_REASONS as readonly string[]).includes(reason)
        ? (reason as PublicationReason) : null;
      const mapped = enumReason ? null : mapLegacyReason(reason);
      opts = {
        state: mapped?.state === 'takedown' ? 'takedown' : 'hidden',
        reason: enumReason ?? mapped?.reason ?? 'curation',
        note: mapped?.note ?? null,
        by,
        issue,
        override,
      };
    }

    let result;
    try {
      result = await setPublication(db, id, opts);
    } catch (err) {
      // A refused transition (takedown without an issue, leaving takedown without override).
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
    if (result.status === 'not_found') {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const book = await db.collection('books').findOne(
      bookRefFilter(id),
      { projection: { id: 1, slug: 1, title: 1, hidden: 1, hidden_reason: 1, publication: 1 } }
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
      publication: book.publication,
    });
  } catch (error) {
    console.error('Visibility toggle error:', error);
    return NextResponse.json(
      { error: 'Failed to update visibility' },
      { status: 500 }
    );
  }
});
