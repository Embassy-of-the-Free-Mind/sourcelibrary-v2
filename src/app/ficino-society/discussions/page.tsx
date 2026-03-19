'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface Thread {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
  lastActivityAt: string;
  replyCount: number;
  pinned: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function DiscussionsPage() {
  const { data: session, status } = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user) {
      setLoading(false);
      return;
    }

    fetch('/api/ficino/discussions')
      .then(r => {
        if (r.status === 403) {
          setError('membership');
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (data?.threads) setThreads(data.threads);
        setLoading(false);
      })
      .catch(() => {
        setError('failed');
        setLoading(false);
      });
  }, [session, status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newBody.trim()) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/ficino/discussions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), body: newBody.trim() }),
      });
      const data = await res.json();

      if (data.id) {
        // Redirect to the new thread
        window.location.href = `/ficino-society/discussions/${data.id}`;
      } else {
        setSubmitting(false);
      }
    } catch {
      setSubmitting(false);
    }
  };

  // Not signed in
  if (status !== 'loading' && !session?.user) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 text-center">
          <h1 className="text-3xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            The Correspondence
          </h1>
          <p className="text-[#444] font-body mb-8">
            Discussions among members of the Ficino Society.
          </p>
          <Link
            href="/auth/signin?callbackUrl=/ficino-society/discussions"
            className="inline-block px-6 py-2.5 rounded text-white text-sm bg-[#9e4a3a] hover:brightness-110 transition-all"
          >
            Sign in to read
          </Link>
        </div>
      </div>
    );
  }

  // Not a member — offer to join (free)
  if (error === 'membership') {
    const handleJoinHere = async () => {
      await fetch('/api/ficino/join', { method: 'POST' });
      window.location.reload();
    };

    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 text-center">
          <h1 className="text-3xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            The Correspondence
          </h1>
          <p className="text-[#444] font-body mb-8">
            Join the Ficino Society to participate in discussions.
            It&apos;s free and open to everyone.
          </p>
          <button
            onClick={handleJoinHere}
            className="inline-block px-6 py-2.5 rounded text-white text-sm bg-[#9e4a3a] hover:brightness-110 transition-all"
          >
            Join the Society
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <div className="max-w-[640px] mx-auto px-6 py-16 md:py-24">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/ficino-society"
            className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase hover:text-[#444] transition-colors font-sans"
          >
            The Ficino Society
          </Link>
          <h1 className="text-3xl md:text-4xl font-serif text-[#1a1612] mt-4 mb-2" style={{ fontWeight: 400 }}>
            The Correspondence
          </h1>
          <p className="text-[#6b6560] text-sm font-body">
            A place for members to discuss the texts, the translations, and the tradition.
          </p>
        </div>

        {/* New thread toggle */}
        {!showNewThread ? (
          <button
            onClick={() => setShowNewThread(true)}
            className="mb-12 text-sm text-[#9e4a3a] hover:text-[#b5564a] transition-colors font-sans"
          >
            Start a new thread
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="mb-12 border border-[#e8e4dc] rounded-lg p-6 bg-white">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Subject"
              maxLength={200}
              className="w-full text-lg font-serif text-[#1a1612] placeholder-[#8a8480] border-none outline-none mb-4 bg-transparent"
              style={{ fontWeight: 400 }}
              autoFocus
            />
            <textarea
              value={newBody}
              onChange={e => setNewBody(e.target.value)}
              placeholder="Write your thoughts..."
              maxLength={10000}
              rows={8}
              className="w-full text-[15px] text-[#333] placeholder-[#8a8480] border-none outline-none resize-none leading-relaxed font-body bg-transparent"
            />
            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[#e8e4dc]">
              <button
                type="submit"
                disabled={submitting || !newTitle.trim() || !newBody.trim()}
                className="px-5 py-2 rounded text-white text-sm bg-[#9e4a3a] hover:brightness-110 disabled:opacity-40 transition-all font-sans"
              >
                {submitting ? 'Posting...' : 'Post'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewThread(false); setNewTitle(''); setNewBody(''); }}
                className="px-4 py-2 text-sm text-[#6b6560] hover:text-[#444] transition-colors font-sans"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Threads list */}
        {loading ? (
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        ) : threads.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#6b6560] font-body text-lg mb-2">No discussions yet.</p>
            <p className="text-[#8a8480] text-sm font-body">
              Be the first to start a conversation.
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/ficino-society/discussions/${thread.id}`}
                className="block py-6 border-b border-[#e8e4dc] hover:bg-[#f5f0e8]/50 transition-colors -mx-4 px-4 rounded"
              >
                <h2
                  className="text-lg font-serif text-[#1a1612] mb-1.5 leading-snug"
                  style={{ fontWeight: 500 }}
                >
                  {thread.pinned && (
                    <span className="text-[#c9a86c] text-xs tracking-wider uppercase mr-2 font-sans" style={{ fontWeight: 400 }}>
                      Pinned
                    </span>
                  )}
                  {thread.title}
                </h2>
                <p className="text-sm text-[#6b6560] font-body line-clamp-2 mb-2 leading-relaxed">
                  {thread.body.slice(0, 200)}
                </p>
                <p className="text-[11px] text-[#8a8480] font-sans tracking-wide">
                  {thread.authorName} &middot; {formatDate(thread.createdAt)}
                  {thread.replyCount > 0 && (
                    <span> &middot; {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}</span>
                  )}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
