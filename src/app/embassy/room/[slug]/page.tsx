'use client';

import { useState, useEffect, useRef, use, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';

interface RoomMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  content: string;
  createdAt: string;
}

interface RoomInfo {
  slug: string;
  name: string;
  description: string;
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Avatar({ name, image }: { name: string; image?: string | null }) {
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt={name} className="w-8 h-8 rounded-full flex-shrink-0" />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-[#1a1612] flex items-center justify-center text-white text-xs font-sans flex-shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: session, status } = useSession();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageTime = useRef<string | null>(null);
  const isSignedIn = status !== 'loading' && !!session?.user;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load room info
  useEffect(() => {
    fetch('/api/embassy/rooms')
      .then(r => r.json())
      .then(data => {
        const found = data.rooms?.find((r: any) => r.slug === slug);
        if (found) {
          setRoom({ slug: found.slug, name: found.name, description: found.description });
        } else {
          setError('Room not found');
        }
      })
      .catch(() => setError('Failed to load room'));
  }, [slug]);

  // Load initial messages
  useEffect(() => {
    fetch(`/api/embassy/rooms/${slug}/messages?limit=50`)
      .then(r => {
        if (!r.ok) throw new Error('Failed');
        return r.json();
      })
      .then(data => {
        setMessages(data.messages || []);
        if (data.messages?.length > 0) {
          lastMessageTime.current = data.messages[data.messages.length - 1].createdAt;
        }
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      })
      .catch(() => {
        setLoading(false);
        setError('Failed to load messages');
      });
  }, [slug, scrollToBottom]);

  // Poll for new messages every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!lastMessageTime.current) return;
      try {
        const res = await fetch(
          `/api/embassy/rooms/${slug}/messages?after=${encodeURIComponent(lastMessageTime.current)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages?.length > 0) {
          setMessages(prev => [...prev, ...data.messages]);
          lastMessageTime.current = data.messages[data.messages.length - 1].createdAt;
          setTimeout(scrollToBottom, 100);
        }
      } catch { /* silent */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [slug, scrollToBottom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending || !isSignedIn) return;

    setInput('');
    setSending(true);

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch(`/api/embassy/rooms/${slug}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });

      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      setMessages(prev => [...prev, data.message]);
      lastMessageTime.current = data.message.createdAt;
      setTimeout(scrollToBottom, 100);
    } catch {
      setInput(trimmed);
    }

    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  // Group consecutive messages from the same author
  const groupedMessages: { msg: RoomMessage; showHeader: boolean }[] = messages.map((msg, i) => ({
    msg,
    showHeader: i === 0 || messages[i - 1].authorId !== msg.authorId ||
      (new Date(msg.createdAt).getTime() - new Date(messages[i - 1].createdAt).getTime() > 300000),
  }));

  if (error) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16 text-center">
          <h1 className="text-2xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            {error}
          </h1>
          <Link href="/embassy" className="text-sm text-[#9e4a3a] hover:underline font-sans">
            Return to the Embassy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9] flex flex-col">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />

      {/* Room header */}
      <div className="border-b border-[#e8e4dc] bg-white">
        <div className="max-w-[800px] mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/embassy"
              className="text-[#8a8480] hover:text-[#6b6560] transition-colors"
              aria-label="Back to Embassy"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12 15L7 10L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <div>
              <h1 className="text-lg font-serif text-[#1a1612]" style={{ fontWeight: 500 }}>
                {room?.name || slug}
              </h1>
              {room?.description && (
                <p className="text-[12px] text-[#8a8480] font-body">{room.description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[800px] mx-auto px-6 py-4">
          {loading ? (
            <p className="text-[#8a8480] text-sm font-body py-8 text-center">Loading messages...</p>
          ) : messages.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-[#6b6560] font-body text-lg mb-2">No messages yet.</p>
              <p className="text-[#8a8480] text-sm font-body">
                Be the first to say something in {room?.name || 'this room'}.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {groupedMessages.map(({ msg, showHeader }) => (
                <div key={msg.id} className={`flex gap-3 ${showHeader ? 'mt-4' : 'ml-11'}`}>
                  {showHeader && (
                    <Avatar name={msg.authorName} image={msg.authorImage} />
                  )}
                  <div className="flex-1 min-w-0">
                    {showHeader && (
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-sm font-sans font-medium text-[#1a1612]">
                          {msg.authorName}
                        </span>
                        <span className="text-[10px] text-[#8a8480] font-sans">
                          {timeAgo(msg.createdAt)}
                        </span>
                      </div>
                    )}
                    <div className="text-[15px] font-body leading-relaxed text-[#333] prose prose-sm max-w-none prose-a:text-[#9e4a3a] prose-a:no-underline hover:prose-a:underline">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-[#e8e4dc] bg-white">
        <div className="max-w-[800px] mx-auto px-6 py-3">
          {isSignedIn ? (
            <form onSubmit={handleSubmit} className="flex gap-3 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${room?.name || ''}...`}
                rows={1}
                className="flex-1 resize-none border border-[#e8e4dc] rounded-lg px-4 py-2.5 text-[15px] font-body text-[#1a1612] placeholder-[#8a8480] focus:outline-none focus:border-[#c9a86c] transition-colors bg-transparent"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="flex-shrink-0 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] disabled:opacity-30 transition-colors"
              >
                Send
              </button>
            </form>
          ) : (
            <p className="text-center text-[13px] text-[#8a8480] font-sans py-2">
              <Link href={`/auth/signin?callbackUrl=/embassy/room/${slug}`} className="text-[#9e4a3a] hover:underline">
                Sign in
              </Link>
              {' '}to join the conversation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
