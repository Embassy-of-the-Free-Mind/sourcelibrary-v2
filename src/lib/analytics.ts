import { getDb } from './mongodb';

// Event types for analytics tracking
export type AnalyticsEventType =
  // Content consumption
  | 'book_view'           // Viewing book details page
  | 'page_view'           // Viewing/reading a specific page
  | 'page_read'           // Time spent reading a page (with duration)

  // Downloads
  | 'download'            // Any download action

  // Editing
  | 'edit_ocr'            // OCR text was edited
  | 'edit_translation'    // Translation was edited
  | 'edit_summary'        // Summary was edited

  // AI Processing
  | 'process_ocr'         // OCR processing triggered
  | 'process_translation' // Translation processing triggered
  | 'process_summary'     // Summary processing triggered
  | 'process_batch'       // Batch processing of multiple pages

  // Search
  | 'search'              // Search query executed

  // Page management
  | 'page_split'          // Page was split
  | 'page_delete'         // Page was deleted
  | 'page_reorder'        // Pages were reordered
  | 'split_detect'        // Split detection ran

  // Book management
  | 'book_create'         // New book created
  | 'book_reset'          // Book reset to original state
  | 'book_upload'         // Images uploaded to book

  // Prompts
  | 'prompt_create'       // Custom prompt created
  | 'prompt_use';         // Custom prompt used

// Download format types
export type DownloadFormat =
  | 'txt_translation'
  | 'txt_ocr'
  | 'txt_both'
  | 'epub_translation'
  | 'epub_bilingual'
  | 'epub_parallel';

// Analytics event structure
export interface AnalyticsEvent {
  id?: string;

  // Event identification
  event_type: AnalyticsEventType;
  timestamp: Date;

  // Context
  tenant_id: string;
  session_id?: string;          // Browser session for grouping

  // Entity references
  book_id?: string;
  page_id?: string;

  // Event-specific metadata
  metadata?: {
    // For downloads
    format?: DownloadFormat;
    file_size?: number;

    // For edits
    field?: 'ocr' | 'translation' | 'summary';
    chars_before?: number;
    chars_after?: number;

    // For processing
    model?: string;
    duration_ms?: number;
    success?: boolean;
    error?: string;
    pages_count?: number;        // For batch processing

    // For search
    query?: string;
    results_count?: number;

    // For split detection
    is_two_page?: boolean;
    confidence?: string;

    // For uploads
    files_count?: number;
    total_size?: number;

    // For page views (reading time)
    read_duration_ms?: number;

    // Generic catch-all
    [key: string]: unknown;
  };
}

// Aggregated stats structure
export interface AnalyticsStats {
  total_events: number;

  // Reading stats
  total_book_views: number;
  total_page_views: number;
  unique_books_viewed: number;

  // Download stats
  total_downloads: number;
  downloads_by_format: Record<string, number>;

  // Edit stats
  total_edits: number;
  edits_by_type: {
    ocr: number;
    translation: number;
    summary: number;
  };

  // Processing stats
  total_processing: number;
  processing_by_type: {
    ocr: number;
    translation: number;
    summary: number;
  };
  avg_processing_time_ms: number;
  processing_success_rate: number;

  // Search stats
  total_searches: number;
  avg_results_per_search: number;

  // Time range
  period_start: Date;
  period_end: Date;
}

// Top items for leaderboards
export interface TopItem {
  id: string;
  title?: string;
  count: number;
}

const COLLECTION_NAME = 'analytics_events';

/**
 * Track an analytics event
 */
export async function trackEvent(
  eventType: AnalyticsEventType,
  options: {
    tenant_id?: string;
    session_id?: string;
    book_id?: string;
    page_id?: string;
    metadata?: AnalyticsEvent['metadata'];
  } = {}
): Promise<void> {
  try {
    const db = await getDb();
    const collection = db.collection<AnalyticsEvent>(COLLECTION_NAME);

    const event: Omit<AnalyticsEvent, 'id' | '_id'> = {
      event_type: eventType,
      timestamp: new Date(),
      tenant_id: options.tenant_id || 'default',
      session_id: options.session_id,
      book_id: options.book_id,
      page_id: options.page_id,
      metadata: options.metadata,
    };

    await collection.insertOne(event);
  } catch (error) {
    // Don't let analytics errors break the main flow
    console.error('Analytics tracking error:', error);
  }
}

