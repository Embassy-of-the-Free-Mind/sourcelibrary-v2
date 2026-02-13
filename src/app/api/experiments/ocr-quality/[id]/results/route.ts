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
    if (j.winner === 'a') {
      sA = 1; sB = 0;
    } else if (j.winner === 'b') {
      sA = 0; sB = 1;
    } else {
      sA = 0.5; sB = 0.5;
    }

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

    // Get experiment (for condition labels)
    const experiment = await db.collection('ocr_experiments').findOne({ id });
    if (!experiment) {
      return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
    }

    // Build label lookup from experiment conditions
    const conditionLabels: Record<string, string> = {};
    if (experiment.conditions && Array.isArray(experiment.conditions)) {
      for (const cond of experiment.conditions) {
        conditionLabels[cond.id] = cond.label || cond.id;
      }
    }

    // Get all judgments
    const judgments = await db
      .collection('ocr_judgments')
      .find({ experiment_id: id })
      .toArray();

    if (judgments.length === 0) {
      return NextResponse.json({ error: 'No judgments yet' }, { status: 404 });
    }

    const fixedJudgments = judgments.filter(j => j.comparison_type !== 'random');
    const randomJudgments = judgments.filter(j => j.comparison_type === 'random');

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
        label_a: conditionLabels[stats.condition_a] || stats.condition_a,
        label_b: conditionLabels[stats.condition_b] || stats.condition_b,
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

    // Calculate overall condition stats — initialize from actual judgments, not a hardcoded list
    const conditionStats: Record<string, {
      wins: number;
      losses: number;
      ties: number;
      comparisons: number;
    }> = {};

    judgments.forEach(j => {
      const a = j.condition_a;
      const b = j.condition_b;

      if (!conditionStats[a]) conditionStats[a] = { wins: 0, losses: 0, ties: 0, comparisons: 0 };
      if (!conditionStats[b]) conditionStats[b] = { wins: 0, losses: 0, ties: 0, comparisons: 0 };

      conditionStats[a].comparisons++;
      conditionStats[b].comparisons++;

      if (j.winner === 'a') {
        conditionStats[a].wins++;
        conditionStats[b].losses++;
      } else if (j.winner === 'b') {
        conditionStats[a].losses++;
        conditionStats[b].wins++;
      } else {
        conditionStats[a].ties++;
        conditionStats[b].ties++;
      }
    });

    // Calculate ELO ratings
    const eloRatings = calculateELO(judgments.map(j => ({
      condition_a: j.condition_a,
      condition_b: j.condition_b,
      winner: j.winner,
    })));

    const conditions = Object.entries(conditionStats)
      .filter(([, stats]) => stats.comparisons > 0)
      .map(([cond, stats]) => {
        const nonTies = stats.wins + stats.losses;
        return {
          condition_id: cond,
          label: conditionLabels[cond] || cond,
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

    // Generate recommendation dynamically from ranked data
    let recommendation = `Based on ${judgments.length} judgments, `;
    const best = rankedConditions[0];

    if (best && rankedConditions.length >= 2) {
      recommendation += `**${best.label}** performed best (ELO: ${best.elo}, win rate: ${(best.win_rate * 100).toFixed(0)}%).`;

      // Check if any comparisons are statistically significant
      const sigComparisons = comparisons.filter(c => c.significant);
      if (sigComparisons.length > 0) {
        const sigSummary = sigComparisons.map(c => {
          const winnerLabel = c.a_win_rate > c.b_win_rate ? c.label_a : c.label_b;
          const winRate = Math.max(c.a_win_rate, c.b_win_rate);
          return `${winnerLabel} beats its opponent (${(winRate * 100).toFixed(0)}% win rate, p=${c.p_value.toFixed(3)})`;
        });
        recommendation += ` Significant results: ${sigSummary.join('; ')}.`;
      } else {
        recommendation += ` No statistically significant differences found — consider more pages for stronger signal.`;
      }
    } else if (best) {
      recommendation += `only one condition has data: **${best.label}**.`;
    } else {
      recommendation = 'Not enough data to make a recommendation.';
    }

    return NextResponse.json({
      comparisons,
      conditions: rankedConditions,
      recommendation,
      total_judgments: judgments.length,
      fixed_judgments: fixedJudgments.length,
      random_judgments: randomJudgments.length,
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    return NextResponse.json({ error: 'Failed to fetch results' }, { status: 500 });
  }
}
