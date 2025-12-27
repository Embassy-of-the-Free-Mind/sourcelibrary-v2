'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2, CheckCircle, AlertTriangle, Wrench, RotateCcw } from 'lucide-react';
import { ValidationIssue } from '@/lib/validateTranslation';

interface PageIssue {
  pageId: string;
  pageNumber: number;
  field: 'translation' | 'ocr';
  issues: ValidationIssue[];
}

interface QAData {
  bookId: string;
  bookTitle: string;
  totalPages: number;
  translatedPages: number;
  pagesWithIssues: number;
  totalIssues: number;
  issues: PageIssue[];
}

export default function QAReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [data, setData] = useState<QAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [retranslating, setRetranslating] = useState<string | null>(null);

  useEffect(() => {
    params.then(p => setBookId(p.id));
  }, [params]);

  const fetchQA = async () => {
    if (!bookId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/qa`);
      if (!res.ok) throw new Error('Failed to fetch QA data');
      const qaData = await res.json();
      setData(qaData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bookId) fetchQA();
  }, [bookId]);

  const applyFix = async (pageId: string, field: 'translation' | 'ocr', fix: ValidationIssue['suggestedFix']) => {
    if (!fix) return;
    setApplying(`${pageId}-${field}`);
    try {
      const res = await fetch(`/api/pages/${pageId}/quick-fix`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, fix }),
      });
      if (!res.ok) throw new Error('Failed to apply fix');
      // Refresh the data
      await fetchQA();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to apply fix');
    } finally {
      setApplying(null);
    }
  };

  const retranslate = async (pageId: string) => {
    setRetranslating(pageId);
    try {
      // Get page info first
      const pageRes = await fetch(`/api/pages/${pageId}`);
      if (!pageRes.ok) throw new Error('Failed to fetch page');
      const page = await pageRes.json();

      // Trigger re-translation
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId,
          type: 'translation',
          autoSave: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to re-translate');
      // Refresh the data
      await fetchQA();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to re-translate');
    } finally {
      setRetranslating(null);
    }
  };

  const issueTypeLabel = (type: string) => {
    switch (type) {
      case 'unclosed_open': return 'Unclosed [[';
      case 'unclosed_close': return 'Extra ]]';
      case 'unknown_tag': return 'Unknown tag';
      case 'empty_tag': return 'Empty tag';
      case 'nested_bracket': return 'Nested brackets';
      case 'unbalanced_center': return 'Unbalanced ->';
      default: return type;
    }
  };

  const issueTypeColor = (type: string) => {
    switch (type) {
      case 'unclosed_open':
      case 'unclosed_close':
        return 'bg-red-100 text-red-800';
      case 'unknown_tag':
        return 'bg-yellow-100 text-yellow-800';
      case 'empty_tag':
        return 'bg-orange-100 text-orange-800';
      case 'nested_bracket':
        return 'bg-purple-100 text-purple-800';
      case 'unbalanced_center':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-stone-100 text-stone-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Error</h1>
          <p className="text-stone-600 mb-4">{error}</p>
          <button onClick={fetchQA} className="text-amber-600 hover:text-amber-700">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Book</span>
            </Link>
            <button
              onClick={fetchQA}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Rescan
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Title */}
        <div className="mb-8">
          <h1 className="text-2xl font-serif font-bold text-stone-900">QA Review</h1>
          <p className="text-stone-600 mt-1">{data?.bookTitle}</p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-stone-200 p-4">
            <div className="text-2xl font-bold text-stone-900">{data?.totalPages}</div>
            <div className="text-sm text-stone-500">Total Pages</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4">
            <div className="text-2xl font-bold text-stone-900">{data?.translatedPages}</div>
            <div className="text-sm text-stone-500">Translated</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4">
            <div className={`text-2xl font-bold ${data?.pagesWithIssues === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {data?.pagesWithIssues}
            </div>
            <div className="text-sm text-stone-500">Pages with Issues</div>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-4">
            <div className={`text-2xl font-bold ${data?.totalIssues === 0 ? 'text-green-600' : 'text-amber-600'}`}>
              {data?.totalIssues}
            </div>
            <div className="text-sm text-stone-500">Total Issues</div>
          </div>
        </div>

        {/* Issues List */}
        {data?.issues.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-green-800">All Clear!</h2>
            <p className="text-green-600 mt-2">No formatting issues found in translations.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {data?.issues.map((pageIssue, idx) => (
              <div key={`${pageIssue.pageId}-${pageIssue.field}-${idx}`} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                {/* Page header */}
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 border-b border-stone-200">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/book/${bookId}/page/${pageIssue.pageId}`}
                      className="font-medium text-amber-600 hover:text-amber-700"
                    >
                      Page {pageIssue.pageNumber}
                    </Link>
                    <span className="text-xs px-2 py-0.5 bg-stone-200 rounded text-stone-600">
                      {pageIssue.field}
                    </span>
                  </div>
                  <button
                    onClick={() => retranslate(pageIssue.pageId)}
                    disabled={retranslating === pageIssue.pageId}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {retranslating === pageIssue.pageId ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                    Re-translate
                  </button>
                </div>

                {/* Issues */}
                <div className="divide-y divide-stone-100">
                  {pageIssue.issues.map((issue, issueIdx) => (
                    <div key={issueIdx} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded ${issueTypeColor(issue.type)}`}>
                              {issueTypeLabel(issue.type)}
                            </span>
                          </div>
                          <p className="text-sm text-stone-600 mb-2">{issue.message}</p>
                          <div className="font-mono text-xs bg-stone-100 p-2 rounded overflow-x-auto">
                            <code className="text-stone-700 whitespace-pre-wrap break-all">
                              {issue.context}
                            </code>
                          </div>
                        </div>
                        {issue.suggestedFix && (
                          <button
                            onClick={() => applyFix(pageIssue.pageId, pageIssue.field, issue.suggestedFix)}
                            disabled={applying === `${pageIssue.pageId}-${pageIssue.field}`}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition-colors disabled:opacity-50"
                            title={`${issue.suggestedFix.type}: ${issue.suggestedFix.text || `delete ${issue.suggestedFix.length} chars`}`}
                          >
                            {applying === `${pageIssue.pageId}-${pageIssue.field}` ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Wrench className="w-4 h-4" />
                            )}
                            Fix
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
