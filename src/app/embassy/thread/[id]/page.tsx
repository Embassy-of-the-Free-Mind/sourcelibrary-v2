'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';

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
  creatorName: string;
  messageCount: number;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16">
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16 text-center">
          <h1 className="text-2xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            Thread not found
          </h1>
          <Link href="/embassy" className="text-sm text-[#9e4a3a] hover:underline font-sans">
            Return to the Reading Room
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'The Embassy', href: '/embassy' }]} />

      <div className="max-w-[680px] mx-auto px-6 py-8 md:py-12">
        {/* Back link */}
        <Link
          href="/embassy"
          className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase hover:text-[#444] transition-colors font-sans"
        >
          The Reading Room
        </Link>

        {/* Thread header */}
        <div className="mt-4 mb-8">
          <h1
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mb-2 leading-snug"
            style={{ fontWeight: 400 }}
          >
            {thread.title}
          </h1>
          <p className="text-[12px] text-[#8a8480] font-sans">
            {thread.creatorName} &middot; {formatDate(thread.createdAt)}
          </p>
        </div>

        {/* Messages */}
        <div className="space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.authorType === 'human' ? '' : ''}`}>
              {msg.authorType === 'ai' ? (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#f5f0e8] flex items-center justify-center text-[#c9a86c] text-sm" style={{ fontFamily: 'serif' }}>
                  &#x2609;
                </div>
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
                  <div className="prose prose-sm max-w-none font-body text-[15px] leading-relaxed text-[#1a1612] prose-a:text-[#9e4a3a] prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-[#c9a86c] prose-blockquote:text-[#444] prose-strong:text-[#1a1612]">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[15px] font-body leading-relaxed text-[#1a1612] whitespace-pre-wrap">
                    {msg.content}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 pt-8 border-t border-[#e8e4dc] text-center">
          <p className="text-[#6b6560] text-sm font-body mb-3">
            Want to explore this topic further?
          </p>
          <Link
            href="/embassy"
            className="inline-block px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors"
          >
            Ask the Librarian
          </Link>
        </div>
      </div>
    </div>
  );
}
