'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import LibrarianMessageBody from '@/app/librarian/_components/MessageBody';

interface ThreadMessage {
  id: string;
  authorType: 'human' | 'ai';
  authorName: string;
  content: string;
  createdAt: string;
}

interface ThreadData {
  id: string;
  title: string;
  // 'A reader' for everyone but the author — the API anonymises before it
  // serves, so this is never a real name unless isOwner is true.
  creatorName: string;
  creatorId?: string | null;
  isOwner?: boolean;
  visibility?: 'public' | 'private' | 'unlisted';
  messageCount: number;
  createdAt: string;
}

interface PodcastData {
  audioUrl: string;
  generatedAt: string;
  topic: string;
  findingCount: number;
  format: string;
  script?: string;
  published?: boolean;
}

type PodcastFormat = 'deep-dive' | 'brief' | 'critique' | 'guided-reading';

const FORMAT_OPTIONS: { value: PodcastFormat; label: string; desc: string }[] = [
  { value: 'deep-dive', label: 'Deep Dive', desc: 'Two hosts explore findings in depth' },
  { value: 'brief', label: 'The Brief', desc: '2-minute summary' },
  { value: 'critique', label: 'The Critique', desc: 'Critical analysis of sources' },
  { value: 'guided-reading', label: 'Guided Reading', desc: 'Commentary for reading alongside' },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Transcript ────────────────────────────────────────────────────────

function formatTranscript(script: string): { speaker: string; text: string }[] {
  return script
    .split('\n')
    .filter(line => line.includes(':'))
    .map(line => {
      const colonIdx = line.indexOf(':');
      const speaker = line.slice(0, colonIdx).trim();
      const text = line.slice(colonIdx + 1).trim()
        .replace(/\[(laughs|whispers|enthusiasm|thoughtful|determination)\]/gi, '');
      return { speaker, text };
    })
    .filter(entry => entry.text.length > 0);
}

// ── Illustration Gallery ──────────────────────────────────────────────

interface IllustrationImage {
  id: string;
  imageUrl: string;
  extractedUrl?: string;
  thumbnailUrl?: string;
  pageNumber: number;
  description?: string;
  museumDescription?: string;
  type?: string;
  bookTitle?: string;
  bookSlug?: string;
}

function IllustrationGallery({ threadId }: { threadId: string }) {
  const [images, setImages] = useState<(IllustrationImage & { bookId?: string })[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [primaryBookId, setPrimaryBookId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch notebook to get cited book IDs
    fetch(`/api/embassy/threads/${threadId}/notebook?format=json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.notebook?.findings) { setLoaded(true); return; }
        const bookIds = Array.from(new Set(data.notebook.findings.map((f: SourceFinding) => f.source.bookId))) as string[];
        if (bookIds.length > 0) setPrimaryBookId(bookIds[0]);
        // Fetch all images for each cited book
        Promise.all(
          bookIds.map(bid =>
            fetch(`/api/gallery?bookId=${bid}&limit=200`)
              .then(r => r.ok ? r.json() : null)
              .then(d => (d?.items || d?.images || []).map((img: IllustrationImage) => ({ ...img, bookId: bid })))
              .catch(() => [])
          )
        ).then(results => {
          const all = results.flat().sort((a: IllustrationImage, b: IllustrationImage) => (a.pageNumber || 0) - (b.pageNumber || 0));
          setImages(all);
          setLoaded(true);
        });
      })
      .catch(() => setLoaded(true));
  }, [threadId]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIdx === null) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxIdx(null);
      if (e.key === 'ArrowRight') setLightboxIdx(prev => prev !== null ? Math.min(prev + 1, images.length - 1) : null);
      if (e.key === 'ArrowLeft') setLightboxIdx(prev => prev !== null ? Math.max(prev - 1, 0) : null);
    }
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [lightboxIdx, images.length]);

  if (!loaded || images.length === 0) return null;

  const current = lightboxIdx !== null ? images[lightboxIdx] : null;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] text-[#6b6560] font-sans tracking-wide uppercase">
          Illustrations ({images.length})
        </p>
        {primaryBookId && (
          <a
            href={`/gallery?bookId=${primaryBookId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#9e4a3a] font-sans hover:underline"
          >
            View full gallery
          </a>
        )}
      </div>

      {/* Thumbnail grid */}
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-1.5">
        {images.map((img, i) => (
          <button
            key={img.id || i}
            onClick={() => setLightboxIdx(i)}
            className="group relative aspect-square overflow-hidden rounded-lg bg-[#f0ece4] focus:outline-none focus:ring-2 focus:ring-[#c9a86c]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.thumbnailUrl || `/api/image?url=${encodeURIComponent(img.extractedUrl || img.imageUrl)}&w=200&q=70`}
              alt={img.description || `Page ${img.pageNumber}`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
              loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-[9px] text-white font-sans">p. {img.pageNumber}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {current && lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIdx(null)}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxIdx(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Previous */}
          {lightboxIdx > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white z-10 p-2"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}

          {/* Next */}
          {lightboxIdx < images.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white z-10 p-2"
            >
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}

          {/* Image + caption */}
          <div
            className="flex flex-col items-center max-w-[90vw] max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.extractedUrl || `/api/image?url=${encodeURIComponent(current.imageUrl)}&w=1200&q=85`}
              alt={current.description || `Page ${current.pageNumber}`}
              className="max-h-[75vh] max-w-full object-contain rounded-lg"
            />
            <div className="mt-3 text-center max-w-lg">
              {(current.museumDescription || current.description) && (
                <p className="text-[13px] text-white/80 font-body leading-relaxed">
                  {current.museumDescription || current.description}
                </p>
              )}
              <p className="text-[11px] text-white/50 font-sans mt-1">
                Page {current.pageNumber}
                {current.type && <> &middot; {current.type}</>}
                {' '}&middot; {lightboxIdx + 1} of {images.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Source Cards ──────────────────────────────────────────────────────

interface SourceFinding {
  quote: string;
  note?: string;
  source: {
    bookId: string;
    bookTitle: string;
    bookAuthor: string;
    bookSlug?: string;
    pageNumber: number;
  };
}

function SourceCards({ threadId }: { threadId: string }) {
  const [findings, setFindings] = useState<SourceFinding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/embassy/threads/${threadId}/notebook?format=json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.notebook?.findings) {
          setFindings(data.notebook.findings);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [threadId]);

  if (!loaded || findings.length === 0) return null;

  // Deduplicate by book
  const books = new Map<string, { title: string; author: string; slug?: string; pages: number[]; quotes: string[] }>();
  for (const f of findings) {
    const key = f.source.bookId;
    const existing = books.get(key) || {
      title: f.source.bookTitle,
      author: f.source.bookAuthor,
      slug: f.source.bookSlug,
      pages: [],
      quotes: [],
    };
    if (!existing.pages.includes(f.source.pageNumber)) {
      existing.pages.push(f.source.pageNumber);
    }
    existing.quotes.push(f.quote.slice(0, 120));
    books.set(key, existing);
  }

  const bookList = [...books.entries()];

  // Roman-numeral markers up to XX cover any realistic citation count; fall
  // back to Arabic numerals past that. Decorative — they don't correspond
  // to inline footnote markers in the prose (yet).
  const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];

  return (
    <div className="mt-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[10px] text-[#8a8480] font-serif tracking-[0.25em] uppercase hover:text-[#9e4a3a] transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span>Cited works · {bookList.length} {bookList.length === 1 ? 'book' : 'books'}, {findings.length} {findings.length === 1 ? 'passage' : 'passages'}</span>
      </button>

      {expanded && (
        <div className="mt-6">
          {bookList.map(([bookId, book], idx) => {
            const bookSlug = book.slug || bookId;
            const sortedPages = [...book.pages].sort((a, b) => a - b);
            // Single-cited-page: card click jumps straight to that page. Multi-page:
            // each page number is its own link so the visible "Page N" label and the
            // destination always match (was a bug where card → /book/{slug} only).
            const cardHref = sortedPages.length === 1
              ? `https://sourcelibrary.org/book/${bookSlug}/page-number/${sortedPages[0]}`
              : `https://sourcelibrary.org/book/${bookSlug}`;
            const marker = ROMAN[idx] || `${idx + 1}`;
            const firstQuote = book.quotes[0];

            return (
              <article
                key={bookId}
                className="relative pl-14 py-8 border-t border-[#d8cdb6] last:border-b last:border-[#d8cdb6]"
              >
                <span
                  className="absolute left-0 top-8 font-serif text-[10px] tracking-[0.3em] uppercase text-[#9e4a3a]"
                  aria-hidden="true"
                >
                  {marker}
                </span>

                <a href={cardHref} target="_blank" rel="noopener noreferrer" className="block group">
                  <h3
                    className="font-serif text-[#1a1612] group-hover:text-[#9e4a3a] transition-colors"
                    style={{ fontSize: '22px', fontWeight: 400, lineHeight: 1.2, letterSpacing: '-0.005em' }}
                  >
                    {book.title}
                  </h3>
                </a>

                <p className="mt-1.5 text-[13px] italic font-serif text-[#6b6560]">
                  {book.author}
                </p>

                <p className="mt-3.5 text-[10px] tracking-[0.16em] uppercase font-serif text-[#8a8480]">
                  {sortedPages.length === 1 ? (
                    <a
                      href={`https://sourcelibrary.org/book/${bookSlug}/page-number/${sortedPages[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#9e4a3a] hover:text-[#7e3a2d] border-b border-[#9e4a3a]/30 hover:border-[#9e4a3a] pb-px transition-colors"
                    >
                      read at page {sortedPages[0]} &rarr;
                    </a>
                  ) : (
                    <>
                      <span>read at pages </span>
                      {sortedPages.map((p, i) => (
                        <span key={p}>
                          <a
                            href={`https://sourcelibrary.org/book/${bookSlug}/page-number/${p}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#9e4a3a] hover:text-[#7e3a2d] border-b border-[#9e4a3a]/30 hover:border-[#9e4a3a] pb-px transition-colors"
                          >
                            {p}
                          </a>
                          {i < sortedPages.length - 1 ? <span>, </span> : null}
                        </span>
                      ))}
                    </>
                  )}
                </p>

                {firstQuote && (
                  <p className="mt-4 text-[13px] leading-[1.55] italic font-serif text-[#444039] max-w-[520px]">
                    &ldquo;{firstQuote}&hellip;&rdquo;
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Interactive Mode — Ask the Hosts ──────────────────────────────────

interface InteractiveExchange {
  question: string;
  script: string;
  audioUrl: string | null;
}

function AskWhileListening({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<InteractiveExchange[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const handleAsk = useCallback(async () => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setLoading(true);
    setQuestion('');

    try {
      const res = await fetch(`/api/embassy/threads/${threadId}/podcast/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setExchanges(prev => [...prev, { question: q, script: err.error || 'Could not generate response.', audioUrl: null }]);
        return;
      }

      const data = await res.json();
      const exchange: InteractiveExchange = {
        question: q,
        script: data.script || '',
        audioUrl: data.audioUrl || null,
      };
      setExchanges(prev => [...prev, exchange]);

      // Auto-play the audio response
      if (data.audioUrl && audioRef.current) {
        audioRef.current.src = data.audioUrl;
        audioRef.current.play().catch(() => {});
      }
    } catch {
      setExchanges(prev => [...prev, { question: q, script: 'Network error — please try again.', audioUrl: null }]);
    } finally {
      setLoading(false);
    }
  }, [question, loading, threadId]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-[12px] text-[#9e4a3a] font-sans hover:underline flex items-center gap-1"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
        Ask Elena &amp; Marcus a question
      </button>
    );
  }

  return (
    <div className="mt-3 p-3 bg-white rounded-lg border border-[#e0d9cc]">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAsk()}
          placeholder="Ask Elena & Marcus anything..."
          className="flex-1 text-sm font-body px-3 py-2 border border-[#ddd] rounded-lg focus:outline-none focus:border-[#9e4a3a] text-[#1a1612]"
          disabled={loading}
        />
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="px-3 py-2 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] disabled:opacity-50"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : 'Ask'}
        </button>
        <button
          onClick={() => { setOpen(false); setExchanges([]); setQuestion(''); }}
          className="px-2 py-2 text-[#8a8480] hover:text-[#444] text-sm"
        >
          x
        </button>
      </div>
      {/* Hidden audio element for playing responses */}
      <audio ref={audioRef} className="hidden" />
      {loading && (
        <p className="mt-2 text-[12px] text-[#8a8480] font-sans animate-pulse">
          Elena and Marcus are thinking... <span className="opacity-60">(this can take up to a minute)</span>
        </p>
      )}
      {exchanges.map((ex, i) => (
        <div key={i} className="mt-3 pt-3 border-t border-[#e8e4dc]">
          <p className="text-[12px] text-[#8a8480] font-sans mb-2">You asked: &ldquo;{ex.question}&rdquo;</p>
          <div className="space-y-1.5">
            {formatTranscript(ex.script).map((entry, j) => (
              <p key={j} className="text-[13px] font-body leading-relaxed text-[#333]">
                <span className="font-semibold text-[#1a1612]">{entry.speaker}:</span>{' '}
                {entry.text}
              </p>
            ))}
          </div>
          {ex.audioUrl && (
            <audio controls src={ex.audioUrl} className="w-full mt-2" preload="metadata" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Podcast Player ────────────────────────────────────────────────────

function PodcastPlayer({ threadId, isOwner }: { threadId: string; isOwner: boolean }) {
  const [podcasts, setPodcasts] = useState<Record<string, PodcastData>>({});
  const [selectedFormat, setSelectedFormat] = useState<PodcastFormat>('deep-dive');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const activePodcast = podcasts[selectedFormat] || null;

  // Load all existing podcasts on mount
  useEffect(() => {
    fetch(`/api/embassy/threads/${threadId}/podcast?all=true`)
      .then(r => r.ok ? r.json() : { podcasts: {} })
      .then(data => {
        setPodcasts(data.podcasts || {});
        // Select first available format
        const available = Object.keys(data.podcasts || {});
        if (available.length > 0) {
          setSelectedFormat(available[0] as PodcastFormat);
        }
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [threadId]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/embassy/threads/${threadId}/podcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: selectedFormat }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Generation failed');
        return;
      }
      setPodcasts(prev => ({ ...prev, [selectedFormat]: data.podcast }));
    } catch {
      setError('Network error — please try again');
    } finally {
      setGenerating(false);
    }
  }, [threadId, selectedFormat]);

  const handlePublish = useCallback(async (publish: boolean) => {
    await fetch(`/api/embassy/threads/${threadId}/podcast`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: selectedFormat, published: publish }),
    });
    setPodcasts(prev => ({
      ...prev,
      [selectedFormat]: { ...prev[selectedFormat], published: publish },
    }));
  }, [threadId, selectedFormat]);

  if (!checked) return null;

  return (
    <div className="mt-8">
      {/* Format selector */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {FORMAT_OPTIONS.map(opt => {
          const hasEpisode = !!podcasts[opt.value];
          return (
            <button
              key={opt.value}
              onClick={() => { setSelectedFormat(opt.value); setShowTranscript(false); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-sans transition-colors ${
                selectedFormat === opt.value
                  ? 'bg-[#1a1612] text-white'
                  : hasEpisode
                    ? 'bg-[#f5f0e8] text-[#1a1612] hover:bg-[#ebe5d8]'
                    : 'bg-[#f5f0e8]/50 text-[#8a8480] hover:bg-[#f5f0e8]'
              }`}
              title={opt.desc}
            >
              {opt.label}
              {hasEpisode && selectedFormat !== opt.value && (
                <span className="ml-1 w-1.5 h-1.5 bg-[#9e4a3a] rounded-full inline-block" />
              )}
            </button>
          );
        })}
      </div>

      {/* Active podcast or generate prompt */}
      {activePodcast ? (
        <div className="p-5 bg-[#f5f0e8] rounded-xl border border-[#e0d9cc]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-[#9e4a3a]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
              <p className="text-sm font-sans font-medium text-[#1a1612]">
                {FORMAT_OPTIONS.find(f => f.value === selectedFormat)?.label} — {activePodcast.topic}
              </p>
            </div>
            <button
              onClick={() => handlePublish(!activePodcast.published)}
              className={`text-[11px] font-sans px-2 py-0.5 rounded ${
                activePodcast.published
                  ? 'bg-[#9e4a3a]/10 text-[#9e4a3a]'
                  : 'bg-[#e8e4dc] text-[#6b6560] hover:bg-[#ddd]'
              }`}
              title={activePodcast.published ? 'Published to podcast feed' : 'Publish to podcast feed'}
            >
              {activePodcast.published ? 'Published' : 'Publish'}
            </button>
          </div>
          <audio
            controls
            src={activePodcast.audioUrl}
            className="w-full"
            preload="metadata"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-[#8a8480] font-sans">
              {activePodcast.findingCount} findings
              {activePodcast.published && (
                <span className="ml-2">
                  <a
                    href="/api/podcast/feed.xml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#9e4a3a] hover:underline"
                  >
                    RSS feed
                  </a>
                </span>
              )}
            </p>
            {activePodcast.script && (
              <button
                onClick={() => setShowTranscript(!showTranscript)}
                className="text-[11px] text-[#9e4a3a] font-sans hover:underline"
              >
                {showTranscript ? 'Hide transcript' : 'Show transcript'}
              </button>
            )}
          </div>
          {showTranscript && activePodcast.script && (
            <div className="mt-3 pt-3 border-t border-[#e0d9cc] space-y-2 max-h-[400px] overflow-y-auto">
              {formatTranscript(activePodcast.script).map((entry, i) => (
                <p key={i} className="text-[13px] font-body leading-relaxed text-[#333]">
                  <span className="font-semibold text-[#1a1612]">{entry.speaker}:</span>{' '}
                  {entry.text}
                </p>
              ))}
            </div>
          )}

          {/* Interactive mode */}
          <AskWhileListening threadId={threadId} />
        </div>
      ) : (
        <div className="p-5 bg-[#f5f0e8]/50 rounded-xl border border-[#e0d9cc] border-dashed text-center">
          <p className="text-sm font-sans font-medium text-[#1a1612] mb-1">
            {FORMAT_OPTIONS.find(f => f.value === selectedFormat)?.label}
          </p>
          <p className="text-[13px] text-[#6b6560] font-body mb-3">
            {FORMAT_OPTIONS.find(f => f.value === selectedFormat)?.desc}
          </p>
          {isOwner ? (
            <>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Elena &amp; Marcus are writing...
                </>
              ) : (
                'Generate'
              )}
            </button>
            {generating && (
              <p className="text-[11px] text-[#8a8480] font-sans mt-2">This usually takes 30–60 seconds</p>
            )}
            {error && (
              <p className="text-xs text-red-600 font-sans mt-2">{error}</p>
            )}
          </>
          ) : (
            <p className="text-[12px] text-[#8a8480] font-sans">
              Only the thread creator can generate podcasts.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Thread Page ───────────────────────────────────────────────────────

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/embassy/threads/${id}`)
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(data => {
        setThread(data.thread);
        setMessages(data.messages);
        setLoading(false);
      })
      .catch(() => {
        setError('Thread not found');
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Librarian', href: '/librarian' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16">
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Librarian', href: '/librarian' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16 text-center">
          <h1 className="text-2xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            Thread not found
          </h1>
          <Link href="/librarian" className="text-sm text-[#9e4a3a] hover:underline font-sans">
            Return to the Librarian
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'The Librarian', href: '/librarian' }]} />

      <div className="max-w-[680px] mx-auto px-6 py-8 md:py-12">
        <Link
          href="/librarian"
          className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase hover:text-[#444] transition-colors font-sans"
        >
          The Librarian
        </Link>

        <div className="mt-4 mb-8">
          <h1
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mb-2 leading-snug"
            style={{ fontWeight: 400 }}
          >
            {thread.title}
          </h1>
          <div className="flex items-center gap-3">
            <p className="text-[12px] text-[#8a8480] font-sans">
              {thread.creatorName} &middot; {formatDate(thread.createdAt)}
            </p>
            {thread.isOwner && (
              <button
                onClick={async () => {
                  const listed = thread.visibility === 'public';
                  const res = await fetch(`/api/embassy/threads/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listed: !listed }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setThread(t => (t ? { ...t, visibility: data.visibility } : t));
                  }
                }}
                className="text-[11px] text-[#b0a89c] hover:text-[#6b6560] font-sans transition-colors"
                title={thread.visibility === 'public'
                  ? 'Listed in Recent, without your name. Click to remove it.'
                  : 'Not listed. Click to add it to Recent, without your name.'}
              >
                {thread.visibility === 'public' ? 'Listed' : 'Not listed'}
              </button>
            )}
            {thread.isOwner && (
              <button
                onClick={async () => {
                  if (!confirm('Delete this conversation? This cannot be undone.')) return;
                  setDeleting(true);
                  try {
                    const res = await fetch(`/api/embassy/threads/${id}`, { method: 'DELETE' });
                    if (res.ok) router.push('/librarian');
                    else setDeleting(false);
                  } catch { setDeleting(false); }
                }}
                disabled={deleting}
                className="text-[11px] text-[#b0a89c] hover:text-[#9e4a3a] font-sans transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className="flex gap-3">
              {msg.authorType === 'ai' ? (
                <img
                  src="/brand/png/icon-only--black-on-transparent--96h.png"
                  alt="Librarian"
                  className="flex-shrink-0 w-10 h-10 rounded-full"
                />
              ) : (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#1a1612] flex items-center justify-center text-white text-xs font-sans">
                  {msg.authorName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[#8a8480] font-sans mb-1">
                  {msg.authorName}
                </p>
                {msg.authorType === 'ai' ? (
                  <LibrarianMessageBody content={msg.content} variant="thread" />
                ) : (
                  <p className="text-[15px] font-body leading-relaxed text-[#1a1612] whitespace-pre-wrap">
                    {msg.content}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Podcast section */}
        <PodcastPlayer threadId={id} isOwner={!!thread.isOwner} />

        {/* Illustrations from cited books */}
        <IllustrationGallery threadId={id} />

        {/* Source books used in this research */}
        <SourceCards threadId={id} />

        <div className="mt-12 pt-8 border-t border-[#e8e4dc] text-center">
          <p className="text-[#6b6560] text-sm font-body mb-3">
            Want to explore this topic further?
          </p>
          <Link
            href="/librarian"
            className="inline-block px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors"
          >
            Ask the Librarian
          </Link>
        </div>
      </div>
    </div>
  );
}
