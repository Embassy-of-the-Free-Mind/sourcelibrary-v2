'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RefreshCw, Loader2, ExternalLink, AlertTriangle, CheckCircle, BarChart3 } from 'lucide-react';
import { qa } from '@/lib/api-client';
import type { QASampleResponse } from '@/lib/api-client';

export default function QASamplingPage() {
  const [data, setData] = useState<QASampleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sampleSize, setSampleSize] = useState(50);
  const [modelFilter, setModelFilter] = useState<string>('');

  const fetchSample = async () => {
    setLoading(true);
    try {
      const result = await qa.sample(sampleSize, {
        model: modelFilter || undefined,
      });
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSample();
  }, []);

  const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-amber-600" />
              <h1 className="text-lg font-semibold">QA Sampling</h1>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={sampleSize}
                onChange={(e) => setSampleSize(parseInt(e.target.value))}
                className="px-3 py-1.5 text-sm border border-stone-200 rounded-lg"
              >
                <option value="25">25 samples</option>
                <option value="50">50 samples</option>
                <option value="100">100 samples</option>
                <option value="200">200 samples</option>
              </select>
              <button
                onClick={fetchSample}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-1.5 text-sm bg-amber-600 text-white hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Resample
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
          </div>
        ) : data ? (
          <>
            {/* Population Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-lg border border-stone-200 p-4">
                <div className="text-2xl font-bold text-stone-900">
                  {data.population.translatedPages.toLocaleString()}
                </div>
                <div className="text-sm text-stone-500">Translated Pages</div>
              </div>
              <div className="bg-white rounded-lg border border-stone-200 p-4">
                <div className="text-2xl font-bold text-stone-900">{data.population.sampleSize}</div>
                <div className="text-sm text-stone-500">
                  Sample Size ({formatPercent(data.population.samplingRate)})
                </div>
              </div>
              <div className="bg-white rounded-lg border border-stone-200 p-4">
                <div className={`text-2xl font-bold ${data.estimate.issueRate > 0.1 ? 'text-red-600' : data.estimate.issueRate > 0.05 ? 'text-amber-600' : 'text-green-600'}`}>
                  {formatPercent(data.estimate.issueRate)}
                </div>
                <div className="text-sm text-stone-500">Issue Rate (sample)</div>
              </div>
              <div className="bg-white rounded-lg border border-stone-200 p-4">
                <div className="text-lg font-bold text-stone-900">
                  {data.estimate.estimatedPagesWithIssues.lower} - {data.estimate.estimatedPagesWithIssues.upper}
                </div>
                <div className="text-sm text-stone-500">Est. Pages with Issues (95% CI)</div>
              </div>
            </div>

            {/* Model Stats */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {/* OCR Models */}
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
                  <h2 className="font-semibold">OCR by Model</h2>
                </div>
                <div className="divide-y divide-stone-100">
                  {data.modelStats.ocr.map((stat) => (
                    <div key={stat.model} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{stat.model}</div>
                        <div className="text-xs text-stone-500">
                          {stat.count} pages, avg {stat.avgLength.toLocaleString()} chars
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-medium ${stat.issueRate > 0.1 ? 'text-red-600' : stat.issueRate > 0.05 ? 'text-amber-600' : 'text-green-600'}`}>
                          {formatPercent(stat.issueRate)} issues
                        </div>
                        <div className="text-xs text-stone-500">
                          {stat.withIssues}/{stat.count} pages
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.modelStats.ocr.length === 0 && (
                    <div className="px-4 py-3 text-sm text-stone-500">No OCR data in sample</div>
                  )}
                </div>
              </div>

              {/* Translation Models */}
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
                  <h2 className="font-semibold">Translation by Model</h2>
                </div>
                <div className="divide-y divide-stone-100">
                  {data.modelStats.translation.map((stat) => (
                    <div key={stat.model} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{stat.model}</div>
                        <div className="text-xs text-stone-500">
                          {stat.count} pages, avg {stat.avgLength.toLocaleString()} chars
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-medium ${stat.issueRate > 0.1 ? 'text-red-600' : stat.issueRate > 0.05 ? 'text-amber-600' : 'text-green-600'}`}>
                          {formatPercent(stat.issueRate)} issues
                        </div>
                        <div className="text-xs text-stone-500">
                          {stat.withIssues}/{stat.count} pages
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.modelStats.translation.length === 0 && (
                    <div className="px-4 py-3 text-sm text-stone-500">No translation data in sample</div>
                  )}
                </div>
              </div>
            </div>

            {/* Sample List */}
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                <h2 className="font-semibold">Random Samples</h2>
                <div className="text-sm text-stone-500">
                  {data.samples.filter(s => s.ocrIssues > 0 || s.translationIssues > 0).length} with issues
                </div>
              </div>
              <div className="divide-y divide-stone-100 max-h-[600px] overflow-y-auto">
                {data.samples.map((sample) => (
                  <div key={sample.pageId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Link
                            href={`/book/${sample.bookId}/page/${sample.pageId}`}
                            className="font-medium text-amber-600 hover:text-amber-700"
                          >
                            {sample.bookTitle} - Page {sample.pageNumber}
                          </Link>
                          {sample.ocrIssues > 0 || sample.translationIssues > 0 ? (
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs mb-2">
                          {sample.translationModel && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                              {sample.translationModel}
                            </span>
                          )}
                          {sample.translationPrompt && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded">
                              {sample.translationPrompt}
                            </span>
                          )}
                          {sample.translationIssues > 0 && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded">
                              {sample.translationIssues} issue{sample.translationIssues > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-stone-600 line-clamp-2">
                          {sample.translationPreview}
                        </p>
                      </div>
                      <Link
                        href={`/book/${sample.bookId}/page/${sample.pageId}`}
                        className="flex-shrink-0 p-1.5 text-stone-400 hover:text-stone-600"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-20 text-stone-500">Failed to load data</div>
        )}
      </main>
    </div>
  );
}