/**
 * Get aggregated analytics stats
 */
export async function getStats(options: {
  tenant_id?: string;
  start_date?: Date;
  end_date?: Date;
  book_id?: string;
} = {}): Promise<AnalyticsStats> {
  const db = await getDb();
  const collection = db.collection<AnalyticsEvent>(COLLECTION_NAME);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const matchStage: Record<string, unknown> = {
    tenant_id: options.tenant_id || 'default',
    timestamp: {
      $gte: options.start_date || thirtyDaysAgo,
      $lte: options.end_date || now,
    },
  };

  if (options.book_id) {
    matchStage.book_id = options.book_id;
  }

  // Get all events in range for aggregation
  const events = await collection.find(matchStage).toArray();

  // Calculate stats
  const stats: AnalyticsStats = {
    total_events: events.length,
    total_book_views: 0,
    total_page_views: 0,
    unique_books_viewed: 0,
    total_downloads: 0,
    downloads_by_format: {},
    total_edits: 0,
    edits_by_type: { ocr: 0, translation: 0, summary: 0 },
    total_processing: 0,
    processing_by_type: { ocr: 0, translation: 0, summary: 0 },
    avg_processing_time_ms: 0,
    processing_success_rate: 0,
    total_searches: 0,
    avg_results_per_search: 0,
    period_start: options.start_date || thirtyDaysAgo,
    period_end: options.end_date || now,
  };

  const uniqueBooks = new Set<string>();
  let totalProcessingTime = 0;
  let processingCount = 0;
  let successfulProcessing = 0;
  let totalSearchResults = 0;

  for (const event of events) {
    switch (event.event_type) {
      case 'book_view':
        stats.total_book_views++;
        if (event.book_id) uniqueBooks.add(event.book_id);
        break;

      case 'page_view':
      case 'page_read':
        stats.total_page_views++;
        if (event.book_id) uniqueBooks.add(event.book_id);
        break;

      case 'download':
        stats.total_downloads++;
        const format = event.metadata?.format as string || 'unknown';
        stats.downloads_by_format[format] = (stats.downloads_by_format[format] || 0) + 1;
        break;

      case 'edit_ocr':
        stats.total_edits++;
        stats.edits_by_type.ocr++;
        break;

      case 'edit_translation':
        stats.total_edits++;
        stats.edits_by_type.translation++;
        break;

      case 'edit_summary':
        stats.total_edits++;
        stats.edits_by_type.summary++;
        break;

      case 'process_ocr':
        stats.total_processing++;
        stats.processing_by_type.ocr++;
        if (event.metadata?.duration_ms) {
          totalProcessingTime += event.metadata.duration_ms;
          processingCount++;
        }
        if (event.metadata?.success) successfulProcessing++;
        break;

      case 'process_translation':
        stats.total_processing++;
        stats.processing_by_type.translation++;
        if (event.metadata?.duration_ms) {
          totalProcessingTime += event.metadata.duration_ms;
          processingCount++;
        }
        if (event.metadata?.success) successfulProcessing++;
        break;

      case 'process_summary':
        stats.total_processing++;
        stats.processing_by_type.summary++;
        if (event.metadata?.duration_ms) {
          totalProcessingTime += event.metadata.duration_ms;
          processingCount++;
        }
        if (event.metadata?.success) successfulProcessing++;
        break;

      case 'search':
        stats.total_searches++;
        if (event.metadata?.results_count !== undefined) {
          totalSearchResults += event.metadata.results_count;
        }
        break;
    }
  }

  stats.unique_books_viewed = uniqueBooks.size;
  stats.avg_processing_time_ms = processingCount > 0 ? totalProcessingTime / processingCount : 0;
  stats.processing_success_rate = stats.total_processing > 0
    ? (successfulProcessing / stats.total_processing) * 100
    : 0;
  stats.avg_results_per_search = stats.total_searches > 0
    ? totalSearchResults / stats.total_searches
    : 0;

  return stats;
}

