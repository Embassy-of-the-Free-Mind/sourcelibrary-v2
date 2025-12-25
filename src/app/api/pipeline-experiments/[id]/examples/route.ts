import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// GET /api/pipeline-experiments/[id]/examples - Get example comparisons
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const count = parseInt(searchParams.get('count') || '3');

    const db = await getDb();

    const experiment = await db.collection('pipeline_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get results
    const results = await db.collection('pipeline_experiment_results')
      .find({ experiment_id: id })
      .toArray();

    // Group by page_id
    const byPage: Record<string, Record<string, typeof results[0]>> = {};
    results.forEach(r => {
      if (!byPage[r.page_id]) byPage[r.page_id] = {};
      byPage[r.page_id][r.condition_id] = r;
    });

    // Get judgments where two_flash won
    const judgments = await db.collection('pipeline_judgments')
      .find({ experiment_id: id })
      .toArray();

    const twoPassWins = judgments.filter(j =>
      (j.winner === 'a' && j.condition_a === 'two_flash') ||
      (j.winner === 'b' && j.condition_b === 'two_flash')
    );

    // Get unique page examples
    const seen = new Set<string>();
    const examples = [];

    for (const j of twoPassWins) {
      if (examples.length >= count) break;
      if (seen.has(j.page_id)) continue;
      seen.add(j.page_id);

      const pageResults = byPage[j.page_id];
      if (!pageResults?.single_flash || !pageResults?.two_flash) continue;

      examples.push({
        page_id: j.page_id,
        page_number: pageResults.single_flash.page_number,
        single_pass: {
          translation: pageResults.single_flash.translation,
          ocr: pageResults.single_flash.ocr,
        },
        two_pass: {
          translation: pageResults.two_flash.translation,
          ocr: pageResults.two_flash.ocr,
        },
        judgment_reasoning: j.reasoning,
      });
    }

    return NextResponse.json({ examples });
  } catch (error) {
    console.error('Error fetching examples:', error);
    return NextResponse.json({ error: 'Failed to fetch examples' }, { status: 500 });
  }
}
