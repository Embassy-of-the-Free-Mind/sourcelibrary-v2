import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/usage
 *
 * Get Gemini API usage statistics
 *
 * Query params:
 * - start: ISO date string (default: 30 days ago)
 * - end: ISO date string (default: now)
 * - book_id: Filter by book
 * - group_by: 'day' | 'type' | 'model' | 'book' (default: summary only)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('start')
      ? new Date(searchParams.get('start')!)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = searchParams.get('end')
      ? new Date(searchParams.get('end')!)
      : new Date();
    const bookId = searchParams.get('book_id');
    const groupBy = searchParams.get('group_by');

    const db = await getDb();

    // Build match query
    const match: Record<string, unknown> = {
      timestamp: { $gte: startDate, $lte: endDate },
    };
    if (bookId) {
      match.book_id = bookId;
    }

    // Get overall summary
    const summaryPipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          total_calls: { $sum: 1 },
          successful_calls: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          failed_calls: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          total_input_tokens: { $sum: '$input_tokens' },
          total_output_tokens: { $sum: '$output_tokens' },
          total_cost_usd: { $sum: '$cost_usd' },
          total_pages: { $sum: '$page_count' },
        },
      },
    ];

    const [summary] = await db.collection('gemini_usage').aggregate(summaryPipeline).toArray();

    const result: Record<string, unknown> = {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary: summary || {
        total_calls: 0,
        successful_calls: 0,
        failed_calls: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cost_usd: 0,
        total_pages: 0,
      },
    };

    // Add grouped breakdown if requested
    if (groupBy === 'day') {
      const byDay = await db.collection('gemini_usage').aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            calls: { $sum: 1 },
            cost: { $sum: '$cost_usd' },
            pages: { $sum: '$page_count' },
          },
        },
        { $sort: { _id: 1 } },
      ]).toArray();
      result.by_day = byDay.map(r => ({ date: r._id, ...r, _id: undefined }));
    }

    if (groupBy === 'type' || !groupBy) {
      const byType = await db.collection('gemini_usage').aggregate([
        { $match: match },
        {
          $group: {
            _id: '$type',
            calls: { $sum: 1 },
            cost: { $sum: '$cost_usd' },
            pages: { $sum: '$page_count' },
            input_tokens: { $sum: '$input_tokens' },
            output_tokens: { $sum: '$output_tokens' },
          },
        },
        { $sort: { cost: -1 } },
      ]).toArray();
      result.by_type = byType.map(r => ({ type: r._id, ...r, _id: undefined }));
    }

    if (groupBy === 'model' || !groupBy) {
      const byModel = await db.collection('gemini_usage').aggregate([
        { $match: match },
        {
          $group: {
            _id: '$model',
            calls: { $sum: 1 },
            cost: { $sum: '$cost_usd' },
            pages: { $sum: '$page_count' },
          },
        },
        { $sort: { cost: -1 } },
      ]).toArray();
      result.by_model = byModel.map(r => ({ model: r._id, ...r, _id: undefined }));
    }

    if (groupBy === 'book') {
      const byBook = await db.collection('gemini_usage').aggregate([
        { $match: match },
        {
          $group: {
            _id: { book_id: '$book_id', book_title: '$book_title' },
            calls: { $sum: 1 },
            cost: { $sum: '$cost_usd' },
            pages: { $sum: '$page_count' },
          },
        },
        { $sort: { cost: -1 } },
        { $limit: 50 },
      ]).toArray();
      result.by_book = byBook.map(r => ({
        book_id: r._id.book_id,
        book_title: r._id.book_title,
        ...r,
        _id: undefined,
      }));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[usage] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage stats' },
      { status: 500 }
    );
  }
}
