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

    // Gemini usage - lookup by book_id for history/cost queries
    // Query: { book_id }
    try {
      await db.collection('gemini_usage').createIndex(
        { book_id: 1, timestamp: 1 },
        { name: 'gemini_usage_book_ts_idx', background: true }
      );
      results['gemini_usage.gemini_usage_book_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gemini_usage.gemini_usage_book_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Audit log - lookup by book_id
    try {
      await db.collection('audit_log').createIndex(
        { book_id: 1 },
        { name: 'audit_log_book_idx', background: true }
      );
      results['audit_log.audit_log_book_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['audit_log.audit_log_book_idx'] = err.message.includes('already exists')
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

    // Batch jobs - cron reconciliation queries pending/processing jobs
    // Query: { status: { $in: ['pending', 'processing'] } } sorted by created_at
    try {
      await db.collection('batch_jobs').createIndex(
        { status: 1, created_at: 1 },
        { name: 'batch_jobs_status_created_idx', background: true }
      );
      results['batch_jobs.batch_jobs_status_created_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['batch_jobs.batch_jobs_status_created_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Batch jobs - lookup by book
    // Query: { book_id, status }
    try {
      await db.collection('batch_jobs').createIndex(
        { book_id: 1, status: 1 },
        { name: 'batch_jobs_book_status_idx', background: true }
      );
      results['batch_jobs.batch_jobs_book_status_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['batch_jobs.batch_jobs_book_status_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - year filtering (gallery year range queries)
    try {
      await db.collection('books').createIndex(
        { year: 1 },
        { name: 'books_year_idx', background: true }
      );
      results['books.books_year_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_year_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - language filtering (library route)
    try {
      await db.collection('books').createIndex(
        { language: 1 },
        { name: 'books_language_idx', background: true }
      );
      results['books.books_language_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_language_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - index.generatedAt existence (unified search fetches all indexed books)
    try {
      await db.collection('books').createIndex(
        { 'index.generatedAt': 1 },
        { name: 'books_index_generated_idx', background: true, sparse: true }
      );
      results['books.books_index_generated_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_index_generated_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - detected_images existence (gallery initial $match)
    try {
      await db.collection('pages').createIndex(
        { 'detected_images.0': 1, book_id: 1 },
        { name: 'pages_detected_images_book_idx', background: true, sparse: true }
      );
      results['pages.pages_detected_images_book_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_detected_images_book_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - gallery quality sort (gallery aggregation sorts by gallery_quality desc)
    try {
      await db.collection('pages').createIndex(
        { 'detected_images.gallery_quality': -1, book_id: 1, page_number: 1 },
        { name: 'pages_gallery_quality_idx', background: true, sparse: true }
      );
      results['pages.pages_gallery_quality_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_gallery_quality_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - full-text search on title, author, summary
    // Used by /api/search and /api/search/unified
    // Only ONE text index allowed per collection
    try {
      await db.collection('books').createIndex(
        {
          title: 'text',
          display_title: 'text',
          author: 'text',
          'reading_summary.overview': 'text',
        },
        {
          name: 'books_text_idx',
          background: true,
          default_language: 'none',
          language_override: '_text_lang',
          weights: { title: 10, display_title: 10, author: 5, 'reading_summary.overview': 1 },
        }
      );
      results['books.books_text_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_text_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - full-text search on OCR and translation text
    // Used by /api/books/[id]/search ($text with book_id filter)
    // NOTE: This index will be large (~hundreds of MB) due to OCR/translation text
    try {
      await db.collection('pages').createIndex(
        {
          'translation.data': 'text',
          'ocr.data': 'text',
        },
        {
          name: 'pages_text_idx',
          background: true,
          default_language: 'none',
          language_override: '_text_lang',
          weights: { 'translation.data': 2, 'ocr.data': 1 },
        }
      );
      results['pages.pages_text_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_text_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - thumbnail lookup (find pages needing thumbnails, filter by thumbnail status)
    try {
      await db.collection('pages').createIndex(
        { thumbnail_blob: 1, archived_photo: 1 },
        { name: 'pages_thumbnail_archived_idx', background: true }
      );
      results['pages.pages_thumbnail_archived_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_thumbnail_archived_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Likes - toggle lookup (visitor + target)
    // Query: { target_type, target_id, visitor_id }
    try {
      await db.collection('likes').createIndex(
        { target_type: 1, target_id: 1, visitor_id: 1 },
        { name: 'likes_target_visitor_idx', unique: true, background: true }
      );
      results['likes.likes_target_visitor_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['likes.likes_target_visitor_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Likes - count aggregation
    // Query: { target_type, target_id }
    try {
      await db.collection('likes').createIndex(
        { target_type: 1, target_id: 1 },
        { name: 'likes_target_idx', background: true }
      );
      results['likes.likes_target_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['likes.likes_target_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Likes - visitor's likes lookup
    // Query: { visitor_id, target_type }
    try {
      await db.collection('likes').createIndex(
        { visitor_id: 1, target_type: 1 },
        { name: 'likes_visitor_type_idx', background: true }
      );
      results['likes.likes_visitor_type_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['likes.likes_visitor_type_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gemini usage - processing overview aggregation (type + status prefix)
    // Query: { status: { $in: ['success', 'failed'] }, type?: stepFilter }
    try {
      await db.collection('gemini_usage').createIndex(
        { type: 1, status: 1, book_id: 1 },
        { name: 'gemini_usage_type_status_book_idx', background: true }
      );
      results['gemini_usage.gemini_usage_type_status_book_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gemini_usage.gemini_usage_type_status_book_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Batch jobs - filter out child jobs in processing overview
    // Query: { parent_job_id: { $exists: false } }
    try {
      await db.collection('batch_jobs').createIndex(
        { parent_job_id: 1, created_at: -1 },
        { name: 'batch_jobs_parent_created_idx', background: true, sparse: true }
      );
      results['batch_jobs.batch_jobs_parent_created_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['batch_jobs.batch_jobs_parent_created_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - split detection aggregation (processing overview)
    try {
      await db.collection('pages').createIndex(
        { 'split_detection': 1, book_id: 1 },
        { name: 'pages_split_detection_idx', background: true, sparse: true }
      );
      results['pages.pages_split_detection_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_split_detection_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Analytics pageviews - timestamp for date range queries
    // Query: { timestamp: { $gte } } used by all traffic aggregations
    try {
      await db.collection('analytics_pageviews').createIndex(
        { timestamp: -1 },
        { name: 'pageviews_timestamp_idx', background: true }
      );
      results['analytics_pageviews.pageviews_timestamp_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['analytics_pageviews.pageviews_timestamp_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Analytics pageviews - path + timestamp for top pages
    try {
      await db.collection('analytics_pageviews').createIndex(
        { path: 1, timestamp: -1 },
        { name: 'pageviews_path_ts_idx', background: true }
      );
      results['analytics_pageviews.pageviews_path_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['analytics_pageviews.pageviews_path_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Annotations - lookup by book and page
    // Query: { book_id, page_id }
    try {
      await db.collection('annotations').createIndex(
        { book_id: 1, page_id: 1 },
        { name: 'annotations_book_page_idx', background: true }
      );
      results['annotations.annotations_book_page_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['annotations.annotations_book_page_idx'] = err.message.includes('already exists')
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
    const collections = ['books', 'pages', 'highlights', 'jobs', 'batch_jobs', 'analytics_events', 'deleted_books', 'gemini_usage', 'audit_log'];
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
