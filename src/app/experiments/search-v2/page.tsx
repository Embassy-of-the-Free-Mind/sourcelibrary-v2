'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Search, Book, Lightbulb, User, ImageIcon, ChevronDown,
  Loader2, ChevronRight, Send, Square, MessageCircle,
} from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { search as searchApi } from '@/lib/api-client';
import type { SearchResult, IndexSearchResult } from '@/lib/api-client';
import { getBookThumbnailUrl } from '@/lib/utils';
import { bookUrl } from '@/lib/slugify';
import HighlightedText from '@/components/search/HighlightedText';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';

// ── Types ────────────────────────────────────────────────────────────

interface SearchStep {
  name: string;
  query: string;
  status: 'searching' | 'done';
  summary?: string;
  found?: number;
}

interface SourceCard {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber?: number;
  snippet?: string;
}

interface GalleryItem {
  pageId: string;
  bookId: string;
  detectionIndex: number;
  imageUrl: string;
  thumbnailUrl: string;
  bookTitle: string;
  description: string;
  type?: string;
}

// ── Page ─────────────────────────────────────────────────────────────

export default function SearchV2Page() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Librarian state
  const [librarianContent, setLibrarianContent] = useState('');
  const [librarianThinking, setLibrarianThinking] = useState('');
  const [librarianSteps, setLibrarianSteps] = useState<SearchStep[]>([]);
  const [librarianSources, setLibrarianSources] = useState<SourceCard[]>([]);
  const [librarianStreaming, setLibrarianStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Search agents state
  const [bookResults, setBookResults] = useState<SearchResult[]>([]);
  const [bookTotal, setBookTotal] = useState(0);
  const [indexResults, setIndexResults] = useState<IndexSearchResult[]>([]);
  const [indexTotal, setIndexTotal] = useState(0);
  const [imageResults, setImageResults] = useState<GalleryItem[]>([]);
  const [imageTotal, setImageTotal] = useState(0);
  const [semanticResults, setSemanticResults] = useState<any[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [semanticLoading, setSemanticLoading] = useState(false);

  // Accordion state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // ── Librarian stream ───────────────────────────────────────────────

  const startLibrarian = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLibrarianContent('');
    setLibrarianThinking('');
    setLibrarianSteps([]);
    setLibrarianSources([]);
    setLibrarianStreaming(true);

    try {
      const res = await fetch('/api/embassy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: q,
          history: [],
          visibility: 'private',
          stream: true,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLibrarianContent(err.error || 'The Librarian is unavailable right now.');
        setLibrarianStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let contentAccum = '';
      let thinkingAccum = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              switch (event.type) {
                case 'thinking':
                  thinkingAccum += event.text || '';
                  setLibrarianThinking(thinkingAccum);
                  break;
                case 'tool_call':
                  setLibrarianSteps(prev => [...prev, {
                    name: event.name,
                    query: event.query || '',
                    status: 'searching',
                  }]);
                  break;
                case 'tool_result':
                  setLibrarianSteps(prev => prev.map((s, i) =>
                    i === prev.length - 1 && s.status === 'searching'
                      ? { ...s, status: 'done', summary: event.summary, found: event.found }
                      : s
                  ));
                  break;
                case 'chunk':
                  contentAccum += event.text || '';
                  setLibrarianContent(contentAccum);
                  break;
                case 'sources':
                  setLibrarianSources((event.sources || []).map((s: any) => ({
                    bookId: s.book_id,
                    bookTitle: s.bookTitle,
                    bookAuthor: s.bookAuthor,
                    bookSlug: s.bookSlug,
                    pageNumber: s.pageNumber,
                    snippet: s.snippet,
                  })));
                  break;
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setLibrarianContent('The Librarian seems to be away. Please try again.');
      }
    }

    setLibrarianStreaming(false);
  }, []);

  // ── Search agents ──────────────────────────────────────────────────

  const startAgents = useCallback(async (q: string) => {
    setAgentsLoading(true);
    setSemanticLoading(true);

    // Unified search (books + index + gallery)
    try {
      const data = await searchApi.unified(q, { limit: 6, galleryLimit: 6 });
      setBookResults(data.books?.results || []);
      setBookTotal(data.books?.total || 0);
      setIndexResults((data.index?.results || []).slice(0, 5));
      setIndexTotal(data.index?.total || 0);

      const gallery = data.gallery?.results || [];
      setImageResults(gallery.map((g: any) => {
        const parts = (g.id || '').split('-');
        const detectionIndex = parseInt(parts.pop() || '0');
        const pageId = parts.join('-');
        return { pageId, bookId: g.bookId || '', detectionIndex, imageUrl: g.imageUrl || '', thumbnailUrl: g.imageUrl || '', bookTitle: g.bookTitle || '', description: g.description || '', type: g.type };
      }));
      setImageTotal(data.gallery?.total || 0);
    } catch {
      // silent
    }
    setAgentsLoading(false);

    // Semantic search (parallel)
    try {
      const res = await fetch(`/api/search/semantic?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json();
      const keywordIds = new Set(bookResults.map((b: any) => b.id || b.book_id));
      setSemanticResults((data.results || []).filter((s: any) => !keywordIds.has(s.book_id)));
    } catch {
      setSemanticResults([]);
    }
    setSemanticLoading(false);
  }, [bookResults]);

  // ── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;

    setSubmitted(true);
    setExpandedSections(new Set());

    // Fire both in parallel
    startLibrarian(q);
    startAgents(q);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setLibrarianStreaming(false);
  };

  // ── Render ─────────────────────────────────────────────────────────

  const hasAgentResults = bookTotal > 0 || indexTotal > 0 || imageTotal > 0 || semanticResults.length > 0;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <Link href="/" className="text-xs text-stone-400 uppercase tracking-widest mb-4 block">
            Source Library
          </Link>

          <form onSubmit={handleSubmit} className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ask anything about the collection..."
              className="w-full pl-12 pr-24 py-4 bg-stone-50 border border-stone-200 rounded-2xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 text-lg"
              autoFocus
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {librarianStreaming && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                  title="Stop"
                >
                  <Square className="w-4 h-4" />
                </button>
              )}
              <button
                type="submit"
                disabled={query.trim().length < 2}
                className="p-2 bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Results area */}
      {submitted && (
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

          {/* Librarian answer */}
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            {/* Search steps */}
            {librarianSteps.length > 0 && (
              <div className="px-5 pt-4 pb-2 space-y-1.5">
                {librarianSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-stone-500">
                    {step.status === 'searching' ? (
                      <Loader2 className="w-3 h-3 animate-spin text-violet-500" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                    )}
                    <span className="text-stone-400">{step.name.replace(/_/g, ' ')}</span>
                    {step.query && <span className="text-stone-600">"{step.query}"</span>}
                    {step.found !== undefined && <span className="text-stone-400">→ {step.found} found</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Thinking indicator */}
            {librarianStreaming && !librarianContent && librarianSteps.length === 0 && (
              <div className="px-5 pt-4 pb-2 flex items-center gap-2 text-sm text-stone-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching the library...
              </div>
            )}

            {/* Answer content */}
            {librarianContent && (
              <div className="px-5 py-4 prose prose-stone prose-sm max-w-none
                prose-p:leading-relaxed prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline
                prose-headings:font-serif prose-headings:text-stone-800
                prose-blockquote:border-violet-300 prose-blockquote:text-stone-600 prose-blockquote:not-italic">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {librarianContent}
                </ReactMarkdown>
                {librarianStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            )}

            {/* Sources */}
            {librarianSources.length > 0 && (
              <div className="px-5 pb-4 pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-400 uppercase tracking-wide mb-2">Sources</p>
                <div className="flex flex-wrap gap-2">
                  {librarianSources.map((src, i) => (
                    <Link
                      key={i}
                      href={src.pageNumber
                        ? `/book/${src.bookSlug || src.bookId}?page=${src.pageNumber}`
                        : `/book/${src.bookSlug || src.bookId}`
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-50 hover:bg-violet-50 rounded-lg text-xs text-stone-600 hover:text-violet-700 transition-colors"
                    >
                      <Book className="w-3 h-3" />
                      <span className="truncate max-w-[200px]">{src.bookTitle}</span>
                      {src.pageNumber && <span className="text-stone-400">p. {src.pageNumber}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Continue in reading room */}
            {librarianContent && !librarianStreaming && (
              <div className="px-5 pb-4">
                <Link
                  href={`/reading-room?q=${encodeURIComponent(query)}`}
                  className="inline-flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-700 transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Continue this conversation in the Reading Room
                </Link>
              </div>
            )}
          </div>

          {/* Search agents accordion */}
          {(hasAgentResults || agentsLoading || semanticLoading) && (
            <div className="space-y-2">
              <p className="text-xs text-stone-400 uppercase tracking-wide px-1">Evidence</p>

              {/* Books */}
              {(bookTotal > 0 || agentsLoading) && (
                <AccordionSection
                  title="Books"
                  count={bookTotal}
                  icon={<Book className="w-4 h-4 text-amber-700" />}
                  loading={agentsLoading && bookTotal === 0}
                  expanded={expandedSections.has('books')}
                  onToggle={() => toggleSection('books')}
                >
                  <div className="space-y-2">
                    {bookResults.slice(0, 5).map(r => (
                      <BookCard key={r.id} result={r} query={query} />
                    ))}
                    {bookTotal > 5 && (
                      <Link href={`/search?q=${encodeURIComponent(query)}&mode=books`} className="block text-center py-2 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                        See all {bookTotal} books →
                      </Link>
                    )}
                  </div>
                </AccordionSection>
              )}

              {/* Related (semantic) */}
              {(semanticResults.length > 0 || semanticLoading) && (
                <AccordionSection
                  title="Related"
                  count={semanticResults.length}
                  icon={<Lightbulb className="w-4 h-4 text-violet-500" />}
                  loading={semanticLoading}
                  expanded={expandedSections.has('semantic')}
                  onToggle={() => toggleSection('semantic')}
                >
                  <div className="space-y-2">
                    {semanticResults.slice(0, 5).map((sem: any) => (
                      <Link
                        key={sem.book_id}
                        href={`/book/${sem.book_id}`}
                        className="block p-3 rounded-lg hover:bg-violet-50/50 transition-colors"
                      >
                        <p className="font-medium text-stone-800 text-sm">{sem.title}</p>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {sem.author}{sem.year ? ` · ${sem.year}` : ''}
                          {sem.relevance_hint && <span className="text-violet-500"> · {sem.relevance_hint}</span>}
                        </p>
                        {sem.summary_snippet && (
                          <p className="text-xs text-stone-400 mt-1 line-clamp-2">{sem.summary_snippet}</p>
                        )}
                      </Link>
                    ))}
                  </div>
                </AccordionSection>
              )}

              {/* Concepts & People */}
              {indexTotal > 0 && (
                <AccordionSection
                  title="Concepts & People"
                  count={indexTotal}
                  icon={<User className="w-4 h-4 text-violet-500" />}
                  expanded={expandedSections.has('index')}
                  onToggle={() => toggleSection('index')}
                >
                  <div className="space-y-2">
                    {indexResults.slice(0, 5).map((item, idx) => (
                      <Link
                        key={`${item.book_id}-${item.type}-${idx}`}
                        href={item.pages?.[0] ? `/book/${item.book_id}/guide?page=${item.pages[0]}` : `/book/${item.book_id}`}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-stone-50 transition-colors"
                      >
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${ENTITY_TYPE_STYLES[item.type as EntityType]?.badge ?? 'bg-stone-100 text-stone-700'}`}>
                          {item.type}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-800">{item.term}</p>
                          <p className="text-xs text-stone-500 truncate">{item.book_title}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </AccordionSection>
              )}

              {/* Images */}
              {imageTotal > 0 && (
                <AccordionSection
                  title="Images"
                  count={imageTotal}
                  icon={<ImageIcon className="w-4 h-4 text-amber-600" />}
                  expanded={expandedSections.has('images')}
                  onToggle={() => toggleSection('images')}
                >
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {imageResults.slice(0, 6).map((img, idx) => (
                      <Link
                        key={`${img.pageId}-${img.detectionIndex}-${idx}`}
                        href={`/gallery/image/${img.pageId}-${img.detectionIndex}`}
                        className="aspect-square rounded-lg overflow-hidden bg-stone-100 hover:ring-2 hover:ring-violet-300 transition-all"
                      >
                        <Image
                          src={img.thumbnailUrl || img.imageUrl}
                          alt={img.description || ''}
                          width={120}
                          height={120}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      </Link>
                    ))}
                  </div>
                </AccordionSection>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!submitted && (
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <p className="text-stone-400 text-lg mb-6">Ask a question about the collection</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              'What did Paracelsus write about mercury?',
              'Books about the philosopher\'s stone',
              'Hermes Trismegistus',
              'Kabbalistic creation myths',
              'Egyptian afterlife rituals',
            ].map(suggestion => (
              <button
                key={suggestion}
                onClick={() => { setQuery(suggestion); inputRef.current?.focus(); }}
                className="px-4 py-2 bg-white border border-stone-200 rounded-full text-sm text-stone-600 hover:border-violet-300 hover:text-violet-700 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Accordion section component ────────────────────────────────────

function AccordionSection({
  title, count, icon, loading, expanded, onToggle, children,
}: {
  title: string;
  count?: number;
  icon: React.ReactNode;
  loading?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-stone-700 text-sm">{title}</span>
          {loading && <Loader2 className="w-3.5 h-3.5 text-stone-400 animate-spin" />}
          {!loading && count !== undefined && count > 0 && (
            <span className="text-xs text-stone-400">({count})</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Book result card ───────────────────────────────────────────────

function BookCard({ result, query }: { result: SearchResult; query: string }) {
  const cover = getBookThumbnailUrl({ thumbnail: result.thumbnail, thumbnail_blob: (result as any).thumbnail_blob }, 'thumb');
  const text = result.snippet || result.summary;

  return (
    <Link
      href={bookUrl(result)}
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-stone-50 transition-colors"
    >
      {cover ? (
        <div className="w-10 h-14 rounded overflow-hidden flex-shrink-0 bg-stone-100">
          <Image src={cover} alt="" width={40} height={56} className="w-full h-full object-cover" unoptimized />
        </div>
      ) : (
        <Book className="w-5 h-5 text-amber-700 flex-shrink-0 mt-1" />
      )}
      <div className="min-w-0">
        <h3 className="font-serif font-medium text-stone-800 text-sm leading-tight">
          <HighlightedText text={result.display_title || result.title} query={query} />
        </h3>
        <p className="text-xs text-stone-500 mt-0.5">
          <HighlightedText text={result.author} query={query} />
          {result.published ? ` · ${result.published}` : ''}
        </p>
        {text && <p className="text-xs text-stone-400 mt-1 line-clamp-2">{text}</p>}
      </div>
    </Link>
  );
}
