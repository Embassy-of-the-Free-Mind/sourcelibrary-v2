import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb, getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { ObjectId } from 'mongodb';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAdminAuth, withCuratorAuth } from '@/lib/auth-helpers';
import { withApiAuth } from '@/lib/api-auth';
import { logMetadataChange, diffBookFields } from '@/lib/book-changelog';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { mirrorBookToCatalog } from '@/lib/books-catalog';
import { COVER_WRITE_FIELDS } from '@/lib/cover-fields';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

export const preferredRegion = 'fra1';

export const GET = withApiAuth(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeFull = searchParams.get('full') === 'true';
    const pagesMode = searchParams.get('pages') || 'default'; // 'nav' for minimal, 'default' for standard
    const { id: tenantId } = getTenantContextFromRequest(request);

    // No tenant header → main-site request → serve from the global catalog
    // (findBookByIdOrSlug skips the tenant filter when tenantId is undefined).
    // Tenant header present → /api/[tenant]/books/[id] semantics → tenant-scoped lookup.

    // Use secondary reads for public GETs; admin full-view still reads primary for freshness
    const db = includeFull ? await getDb() : await getReadDb();

    // Book projection: nav mode keeps it light but still includes the
    // small fields the MCP get_book tool exposes (summary, page counts,
    // categories, year) — without these, MCP returns a book card with
    // null pages and no summary.
    const bookProjection = pagesMode === 'nav' ? {
      _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1,
      published: 1, year: 1, language: 1, doi: 1,
      pages_count: 1, pages_translated: 1,
      categories: 1, reading_summary: 1,
      chapters: 1,
      // Cover art (all four fields of the cover-write contract, see
      // src/lib/cover-fields.ts) — the MCP get_book tool attaches the cover
      // as an inline image block (#3937).
      thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
      // Needed by the MCP list_editions tool to find sibling editions of the
      // same work without a second lookup.
      work_id: 1,
      // What the volume's own running heads say it contains. Present only where
      // the scans carry heads; `status: 'insufficient-heads'` distinguishes
      // "we looked and could not tell" from "nobody looked".
      contains_works: 1,
    } : undefined;

    const result = await findBookByIdOrSlug(db, id, bookProjection || undefined, tenantId ?? undefined);
    if (!result) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
    const book = result.book;

    // Page projections:
    // - full: all fields (for admin/processing views)
    // - default: navigation + images + status (for book detail page grid)
    // - nav: minimal (id, page_number, split_from) for page viewer navigation only
    let projection: Record<string, unknown>;
    if (includeFull) {
      projection = {};
    } else if (pagesMode === 'nav') {
      projection = { _id: 0, id: 1, page_number: 1, split_from: 1 };
    } else {
      projection = {
        _id: 0,
        id: 1,
        page_number: 1,
        split_from: 1,
        photo: 1,
        photo_original: 1,
        archived_photo: 1,
        display_photo: 1,
        cropped_photo: 1,
        thumbnail: 1, image_display: 1,
        thumbnail_blob: 1, image_thumb: 1,
        crop: 1,
        'ocr.updated_at': 1,
        'translation.updated_at': 1,
        'summary.updated_at': 1,
        'detected_images.type': 1,
      };
    }

    const bookId = (book.id || book._id?.toString()) as string;
    const pageOffset = parseInt(searchParams.get('pageOffset') || '0');
    const pageLimit = parseInt(searchParams.get('pageLimit') || '0'); // 0 = all (backwards-compat)
    const pageFilter: Record<string, unknown> = { book_id: bookId, page_number: { $gte: 0 } };
    if (tenantId) pageFilter.tenantId = tenantId;
    let cursor = db.collection('pages')
      .find(pageFilter)
      .project(projection)
      .sort({ page_number: 1 });
    if (pageOffset > 0) cursor = cursor.skip(pageOffset);
    if (pageLimit > 0) cursor = cursor.limit(pageLimit);
    const pages = await cursor.toArray();

    const cacheControl = includeFull
      ? 'private, no-cache'
      : 'public, max-age=60, stale-while-revalidate=300';

    // Merge full index data from dedicated collection (heavy fields moved out of book docs)
    const indexDoc = await db.collection('book_indexes').findOne(
      { book_id: bookId },
      { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
    ).catch(() => null);
    if (indexDoc) {
      (book as any).index = { ...(book as any).index, ...indexDoc };
    }

    return NextResponse.json({ ...book, pages }, {
      headers: { 'Cache-Control': cacheControl }
    });
  } catch (error) {
    console.error('Error fetching book:', error);
    return NextResponse.json({ error: 'Failed to fetch book' }, { status: 500 });
  }
}, { route: 'books.get' });

