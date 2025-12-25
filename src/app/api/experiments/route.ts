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

// POST /api/experiments - Create a new A/B experiment
export async function POST(request: NextRequest) {
  try {
    const {
      name,
      description,
      book_id,
      // A/B comparison settings
      variant_a,
      variant_b,
      // Page selection
      page_selection,
      page_count,
      // Legacy single-method support
      method,
      settings,
    }: {
      name: string;
      description?: string;
      book_id: string;
      variant_a?: {
        method: string;
        model: string;
        use_context?: boolean;
      };
      variant_b?: {
        method: string;
        model: string;
        use_context?: boolean;
      };
      page_selection?: 'first_n' | 'sample' | 'all';
      page_count?: number;
      // Legacy
      method?: string;
      settings?: {
        model: string;
        batch_size?: number;
        prompt?: string;
        use_context?: boolean;
      };
    } = await request.json();

    if (!name || !book_id) {
      return NextResponse.json({ error: 'name and book_id required' }, { status: 400 });
    }

    // Require either A/B variants or legacy single method
    if (!variant_a && !method) {
      return NextResponse.json({ error: 'variant_a or method required' }, { status: 400 });
    }

    const db = await getDb();
    const experiment = {
      id: crypto.randomUUID(),
      name,
      description: description || '',
      book_id,
      // A/B comparison
      variant_a: variant_a || (method && settings ? { method, model: settings.model, use_context: settings.use_context } : null),
      variant_b: variant_b || null,
      page_selection: page_selection || 'first_n',
      page_count: page_count || 10,
      // Legacy support
      method: method || variant_a?.method,
      settings: settings || (variant_a ? { model: variant_a.model, use_context: variant_a.use_context } : null),
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
