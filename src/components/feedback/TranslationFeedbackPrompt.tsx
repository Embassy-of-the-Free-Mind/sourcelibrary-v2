'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n';
import { READER_STRINGS } from '@/lib/book-i18n';

/**
 * Contextual feedback prompt shown at the bottom of translated text.
 * Submits to the same /api/feedback endpoint with page context.
 */
export default function TranslationFeedbackPrompt({
  bookId,
  bookTitle,
  pageNumber,
  pageId,
}: {
  bookId: string;
  bookTitle: string;
  pageNumber: number;
  pageId: string;
}) {
  const rs = READER_STRINGS[useLocale()];
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  if (status === 'sent') {
    return (
      <div className="mt-6 pt-4 text-center" style={{ borderTop: '1px solid var(--border-light, #e8e5e0)' }}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {rs.feedbackThanks}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-6 pt-4 text-center" style={{ borderTop: '1px solid var(--border-light, #e8e5e0)' }}>
        <button
          onClick={() => setOpen(true)}
          className="text-sm transition-colors hover:underline"
          style={{ color: 'var(--text-faint, #c4c0b8)' }}
        >
          {rs.translationIssue}
        </button>
      </div>
    );
  }

  const submit = async () => {
    if (!message.trim()) return;
    setStatus('sending');
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[Translation feedback] "${bookTitle}" p.${pageNumber}: ${message.trim()}`,
          page: `/book/${bookId}/page/${pageId}`,
        }),
      });
    } catch { /* best effort */ }
    setStatus('sent');
  };

  return (
    <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-light, #e8e5e0)' }}>
      <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
        {rs.feedbackWhat}
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={rs.feedbackPlaceholder}
        rows={2}
        className="w-full px-3 py-2 rounded-lg text-sm resize-none focus:outline-none"
        style={{
          border: '1px solid var(--border-light, #e8e5e0)',
          color: 'var(--text-primary)',
          background: 'var(--bg-white)',
        }}
        autoFocus
      />
      <div className="flex items-center justify-between mt-2">
        <button
          onClick={() => setOpen(false)}
          className="text-xs transition-colors"
          style={{ color: 'var(--text-faint)' }}
        >
          {rs.cancel}
        </button>
        <button
          onClick={submit}
          disabled={!message.trim() || status === 'sending'}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--text-primary, #2c2824)' }}
        >
          {status === 'sending' ? rs.sending : rs.send}
        </button>
      </div>
    </div>
  );
}