export const DELETE = withAdminAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const confirmPermanent = searchParams.get('confirm') === 'PERMANENTLY_DELETE';
    const db = await getDb();

    // Find book by id or _id
    let book = await db.collection('books').findOne({ id });
    if (!book && ObjectId.isValid(id)) {
      book = await db.collection('books').findOne({ _id: new ObjectId(id) });
    }

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookId = book.id || book._id.toString();

    // SOFT DELETE by default - archive to deleted_books collection
    if (!confirmPermanent) {
      // Get all pages for archival
      const pages = await db.collection('pages').find({ book_id: bookId }).maxTimeMS(30000).toArray();

      // Archive book with its pages
      await db.collection('deleted_books').insertOne({
        ...book,
        pages,
        deleted_at: new Date(),
        original_id: book._id
      });

      // Remove from active collections
      await db.collection('pages').deleteMany({ book_id: bookId });
      await db.collection('books').deleteOne({ _id: book._id });

      // Audit log (non-blocking)
      logAuditEvent({
        action: 'book_deleted',
        book_id: bookId,
        book_title: book.title,
        pages_affected: pages.length,
        metadata: { recoverable: true },
      });

      return NextResponse.json({
        success: true,
        message: `Archived "${book.title}" with ${pages.length} pages`,
        bookId,
        recoverable: true,
        hint: 'POST /api/books/restore/{id} to recover'
      });
    }

    // PERMANENT DELETE - requires ?confirm=PERMANENTLY_DELETE
    // Check if book is in deleted_books and enforce 7-day waiting period
    const archivedBook = await db.collection('deleted_books').findOne({
      $or: [{ id: bookId }, { 'original_id': book._id }]
    });

    if (archivedBook) {
      const deletedAt = new Date(archivedBook.deleted_at);
      const daysSinceDeleted = (Date.now() - deletedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceDeleted < 7) {
        return NextResponse.json({
          error: 'Cannot permanently delete yet',
          message: `Book was archived ${daysSinceDeleted.toFixed(1)} days ago. Must wait 7 days before permanent deletion.`,
          deleted_at: archivedBook.deleted_at,
          can_purge_after: new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
        }, { status: 403 });
      }

      // OK to purge - it's been 7+ days
      await db.collection('deleted_books').deleteOne({ _id: archivedBook._id });

      logAuditEvent({
        action: 'book_deleted_permanent',
        book_id: bookId,
        book_title: archivedBook.title,
        metadata: { recoverable: false, source: 'archive' },
      });

      return NextResponse.json({
        success: true,
        message: `PERMANENTLY deleted archived book "${archivedBook.title}"`,
        bookId,
        recoverable: false
      });
    }

    // Book is not archived - permanent delete from active (should be rare)
    const pagesResult = await db.collection('pages').deleteMany({ book_id: bookId });
    await db.collection('books').deleteOne({ _id: book._id });

    logAuditEvent({
      action: 'book_deleted_permanent',
      book_id: bookId,
      book_title: book.title,
      pages_affected: pagesResult.deletedCount,
      metadata: { recoverable: false, source: 'active' },
    });

    return NextResponse.json({
      success: true,
      message: `PERMANENTLY deleted "${book.title}" and ${pagesResult.deletedCount} pages`,
      bookId,
      recoverable: false,
      warning: 'This action cannot be undone'
    });
  } catch (error) {
    console.error('Error deleting book:', error);
    return NextResponse.json({ error: 'Failed to delete book' }, { status: 500 });
  }
});

