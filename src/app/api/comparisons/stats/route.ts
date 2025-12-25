import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// GET /api/comparisons/stats - Get win rates between experiments
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const experimentA = searchParams.get('experiment_a');
    const experimentB = searchParams.get('experiment_b');

    if (!experimentA || !experimentB) {
      return NextResponse.json(
        { error: 'experiment_a and experiment_b required' },
        { status: 400 }
      );
    }

    // Get all comparisons between these experiments
    const comparisons = await db
      .collection('comparisons')
      .find({
        experiment_a_id: experimentA,
        experiment_b_id: experimentB,
      })
      .toArray();

    // Calculate stats by field
    const stats = {
      ocr: { a_wins: 0, b_wins: 0, ties: 0, total: 0 },
      translation: { a_wins: 0, b_wins: 0, ties: 0, total: 0 },
      overall: { a_wins: 0, b_wins: 0, ties: 0, total: 0 },
    };

    for (const c of comparisons) {
      const field = c.field as 'ocr' | 'translation';
      if (stats[field]) {
        stats[field].total++;
        stats.overall.total++;

        if (c.winner === 'a') {
          stats[field].a_wins++;
          stats.overall.a_wins++;
        } else if (c.winner === 'b') {
          stats[field].b_wins++;
          stats.overall.b_wins++;
        } else {
          stats[field].ties++;
          stats.overall.ties++;
        }
      }
    }

    // Calculate win rates
    const calculateWinRate = (wins: number, total: number) =>
      total > 0 ? Math.round((wins / total) * 100) : 0;

    const result = {
      ocr: {
        ...stats.ocr,
        a_win_rate: calculateWinRate(stats.ocr.a_wins, stats.ocr.total),
        b_win_rate: calculateWinRate(stats.ocr.b_wins, stats.ocr.total),
      },
      translation: {
        ...stats.translation,
        a_win_rate: calculateWinRate(stats.translation.a_wins, stats.translation.total),
        b_win_rate: calculateWinRate(stats.translation.b_wins, stats.translation.total),
      },
      overall: {
        ...stats.overall,
        a_win_rate: calculateWinRate(stats.overall.a_wins, stats.overall.total),
        b_win_rate: calculateWinRate(stats.overall.b_wins, stats.overall.total),
      },
    };

    return NextResponse.json({ stats: result });
  } catch (error) {
    console.error('Error fetching comparison stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
