'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { experiments, books } from '@/lib/api-client';
import type { Experiment, ExperimentRunResponse } from '@/lib/api-client/types/experiments';
import type { Book } from '@/lib/types';

const methodLabels: Record<string, string> = {
  single_ocr: 'Single-page OCR',
  batch_ocr: 'Batch OCR (5 pages)',
  single_translate: 'Single-page Translation',
  batch_translate: 'Batch Translation (5 pages)',
};

export default function RunExperimentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExperimentRunResponse | null>(null);

  // Helper to access experiment config fields
  const expConfig = experiment?.config as any;

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch experiment
        const exp = await experiments.get(id);
        if (!exp) {
          router.push('/experiments');
          return;
        }
        setExperiment(exp);

        // Fetch book
        const bookId = (exp.config as any)?.book_id || (exp.experiment as any)?.book_id;
        if (bookId) {
          const bookData = await books.get(bookId);
          setBook(bookData);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, router]);

  const runExperiment = async () => {
    setRunning(true);
    setResult(null);

    try {
      const data = await experiments.run(id);
      setResult(data);
    } catch (error) {
      console.error('Error running experiment:', error);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!experiment) {
    return null;
  }

  const estimatedPages =
    expConfig?.page_selection === 'all'
      ? book?.pages_count || '?'
      : expConfig?.page_selection === 'first_n'
        ? expConfig?.page_count
        : `~${Math.ceil((book?.pages_count || 100) * (expConfig?.page_count / 100))}`;

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/experiments"
            className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-stone-900">Run A/B Experiment</h1>
            <p className="text-stone-500 text-sm">{experiment.name}</p>
          </div>
        </div>

        {/* Book info */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 mb-6">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-stone-400" />
            <div>
              <p className="font-medium text-stone-900">{book?.title || 'Loading...'}</p>
              <p className="text-sm text-stone-500">
                {expConfig?.page_selection === 'first_n' && `First ${expConfig?.page_count} pages`}
                {expConfig?.page_selection === 'sample' && `${expConfig?.page_count}% sample (~${estimatedPages} pages)`}
                {expConfig?.page_selection === 'all' && `All ${book?.pages_count || '?'} pages`}
              </p>
            </div>
          </div>
        </div>

        {/* A/B Variants */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Variant A */}
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">A</span>
              <span className="font-semibold text-blue-900">Variant A</span>
            </div>
            {expConfig?.variant_a ? (
              <div className="space-y-1 text-sm">
                <p className="text-blue-800">
                  <span className="text-blue-600">Method:</span>{' '}
                  {methodLabels[expConfig?.variant_a.method] || expConfig?.variant_a.method}
                </p>
                <p className="text-blue-800">
                  <span className="text-blue-600">Model:</span> {expConfig?.variant_a.model}
                </p>
                <p className="text-blue-800">
                  <span className="text-blue-600">Context:</span>{' '}
                  {expConfig?.variant_a.use_context ? 'Yes' : 'No'}
                </p>
              </div>
            ) : (
              <p className="text-blue-600 text-sm">Not configured</p>
            )}
          </div>

          {/* Variant B */}
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 bg-amber-600 text-white rounded-full flex items-center justify-center text-sm font-bold">B</span>
              <span className="font-semibold text-amber-900">Variant B</span>
            </div>
            {expConfig?.variant_b ? (
              <div className="space-y-1 text-sm">
                <p className="text-amber-800">
                  <span className="text-amber-600">Method:</span>{' '}
                  {methodLabels[expConfig?.variant_b.method] || expConfig?.variant_b.method}
                </p>
                <p className="text-amber-800">
                  <span className="text-amber-600">Model:</span> {expConfig?.variant_b.model}
                </p>
                <p className="text-amber-800">
                  <span className="text-amber-600">Context:</span>{' '}
                  {expConfig?.variant_b.use_context ? 'Yes' : 'No'}
                </p>
              </div>
            ) : (
              <p className="text-amber-600 text-sm">Not configured</p>
            )}
          </div>
        </div>

        {/* Result */}
        {result && (
          <div
            className={`rounded-xl border p-4 mb-6 ${
              result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600" />
              )}
              <span className="font-semibold">
                {result.success ? 'Experiment Complete' : 'Experiment Failed'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-stone-500">Pages processed:</span>
                <span className="ml-2 font-medium">{result.pages_processed}</span>
              </div>
              <div>
                <span className="text-stone-500">Results:</span>
                <span className="ml-2 font-medium">{result.results_count}</span>
              </div>
              <div>
                <span className="text-stone-500">Cost:</span>
                <span className="ml-2 font-medium">${(result.total_cost || 0).toFixed(4)}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/experiments/${id}`}
                className="px-4 py-2 bg-white border border-stone-300 rounded-lg text-sm hover:bg-stone-50"
              >
                View Results
              </Link>
              <Link
                href={`/experiments/compare?experiment=${id}`}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
              >
                Compare A vs B
              </Link>
            </div>
          </div>
        )}

        {/* Run button */}
        {!result && (
          <div className="bg-white rounded-xl border border-stone-200 p-6 text-center">
            <p className="text-stone-600 mb-4">
              This will process <strong>{estimatedPages} pages</strong> with both variants.
              <br />
              <span className="text-sm text-stone-500">
                Estimated cost: ~${((typeof estimatedPages === 'number' ? estimatedPages : 10) * 0.002).toFixed(3)} per variant
              </span>
            </p>
            <button
              onClick={runExperiment}
              disabled={running}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium mx-auto"
            >
              {running ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Running Experiment...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Run A/B Experiment
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
