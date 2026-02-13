'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import NotesRenderer from '@/components/reader/NotesRenderer';

interface PageResult {
  page_id: string;
  page_number: number;
  condition_id: string;
  ocr: string;
  success: boolean;
  image_url: string;
  book_id: string;
}

interface Condition {
  id: string;
  label: string;
  promptType: string;
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [results, setResults] = useState<PageResult[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [resolvedPrompts, setResolvedPrompts] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [renderOcr, setRenderOcr] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchResults() {
      try {
        const res = await fetch(`/api/experiments/ocr-quality/${id}?include=review`);
        const data = await res.json();

        if (!data.review_results?.length) {
          setError('No OCR results to review yet');
          setLoading(false);
          return;
        }

        // Sort by page number
        const sorted = [...data.review_results].sort(
          (a: PageResult, b: PageResult) => a.page_number - b.page_number
        );
        setResults(sorted);
        setConditions(data.conditions || []);
        setResolvedPrompts(data.resolved_prompts || {});
      } catch (err) {
        console.error('Error loading review data:', err);
        setError('Failed to load experiment data');
      } finally {
        setLoading(false);
      }
    }

    fetchResults();
  }, [id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'ArrowLeft' || e.key === 'k') {
        setCurrentIndex(prev => Math.max(0, prev - 1));
      }
      if (e.key === 'ArrowRight' || e.key === 'j') {
        setCurrentIndex(prev => Math.min(results.length - 1, prev + 1));
      }
      if (e.key === 'r') {
        setRenderOcr(prev => !prev);
      }
      if (e.key === 'p') {
        setShowPrompt(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [results.length]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-muted">Loading results...</p>
      </div>
    );
  }

  if (error || results.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-muted mb-4">{error || 'No results to review'}</p>
          <Link href="/experiments/ocr-quality" className="btn-primary">
            Back to Experiments
          </Link>
        </div>
      </div>
    );
  }

  const current = results[currentIndex];
  const progress = ((currentIndex + 1) / results.length) * 100;

  return (
    <div className="min-h-screen bg-warm">
      {/* Header */}
      <div className="bg-white border-b border-border-light px-4 py-3 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/experiments/ocr-quality"
              className="text-base text-muted hover:text-secondary transition-colors"
            >
              &larr;
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-primary">OCR Quality Review</h1>
              <p className="text-base text-muted">
                Page {current.page_number} &middot; {current.condition_id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowPrompt(prev => !prev)}
              className={`px-3 py-1.5 rounded-lg text-base transition-colors ${
                showPrompt
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-warm text-muted hover:text-secondary'
              }`}
              title="Toggle prompt view (p)"
            >
              Prompt
            </button>
            <button
              onClick={() => setRenderOcr(prev => !prev)}
              className={`px-3 py-1.5 rounded-lg text-base transition-colors ${
                renderOcr
                  ? 'bg-accent-violet/10 text-accent-violet'
                  : 'bg-warm text-muted'
              }`}
              title="Toggle rendering (r)"
            >
              {renderOcr ? 'Rendered' : 'Raw'}
            </button>
            <div className="text-base">
              <span className="font-medium text-primary">{currentIndex + 1}</span>
              <span className="text-muted"> / {results.length}</span>
            </div>
            <div className="w-32 h-2 bg-warm rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-violet transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Prompt panel */}
      {showPrompt && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto p-4">
            <div className="flex items-start gap-4">
              {conditions.length > 1 ? (
                conditions.map(cond => (
                  <div key={cond.id} className="flex-1">
                    <h3 className="text-sm font-semibold text-amber-900 mb-2">
                      {cond.label}
                      <span className="ml-2 font-normal text-amber-700">({cond.promptType})</span>
                    </h3>
                    <pre className="text-xs font-mono text-amber-900/80 whitespace-pre-wrap bg-white/60 rounded-lg p-3 max-h-[50vh] overflow-auto border border-amber-200">
                      {resolvedPrompts[cond.id] || '(prompt not available)'}
                    </pre>
                  </div>
                ))
              ) : (
                <div className="w-full">
                  <h3 className="text-sm font-semibold text-amber-900 mb-2">
                    {conditions[0]?.label || 'Prompt'}
                  </h3>
                  <pre className="text-xs font-mono text-amber-900/80 whitespace-pre-wrap bg-white/60 rounded-lg p-3 max-h-[50vh] overflow-auto border border-amber-200">
                    {resolvedPrompts[conditions[0]?.id] || '(prompt not available)'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Original image */}
          <div className="card p-2">
            <div className="text-base font-medium text-muted mb-2 text-center">Original</div>
            <div className="bg-warm rounded-lg overflow-hidden">
              {current.image_url ? (
                <img
                  src={current.image_url}
                  alt={`Page ${current.page_number}`}
                  className="w-full h-auto object-contain"
                />
              ) : (
                <div className="aspect-[3/4] flex items-center justify-center">
                  <p className="text-muted italic">No image available</p>
                </div>
              )}
            </div>
          </div>

          {/* OCR output */}
          <div className="card overflow-hidden">
            <div className="bg-blue-50 px-4 py-2.5 border-b border-blue-100">
              <span className="text-base font-semibold text-blue-900">OCR Output</span>
              {!current.success && (
                <span className="ml-2 text-sm text-red-600">(failed)</span>
              )}
            </div>
            <div className="p-4 max-h-[85vh] overflow-auto">
              {current.ocr ? (
                renderOcr ? (
                  <NotesRenderer text={current.ocr} showMetadata={false} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-mono text-primary leading-relaxed">{current.ocr}</pre>
                )
              ) : (
                <p className="text-muted italic">(empty)</p>
              )}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
            className="py-3 px-8 bg-white border border-border-medium text-secondary rounded-xl font-semibold hover:bg-warm disabled:opacity-30 text-base"
          >
            Previous
          </button>
          <button
            onClick={() => setCurrentIndex(prev => Math.min(results.length - 1, prev + 1))}
            disabled={currentIndex === results.length - 1}
            className="py-3 px-8 bg-accent-violet text-white rounded-xl font-semibold hover:bg-accent-violet/90 disabled:opacity-30 text-base"
          >
            Next
          </button>
        </div>

        <p className="text-center text-base text-muted mt-3">
          Keyboard: <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm">&larr;/K</kbd> Previous &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">&rarr;/J</kbd> Next &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">R</kbd> Toggle rendering &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">P</kbd> Show prompt
        </p>
      </div>
    </div>
  );
}
