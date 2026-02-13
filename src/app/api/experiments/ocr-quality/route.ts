import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

export interface OCRCondition {
  id: string;
  batchSize: number;
  promptType: 'simple' | 'elaborate' | 'custom';
  label: string;
  customPrompt?: string;
}

export interface OCRComparison {
  a: string;
  b: string;
  question: string;
}

// POST /api/experiments/ocr-quality - Create OCR quality experiment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      book_id,
      start_page,
      end_page,
      page_ids: directPageIds,
      conditions,
      comparisons,
    }: {
      book_id?: string;
      start_page?: number;
      end_page?: number;
      page_ids?: string[];
      conditions: OCRCondition[];
      comparisons: OCRComparison[];
    } = body;

    if (!book_id && !directPageIds?.length) {
      return NextResponse.json({ error: 'book_id or page_ids required' }, { status: 400 });
    }

    const db = await getDb();

    let pages;
    if (directPageIds?.length) {
      // Direct page IDs — can span multiple books
      pages = await db
        .collection('pages')
        .find({ id: { $in: directPageIds } })
        .sort({ page_number: 1 })
        .toArray();
    } else {
      // Page range within a single book
      pages = await db
        .collection('pages')
        .find({
          book_id,
          page_number: { $gte: start_page!, $lte: end_page! },
        })
        .sort({ page_number: 1 })
        .toArray();
    }

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Derive book_id from pages if not provided
    const effectiveBookId = book_id || pages[0].book_id;

    const experimentId = crypto.randomUUID();
    const pageCount = pages.length;
    const totalJudgments = pageCount * comparisons.length;

    const experiment = {
      id: experimentId,
      type: 'ocr_quality',
      book_id: effectiveBookId,
      ...(start_page ? { start_page } : {}),
      ...(end_page ? { end_page } : {}),
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
