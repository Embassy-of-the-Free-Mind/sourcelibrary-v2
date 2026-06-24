'use client';

import { useEffect, useState, useCallback } from 'react';

interface Edition {
  id: string;
  title: string;
  year: number;
  pages: number;
}

interface AlignedPair {
  pageA: number;
  pageB: number;
  similarity: number;
  ocrA: string;
  ocrB: string;
  translationA: string;
  translationB: string;
}

interface ClusterInfo {
  _id: string;
  count: number;
  books: Array<{ id: string; title: string; year: number; pages_ocr: number }>;
}

interface DiffResult {
  workId: string;
  editionA: Edition;
  editionB: Edition;
  alignedPairs: AlignedPair[];
  stats: { totalA: number; totalB: number; aligned: number; avgSimilarity: number };
}

// Word-level diff with classification
interface WordDiff {
  word: string;
  type: 'match' | 'added' | 'removed' | 'changed';
  other?: string;
  changeType?: 'abbreviation' | 'punctuation' | 'spelling' | 'ocr_error' | 'major';
}

function classifyChange(a: string, b: string): string {
  const la = a.toLowerCase().replace(/[.,;:!?()]/g, '');
  const lb = b.toLowerCase().replace(/[.,;:!?()]/g, '');
  if (la === lb) return 'punctuation';

  // Normalize and compare
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  if (norm(la) === norm(lb)) return 'abbreviation';

  // v/u, i/j, s/ſ
  const spell = (s: string) => s.replace(/v/g, 'u').replace(/j/g, 'i').replace(/ſ/g, 's');
  if (spell(norm(la)) === spell(norm(lb))) return 'spelling';

  // Edit distance
  const maxLen = Math.max(la.length, lb.length);
  if (maxLen > 0) {
    let dist = 0;
    const m = la.length,
      n = lb.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] =
          la[i - 1] === lb[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    dist = dp[m][n];
    if (dist / maxLen <= 0.3) return 'ocr_error';
  }

  return 'major';
}

function computeWordDiff(textA: string, textB: string): { diffsA: WordDiff[]; diffsB: WordDiff[] } {
  const wordsA = textA.split(/\s+/).filter(Boolean);
  const wordsB = textB.split(/\s+/).filter(Boolean);

  const diffsA: WordDiff[] = [];
  const diffsB: WordDiff[] = [];

  // Simple word-by-word alignment (good enough for similar texts)
  const len = Math.max(wordsA.length, wordsB.length);
  for (let i = 0; i < len; i++) {
    const wa = wordsA[i];
    const wb = wordsB[i];

    if (!wa) {
      diffsB.push({ word: wb, type: 'added' });
      continue;
    }
    if (!wb) {
      diffsA.push({ word: wa, type: 'removed' });
      continue;
    }

    if (wa === wb) {
      diffsA.push({ word: wa, type: 'match' });
      diffsB.push({ word: wb, type: 'match' });
    } else {
      const changeType = classifyChange(wa, wb);
      diffsA.push({ word: wa, type: 'changed', other: wb, changeType: changeType as WordDiff['changeType'] });
      diffsB.push({ word: wb, type: 'changed', other: wa, changeType: changeType as WordDiff['changeType'] });
    }
  }

  return { diffsA, diffsB };
}

const CHANGE_COLORS: Record<string, string> = {
  abbreviation: 'bg-blue-100 text-blue-800 border-b border-blue-300',
  punctuation: 'bg-gray-100 text-gray-600 border-b border-gray-300',
  spelling: 'bg-amber-100 text-amber-800 border-b border-amber-300',
  ocr_error: 'bg-red-100 text-red-800 border-b border-red-400',
  major: 'bg-purple-100 text-purple-800 border-b border-purple-400',
};

function DiffWord({ diff }: { diff: WordDiff }) {
  if (diff.type === 'match') {
    return <span className="text-stone-700">{diff.word} </span>;
  }
  if (diff.type === 'added') {
    return <span className="bg-green-100 text-green-800 border-b border-green-400">{diff.word} </span>;
  }
  if (diff.type === 'removed') {
    return <span className="bg-red-100 text-red-800 line-through">{diff.word} </span>;
  }
  const colorClass = CHANGE_COLORS[diff.changeType || 'major'];
  return (
    <span className={colorClass} title={`${diff.changeType}: "${diff.word}" ↔ "${diff.other}"`}>
      {diff.word}{' '}
    </span>
  );
}

