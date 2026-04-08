'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import SiteHeader from '@/components/layout/SiteHeader';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ThreadPreview {
  id: string;
  title: string;
  creatorName: string;
  messageCount: number;
  createdAt: string;
  lastMessageAt: string;
  preview: {
    question: string;
    answer: string;
  };
}

interface FeaturedPassage {
  text: string;
  bookTitle: string;
  bookAuthor: string;
  bookYear: number | null;
  bookSlug: string;
  pageNumber: number;
}

interface ReadingRoomClientProps {
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

export default function ReadingRoomClient({ featuredPassage }: ReadingRoomClientProps) {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/embassy/threads?limit=10')
      .then(r => r.json())
      .then(data => { if (data.threads) setThreads(data.threads); })
      .catch(() => {});
  }, []);

  // Auto-scroll chat container to bottom on new content (including streaming chunks)
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    // Only auto-scroll if user is near the bottom (not scrolled up to read history)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSending(true);

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch('/api/embassy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          message: trimmed,
          history: messages,
          visibility,
          stream: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'Please [sign in](/auth/signin?callbackUrl=/reading-room) to talk with the Librarian. It\'s free — just create an account or sign in with Google.',
          }]);
        } else {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: err.error || 'Something went wrong. Please try again.',
          }]);
        }
        setSending(false);
        return;
      }

      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

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
                if (event.type === 'threadId' && !threadId) {
                  setThreadId(event.threadId);
                } else if (event.type === 'status') {
                  // Show status text (e.g. "Searching the collection...") as a temporary assistant message
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.role === 'assistant' && !last.content) {
                      updated[updated.length - 1] = { ...last, content: `*${event.text}*` };
                    }
                    return updated;
                  });
                } else if (event.type === 'chunk') {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.role === 'assistant') {
                      // Replace status text on first real chunk
                      const isStatus = last.content.startsWith('*') && last.content.endsWith('*');
                      const newContent = isStatus ? event.text : last.content + event.text;
                      updated[updated.length - 1] = { ...last, content: newContent };
                    }
                    return updated;
                  });
                } else if (event.type === 'error') {
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: event.message };
                    return updated;
                  });
                }
              } catch {
                // Skip malformed events
              }
            }
          }
        }
      } else {
        const data = await res.json();
        if (data.threadId && !threadId) {
          setThreadId(data.threadId);
        }
        setMessages(prev => [...prev, { role: 'assistant', content: data.message.content }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'The Librarian seems to be away. Please try again in a moment.',
      }]);
    }

    setSending(false);
  };

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
      {/* Hero with reading room painting */}
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
          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-display mb-3 drop-shadow-lg"
            style={{ fontWeight: 500 }}
          >
            The Reading Room
          </h1>
          <p className="text-white/80 text-base sm:text-lg font-body leading-relaxed max-w-[480px] drop-shadow-sm">
            Ask the Librarian about any text in the collection — alchemy, Hermetica,
            Kabbalah, astrology, natural philosophy.
          </p>

          {/* Featured passage */}
          {featuredPassage && (
            <div className="mt-8 max-w-[560px]">
              <p className="text-[11px] text-white/40 tracking-[0.15em] uppercase font-sans mb-2">
                The Librarian is reading
              </p>
              <Link
                href={`/book/${featuredPassage.bookSlug}?page=${featuredPassage.pageNumber}`}
                className="block group"
              >
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

      {/* Main content — painting continues as background */}
      <div className="relative">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.sourcelibrary.org/artwork/reading-room-hero.png"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-[0.06]"
          />
        </div>
        <div className="relative max-w-[1200px] mx-auto px-6 md:px-12 py-8 md:py-12">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">

          {/* Chat area */}
          <div className="flex-1 min-w-0">
            <div className="border border-[#e8e4dc] rounded-lg bg-white overflow-hidden shadow-sm">
              {/* Messages */}
              <div ref={chatContainerRef} className="min-h-[300px] max-h-[600px] overflow-y-auto p-6 space-y-6">
                {messages.length === 0 && (
                  <div className="text-center py-8">
                    <div className="text-[#c9a86c] text-3xl mb-3" style={{ fontFamily: 'serif' }}>
                      &#x2609;
                    </div>
                    <p className="text-[#8a8480] text-sm font-body max-w-[400px] mx-auto leading-relaxed">
                      The Librarian searches the translated texts in the collection.
                      Ask about an author, a tradition, a symbol, or a passage.
                    </p>
                    <p className="text-[#8a8480]/50 text-xs font-body mt-1.5">
                      Responses may contain errors &mdash; always verify against the source page.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-5">
                      {[
                        'What did Agrippa write about planetary seals?',
                        'Tell me about the Emerald Tablet',
                        'Who was Marsilio Ficino?',
                        'What is the Philosopher\'s Stone?',
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => {
                            setInput(suggestion);
                            inputRef.current?.focus();
                          }}
                          className="px-3 py-1.5 text-xs text-[#6b6560] border border-[#e8e4dc] rounded-full hover:bg-[#f5f0e8] hover:text-[#444] transition-colors font-sans"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#f5f0e8] flex items-center justify-center text-[#c9a86c] text-sm" style={{ fontFamily: 'serif' }}>
                        &#x2609;
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] ${
                        msg.role === 'user'
                          ? 'bg-[#1a1612] text-white rounded-2xl rounded-br-sm px-4 py-3'
                          : 'bg-[#f5f0e8] text-[#1a1612] rounded-2xl rounded-bl-sm px-4 py-3'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none font-body text-[15px] leading-relaxed prose-a:text-[#9e4a3a] prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-[#c9a86c] prose-blockquote:text-[#444] prose-strong:text-[#1a1612]">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-[15px] font-body leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {sending && !(messages.length > 0 && messages[messages.length - 1]?.role === 'assistant') && (
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#f5f0e8] flex items-center justify-center text-[#c9a86c] text-sm" style={{ fontFamily: 'serif' }}>
                      &#x2609;
                    </div>
                    <div className="bg-[#f5f0e8] rounded-2xl rounded-bl-sm px-4 py-3">
                      <p className="text-[13px] text-[#8a8480] font-body italic">Searching the collection...</p>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
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
                  <button
                    type="submit"
                    disabled={!input.trim() || sending || (!isSignedIn && status !== 'loading')}
                    className="flex-shrink-0 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] disabled:opacity-30 transition-colors"
                  >
                    Send
                  </button>
                </form>

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-3">
                    {messages.length > 0 && (
                      <button
                        onClick={startNewThread}
                        className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans"
                      >
                        New conversation
                      </button>
                    )}
                  </div>
                  {isSignedIn && (
                    <button
                      onClick={() => setVisibility(v => v === 'public' ? 'private' : 'public')}
                      className="text-[11px] text-[#8a8480] hover:text-[#6b6560] transition-colors font-sans flex items-center gap-1"
                    >
                      <span>{visibility === 'public' ? 'Public' : 'Private'}</span>
                      <span className="text-[9px]">{visibility === 'public' ? '(visible to others)' : '(only you)'}</span>
                    </button>
                  )}
                </div>

                {!isSignedIn && status !== 'loading' && (
                  <p className="mt-2 text-[12px] text-[#8a8480] font-sans">
                    <Link href="/auth/signin?callbackUrl=/reading-room" className="text-[#9e4a3a] hover:underline">
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
              {/* Recent conversations */}
              <h2 className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase font-sans mb-4">
                Recent Conversations
              </h2>

              {threads.length === 0 ? (
                <p className="text-[#8a8480] text-sm font-body">
                  No conversations yet. Be the first to ask the Librarian something.
                </p>
              ) : (
                <div className="space-y-0">
                  {threads.map((thread) => (
                    <Link
                      key={thread.id}
                      href={`/reading-room/thread/${thread.id}`}
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
                        {thread.messageCount > 2 && (
                          <span> &middot; {thread.messageCount} messages</span>
                        )}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {/* Quick links */}
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