export const PATCH = withCuratorAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const db = await getDb();

    // Find book
    let book = await db.collection('books').findOne({ id });
    if (!book && ObjectId.isValid(id)) {
      book = await db.collection('books').findOne({ _id: new ObjectId(id) });
    }

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Allowed fields to update.
    // Cover-write fields come from a shared constant so adding a field there
    // automatically threads through to PATCH writers.
    const allowedFields = [
      'title', 'display_title', 'author', 'language', 'published',
      ...COVER_WRITE_FIELDS,
      // Editor-chosen About side plate/page (BookAboutPicker).
      'about_visual',
      'categories', 'status', 'summary', 'dublin_core',
      // USTC catalog fields
      'ustc_id', 'place_published', 'publisher', 'format',
      // Image source and licensing
      'image_source', 'license', 'doi',
      // Authority records (#1921 P3) — canonical author identity via VIAF.
      // The picker UI writes the entity FK (author_entity_id) plus three
      // denormalised display fields (canonical_name, wikidata_qid, viaf_id)
      // so the book detail page can render the canonical form without a
      // separate entity lookup. The entity itself lives in the existing
      // `entities` collection (shape matches scripts/enrichment/
      // viaf-author-linking.mjs) so picker-set books and batch-set books
      // share one identity source of truth.
      'author_entity_id', 'author_canonical_name', 'author_wikidata_qid', 'author_viaf_id',
    ];

    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    await db.collection('books').updateOne(
      { _id: book._id },
      { $set: updates }
    );

    const bookId = book.id || book._id.toString();
    const changedFields = Object.keys(updates).filter(k => k !== 'updated_at');

    // Mirror to Supabase books_catalog so cover/title/author edits surface
    // immediately instead of waiting for the 5-min Hetzner sync cron.
    await mirrorBookToCatalog(bookId, updates);
    if (changedFields.length > 0) {
      logAuditEvent({
        action: 'book_metadata_updated',
        book_id: bookId,
        book_title: book.title,
        metadata: { fields_changed: changedFields },
      });

      // Append-only changelog with before/after values
      const changes = diffBookFields(
        book as unknown as Record<string, unknown>,
        updates,
        changedFields,
      );
      if (changes.length > 0) {
        logMetadataChange(db, {
          book_id: bookId,
          source: 'admin_edit',
          changes,
        });
      }
    }

    // Revalidate book page for any field change (pages are statically cached).
    // revalidatePath alone is NOT enough: /book/* HTML is also held at the
    // Cloudflare edge for 24h (CDN-Cache-Control), so an admin cover/title edit
    // stays invisible for up to a day and reads as "changing the cover isn't
    // working" (feedback, 2026-06-22). Mirror what /api/admin/revalidate-book
    // does — revalidatePath + an explicit Cloudflare purge of the same paths.
    const bookSlug = book.slug || bookId;
    if (changedFields.length > 0) {
      const purgePaths: string[] = [`/book/${bookSlug}`, `/book/${bookId}`];
      revalidatePath(`/book/${bookSlug}`);
      revalidatePath(`/book/${bookSlug}`, 'layout');
      revalidatePath(`/book/${bookId}`);
      // Also revalidate tenant-scoped paths if book belongs to a tenant
      if (book.tenantId) {
        const tenant = await db.collection('tenants').findOne(
          { id: book.tenantId },
          { projection: { slug: 1 } }
        );
        if (tenant?.slug) {
          revalidatePath(`/${tenant.slug}/book/${bookSlug}`);
          revalidatePath(`/${tenant.slug}/book/${bookSlug}`, 'layout');
          revalidatePath(`/${tenant.slug}/book/${bookId}`);
          // Tenant subdomains route to /embed/[tenant]/book/[slug] via proxy.ts.
          revalidatePath(`/embed/${tenant.slug}/book/${bookSlug}`);
          revalidatePath(`/embed/${tenant.slug}/book/${bookSlug}`, 'layout');
          revalidatePath(`/embed/${tenant.slug}/book/${bookId}`);
          purgePaths.push(
            `/${tenant.slug}/book/${bookSlug}`,
            `/${tenant.slug}/book/${bookId}`,
            `/embed/${tenant.slug}/book/${bookSlug}`,
            `/embed/${tenant.slug}/book/${bookId}`,
          );
        }
      }
      // Thumbnail/title changes also affect listing pages (home, collections, search)
      if (changedFields.some(f => ['thumbnail', 'thumbnail_blob', 'image_display', 'image_thumb', 'title', 'display_title', 'author'].includes(f))) {
        revalidatePath('/', 'layout');
        purgePaths.push('/');
      }
      // Bust the Cloudflare edge HTML cache too (best-effort; never block the
      // response on it). Without this the revalidatePath above is shadowed by
      // the 24h CDN cache and the edit looks like it did nothing.
      try {
        await purgeCloudflareUrls(purgePaths);
      } catch (err) {
        console.error('Cloudflare purge after book update failed (non-fatal):', err);
      }
    }

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (error) {
    console.error('Error updating book:', error);
    return NextResponse.json({ error: 'Failed to update book' }, { status: 500 });
  }
});
