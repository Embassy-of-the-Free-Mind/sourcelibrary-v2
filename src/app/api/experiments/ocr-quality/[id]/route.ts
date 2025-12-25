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

    return NextResponse.json({
      id: experiment.id,
      status: experiment.status,
      book_id: experiment.book_id,
      page_count: experiment.page_count,
      conditions_run: experiment.conditions_run || [],
      progress: experiment.progress || {},
      results_by_condition: resultsByCondition,
      total_cost: experiment.total_cost || 0,
      total_tokens: experiment.total_tokens || 0,
      created_at: experiment.created_at,
      updated_at: experiment.updated_at,
    });
  } catch (error) {
    console.error('Error fetching experiment:', error);
    return NextResponse.json({ error: 'Failed to fetch experiment' }, { status: 500 });
  }
}
