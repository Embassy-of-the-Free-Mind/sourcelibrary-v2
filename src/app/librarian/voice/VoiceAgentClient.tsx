'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
// @ts-ignore -- @elevenlabs/react has no types locally but installs fine on Vercel
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import SiteHeader from '@/components/layout/SiteHeader';
import Link from 'next/link';

const HERO_IMG = 'https://images.sourcelibrary.org/artwork/reading-room-hero.png';

const VOICE_SYSTEM_PROMPT = `You are the Librarian of the Embassy of the Free Mind — a voice research assistant for Source Library, a digital collection of over 10,000 rare historical texts spanning antiquity through the 18th century.

Your role is to help users find and explore books in the collection. You have tools to search the catalog by keyword and by concept, read specific pages, and find illustrations.

## What Source Library contains
The collection covers the full breadth of pre-modern intellectual history: alchemy, Hermetica, Kabbalah, astrology, natural philosophy, Rosicrucianism, Indian philosophy, Sanskrit texts, Daoist texts, Egyptian sources, Tibetan Buddhism, Sufi mysticism, early modern science, demonology, angelology, mathematics, medicine, botany, and much more. Nearly all texts are translated into English. This is NOT only an esoteric or occult library — it covers the entire history of ideas.

## How to behave
- Be concise. This is voice — keep responses under 3 sentences unless the user asks for detail.
- Search first, talk second. When a user asks about a topic, use your search tools to find actual books and passages before answering.
- Use your own knowledge to guide searches. If the user asks about "Renaissance views on dreams," you know to search for Cardano, Artemidorus, Synesius — don't just search the literal query.
- Name specific books, authors, and page numbers from search results. The user can see source cards appear in the UI.
- If a search returns nothing, try a different angle (different keywords, different author) before giving up.
- Don't lecture or give long explanations unprompted. Answer the question, cite what you found, suggest what to explore next.
- Never open with pleasantries. Just answer.
- When you don't find something, say so honestly.`;

// ── Types ─────────────────────────────────────────────────────────────

interface TranscriptEntry { role: 'user' | 'agent'; text: string; isFinal: boolean }
interface SourceResult { bookId: string; title: string; author: string; slug?: string; pageNumber?: number; snippet?: string }
interface Visual { type: 'image' | 'page'; url: string; title: string; caption?: string; bookSlug?: string; pageNumber?: number }

// ── Client Tools ──────────────────────────────────────────────────────

