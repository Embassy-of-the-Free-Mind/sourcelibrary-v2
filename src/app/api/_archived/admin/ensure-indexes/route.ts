import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * Ensure MongoDB indexes exist for optimal query performance
 * POST /api/admin/ensure-indexes
 */
export const POST = withAuth(async (request, session) => {
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

    // Books - slug lookup (SEO-friendly URLs)
    try {
      await db.collection('books').createIndex(
        { slug: 1 },
        { name: 'books_slug_idx', background: true, unique: true, sparse: true }
      );
      results['books.books_slug_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_slug_idx'] = err.message.includes('already exists')
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

    // Books - collection membership (collection browse pages)
    // Query: { collections: slug, status: { $ne: 'deleted' } }
    try {
      await db.collection('books').createIndex(
        { collections: 1 },
        { name: 'books_collections_idx', background: true }
      );
      results['books.books_collections_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_collections_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Collections - slug lookup
    try {
      await db.collection('collections').createIndex(
        { slug: 1 },
        { name: 'collections_slug_idx', background: true, unique: true }
      );
      results['collections.collections_slug_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['collections.collections_slug_idx'] = err.message.includes('already exists')
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

    // Books - quality score sort (homepage, library default sort)
    try {
      await db.collection('books').createIndex(
        { quality_score: -1 },
        { name: 'books_quality_score_idx', background: true, sparse: true }
      );
      results['books.books_quality_score_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_quality_score_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - recently translated sort (homepage, library default sort)
    // Query: { hidden: { $ne: true }, pages_translated: { $gt: 0 }, last_translation_at: { $exists: true } }
    try {
      await db.collection('books').createIndex(
        { last_translation_at: -1 },
        { name: 'books_last_translation_idx', background: true, sparse: true }
      );
      results['books.books_last_translation_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_last_translation_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - translated book count (homepage stat)
    // Query: { hidden: { $ne: true }, pages_translated: { $gt: 0 } }
    try {
      await db.collection('books').createIndex(
        { pages_translated: 1, hidden: 1 },
        { name: 'books_translated_hidden_idx', background: true }
      );
      results['books.books_translated_hidden_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_translated_hidden_idx'] = err.message.includes('already exists')
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

    // Books - author lookup (book detail page: "other books by this author" count)
    // Query: { author: book.author, id: { $ne: book.id } }
    try {
      await db.collection('books').createIndex(
        { author: 1 },
        { name: 'books_author_idx', background: true }
      );
      results['books.books_author_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_author_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - work_id lookup (WEMI work-level grouping: "other editions of this work")
    // Query: { work_id: workId, id: { $ne: book.id } }
    try {
      await db.collection('books').createIndex(
        { work_id: 1 },
        { name: 'books_work_id_idx', background: true, sparse: true }
      );
      results['books.books_work_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_work_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - compound index for filtered search (language + category + hidden)
    // Query: { $text: ..., hidden: { $ne: true }, language: ..., categories: ... }
    try {
      await db.collection('books').createIndex(
        { hidden: 1, language: 1, categories: 1 },
        { name: 'books_hidden_lang_cat_idx', background: true }
      );
      results['books.books_hidden_lang_cat_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_hidden_lang_cat_idx'] = err.message.includes('already exists')
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

    // Gemini usage - time-range scans (analytics usage route, cost-by-day)
    // Query: { timestamp: { $gte } } with group by type/action/day
    // CRITICAL: Without this, 1.4M doc collection scan causes 504 timeouts
    try {
      await db.collection('gemini_usage').createIndex(
        { timestamp: -1 },
        { name: 'gemini_usage_ts_idx', background: true }
      );
      results['gemini_usage.gemini_usage_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gemini_usage.gemini_usage_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gemini usage - failed calls in time range (pipeline error aggregation)
    // Query: { status: 'failed', timestamp: { $gte } }
    try {
      await db.collection('gemini_usage').createIndex(
        { status: 1, timestamp: -1 },
        { name: 'gemini_usage_status_ts_idx', background: true }
      );
      results['gemini_usage.gemini_usage_status_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gemini_usage.gemini_usage_status_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // gemini_usage_daily - pre-aggregated daily usage summaries
    // Query: { date: { $gte: "2026-01-01" } }
    try {
      await db.collection('gemini_usage_daily').createIndex(
        { date: -1 },
        { name: 'gemini_usage_daily_date_idx', unique: true, background: true }
      );
      results['gemini_usage_daily.gemini_usage_daily_date_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gemini_usage_daily.gemini_usage_daily_date_idx'] = err.message.includes('already exists')
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

    // Pages - stale translation detection (pipeline cron aggregation)
    // Query: pages.aggregate({ book_id $in, ocr.model, translation.model })
    try {
      await db.collection('pages').createIndex(
        { book_id: 1, 'ocr.model': 1, 'translation.model': 1 },
        { name: 'pages_stale_translation_idx', background: true }
      );
      results['pages.pages_stale_translation_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_stale_translation_idx'] = err.message.includes('already exists')
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

    // Analytics pageviews - IP + timestamp for unique visitor aggregations
    // Query: { timestamp: { $gte }, ip } grouped by day+ip
    try {
      await db.collection('analytics_pageviews').createIndex(
        { ip: 1, timestamp: -1 },
        { name: 'pageviews_ip_ts_idx', background: true }
      );
      results['analytics_pageviews.pageviews_ip_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['analytics_pageviews.pageviews_ip_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Analytics events - timestamp for search query analytics
    // Query: { event: 'search_query', timestamp: { $gte } }
    try {
      await db.collection('analytics_events').createIndex(
        { event: 1, timestamp: -1 },
        { name: 'analytics_events_event_ts_idx', background: true }
      );
      results['analytics_events.analytics_events_event_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['analytics_events.analytics_events_event_ts_idx'] = err.message.includes('already exists')
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

    // Gallery embeddings - unique ID lookup
    try {
      await db.collection('gallery_embeddings').createIndex(
        { id: 1 },
        { name: 'gallery_embeddings_id_idx', background: true, unique: true }
      );
      results['gallery_embeddings.gallery_embeddings_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_embeddings.gallery_embeddings_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery embeddings - lookup by book
    try {
      await db.collection('gallery_embeddings').createIndex(
        { book_id: 1 },
        { name: 'gallery_embeddings_book_idx', background: true }
      );
      results['gallery_embeddings.gallery_embeddings_book_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_embeddings.gallery_embeddings_book_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery collections - slug lookup
    try {
      await db.collection('gallery_collections').createIndex(
        { slug: 1 },
        { name: 'gallery_collections_slug_idx', background: true, unique: true }
      );
      results['gallery_collections.gallery_collections_slug_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_collections.gallery_collections_slug_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery collections - featured listing
    try {
      await db.collection('gallery_collections').createIndex(
        { featured: 1, sort_order: 1 },
        { name: 'gallery_collections_featured_idx', background: true }
      );
      results['gallery_collections.gallery_collections_featured_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_collections.gallery_collections_featured_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - unique ID
    try {
      await db.collection('gallery_images').createIndex(
        { id: 1 },
        { name: 'gallery_images_id_idx', background: true, unique: true }
      );
      results['gallery_images.gallery_images_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - default sort by quality
    try {
      await db.collection('gallery_images').createIndex(
        { gallery_quality: -1 },
        { name: 'gallery_images_quality_idx', background: true }
      );
      results['gallery_images.gallery_images_quality_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_quality_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - book filter + quality sort
    try {
      await db.collection('gallery_images').createIndex(
        { book_id: 1, gallery_quality: -1 },
        { name: 'gallery_images_book_quality_idx', background: true }
      );
      results['gallery_images.gallery_images_book_quality_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_book_quality_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - type filter
    try {
      await db.collection('gallery_images').createIndex(
        { type: 1 },
        { name: 'gallery_images_type_idx', background: true }
      );
      results['gallery_images.gallery_images_type_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_type_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - subject filter
    try {
      await db.collection('gallery_images').createIndex(
        { 'metadata.subjects': 1 },
        { name: 'gallery_images_subjects_idx', background: true }
      );
      results['gallery_images.gallery_images_subjects_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_subjects_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - year filter
    try {
      await db.collection('gallery_images').createIndex(
        { book_year: 1 },
        { name: 'gallery_images_year_idx', background: true }
      );
      results['gallery_images.gallery_images_year_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_year_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - book_rank for diversity filter
    try {
      await db.collection('gallery_images').createIndex(
        { book_rank: 1 },
        { name: 'gallery_images_rank_idx', background: true }
      );
      results['gallery_images.gallery_images_rank_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_rank_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Gallery images - page_id lookup (for worker upserts)
    try {
      await db.collection('gallery_images').createIndex(
        { page_id: 1 },
        { name: 'gallery_images_page_idx', background: true }
      );
      results['gallery_images.gallery_images_page_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['gallery_images.gallery_images_page_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Bookshelves - visitor + book unique
    try {
      await db.collection('bookshelves').createIndex(
        { visitor_id: 1, book_id: 1 },
        { name: 'bookshelves_visitor_book_idx', background: true, unique: true }
      );
      results['bookshelves.bookshelves_visitor_book_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['bookshelves.bookshelves_visitor_book_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Bookshelves - visitor shelf listing
    try {
      await db.collection('bookshelves').createIndex(
        { visitor_id: 1, status: 1, updated_at: -1 },
        { name: 'bookshelves_visitor_status_idx', background: true }
      );
      results['bookshelves.bookshelves_visitor_status_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['bookshelves.bookshelves_visitor_status_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Page revisions - lookup by page + field, newest first
    try {
      await db.collection('page_revisions').createIndex(
        { page_id: 1, field: 1, created_at: -1 },
        { name: 'page_revisions_page_field_idx', background: true }
      );
      results['page_revisions.page_revisions_page_field_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['page_revisions.page_revisions_page_field_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Page revisions - unique ID lookup
    try {
      await db.collection('page_revisions').createIndex(
        { id: 1 },
        { name: 'page_revisions_id_idx', background: true, unique: true }
      );
      results['page_revisions.page_revisions_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['page_revisions.page_revisions_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Curator sessions - unique ID
    try {
      await db.collection('curator_sessions').createIndex(
        { id: 1 },
        { name: 'curator_sessions_id_idx', background: true, unique: true }
      );
      results['curator_sessions.curator_sessions_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['curator_sessions.curator_sessions_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Curator sessions - date sort
    try {
      await db.collection('curator_sessions').createIndex(
        { date: -1 },
        { name: 'curator_sessions_date_idx', background: true }
      );
      results['curator_sessions.curator_sessions_date_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['curator_sessions.curator_sessions_date_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Curator sessions - theme filter
    try {
      await db.collection('curator_sessions').createIndex(
        { themes: 1 },
        { name: 'curator_sessions_themes_idx', background: true }
      );
      results['curator_sessions.curator_sessions_themes_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['curator_sessions.curator_sessions_themes_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Book metadata changelog - lookup by book_id, newest first
    // Query: { book_id } sorted by timestamp desc
    try {
      await db.collection('book_metadata_changelog').createIndex(
        { book_id: 1, timestamp: -1 },
        { name: 'book_metadata_changelog_book_ts_idx', background: true }
      );
      results['book_metadata_changelog.book_metadata_changelog_book_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['book_metadata_changelog.book_metadata_changelog_book_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - pipeline_auto.status (pipeline cron does ~10 status-specific queries)
    // CRITICAL: Without this, every pipeline cron query collection-scans 4,430+ books
    // causing MongoDB timeouts on cross-region Atlas shared tier
    try {
      await db.collection('books').createIndex(
        { 'pipeline_auto.status': 1 },
        { name: 'books_pipeline_status_idx', background: true, sparse: true }
      );
      results['books.books_pipeline_status_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_pipeline_status_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Books - pipeline_auto.status + last_updated (stale detection queries)
    // Query: { 'pipeline_auto.status': X, 'pipeline_auto.last_updated': { $lt: cutoff } }
    try {
      await db.collection('books').createIndex(
        { 'pipeline_auto.status': 1, 'pipeline_auto.last_updated': 1 },
        { name: 'books_pipeline_status_updated_idx', background: true, sparse: true }
      );
      results['books.books_pipeline_status_updated_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['books.books_pipeline_status_updated_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pipeline snapshots - time-range scans for velocity charts
    try {
      await db.collection('pipeline_snapshots').createIndex(
        { timestamp: -1 },
        { name: 'pipeline_snapshots_ts_idx', background: true }
      );
      results['pipeline_snapshots.pipeline_snapshots_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pipeline_snapshots.pipeline_snapshots_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Loading metrics - time-range scans for performance dashboard
    try {
      await db.collection('loading_metrics').createIndex(
        { received_at: -1 },
        { name: 'loading_metrics_received_at_idx', background: true }
      );
      results['loading_metrics.loading_metrics_received_at_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['loading_metrics.loading_metrics_received_at_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Loading metrics - metric name + time for filtered queries
    try {
      await db.collection('loading_metrics').createIndex(
        { name: 1, received_at: -1 },
        { name: 'loading_metrics_name_ts_idx', background: true }
      );
      results['loading_metrics.loading_metrics_name_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['loading_metrics.loading_metrics_name_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - transliteration queries (batch-transliterate script)
    // Query: { book_id: { $in: [...] }, 'ocr.data': { $exists: true }, 'transliteration.data': { $exists: false } }
    try {
      await db.collection('pages').createIndex(
        { book_id: 1, 'transliteration.data': 1 },
        { name: 'pages_book_transliteration_idx', background: true, sparse: true }
      );
      results['pages.pages_book_transliteration_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_book_transliteration_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Cron runs - per-cron history (cron name + time desc)
    try {
      await db.collection('cron_runs').createIndex(
        { cron: 1, timestamp: -1 },
        { name: 'cron_runs_cron_ts_idx', background: true }
      );
      results['cron_runs.cron_runs_cron_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['cron_runs.cron_runs_cron_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Cron runs - time-range scans (existing query pattern in analytics/pipeline)
    try {
      await db.collection('cron_runs').createIndex(
        { timestamp: -1 },
        { name: 'cron_runs_ts_idx', background: true }
      );
      results['cron_runs.cron_runs_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['cron_runs.cron_runs_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Cron runs - failed run queries
    try {
      await db.collection('cron_runs').createIndex(
        { status: 1, timestamp: -1 },
        { name: 'cron_runs_status_ts_idx', background: true }
      );
      results['cron_runs.cron_runs_status_ts_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['cron_runs.cron_runs_status_ts_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // KDP publications - unique book lookup
    try {
      await db.collection('kdp_publications').createIndex(
        { book_id: 1 },
        { name: 'kdp_publications_book_id_idx', background: true, unique: true }
      );
      results['kdp_publications.kdp_publications_book_id_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['kdp_publications.kdp_publications_book_id_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // KDP publications - status + score sort (dashboard queries)
    try {
      await db.collection('kdp_publications').createIndex(
        { status: 1, kdp_score_snapshot: -1 },
        { name: 'kdp_publications_status_score_idx', background: true }
      );
      results['kdp_publications.kdp_publications_status_score_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['kdp_publications.kdp_publications_status_score_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - translation.updated_at for recent translation queries
    // Query: { 'translation.updated_at': { $gte } } — 916k pages, needs index
    try {
      await db.collection('pages').createIndex(
        { 'translation.updated_at': -1 },
        { name: 'pages_translation_updated_idx', background: true, sparse: true }
      );
      results['pages.pages_translation_updated_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_translation_updated_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Pages - ocr.updated_at for recent OCR throughput queries
    // Query: { 'ocr.updated_at': { $gte } } — 1.84M pages, needs index
    try {
      await db.collection('pages').createIndex(
        { 'ocr.updated_at': -1 },
        { name: 'pages_ocr_updated_idx', background: true, sparse: true }
      );
      results['pages.pages_ocr_updated_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['pages.pages_ocr_updated_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Reading history - list by user
    // Query: { user_id, updated_at: -1 }
    try {
      await db.collection('reading_history').createIndex(
        { user_id: 1, updated_at: -1 },
        { name: 'rh_user_updated_idx', background: true }
      );
      results['reading_history.rh_user_updated_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['reading_history.rh_user_updated_idx'] = err.message.includes('already exists')
        ? 'exists'
        : `error: ${err.message}`;
    }

    // Reading history - session collapse lookup
    // Query: { user_id, book_id, updated_at: { $gte } }
    try {
      await db.collection('reading_history').createIndex(
        { user_id: 1, book_id: 1, updated_at: -1 },
        { name: 'rh_user_book_updated_idx', background: true }
      );
      results['reading_history.rh_user_book_updated_idx'] = 'created';
    } catch (e) {
      const err = e as Error;
      results['reading_history.rh_user_book_updated_idx'] = err.message.includes('already exists')
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
});

/**
 * List existing indexes
 * GET /api/admin/ensure-indexes
 */
export const GET = withAuth(async (request, session) => {
  try {
    const db = await getDb();
    const collections = ['books', 'pages', 'highlights', 'jobs', 'batch_jobs', 'analytics_events', 'analytics_pageviews', 'deleted_books', 'gemini_usage', 'gemini_usage_daily', 'audit_log', 'likes', 'annotations', 'gallery_embeddings', 'gallery_collections', 'gallery_images', 'bookshelves', 'page_revisions', 'curator_sessions', 'collections', 'cron_runs', 'pipeline_snapshots', 'loading_metrics', 'book_metadata_changelog', 'kdp_publications', 'reading_history'];
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
});
