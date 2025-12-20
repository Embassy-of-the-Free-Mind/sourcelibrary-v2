import { NextRequest, NextResponse } from 'next/server';
import {
  getStats,
  getTopBooks,
  getTopDownloads,
  getRecentEvents,
  getEventsByDay,
  AnalyticsEventType,
} from '@/lib/analytics';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const view = searchParams.get('view') || 'overview'; // overview, top-books, top-downloads, recent, daily
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
        // Get comprehensive stats
        const [stats, topBooks, topDownloads, dailyViews, dailyDownloads] = await Promise.all([
          getStats({ start_date: startDate, end_date: endDate, book_id: bookId }),
          getTopBooks({ limit: 5, start_date: startDate, end_date: endDate }),
          getTopDownloads({ limit: 5, start_date: startDate, end_date: endDate }),
          getEventsByDay({ event_type: 'page_view', days }),
          getEventsByDay({ event_type: 'download', days }),
        ]);

        return NextResponse.json({
          stats,
          topBooks,
          topDownloads,
          charts: {
            dailyViews,
            dailyDownloads,
          },
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
          { error: 'Invalid view. Use: overview, top-books, top-downloads, recent, daily, book' },
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
