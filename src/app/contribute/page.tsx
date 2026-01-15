'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, Key, BookOpen, Zap, CheckCircle, AlertCircle, Loader2, Users } from 'lucide-react';
import { contribute } from '@/lib/api-client';
import type { ContributeBook, ContributorStats } from '@/lib/api-client/types';

interface ProcessingStatus {
  status: 'idle' | 'validating' | 'processing' | 'complete' | 'error' | 'limit_reached';
  currentPage: number;
  totalPages: number;
  pagesCompleted: number;
  error?: string;
  bookTitle?: string;
  costSpent?: number;
  costLimit?: number;
}

export default function ContributePage() {
  const [apiKey, setApiKey] = useState('');
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [books, setBooks] = useState<ContributeBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<ContributeBook | null>(null);
  const [contributorName, setContributorName] = useState('');
  const [processType, setProcessType] = useState<'ocr' | 'translate'>('ocr');
  const [costLimit, setCostLimit] = useState<string>('1.00');
  const [processing, setProcessing] = useState<ProcessingStatus>({
    status: 'idle',
    currentPage: 0,
    totalPages: 0,
    pagesCompleted: 0,
  });
  const [stats, setStats] = useState<ContributorStats | null>(null);

  // Fetch contributor stats
  useEffect(() => {
    contribute.stats()
      .then(setStats)
      .catch(console.error);
  }, []);

  // Fetch books needing work
  useEffect(() => {
    contribute.books()
      .then(data => setBooks(data || []))
      .catch(console.error);
  }, []);

  // Validate API key
  const validateKey = useCallback(async () => {
    if (!apiKey || apiKey.length < 20) {
      setKeyValid(null);
      return;
    }

    setProcessing(p => ({ ...p, status: 'validating' }));
    try {
      const data = await contribute.validateKey(apiKey);
      setKeyValid(data.valid);
      setProcessing(p => ({ ...p, status: 'idle' }));
    } catch {
      setKeyValid(false);
      setProcessing(p => ({ ...p, status: 'idle' }));
    }
  }, [apiKey]);

  // Start processing
  const startProcessing = async () => {
    if (!selectedBook || !keyValid) return;

    const limit = parseFloat(costLimit) || 1.0;

    setProcessing({
      status: 'processing',
      currentPage: 0,
      totalPages: processType === 'ocr'
        ? selectedBook.pages_count - selectedBook.pages_ocr
        : selectedBook.pages_ocr - selectedBook.pages_translated,
      pagesCompleted: 0,
      bookTitle: selectedBook.title,
      costSpent: 0,
      costLimit: limit,
    });

    try {
      // Use API client with streaming support (includes auth, visitor tracking, error handling)
      const res = await contribute.processStream({
        apiKey,
        bookId: selectedBook._id,
        processType,
        contributorName: contributorName || 'Anonymous',
        costLimit: limit,
      });

      // Stream response for real-time updates
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split('\n').filter(l => l.startsWith('data: '));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.replace('data: ', ''));
              setProcessing(p => ({
                ...p,
                currentPage: data.currentPage || p.currentPage,
                pagesCompleted: data.pagesCompleted || p.pagesCompleted,
                costSpent: data.costSpent || p.costSpent,
                status: data.limitReached ? 'limit_reached' : data.complete ? 'complete' : 'processing',
                error: data.error,
              }));
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      setProcessing(p => ({ ...p, status: 'complete' }));
    } catch (error) {
      setProcessing(p => ({
        ...p,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  };

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
              Contribute
            </h1>
          </div>
          {stats && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Users className="w-4 h-4" />
              <span>{stats.totalContributors} contributors</span>
              <span className="mx-2">·</span>
              <span>{formatNumber(stats.totalPagesProcessed)} pages processed</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Intro */}
        <div className="mb-8 p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-2xl font-medium mb-3" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
            Help Digitize Historical Texts
          </h2>
          <p className="text-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Use your own Gemini API key to help OCR and translate books in our collection.
            Your key is never stored — it's used only during your session to process pages.
            Every page you process helps make ancient wisdom accessible to researchers worldwide.
          </p>
        </div>

        {processing.status === 'processing' || processing.status === 'complete' || processing.status === 'limit_reached' ? (
          /* Processing View */
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="text-center mb-6">
              {processing.status === 'processing' ? (
                <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin" style={{ color: 'var(--accent-sage)' }} />
              ) : processing.status === 'limit_reached' ? (
                <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#f59e0b' }} />
              ) : (
                <CheckCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#22c55e' }} />
              )}
              <h3 className="text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                {processing.status === 'processing' ? 'Processing...' : processing.status === 'limit_reached' ? 'Limit Reached' : 'Complete!'}
              </h3>
              <p style={{ color: 'var(--text-muted)' }}>{processing.bookTitle}</p>
            </div>

            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: 'var(--text-primary)' }}>Progress</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {processing.pagesCompleted} / {processing.totalPages} pages
                </span>
              </div>
              <div className="h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${processing.totalPages > 0 ? (processing.pagesCompleted / processing.totalPages) * 100 : 0}%`,
                    background: processing.status === 'complete' ? '#22c55e' : processing.status === 'limit_reached' ? '#f59e0b' : 'var(--accent-sage)',
                  }}
                />
              </div>
              {/* Cost tracker */}
              {processing.costSpent !== undefined && (
                <div className="flex justify-between text-sm mt-3">
                  <span style={{ color: 'var(--text-primary)' }}>Cost spent</span>
                  <span style={{ color: processing.costSpent >= (processing.costLimit || 1) ? '#f59e0b' : 'var(--text-muted)' }}>
                    ${processing.costSpent.toFixed(4)} / ${(processing.costLimit || 1).toFixed(2)} limit
                  </span>
                </div>
              )}
            </div>

            {processing.status === 'limit_reached' && (
              <div className="text-center">
                <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Spending limit reached. You processed {processing.pagesCompleted} pages for ${processing.costSpent?.toFixed(4)}.
                  Your API key has been discarded.
                </p>
                <button
                  onClick={() => {
                    setProcessing({ status: 'idle', currentPage: 0, totalPages: 0, pagesCompleted: 0 });
                    setSelectedBook(null);
                    setApiKey('');
                    setKeyValid(null);
                  }}
                  className="px-4 py-2 rounded-lg font-medium"
                  style={{ background: 'var(--accent-sage)', color: 'white' }}
                >
                  Start Over
                </button>
              </div>
            )}

            {processing.status === 'complete' && (
              <div className="text-center">
                <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                  Thank you for your contribution! You processed {processing.pagesCompleted} pages
                  {processing.costSpent ? ` for $${processing.costSpent.toFixed(4)}` : ''}.
                </p>
                <button
                  onClick={() => {
                    setProcessing({ status: 'idle', currentPage: 0, totalPages: 0, pagesCompleted: 0 });
                    setSelectedBook(null);
                  }}
                  className="px-4 py-2 rounded-lg font-medium"
                  style={{ background: 'var(--accent-sage)', color: 'white' }}
                >
                  Process Another Book
                </button>
              </div>
            )}
          </div>
        ) : processing.status === 'error' ? (
          /* Error View */
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid #fecaca' }}>
            <div className="text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#ef4444' }} />
              <h3 className="text-xl font-medium mb-2" style={{ color: '#ef4444' }}>Error</h3>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>{processing.error}</p>
              <button
                onClick={() => setProcessing({ status: 'idle', currentPage: 0, totalPages: 0, pagesCompleted: 0 })}
                className="px-4 py-2 rounded-lg font-medium"
                style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)' }}
              >
                Try Again
              </button>
            </div>
          </div>
        ) : (
          /* Setup View */
          <div className="space-y-6">
            {/* API Key Input */}
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Key className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
                <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>Your Gemini API Key</h3>
              </div>

              <div className="flex gap-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyValid(null);
                  }}
                  placeholder="AIza..."
                  className="flex-1 px-4 py-2 rounded-lg text-sm"
                  style={{
                    border: '1px solid var(--border-medium)',
                    background: 'var(--bg-white)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  onClick={validateKey}
                  disabled={!apiKey || apiKey.length < 20 || processing.status === 'validating'}
                  className="px-4 py-2 rounded-lg font-medium text-sm disabled:opacity-50"
                  style={{ background: 'var(--accent-violet)', color: 'white' }}
                >
                  {processing.status === 'validating' ? 'Validating...' : 'Validate'}
                </button>
              </div>

              {keyValid === true && (
                <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: '#22c55e' }}>
                  <CheckCircle className="w-4 h-4" />
                  Key is valid
                </div>
              )}
              {keyValid === false && (
                <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: '#ef4444' }}>
                  <AlertCircle className="w-4 h-4" />
                  Invalid key - check your Gemini API key
                </div>
              )}

              <p className="mt-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                Get a free API key at{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline">
                  aistudio.google.com
                </a>
                . Your key is never stored.
              </p>
            </div>

            {/* Optional: Contributor Name */}
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                Your Name (Optional)
              </h3>
              <input
                type="text"
                value={contributorName}
                onChange={(e) => setContributorName(e.target.value)}
                placeholder="Anonymous"
                className="w-full px-4 py-2 rounded-lg text-sm"
                style={{
                  border: '1px solid var(--border-medium)',
                  background: 'var(--bg-white)',
                  color: 'var(--text-primary)',
                }}
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                Shown on the contributors list. Leave blank to remain anonymous.
              </p>
            </div>

            {/* Spending Limit */}
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                Spending Limit
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-lg" style={{ color: 'var(--text-primary)' }}>$</span>
                <input
                  type="number"
                  value={costLimit}
                  onChange={(e) => setCostLimit(e.target.value)}
                  min="0.10"
                  max="100"
                  step="0.10"
                  className="w-32 px-4 py-2 rounded-lg text-sm"
                  style={{
                    border: '1px solid var(--border-medium)',
                    background: 'var(--bg-white)',
                    color: 'var(--text-primary)',
                  }}
                />
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>USD max</span>
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                Processing stops when this limit is reached. Your API key is discarded immediately after.
              </p>
            </div>

            {/* Process Type */}
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                What would you like to help with?
              </h3>
              <div className="flex gap-3">
                <button
                  onClick={() => setProcessType('ocr')}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${processType === 'ocr' ? 'border-[var(--accent-sage)]' : 'border-transparent'}`}
                  style={{ background: processType === 'ocr' ? 'rgba(139, 167, 132, 0.1)' : 'var(--bg-warm)' }}
                >
                  <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>OCR</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Transcribe page images to text</div>
                </button>
                <button
                  onClick={() => setProcessType('translate')}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${processType === 'translate' ? 'border-[var(--accent-rust)]' : 'border-transparent'}`}
                  style={{ background: processType === 'translate' ? 'rgba(180, 110, 90, 0.1)' : 'var(--bg-warm)' }}
                >
                  <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Translate</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Translate OCR'd text to English</div>
                </button>
              </div>
            </div>

            {/* Book Selection */}
            {keyValid && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
                  <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>Select a Book</h3>
                </div>

                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {books
                    .filter(book => processType === 'ocr'
                      ? book.pages_ocr < book.pages_count
                      : book.pages_translated < book.pages_ocr)
                    .slice(0, 20)
                    .map((book) => {
                      const remaining = processType === 'ocr'
                        ? book.pages_count - book.pages_ocr
                        : book.pages_ocr - book.pages_translated;
                      const isSelected = selectedBook?._id === book._id;

                      return (
                        <button
                          key={book._id}
                          onClick={() => setSelectedBook(book)}
                          className={`w-full p-4 rounded-lg text-left transition-all border-2 ${isSelected ? 'border-[var(--accent-sage)]' : 'border-transparent hover:border-[var(--border-medium)]'}`}
                          style={{ background: isSelected ? 'rgba(139, 167, 132, 0.1)' : 'var(--bg-warm)' }}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{book.title}</div>
                              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{book.author}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-medium" style={{ color: 'var(--accent-sage)' }}>
                                {remaining} pages
                              </div>
                              <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                                ~${(remaining * 0.0008).toFixed(2)} cost
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>

                {books.length === 0 && (
                  <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                    Loading books...
                  </p>
                )}
              </div>
            )}

            {/* Start Button */}
            {keyValid && selectedBook && (
              <button
                onClick={startProcessing}
                className="w-full py-4 rounded-xl font-medium text-lg flex items-center justify-center gap-3"
                style={{ background: 'var(--accent-sage)', color: 'white' }}
              >
                <Zap className="w-5 h-5" />
                Start Processing
              </button>
            )}
          </div>
        )}

        {/* Recent Contributors */}
        {stats && stats.recentContributors.length > 0 && processing.status === 'idle' && (
          <div className="mt-8 p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
              Recent Contributors
            </h3>
            <div className="space-y-2">
              {stats.recentContributors.map((c, i) => (
                <div key={i} className="flex justify-between items-center py-2" style={{ borderBottom: i < stats.recentContributors.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {c.pages} pages · {new Date(c.date).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
