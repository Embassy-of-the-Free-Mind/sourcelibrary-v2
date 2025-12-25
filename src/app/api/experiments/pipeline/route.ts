import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

export interface PipelineCondition {
  id: string;
  type: 'single_pass' | 'two_pass';
  ocrModel: string;
  translateModel: string;
  label: string;
}

// POST /api/experiments/pipeline - Create pipeline experiment
export async function POST(request: NextRequest) {
  try {
    const {
      book_id,
      start_page,
      end_page,
      conditions,
      target_language = 'English',
    }: {
      book_id: string;
      start_page: number;
      end_page: number;
      conditions: PipelineCondition[];
      target_language?: string;
    } = await request.json();

    if (!book_id || !start_page || !end_page) {
      return NextResponse.json({ error: 'book_id, start_page, end_page required' }, { status: 400 });
    }

    const db = await getDb();

    const book = await db.collection('books').findOne({ id: book_id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

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

    const experiment = {
      id: experimentId,
      type: 'pipeline',
      book_id,
      book_title: book.title,
      start_page,
      end_page,
      target_language,
      page_ids: pages.map(p => p.id),
      page_count: pages.length,
      conditions,
      conditions_run: [],
      status: 'setup',
      total_cost: 0,
      total_tokens: 0,
      created_at: new Date().toISOString(),
    };

    await db.collection('pipeline_experiments').insertOne(experiment);

    return NextResponse.json({
      experiment_id: experimentId,
      page_count: pages.length,
      conditions: conditions.length,
    });
  } catch (error) {
    console.error('Error creating pipeline experiment:', error);
    return NextResponse.json({ error: 'Failed to create experiment' }, { status: 500 });
  }
}

// GET /api/experiments/pipeline - List experiments
export async function GET() {
  try {
    const db = await getDb();
    const experiments = await db
      .collection('pipeline_experiments')
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    return NextResponse.json({ experiments });
  } catch (error) {
    console.error('Error fetching experiments:', error);
    return NextResponse.json({ error: 'Failed to fetch experiments' }, { status: 500 });
  }
}
