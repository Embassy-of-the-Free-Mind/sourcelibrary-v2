'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Check,
  Equal,
  BarChart3,
} from 'lucide-react';
import { experiments, comparisons } from '@/lib/api-client';
import type { Experiment } from '@/lib/api-client/types/experiments';

interface ExperimentResult {
  page_id: string;
  page_number: number;
  ocr: string | null;
  translation: string | null;
}

interface Stats {
  ocr: { a_wins: number; b_wins: number; ties: number; total: number; a_win_rate: number; b_win_rate: number };
  translation: { a_wins: number; b_wins: number; ties: number; total: number; a_win_rate: number; b_win_rate: number };
  overall: { a_wins: number; b_wins: number; ties: number; total: number; a_win_rate: number; b_win_rate: number };
}

export default function ComparePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const expAId = searchParams.get('a');
  const expBId = searchParams.get('b');

  const [experimentsList, setExperimentsList] = useState<Experiment[]>([]);
  const [expA, setExpA] = useState<Experiment | null>(null);
  const [expB, setExpB] = useState<Experiment | null>(null);
  const [resultsA, setResultsA] = useState<ExperimentResult[]>([]);
  const [resultsB, setResultsB] = useState<ExperimentResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [field, setField] = useState<'ocr' | 'translation'>('ocr');
  const [stats, setStats] = useState<Stats | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch all experiments for selectors
  useEffect(() => {
    experiments.list()
      .then(data => setExperimentsList(data.experiments || []))
      .catch(console.error);
  }, []);

  // Fetch experiment A details and results
  useEffect(() => {
    if (!expAId) return;
    experiments.get(expAId)
      .then(exp => {
        setExpA(exp);
        setResultsA((exp.results as any) || []);
      })
      .catch(console.error);
  }, [expAId]);

  // Fetch experiment B details and results
  useEffect(() => {
    if (!expBId) return;
    experiments.get(expBId)
      .then(exp => {
        setExpB(exp);
        setResultsB((exp.results as any) || []);
      })
      .catch(console.error);
  }, [expBId]);

  // Fetch comparison stats
  const fetchStats = useCallback(() => {
    if (!expAId || !expBId) return;
    // Note: Need to update comparisons.stats to accept query params
    comparisons.stats()
      .then(data => setStats(data as any))
      .catch(console.error);
  }, [expAId, expBId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Find matching pages between experiments
  const matchedPages = resultsA
    .filter(a => resultsB.some(b => b.page_id === a.page_id))
    .map(a => ({
      page_id: a.page_id,
      page_number: a.page_number,
      a: a,
      b: resultsB.find(b => b.page_id === a.page_id)!,
    }))
    .sort((x, y) => x.page_number - y.page_number);

  const currentPage = matchedPages[currentIndex];

  const recordVote = async (winner: 'a' | 'b' | 'tie') => {
    if (!currentPage || !expAId || !expBId) return;

    setSaving(true);
    try {
      // Note: Need to update comparisons.create to match this signature
      await comparisons.create({
        type: field,
        models: [expAId, expBId],
        prompts: [],
        sample_ids: [currentPage.page_id]
      });

      fetchStats();

      // Auto-advance to next page
      if (currentIndex < matchedPages.length - 1) {
        setCurrentIndex(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error recording vote:', error);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex(prev => prev - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < matchedPages.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else if (e.key === '1' || e.key === 'a') {
        recordVote('a');
      } else if (e.key === '2' || e.key === 'b') {
        recordVote('b');
      } else if (e.key === '3' || e.key === 't') {
        recordVote('tie');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, matchedPages.length, field, expAId, expBId, currentPage]);

  const getContent = (result: ExperimentResult) => {
    return field === 'ocr' ? result.ocr : result.translation;
  };

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/experiments"
                className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <h1 className="text-lg font-semibold text-stone-900">A/B Comparison</h1>
            </div>

            {/* Field selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-500">Compare:</span>
              <div className="flex rounded-lg border border-stone-300 overflow-hidden">
                <button
                  onClick={() => setField('ocr')}
                  className={`px-3 py-1.5 text-sm ${
                    field === 'ocr' ? 'bg-blue-600 text-white' : 'bg-white text-stone-600'
                  }`}
                >
                  OCR
                </button>
                <button
                  onClick={() => setField('translation')}
                  className={`px-3 py-1.5 text-sm ${
                    field === 'translation' ? 'bg-blue-600 text-white' : 'bg-white text-stone-600'
                  }`}
                >
                  Translation
                </button>
              </div>
            </div>

            {/* Stats summary */}
            {stats && stats[field].total > 0 && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-blue-600 font-medium">
                  A: {stats[field].a_win_rate}%
                </span>
                <span className="text-stone-400">vs</span>
                <span className="text-purple-600 font-medium">
                  B: {stats[field].b_win_rate}%
                </span>
                <span className="text-stone-400">({stats[field].total} rated)</span>
              </div>
            )}
          </div>

          {/* Experiment selectors */}
          <div className="flex items-center gap-4 mt-3">
            <div className="flex-1">
              <label className="text-xs text-blue-600 font-medium mb-1 block">
                Experiment A
              </label>
              <select
                value={expAId || ''}
                onChange={e => {
                  const params = new URLSearchParams(searchParams);
                  params.set('a', e.target.value);
                  router.push(`/experiments/compare?${params.toString()}`);
                }}
                className="w-full px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-blue-50"
              >
                <option value="">Select experiment...</option>
                {experimentsList.map(exp => (
                  <option key={exp.id} value={exp.id}>
                    {exp.name} ({exp.config?.model || 'unknown'})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="text-xs text-purple-600 font-medium mb-1 block">
                Experiment B
              </label>
              <select
                value={expBId || ''}
                onChange={e => {
                  const params = new URLSearchParams(searchParams);
                  params.set('b', e.target.value);
                  router.push(`/experiments/compare?${params.toString()}`);
                }}
                className="w-full px-3 py-1.5 border border-purple-300 rounded-lg text-sm bg-purple-50"
              >
                <option value="">Select experiment...</option>
                {experimentsList.map(exp => (
                  <option key={exp.id} value={exp.id}>
                    {exp.name} ({exp.config?.model || 'unknown'})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      {matchedPages.length === 0 ? (
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-stone-600">No matching pages</h3>
            <p className="text-stone-400 text-sm mt-1">
              Select two experiments with overlapping pages to compare
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-sm disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>

            <span className="text-sm text-stone-500">
              Page {currentPage?.page_number} ({currentIndex + 1} of {matchedPages.length})
            </span>

            <button
              onClick={() => setCurrentIndex(prev => Math.min(matchedPages.length - 1, prev + 1))}
              disabled={currentIndex === matchedPages.length - 1}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-sm disabled:opacity-50"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Side by side comparison */}
          {currentPage && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Experiment A */}
              <div className="bg-white rounded-xl border-2 border-blue-200 overflow-hidden">
                <div className="bg-blue-50 px-4 py-2 border-b border-blue-200">
                  <span className="text-sm font-medium text-blue-700">A: {expA?.name}</span>
                  <span className="text-xs text-blue-500 ml-2">({expA?.config?.model || 'unknown'})</span>
                </div>
                <div className="p-4 max-h-[60vh] overflow-auto">
                  <pre className="whitespace-pre-wrap text-sm text-stone-700 font-mono">
                    {getContent(currentPage.a) || '(No data)'}
                  </pre>
                </div>
              </div>

              {/* Experiment B */}
              <div className="bg-white rounded-xl border-2 border-purple-200 overflow-hidden">
                <div className="bg-purple-50 px-4 py-2 border-b border-purple-200">
                  <span className="text-sm font-medium text-purple-700">B: {expB?.name}</span>
                  <span className="text-xs text-purple-500 ml-2">({expB?.config?.model || 'unknown'})</span>
                </div>
                <div className="p-4 max-h-[60vh] overflow-auto">
                  <pre className="whitespace-pre-wrap text-sm text-stone-700 font-mono">
                    {getContent(currentPage.b) || '(No data)'}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Voting buttons */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => recordVote('a')}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              <ArrowLeft className="w-5 h-5" />
              A is Better (1)
            </button>

            <button
              onClick={() => recordVote('tie')}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-stone-600 text-white rounded-xl hover:bg-stone-700 disabled:opacity-50 font-medium"
            >
              <Equal className="w-5 h-5" />
              Tie (3)
            </button>

            <button
              onClick={() => recordVote('b')}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 font-medium"
            >
              B is Better (2)
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          <p className="text-center text-xs text-stone-400 mt-3">
            Keyboard: ← → to navigate, 1/a = A wins, 2/b = B wins, 3/t = tie
          </p>
        </div>
      )}
    </div>
  );
}
