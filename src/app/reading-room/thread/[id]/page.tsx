'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function linkifySourceUrls(text: string): string {
  return text.replace(
    /(?<!\]\()https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+)(?:\?page=(\d+))?/g,
    (match, _slug, page) => {
      const label = page ? `View source (p. ${page})` : 'View in collection';
      return `[${label}](${match})`;
    },
  );
}

function ensureParagraphBreaks(text: string): string {
  return text.replace(/([^\n])\n(?!\n)(?![-*>|`\d])/g, '$1\n\n');
}

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

interface PodcastData {
  audioUrl: string;
  generatedAt: string;
  topic: string;
  findingCount: number;
  script?: string;
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

// ── Podcast Player ────────────────────────────────────────────────────

function formatTranscript(script: string): { speaker: string; text: string }[] {
  return script
    .split('\n')
    .filter(line => line.includes(':'))
    .map(line => {
      const colonIdx = line.indexOf(':');
      const speaker = line.slice(0, colonIdx).trim();
      const text = line.slice(colonIdx + 1).trim()
        // Strip audio tags for display
        .replace(/\[(laughs|whispers|enthusiasm|thoughtful|determination)\]/gi, '');
      return { speaker, text };
    })
    .filter(entry => entry.text.length > 0);
}

function PodcastPlayer({ threadId }: { threadId: string }) {
  const [podcast, setPodcast] = useState<PodcastData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  // Check for existing podcast on mount
  useEffect(() => {
    fetch(`/api/embassy/threads/${threadId}/podcast`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.podcast) setPodcast(data.podcast);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [threadId]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/embassy/threads/${threadId}/podcast`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Generation failed');
        return;
      }
      setPodcast(data.podcast);
    } catch {
      setError('Network error — please try again');
    } finally {
      setGenerating(false);
    }
  }, [threadId]);

  if (!checked) return null;

  // Already have a podcast — show player
  if (podcast) {
    return (
      <div className="mt-8 p-5 bg-[#f5f0e8] rounded-xl border border-[#e0d9cc]">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-[#9e4a3a]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
          <p className="text-sm font-sans font-medium text-[#1a1612]">
            Deep Dive — {podcast.topic}
          </p>
        </div>
        <audio
          controls
          src={podcast.audioUrl}
          className="w-full"
          preload="metadata"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px] text-[#8a8480] font-sans">
            Generated from {podcast.findingCount} research findings
          </p>
          {podcast.script && (
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="text-[11px] text-[#9e4a3a] font-sans hover:underline"
            >
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
          )}
        </div>
        {showTranscript && podcast.script && (
          <div className="mt-3 pt-3 border-t border-[#e0d9cc] space-y-2 max-h-[400px] overflow-y-auto">
            {formatTranscript(podcast.script).map((entry, i) => (
              <p key={i} className="text-[13px] font-body leading-relaxed text-[#333]">
                <span className="font-semibold text-[#1a1612]">{entry.speaker}:</span>{' '}
                {entry.text}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // No podcast yet — show generate button
  return (
    <div className="mt-8 p-5 bg-[#f5f0e8]/50 rounded-xl border border-[#e0d9cc] border-dashed text-center">
      <p className="text-sm text-[#6b6560] font-body mb-3">
        Turn this research into a podcast episode
      </p>
      <button
        onClick={handleGenerate}
        disabled={generating}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1a1612] text-white rounded-lg text-sm font-sans hover:bg-[#2a2622] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {generating ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating podcast...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
            Generate Deep Dive
          </>
        )}
      </button>
      {error && (
        <p className="text-xs text-red-600 font-sans mt-2">{error}</p>
      )}
    </div>
  );
}

// ── Thread Page ───────────────────────────────────────────────────────

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

        {/* Podcast player / generator */}
        <PodcastPlayer threadId={id} />

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
