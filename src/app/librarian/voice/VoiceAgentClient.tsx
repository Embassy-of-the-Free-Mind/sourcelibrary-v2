'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
// @ts-ignore -- @elevenlabs/react has no types locally but installs fine on Vercel
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import SiteHeader from '@/components/layout/SiteHeader';
import Link from 'next/link';
import LibrarianMessageBody from '@/app/librarian/_components/MessageBody';

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
interface SourceResult { bookId: string; title: string; author: string; slug?: string; pageNumber?: number; snippet?: string; thumbnail?: string | null }
interface Visual { type: 'image' | 'page'; url: string; title: string; caption?: string; bookSlug?: string; pageNumber?: number }

// ── Client Tools ──────────────────────────────────────────────────────
// All search tools route through /api/embassy/voice-search, which runs the
// SAME hybrid search (RRF + rerank) the text Librarian uses, plus gallery
// images — so voice matches the text Librarian's result quality and visuals.

function buildClientTools(addSources: (s: SourceResult[]) => void, addVisual: (v: Visual) => void) {
  const runVoiceSearch = async (query: string, mode: string): Promise<string> => {
    console.log(`[voice-agent] ${mode}:`, query);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 13000);
      const res = await fetch(`/api/embassy/voice-search?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return JSON.stringify({ error: `${res.status}` });
      const data = await res.json();
      const sources = (data.sources || []) as SourceResult[];
      addSources(sources);
      for (const img of (data.images || [])) {
        if (img.imageUrl) addVisual({ type: 'image', url: img.imageUrl, title: img.description || img.bookTitle || 'Illustration', caption: img.bookAuthor, bookSlug: img.bookSlug, pageNumber: img.pageNumber });
      }
      return JSON.stringify({
        spoken: data.spoken,
        found: data.found,
        results: sources.slice(0, 6).map((s) => ({ title: s.title, author: s.author, bookId: s.bookId, slug: s.slug, pageNumber: s.pageNumber, snippet: (s.snippet || '').slice(0, 240) })),
        images: (data.images || []).slice(0, 4).map((i: any) => ({ description: i.description, book: i.bookTitle })),
      });
    } catch (e) { return JSON.stringify({ error: String(e) }); }
  };

  return {
    search_library: ({ query }: { query: string }): Promise<string> => runVoiceSearch(query, 'search_library'),
    search_semantic: ({ query }: { query: string }): Promise<string> => runVoiceSearch(query, 'search_semantic'),
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
        const res = await fetch(`/api/embassy/voice-search?q=${encodeURIComponent(query)}&limit=2`);
        if (!res.ok) return JSON.stringify({ error: `${res.status}` });
        const data = await res.json();
        const images = (data.images || []);
        for (const img of images) {
          if (img.imageUrl) addVisual({ type: 'image', url: img.imageUrl, title: img.description || img.bookTitle || 'Illustration', caption: img.bookAuthor, bookSlug: img.bookSlug, pageNumber: img.pageNumber });
        }
        return JSON.stringify({ found: images.length, images: images.map((img: any) => ({ description: (img.description || '').slice(0, 200), book: img.bookTitle, type: img.type })) });
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

  const idle = appStatus === 'idle' || appStatus === 'error';

  return (
    <div className="flex flex-col h-[100dvh] bg-[#f5f0e8] overflow-hidden">
      <SiteHeader variant="dark" />

      {idle || appStatus === 'connecting' ? (
        /* ── Landing screen ── */
        <div className="relative flex-1 bg-[#0e0c0a] overflow-hidden flex flex-col items-center justify-center text-center px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO_IMG} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-[#0e0c0a]/95" />
          <div className="relative flex flex-col items-center max-w-[520px]">
            <h1 className="text-4xl sm:text-5xl text-white font-display mb-3 drop-shadow-lg" style={{ fontWeight: 500 }}>The Librarian</h1>
            <p className="text-white/60 text-base font-body leading-relaxed mb-10">
              Ask aloud and the Librarian searches 10,000 rare books as you speak &mdash; philosophy, science, alchemy, sacred texts, the whole history of ideas.
            </p>
            {appStatus === 'connecting' ? (
              <div className="w-32 h-32 rounded-full bg-[#c9a86c]/40 text-white flex items-center justify-center animate-pulse text-sm font-sans">Connecting&hellip;</div>
            ) : (
              <button onClick={start}
                className="w-32 h-32 rounded-full bg-[#c9a86c]/90 hover:bg-[#c9a86c] text-[#0e0c0a] transition-all shadow-[0_0_40px_rgba(201,168,108,0.25)] hover:shadow-[0_0_60px_rgba(201,168,108,0.45)] flex flex-col items-center justify-center">
                <MicIcon /><span className="text-sm mt-1.5 font-sans font-medium">Begin</span>
              </button>
            )}
            {errorMsg && <p className="text-red-300 text-sm mt-5 font-sans max-w-[360px]">{errorMsg}</p>}
            <Link href="/librarian" className="mt-10 text-sm text-white/50 hover:text-white/80 font-display">Prefer to type? Switch to text chat &rarr;</Link>
          </div>
        </div>
      ) : (
        /* ── Connected: conversation + docked mic ── */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Conversation (main scroll area) */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto w-full px-4 py-5 space-y-4">
              {showVisuals && visuals.length > 0 && (
                <VisualPanel visuals={visuals} onClose={() => setShowVisuals(false)} />
              )}
              {transcript.length === 0 ? (
                <div className="text-center py-12">
                  <img src="/brand/png/icon-only--black-on-transparent--96h.png" alt="" className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-[#8a8480] text-sm font-body max-w-[360px] mx-auto leading-relaxed animate-pulse">
                    The Librarian is listening. Hold the mic below and ask your question&hellip;
                  </p>
                </div>
              ) : transcript.map((entry, i) => (
                <div key={i} className={`flex gap-3 ${entry.role === 'user' ? 'justify-end' : ''}`}>
                  {entry.role === 'agent' && (
                    <img src="/brand/png/icon-only--black-on-transparent--96h.png" alt="" className="flex-shrink-0 w-8 h-8 rounded-full opacity-60 mt-1" />
                  )}
                  {entry.role === 'agent' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white text-[#2c2824] px-4 py-1 shadow-sm">
                      <LibrarianMessageBody content={entry.text} variant="thread" />
                    </div>
                  ) : (
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#1a1612] text-white px-4 py-3 text-[15px] font-body leading-relaxed">
                      {entry.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sources strip */}
          {sources.length > 0 && (
            <div className="border-t border-[#e8e4dc] bg-[#faf8f4] shrink-0">
              <div className="max-w-2xl mx-auto w-full px-4 py-2.5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-[#8a8480] tracking-[0.15em] uppercase font-sans">Sources found</p>
                  {!showVisuals && visuals.length > 0 && (
                    <button onClick={() => setShowVisuals(true)} className="text-[11px] text-[#c9a86c] hover:text-[#a88a4c] font-sans">
                      Show {visuals.length} image{visuals.length > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {sources.map((s, i) => (
                    <div key={`${s.bookId}-${s.pageNumber}-${i}`} className="flex-shrink-0 w-52 bg-white rounded-lg border border-[#e8e4dc] p-2.5 hover:border-[#c9a86c]/50 transition-colors">
                      <Link href={`/book/${s.slug || s.bookId}${s.pageNumber ? `/page-number/${s.pageNumber}` : ''}`} target="_blank" className="flex gap-2.5">
                        {s.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.thumbnail} alt="" className="flex-shrink-0 w-10 h-14 object-cover rounded bg-[#eee]" loading="lazy" />
                        ) : null}
                        <div className="min-w-0">
                          <p className="text-[12px] text-[#1a1612] font-body font-medium leading-tight line-clamp-2">{s.title}</p>
                          <p className="text-[10px] text-[#8a8480] mt-0.5 font-sans">{s.author}{s.pageNumber ? ` · p. ${s.pageNumber}` : ''}</p>
                        </div>
                      </Link>
                      {s.snippet && <p className="text-[10px] text-[#6b6560] mt-1.5 line-clamp-2 italic font-body leading-relaxed">{s.snippet}</p>}
                      <button onClick={() => pushContext(`The user is now looking at "${s.title}" by ${s.author}${s.pageNumber ? `, page ${s.pageNumber}` : ''}. ${s.snippet ? `Passage: "${s.snippet.slice(0, 150)}"` : ''}`)}
                        className="mt-1.5 text-[10px] text-[#c9a86c] hover:text-[#a88a4c] font-sans tracking-wide uppercase">Tell Librarian</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Docked control bar */}
          <div className="border-t border-[#e8e4dc] bg-white shrink-0 px-4 pt-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
            <div className="max-w-2xl mx-auto w-full flex flex-col items-center gap-2.5">
              <div
                onMouseDown={holdStart} onMouseUp={holdEnd} onMouseLeave={holdEnd}
                onTouchStart={holdStart} onTouchEnd={holdEnd}
                className={`select-none w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all duration-150 ${
                  holding ? 'bg-[#c9a86c] text-[#0e0c0a] shadow-[0_0_40px_rgba(201,168,108,0.5)]'
                    : agentSpeaking ? 'bg-[#1a1612] text-[#c9a86c]'
                      : pttMode ? 'bg-[#1a1612] text-white cursor-pointer hover:bg-[#2c2824]'
                        : 'bg-[#c9a86c] text-[#0e0c0a]'
                }`}
                style={{ transform: holding ? 'scale(1.08)' : `scale(${1 + volume * 0.1})` }}
              >
                <div className="flex flex-col items-center">
                  {agentSpeaking && !holding ? <SpeakerIcon /> : <MicIcon />}
                  <span className="text-[10px] mt-0.5 font-sans">{holding ? 'Speaking' : agentSpeaking ? 'Speaking' : pttMode ? 'Hold to talk' : 'Listening'}</span>
                </div>
              </div>
              <p className="text-xs text-[#8a8480] font-sans">{pttMode ? 'Hold the mic or press spacebar to talk' : 'Open mic — just speak'}</p>

              <div className="flex gap-2 w-full">
                <input type="text" value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendText()}
                  placeholder="…or type a question"
                  className="flex-1 px-4 py-2.5 text-sm font-sans bg-[#f5f0e8] border border-[#e8e4dc] rounded-full focus:outline-none focus:border-[#c9a86c]/60 text-[#2c2824] placeholder-[#b0a89c]" />
                <button onClick={sendText} className="px-5 py-2.5 text-sm font-sans font-medium bg-[#1a1612] text-white rounded-full hover:bg-[#2c2824] transition-colors">Send</button>
              </div>

              <div className="flex items-center gap-4">
                <button onClick={togglePtt} className={`text-xs font-sans transition-colors ${pttMode ? 'text-[#c9a86c]' : 'text-[#8a8480] hover:text-[#6b6560]'}`}>
                  {pttMode ? 'Switch to open mic' : 'Switch to push-to-talk'}
                </button>
                <span className="text-[#d8d2c8]">&middot;</span>
                <button onClick={stop} className="text-xs text-[#8a8480] hover:text-[#6b6560] font-sans transition-colors">End</button>
                <span className="text-[#d8d2c8]">&middot;</span>
                <Link href="/librarian" className="text-xs text-[#8a8480] hover:text-[#6b6560] font-sans">Text chat</Link>
              </div>
            </div>
          </div>
        </div>
      )}
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
