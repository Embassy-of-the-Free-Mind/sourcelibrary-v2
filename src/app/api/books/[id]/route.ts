import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';

export const preferredRegion = 'fra1';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeFull = searchParams.get('full') === 'true';
    const pagesMode = searchParams.get('pages') || 'default'; // 'nav' for minimal, 'default' for standard
    const db = await getDb();

    // Book projection: nav mode only needs fields the reader uses
    const bookProjection = pagesMode === 'nav' ? {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1,
      published: 1, language: 1, doi: 1,
      chapters: 1,
    } : undefined;

    const book = await db.collection('books').findOne({ id }, bookProjection ? { projection: bookProjection } : undefined);
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

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
        cropped_photo: 1,
        thumbnail: 1,
        thumbnail_blob: 1,
        crop: 1,
        'ocr.updated_at': 1,
        'translation.updated_at': 1,
        'summary.updated_at': 1,
        'detected_images.type': 1,
      };
    }

    const pages = await db.collection('pages')
      .find({ book_id: id })
      .project(projection)
      .sort({ page_number: 1 })
      .toArray();

    const cacheControl = includeFull
      ? 'private, no-cache'
      : 'public, max-age=60, stale-while-revalidate=300';

    return NextResponse.json({ ...book, pages }, {
      headers: { 'Cache-Control': cacheControl }
    });
  } catch (error) {
    console.error('Error fetching book:', error);
    return NextResponse.json({ error: 'Failed to fetch book' }, { status: 500 });
  }
}

export const DELETE = withAuth(async (request, session, context) => {
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
      const pages = await db.collection('pages').find({ book_id: bookId }).toArray();

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

export const PATCH = withAuth(async (request, session, context) => {
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

    // Allowed fields to update
    const allowedFields = [
      'title', 'display_title', 'author', 'language', 'published',
      'thumbnail', 'thumbnail_blob', 'categories', 'status', 'summary', 'dublin_core',
      // USTC catalog fields
      'ustc_id', 'place_published', 'publisher', 'format',
      // Image source and licensing
      'image_source', 'license', 'doi',
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
    if (changedFields.length > 0) {
      logAuditEvent({
        action: 'book_metadata_updated',
        book_id: bookId,
        book_title: book.title,
        metadata: { fields_changed: changedFields },
      });
    }

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (error) {
    console.error('Error updating book:', error);
    return NextResponse.json({ error: 'Failed to update book' }, { status: 500 });
  }
});
