import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

interface OCRComparison {
  a: string;
  b: string;
  question: string;
}

// GET /api/experiments/ocr-quality/[id]/judge - Get next comparison to judge
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get experiment
    const experiment = await db.collection('ocr_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get all existing judgments for this experiment
    const existingJudgments = await db
      .collection('ocr_judgments')
      .find({ experiment_id: id })
      .toArray();

    // Create a set of already judged comparisons
    const judgedSet = new Set(
      existingJudgments.map(j => `${j.page_id}_${j.comparison_type}`)
    );

    // Get all results for this experiment
    const results = await db
      .collection('ocr_experiment_results')
      .find({ experiment_id: id })
      .toArray();

    // Group results by page_id and condition_id
    const resultsByPage: Record<string, Record<string, string>> = {};
    results.forEach(r => {
      if (!resultsByPage[r.page_id]) {
        resultsByPage[r.page_id] = {};
      }
      resultsByPage[r.page_id][r.condition_id] = r.ocr;
    });

    // Get pages for image URLs
    const pages = await db
      .collection('pages')
      .find({ id: { $in: experiment.page_ids } })
      .toArray();

    const pageMap = new Map(pages.map(p => [p.id, p]));

    // Find an unjudged comparison
    const comparisons: OCRComparison[] = experiment.comparisons;
    let nextComparison = null;

    for (const pageId of experiment.page_ids) {
      for (const comp of comparisons) {
        const key = `${pageId}_${comp.question}`;
        if (!judgedSet.has(key)) {
          // Found an unjudged comparison
          const page = pageMap.get(pageId);
          const pageResults = resultsByPage[pageId];

          if (page && pageResults && pageResults[comp.a] && pageResults[comp.b]) {
            // Randomize which is shown on left vs right
            const leftIsA = Math.random() < 0.5;

            nextComparison = {
              page_id: pageId,
              page_number: page.page_number,
              image_url: page.photo || page.thumbnail,
              condition_a: comp.a,
              condition_b: comp.b,
              ocr_a: pageResults[comp.a],
              ocr_b: pageResults[comp.b],
              comparison_type: comp.question,
              left_is_a: leftIsA,
            };
            break;
          }
        }
      }
      if (nextComparison) break;
    }

    // Calculate stats
    const totalJudgments = experiment.page_ids.length * comparisons.length;
    const completedJudgments = existingJudgments.length;

    return NextResponse.json({
      comparison: nextComparison,
      stats: {
        total: totalJudgments,
        completed: completedJudgments,
        remaining: totalJudgments - completedJudgments,
      },
    });
  } catch (error) {
    console.error('Error getting comparison:', error);
    return NextResponse.json({ error: 'Failed to get comparison' }, { status: 500 });
  }
}

// POST /api/experiments/ocr-quality/[id]/judge - Submit a judgment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const {
      page_id,
      condition_a,
      condition_b,
      comparison_type,
      winner,
    }: {
      page_id: string;
      condition_a: string;
      condition_b: string;
      comparison_type: string;
      winner: 'a' | 'b' | 'tie';
    } = await request.json();

    if (!page_id || !condition_a || !condition_b || !comparison_type || !winner) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = await getDb();

    // Check for duplicate
    const existing = await db.collection('ocr_judgments').findOne({
      experiment_id: id,
      page_id,
      comparison_type,
    });

    if (existing) {
      return NextResponse.json({ error: 'Already judged' }, { status: 400 });
    }

    // Save judgment
    const judgment = {
      id: crypto.randomUUID(),
      experiment_id: id,
      page_id,
      condition_a,
      condition_b,
      comparison_type,
      winner,
      created_at: new Date().toISOString(),
    };

    await db.collection('ocr_judgments').insertOne(judgment);

    // Update experiment progress
    const totalJudgments = await db.collection('ocr_judgments').countDocuments({ experiment_id: id });
    const experiment = await db.collection('ocr_experiments').findOne({ id });

    if (experiment && totalJudgments >= experiment.total_judgments) {
      await db.collection('ocr_experiments').updateOne(
        { id },
        { $set: { status: 'completed', completed_at: new Date().toISOString() } }
      );
    } else {
      await db.collection('ocr_experiments').updateOne(
        { id },
        { $set: { judgments_complete: totalJudgments, status: 'judging' } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving judgment:', error);
    return NextResponse.json({ error: 'Failed to save judgment' }, { status: 500 });
  }
}
