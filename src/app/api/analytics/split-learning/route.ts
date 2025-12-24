import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET() {
  try {
    const db = await getDb();

    const adjustments = await db.collection('split_adjustments')
      .find({})
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    if (adjustments.length === 0) {
      return NextResponse.json({ message: 'No adjustments logged yet', count: 0 });
    }

    const deltas = adjustments.map(a => a.chosenPosition - a.detectedPosition);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const absDeltas = deltas.map(d => Math.abs(d));
    const avgAbsDelta = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;

    return NextResponse.json({
      count: adjustments.length,
      stats: {
        avgDelta: Math.round(avgDelta * 10) / 10,
        avgDeltaPercent: Math.round(avgDelta) / 10,
        avgAbsDelta: Math.round(avgAbsDelta * 10) / 10,
        avgAbsDeltaPercent: Math.round(avgAbsDelta) / 10,
        leftAdjustments: deltas.filter(d => d < 0).length,
        rightAdjustments: deltas.filter(d => d > 0).length,
      },
      adjustments: adjustments.map(a => ({
        detected: a.detectedPosition,
        chosen: a.chosenPosition,
        delta: a.chosenPosition - a.detectedPosition,
        pageId: a.pageId,
        timestamp: a.timestamp
      }))
    });
  } catch (error) {
    console.error('Error fetching split learning data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch data' },
      { status: 500 }
    );
  }
}
