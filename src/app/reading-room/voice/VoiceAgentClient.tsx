'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import SiteHeader from '@/components/layout/SiteHeader';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────

interface TranscriptEntry {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

interface SourceResult {
  bookId: string;
  title: string;
  author: string;
  slug?: string;
  pageNumber?: number;
  snippet?: string;
}

// ── Client Tools ──────────────────────────────────────────────────────
// Executed in the browser, calling our existing API routes.
// Must return string (JSON-serialized results for the agent).

function buildClientTools(addSources: (sources: SourceResult[]) => void) {
  return {
    search_library: async ({ query }: { query: string }): Promise<string> => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=8&has_translation=true`,
        );
        if (!res.ok) return JSON.stringify({ error: `Search failed: ${res.status}` });
        const data = await res.json();

        const results = (data.results || []).slice(0, 6);
        const sources: SourceResult[] = results.map((r: any) => ({
          bookId: r.id || r.bookId,
          title: r.title || r.bookTitle,
          author: r.author || r.bookAuthor,
          slug: r.slug || r.bookSlug,
          pageNumber: r.pageNumber || r.page_number,
          snippet: r.snippet,
        }));
        addSources(sources);

        return JSON.stringify({
          found: results.length,
          results: results.map((r: any) => ({
            title: r.title || r.bookTitle,
            author: r.author || r.bookAuthor,
            year: r.year,
            bookId: r.id || r.bookId,
            slug: r.slug || r.bookSlug,
            pageNumber: r.pageNumber || r.page_number,
            snippet: (r.snippet || '').slice(0, 300),
          })),
        });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    search_semantic: async ({ query }: { query: string }): Promise<string> => {
      try {
        const res = await fetch(
          `/api/search/semantic?q=${encodeURIComponent(query)}&limit=8`,
        );
        if (!res.ok) return JSON.stringify({ error: `Semantic search failed: ${res.status}` });
        const data = await res.json();

        const results = (data.results || []).slice(0, 6);
        const sources: SourceResult[] = [];
        for (const r of results) {
          for (const p of (r.pages || []).slice(0, 2)) {
            sources.push({
              bookId: r.book_id,
              title: r.title,
              author: r.author,
              slug: r.slug,
              pageNumber: p.page_number,
              snippet: p.snippet,
            });
          }
        }
        addSources(sources);

        return JSON.stringify({
          found: results.length,
          results: results.map((r: any) => ({
            title: r.title,
            author: r.author,
            bookId: r.book_id,
            slug: r.slug,
            topPage: r.pages?.[0]?.page_number,
            snippet: (r.pages?.[0]?.snippet || '').slice(0, 300),
            score: r.pages?.[0]?.score,
          })),
        });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    read_page: async ({
      book_id,
      page_number,
    }: {
      book_id: string;
      page_number: number;
    }): Promise<string> => {
      try {
        const res = await fetch(
          `/api/books/${book_id}/pages?page=${page_number}`,
        );
        if (!res.ok) return JSON.stringify({ error: `Page fetch failed: ${res.status}` });
        const data = await res.json();
        const page = data.pages?.[0] || data;
        const text = page.translation?.data || page.ocr?.data || '';
        return JSON.stringify({
          text: text.slice(0, 2000),
          pageNumber: page.page_number || page_number,
          hasTranslation: !!page.translation?.data,
        });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    search_images: async ({
      query,
    }: {
      query: string;
    }): Promise<string> => {
      try {
        const res = await fetch(
          `/api/search/visual?q=${encodeURIComponent(query)}&limit=4`,
        );
        if (!res.ok) return JSON.stringify({ error: `Image search failed: ${res.status}` });
        const data = await res.json();
        const images = (data.results || data.images || []).slice(0, 4);
        return JSON.stringify({
          found: images.length,
          images: images.map((img: any) => ({
            description: (img.description || img.museum_description || '').slice(0, 200),
            bookTitle: img.book_title || img.title,
            bookAuthor: img.book_author || img.author,
            subjects: img.subjects?.slice(0, 5),
          })),
        });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },
  };
}

// ── Inner component (must be inside ConversationProvider) ─────────────

function VoiceAgentInner() {
  const [appStatus, setAppStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const addSources = useCallback((newSources: SourceResult[]) => {
    setSources((prev) => {
      const seen = new Set(prev.map((s) => `${s.bookId}-${s.pageNumber}`));
      const fresh = newSources.filter(
        (s) => !seen.has(`${s.bookId}-${s.pageNumber}`),
      );
      return [...prev, ...fresh];
    });
  }, []);

  const conversation = useConversation({
    clientTools: buildClientTools(addSources),
    onMessage: (payload: { role?: string; source?: string; message: string }) => {
      setTranscript((prev) => {
        const entry: TranscriptEntry = {
          role: payload.role === 'agent' || payload.source === 'ai' ? 'agent' : 'user',
          text: payload.message,
          timestamp: new Date(),
          isFinal: true,
        };
        // Merge consecutive entries from same role
        if (
          prev.length > 0 &&
          prev[prev.length - 1].role === entry.role &&
          !prev[prev.length - 1].isFinal
        ) {
          return [...prev.slice(0, -1), entry];
        }
        return [...prev, entry];
      });
    },
    onError: (message: string) => {
      console.error('[voice-agent]', message);
      setErrorMsg(message || 'Connection error');
      setAppStatus('error');
    },
    onStatusChange: ({ status }: { status: string }) => {
      if (status === 'connected') setAppStatus('connected');
      else if (status === 'connecting') setAppStatus('connecting');
      else if (status === 'disconnected' || status === 'disconnecting') setAppStatus('idle');
    },
    onModeChange: ({ mode }: { mode: string }) => {
      setAgentSpeaking(mode === 'speaking');
    },
  });

  // Auto-scroll transcript
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript]);

  // Volume meter
  useEffect(() => {
    if (appStatus !== 'connected') return;
    const interval = setInterval(() => {
      try {
        const vol = conversation.getInputVolume();
        setVolume(vol);
      } catch {
        // ignore
      }
    }, 100);
    return () => clearInterval(interval);
  }, [appStatus, conversation]);

  const startConversation = async () => {
    setAppStatus('connecting');
    setErrorMsg(null);
    setTranscript([]);
    setSources([]);

    try {
      // Request mic permission first so we get a clear error
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      console.error('[voice-agent] mic error:', err);
      setErrorMsg(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Click the lock icon in your address bar, allow microphone access, and reload.'
          : 'Could not access microphone. Please check your browser settings.',
      );
      setAppStatus('error');
      return;
    }

    try {
      const res = await fetch('/api/embassy/voice');
      if (!res.ok) throw new Error('Failed to get voice session');
      const { signedUrl } = await res.json();
      conversation.startSession({ signedUrl });
    } catch (err: any) {
      console.error('[voice-agent] start error:', err);
      setErrorMsg(err.message || 'Failed to start session');
      setAppStatus('error');
    }
  };

  const endConversation = () => {
    conversation.endSession();
    setAppStatus('idle');
    setAgentSpeaking(false);
  };

  return (
    <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 flex flex-col lg:flex-row gap-8">
      {/* Left: Voice + Transcript */}
      <div className="flex-1 flex flex-col gap-6">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-3xl font-serif text-stone-800 mb-2">
            Voice Research
          </h1>
          <p className="text-stone-500 max-w-lg mx-auto">
            Speak with the Librarian about alchemy, Hermetica, Kabbalah, and
            thousands of rare texts. The Librarian can search the collection,
            read passages, and find illustrations as you talk.
          </p>
        </div>

        {/* Voice Control */}
        <div className="flex flex-col items-center gap-4">
          {appStatus === 'idle' || appStatus === 'error' ? (
            <button
              onClick={startConversation}
              className="group relative w-28 h-28 rounded-full bg-amber-700 hover:bg-amber-800 text-white transition-all duration-300 shadow-lg hover:shadow-xl"
            >
              <div className="flex flex-col items-center justify-center">
                <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
                <span className="text-sm font-medium">Begin</span>
              </div>
            </button>
          ) : appStatus === 'connecting' ? (
            <div className="w-28 h-28 rounded-full bg-amber-600 text-white flex items-center justify-center animate-pulse">
              <span className="text-sm">Connecting...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {/* Pulsing orb */}
              <div className="relative">
                <div
                  className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-150 ${
                    agentSpeaking
                      ? 'bg-amber-600 shadow-[0_0_40px_rgba(180,83,9,0.4)]'
                      : 'bg-amber-700'
                  }`}
                  style={{
                    transform: agentSpeaking ? 'scale(1.05)' : `scale(${1 + volume * 0.15})`,
                  }}
                >
                  <div className="flex flex-col items-center text-white">
                    {agentSpeaking ? (
                      <>
                        <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                        </svg>
                        <span className="text-xs">Speaking</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                        </svg>
                        <span className="text-xs">Listening</span>
                      </>
                    )}
                  </div>
                </div>
                {!agentSpeaking && volume > 0.05 && (
                  <div
                    className="absolute inset-0 rounded-full border-2 border-amber-400/50 animate-ping"
                    style={{ animationDuration: '1.5s' }}
                  />
                )}
              </div>

              <button
                onClick={endConversation}
                className="px-4 py-2 text-sm text-stone-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
              >
                End conversation
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="text-red-600 text-sm mt-2">{errorMsg}</p>
          )}
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-[300px] max-h-[500px] overflow-y-auto bg-white rounded-xl border border-stone-200 p-4 space-y-3"
        >
          {transcript.length === 0 && appStatus === 'idle' && (
            <div className="text-center text-stone-400 py-12">
              <p className="text-lg font-serif mb-2">Press Begin to start</p>
              <p className="text-sm">The Librarian will greet you and you can ask about any topic in the collection.</p>
            </div>
          )}
          {transcript.length === 0 && appStatus === 'connected' && (
            <div className="text-center text-stone-400 py-12 animate-pulse">
              <p className="text-sm">Waiting for the Librarian...</p>
            </div>
          )}
          {transcript.map((entry, i) => (
            <div
              key={i}
              className={`flex ${entry.role === 'agent' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                  entry.role === 'agent'
                    ? 'bg-stone-100 text-stone-800'
                    : 'bg-amber-50 text-amber-900 border border-amber-200'
                }`}
              >
                <span className="font-medium text-xs uppercase tracking-wide block mb-1 opacity-50">
                  {entry.role === 'agent' ? 'Librarian' : 'You'}
                </span>
                {entry.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Sources sidebar */}
      <div className="lg:w-80 flex flex-col gap-4">
        <h2 className="text-lg font-serif text-stone-700">Sources Found</h2>

        {sources.length === 0 ? (
          <div className="bg-white rounded-xl border border-stone-200 p-6 text-center text-stone-400">
            <p className="text-sm">Sources will appear here as the Librarian searches the collection.</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {sources.map((source, i) => (
              <Link
                key={`${source.bookId}-${source.pageNumber}-${i}`}
                href={`/book/${source.slug || source.bookId}${source.pageNumber ? `?page=${source.pageNumber}` : ''}`}
                target="_blank"
                className="block bg-white rounded-xl border border-stone-200 p-4 hover:border-amber-300 hover:shadow-sm transition-all"
              >
                <h3 className="font-serif text-sm text-stone-800 leading-tight mb-1">
                  {source.title}
                </h3>
                <p className="text-xs text-stone-500 mb-2">
                  {source.author}
                  {source.pageNumber ? ` · p. ${source.pageNumber}` : ''}
                </p>
                {source.snippet && (
                  <p className="text-xs text-stone-600 leading-relaxed line-clamp-3">
                    {source.snippet}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-auto pt-4 border-t border-stone-200">
          <Link
            href="/reading-room"
            className="text-sm text-amber-700 hover:text-amber-900 hover:underline"
          >
            Switch to text chat
          </Link>
        </div>
      </div>
    </main>
  );
}

// ── Outer wrapper with ConversationProvider ───────────────────────────

export default function VoiceAgentClient() {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <SiteHeader />
      <ConversationProvider>
        <VoiceAgentInner />
      </ConversationProvider>
    </div>
  );
}
