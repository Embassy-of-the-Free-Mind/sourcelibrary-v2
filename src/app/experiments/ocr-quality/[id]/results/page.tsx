'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { ocrQualityExperiments } from '@/lib/api-client';

interface ComparisonResult {
  comparison_type: string;
  condition_a: string;
  condition_b: string;
  label_a: string;
  label_b: string;
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
  elo: number;
}

interface ResultsData {
  comparisons: ComparisonResult[];
  conditions: ConditionStats[];
  recommendation: string;
  total_judgments: number;
}

// Wilson score interval
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

export default function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<ResultsData | null>(null);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const data = await ocrQualityExperiments.results(id);
        setResults(data as any);
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-muted">Loading results...</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl text-primary mb-2">No Results Yet</p>
          <p className="text-lg text-secondary">Complete the judging phase first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/experiments/ocr-quality"
            className="text-base text-muted hover:text-secondary transition-colors"
          >
            &larr; Back to experiments
          </Link>
          <h1 className="text-3xl text-primary mt-3">Experiment Results</h1>
          <p className="text-lg text-secondary">
            {results.total_judgments} judgments analyzed
          </p>
        </div>

        {/* Recommendation */}
        <div className="card-warm p-6 mb-8">
          <h2 className="text-xl font-semibold text-primary mb-2">Recommendation</h2>
          <p className="text-lg text-secondary" dangerouslySetInnerHTML={{
            __html: results.recommendation.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          }} />
        </div>

        {/* Pairwise Comparisons */}
        <div className="card p-6 mb-8">
          <h2 className="text-xl font-semibold text-primary mb-4">Pairwise Comparisons</h2>

          <div className="space-y-4">
            {results.comparisons.map((comp, i) => {
              const [aLow, aHigh] = wilsonConfidenceInterval(comp.a_wins, comp.total - comp.ties);
              const [bLow, bHigh] = wilsonConfidenceInterval(comp.b_wins, comp.total - comp.ties);
              const winner = comp.a_win_rate > comp.b_win_rate ? 'a' : comp.b_win_rate > comp.a_win_rate ? 'b' : 'tie';

              return (
                <div key={i} className="border border-border-light rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-medium text-primary">{comp.comparison_type}</h3>
                    <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${
                      comp.significant
                        ? 'bg-green-100 text-green-700'
                        : 'bg-warm text-muted'
                    }`}>
                      {comp.significant ? 'Significant' : 'Not significant'}
                      {comp.p_value < 1 && ` (p=${comp.p_value.toFixed(3)})`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    {/* Condition A */}
                    <div className={`p-3 rounded-lg ${winner === 'a' ? 'bg-green-50 border border-green-200' : 'bg-warm'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {winner === 'a' && <span className="text-green-600">&#x25B2;</span>}
                        <span className="text-base font-medium text-secondary">
                          {comp.label_a || comp.condition_a}
                        </span>
                      </div>
                      <div className="text-2xl font-bold text-primary">
                        {(comp.a_win_rate * 100).toFixed(0)}%
                      </div>
                      <div className="text-sm text-muted">
                        {comp.a_wins} wins &middot; CI: [{(aLow * 100).toFixed(0)}-{(aHigh * 100).toFixed(0)}%]
                      </div>
                    </div>

                    {/* Ties */}
                    <div className="p-3 rounded-lg bg-warm text-center">
                      <div className="text-base font-medium text-muted mb-1">Ties</div>
                      <div className="text-2xl font-bold text-secondary">
                        {comp.ties}
                      </div>
                      <div className="text-sm text-muted">
                        {((comp.ties / comp.total) * 100).toFixed(0)}% of judgments
                      </div>
                    </div>

                    {/* Condition B */}
                    <div className={`p-3 rounded-lg ${winner === 'b' ? 'bg-green-50 border border-green-200' : 'bg-warm'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {winner === 'b' && <span className="text-green-600">&#x25B2;</span>}
                        <span className="text-base font-medium text-secondary">
                          {comp.label_b || comp.condition_b}
                        </span>
                      </div>
                      <div className="text-2xl font-bold text-primary">
                        {(comp.b_win_rate * 100).toFixed(0)}%
                      </div>
                      <div className="text-sm text-muted">
                        {comp.b_wins} wins &middot; CI: [{(bLow * 100).toFixed(0)}-{(bHigh * 100).toFixed(0)}%]
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Overall Rankings */}
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-primary mb-2">Overall Condition Rankings</h2>
          <p className="text-base text-muted mb-4">
            Ranked by ELO with aggregated win rates across all pairwise comparisons
          </p>

          <div className="space-y-3">
            {results.conditions
              .sort((a, b) => b.elo - a.elo)
              .map((cond, i) => {
                const [low, high] = wilsonConfidenceInterval(
                  cond.total_wins,
                  cond.total_comparisons - cond.total_ties
                );

                return (
                  <div
                    key={cond.condition_id}
                    className={`flex items-center gap-4 p-3 rounded-lg ${
                      i === 0 ? 'bg-green-50 border border-green-200' : 'bg-warm'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-base ${
                      i === 0 ? 'bg-green-600 text-white' : 'bg-border-medium text-secondary'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="text-lg font-medium text-primary">{cond.label}</div>
                      <div className="text-sm text-muted">
                        {cond.total_wins}W - {cond.total_losses}L - {cond.total_ties}T &middot; ELO: {cond.elo}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-primary">
                        {(cond.win_rate * 100).toFixed(0)}%
                      </div>
                      <div className="text-sm text-muted">
                        CI: [{(low * 100).toFixed(0)}-{(high * 100).toFixed(0)}%]
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
