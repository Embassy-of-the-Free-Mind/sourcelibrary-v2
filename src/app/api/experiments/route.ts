import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

// GET /api/experiments - List all experiments
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');

    const query: Record<string, unknown> = {};
    if (bookId) query.book_id = bookId;

    const experiments = await db
      .collection('experiments')
      .find(query)
      .sort({ created_at: -1 })
      .toArray();

    return NextResponse.json({ experiments });
  } catch (error) {
    console.error('Error fetching experiments:', error);
    return NextResponse.json({ error: 'Failed to fetch experiments' }, { status: 500 });
  }
}

// POST /api/experiments - Create a new experiment
export async function POST(request: NextRequest) {
  try {
    const {
      name,
      description,
      book_id,
      method,
      settings,
    }: {
      name: string;
      description?: string;
      book_id: string;
      method: 'single_ocr' | 'batch_ocr' | 'single_translate' | 'batch_translate' | 'combined';
      settings: {
        model: string;
        batch_size?: number;
        prompt?: string;
        use_context?: boolean;
      };
    } = await request.json();

    if (!name || !book_id || !method) {
      return NextResponse.json({ error: 'name, book_id, and method required' }, { status: 400 });
    }

    const db = await getDb();
    const experiment = {
      id: crypto.randomUUID(),
      name,
      description: description || '',
      book_id,
      method,
      settings,
      status: 'pending', // pending, running, completed, failed
      created_at: new Date().toISOString(),
      completed_at: null,
      results_count: 0,
      total_cost: 0,
      total_tokens: 0,
    };

    await db.collection('experiments').insertOne(experiment);

    return NextResponse.json({ experiment });
  } catch (error) {
    console.error('Error creating experiment:', error);
    return NextResponse.json({ error: 'Failed to create experiment' }, { status: 500 });
  }
}
