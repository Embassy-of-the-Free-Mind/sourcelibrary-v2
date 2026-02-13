'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ocrQualityExperiments } from '@/lib/api-client';
import NotesRenderer from '@/components/reader/NotesRenderer';

interface Comparison {
  page_id: string;
  page_number: number;
  image_url: string;
  condition_a: string;
  condition_b: string;
  ocr_a: string;
  ocr_b: string;
  comparison_type: string;
  left_is_a: boolean;
}

interface JudgmentStats {
  total: number;
  completed: number;
  remaining: number;
}

export default function JudgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [stats, setStats] = useState<JudgmentStats>({ total: 0, completed: 0, remaining: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [showImage, setShowImage] = useState(true);
  const [renderOcr, setRenderOcr] = useState(true);
  const [reasoning, setReasoning] = useState('');

  const fetchNextComparison = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ocrQualityExperiments.getNextJudgment(id);
      if (data.comparison) {
        setComparison(data.comparison);
        setStats(data.stats);
      } else {
        router.push(`/experiments/ocr-quality/${id}/results`);
      }
    } catch (error) {
      console.error('Error fetching comparison:', error);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchNextComparison();
  }, [fetchNextComparison]);

  const submitJudgment = async (winner: 'left' | 'right' | 'tie') => {
    if (!comparison) return;
    setSubmitting(true);

    let actualWinner: 'a' | 'b' | 'tie';
    if (winner === 'tie') {
      actualWinner = 'tie';
    } else if (winner === 'left') {
      actualWinner = comparison.left_is_a ? 'a' : 'b';
    } else {
      actualWinner = comparison.left_is_a ? 'b' : 'a';
    }

    try {
      await ocrQualityExperiments.submitJudgment(id, {
        page_id: comparison.page_id,
        condition_a: comparison.condition_a,
        condition_b: comparison.condition_b,
        comparison_type: comparison.comparison_type,
        winner: actualWinner,
        ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
      });
      setReasoning('');
      fetchNextComparison();
    } catch (error) {
      console.error('Error submitting judgment:', error);
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (submitting || loading) return;
      // Don't capture shortcuts when typing in the notes field
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === '1' || e.key === 'a') submitJudgment('left');
      if (e.key === '2' || e.key === 'b') submitJudgment('right');
      if (e.key === '3' || e.key === 't') submitJudgment('tie');
      if (e.key === 'i') setShowImage(prev => !prev);
      if (e.key === 'r') setRenderOcr(prev => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting, loading, comparison]);

  if (loading && !comparison) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg text-muted">Loading comparison...</p>
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl text-primary mb-2">All Done!</p>
          <p className="text-lg text-secondary mb-4">You've completed all judgments.</p>
          <Link
            href={`/experiments/ocr-quality/${id}/results`}
            className="btn-primary"
          >
            View Results
          </Link>
        </div>
      </div>
    );
  }

  const leftOcr = comparison.left_is_a ? comparison.ocr_a : comparison.ocr_b;
  const rightOcr = comparison.left_is_a ? comparison.ocr_b : comparison.ocr_a;
  const progress = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0;

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
              <h1 className="text-lg font-semibold text-primary">OCR Quality Judging</h1>
              <p className="text-base text-muted">
                Page {comparison.page_number} &middot; {comparison.comparison_type}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowImage(prev => !prev)}
              className={`px-3 py-1.5 rounded-lg text-base transition-colors ${
                showImage
                  ? 'bg-accent-violet/10 text-accent-violet'
                  : 'bg-warm text-muted'
              }`}
              title="Toggle image (i)"
            >
              Image
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
              <span className="font-medium text-primary">{stats.completed}</span>
              <span className="text-muted"> / {stats.total}</span>
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

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-4">
        <div className={`grid gap-4 ${showImage ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {/* Original image */}
          {showImage && (
            <div className="card p-2">
              <div className="text-base font-medium text-muted mb-2 text-center">Original</div>
              <div className="aspect-[3/4] bg-warm rounded-lg overflow-hidden">
                <img
                  src={comparison.image_url}
                  alt={`Page ${comparison.page_number}`}
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}

          {/* Left OCR */}
          <div className="card overflow-hidden">
            <div className="bg-blue-50 px-4 py-2.5 border-b border-blue-100">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-blue-900">Left</span>
                <span className="text-sm text-blue-600 font-mono">Press 1 or A</span>
              </div>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto">
              {leftOcr ? (
                renderOcr ? (
                  <NotesRenderer text={leftOcr} showMetadata={false} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-mono text-primary leading-relaxed">{leftOcr}</pre>
                )
              ) : (
                <p className="text-muted italic">(empty)</p>
              )}
            </div>
          </div>

          {/* Right OCR */}
          <div className="card overflow-hidden">
            <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-100">
              <div className="flex items-center justify-between">
                <span className="text-base font-semibold text-amber-900">Right</span>
                <span className="text-sm text-amber-600 font-mono">Press 2 or B</span>
              </div>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto">
              {rightOcr ? (
                renderOcr ? (
                  <NotesRenderer text={rightOcr} showMetadata={false} />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-mono text-primary leading-relaxed">{rightOcr}</pre>
                )
              ) : (
                <p className="text-muted italic">(empty)</p>
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="max-w-2xl mx-auto mt-5">
          <textarea
            value={reasoning}
            onChange={e => setReasoning(e.target.value)}
            placeholder="Notes on your judgment (optional) — what made one better?"
            rows={2}
            className="w-full px-3 py-2.5 text-base border border-border-medium rounded-lg bg-white resize-y leading-relaxed placeholder:text-muted"
          />
        </div>

        {/* Judgment buttons */}
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            onClick={() => submitJudgment('left')}
            disabled={submitting}
            className="flex-1 max-w-[200px] py-4 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 text-lg"
          >
            Left Wins
          </button>
          <button
            onClick={() => submitJudgment('tie')}
            disabled={submitting}
            className="py-4 px-8 bg-warm text-secondary rounded-xl font-semibold hover:bg-border-light disabled:opacity-50 text-base"
          >
            Tie (3)
          </button>
          <button
            onClick={() => submitJudgment('right')}
            disabled={submitting}
            className="flex-1 max-w-[200px] py-4 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 disabled:opacity-50 text-lg"
          >
            Right Wins
          </button>
        </div>

        <p className="text-center text-base text-muted mt-3">
          Keyboard: <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm">1/A</kbd> Left &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">2/B</kbd> Right &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">3/T</kbd> Tie &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">I</kbd> Toggle image &middot;
          <kbd className="px-1.5 py-0.5 bg-warm rounded text-sm ml-2">R</kbd> Toggle rendering
        </p>
      </div>
    </div>
  );
}
