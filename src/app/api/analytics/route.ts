import { NextRequest, NextResponse } from 'next/server';
import {
  getStats,
  getTopBooks,
  getTopDownloads,
  getRecentEvents,
  getEventsByDay,
  getContentStats,
  getVisitorsByDay,
  getTopEditors,
  AnalyticsEventType,
} from '@/lib/analytics';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const view = searchParams.get('view') || 'overview';
    const days = parseInt(searchParams.get('days') || '30', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const bookId = searchParams.get('book_id') || undefined;
    const eventType = searchParams.get('event_type') as AnalyticsEventType | undefined;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    switch (view) {
      case 'overview': {
        // Get comprehensive stats including content and visitor data
        const [
          stats,
          contentStats,
          topBooks,
          topDownloads,
          topEditors,
          dailyViews,
          dailyDownloads,
          dailyVisitors,
        ] = await Promise.all([
          getStats({ start_date: startDate, end_date: endDate, book_id: bookId }),
          getContentStats(),
          getTopBooks({ limit: 5, start_date: startDate, end_date: endDate }),
          getTopDownloads({ limit: 5, start_date: startDate, end_date: endDate }),
          getTopEditors({ limit: 5, start_date: startDate, end_date: endDate }),
          getEventsByDay({ event_type: 'page_view', days }),
          getEventsByDay({ event_type: 'download', days }),
          getVisitorsByDay({ days }),
        ]);

        return NextResponse.json({
          stats,
          contentStats,
          topBooks,
          topDownloads,
          topEditors,
          charts: {
            dailyViews,
            dailyDownloads,
            dailyVisitors,
          },
        });
      }

      case 'content': {
        // Get content statistics (books, pages, translations)
        const contentStats = await getContentStats();
        return NextResponse.json({ contentStats });
      }

      case 'visitors': {
        // Get visitor statistics
        const [stats, dailyVisitors] = await Promise.all([
          getStats({ start_date: startDate, end_date: endDate }),
          getVisitorsByDay({ days }),
        ]);

        return NextResponse.json({
          unique_visitors: stats.unique_visitors,
          unique_sessions: stats.unique_sessions,
          total_hits: stats.total_hits,
          charts: { dailyVisitors },
        });
      }

      case 'editors': {
        // Get editor statistics
        const [stats, topEditors] = await Promise.all([
          getStats({ start_date: startDate, end_date: endDate }),
          getTopEditors({ limit, start_date: startDate, end_date: endDate }),
        ]);

        return NextResponse.json({
          unique_editors: stats.unique_editors,
          total_edits: stats.total_edits,
          edits_by_type: stats.edits_by_type,
          topEditors,
        });
      }

      case 'processing': {
        // Get processing statistics
        const stats = await getStats({ start_date: startDate, end_date: endDate, book_id: bookId });

        return NextResponse.json({
          total_processing: stats.total_processing,
          pages_ocr_processed: stats.pages_ocr_processed,
          pages_translated: stats.pages_translated,
          pages_summarized: stats.pages_summarized,
          processing_by_type: stats.processing_by_type,
          avg_processing_time_ms: stats.avg_processing_time_ms,
          processing_success_rate: stats.processing_success_rate,
        });
      }

      case 'top-books': {
        const topBooks = await getTopBooks({
          limit,
          start_date: startDate,
          end_date: endDate,
        });
        return NextResponse.json({ topBooks });
      }

      case 'top-downloads': {
        const topDownloads = await getTopDownloads({
          limit,
          start_date: startDate,
          end_date: endDate,
        });
        return NextResponse.json({ topDownloads });
      }

      case 'top-editors': {
        const topEditors = await getTopEditors({
          limit,
          start_date: startDate,
          end_date: endDate,
        });
        return NextResponse.json({ topEditors });
      }

      case 'recent': {
        const eventTypes = eventType ? [eventType] : undefined;
        const recentEvents = await getRecentEvents({
          limit,
          event_types: eventTypes,
        });
        return NextResponse.json({ recentEvents });
      }

      case 'daily': {
        const dailyEvents = await getEventsByDay({
          event_type: eventType,
          days,
        });
        return NextResponse.json({ dailyEvents });
      }

      case 'book': {
        if (!bookId) {
          return NextResponse.json(
            { error: 'book_id parameter required for book view' },
            { status: 400 }
          );
        }

        const [stats, dailyViews] = await Promise.all([
          getStats({ start_date: startDate, end_date: endDate, book_id: bookId }),
          getEventsByDay({ event_type: 'page_view', days }),
        ]);

        return NextResponse.json({
          bookId,
          stats,
          charts: { dailyViews },
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid view. Use: overview, content, visitors, editors, processing, top-books, top-downloads, top-editors, recent, daily, book' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
