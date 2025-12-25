import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import crypto from 'crypto';

// GET /api/comparisons - Get comparisons, optionally filtered
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const experimentA = searchParams.get('experiment_a');
    const experimentB = searchParams.get('experiment_b');
    const pageId = searchParams.get('page_id');

    const query: Record<string, unknown> = {};
    if (experimentA) query.experiment_a_id = experimentA;
    if (experimentB) query.experiment_b_id = experimentB;
    if (pageId) query.page_id = pageId;

    const comparisons = await db
      .collection('comparisons')
      .find(query)
      .sort({ created_at: -1 })
      .toArray();

    return NextResponse.json({ comparisons });
  } catch (error) {
    console.error('Error fetching comparisons:', error);
    return NextResponse.json({ error: 'Failed to fetch comparisons' }, { status: 500 });
  }
}

// POST /api/comparisons - Record a comparison rating
export async function POST(request: NextRequest) {
  try {
    const {
      page_id,
      experiment_a_id,
      experiment_b_id,
      field, // 'ocr' or 'translation'
      winner, // 'a', 'b', or 'tie'
      notes,
    }: {
      page_id: string;
      experiment_a_id: string;
      experiment_b_id: string;
      field: 'ocr' | 'translation';
      winner: 'a' | 'b' | 'tie';
      notes?: string;
    } = await request.json();

    if (!page_id || !experiment_a_id || !experiment_b_id || !field || !winner) {
      return NextResponse.json(
        { error: 'page_id, experiment_a_id, experiment_b_id, field, and winner required' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check if comparison already exists for this page/experiment pair
    const existing = await db.collection('comparisons').findOne({
      page_id,
      experiment_a_id,
      experiment_b_id,
      field,
    });

    if (existing) {
      // Update existing
      await db.collection('comparisons').updateOne(
        { id: existing.id },
        {
          $set: {
            winner,
            notes: notes || existing.notes,
            updated_at: new Date().toISOString(),
          },
        }
      );
      return NextResponse.json({ comparison: { ...existing, winner, notes } });
    }

    // Create new comparison
    const comparison = {
      id: crypto.randomUUID(),
      page_id,
      experiment_a_id,
      experiment_b_id,
      field,
      winner,
      notes: notes || '',
      created_at: new Date().toISOString(),
    };

    await db.collection('comparisons').insertOne(comparison);

    return NextResponse.json({ comparison });
  } catch (error) {
    console.error('Error creating comparison:', error);
    return NextResponse.json({ error: 'Failed to create comparison' }, { status: 500 });
  }
}
