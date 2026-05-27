'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ensureParagraphBreaks, linkifySourceUrls } from '@/lib/markdown-prep';

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
        <SiteHeader variant="light" breadcrumbs={[{ label: 'Reading Room', href: '/reading-room' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16">
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <SiteHeader variant="light" breadcrumbs={[{ label: 'Reading Room', href: '/reading-room' }]} />
        <div className="max-w-[680px] mx-auto px-6 py-16 text-center">
          <h1 className="text-2xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            Thread not found
          </h1>
          <Link href="/reading-room" className="text-sm text-[#9e4a3a] hover:underline font-sans">
            Return to the Reading Room
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <SiteHeader variant="light" breadcrumbs={[{ label: 'Reading Room', href: '/reading-room' }]} />

      <div className="max-w-[680px] mx-auto px-6 py-8 md:py-12">
        <Link
          href="/reading-room"
          className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase hover:text-[#444] transition-colors font-sans"
        >
          The Reading Room
        </Link>

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

        <div className="space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className="flex gap-3">
              {msg.authorType === 'ai' ? (
                <img
                  src="/brand/png/icon-only--black-on-transparent--96h.png"
                  alt="Librarian"
                  className="flex-shrink-0 w-10 h-10 rounded-full"
                />
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
                  <div className="prose prose-sm max-w-none font-body text-[15px] leading-relaxed text-[#1a1612] prose-p:mb-4 prose-p:mt-0 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-5 prose-h3:mb-2 prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3 prose-headings:text-[#1a1612] prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-a:text-[#9e4a3a] prose-a:underline prose-a:underline-offset-2 prose-a:decoration-[#9e4a3a]/30 hover:prose-a:decoration-[#9e4a3a] prose-blockquote:border-l-[#c9a86c] prose-blockquote:text-[#444] prose-blockquote:my-4 prose-blockquote:italic prose-strong:text-[#1a1612] prose-hr:my-4 prose-img:rounded-lg prose-img:shadow-md prose-img:my-4 prose-img:max-h-[400px] prose-img:w-auto">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                        ),
                        img: ({ src, alt }) => (
                          <a href={src as string} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src as string} alt={(alt as string) || ''} className="rounded-lg shadow-md max-h-[400px] w-auto" loading="lazy" />
                          </a>
                        ),
                      }}
                    >{ensureParagraphBreaks(linkifySourceUrls(msg.content))}</ReactMarkdown>
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

        <div className="mt-12 pt-8 border-t border-[#e8e4dc] text-center">
          <p className="text-[#6b6560] text-sm font-body mb-3">
            Want to explore this topic further?
          </p>
          <Link
            href="/reading-room"
            className="inline-block px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors"
          >
            Ask the Librarian
          </Link>
        </div>
      </div>
    </div>
  );
}
