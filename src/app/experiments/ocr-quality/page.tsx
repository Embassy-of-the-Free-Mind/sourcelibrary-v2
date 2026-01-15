'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FlaskConical,
  Play,
  Loader2,
  CheckCircle2,
  BarChart3,
  Eye,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { ocrQualityExperiments, books } from '@/lib/api-client';

interface Book {
  id: string;
  title: string;
  pages_count?: number;
}

interface ExperimentConfig {
  bookId: string;
  startPage: number;
  endPage: number;
  conditions: {
    id: string;
    batchSize: number;
    promptType: 'simple' | 'elaborate';
    label: string;
  }[];
}

interface ExperimentStatus {
  phase: 'setup' | 'running' | 'judging' | 'results';
  conditionsRun: string[];
  judgmentsComplete: number;
  totalJudgments: number;
}

interface ConditionProgress {
  status: 'running' | 'complete';
  processed: number;
  total: number;
  started_at?: string;
  completed_at?: string;
  last_update?: string;
}

const CONDITIONS = [
  { id: 'b1_simple', batchSize: 1, promptType: 'simple' as const, label: 'Batch 1 + Simple' },
  { id: 'b1_elaborate', batchSize: 1, promptType: 'elaborate' as const, label: 'Batch 1 + Elaborate' },
  { id: 'b5_simple', batchSize: 5, promptType: 'simple' as const, label: 'Batch 5 + Simple' },
  { id: 'b5_elaborate', batchSize: 5, promptType: 'elaborate' as const, label: 'Batch 5 + Elaborate' },
  { id: 'b10_simple', batchSize: 10, promptType: 'simple' as const, label: 'Batch 10 + Simple' },
  { id: 'b10_elaborate', batchSize: 10, promptType: 'elaborate' as const, label: 'Batch 10 + Elaborate' },
  { id: 'b20_simple', batchSize: 20, promptType: 'simple' as const, label: 'Batch 20 + Simple' },
  { id: 'b20_elaborate', batchSize: 20, promptType: 'elaborate' as const, label: 'Batch 20 + Elaborate' },
];

// Key comparisons (7 per page)
const COMPARISONS = [
  { a: 'b1_simple', b: 'b5_simple', question: 'Batch 1 vs 5 (Simple prompt)' },
  { a: 'b5_simple', b: 'b10_simple', question: 'Batch 5 vs 10 (Simple prompt)' },
  { a: 'b10_simple', b: 'b20_simple', question: 'Batch 10 vs 20 (Simple prompt)' },
  { a: 'b1_elaborate', b: 'b5_elaborate', question: 'Batch 1 vs 5 (Elaborate prompt)' },
  { a: 'b5_elaborate', b: 'b10_elaborate', question: 'Batch 5 vs 10 (Elaborate prompt)' },
  { a: 'b10_elaborate', b: 'b20_elaborate', question: 'Batch 10 vs 20 (Elaborate prompt)' },
  { a: 'b5_simple', b: 'b5_elaborate', question: 'Simple vs Elaborate (Batch 5)' },
];

