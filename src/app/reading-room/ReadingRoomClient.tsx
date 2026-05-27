'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tenantBookUrl } from '@/lib/slugify';
// remarkBreaks removed — we use ensureParagraphBreaks() instead for proper spacing
import SiteHeader from '@/components/layout/SiteHeader';

/**
 * Post-process Gemini output: convert bare sourcelibrary URLs to markdown links.
 * Gemini often outputs `https://sourcelibrary.org/book/slug?page=5` as plain text
 * instead of wrapping it in `[text](url)`. This catches those and linkifies them.
 */
function linkifySourceUrls(text: string): string {
  // Don't linkify URLs that are already inside markdown link syntax [text](url)
  let result = text.replace(
    /(?<!\]\()https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+)(?:\?page=(\d+))?/g,
    (match, _slug, page) => {
      const label = page ? `View source (p. ${page})` : 'View in collection';
      return `[${label}](${match})`;
    },
  );
  // Linkify bare author URLs
  result = result.replace(
    /(?<!\]\()https:\/\/sourcelibrary\.org\/author\/([^\s)]+)/g,
    (match, name) => {
      const label = decodeURIComponent(name);
      return `[${label}](${match})`;
    },
  );
  return result;
}

/**
 * Ensure proper markdown paragraph breaks.
 * Gemini often outputs single \n between paragraphs, but standard markdown
 * needs \n\n for a visible paragraph break. Simple approach: double ALL
 * single newlines, then collapse any runs of 3+ newlines back to 2.
 * Only exception: code blocks are left untouched.
 */
function ensureParagraphBreaks(text: string): string {
  // Split on code fences, process only non-code sections
  const parts = text.split(/(```[\s\S]*?```)/);
  return parts.map((part, i) => {
    // Odd indices are code blocks — leave them alone
    if (i % 2 === 1) return part;
    // Replace single \n with \n\n, then collapse triples back to doubles
    return part
      .replace(/([^\n])\n(?!\n)/g, '$1\n\n')
      .replace(/\n{3,}/g, '\n\n');
  }).join('');
}

// ── Types ─────────────────────────────────────────────────────────────

interface SourceCard {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookSlug?: string;
  pageNumber?: number;
  snippet?: string;
  inCollection: boolean;
}

interface SearchStep {
  name: string;
  query: string;
  summary?: string;
  found?: number;
  status: 'searching' | 'done';
}

interface AssistantMessage {
  role: 'assistant';
  thinking?: string;
  steps: SearchStep[];
  content: string;
  sources: SourceCard[];
  choices?: { text: string; options: string[]; descriptions?: (string | undefined)[] };
  notebookCount?: number;
  notebookTopic?: string;
}

interface UserMessage {
  role: 'user';
  content: string;
}

type Message = UserMessage | AssistantMessage;

interface ThreadPreview {
  id: string;
  title: string;
  creatorName: string;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
  preview: { question: string; answer: string };
}

interface FeaturedPassage {
  text: string;
  bookTitle: string;
  bookAuthor: string;
  bookYear: number | null;
  bookSlug: string;
  pageNumber: number;
  pageId?: string;
}

