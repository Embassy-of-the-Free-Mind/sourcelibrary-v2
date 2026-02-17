import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

// GET /api/experiments/[id] - Get experiment details and results
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    const experiment = await db.collection('experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get results for this experiment
    const results = await db
      .collection('experiment_results')
      .find({ experiment_id: id })
      .sort({ page_number: 1 })
      .toArray();

    return NextResponse.json({ experiment, results });
  } catch (error) {
    console.error('Error fetching experiment:', error);
    return NextResponse.json({ error: 'Failed to fetch experiment' }, { status: 500 });
  }
});

// PATCH /api/experiments/[id] - Update experiment status
export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const updates = await request.json();
    const db = await getDb();

    const allowedUpdates = ['status', 'completed_at', 'results_count', 'total_cost', 'total_tokens'];
    const filteredUpdates: Record<string, unknown> = {};
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    await db.collection('experiments').updateOne({ id }, { $set: filteredUpdates });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating experiment:', error);
    return NextResponse.json({ error: 'Failed to update experiment' }, { status: 500 });
  }
});

// DELETE /api/experiments/[id] - Delete experiment and its results
export const DELETE = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    await db.collection('experiments').deleteOne({ id });
    await db.collection('experiment_results').deleteMany({ experiment_id: id });
    await db.collection('comparisons').deleteMany({
      $or: [{ experiment_a_id: id }, { experiment_b_id: id }],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting experiment:', error);
    return NextResponse.json({ error: 'Failed to delete experiment' }, { status: 500 });
  }
});