export default function OCRQualityExperimentPage() {
  const [booksList, setBooksList] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ExperimentConfig>({
    bookId: '',
    startPage: 10,
    endPage: 40,
    conditions: CONDITIONS,
  });
  const [status, setStatus] = useState<ExperimentStatus>({
    phase: 'setup',
    conditionsRun: [],
    judgmentsComplete: 0,
    totalJudgments: 0,
  });
  const [runningCondition, setRunningCondition] = useState<string | null>(null);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [conditionResults, setConditionResults] = useState<Record<string, { success: boolean; pages?: number; error?: string }>>({});
  const [conditionProgress, setConditionProgress] = useState<Record<string, ConditionProgress>>({});
  const [judging, setJudging] = useState(false);
  const [judgingProgress, setJudgingProgress] = useState<{ processed: number; total: number } | null>(null);

  useEffect(() => {
    fetchBooks();
  }, []);

  // Poll for progress while running or judging
  useEffect(() => {
    if (!experimentId || (!runningCondition && !judging)) return;

    const pollProgress = async () => {
      try {
        const data = await ocrQualityExperiments.get(experimentId);
        if (data.progress) {
          setConditionProgress(data.progress as any);
        }
        if (data.judging_progress) {
          setJudgingProgress({
            processed: data.judging_progress.judged || 0,
            total: data.judging_progress.total || 0,
          });
        }
      } catch (error) {
        console.error('Error polling progress:', error);
      }
    };

    // Poll every 2 seconds
    const interval = setInterval(pollProgress, 2000);
    pollProgress(); // Initial poll

    return () => clearInterval(interval);
  }, [experimentId, runningCondition, judging]);

  const fetchBooks = async () => {
    try {
      const data = await books.list();
      setBooksList(Array.isArray(data) ? data : data.books || []);
    } catch (error) {
      console.error('Error fetching books:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedBook = booksList.find(b => b.id === config.bookId);
  const pageCount = config.endPage - config.startPage + 1;
  const totalJudgments = pageCount * COMPARISONS.length;
  const estimatedRunTime = (pageCount * CONDITIONS.length * 3) / 60; // ~3 sec per page per condition
  const estimatedJudgeTime = totalJudgments * 0.15; // ~9 sec per judgment

  const [error, setError] = useState<string | null>(null);

  const createExperiment = async () => {
    setError(null);
    try {
      const data = await ocrQualityExperiments.create({
        book_id: config.bookId,
        start_page: config.startPage,
        page_count: config.endPage - config.startPage + 1,
        models: CONDITIONS.map(c => `batch_${c.batchSize}`),
        prompts: CONDITIONS.map(c => c.promptType),
      } as any);

      console.log('Experiment created:', data);
      setExperimentId(data.experiment_id || (data as any).id);
      setStatus(prev => ({ ...prev, phase: 'running', totalJudgments }));

      // Auto-run all conditions sequentially
      runAllConditions(data.experiment_id || (data as any).id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Error: ${msg}`);
      console.error('Error creating experiment:', err);
    }
  };

  const runAllConditions = async (expId: string) => {
    for (const condition of CONDITIONS) {
      setRunningCondition(condition.id);

      try {
        const data = await ocrQualityExperiments.run(expId);

        setConditionResults(prev => ({
          ...prev,
          [condition.id]: { success: data.success, pages: (data as any).pages_processed || 0 },
        }));
        setStatus(prev => ({
          ...prev,
          conditionsRun: [...prev.conditionsRun, condition.id],
        }));
      } catch (error) {
        setConditionResults(prev => ({
          ...prev,
          [condition.id]: { success: false, error: error instanceof Error ? error.message : 'Network error' },
        }));
        console.error('Error running condition:', condition.id, error);
      }
    }

    setRunningCondition(null);
  };

  const runCondition = async (conditionId: string) => {
    if (!experimentId) return;
    setRunningCondition(conditionId);

    try {
      await ocrQualityExperiments.run(experimentId);
      setStatus(prev => ({
        ...prev,
        conditionsRun: [...prev.conditionsRun, conditionId],
      }));
    } catch (error) {
      console.error('Error running condition:', error);
    } finally {
      setRunningCondition(null);
    }
  };

  const allConditionsRun = status.conditionsRun.length === CONDITIONS.length;

  const runAutoJudge = async () => {
    if (!experimentId) return;
    setJudging(true);
    setJudgingProgress({ processed: 0, total: totalJudgments });

    try {
      const data = await ocrQualityExperiments.autoJudge(experimentId);

      console.log('Auto-judge complete:', data);
      if ((data as any).is_complete || data.success) {
        setStatus(prev => ({ ...prev, phase: 'results' }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Auto-judge error: ${msg}`);
      console.error('Auto-judge error:', err);
    } finally {
      setJudging(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/experiments"
            className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
              <FlaskConical className="w-6 h-6 text-purple-600" />
              OCR Quality Experiment
            </h1>
            <p className="text-stone-500 text-sm">
              Compare batch sizes and prompt complexity
            </p>
          </div>
        </div>

        {/* Motivation */}
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border border-purple-200 p-6 mb-6">
          <h2 className="font-semibold text-purple-900 mb-3">Why This Experiment?</h2>

          <div className="space-y-3 text-sm text-purple-900">
            <p>
              <strong>The problem:</strong> We want high-quality OCR while minimizing API costs and time.
              Batching multiple pages per request is faster and cheaper, but does it hurt accuracy?
            </p>

            <div className="bg-white/60 rounded-lg p-3">
              <p className="font-medium mb-2">Competing theories:</p>
              <ul className="space-y-1 text-purple-800">
                <li>
                  <strong>"Lost in the Middle"</strong> (Liu et al., 2023): LLMs attend well to the
                  beginning and end of context, but information in the middle gets less attention.
                  Larger batches → middle pages may degrade.
                </li>
                <li>
                  <strong>Context helps continuity:</strong> Historical texts have words spanning page
                  breaks, consistent terminology, and unusual letterforms. Seeing multiple pages
                  together might improve consistency.
                </li>
                <li>
                  <strong>Prompt specificity:</strong> Detailed prompts with rules for abbreviations,
                  letterforms, and structure might improve accuracy—or might confuse the model.
                </li>
              </ul>
            </div>

            <p>
              <strong>The tension:</strong> Efficiency (large batches, simple prompts) vs. Quality
              (small batches, detailed prompts). This experiment finds the sweet spot.
            </p>
          </div>
        </div>

        {/* Experiment Design Summary */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <h2 className="font-semibold text-stone-900 mb-4">Experiment Design</h2>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium text-stone-700 mb-2">Variables</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-24 text-stone-500">Batch size:</span>
                  <span className="font-mono">1, 5, 10, 20</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 text-stone-500">Prompt:</span>
                  <span>Simple vs Elaborate</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 text-stone-500">Conditions:</span>
                  <span className="font-medium">8 total</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-stone-700 mb-2">Key Comparisons</h3>
              <ul className="text-sm text-stone-600 space-y-1">
                <li>• Batch 1→5→10→20 (both prompts)</li>
                <li>• Simple vs Elaborate (at batch 5)</li>
                <li>• 7 comparisons per page</li>
              </ul>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-2">Statistical Power</h3>
            <p className="text-sm text-blue-800">
              With <strong>30 pages</strong> (210 judgments), you can reliably detect a <strong>65/35 preference split</strong> between methods (α=0.05, power=0.80).
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Smaller samples can detect larger differences (70/30), but may miss subtle quality differences.
            </p>
          </div>
        </div>

        {/* Setup Phase */}
        {status.phase === 'setup' && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <h2 className="font-semibold text-stone-900 mb-4">1. Setup</h2>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Book</label>
                <select
                  value={config.bookId}
                  onChange={e => setConfig(prev => ({ ...prev, bookId: e.target.value }))}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                >
                  <option value="">Select a book...</option>
                  {booksList.map(book => (
                    <option key={book.id} value={book.id}>
                      {book.title} ({book.pages_count || '?'} pages)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Start page</label>
                  <input
                    type="number"
                    value={config.startPage}
                    onChange={e => setConfig(prev => ({ ...prev, startPage: parseInt(e.target.value) || 1 }))}
                    min={1}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">End page</label>
                  <input
                    type="number"
                    value={config.endPage}
                    onChange={e => setConfig(prev => ({ ...prev, endPage: parseInt(e.target.value) || 40 }))}
                    min={config.startPage}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg"
                  />
                </div>
              </div>
            </div>

            {config.bookId && (
              <div className="bg-stone-50 rounded-lg p-4 mb-4">
                <h3 className="text-sm font-medium text-stone-700 mb-2">Experiment Summary</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-stone-500">Pages:</span>
                    <span className="ml-2 font-medium">{pageCount}</span>
                  </div>
                  <div>
                    <span className="text-stone-500">OCR runs:</span>
                    <span className="ml-2 font-medium">{pageCount * 8}</span>
                  </div>
                  <div>
                    <span className="text-stone-500">Judgments:</span>
                    <span className="ml-2 font-medium">{totalJudgments}</span>
                  </div>
                  <div>
                    <span className="text-stone-500">Est. run time:</span>
                    <span className="ml-2 font-medium">~{estimatedRunTime.toFixed(0)} min</span>
                  </div>
                  <div>
                    <span className="text-stone-500">Est. judge time:</span>
                    <span className="ml-2 font-medium">~{estimatedJudgeTime.toFixed(0)} min</span>
                  </div>
                  <div>
                    <span className="text-stone-500">Est. cost:</span>
                    <span className="ml-2 font-medium">~${(pageCount * 8 * 0.002).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={createExperiment}
              disabled={!config.bookId || pageCount < 10}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              Start Experiment
            </button>

            {pageCount < 10 && config.bookId && (
              <p className="text-sm text-amber-600 mt-2">
                <AlertCircle className="w-4 h-4 inline mr-1" />
                Minimum 10 pages recommended for statistical validity
              </p>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Running Phase */}
        {status.phase === 'running' && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-stone-900">2. Running OCR Conditions</h2>
              <span className="text-sm text-stone-500">
                {status.conditionsRun.length} / {CONDITIONS.length} complete
              </span>
            </div>

            {/* Overall progress bar */}
            <div className="mb-6">
              <div className="h-3 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-600 transition-all duration-500"
                  style={{ width: `${(status.conditionsRun.length / CONDITIONS.length) * 100}%` }}
                />
              </div>
              {runningCondition && (
                <div className="mt-2">
                  <p className="text-sm text-purple-600 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Running: {CONDITIONS.find(c => c.id === runningCondition)?.label}
                    {conditionProgress[runningCondition] && (
                      <span className="font-mono">
                        ({conditionProgress[runningCondition].processed}/{conditionProgress[runningCondition].total} pages)
                      </span>
                    )}
                  </p>
                  {conditionProgress[runningCondition] && conditionProgress[runningCondition].total > 0 && (
                    <div className="mt-1 h-1.5 bg-purple-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all duration-300"
                        style={{
                          width: `${(conditionProgress[runningCondition].processed / conditionProgress[runningCondition].total) * 100}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {CONDITIONS.map(condition => {
                const isRun = status.conditionsRun.includes(condition.id);
                const isRunning = runningCondition === condition.id;
                const result = conditionResults[condition.id];
                const hasFailed = result && !result.success;
                const progress = conditionProgress[condition.id];

                return (
                  <div
                    key={condition.id}
                    className={`p-2 rounded-lg border text-center ${
                      hasFailed
                        ? 'bg-red-50 border-red-200'
                        : isRun
                          ? 'bg-green-50 border-green-200'
                          : isRunning
                            ? 'bg-purple-50 border-purple-300'
                            : 'bg-stone-50 border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1 mb-1">
                      {hasFailed ? (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      ) : isRun ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : isRunning ? (
                        <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-stone-300" />
                      )}
                    </div>
                    <p className="text-xs font-medium text-stone-700">
                      B{condition.batchSize}
                    </p>
                    <p className="text-[10px] text-stone-500">
                      {condition.promptType}
                    </p>
                    {isRunning && progress && (
                      <p className="text-[10px] mt-1 text-purple-600 font-mono">
                        {progress.processed}/{progress.total}
                      </p>
                    )}
                    {result && !isRunning && (
                      <p className={`text-[10px] mt-1 ${hasFailed ? 'text-red-600' : 'text-green-600'}`}>
                        {hasFailed ? 'Error' : `${result.pages} pages`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Error log */}
            {Object.entries(conditionResults).some(([, r]) => !r.success) && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-800 mb-2">Errors:</p>
                {Object.entries(conditionResults)
                  .filter(([, r]) => !r.success)
                  .map(([id, r]) => (
                    <p key={id} className="text-xs text-red-700">
                      {CONDITIONS.find(c => c.id === id)?.label}: {r.error}
                    </p>
                  ))}
              </div>
            )}

            {allConditionsRun && !judging && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-900">All conditions complete!</span>
                </div>
                <p className="text-sm text-green-700 mb-3">
                  Ready for AI to judge quality by comparing OCR outputs against the original images.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={runAutoJudge}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    <FlaskConical className="w-4 h-4" />
                    Run AI Judging
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <Link
                    href={`/experiments/ocr-quality/${experimentId}/judge`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-stone-100 text-stone-700 rounded-lg hover:bg-stone-200"
                  >
                    <Eye className="w-4 h-4" />
                    Manual Judge
                  </Link>
                </div>
              </div>
            )}

            {judging && (
              <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                  <span className="font-semibold text-purple-900">AI Judging in Progress...</span>
                </div>
                <p className="text-sm text-purple-700 mb-3">
                  The AI is comparing each OCR output against the original manuscript images.
                </p>
                {judgingProgress && (
                  <div>
                    <div className="flex justify-between text-sm text-purple-600 mb-1">
                      <span>Comparisons judged</span>
                      <span className="font-mono">{judgingProgress.processed}/{judgingProgress.total}</span>
                    </div>
                    <div className="h-2 bg-purple-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-600 transition-all duration-300"
                        style={{ width: `${judgingProgress.total > 0 ? (judgingProgress.processed / judgingProgress.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Judging Phase */}
        {status.phase === 'judging' && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <h2 className="font-semibold text-stone-900 mb-4">3. Judge Quality</h2>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-stone-600">Progress</span>
                <span className="text-sm font-medium">
                  {status.judgmentsComplete} / {status.totalJudgments}
                </span>
              </div>
              <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${(status.judgmentsComplete / status.totalJudgments) * 100}%` }}
                />
              </div>
            </div>

            <Link
              href={`/experiments/ocr-quality/${experimentId}/judge`}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Eye className="w-5 h-5" />
              {status.judgmentsComplete > 0 ? 'Continue Judging' : 'Start Judging'}
            </Link>
          </div>
        )}

        {/* Results Phase */}
        {status.phase === 'results' && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
            <h2 className="font-semibold text-stone-900 mb-4">4. Results</h2>

            <Link
              href={`/experiments/ocr-quality/${experimentId}/results`}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <BarChart3 className="w-5 h-5" />
              View Results
            </Link>
          </div>
        )}

        {/* Analysis Plan */}
        <div className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="font-semibold text-stone-900 mb-4">Analysis Plan</h2>

          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-medium text-stone-700 mb-1">Primary Analysis</h3>
              <p className="text-stone-600">
                Win rates for each pairwise comparison with 95% confidence intervals (binomial).
              </p>
            </div>

            <div>
              <h3 className="font-medium text-stone-700 mb-1">Key Questions</h3>
              <ul className="text-stone-600 space-y-1">
                <li>1. Does batching (5+) improve or hurt quality vs single-page?</li>
                <li>2. At what batch size does quality degrade?</li>
                <li>3. Does the elaborate prompt outperform the simple one?</li>
                <li>4. Is there an interaction (does prompt matter more at larger batches)?</li>
              </ul>
            </div>

            <div>
              <h3 className="font-medium text-stone-700 mb-1">Output</h3>
              <ul className="text-stone-600 space-y-1">
                <li>• Win rate table with significance indicators</li>
                <li>• Recommended configuration</li>
                <li>• Sample problematic pages for review</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
