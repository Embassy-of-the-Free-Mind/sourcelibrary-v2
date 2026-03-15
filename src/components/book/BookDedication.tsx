'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface BookDedicationProps {
  bookId: string;
  dedication?: { name: string } | null;
}

/**
 * Displays an existing dedication, or (for members) offers to dedicate the book.
 * Shown on the book page, quiet and permanent — like a donor plaque.
 */
export default function BookDedication({ bookId, dedication: initialDedication }: BookDedicationProps) {
  const { data: session } = useSession();
  const isMember = (session?.user as any)?.membership != null;
  const [dedication, setDedication] = useState(initialDedication);
  const [dedicating, setDedicating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show existing dedication
  if (dedication) {
    return (
      <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
        This translation was made possible by {dedication.name}
      </p>
    );
  }

  // Only members can dedicate, and only if not already dedicated
  if (!isMember) return null;

  const handleDedicate = async () => {
    setDedicating(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/dedicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setDedication({ name: data.name });
        setShowConfirm(false);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setDedicating(false);
    }
  };

  if (showConfirm) {
    return (
      <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        <p className="mb-2">
          Your name will appear on this book permanently:
          <br />
          <span className="italic" style={{ color: 'var(--text-muted)' }}>
            &ldquo;This translation was made possible by {session?.user?.name || 'you'}&rdquo;
          </span>
        </p>
        {error && <p className="text-xs mb-2" style={{ color: 'var(--accent-rust)' }}>{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleDedicate}
            disabled={dedicating}
            className="px-3 py-1 rounded text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--text-primary)', color: 'white' }}
          >
            {dedicating ? 'Dedicating...' : 'Confirm'}
          </button>
          <button
            onClick={() => { setShowConfirm(false); setError(null); }}
            className="px-3 py-1 rounded text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
          One dedication per year with your membership.
        </p>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="text-sm hover:opacity-70 transition-opacity"
      style={{ color: 'var(--text-muted)' }}
    >
      Dedicate this translation
    </button>
  );
}
