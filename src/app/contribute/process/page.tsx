'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, BookOpen, Zap, CheckCircle, AlertCircle, Users, ExternalLink } from 'lucide-react';
import { contribute } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
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

type GenerosityTier = null | 'curious' | 'helping' | 'generous' | 'patron';

const tiers: { id: GenerosityTier; label: string; description: string; amount: string; pages: string }[] = [
  {
    id: 'curious',
    label: 'Just curious',
    description: 'Try it out with a few pages',
    amount: '0.25',
    pages: '~300 pages',
  },
  {
    id: 'helping',
    label: 'Happy to help',
    description: 'Process a small book',
    amount: '2.00',
    pages: '~2,500 pages',
  },
  {
    id: 'generous',
    label: 'Feeling generous',
    description: 'Process a large book or two',
    amount: '10.00',
    pages: '~12,000 pages',
  },
  {
    id: 'patron',
    label: 'Modern-day Medici',
    description: 'Make a real dent in the collection',
    amount: '50.00',
    pages: '~60,000 pages',
  },
];

export default function ProcessPage() {
  const [step, setStep] = useState<'generosity' | 'setup' | 'processing'>('generosity');
  const [generosity, setGenerosity] = useState<GenerosityTier>(null);
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

  useEffect(() => {
    contribute.stats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    contribute.books().then(data => setBooks(data || [])).catch(console.error);
  }, []);

  const selectTier = (tier: GenerosityTier) => {
    setGenerosity(tier);
    const t = tiers.find(t => t.id === tier);
    if (t) setCostLimit(t.amount);
    setStep('setup');
  };

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

  const startProcessing = async () => {
    if (!selectedBook || !keyValid) return;

    const limit = parseFloat(costLimit) || 1.0;

    setStep('processing');
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
      const res = await contribute.processStream({
        apiKey,
        bookId: selectedBook._id,
        processType,
        contributorName: contributorName || 'Anonymous',
        costLimit: limit,
      });

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

  const resetAll = () => {
    setStep('generosity');
    setGenerosity(null);
    setApiKey('');
    setKeyValid(null);
    setSelectedBook(null);
    setProcessing({ status: 'idle', currentPage: 0, totalPages: 0, pagesCompleted: 0 });
  };

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/contribute" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
              Process Pages
            </h1>
          </div>
          {stats && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Users className="w-4 h-4" />
              <span>{stats.totalContributors} contributors</span>
              <span className="mx-2">&middot;</span>
              <span>{formatNumber(stats.totalPagesProcessed)} pages processed</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">

        {/* ── Step 1: Generosity ── */}
        {step === 'generosity' && (
          <div className="space-y-8">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-3xl mb-4" style={{ color: 'var(--text-primary)' }}>
                Help bring a book to life
              </h2>
              <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                You&apos;ll use your own Google Gemini API key to process pages. The key is free to get and never leaves your browser. You set the budget — we handle the rest.
              </p>
            </div>

            {/* Tier selection */}
            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
              {tiers.map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => selectTier(tier.id)}
                  className="p-6 rounded-xl text-left transition-all border-2 border-transparent hover:border-accent-gold/20 hover:shadow-md"
                  style={{ background: 'var(--bg-white)' }}
                >
                  <div className="text-lg font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                    {tier.label}
                  </div>
                  <div className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
                    {tier.description}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-semibold" style={{ color: 'var(--accent-sage)' }}>
                      ${tier.amount}
                    </span>
                    <span className="text-sm" style={{ color: 'var(--text-faint)' }}>
                      {tier.pages}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* How it works */}
            <div className="max-w-2xl mx-auto p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                How it works
              </h3>
              <div className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>1</span>
                  <span>Get a free Gemini API key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-sage)' }}>Google AI Studio <ExternalLink className="w-3 h-3 inline" /></a> — takes 30 seconds</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>2</span>
                  <span>Pick a book from the collection that needs OCR or translation</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>3</span>
                  <span>Watch pages process in real time — your API key is discarded the moment processing stops</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>4</span>
                  <span>Every page you process is permanently free for the world to read</span>
                </div>
              </div>
            </div>

            {/* Recent Contributors */}
            {stats && stats.recentContributors.length > 0 && (
              <div className="max-w-2xl mx-auto p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <h3 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                  Recent Contributors
                </h3>
                <div className="space-y-2">
                  {stats.recentContributors.map((c, i) => (
                    <div key={i} className="flex justify-between items-center py-2" style={{ borderBottom: i < stats.recentContributors.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {c.pages} pages &middot; {new Date(c.date).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Setup (API key + book selection) ── */}
        {step === 'setup' && (
          <div className="space-y-6">
            {/* Budget summary */}
            <div className="p-4 rounded-xl flex items-center justify-between" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setStep('generosity')} className="text-sm underline" style={{ color: 'var(--text-muted)' }}>
                  Change
                </button>
                <span style={{ color: 'var(--text-primary)' }}>
                  Budget: <strong>${costLimit}</strong>
                </span>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  ({tiers.find(t => t.id === generosity)?.pages})
                </span>
              </div>
              <div>
                <input
                  type="number"
                  value={costLimit}
                  onChange={(e) => setCostLimit(e.target.value)}
                  min="0.10"
                  max="500"
                  step="0.50"
                  className="w-20 px-3 py-1.5 rounded-lg text-sm text-right"
                  style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* API Key */}
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Your Gemini API Key
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Get one free at{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-sage)' }}>
                  aistudio.google.com <ExternalLink className="w-3 h-3 inline" />
                </a>
                {' '}&mdash; your key is never stored and is discarded after processing.
              </p>

              <div className="flex gap-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setKeyValid(null); }}
                  placeholder="AIza..."
                  className="flex-1 px-4 py-2 rounded-lg text-sm"
                  style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={validateKey}
                  disabled={!apiKey || apiKey.length < 20 || processing.status === 'validating'}
                  className="px-4 py-2 rounded-lg font-medium text-sm disabled:opacity-50"
                  style={{ background: 'var(--accent-sage)', color: 'white' }}
                >
                  {processing.status === 'validating' ? 'Checking...' : 'Validate'}
                </button>
              </div>

              {keyValid === true && (
                <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: '#22c55e' }}>
                  <CheckCircle className="w-4 h-4" />
                  Key is valid — you&apos;re ready to go
                </div>
              )}
              {keyValid === false && (
                <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: '#ef4444' }}>
                  <AlertCircle className="w-4 h-4" />
                  Invalid key &mdash; check your Gemini API key and try again
                </div>
              )}
            </div>

            {/* Name */}
            <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
              <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                Your Name
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                Shown on the contributors list. Leave blank to remain anonymous.
              </p>
              <input
                type="text"
                value={contributorName}
                onChange={(e) => setContributorName(e.target.value)}
                placeholder="Anonymous"
                className="w-full px-4 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
              />
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
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Read text from page images</div>
                </button>
                <button
                  onClick={() => setProcessType('translate')}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${processType === 'translate' ? 'border-[var(--accent-rust)]' : 'border-transparent'}`}
                  style={{ background: processType === 'translate' ? 'rgba(180, 110, 90, 0.1)' : 'var(--bg-warm)' }}
                >
                  <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Translate</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Translate text to English</div>
                </button>
              </div>
            </div>

            {/* Book Selection */}
            {keyValid && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
                  <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>Pick a book</h3>
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
                                ~${(remaining * 0.0008).toFixed(2)}
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

        {/* ── Step 3: Processing / Complete ── */}
        {step === 'processing' && (
          <>
            {processing.status === 'processing' || processing.status === 'complete' || processing.status === 'limit_reached' ? (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <div className="text-center mb-6">
                  {processing.status === 'processing' ? (
                    <BookLoader size="xs" />
                  ) : processing.status === 'limit_reached' ? (
                    <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#f59e0b' }} />
                  ) : (
                    <CheckCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#22c55e' }} />
                  )}
                  <h3 className="text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                    {processing.status === 'processing' ? 'Processing...' : processing.status === 'limit_reached' ? 'Budget reached' : 'Thank you!'}
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
                  {processing.costSpent !== undefined && (
                    <div className="flex justify-between text-sm mt-3">
                      <span style={{ color: 'var(--text-primary)' }}>Spent</span>
                      <span style={{ color: processing.costSpent >= (processing.costLimit || 1) ? '#f59e0b' : 'var(--text-muted)' }}>
                        ${processing.costSpent.toFixed(4)} / ${(processing.costLimit || 1).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {(processing.status === 'complete' || processing.status === 'limit_reached') && (
                  <div className="text-center">
                    <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                      You processed {processing.pagesCompleted} pages
                      {processing.costSpent ? ` for $${processing.costSpent.toFixed(4)}` : ''}.
                      {processing.pagesCompleted > 0 && ' These are now permanently free for anyone in the world to read.'}
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={resetAll}
                        className="px-5 py-2.5 rounded-lg font-medium"
                        style={{ background: 'var(--accent-sage)', color: 'white' }}
                      >
                        Process Another Book
                      </button>
                      <Link
                        href="/contribute"
                        className="px-5 py-2.5 rounded-lg font-medium"
                        style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)' }}
                      >
                        Back to Participate
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ) : processing.status === 'error' ? (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid #fecaca' }}>
                <div className="text-center">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#ef4444' }} />
                  <h3 className="text-xl font-medium mb-2" style={{ color: '#ef4444' }}>Error</h3>
                  <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>{processing.error}</p>
                  <button
                    onClick={() => { setStep('setup'); setProcessing({ status: 'idle', currentPage: 0, totalPages: 0, pagesCompleted: 0 }); }}
                    className="px-4 py-2 rounded-lg font-medium"
                    style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)' }}
                  >
                    Try Again
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
