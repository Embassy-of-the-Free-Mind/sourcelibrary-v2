'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ocrQualityExperiments } from '@/lib/api-client';

interface ExperimentSummary {
  id: string;
  book_id: string;
  status: string;
  conditions: Array<{ id: string; label: string; promptType: string; batchSize: number }>;
  comparisons: Array<{ a: string; b: string; question: string }>;
  page_count: number;
  total_judgments: number;
  judgments_complete: number;
  conditions_run: string[];
  created_at: string;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    setup: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    judging: 'bg-purple-100 text-purple-800',
    completed: 'bg-green-100 text-green-800',
  };
  return styles[status] || 'bg-gray-100 text-gray-800';
}

export default function OCRExperimentsDashboard() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExperiments = async () => {
      try {
        const data = await ocrQualityExperiments.list();
        setExperiments((data.experiments || []) as any);
      } catch (err) {
        console.error('Error fetching experiments:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchExperiments();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-muted">Loading experiments...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link
            href="/experiments"
            className="text-base text-muted hover:text-secondary transition-colors"
          >
            &larr; Back to experiments
          </Link>
          <h1 className="text-3xl text-primary mt-3">OCR Quality Experiments</h1>
          <p className="text-lg text-secondary mt-1">
            Compare OCR prompts on the same pages, then judge quality with AI or manually.
            Create new experiments from Claude Code.
          </p>
        </div>

        {experiments.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-xl text-primary mb-2">No experiments yet</p>
            <p className="text-base text-secondary">
              Create experiments via Claude Code by describing what you want to compare.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {experiments.map(exp => {
              const conditionsRun = exp.conditions_run?.length || 0;
              const totalConditions = exp.conditions?.length || 0;
              const allConditionsRun = conditionsRun >= totalConditions && totalConditions > 0;
              const hasJudgments = (exp.judgments_complete || 0) > 0;
              const judgingDone = exp.status === 'completed';

              return (
                <div key={exp.id} className="card p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${statusBadge(exp.status)}`}>
                          {exp.status}
                        </span>
                        <span className="text-base text-muted">
                          {new Date(exp.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-base text-muted mt-1 font-mono">{exp.id.slice(0, 8)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4 text-base">
                    <div>
                      <span className="text-muted">Pages:</span>
                      <span className="ml-2 font-medium text-primary">{exp.page_count}</span>
                    </div>
                    <div>
                      <span className="text-muted">Conditions:</span>
                      <span className="ml-2 font-medium text-primary">
                        {conditionsRun}/{totalConditions} run
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">Judgments:</span>
                      <span className="ml-2 font-medium text-primary">
                        {exp.judgments_complete || 0}/{exp.total_judgments}
                      </span>
                    </div>
                  </div>

                  {exp.conditions && exp.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {exp.conditions.map(c => (
                        <span key={c.id} className="px-3 py-1 text-sm bg-accent-violet/10 text-accent-violet rounded-full border border-accent-violet/20">
                          {c.label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3">
                    {allConditionsRun && (
                      <Link
                        href={`/experiments/ocr-quality/${exp.id}/review`}
                        className="btn-secondary"
                      >
                        Review
                      </Link>
                    )}
                    {allConditionsRun && !judgingDone && exp.comparisons?.length > 0 && (
                      <Link
                        href={`/experiments/ocr-quality/${exp.id}/judge`}
                        className="btn-secondary"
                      >
                        Judge
                      </Link>
                    )}
                    {(hasJudgments || judgingDone) && (
                      <Link
                        href={`/experiments/ocr-quality/${exp.id}/results`}
                        className="btn-secondary"
                      >
                        Results
                      </Link>
                    )}
                    {!allConditionsRun && (
                      <span className="text-base text-muted py-2">
                        Waiting for conditions to be run via CLI
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="card p-6 mt-8">
          <h2 className="text-xl text-primary mb-4">How It Works</h2>
          <div className="space-y-3 text-base text-secondary leading-relaxed">
            <p>
              <strong>1. Create (CLI):</strong> Tell Claude Code what to compare &mdash; it creates the experiment via API.
            </p>
            <p>
              <strong>2. Run (CLI):</strong> Claude Code runs each condition, OCR-ing the same pages with different prompts.
            </p>
            <p>
              <strong>3. Judge (CLI or Web):</strong> AI auto-judging via CLI, or blind manual judging here in the browser.
            </p>
            <p>
              <strong>4. Results (Web):</strong> Win rates, confidence intervals, ELO rankings, and recommendations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