export default function OcrDiffPage() {
  const [clusters, setClusters] = useState<ClusterInfo[] | null>(null);
  const [selectedWork, setSelectedWork] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTranslations, setShowTranslations] = useState(false);

  useEffect(() => {
    fetch('/api/research/ocr-diff')
      .then((r) => r.json())
      .then((d) => setClusters(d.clusters));
  }, []);

  const loadDiff = useCallback(async (workId: string) => {
    setSelectedWork(workId);
    setLoading(true);
    setDiffResult(null);
    try {
      const r = await fetch(`/api/research/ocr-diff?work_id=${encodeURIComponent(workId)}`);
      const data = await r.json();
      setDiffResult(data);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-stone-50 p-6 max-w-[1500px] mx-auto">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">OCR Consistency Diff</h1>
      <p className="text-stone-500 text-sm mb-6">
        Compare raw OCR output across editions of the same work. Differences reveal OCR errors,
        abbreviation variance, and genuine edition changes.
      </p>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-6 text-xs">
        <span className={`px-2 py-0.5 rounded ${CHANGE_COLORS.abbreviation}`}>Abbreviation</span>
        <span className={`px-2 py-0.5 rounded ${CHANGE_COLORS.punctuation}`}>Punctuation</span>
        <span className={`px-2 py-0.5 rounded ${CHANGE_COLORS.spelling}`}>Spelling (v/u)</span>
        <span className={`px-2 py-0.5 rounded ${CHANGE_COLORS.ocr_error}`}>OCR Error</span>
        <span className={`px-2 py-0.5 rounded ${CHANGE_COLORS.major}`}>Major Difference</span>
      </div>

      {/* Cluster selector */}
      {clusters && !selectedWork && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clusters.map((c) => (
            <button
              key={c._id}
              onClick={() => loadDiff(c._id)}
              className="text-left p-4 bg-white rounded-lg border border-stone-200 hover:border-stone-400 transition-colors"
            >
              <p className="font-medium text-stone-900 text-sm">{c._id}</p>
              <p className="text-xs text-stone-500 mt-1">
                {c.count} editions &middot;{' '}
                {c.books.map((b) => `${b.title?.substring(0, 40)}${b.title && b.title.length > 40 ? '...' : ''}`).join(' / ')}
              </p>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="inline-block w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Diff results */}
      {diffResult && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <button onClick={() => { setSelectedWork(null); setDiffResult(null); }} className="text-sm text-stone-500 hover:text-stone-700">
              &larr; Back
            </button>
            <h2 className="text-lg font-semibold text-stone-900">{diffResult.workId}</h2>
            <label className="flex items-center gap-1.5 text-xs text-stone-500 ml-auto">
              <input type="checkbox" checked={showTranslations} onChange={(e) => setShowTranslations(e.target.checked)} />
              Show translations
            </label>
          </div>

          {/* Stats bar */}
          <div className="bg-white rounded-lg border border-stone-200 p-4 mb-4 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-stone-500">Edition A:</span>{' '}
              <span className="font-medium">{diffResult.editionA.title}</span>
              <span className="text-stone-400 ml-1">({diffResult.editionA.pages}pp)</span>
            </div>
            <div>
              <span className="text-stone-500">Edition B:</span>{' '}
              <span className="font-medium">{diffResult.editionB.title}</span>
              <span className="text-stone-400 ml-1">({diffResult.editionB.pages}pp)</span>
            </div>
            <div>
              <span className="text-stone-500">Aligned:</span>{' '}
              <span className="font-medium">{diffResult.stats.aligned}</span> pages
            </div>
            <div>
              <span className="text-stone-500">Avg similarity:</span>{' '}
              <span className="font-medium">{(diffResult.stats.avgSimilarity * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* Aligned pairs */}
          <div className="space-y-4">
            {diffResult.alignedPairs.map((pair, i) => {
              const { diffsA, diffsB } = computeWordDiff(pair.ocrA, pair.ocrB);

              // Count diff types
              const counts: Record<string, number> = {};
              for (const d of diffsA) {
                if (d.type === 'changed' && d.changeType) {
                  counts[d.changeType] = (counts[d.changeType] || 0) + 1;
                }
              }

              const matchPct = (pair.similarity * 100).toFixed(0);
              const simColor =
                pair.similarity > 0.6 ? 'text-green-600' : pair.similarity > 0.3 ? 'text-amber-600' : 'text-red-600';

              return (
                <div key={i} className="bg-white rounded-lg border border-stone-200 overflow-hidden">
                  {/* Header */}
                  <div className="px-4 py-2 border-b border-stone-100 flex items-center gap-3 text-xs">
                    <span className="font-medium text-stone-700">
                      p{pair.pageA} ↔ p{pair.pageB}
                    </span>
                    <span className={`font-mono font-bold ${simColor}`}>{matchPct}%</span>
                    {Object.entries(counts).map(([type, count]) => (
                      <span key={type} className={`px-1.5 py-0.5 rounded text-[10px] ${CHANGE_COLORS[type]}`}>
                        {type}: {count}
                      </span>
                    ))}
                  </div>

                  {/* Side-by-side diff */}
                  <div className="grid grid-cols-2 divide-x divide-stone-100">
                    <div className="p-3 text-xs leading-relaxed font-mono overflow-auto max-h-64">
                      {diffsA.map((d, j) => (
                        <DiffWord key={j} diff={d} />
                      ))}
                    </div>
                    <div className="p-3 text-xs leading-relaxed font-mono overflow-auto max-h-64">
                      {diffsB.map((d, j) => (
                        <DiffWord key={j} diff={d} />
                      ))}
                    </div>
                  </div>

                  {/* Translations (collapsed by default) */}
                  {showTranslations && pair.translationA && pair.translationB && (
                    <div className="border-t border-stone-100 grid grid-cols-2 divide-x divide-stone-100">
                      <div className="p-3 text-xs text-stone-600 leading-relaxed max-h-40 overflow-auto">
                        {pair.translationA.substring(0, 500)}
                      </div>
                      <div className="p-3 text-xs text-stone-600 leading-relaxed max-h-40 overflow-auto">
                        {pair.translationB.substring(0, 500)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
