import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

export interface OCRCondition {
  id: string;
  batchSize: number;
  promptType: 'simple' | 'elaborate';
  label: string;
}

export interface OCRComparison {
  a: string;
  b: string;
  question: string;
}

// POST /api/experiments/ocr-quality - Create OCR quality experiment
export async function POST(request: NextRequest) {
  try {
    const {
      book_id,
      start_page,
      end_page,
      conditions,
      comparisons,
    }: {
      book_id: string;
      start_page: number;
      end_page: number;
      conditions: OCRCondition[];
      comparisons: OCRComparison[];
    } = await request.json();

    if (!book_id || !start_page || !end_page) {
      return NextResponse.json({ error: 'book_id, start_page, end_page required' }, { status: 400 });
    }

    const db = await getDb();

    // Get pages in range
    const pages = await db
      .collection('pages')
      .find({
        book_id,
        page_number: { $gte: start_page, $lte: end_page },
      })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found in range' }, { status: 404 });
    }

    const experimentId = crypto.randomUUID();
    const pageCount = pages.length;
    const totalJudgments = pageCount * comparisons.length;

    const experiment = {
      id: experimentId,
      type: 'ocr_quality',
      book_id,
      start_page,
      end_page,
      page_ids: pages.map(p => p.id),
      page_count: pageCount,
      conditions,
      comparisons,
      total_judgments: totalJudgments,
      conditions_run: [],
      judgments_complete: 0,
      status: 'setup', // setup, running, judging, completed
      created_at: new Date().toISOString(),
    };

    await db.collection('ocr_experiments').insertOne(experiment);

    return NextResponse.json({
      experiment_id: experimentId,
      page_count: pageCount,
      total_judgments: totalJudgments,
    });
  } catch (error) {
    console.error('Error creating OCR experiment:', error);
    return NextResponse.json({ error: 'Failed to create experiment' }, { status: 500 });
  }
}

// GET /api/experiments/ocr-quality - List OCR quality experiments
export async function GET() {
  try {
    const db = await getDb();
    const experiments = await db
      .collection('ocr_experiments')
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    return NextResponse.json({ experiments });
  } catch (error) {
    console.error('Error fetching OCR experiments:', error);
    return NextResponse.json({ error: 'Failed to fetch experiments' }, { status: 500 });
  }
}
