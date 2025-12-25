import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

const CONDITION_LABELS: Record<string, string> = {
  'b1_simple': 'Batch 1 + Simple',
  'b1_elaborate': 'Batch 1 + Elaborate',
  'b5_simple': 'Batch 5 + Simple',
  'b5_elaborate': 'Batch 5 + Elaborate',
  'b10_simple': 'Batch 10 + Simple',
  'b10_elaborate': 'Batch 10 + Elaborate',
  'b20_simple': 'Batch 20 + Simple',
  'b20_elaborate': 'Batch 20 + Elaborate',
};

// ELO rating calculation
function calculateELO(judgments: Array<{ condition_a: string; condition_b: string; winner: string }>) {
  const K = 32; // K-factor
  const ratings: Record<string, number> = {};

  // Initialize all conditions at 1500
  const conditions = new Set<string>();
  judgments.forEach(j => {
    conditions.add(j.condition_a);
    conditions.add(j.condition_b);
  });
  conditions.forEach(c => { ratings[c] = 1500; });

  // Process each judgment
  judgments.forEach(j => {
    const rA = ratings[j.condition_a];
    const rB = ratings[j.condition_b];

    // Expected scores
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const eB = 1 / (1 + Math.pow(10, (rA - rB) / 400));

    // Actual scores
    let sA: number, sB: number;
    if (j.winner === 'a') {
      sA = 1; sB = 0;
    } else if (j.winner === 'b') {
      sA = 0; sB = 1;
    } else {
      sA = 0.5; sB = 0.5;
    }

    // Update ratings
    ratings[j.condition_a] = rA + K * (sA - eA);
    ratings[j.condition_b] = rB + K * (sB - eB);
  });

  return ratings;
}

// Simple binomial test (two-tailed) using normal approximation
function binomialPValue(wins: number, n: number): number {
  if (n === 0) return 1;
  const p = 0.5;
  const expected = n * p;
  const stdDev = Math.sqrt(n * p * (1 - p));
  if (stdDev === 0) return 1;
  const z = Math.abs(wins - expected) / stdDev;
  // Two-tailed p-value using normal approximation
  return 2 * (1 - normalCDF(z));
}

function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

// GET /api/experiments/ocr-quality/[id]/results - Get experiment results
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get experiment
    const experiment = await db.collection('ocr_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Get all judgments
    const judgments = await db
      .collection('ocr_judgments')
      .find({ experiment_id: id })
      .toArray();

    if (judgments.length === 0) {
      return NextResponse.json({ error: 'No judgments yet' }, { status: 404 });
    }

    // Aggregate by comparison type
    const comparisonStats: Record<string, {
      condition_a: string;
      condition_b: string;
      a_wins: number;
      b_wins: number;
      ties: number;
    }> = {};

    judgments.forEach(j => {
      const key = j.comparison_type;
      if (!comparisonStats[key]) {
        comparisonStats[key] = {
          condition_a: j.condition_a,
          condition_b: j.condition_b,
          a_wins: 0,
          b_wins: 0,
          ties: 0,
        };
      }

      if (j.winner === 'a') comparisonStats[key].a_wins++;
      else if (j.winner === 'b') comparisonStats[key].b_wins++;
      else comparisonStats[key].ties++;
    });

    // Calculate win rates and significance
    const comparisons = Object.entries(comparisonStats).map(([type, stats]) => {
      const nonTies = stats.a_wins + stats.b_wins;
      const total = nonTies + stats.ties;
      const aWinRate = nonTies > 0 ? stats.a_wins / nonTies : 0.5;
      const bWinRate = nonTies > 0 ? stats.b_wins / nonTies : 0.5;
      const pValue = binomialPValue(stats.a_wins, nonTies);

      return {
        comparison_type: type,
        condition_a: stats.condition_a,
        condition_b: stats.condition_b,
        a_wins: stats.a_wins,
        b_wins: stats.b_wins,
        ties: stats.ties,
        total,
        a_win_rate: aWinRate,
        b_win_rate: bWinRate,
        significant: pValue < 0.05,
        p_value: pValue,
      };
    });

    // Calculate overall condition stats
    const conditionStats: Record<string, {
      wins: number;
      losses: number;
      ties: number;
      comparisons: number;
    }> = {};

    // Initialize all conditions
    Object.keys(CONDITION_LABELS).forEach(cond => {
      conditionStats[cond] = { wins: 0, losses: 0, ties: 0, comparisons: 0 };
    });

    // Aggregate wins/losses
    judgments.forEach(j => {
      const a = j.condition_a;
      const b = j.condition_b;

      if (conditionStats[a]) conditionStats[a].comparisons++;
      if (conditionStats[b]) conditionStats[b].comparisons++;

      if (j.winner === 'a') {
        if (conditionStats[a]) conditionStats[a].wins++;
        if (conditionStats[b]) conditionStats[b].losses++;
      } else if (j.winner === 'b') {
        if (conditionStats[a]) conditionStats[a].losses++;
        if (conditionStats[b]) conditionStats[b].wins++;
      } else {
        if (conditionStats[a]) conditionStats[a].ties++;
        if (conditionStats[b]) conditionStats[b].ties++;
      }
    });

    // Calculate ELO ratings
    const eloRatings = calculateELO(judgments.map(j => ({
      condition_a: j.condition_a,
      condition_b: j.condition_b,
      winner: j.winner,
    })));

    const conditions = Object.entries(conditionStats)
      .filter(([_, stats]) => stats.comparisons > 0)
      .map(([cond, stats]) => {
        const nonTies = stats.wins + stats.losses;
        return {
          condition_id: cond,
          label: CONDITION_LABELS[cond] || cond,
          total_wins: stats.wins,
          total_losses: stats.losses,
          total_ties: stats.ties,
          total_comparisons: stats.comparisons,
          win_rate: nonTies > 0 ? stats.wins / nonTies : 0.5,
          elo: Math.round(eloRatings[cond] || 1500),
        };
      });

    // Sort by ELO for ranking
    const rankedConditions = [...conditions].sort((a, b) => b.elo - a.elo);

    // Generate recommendation
    const bestCondition = rankedConditions[0];
    let recommendation = `Based on ${judgments.length} judgments, `;

    if (bestCondition) {
      recommendation += `**${bestCondition.label}** performed best (ELO: ${bestCondition.elo}). `;

      // Check if elaborate vs simple matters
      const promptComp = comparisons.find(c => c.comparison_type.includes('Simple vs Elaborate'));
      if (promptComp && promptComp.significant) {
        const winner = promptComp.a_win_rate > promptComp.b_win_rate ? 'Simple' : 'Elaborate';
        recommendation += `The ${winner} prompt is significantly better. `;
      } else if (promptComp) {
        recommendation += `Prompt complexity doesn't significantly affect quality. `;
      }

      // Check batch size degradation
      const batch10vs20 = comparisons.find(c => c.comparison_type.includes('10 vs 20'));
      if (batch10vs20 && batch10vs20.significant && batch10vs20.a_win_rate > batch10vs20.b_win_rate) {
        recommendation += `Quality degrades at batch size 20 - stay at 10 or lower.`;
      }
    } else {
      recommendation = 'Not enough data to make a recommendation.';
    }

    return NextResponse.json({
      comparisons,
      conditions: rankedConditions,
      recommendation,
      total_judgments: judgments.length,
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}
