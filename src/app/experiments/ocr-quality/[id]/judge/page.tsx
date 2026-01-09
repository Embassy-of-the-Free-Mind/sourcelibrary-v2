'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  SkipForward,
  Image as ImageIcon,
} from 'lucide-react';
import { ocrQualityExperiments } from '@/lib/api-client';

interface Comparison {
  page_id: string;
  page_number: number;
  image_url: string;
  condition_a: string;
  condition_b: string;
  ocr_a: string;
  ocr_b: string;
  comparison_type: string;
  // Randomized for blind judging
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

  const fetchNextComparison = useCallback(async () => {
    setLoading(true);
    try {
      // Note: This needs a specific method in ocrQualityExperiments for getting next comparison
      const data = await ocrQualityExperiments.get(id);
      if (data.comparison) {
        setComparison(data.comparison as any);
        if (data.stats) {
          setStats(data.stats as any);
        }
      } else {
        // All done!
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

    // Translate back from left/right to a/b
    let actualWinner: 'a' | 'b' | 'tie';
    if (winner === 'tie') {
      actualWinner = 'tie';
    } else if (winner === 'left') {
      actualWinner = comparison.left_is_a ? 'a' : 'b';
    } else {
      actualWinner = comparison.left_is_a ? 'b' : 'a';
    }

    try {
      // Note: Need to add submitJudgment method to ocrQualityExperiments
      await ocrQualityExperiments.judge(id, [{
        page_id: comparison.page_id,
        model: comparison.condition_a,
        prompt: comparison.condition_b,
        score: actualWinner === 'a' ? 1 : actualWinner === 'b' ? 0 : 0.5,
        reasoning: comparison.comparison_type
      }]);

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
      if (e.key === '1' || e.key === 'a') submitJudgment('left');
      if (e.key === '2' || e.key === 'b') submitJudgment('right');
      if (e.key === '3' || e.key === 't') submitJudgment('tie');
      if (e.key === 'i') setShowImage(prev => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting, loading, comparison]);

  if (loading && !comparison) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-stone-900 mb-2">All Done!</h2>
          <p className="text-stone-600 mb-4">You've completed all judgments.</p>
          <Link
            href={`/experiments/ocr-quality/${id}/results`}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            View Results
          </Link>
        </div>
      </div>
    );
  }

  const leftOcr = comparison.left_is_a ? comparison.ocr_a : comparison.ocr_b;
  const rightOcr = comparison.left_is_a ? comparison.ocr_b : comparison.ocr_a;

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href={`/experiments/ocr-quality`}
              className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-semibold text-stone-900">OCR Quality Judging</h1>
              <p className="text-xs text-stone-500">
                Page {comparison.page_number} • {comparison.comparison_type}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowImage(prev => !prev)}
              className={`p-2 rounded-lg ${showImage ? 'bg-blue-100 text-blue-600' : 'bg-stone-100 text-stone-400'}`}
              title="Toggle image (i)"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <div className="text-sm">
              <span className="font-medium text-stone-900">{stats.completed}</span>
              <span className="text-stone-500"> / {stats.total}</span>
            </div>
            <div className="w-32 h-2 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-600 transition-all"
                style={{ width: `${(stats.completed / stats.total) * 100}%` }}
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
            <div className="bg-white rounded-xl border border-stone-200 p-2">
              <div className="text-xs font-medium text-stone-500 mb-2 text-center">Original</div>
              <div className="aspect-[3/4] bg-stone-100 rounded-lg overflow-hidden">
                <img
                  src={comparison.image_url}
                  alt={`Page ${comparison.page_number}`}
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}

          {/* Left OCR (could be A or B) */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="bg-blue-50 px-4 py-2 border-b border-blue-100">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-blue-900">Left</span>
                <span className="text-xs text-blue-600 font-mono">Press 1 or A</span>
              </div>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto">
              <pre className="text-sm text-stone-800 whitespace-pre-wrap font-serif leading-relaxed">
                {leftOcr || '(empty)'}
              </pre>
            </div>
          </div>

          {/* Right OCR */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="bg-amber-50 px-4 py-2 border-b border-amber-100">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-900">Right</span>
                <span className="text-xs text-amber-600 font-mono">Press 2 or B</span>
              </div>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto">
              <pre className="text-sm text-stone-800 whitespace-pre-wrap font-serif leading-relaxed">
                {rightOcr || '(empty)'}
              </pre>
            </div>
          </div>
        </div>

        {/* Judgment buttons */}
        <div className="flex items-center justify-center gap-4 mt-6">
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
            className="py-4 px-8 bg-stone-200 text-stone-700 rounded-xl font-semibold hover:bg-stone-300 disabled:opacity-50"
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

        <p className="text-center text-sm text-stone-500 mt-3">
          Keyboard: <kbd className="px-1.5 py-0.5 bg-stone-200 rounded text-xs">1/A</kbd> Left •
          <kbd className="px-1.5 py-0.5 bg-stone-200 rounded text-xs ml-2">2/B</kbd> Right •
          <kbd className="px-1.5 py-0.5 bg-stone-200 rounded text-xs ml-2">3/T</kbd> Tie •
          <kbd className="px-1.5 py-0.5 bg-stone-200 rounded text-xs ml-2">I</kbd> Toggle image
        </p>
      </div>
    </div>
  );
}
