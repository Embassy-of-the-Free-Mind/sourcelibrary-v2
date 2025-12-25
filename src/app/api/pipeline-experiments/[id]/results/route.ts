import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// ELO rating calculation
function calculateELO(judgments: Array<{ condition_a: string; condition_b: string; winner: string }>) {
  const K = 32;
  const ratings: Record<string, number> = {};

  const conditions = new Set<string>();
  judgments.forEach(j => {
    conditions.add(j.condition_a);
    conditions.add(j.condition_b);
  });
  conditions.forEach(c => { ratings[c] = 1500; });

  judgments.forEach(j => {
    const rA = ratings[j.condition_a];
    const rB = ratings[j.condition_b];

    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const eB = 1 / (1 + Math.pow(10, (rA - rB) / 400));

    let sA: number, sB: number;
    if (j.winner === 'a') { sA = 1; sB = 0; }
    else if (j.winner === 'b') { sA = 0; sB = 1; }
    else { sA = 0.5; sB = 0.5; }

    ratings[j.condition_a] = rA + K * (sA - eA);
    ratings[j.condition_b] = rB + K * (sB - eB);
  });

  return ratings;
}

// GET /api/experiments/pipeline/[id]/results
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const experiment = await db.collection('pipeline_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    const judgments = await db
      .collection('pipeline_judgments')
      .find({ experiment_id: id })
      .toArray();

    if (judgments.length === 0) {
      return NextResponse.json({ error: 'No judgments yet' }, { status: 404 });
    }

    // Calculate ELO
    const eloRatings = calculateELO(judgments.map(j => ({
      condition_a: j.condition_a,
      condition_b: j.condition_b,
      winner: j.winner,
    })));

    // Aggregate stats per condition
    const conditionStats: Record<string, { wins: number; losses: number; ties: number }> = {};

    judgments.forEach(j => {
      if (!conditionStats[j.condition_a]) conditionStats[j.condition_a] = { wins: 0, losses: 0, ties: 0 };
      if (!conditionStats[j.condition_b]) conditionStats[j.condition_b] = { wins: 0, losses: 0, ties: 0 };

      if (j.winner === 'a') {
        conditionStats[j.condition_a].wins++;
        conditionStats[j.condition_b].losses++;
      } else if (j.winner === 'b') {
        conditionStats[j.condition_a].losses++;
        conditionStats[j.condition_b].wins++;
      } else {
        conditionStats[j.condition_a].ties++;
        conditionStats[j.condition_b].ties++;
      }
    });

    // Build results with condition metadata
    const conditionMap = new Map(experiment.conditions.map((c: { id: string; type: string; label: string }) => [c.id, c]));

    const conditions = Object.entries(conditionStats)
      .map(([condId, stats]) => {
        const cond = conditionMap.get(condId);
        return {
          condition_id: condId,
          type: cond?.type || 'unknown',
          label: cond?.label || condId,
          elo: Math.round(eloRatings[condId] || 1500),
          wins: stats.wins,
          losses: stats.losses,
          ties: stats.ties,
          total: stats.wins + stats.losses + stats.ties,
          win_rate: stats.wins / (stats.wins + stats.losses) || 0,
        };
      })
      .sort((a, b) => b.elo - a.elo);

    // Generate recommendation
    const best = conditions[0];
    let recommendation = `Based on ${judgments.length} judgments, `;

    if (best) {
      recommendation += `**${best.label}** (${best.type}) performed best with ELO ${best.elo}. `;

      // Compare single vs two pass
      const singlePass = conditions.find(c => c.type === 'single_pass');
      const twoPass = conditions.find(c => c.type === 'two_pass');

      if (singlePass && twoPass) {
        const diff = singlePass.elo - twoPass.elo;
        if (Math.abs(diff) > 50) {
          const winner = diff > 0 ? 'Single-pass' : 'Two-pass';
          recommendation += `${winner} approach is significantly better (${Math.abs(diff)} ELO difference).`;
        } else {
          recommendation += `Single-pass and two-pass are roughly equivalent.`;
        }
      }
    }

    // Calculate cost per condition from results
    const resultsCost = await db.collection('pipeline_experiment_results').aggregate([
      { $match: { experiment_id: id } },
      { $group: { _id: '$condition_id', count: { $sum: 1 } } },
    ]).toArray();

    return NextResponse.json({
      conditions,
      recommendation,
      total_judgments: judgments.length,
      experiment_cost: experiment.total_cost || 0,
      judging_cost: experiment.judging_cost || 0,
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}
