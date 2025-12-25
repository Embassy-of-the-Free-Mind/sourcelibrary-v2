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
  Square,
  CheckSquare,
} from 'lucide-react';

interface Experiment {
  id: string;
  name: string;
  description: string;
  book_id: string;
  method: string;
  settings: {
    model: string;
    use_context?: boolean;
  };
  status: string;
}

interface Page {
  id: string;
  page_number: number;
  photo: string;
  thumbnail?: string;
  ocr?: { data?: string };
  translation?: { data?: string };
}

export default function RunExperimentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, failed: 0, total: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch experiment
        const expRes = await fetch(`/api/experiments/${id}`);
        if (!expRes.ok) {
          router.push('/experiments');
          return;
        }
        const expData = await expRes.json();
        setExperiment(expData.experiment);

        // Fetch book pages
        const bookRes = await fetch(`/api/books/${expData.experiment.book_id}`);
        if (bookRes.ok) {
          const bookData = await bookRes.json();
          setPages(bookData.book.pages || []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, router]);

  const togglePage = (pageId: string) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedPages(new Set(pages.map(p => p.id)));
  const clearSelection = () => setSelectedPages(new Set());

  const selectFirst10 = () => {
    const first10 = pages.slice(0, 10).map(p => p.id);
    setSelectedPages(new Set(first10));
  };

  const selectSample = () => {
    // Select every 10th page for a representative sample
    const sample = pages.filter((_, i) => i % 10 === 0).map(p => p.id);
    setSelectedPages(new Set(sample));
  };

  const runExperiment = async () => {
    if (selectedPages.size === 0) return;

    setRunning(true);
    setProgress({ completed: 0, failed: 0, total: selectedPages.size });

    try {
      const res = await fetch(`/api/experiments/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_ids: Array.from(selectedPages) }),
      });

      if (res.ok) {
        const data = await res.json();
        setProgress({
          completed: data.results_count,
          failed: data.failed_count,
          total: selectedPages.size,
        });
      }
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

  const isComplete = progress.completed + progress.failed === progress.total && progress.total > 0;

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/experiments"
            className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-stone-900">Run Experiment</h1>
            <p className="text-stone-500 text-sm">{experiment.name}</p>
          </div>
        </div>

        {/* Experiment info */}
        <div className="bg-white rounded-xl border border-stone-200 p-4 mb-6">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-stone-500">Method:</span>
              <span className="ml-2 font-medium text-stone-900">{experiment.method}</span>
            </div>
            <div>
              <span className="text-stone-500">Model:</span>
              <span className="ml-2 font-medium text-stone-900">{experiment.settings.model}</span>
            </div>
            <div>
              <span className="text-stone-500">Context:</span>
              <span className="ml-2 font-medium text-stone-900">
                {experiment.settings.use_context ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
          {experiment.description && (
            <p className="text-sm text-stone-500 mt-2">{experiment.description}</p>
          )}
        </div>

        {/* Progress */}
        {(running || isComplete) && (
          <div
            className={`rounded-xl border p-4 mb-6 ${isComplete ? (progress.failed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200') : 'bg-blue-50 border-blue-200'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {running ? (
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                ) : progress.failed > 0 ? (
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                )}
                <span className="font-medium">
                  {running
                    ? 'Processing...'
                    : progress.failed > 0
                      ? `Completed with ${progress.failed} failures`
                      : 'Completed successfully'}
                </span>
              </div>
              <span className="text-sm text-stone-500">
                {progress.completed} / {progress.total} pages
              </span>
            </div>
            <div className="h-2 bg-white rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${progress.failed > 0 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{
                  width: `${((progress.completed + progress.failed) / progress.total) * 100}%`,
                }}
              />
            </div>
            {isComplete && (
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/experiments/${id}`}
                  className="px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-sm hover:bg-stone-50"
                >
                  View Results
                </Link>
                <Link
                  href="/experiments"
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
                >
                  Back to Experiments
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Page selection */}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-stone-900">Select Pages</h2>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={selectFirst10}
                className="px-2 py-1 text-stone-600 hover:bg-stone-100 rounded"
              >
                First 10
              </button>
              <button
                onClick={selectSample}
                className="px-2 py-1 text-stone-600 hover:bg-stone-100 rounded"
              >
                Sample (10%)
              </button>
              <button
                onClick={selectAll}
                className="px-2 py-1 text-stone-600 hover:bg-stone-100 rounded"
              >
                All
              </button>
              {selectedPages.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="px-2 py-1 text-red-600 hover:bg-red-50 rounded"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-10 gap-2 max-h-[400px] overflow-auto">
            {pages.map(page => {
              const isSelected = selectedPages.has(page.id);
              return (
                <button
                  key={page.id}
                  onClick={() => togglePage(page.id)}
                  disabled={running}
                  className={`relative aspect-[3/4] rounded-lg border-2 overflow-hidden transition-all ${
                    isSelected
                      ? 'border-purple-500 shadow-md'
                      : 'border-stone-200 hover:border-stone-300'
                  } ${running ? 'opacity-50' : ''}`}
                >
                  {page.thumbnail && (
                    <img
                      src={page.thumbnail}
                      alt={`Page ${page.page_number}`}
                      className="w-full h-full object-cover"
                    />
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 bg-purple-500/20 flex items-center justify-center">
                      <CheckSquare className="w-5 h-5 text-purple-600" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5">
                    {page.page_number}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-stone-200">
            <span className="text-sm text-stone-500">
              {selectedPages.size} pages selected
            </span>
            <button
              onClick={runExperiment}
              disabled={selectedPages.size === 0 || running}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
            >
              {running ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Run Experiment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