/**
 * Get top viewed books
 */
export async function getTopBooks(options: {
  tenant_id?: string;
  limit?: number;
  start_date?: Date;
  end_date?: Date;
} = {}): Promise<TopItem[]> {
  const db = await getDb();
  const collection = db.collection<AnalyticsEvent>(COLLECTION_NAME);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await collection.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        tenant_id: options.tenant_id || 'default',
        event_type: { $in: ['book_view', 'page_view'] },
        book_id: { $exists: true, $ne: null },
        timestamp: {
          $gte: options.start_date || thirtyDaysAgo,
          $lte: options.end_date || now,
        },
      },
    },
    {
      $group: {
        _id: '$book_id',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: options.limit || 10 },
  ]).toArray();

  // Fetch book titles
  const booksCollection = db.collection('books');
  const bookIds = result.map(r => r._id);
  const books = await booksCollection.find({ id: { $in: bookIds } }).toArray();
  const bookTitles = new Map(books.map(b => [b.id, b.display_title || b.title]));

  return result.map(r => ({
    id: r._id,
    title: bookTitles.get(r._id) as string | undefined,
    count: r.count,
  }));
}

/**
 * Get top downloaded books
 */
export async function getTopDownloads(options: {
  tenant_id?: string;
  limit?: number;
  start_date?: Date;
  end_date?: Date;
} = {}): Promise<TopItem[]> {
  const db = await getDb();
  const collection = db.collection<AnalyticsEvent>(COLLECTION_NAME);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await collection.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        tenant_id: options.tenant_id || 'default',
        event_type: 'download',
        book_id: { $exists: true, $ne: null },
        timestamp: {
          $gte: options.start_date || thirtyDaysAgo,
          $lte: options.end_date || now,
        },
      },
    },
    {
      $group: {
        _id: '$book_id',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: options.limit || 10 },
  ]).toArray();

  // Fetch book titles
  const booksCollection = db.collection('books');
  const bookIds = result.map(r => r._id);
  const books = await booksCollection.find({ id: { $in: bookIds } }).toArray();
  const bookTitles = new Map(books.map(b => [b.id, b.display_title || b.title]));

  return result.map(r => ({
    id: r._id,
    title: bookTitles.get(r._id) as string | undefined,
    count: r.count,
  }));
}

/**
 * Get recent events (activity feed)
 */
export async function getRecentEvents(options: {
  tenant_id?: string;
  limit?: number;
  event_types?: AnalyticsEventType[];
} = {}): Promise<AnalyticsEvent[]> {
  const db = await getDb();
  const collection = db.collection<AnalyticsEvent>(COLLECTION_NAME);

  const matchStage: Record<string, unknown> = {
    tenant_id: options.tenant_id || 'default',
  };

  if (options.event_types && options.event_types.length > 0) {
    matchStage.event_type = { $in: options.event_types };
  }

  const events = await collection
    .find(matchStage)
    .sort({ timestamp: -1 })
    .limit(options.limit || 50)
    .toArray();

  // MongoDB adds _id automatically, cast to include it
  return events.map(e => {
    const event = e as AnalyticsEvent & { _id?: { toString(): string } };
    return {
      ...e,
      id: event._id?.toString(),
    };
  });
}

/**
 * Get event counts by day for charting
 */
export async function getEventsByDay(options: {
  tenant_id?: string;
  event_type?: AnalyticsEventType;
  days?: number;
} = {}): Promise<{ date: string; count: number }[]> {
  const db = await getDb();
  const collection = db.collection<AnalyticsEvent>(COLLECTION_NAME);

  const days = options.days || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const matchStage: Record<string, unknown> = {
    tenant_id: options.tenant_id || 'default',
    timestamp: { $gte: startDate },
  };

  if (options.event_type) {
    matchStage.event_type = options.event_type;
  }

  const result = await collection.aggregate<{ _id: string; count: number }>([
    { $match: matchStage },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray();

  return result.map(r => ({
    date: r._id,
    count: r.count,
  }));
}