function buildClientTools(addSources: (s: SourceResult[]) => void, addVisual: (v: Visual) => void) {
  return {
    search_library: async ({ query }: { query: string }): Promise<string> => {
      console.log('[voice-agent] search_library called:', query);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8&has_translation=true`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return JSON.stringify({ error: `${res.status}` });
        const data = await res.json();
        const results = (data.results || []).slice(0, 6);
        addSources(results.map((r: any) => ({
          bookId: r.id || r.bookId, title: r.title || r.bookTitle, author: r.author || r.bookAuthor,
          slug: r.slug || r.bookSlug, pageNumber: r.pageNumber || r.page_number, snippet: r.snippet,
        })));
        return JSON.stringify({ found: results.length, results: results.map((r: any) => ({
          title: r.title || r.bookTitle, author: r.author || r.bookAuthor, year: r.year,
          bookId: r.id || r.bookId, slug: r.slug || r.bookSlug,
          pageNumber: r.pageNumber || r.page_number, snippet: (r.snippet || '').slice(0, 300),
        })) });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    },
    search_semantic: async ({ query }: { query: string }): Promise<string> => {
      // Semantic search via book_embeddings HNSW (fast, ~17K vectors).
      // Falls back to keyword search if semantic endpoint fails.
      console.log('[voice-agent] search_semantic called:', query);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`/api/search/semantic?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        const results = (data.results || []).slice(0, 6);
        addSources(results.map((r: any) => ({
          bookId: r.book_id, title: r.title, author: r.author,
          slug: r.slug || r.book_id, snippet: r.summary_snippet || (r.summary_text || '').slice(0, 200),
        })));
        return JSON.stringify({ found: results.length, mode: 'semantic', results: results.map((r: any) => ({
          title: r.title, author: r.author, year: r.year, language: r.language,
          bookId: r.book_id, slug: r.slug || r.book_id,
          snippet: r.summary_snippet || (r.summary_text || '').slice(0, 300),
          similarity: r.similarity,
        })) });
      } catch (e) {
        // Fallback to keyword search if semantic fails
        console.log('[voice-agent] semantic failed, falling back to keyword:', String(e));
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8&has_translation=true`);
          if (!res.ok) return JSON.stringify({ error: `${res.status}` });
          const data = await res.json();
          const results = (data.results || []).slice(0, 6);
          addSources(results.map((r: any) => ({
            bookId: r.id || r.bookId, title: r.title || r.bookTitle, author: r.author || r.bookAuthor,
            slug: r.slug || r.bookSlug, pageNumber: r.pageNumber || r.page_number, snippet: r.snippet,
          })));
          return JSON.stringify({ found: results.length, mode: 'keyword_fallback', results: results.map((r: any) => ({
            title: r.title || r.bookTitle, author: r.author || r.bookAuthor,
            bookId: r.id || r.bookId, slug: r.slug || r.bookSlug,
            pageNumber: r.pageNumber || r.page_number, snippet: (r.snippet || '').slice(0, 300),
          })) });
        } catch (e2) { return JSON.stringify({ error: String(e2) }); }
      }
    },
    read_page: async ({ book_id, page_number }: { book_id: string; page_number: number }): Promise<string> => {
      try {
        const res = await fetch(`/api/books/${book_id}/pages?page=${page_number}`);
        if (!res.ok) return JSON.stringify({ error: `${res.status}` });
        const data = await res.json();
        const page = data.pages?.[0] || data;
        const text = page.translation?.data || page.ocr?.data || '';
        const imageUrl = page.compressed_photo || page.archived_photo || page.photo;
        if (imageUrl) addVisual({ type: 'page', url: imageUrl, title: `Page ${page.page_number || page_number}`, caption: text.slice(0, 120) + (text.length > 120 ? '...' : ''), pageNumber: page.page_number || page_number });
        return JSON.stringify({ text: text.slice(0, 2000), pageNumber: page.page_number || page_number, hasTranslation: !!page.translation?.data });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    },
    search_images: async ({ query }: { query: string }): Promise<string> => {
      try {
        const res = await fetch(`/api/search/visual?q=${encodeURIComponent(query)}&limit=6`);
        if (!res.ok) return JSON.stringify({ error: `${res.status}` });
        const data = await res.json();
        const images = (data.results || data.images || []).slice(0, 6);
        for (const img of images) {
          const url = img.imageUrl || img.fullImageUrl || img.image_url;
          if (url) addVisual({ type: 'image', url, title: img.title || img.description || 'Illustration', caption: img.author, bookSlug: img.bookSlug || img.slug });
        }
        return JSON.stringify({ found: images.length, images: images.map((img: any) => ({
          description: (img.title || img.description || '').slice(0, 200), bookTitle: img.book_title || img.title, subjects: img.subjects?.slice(0, 5),
        })) });
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    },
  };
}

// ── Visual Lightbox ───────────────────────────────────────────────────

function VisualPanel({ visuals, onClose }: { visuals: Visual[]; onClose: () => void }) {
  const [selected, setSelected] = useState(visuals.length - 1);
  useEffect(() => { setSelected(visuals.length - 1); }, [visuals.length]);
  if (!visuals.length) return null;
  const current = visuals[selected];
  if (!current) return null;

  return (
    <div className="bg-[#0e0c0a] rounded-lg overflow-hidden shadow-xl border border-[#c9a86c]/20">
      <div className="relative aspect-[4/3] bg-black/50 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt={current.title} className="max-h-full max-w-full object-contain" loading="lazy" />
        <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white/70 hover:text-white flex items-center justify-center text-lg backdrop-blur-sm">&times;</button>
      </div>
      <div className="px-5 py-4 bg-[#0e0c0a]">
        <p className="text-white/90 text-sm font-display leading-snug">{current.title}</p>
        {current.caption && <p className="text-white/40 text-xs mt-1 font-sans">{current.caption}</p>}
      </div>
      {visuals.length > 1 && (
        <div className="px-5 pb-4 flex gap-2 overflow-x-auto">
          {visuals.map((v, i) => (
            <button key={i} onClick={() => setSelected(i)}
              className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${i === selected ? 'border-[#c9a86c]' : 'border-transparent opacity-50 hover:opacity-80'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.url} alt="" className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────

function VoiceAgentInner() {
  const [appStatus, setAppStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [sources, setSources] = useState<SourceResult[]>([]);
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const [showVisuals, setShowVisuals] = useState(true);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [textInput, setTextInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const addSources = useCallback((newSources: SourceResult[]) => {
    setSources((prev) => { const seen = new Set(prev.map(s => `${s.bookId}-${s.pageNumber}`)); return [...prev, ...newSources.filter(s => !seen.has(`${s.bookId}-${s.pageNumber}`))]; });
  }, []);
  const addVisual = useCallback((v: Visual) => {
    setVisuals((prev) => prev.some(p => p.url === v.url) ? prev : [...prev, v]);
    setShowVisuals(true);
  }, []);

  const conversation = useConversation({
    clientTools: buildClientTools(addSources, addVisual),
    onMessage: (payload: { role?: string; source?: string; message: string }) => {
      setTranscript((prev) => {
        const entry: TranscriptEntry = { role: payload.role === 'agent' || payload.source === 'ai' ? 'agent' : 'user', text: payload.message, isFinal: true };
        if (prev.length > 0 && prev[prev.length - 1].role === entry.role && !prev[prev.length - 1].isFinal) return [...prev.slice(0, -1), entry];
        return [...prev, entry];
      });
    },
    onError: (message: string) => {
      console.error('[voice-agent]', message);
      const msg = message || 'Connection error';
      if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('permission'))
        setErrorMsg('Microphone access needed. Your browser should prompt you — if not, click the lock icon in the address bar and allow microphone access.');
      else setErrorMsg(msg);
      setAppStatus('error');
    },
    onStatusChange: ({ status }: { status: string }) => {
      if (status === 'connected') {
        setAppStatus('connected');
        // Start muted in push-to-talk mode
        if (pttMode) setTimeout(() => { try { conversation.setMuted(true); } catch {} }, 100);
      }
      else if (status === 'connecting') setAppStatus('connecting');
      else if (status === 'disconnected' || status === 'disconnecting') setAppStatus('idle');
    },
    onModeChange: ({ mode }: { mode: string }) => { setAgentSpeaking(mode === 'speaking'); },
    onUnhandledClientToolCall: (params: any) => { console.warn('[voice-agent] UNHANDLED tool call:', params); },
    onDebug: (props: any) => { if (props?.type?.includes('tool')) console.log('[voice-agent] debug:', props); },
  });

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [transcript]);
  useEffect(() => {
    if (appStatus !== 'connected') return;
    const interval = setInterval(() => { try { setVolume(conversation.getInputVolume()); } catch { /* */ } }, 100);
    return () => clearInterval(interval);
  }, [appStatus, conversation]);

  const [holding, setHolding] = useState(false);
  const [pttMode, setPttMode] = useState(true);

  const start = async () => {
    setAppStatus('connecting'); setErrorMsg(null); setTranscript([]); setSources([]); setVisuals([]);
    try {
      const res = await fetch('/api/embassy/voice'); if (!res.ok) throw new Error(`Signed URL failed: ${res.status}`);
      const { signedUrl } = await res.json();
      conversation.startSession({
        signedUrl,
        overrides: {
          agent: {
            prompt: {
              prompt: VOICE_SYSTEM_PROMPT,
            },
            firstMessage: "Welcome to Source Library. I can search over 10,000 rare books — alchemy, philosophy, Sanskrit texts, Kabbalah, early science, and more. What are you looking for?",
          },
        },
      });
    }
    catch (err: any) {
      const msg = err.message || String(err);
      if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('permission'))
        setErrorMsg('Microphone access needed. Your browser should prompt you — if not, click the lock icon in the address bar and allow microphone access.');
      else setErrorMsg(msg);
      setAppStatus('error');
    }
  };
  const stop = () => { conversation.endSession(); setAppStatus('idle'); setAgentSpeaking(false); setHolding(false); };

  const togglePtt = () => {
    const next = !pttMode; setPttMode(next);
    if (next) { conversation.setMuted(true); setHolding(false); } else { conversation.setMuted(false); }
  };
  const holdStart = () => { if (!pttMode) return; setHolding(true); conversation.setMuted(false); };
  const holdEnd = () => { if (!pttMode) return; setHolding(false); conversation.setMuted(true); };

  useEffect(() => {
    if (appStatus !== 'connected') return;
    const down = (e: KeyboardEvent) => { if (pttMode && e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); holdStart(); } };
    const up = (e: KeyboardEvent) => { if (pttMode && e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); holdEnd(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [appStatus, pttMode]);

  const sendText = () => { const msg = textInput.trim(); if (!msg) return; setTextInput(''); conversation.sendUserMessage(msg); setTranscript(prev => [...prev, { role: 'user', text: msg, isFinal: true }]); };
  const pushContext = (text: string) => { conversation.sendContextualUpdate(text); };

  return (
    <div className="min-h-screen bg-[#f5f0e8]">
      <SiteHeader variant="dark" />

      {/* Hero */}
      <div className="relative bg-[#0e0c0a] overflow-hidden">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO_IMG} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" loading="eager" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0e0c0a]/90" />

        <div className="relative max-w-[1200px] mx-auto px-6 md:px-12 pt-14 sm:pt-20 pb-16 flex flex-col items-center text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-display mb-3 drop-shadow-lg" style={{ fontWeight: 500 }}>
            The Librarian
          </h1>
          <p className="text-white/60 text-base sm:text-lg font-body leading-relaxed max-w-[520px] mb-8">
            Voice research across 10,000 rare books &mdash; philosophy, science, medicine, alchemy, sacred texts, and the full history of ideas from antiquity to the Enlightenment.
          </p>

          {/* Central orb */}
          {appStatus === 'idle' || appStatus === 'error' ? (
            <button onClick={start}
              className="w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-[#c9a86c]/90 hover:bg-[#c9a86c] text-[#0e0c0a] transition-all shadow-[0_0_40px_rgba(201,168,108,0.2)] hover:shadow-[0_0_60px_rgba(201,168,108,0.4)] flex flex-col items-center justify-center backdrop-blur-sm">
              <MicIcon /><span className="text-sm mt-1.5 font-sans font-medium">Begin</span>
            </button>
          ) : appStatus === 'connecting' ? (
            <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-full bg-[#c9a86c]/40 text-white flex items-center justify-center animate-pulse text-sm font-sans">
              Connecting...
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div
                onMouseDown={holdStart} onMouseUp={holdEnd} onMouseLeave={holdEnd}
                onTouchStart={holdStart} onTouchEnd={holdEnd}
                className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center transition-all duration-150 select-none ${
                  holding ? 'bg-white shadow-[0_0_60px_rgba(255,255,255,0.3)] scale-110'
                    : agentSpeaking ? 'bg-[#c9a86c] shadow-[0_0_60px_rgba(201,168,108,0.5)]'
                      : pttMode ? 'bg-white/20 hover:bg-white/30 cursor-pointer' : 'bg-[#c9a86c]/70'
                }`}
                style={{ transform: holding ? 'scale(1.1)' : agentSpeaking ? 'scale(1.08)' : `scale(${1 + volume * 0.12})` }}
              >
                <div className={`flex flex-col items-center ${holding ? 'text-[#0e0c0a]' : pttMode && !agentSpeaking ? 'text-white/70' : 'text-[#0e0c0a]'}`}>
                  {holding ? (<><MicIcon /><span className="text-xs mt-1 font-sans font-medium">Speaking</span></>)
                    : agentSpeaking ? (<><SpeakerIcon /><span className="text-xs mt-1 font-sans opacity-70">Speaking</span></>)
                      : pttMode ? (<><MicIcon /><span className="text-xs mt-1 font-sans opacity-70">Hold to talk</span></>)
                        : (<><MicIcon /><span className="text-xs mt-1 font-sans opacity-70">Listening</span></>)}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={togglePtt} className={`text-xs font-sans transition-colors ${pttMode ? 'text-[#c9a86c]' : 'text-white/40 hover:text-white/60'}`}>
                  {pttMode ? 'Switch to open mic' : 'Switch to push-to-talk'}
                </button>
                <span className="text-white/20">&middot;</span>
                <button onClick={stop} className="text-xs text-white/40 hover:text-white/70 font-sans transition-colors">End</button>
              </div>
              {pttMode && <p className="text-xs text-white/50 font-sans">Hold the orb or press spacebar to speak</p>}
            </div>
          )}
        </div>
      </div>

      {errorMsg && <p className="text-red-700 text-sm text-center mt-3 font-sans">{errorMsg}</p>}

      {/* Main content */}
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HERO_IMG} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.04]" />
        <div className="relative max-w-[1200px] mx-auto px-6 md:px-12 py-8">
          <div className="flex flex-col lg:flex-row gap-8">

            {/* Left: Visuals + Transcript + Input */}
            <div className="flex-1 flex flex-col gap-5 min-w-0">
              {showVisuals && visuals.length > 0 && (
                <VisualPanel visuals={visuals} onClose={() => setShowVisuals(false)} />
              )}

              <div ref={scrollRef}
                className="min-h-[250px] max-h-[50vh] overflow-y-auto bg-white rounded-lg border border-[#e8e4dc] p-5 space-y-4 shadow-sm">
                {transcript.length === 0 && appStatus === 'idle' && (
                  <div className="text-center py-10">
                    <img src="/brand/png/icon-only--black-on-transparent--96h.png" alt="" className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-[#8a8480] text-sm font-body max-w-[360px] mx-auto leading-relaxed">
                      The Librarian searches the collection as you speak &mdash; philosophy, science, sacred texts, manuscripts from every tradition.
                    </p>
                  </div>
                )}
                {transcript.length === 0 && appStatus === 'connected' && (
                  <div className="text-center py-10 animate-pulse"><p className="text-[#b0a89c] text-sm font-body">Listening...</p></div>
                )}
                {transcript.map((entry, i) => (
                  <div key={i} className={`flex gap-3 ${entry.role === 'user' ? 'justify-end' : ''}`}>
                    {entry.role === 'agent' && (
                      <img src="/brand/png/icon-only--black-on-transparent--96h.png" alt="" className="flex-shrink-0 w-8 h-8 rounded-full opacity-60 mt-1" />
                    )}
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-[15px] font-body leading-relaxed ${
                      entry.role === 'agent' ? 'bg-[#faf8f4] text-[#2c2824] rounded-tl-sm' : 'bg-[#1a1612] text-white rounded-br-sm'
                    }`}>
                      {entry.text}
                    </div>
                  </div>
                ))}
              </div>

              {appStatus === 'connected' && (
                <div className="flex gap-2">
                  <input type="text" value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendText()}
                    placeholder="Type a question or note..."
                    className="flex-1 px-4 py-3 text-sm font-sans bg-white border border-[#e8e4dc] rounded-lg focus:outline-none focus:border-[#c9a86c]/50 text-[#2c2824] placeholder-[#b0a89c]" />
                  <button onClick={sendText} className="px-5 py-3 text-sm font-sans font-medium bg-[#1a1612] text-white rounded-lg hover:bg-[#2c2824] transition-colors">Send</button>
                </div>
              )}
            </div>

            {/* Right: Sources */}
            <div className="lg:w-[280px] flex flex-col gap-3">
              <p className="text-[11px] text-[#8a8480] tracking-[0.15em] uppercase font-sans">Sources found</p>
              {sources.length === 0 ? (
                <div className="bg-white rounded-lg border border-[#e8e4dc] p-5 text-center shadow-sm">
                  <p className="text-[#b0a89c] text-sm font-body leading-relaxed">Sources will appear here as Thoth searches the collection.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {sources.map((s, i) => (
                    <div key={`${s.bookId}-${s.pageNumber}-${i}`} className="bg-white rounded-lg border border-[#e8e4dc] p-4 hover:border-[#c9a86c]/40 transition-all shadow-sm">
                      <Link href={`/book/${s.slug || s.bookId}${s.pageNumber ? `?page=${s.pageNumber}` : ''}`} target="_blank" className="block">
                        <p className="text-sm text-[#2c2824] font-display leading-tight">{s.title}</p>
                        <p className="text-xs text-[#8a8480] mt-0.5 font-sans">{s.author}{s.pageNumber ? ` · p. ${s.pageNumber}` : ''}</p>
                        {s.snippet && <p className="text-xs text-[#8a8480] mt-1.5 line-clamp-2 font-sans leading-relaxed">{s.snippet}</p>}
                      </Link>
                      {appStatus === 'connected' && (
                        <button onClick={() => pushContext(`The user is now looking at "${s.title}" by ${s.author}${s.pageNumber ? `, page ${s.pageNumber}` : ''}. ${s.snippet ? `Passage: "${s.snippet.slice(0, 150)}"` : ''}`)}
                          className="mt-2 text-[10px] text-[#c9a86c] hover:text-[#a88a4c] font-sans tracking-wide uppercase">Tell Librarian</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!showVisuals && visuals.length > 0 && (
                <button onClick={() => setShowVisuals(true)} className="text-xs text-[#c9a86c] hover:text-[#a88a4c] font-sans mt-1">
                  Show {visuals.length} image{visuals.length > 1 ? 's' : ''}
                </button>
              )}
              <div className="mt-auto pt-4 border-t border-[#e8e4dc]">
                <Link href="/librarian" className="text-sm text-[#c9a86c] hover:text-[#a88a4c] font-display">Switch to text chat &rarr;</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────

function MicIcon() {
  return (<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
  </svg>);
}

function SpeakerIcon() {
  return (<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
  </svg>);
}

// ── Wrapper ───────────────────────────────────────────────────────────

export default function VoiceAgentClient() {
  return (<ConversationProvider><VoiceAgentInner /></ConversationProvider>);
}