interface LibrarianClientProps {
  featuredPassage: FeaturedPassage | null;
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TOOL_LABELS: Record<string, string> = {
  search_collection: 'Searching the collection',
  search_semantic: 'Semantic search',
  search_wikipedia: 'Checking Wikipedia',
  get_book_page: 'Reading a page',
  present_choices: 'Thinking...',
};

// ── Source Card Component ─────────────────────────────────────────────

function SourceCardRow({ sources, tenant }: { sources: SourceCard[]; tenant?: string }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {sources.map((s, i) => {
        const url = tenantBookUrl({ slug: s.bookSlug, id: s.bookId }, tenant) + (s.pageNumber ? `?page=${s.pageNumber}` : '');
        return (
          <Link
            key={`${s.bookId}-${s.pageNumber}-${i}`}
            href={url}
            className={`flex-shrink-0 w-[200px] rounded-lg border p-2.5 transition-colors ${s.inCollection
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
            {!s.inCollection && (
              <p className="text-[9px] text-[#b0a89c] font-sans mt-1">Not yet in collection</p>
            )}
          </Link>
        );
      })}
    </div>
  );
}

// ── Search Steps Component ────────────────────────────────────────────

function SearchSteps({ steps }: { steps: SearchStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1 mb-2">
      {steps.map((step, i) => (
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
  );
}

// ── Main Component ────────────────────────────────────────────────────

const ALL_SUGGESTIONS = [
  'Was there any conception of artificial intelligence?',
  'What did Agrippa write about planetary seals?',
  'How did alchemists describe the philosopher\'s stone?',
  'Who was Marsilio Ficino?',
  'What do these texts say about the world soul?',
  'What books explore resonance as magic?',
  'Tell me about the Emerald Tablet',
  'What did alchemists believe about gold?',
  'How did Renaissance scholars understand the cosmos?',
  'What is the Kabbalah\'s tree of life?',
  'Did any of these authors write about dreams?',
  'What did Paracelsus teach about medicine?',
  'How were demons understood in early modern Europe?',
  'What instruments did astrologers use?',
  'What is the relationship between music and magic?',
];

function pickSuggestions(count: number): string[] {
  const shuffled = [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function LibrarianClient({ featuredPassage }: LibrarianClientProps) {
  const { data: session, status } = useSession();
  const params = useParams<{ tenant: string }>();
  const tenant = params?.tenant;
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions] = useState(() => pickSuggestions(4));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [myThreads, setMyThreads] = useState<ThreadPreview[]>([]);
  const [sidebarTab, setSidebarTab] = useState<'recent' | 'mine'>('recent');
  // Default to "My Conversations" once signed in
  useEffect(() => {
    if (status === 'authenticated') setSidebarTab('mine');
  }, [status]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [showThinking, setShowThinking] = useState(false);
  const [visibleThreads, setVisibleThreads] = useState(5);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch public threads
  useEffect(() => {
    fetch('/api/embassy/threads?limit=50')
      .then(r => r.json())
      .then(data => { if (data.threads) setThreads(data.threads); })
      .catch(() => { });
  }, []);

  // Fetch user's own threads when signed in
  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/embassy/threads?mine=true&limit=20')
        .then(r => r.json())
        .then(data => { if (data.threads) setMyThreads(data.threads); })
        .catch(() => { });
    }
  }, [status]);

  // Auto-scroll
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) container.scrollTop = container.scrollHeight;
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  // Update the last assistant message immutably
  const updateLastAssistant = useCallback((updater: (msg: AssistantMessage) => AssistantMessage) => {
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') {
        updated[updated.length - 1] = updater(last as AssistantMessage);
      }
      return updated;
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    // Create empty assistant message
    const emptyAssistant: AssistantMessage = {
      role: 'assistant',
      steps: [],
      content: '',
      sources: [],
    };
    setMessages(prev => [...prev, emptyAssistant]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/embassy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          message: trimmed,
          history: messages.map(m => ({
            role: m.role,
            content: m.role === 'user' ? m.content : (m as AssistantMessage).content,
          })),
          visibility,
          stream: true,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) {
          updateLastAssistant(m => ({
            ...m,
            content: 'Please [sign in](/auth/signin?callbackUrl=/librarian) to talk with the Librarian. It\'s free — just create an account or sign in with Google.',
          }));
        } else {
          updateLastAssistant(m => ({ ...m, content: err.error || 'Something went wrong. Please try again.' }));
        }
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
                case 'threadId':
                  if (!threadId) setThreadId(event.threadId);
                  break;

                case 'thinking':
                  updateLastAssistant(m => ({
                    ...m,
                    thinking: (m.thinking || '') + (event.text || ''),
                  }));
                  break;

                case 'tool_call':
                  updateLastAssistant(m => ({
                    ...m,
                    steps: [...m.steps, {
                      name: event.name,
                      query: event.query || '',
                      status: 'searching' as const,
                    }],
                  }));
                  break;

                case 'tool_result':
                  updateLastAssistant(m => ({
                    ...m,
                    steps: m.steps.map((s, i) =>
                      i === m.steps.length - 1 && s.status === 'searching'
                        ? { ...s, status: 'done' as const, summary: event.summary, found: event.found }
                        : s
                    ),
                  }));
                  break;

                case 'choices':
                  updateLastAssistant(m => ({
                    ...m,
                    choices: { text: event.text, options: event.options, descriptions: event.descriptions },
                  }));
                  break;

                case 'chunk':
                  updateLastAssistant(m => ({
                    ...m,
                    content: m.content + (event.text || ''),
                  }));
                  break;

                case 'sources':
                  updateLastAssistant(m => ({
                    ...m,
                    sources: (event.sources || []).map((s: Record<string, unknown>) => ({
                      bookId: s.book_id,
                      bookTitle: s.bookTitle,
                      bookAuthor: s.bookAuthor,
                      bookSlug: s.bookSlug,
                      pageNumber: s.pageNumber,
                      snippet: s.snippet,
                      inCollection: s.inCollection !== false,
                    })),
                  }));
                  break;

                case 'notebook_update':
                  updateLastAssistant(m => ({
                    ...m,
                    notebookCount: event.notebook?.findingCount,
                    notebookTopic: event.notebook?.topic || m.notebookTopic,
                  }));
                  break;

                case 'error':
                  console.error('[Librarian error]', event.debug || event.message);
                  updateLastAssistant(m => ({ ...m, content: event.message || 'Something went wrong.' }));
                  break;
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateLastAssistant(m => ({
          ...m,
          content: 'The Librarian seems to be away. Please try again in a moment.',
        }));
      }
    }

    abortRef.current = null;
    setSending(false);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  };

  // Auto-fill from ?q= search param (e.g. from "Ask the Librarian" link)
  const initialQueryHandled = useRef(false);
  useEffect(() => {
    if (initialQueryHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q && !sending && messages.length === 0) {
      initialQueryHandled.current = true;
      pendingChoiceRef.current = q;
      setInput(q);
    }
  }, [sending, messages.length]);

  const pendingChoiceRef = useRef<string | null>(null);

  const handleChoiceClick = (choice: string) => {
    pendingChoiceRef.current = choice;
    setInput(choice);
  };

  // Auto-submit when input is set from a choice click
  useEffect(() => {
    if (pendingChoiceRef.current && input === pendingChoiceRef.current && !sending) {
      pendingChoiceRef.current = null;
      const form = inputRef.current?.closest('form');
      if (form) form.requestSubmit();
    }
  }, [input, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const startNewThread = () => {
    setMessages([]);
    setThreadId(null);
    inputRef.current?.focus();
  };

  const isSignedIn = status !== 'loading' && !!session?.user;

  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      <SiteHeader variant="dark" />
      {/* Hero */}
      <div className="relative bg-[#0e0c0a] overflow-hidden min-h-[360px] sm:min-h-[420px]">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.sourcelibrary.org/artwork/reading-room-hero.png"
            alt="A grand monastic library with vaulted ceilings, galleries of books, and warm candlelight"
            className="absolute inset-0 w-full h-full object-cover opacity-80"
            loading="eager"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0e0c0a]/90" />

        <div className="relative max-w-[1200px] mx-auto px-6 md:px-12 pt-14 sm:pt-20 pb-14">
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-display mb-3 drop-shadow-lg" style={{ fontWeight: 500 }}>
            The Librarian
          </h1>
          <p className="text-white/80 text-base sm:text-lg font-body leading-relaxed max-w-[480px] drop-shadow-sm">
            Your research agent for over 10,000 rare books. Ask a question, and the Librarian
            will search the collection, cross-reference sources, and build up findings you can export.
          </p>
          <Link
            href="/librarian/voice"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm rounded-lg backdrop-blur-sm border border-white/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            Try voice conversation
          </Link>
          <Link
            href="/podcast"
            className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm rounded-lg backdrop-blur-sm border border-white/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            Listen to Deep Dives
          </Link>

          {featuredPassage && (
            <div className="mt-8 max-w-[560px]">
              <p className="text-[11px] text-white/40 tracking-[0.15em] uppercase font-sans mb-2">
                The Librarian is reading
              </p>
              <Link href={featuredPassage.pageId ? `/book/${featuredPassage.bookSlug}/page/${featuredPassage.pageId}` : `/book/${featuredPassage.bookSlug}`} className="block group">
                <blockquote className="text-white/70 text-[15px] font-body leading-relaxed italic border-l-2 border-[#c9a86c]/40 pl-4">
                  &ldquo;{featuredPassage.text}&rdquo;
                </blockquote>
                <p className="text-white/40 text-xs font-body mt-2 group-hover:text-white/60 transition-colors">
                  {featuredPassage.bookAuthor && <span>{featuredPassage.bookAuthor}, </span>}
                  <span className="italic">{featuredPassage.bookTitle}</span>
                  {featuredPassage.bookYear && <span> ({featuredPassage.bookYear})</span>}
                </p>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="relative">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://images.sourcelibrary.org/artwork/reading-room-hero.png" alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.06]" />
        </div>
        <div className="relative max-w-[1200px] mx-auto px-6 md:px-12 py-8 md:py-12">
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">

            {/* Chat area */}
            <div className="flex-1 min-w-0">
              <div className="border border-[#e8e4dc] rounded-lg bg-white overflow-hidden shadow-sm">
                {/* Messages */}
                <div ref={chatContainerRef} className="min-h-[300px] max-h-[70vh] overflow-y-auto p-6 space-y-6">
                  {messages.length === 0 && (
                    <div className="text-center py-8">
                      <img src="/brand/png/icon-only--black-on-transparent--96h.png" alt="" className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-[#8a8480] text-sm font-body max-w-[400px] mx-auto leading-relaxed">
                        The Librarian searches the collection, Wikipedia, and semantic search
                        to find answers in over 10,000 rare books.
                      </p>
                      <p className="text-[#8a8480]/50 text-xs font-body mt-1.5">
                        Responses may contain errors &mdash; always verify against the source page.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2 mt-5">
                        {suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                            className="px-3 py-1.5 text-xs text-[#6b6560] border border-[#e8e4dc] rounded-full hover:bg-[#f5f0e8] hover:text-[#444] transition-colors font-sans"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg, i) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={i} className="flex gap-3 justify-end">
                          <div className="max-w-[85%] bg-[#1a1612] text-white rounded-2xl rounded-br-sm px-4 py-3">
                            <p className="text-[15px] font-body leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      );
                    }

                    const assistant = msg as AssistantMessage;
                    return (
                      <div key={i} className="flex gap-3">
                        <img
                          src="/brand/png/icon-only--black-on-transparent--96h.png"
                          alt="Librarian"
                          className="flex-shrink-0 w-10 h-10 rounded-full"
                        />
                        <div className="max-w-[85%] min-w-0">
                          {/* Thinking (collapsible) */}
                          {assistant.thinking && (
                            <div className="mb-2">
                              <button
                                onClick={() => setShowThinking(!showThinking)}
                                className="text-[11px] text-[#b0a89c] hover:text-[#8a8480] font-sans transition-colors"
                              >
                                {showThinking ? 'Hide reasoning' : 'Show reasoning'}
                              </button>
                              {showThinking && (
                                <div className="mt-1 text-[13px] text-[#8a8480] font-body italic leading-relaxed bg-[#faf8f4] rounded px-3 py-2 border-l-2 border-[#e8e4dc]">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistant.thinking}</ReactMarkdown>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Search steps */}
                          <SearchSteps steps={assistant.steps} />

                          {/* Response text */}
                          {assistant.content && (
                            <div className="bg-[#f5f0e8] text-[#1a1612] rounded-2xl rounded-bl-sm px-4 py-3">
                              <div className="max-w-none font-body text-[15px] leading-relaxed text-[#1a1612]">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    p: ({ children }) => (
                                      <p className="mb-4 mt-0">{children}</p>
                                    ),
                                    h2: ({ children }) => (
                                      <h2 className="text-xl font-serif mt-6 mb-3 text-[#1a1612]" style={{ fontWeight: 400 }}>{children}</h2>
                                    ),
                                    h3: ({ children }) => (
                                      <h3 className="text-lg font-serif mt-5 mb-2 text-[#1a1612]" style={{ fontWeight: 400 }}>{children}</h3>
                                    ),
                                    a: ({ href, children }) => (
                                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#9e4a3a] underline underline-offset-2 decoration-[#9e4a3a]/30 hover:decoration-[#9e4a3a]">{children}</a>
                                    ),
                                    blockquote: ({ children }) => (
                                      <blockquote className="border-l-2 border-[#c9a86c] pl-4 my-4 italic text-[#444]">{children}</blockquote>
                                    ),
                                    ul: ({ children }) => (
                                      <ul className="my-3 ml-4 list-disc">{children}</ul>
                                    ),
                                    ol: ({ children }) => (
                                      <ol className="my-3 ml-4 list-decimal">{children}</ol>
                                    ),
                                    li: ({ children }) => (
                                      <li className="my-1">{children}</li>
                                    ),
                                    hr: () => <hr className="my-4 border-[#e8e4dc]" />,
                                    img: ({ src, alt }) => (
                                      <a href={src as string} target="_blank" rel="noopener noreferrer">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={src as string} alt={(alt as string) || ''} className="rounded-lg shadow-md max-h-[300px] w-auto cursor-pointer hover:shadow-lg transition-shadow my-4" loading="lazy" />
                                      </a>
                                    ),
                                  }}
                                >{ensureParagraphBreaks(linkifySourceUrls(assistant.content))}</ReactMarkdown>
                              </div>
                            </div>
                          )}

                          {/* Research direction choices */}
                          {assistant.choices && (
                            <div className="mt-4 space-y-3">
                              {assistant.choices.options.map((opt, idx) => {
                                const desc = assistant.choices?.descriptions?.[idx];
                                return (
                                  <button
                                    key={opt}
                                    onClick={() => handleChoiceClick(opt)}
                                    className="w-full text-left group"
                                  >
                                    <div className="px-4 py-3.5 rounded-xl border border-[#e0d9cc] bg-white hover:border-[#c9a86c] hover:bg-[#fdfcf9] transition-all">
                                      {desc ? (
                                        <>
                                          <p className="text-[14px] font-body text-[#444] leading-relaxed mb-2.5">{desc}</p>
                                          <span className="inline-flex items-center gap-1.5 text-[13px] font-sans font-medium text-[#9e4a3a] group-hover:underline">
                                            {opt} <span className="text-[11px]">&rarr;</span>
                                          </span>
                                        </>
                                      ) : (
                                        <div className="flex items-center gap-3">
                                          <span className="flex-1 text-[14px] font-body text-[#1a1612] leading-snug">{opt}</span>
                                          <span className="flex-shrink-0 text-[12px] font-sans text-[#9e4a3a] opacity-0 group-hover:opacity-100 transition-opacity">
                                            Explore &rarr;
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Source cards */}
                          <SourceCardRow sources={assistant.sources} tenant={tenant} />

                          {/* Notebook indicator */}
                          {assistant.notebookCount && assistant.notebookCount > 0 && (
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#6b8f5e] font-sans">
                              <span>&#x1F4D3;</span>
                              <span>{assistant.notebookCount} finding{assistant.notebookCount > 1 ? 's' : ''} saved to research notebook</span>
                              {assistant.notebookTopic && <span className="text-[#8a8480]">&#x2014; {assistant.notebookTopic}</span>}
                            </div>
                          )}

                          {/* Loading state: no content yet and still sending */}
                          {!assistant.content && !assistant.thinking && assistant.steps.length === 0 && sending && i === messages.length - 1 && (
                            <div className="bg-[#f5f0e8] rounded-2xl rounded-bl-sm px-4 py-3">
                              <p className="text-[13px] text-[#8a8480] font-body italic animate-pulse">Thinking...</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div />
                </div>

                {/* Input area */}
                <div className="border-t border-[#e8e4dc] p-4">
                  <form onSubmit={handleSubmit} className="flex gap-3 items-end">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder={isSignedIn ? 'Ask the Librarian...' : 'Sign in to ask the Librarian...'}
                      disabled={!isSignedIn && status !== 'loading'}
                      rows={1}
                      className="flex-1 resize-none border border-[#e8e4dc] rounded-lg px-4 py-2.5 text-[15px] font-body text-[#1a1612] placeholder-[#8a8480] focus:outline-none focus:border-[#c9a86c] transition-colors bg-transparent disabled:opacity-50"
                    />
                    {sending ? (
                      <button
                        type="button"
                        onClick={handleStop}
                        className="flex-shrink-0 px-5 py-2.5 bg-[#9e4a3a] text-white rounded-lg text-sm font-sans hover:bg-[#8b3d30] transition-colors"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!input.trim() || (!isSignedIn && status !== 'loading')}
                        className="flex-shrink-0 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] disabled:opacity-30 transition-colors"
                      >
                        Send
                      </button>
                    )}
                  </form>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-3">
                      {messages.length > 0 && (
                        <button onClick={startNewThread} className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans">
                          New conversation
                        </button>
                      )}
                      {threadId && messages.some(m => m.role === 'assistant' && (m as AssistantMessage).notebookCount) && (
                        <a
                          href={`/api/embassy/threads/${threadId}/notebook`}
                          download
                          className="text-[11px] text-[#6b8f5e] hover:text-[#4a6b40] transition-colors font-sans"
                        >
                          Export research
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {isSignedIn && (
                        <button
                          onClick={() => setVisibility(v => v === 'public' ? 'private' : 'public')}
                          className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans flex items-center gap-1"
                        >
                          <span>{visibility === 'public' ? 'Public' : 'Private'}</span>
                          <span className="text-[9px]">{visibility === 'public' ? '(visible to others)' : '(only you)'}</span>
                        </button>
                      )}
                      <span className="text-[9px] text-[#c0b8b0] font-mono">v5</span>
                    </div>
                  </div>

                  {!isSignedIn && status !== 'loading' && (
                    <p className="mt-2 text-[12px] text-[#8a8480] font-sans">
                      <Link href="/auth/signin?callbackUrl=/librarian" className="text-[#9e4a3a] hover:underline">
                        Sign in
                      </Link>
                      {' '}to talk with the Librarian. Free — no membership required.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="lg:w-[300px] flex-shrink-0">
              <div className="lg:sticky lg:top-8">
                {/* Tab toggle */}
                <div className="flex gap-4 mb-4">
                  <button
                    onClick={() => { setSidebarTab('recent'); setVisibleThreads(5); }}
                    className={`text-[11px] tracking-[0.2em] uppercase font-sans transition-colors ${sidebarTab === 'recent' ? 'text-[#1a1612]' : 'text-[#b0a89c] hover:text-[#8a8480]'
                      }`}
                  >
                    Recent
                  </button>
                  {isSignedIn && (
                    <button
                      onClick={() => { setSidebarTab('mine'); setVisibleThreads(5); }}
                      className={`text-[11px] tracking-[0.2em] uppercase font-sans transition-colors ${sidebarTab === 'mine' ? 'text-[#1a1612]' : 'text-[#b0a89c] hover:text-[#8a8480]'
                        }`}
                    >
                      My Conversations
                    </button>
                  )}
                </div>

                {(() => {
                  const allThreads = sidebarTab === 'mine' ? myThreads : threads;
                  if (allThreads.length === 0) {
                    return (
                      <p className="text-[#8a8480] text-sm font-body">
                        {sidebarTab === 'mine'
                          ? 'No conversations yet. Ask the Librarian something!'
                          : 'No conversations yet. Be the first to ask the Librarian something.'}
                      </p>
                    );
                  }
                  const displayThreads = allThreads.slice(0, visibleThreads);
                  const hasMore = allThreads.length > visibleThreads;
                  return (
                    <div className="space-y-0">
                      {displayThreads.map((thread) => (
                        <Link
                          key={thread.id}
                          href={`/librarian/thread/${thread.id}`}
                          className="block py-3 border-b border-[#e8e4dc] hover:bg-[#f5f0e8]/50 transition-colors -mx-2 px-2 rounded"
                        >
                          <p className="text-sm font-body text-[#1a1612] line-clamp-2 leading-snug mb-1">
                            {thread.preview.question}
                          </p>
                          <p className="text-[12px] text-[#8a8480] font-body line-clamp-2 leading-relaxed mb-1">
                            {thread.preview.answer}
                          </p>
                          <p className="text-[10px] text-[#8a8480] font-sans">
                            {thread.creatorName} &middot; {timeAgo(thread.lastMessageAt)}
                            {thread.messageCount > 2 && <span> &middot; {thread.messageCount} messages</span>}
                          </p>
                        </Link>
                      ))}
                      {hasMore && (
                        <button
                          onClick={() => setVisibleThreads(v => v + 10)}
                          className="block w-full py-2 mt-1 text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans text-center"
                        >
                          Show more ({allThreads.length - visibleThreads} remaining)
                        </button>
                      )}
                    </div>
                  );
                })()}

                <div className="mt-8 pt-6 border-t border-[#e8e4dc]">
                  <div className="space-y-2">
                    <Link href="/ficino-society" className="block text-sm text-[#444] hover:text-[#9e4a3a] transition-colors font-body">
                      The Ficino Society
                    </Link>
                    <Link href="/collections" className="block text-sm text-[#444] hover:text-[#9e4a3a] transition-colors font-body">
                      Browse the Collection
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
