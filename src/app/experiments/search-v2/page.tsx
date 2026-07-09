'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Search, Book, Lightbulb, User, ImageIcon, ChevronDown,
  Loader2, ChevronRight, Square,
} from 'lucide-react';
import { search as searchApi } from '@/lib/api-client';
import type { SearchResult, IndexSearchResult } from '@/lib/api-client';
import { getBookThumbnailUrl } from '@/lib/utils';
import { bookUrl } from '@/lib/slugify';
import { applyCitationFixes, applyImageRemovals } from '@/lib/embassy/citation-fixes';
import HighlightedText from '@/components/search/HighlightedText';
import { ENTITY_TYPE_STYLES, type EntityType } from '@/lib/style-constants';
import SiteHeader from '@/components/layout/SiteHeader';
import LibrarianMessageBody from '@/app/librarian/_components/MessageBody';

const TOOL_LABELS: Record<string, string> = {
  search_collection: 'Searching the collection',
  search_semantic: 'Semantic search',
  search_wikipedia: 'Checking Wikipedia',
  get_book_page: 'Reading a page',
  present_choices: 'Thinking...',
};

const SUGGESTIONS = [
  'What did Paracelsus write about mercury?',
  'How did alchemists describe the philosopher\'s stone?',
  'Tell me about the Emerald Tablet',
  'What is the Kabbalah\'s tree of life?',
  'Books about Egyptian afterlife rituals',
];

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
  inCollection?: boolean;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Librarian state
  const [librarianContent, setLibrarianContent] = useState('');
  const [librarianThinking, setLibrarianThinking] = useState('');
  const [librarianSteps, setLibrarianSteps] = useState<SearchStep[]>([]);
  const [librarianSources, setLibrarianSources] = useState<SourceCard[]>([]);
  const [librarianStreaming, setLibrarianStreaming] = useState(false);
  const [librarianChoices, setLibrarianChoices] = useState<{ text: string; options: string[] } | null>(null);
  const [showThinking, setShowThinking] = useState(false);
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

  // Accordion
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
    setLibrarianChoices(null);
    setLibrarianStreaming(true);

    try {
      const res = await fetch('/api/embassy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, history: [], visibility: 'private', stream: true }),
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
                  setLibrarianSteps(prev => [...prev, { name: event.name, query: event.query || '', status: 'searching' }]);
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
                case 'citation_fixes':
                  contentAccum = applyCitationFixes(contentAccum, event.fixes || []);
                  setLibrarianContent(contentAccum);
                  break;
                case 'image_removals':
                  contentAccum = applyImageRemovals(contentAccum, event.removeUrls || []);
                  setLibrarianContent(contentAccum);
                  break;
                case 'choices':
                  setLibrarianChoices({ text: event.text, options: event.options });
                  break;
                case 'sources':
                  setLibrarianSources((event.sources || []).map((s: any) => ({
                    bookId: s.book_id, bookTitle: s.bookTitle, bookAuthor: s.bookAuthor,
                    bookSlug: s.bookSlug, pageNumber: s.pageNumber, snippet: s.snippet,
                    inCollection: s.inCollection !== false,
                  })));
                  break;
              }
            } catch { /* skip */ }
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

  const startAgents = useCallback((q: string) => {
    setAgentsLoading(true);
    setSemanticLoading(true);

    searchApi.unified(q, { limit: 6, galleryLimit: 6 })
      .then(data => {
        const books = data.books?.results || [];
        setBookResults(books);
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
        if (books.length > 0) setExpandedSections(prev => new Set([...prev, 'books']));
      })
      .catch(() => {})
      .finally(() => setAgentsLoading(false));

    fetch(`/api/search/semantic?q=${encodeURIComponent(q)}&limit=8`)
      .then(r => r.json())
      .then(data => {
        const results = data.results || [];
        setSemanticResults(results);
        if (results.length > 0) setExpandedSections(prev => new Set([...prev, 'semantic']));
      })
      .catch(() => setSemanticResults([]))
      .finally(() => setSemanticLoading(false));
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSubmitted(true);
    setExpandedSections(new Set());
    startLibrarian(q);
    startAgents(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const hasAgentResults = bookTotal > 0 || indexTotal > 0 || imageTotal > 0 || semanticResults.length > 0;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Empty state — before first search */}
        {!submitted && (
          <div className="text-center pt-16 pb-8">
            <img
              src="/brand/png/icon-only--black-on-transparent--96h.png"
              alt="Librarian"
              className="w-16 h-16 mx-auto mb-4 opacity-60"
            />
            <h1 className="text-2xl font-serif text-[#1a1612] mb-2">Search the Library</h1>
            <p className="text-[#8a8480] text-sm font-body max-w-[400px] mx-auto leading-relaxed">
              The Librarian searches the collection, Wikipedia, and semantic search
              to find answers in over 10,000 rare books.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-6">
              {SUGGESTIONS.map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setQuery(suggestion); inputRef.current?.focus(); }}
                  className="px-3 py-1.5 text-xs text-[#6b6560] border border-[#e8e4dc] rounded-full hover:bg-white hover:text-[#444] transition-colors font-sans"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input — always visible */}
        <div className="mb-6">
          <form onSubmit={handleSubmit} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the Librarian..."
              rows={1}
              className="flex-1 resize-none border border-[#e8e4dc] rounded-lg px-4 py-2.5 text-[15px] font-body text-[#1a1612] placeholder-[#8a8480] focus:outline-none focus:border-[#c9a86c] transition-colors bg-white"
            />
            {librarianStreaming ? (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); setLibrarianStreaming(false); }}
                className="flex-shrink-0 px-5 py-2.5 bg-[#9e4a3a] text-white rounded-lg text-sm font-sans hover:bg-[#8b3d30] transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={query.trim().length < 2}
                className="flex-shrink-0 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Search
              </button>
            )}
          </form>
        </div>

        {/* Librarian response */}
        {submitted && (
          <div className="flex gap-3 mb-8">
            <img
              src="/brand/png/icon-only--black-on-transparent--96h.png"
              alt="Librarian"
              className="flex-shrink-0 w-10 h-10 rounded-full"
            />
            <div className="max-w-[85%] min-w-0 flex-1">
              {/* Thinking */}
              {librarianThinking && (
                <div className="mb-2">
                  <button
                    onClick={() => setShowThinking(!showThinking)}
                    className="text-[11px] text-[#b0a89c] hover:text-[#8a8480] font-sans transition-colors"
                  >
                    {showThinking ? 'Hide reasoning' : 'Show reasoning'}
                  </button>
                  {showThinking && (
                    <div className="mt-1 text-[13px] text-[#8a8480] font-body italic leading-relaxed bg-[#faf8f4] rounded px-3 py-2 border-l-2 border-[#e8e4dc]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{librarianThinking}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {/* Search steps */}
              {librarianSteps.length > 0 && (
                <div className="space-y-1 mb-2">
                  {librarianSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] font-sans text-[#8a8480]">
                      <span className={`inline-block w-3.5 text-center ${step.status === 'done' ? (step.found && step.found > 0 ? 'text-[#6b8f5e]' : 'text-[#b0a89c]') : 'text-[#c9a86c]'}`}>
                        {step.status === 'searching' ? (
                          <span className="inline-block animate-pulse">...</span>
                        ) : step.found && step.found > 0 ? (
                          <span>&#x2713;</span>
                        ) : (
                          <span>&#x2717;</span>
                        )}
                      </span>
                      <span>
                        {TOOL_LABELS[step.name] || step.name}
                        {step.query && <span className="text-[#b0a89c]"> &ldquo;{step.query.slice(0, 50)}{step.query.length > 50 ? '...' : ''}&rdquo;</span>}
                        {step.status === 'done' && step.summary && (
                          <span className="text-[#6b6560]"> &mdash; {step.summary}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Loading state */}
              {!librarianContent && !librarianThinking && librarianSteps.length === 0 && librarianStreaming && (
                <div className="bg-[#f5f0e8] rounded-2xl rounded-bl-sm px-4 py-3">
                  <p className="text-[13px] text-[#8a8480] font-body italic animate-pulse">Thinking...</p>
                </div>
              )}

              {/* Response bubble */}
              {librarianContent && (
                <div className="bg-white text-[#1a1612] rounded-2xl rounded-bl-sm px-4 py-3 border border-[#e8e4dc]">
                  <LibrarianMessageBody content={librarianContent} variant="thread" />
                  {librarianStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-[#c9a86c] animate-pulse ml-0.5 align-text-bottom" />
                  )}
                </div>
              )}

              {/* Source cards */}
              {librarianSources.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {librarianSources.map((s, i) => {
                    const url = s.bookSlug
                      ? `/book/${s.bookSlug}${s.pageNumber ? `?page=${s.pageNumber}` : ''}`
                      : `/book/${s.bookId}${s.pageNumber ? `?page=${s.pageNumber}` : ''}`;
                    return (
                      <Link
                        key={`${s.bookId}-${s.pageNumber}-${i}`}
                        href={url}
                        className={`flex-shrink-0 w-[200px] rounded-lg border p-2.5 transition-colors ${
                          s.inCollection !== false
                            ? 'border-[#e8e4dc] bg-white hover:border-[#c9a86c] hover:bg-[#faf8f4]'
                            : 'border-dashed border-[#d4d0c8] bg-[#f9f7f3] opacity-60'
                        }`}
                      >
                        <p className="text-[12px] font-body text-[#1a1612] font-medium leading-tight line-clamp-2">
                          {s.bookTitle}
                        </p>
                        <p className="text-[10px] text-[#8a8480] font-body mt-0.5">
                          {s.bookAuthor}
                          {s.pageNumber ? ` · p. ${s.pageNumber}` : ''}
                        </p>
                        {s.snippet && (
                          <p className="text-[10px] text-[#6b6560] font-body mt-1 line-clamp-2 italic leading-relaxed">
                            {s.snippet}
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}

              {/* Choice chips */}
              {librarianChoices && (
                <div className="mt-3">
                  {librarianChoices.text && (
                    <p className="text-[13px] text-[#6b6560] font-body mb-2 italic">{librarianChoices.text}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {librarianChoices.options.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => {
                          setQuery(opt);
                          setLibrarianChoices(null);
                          setExpandedSections(new Set());
                          startLibrarian(opt);
                          startAgents(opt);
                        }}
                        className="px-3 py-1.5 text-[13px] text-[#1a1612] border border-[#c9a86c] rounded-full hover:bg-[#c9a86c] hover:text-white transition-colors font-body"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Search agents accordion — "Evidence" */}
        {submitted && (hasAgentResults || agentsLoading || semanticLoading) && (
          <div className="space-y-2 mt-4">
            <p className="text-[11px] text-[#b0a89c] uppercase tracking-wide font-sans px-1">Evidence</p>

            {/* Books */}
            {(bookTotal > 0 || agentsLoading) && (
              <AccordionSection
                title="Books"
                count={bookTotal}
                icon={<Book className="w-4 h-4 text-[#9e4a3a]" />}
                loading={agentsLoading && bookTotal === 0}
                expanded={expandedSections.has('books')}
                onToggle={() => toggleSection('books')}
              >
                <div className="space-y-3">
                  {bookResults.slice(0, 5).map(r => (
                    <BookResultCard key={r.id} result={r} query={query} />
                  ))}
                  {bookTotal > 5 && (
                    <Link href={`/search?q=${encodeURIComponent(query)}&mode=books`} className="block text-center py-2 text-[13px] text-[#9e4a3a] hover:bg-[#faf8f4] rounded-lg transition-colors font-sans">
                      See all {bookTotal} books →
                    </Link>
                  )}
                </div>
              </AccordionSection>
            )}

            {/* Related in the Library (semantic) */}
            {(semanticResults.length > 0 || semanticLoading) && (
              <AccordionSection
                title="Related in the Library"
                count={semanticResults.length}
                icon={<Lightbulb className="w-4 h-4 text-[#c9a86c]" />}
                loading={semanticLoading}
                expanded={expandedSections.has('semantic')}
                onToggle={() => toggleSection('semantic')}
              >
                <div className="space-y-3">
                  {semanticResults.slice(0, 5).map((sem: any) => (
                    <Link
                      key={sem.book_id}
                      href={`/book/${sem.book_id}`}
                      className="flex items-start gap-3 p-3 bg-[#faf8f4] rounded-lg hover:bg-[#f0ece4] transition-colors"
                    >
                      {sem.metadata?.thumbnail && (
                        <Image src={sem.metadata.thumbnail} alt="" width={48} height={68} className="rounded shadow-sm flex-shrink-0 object-cover" unoptimized />
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-serif font-medium text-[#1a1612] text-sm leading-tight line-clamp-1">
                          {sem.title}
                        </h3>
                        <p className="text-xs text-[#8a8480] font-body mt-0.5">
                          {sem.author}{sem.year ? `, ${sem.year}` : ''}
                        </p>
                        {sem.relevance_hint && (
                          <p className="text-xs text-[#8a8480] font-body mt-0.5">{sem.relevance_hint}</p>
                        )}
                        {sem.summary_snippet && (
                          <p className="text-xs text-[#6b6560] font-body mt-1 line-clamp-2">{sem.summary_snippet}</p>
                        )}
                      </div>
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
                icon={<User className="w-4 h-4 text-[#8a8480]" />}
                expanded={expandedSections.has('index')}
                onToggle={() => toggleSection('index')}
              >
                <div className="space-y-1">
                  {indexResults.slice(0, 5).map((item, idx) => (
                    <Link
                      key={`${item.book_id}-${item.type}-${idx}`}
                      href={item.pages?.[0] ? `/book/${item.book_id}/guide?page=${item.pages[0]}` : `/book/${item.book_id}`}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#faf8f4] transition-colors"
                    >
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ENTITY_TYPE_STYLES[item.type as EntityType]?.badge ?? 'bg-[#e8e4dc] text-[#6b6560]'}`}>
                        {item.type}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-body font-medium text-[#1a1612]">
                          <HighlightedText text={item.term} query={query} />
                        </p>
                        <p className="text-[11px] text-[#8a8480] font-body truncate">{item.book_title}</p>
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
                icon={<ImageIcon className="w-4 h-4 text-[#c9a86c]" />}
                expanded={expandedSections.has('images')}
                onToggle={() => toggleSection('images')}
              >
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {imageResults.slice(0, 6).map((img, idx) => (
                    <Link
                      key={`${img.pageId}-${img.detectionIndex}-${idx}`}
                      href={`/gallery/image/${img.pageId}-${img.detectionIndex}`}
                      className="aspect-square rounded-lg overflow-hidden bg-[#e8e4dc] hover:ring-2 hover:ring-[#c9a86c] transition-all"
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
    </div>
  );
}

// ── Accordion ────────────────────────────────────────────────────────

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
    <div className="bg-white rounded-xl border border-[#e8e4dc] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#faf8f4] transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-sans font-medium text-[#1a1612] text-[13px]">{title}</span>
          {loading && <Loader2 className="w-3.5 h-3.5 text-[#c9a86c] animate-spin" />}
          {!loading && count !== undefined && count > 0 && (
            <span className="text-[11px] text-[#b0a89c] font-sans">({count})</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-[#b0a89c] transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ── Book card ────────────────────────────────────────────────────────

function BookResultCard({ result, query }: { result: SearchResult; query: string }) {
  const cover = getBookThumbnailUrl({ thumbnail: result.thumbnail, thumbnail_blob: (result as any).thumbnail_blob });
  const text = result.snippet || result.summary;

  return (
    <Link
      href={result.type === 'page' ? `/book/${result.slug || result.book_id}/page-number/${result.page_number}` : bookUrl(result)}
      className="flex items-start gap-3 p-3 bg-[#faf8f4] rounded-lg hover:bg-[#f0ece4] transition-colors"
    >
      {cover && (
        <Image src={cover} alt="" width={48} height={68} className="rounded shadow-sm flex-shrink-0 object-cover" unoptimized />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="font-serif font-medium text-[#1a1612] text-sm leading-tight line-clamp-1">
          <HighlightedText text={result.display_title || result.title} query={query} />
        </h3>
        <p className="text-xs text-[#8a8480] font-body mt-0.5">
          <HighlightedText text={result.author} query={query} />
          {result.published ? `, ${result.published}` : ''}
          {result.type === 'page' && result.page_number && <span> · p. {result.page_number}</span>}
        </p>
        {text && <p className="text-xs text-[#6b6560] font-body mt-1 line-clamp-2">{text}</p>}
      </div>
    </Link>
  );
}
