'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Room {
  id: string;
  slug: string;
  name: string;
  description: string;
  pinned: boolean;
  messageCount: number;
  lastMessageAt: string;
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

export default function EmbassyPage() {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadPreview[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load public threads and rooms
  useEffect(() => {
    fetch('/api/embassy/threads?limit=10')
      .then(r => r.json())
      .then(data => { if (data.threads) setThreads(data.threads); })
      .catch(() => {});

    fetch('/api/embassy/rooms')
      .then(r => r.json())
      .then(data => { if (data.rooms) setRooms(data.rooms); })
      .catch(() => {});
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
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

    // Reset textarea height
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
            content: 'Please [sign in](/auth/signin?callbackUrl=/embassy) to talk with the Librarian. It\'s free — just create an account or sign in with Google.',
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

      // SSE streaming response
      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        // Add empty assistant message that we'll stream into
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
                } else if (event.type === 'chunk') {
                  setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last?.role === 'assistant') {
                      updated[updated.length - 1] = { ...last, content: last.content + event.text };
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
        // Fallback: non-streaming JSON response
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
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader
        variant="light"
        breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]}
      />

      <div className="max-w-[1200px] mx-auto px-6 md:px-12 py-8 md:py-12">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">

          {/* Main: Reading Room */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="mb-8">
              <h1
                className="text-3xl md:text-4xl font-serif text-[#1a1612] mb-2"
                style={{ fontWeight: 400 }}
              >
                The Reading Room
              </h1>
              <p className="text-[#6b6560] text-sm font-body leading-relaxed max-w-[520px]">
                Ask the Librarian about any text in the collection — alchemy, Hermetica,
                Kabbalah, astrology, natural philosophy. Over 5,000 rare books, many translated
                for the first time.
              </p>
            </div>

            {/* Chat area */}
            <div className="border border-[#e8e4dc] rounded-lg bg-white overflow-hidden">
              {/* Messages */}
              <div className="min-h-[300px] max-h-[600px] overflow-y-auto p-6 space-y-6">
                {messages.length === 0 && (
                  <div className="text-center py-12">
                    <div className="text-[#c9a86c] text-4xl mb-4" style={{ fontFamily: 'serif' }}>
                      &#x2609;
                    </div>
                    <p className="text-[#6b6560] font-body text-lg mb-2">
                      Welcome to the Embassy of the Free Mind.
                    </p>
                    <p className="text-[#8a8480] text-sm font-body max-w-[400px] mx-auto leading-relaxed">
                      The Librarian has read every text in the collection.
                      Ask about an author, a tradition, a symbol, or a passage.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2 mt-6">
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

                {sending && (
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#f5f0e8] flex items-center justify-center text-[#c9a86c] text-sm" style={{ fontFamily: 'serif' }}>
                      &#x2609;
                    </div>
                    <div className="bg-[#f5f0e8] rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="flex gap-1.5 items-center h-5">
                        <div className="w-1.5 h-1.5 bg-[#c9a86c] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-[#c9a86c] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-[#c9a86c] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
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
                    <Link href="/auth/signin?callbackUrl=/embassy" className="text-[#9e4a3a] hover:underline">
                      Sign in
                    </Link>
                    {' '}to talk with the Librarian. Free — no membership required.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar: Activity Feed */}
          <div className="lg:w-[320px] flex-shrink-0">
            <div className="lg:sticky lg:top-8">
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
                      href={`/embassy/thread/${thread.id}`}
                      className="block py-4 border-b border-[#e8e4dc] hover:bg-[#f5f0e8]/50 transition-colors -mx-2 px-2 rounded"
                    >
                      <p className="text-sm font-body text-[#1a1612] line-clamp-2 leading-snug mb-1">
                        {thread.preview.question}
                      </p>
                      <p className="text-[12px] text-[#8a8480] font-body line-clamp-2 leading-relaxed mb-1.5">
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

              {/* Rooms */}
              <div className="mt-8 pt-6 border-t border-[#e8e4dc]">
                <h2 className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase font-sans mb-3">
                  Rooms
                </h2>
                {rooms.length === 0 ? (
                  <p className="text-[#8a8480] text-sm font-body">Loading rooms...</p>
                ) : (
                  <div className="space-y-1">
                    {rooms.map((room) => (
                      <Link
                        key={room.id}
                        href={`/embassy/room/${room.slug}`}
                        className="block py-2 -mx-2 px-2 rounded hover:bg-[#f5f0e8]/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-sans text-[#1a1612]">{room.name}</span>
                          {room.messageCount > 0 && (
                            <span className="text-[10px] text-[#8a8480] font-sans">{room.messageCount}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#8a8480] font-body line-clamp-1">{room.description}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick links */}
              <div className="mt-6 pt-4 border-t border-[#e8e4dc]">
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
  );
}
