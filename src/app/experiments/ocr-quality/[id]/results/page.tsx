'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface ComparisonResult {
  comparison_type: string;
  condition_a: string;
  condition_b: string;
  a_wins: number;
  b_wins: number;
  ties: number;
  total: number;
  a_win_rate: number;
  b_win_rate: number;
  significant: boolean;
  p_value: number;
}

interface ConditionStats {
  condition_id: string;
  label: string;
  total_wins: number;
  total_losses: number;
  total_ties: number;
  total_comparisons: number;
  win_rate: number;
}

interface ResultsData {
  comparisons: ComparisonResult[];
  conditions: ConditionStats[];
  recommendation: string;
  total_judgments: number;
}

// Binomial test approximation (Wilson score interval)
function wilsonConfidenceInterval(wins: number, n: number, z: number = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const denominator = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return [
    Math.max(0, (center - spread) / denominator),
    Math.min(1, (center + spread) / denominator),
  ];
}

// Simple binomial test (two-tailed)
function binomialPValue(wins: number, n: number): number {
  // Approximate using normal distribution for larger samples
  if (n === 0) return 1;
  const p = 0.5;
  const expected = n * p;
  const stdDev = Math.sqrt(n * p * (1 - p));
  const z = Math.abs(wins - expected) / stdDev;
  // Two-tailed p-value approximation
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

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<ResultsData | null>(null);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch(`/api/experiments/ocr-quality/${id}/results`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (error) {
        console.error('Error fetching results:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!results) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-stone-900 mb-2">No Results Yet</h2>
          <p className="text-stone-600">Complete the judging phase first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/experiments/ocr-quality"
            className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-purple-600" />
              Experiment Results
            </h1>
            <p className="text-stone-500 text-sm">
              {results.total_judgments} judgments analyzed
            </p>
          </div>
        </div>

        {/* Recommendation */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-3">
            <Trophy className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-green-900 mb-1">Recommendation</h2>
              <p className="text-green-800">{results.recommendation}</p>
            </div>
          </div>
        </div>

        {/* Pairwise Comparisons */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 mb-8">
          <h2 className="font-semibold text-stone-900 mb-4">Pairwise Comparisons</h2>

          <div className="space-y-4">
            {results.comparisons.map((comp, i) => {
              const [aLow, aHigh] = wilsonConfidenceInterval(comp.a_wins, comp.total - comp.ties);
              const [bLow, bHigh] = wilsonConfidenceInterval(comp.b_wins, comp.total - comp.ties);
              const winner = comp.a_win_rate > comp.b_win_rate ? 'a' : comp.b_win_rate > comp.a_win_rate ? 'b' : 'tie';

              return (
                <div key={i} className="border border-stone-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-stone-900">{comp.comparison_type}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      comp.significant
                        ? 'bg-green-100 text-green-700'
                        : 'bg-stone-100 text-stone-500'
                    }`}>
                      {comp.significant ? 'Significant' : 'Not significant'}
                      {comp.p_value < 1 && ` (p=${comp.p_value.toFixed(3)})`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    {/* Condition A */}
                    <div className={`p-3 rounded-lg ${winner === 'a' ? 'bg-green-50 border border-green-200' : 'bg-stone-50'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {winner === 'a' && <TrendingUp className="w-4 h-4 text-green-600" />}
                        <span className="text-sm font-medium text-stone-700">
                          {CONDITION_LABELS[comp.condition_a] || comp.condition_a}
                        </span>
                      </div>
                      <div className="text-2xl font-bold text-stone-900">
                        {(comp.a_win_rate * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-stone-500">
                        {comp.a_wins} wins • CI: [{(aLow * 100).toFixed(0)}-{(aHigh * 100).toFixed(0)}%]
                      </div>
                    </div>

                    {/* Ties */}
                    <div className="p-3 rounded-lg bg-stone-50 text-center">
                      <div className="flex items-center justify-center gap-2 mb-1">
                        <Minus className="w-4 h-4 text-stone-400" />
                        <span className="text-sm font-medium text-stone-700">Ties</span>
                      </div>
                      <div className="text-2xl font-bold text-stone-500">
                        {comp.ties}
                      </div>
                      <div className="text-xs text-stone-500">
                        {((comp.ties / comp.total) * 100).toFixed(0)}% of judgments
                      </div>
                    </div>

                    {/* Condition B */}
                    <div className={`p-3 rounded-lg ${winner === 'b' ? 'bg-green-50 border border-green-200' : 'bg-stone-50'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {winner === 'b' && <TrendingUp className="w-4 h-4 text-green-600" />}
                        <span className="text-sm font-medium text-stone-700">
                          {CONDITION_LABELS[comp.condition_b] || comp.condition_b}
                        </span>
                      </div>
                      <div className="text-2xl font-bold text-stone-900">
                        {(comp.b_win_rate * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-stone-500">
                        {comp.b_wins} wins • CI: [{(bLow * 100).toFixed(0)}-{(bHigh * 100).toFixed(0)}%]
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Overall Rankings */}
        <div className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="font-semibold text-stone-900 mb-4">Overall Condition Rankings</h2>
          <p className="text-sm text-stone-500 mb-4">
            Aggregated win rates across all pairwise comparisons
          </p>

          <div className="space-y-3">
            {results.conditions
              .sort((a, b) => b.win_rate - a.win_rate)
              .map((cond, i) => {
                const [low, high] = wilsonConfidenceInterval(
                  cond.total_wins,
                  cond.total_comparisons - cond.total_ties
                );

                return (
                  <div
                    key={cond.condition_id}
                    className={`flex items-center gap-4 p-3 rounded-lg ${
                      i === 0 ? 'bg-green-50 border border-green-200' : 'bg-stone-50'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                      i === 0 ? 'bg-green-600 text-white' : 'bg-stone-300 text-stone-600'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-stone-900">{cond.label}</div>
                      <div className="text-xs text-stone-500">
                        {cond.total_wins}W - {cond.total_losses}L - {cond.total_ties}T
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-stone-900">
                        {(cond.win_rate * 100).toFixed(0)}%
                      </div>
                      <div className="text-xs text-stone-500">
                        CI: [{(low * 100).toFixed(0)}-{(high * 100).toFixed(0)}%]
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Key Findings */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 mt-8">
          <h2 className="font-semibold text-stone-900 mb-4">Key Questions Answered</h2>

          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-stone-900">Does batching help or hurt?</p>
                <p className="text-stone-600">
                  {getBatchingConclusion(results.comparisons)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-stone-900">Is the elaborate prompt worth it?</p>
                <p className="text-stone-600">
                  {getPromptConclusion(results.comparisons)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-stone-900">What's the optimal batch size?</p>
                <p className="text-stone-600">
                  {getBatchSizeConclusion(results.comparisons)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getBatchingConclusion(comparisons: ComparisonResult[]): string {
  const batch1vs5 = comparisons.find(c => c.comparison_type.includes('1 vs 5'));
  if (!batch1vs5) return 'Insufficient data';

  if (batch1vs5.significant) {
    if (batch1vs5.a_win_rate > batch1vs5.b_win_rate) {
      return 'Single-page OCR performs significantly better than batching.';
    } else {
      return 'Batching (5 pages) performs significantly better than single-page.';
    }
  }
  return 'No significant difference between single-page and batch processing.';
}

function getPromptConclusion(comparisons: ComparisonResult[]): string {
  const promptComp = comparisons.find(c => c.comparison_type.includes('Simple vs Elaborate'));
  if (!promptComp) return 'Insufficient data';

  if (promptComp.significant) {
    if (promptComp.a_win_rate > promptComp.b_win_rate) {
      return 'The simple prompt performs significantly better.';
    } else {
      return 'The elaborate prompt performs significantly better - worth the extra tokens.';
    }
  }
  return 'No significant difference between simple and elaborate prompts.';
}

function getBatchSizeConclusion(comparisons: ComparisonResult[]): string {
  const sizes = ['5', '10', '20'];
  let bestSize = '1';
  let degradeAt = '';

  for (const size of sizes) {
    const comp = comparisons.find(c =>
      c.comparison_type.includes(`vs ${size}`) ||
      c.comparison_type.includes(`${size} vs`)
    );
    if (comp && comp.significant) {
      if (comp.b_win_rate < comp.a_win_rate) {
        degradeAt = size;
        break;
      } else {
        bestSize = size;
      }
    }
  }

  if (degradeAt) {
    return `Quality degrades at batch size ${degradeAt}. Recommend batch size ${bestSize} or smaller.`;
  }
  return `No significant degradation detected up to batch size 20. Batch size ${bestSize} recommended for efficiency.`;
}
