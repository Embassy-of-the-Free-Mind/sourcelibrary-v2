import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// GET /api/experiments/ocr-quality/[id] - Get experiment status and progress
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const db = await getDb();
    const experiment = await db.collection('ocr_experiments').findOne({ id });

    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get result counts per condition
    const resultCounts = await db.collection('ocr_experiment_results').aggregate([
      { $match: { experiment_id: id } },
      {
        $group: {
          _id: '$condition_id',
          count: { $sum: 1 },
          successCount: { $sum: { $cond: ['$success', 1, 0] } },
        },
      },
    ]).toArray();

    const resultsByCondition: Record<string, { count: number; successCount: number }> = {};
    resultCounts.forEach(r => {
      resultsByCondition[r._id] = { count: r.count, successCount: r.successCount };
    });

    const response: Record<string, unknown> = {
      id: experiment.id,
      status: experiment.status,
      book_id: experiment.book_id,
      page_count: experiment.page_count,
      page_ids: experiment.page_ids || [],
      conditions: experiment.conditions || [],
      conditions_run: experiment.conditions_run || [],
      progress: experiment.progress || {},
      judging_progress: experiment.judging_progress || null,
      random_judging_progress: experiment.random_judging_progress || null,
      judgments_complete: experiment.judgments_complete || 0,
      total_judgments: experiment.total_judgments || 0,
      results_by_condition: resultsByCondition,
      total_cost: experiment.total_cost || 0,
      total_tokens: experiment.total_tokens || 0,
      judging_cost: experiment.judging_cost || 0,
      random_judging_cost: experiment.random_judging_cost || 0,
      created_at: experiment.created_at,
      updated_at: experiment.updated_at,
    };

    // Include review data (OCR results + page images) when requested
    const includeParam = request.nextUrl.searchParams.get('include');
    if (includeParam === 'review') {
      const [ocrResults, pages] = await Promise.all([
        db.collection('ocr_experiment_results')
          .find({ experiment_id: id })
          .sort({ page_number: 1 })
          .toArray(),
        db.collection('pages')
          .find(
            { id: { $in: experiment.page_ids || [] } },
            { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, book_id: 1 } }
          )
          .toArray(),
      ]);

      const pageMap = new Map(pages.map(p => [p.id, p]));

      response.review_results = ocrResults.map(r => {
        const page = pageMap.get(r.page_id);
        return {
          page_id: r.page_id,
          page_number: r.page_number,
          condition_id: r.condition_id,
          ocr: r.ocr,
          success: r.success,
          image_url: page?.archived_photo || page?.photo || '',
          book_id: page?.book_id || '',
        };
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching experiment:', error);
    return NextResponse.json({ error: 'Failed to fetch experiment' }, { status: 500 });
  }
}
