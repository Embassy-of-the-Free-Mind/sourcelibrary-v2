'use client';

import { useState, useEffect, use } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface ThreadData {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  replyCount: number;
  pinned: boolean;
}

interface Reply {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
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
  const { data: session } = useSession();
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session?.user) return;

    fetch(`/api/ficino/discussions/${id}`)
      .then(r => {
        if (r.status === 403) { setError('membership'); return null; }
        if (r.status === 404) { setError('not_found'); return null; }
        return r.json();
      })
      .then(data => {
        if (data) {
          setThread(data.thread);
          setReplies(data.replies);
          setCurrentUserId(data.currentUserId);
        }
        setLoading(false);
      })
      .catch(() => { setError('failed'); setLoading(false); });
  }, [session, id]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setSubmitting(true);

    try {
      const res = await fetch(`/api/ficino/discussions/${id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody.trim() }),
      });

      if (res.ok) {
        // Refetch thread to get updated replies
        const data = await fetch(`/api/ficino/discussions/${id}`).then(r => r.json());
        setThread(data.thread);
        setReplies(data.replies);
        setReplyBody('');
      }
    } catch {
      // Silently fail
    }
    setSubmitting(false);
  };

  if (!session?.user) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 text-center">
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

  if (error === 'membership') {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 text-center">
          <p className="text-[#444] font-body mb-6">This space is for members of the Ficino Society.</p>
          <Link href="/ficino-society" className="text-[#9e4a3a] text-sm hover:underline">
            Learn about membership
          </Link>
        </div>
      </div>
    );
  }

  if (error === 'not_found') {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 text-center">
          <p className="text-[#444] font-body mb-6">This thread could not be found.</p>
          <Link href="/ficino-society/discussions" className="text-[#9e4a3a] text-sm hover:underline">
            Back to discussions
          </Link>
        </div>
      </div>
    );
  }

  if (loading || !thread) {
    return (
      <div className="min-h-screen bg-[#fdfcf9]">
        <div className="max-w-[640px] mx-auto px-6 py-24">
          <p className="text-[#8a8480] text-sm font-body">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9]">
      <div className="max-w-[640px] mx-auto px-6 py-16 md:py-24">
        {/* Breadcrumb */}
        <Link
          href="/ficino-society/discussions"
          className="text-[11px] text-[#6b6560] tracking-[0.2em] uppercase hover:text-[#444] transition-colors font-sans"
        >
          The Correspondence
        </Link>

        {/* Thread */}
        <article className="mt-8 mb-16">
          <h1
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mb-3 leading-snug"
            style={{ fontWeight: 400 }}
          >
            {thread.title}
          </h1>
          <p className="text-[11px] text-[#8a8480] font-sans tracking-wide mb-8">
            {thread.authorName} &middot; {formatDate(thread.createdAt)}
          </p>

          <div className="prose-ficino text-[16px] leading-[1.85] text-[#333] font-body whitespace-pre-wrap">
            {thread.body}
          </div>
        </article>

        {/* Replies */}
        {replies.length > 0 && (
          <div className="border-t border-[#e8e4dc] pt-8 mb-12">
            <p className="text-[11px] text-[#8a8480] tracking-[0.2em] uppercase font-sans mb-8">
              {replies.length} {replies.length === 1 ? 'Reply' : 'Replies'}
            </p>

            <div className="space-y-8">
              {replies.map((reply) => (
                <div key={reply.id} className="border-l-2 border-[#e8e4dc] pl-5">
                  <p className="text-[11px] text-[#8a8480] font-sans tracking-wide mb-3">
                    {reply.authorName} &middot; {formatDate(reply.createdAt)}
                  </p>
                  <div className="text-[15px] leading-[1.8] text-[#333] font-body whitespace-pre-wrap">
                    {reply.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reply form */}
        <form onSubmit={handleReply} className="border-t border-[#e8e4dc] pt-8">
          <textarea
            value={replyBody}
            onChange={e => setReplyBody(e.target.value)}
            placeholder="Write a reply..."
            maxLength={10000}
            rows={5}
            className="w-full text-[15px] text-[#333] placeholder-[#8a8480] border border-[#e8e4dc] rounded-lg p-4 outline-none resize-none leading-relaxed font-body bg-white focus:border-[#c9a86c]/50 transition-colors"
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              type="submit"
              disabled={submitting || !replyBody.trim()}
              className="px-5 py-2 rounded text-white text-sm bg-[#9e4a3a] hover:brightness-110 disabled:opacity-40 transition-all font-sans"
            >
              {submitting ? 'Posting...' : 'Reply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
