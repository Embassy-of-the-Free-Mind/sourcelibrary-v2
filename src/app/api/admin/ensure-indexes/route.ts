import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Ensure MongoDB indexes exist for optimal query performance
 * POST /api/admin/ensure-indexes
 */
export async function POST() {
  try {
    const db = await getDb();
    const results: Record<string, string> = {};

    // Analytics events - deduplication query
    // Query: { event, book_id, ip, timestamp: { $gte } }
    try {
      await db.collection('analytics_events').createIndex(
        { event: 1, book_id: 1, ip: 1, timestamp: 1 },
        { name: 'analytics_dedupe_idx', background: true }
      );
      results['analytics_events.analytics_dedupe_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['analytics_events.analytics_dedupe_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Highlights - lookup by book and page
    // Query: { book_id, page_id }
    try {
      await db.collection('highlights').createIndex(
        { book_id: 1, page_id: 1 },
        { name: 'highlights_book_page_idx', background: true }
      );
      results['highlights.highlights_book_page_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['highlights.highlights_book_page_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Jobs - pipeline status lookup
    // Query: { book_id, type, status }
    try {
      await db.collection('jobs').createIndex(
        { book_id: 1, type: 1, status: 1 },
        { name: 'jobs_book_type_status_idx', background: true }
      );
      results['jobs.jobs_book_type_status_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['jobs.jobs_book_type_status_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - lookup by book_id (commonly used)
    try {
      await db.collection('pages').createIndex(
        { book_id: 1, page_number: 1 },
        { name: 'pages_book_pagenum_idx', background: true }
      );
      results['pages.pages_book_pagenum_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_book_pagenum_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - lookup by id
    try {
      await db.collection('pages').createIndex(
        { id: 1 },
        { name: 'pages_id_idx', background: true, unique: true }
      );
      results['pages.pages_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - lookup by id
    try {
      await db.collection('books').createIndex(
        { id: 1 },
        { name: 'books_id_idx', background: true, unique: true }
      );
      results['books.books_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - category filtering
    try {
      await db.collection('books').createIndex(
        { categories: 1 },
        { name: 'books_categories_idx', background: true }
      );
      results['books.books_categories_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_categories_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Deleted books - lookup for restore
    try {
      await db.collection('deleted_books').createIndex(
        { id: 1 },
        { name: 'deleted_books_id_idx', background: true }
      );
      results['deleted_books.deleted_books_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['deleted_books.deleted_books_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    return NextResponse.json({
      success: true,
      indexes: results
    });
  } catch (error) {
    console.error('Error ensuring indexes:', error);
    return NextResponse.json(
      { error: 'Failed to ensure indexes' },
      { status: 500 }
    );
  }
}

/**
 * List existing indexes
 * GET /api/admin/ensure-indexes
 */
export async function GET() {
  try {
    const db = await getDb();
    const collections = ['books', 'pages', 'highlights', 'jobs', 'analytics_events', 'deleted_books'];
    const indexes: Record<string, unknown[]> = {};

    for (const col of collections) {
      try {
        indexes[col] = await db.collection(col).indexes();
      } catch {
        indexes[col] = [];
      }
    }

    return NextResponse.json({ indexes });
  } catch (error) {
    console.error('Error listing indexes:', error);
    return NextResponse.json(
      { error: 'Failed to list indexes' },
      { status: 500 }
    );
  }
}
