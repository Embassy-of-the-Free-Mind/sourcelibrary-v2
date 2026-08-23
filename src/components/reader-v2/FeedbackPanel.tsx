'use client';

/**
 * Send feedback about the page you are reading, without leaving it.
 *
 * The reader already had a "Send feedback" link in the site menu, but that
 * navigates away — so the reader loses the page, and with it the one piece of
 * context that makes a report actionable. This panel keeps the page and sends
 * its URL along with the note, the way the on-page widget does elsewhere.
 *
 * Everything the panel needs is inside the panel: the form, the page it will
 * name, the send state and the result. No modal, no navigation.
 */

import { useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale } from '@/lib/i18n';
import { getReaderStrings } from '@/lib/reader-strings';
import { MIN_FEEDBACK_MESSAGE, MAX_FEEDBACK_MESSAGE } from '@/lib/feedback-limits';
import type { Book, Page } from '@/lib/types';

const FIELD =
  'w-full border font-sans text-[16px] lg:text-[13px] px-2.5 py-2 outline-none transition-colors '
  + 'focus:border-[var(--text-muted)]';

export function FeedbackPanel({ page, book, url }: { page: Page; book: Book; url: string }) {
  const t = getReaderStrings(useLocale()).feedback;
  const { data: session } = useSession();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedInEmail = session?.user?.email || '';
  const tooShort = message.trim().length < MIN_FEEDBACK_MESSAGE;

  async function send() {
    if (sending || tooShort) { setError(tooShort ? t.tooShort : null); return; }
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim().slice(0, MAX_FEEDBACK_MESSAGE),
          // The page is the point. A note that says "the translation stops
          // halfway" is unusable without knowing which page it stopped on.
          page: url,
          email: (email.trim() || signedInEmail) || undefined,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSent(true);
    } catch {
      // Only claim it reached us when it did.
      setError(t.failed);
    }
    setSending(false);
  }

  if (sent) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-5" style={{ overscrollBehavior: 'contain' }}>
        <p
          className="font-sans text-[13px] leading-relaxed flex items-start gap-2"
          style={{ color: 'var(--text-primary)' }}
          role="status"
        >
          <Check size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--accent-sage-dark)' }} />
          {t.thanks}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-5" style={{ overscrollBehavior: 'contain' }}>
      <p className="font-sans text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t.blurb}
      </p>

      <label className="block mt-3">
        <span className="sr-only">{t.placeholder}</span>
        <textarea
          value={message}
          onChange={e => { setMessage(e.target.value); if (error) setError(null); }}
          placeholder={t.placeholder}
          rows={5}
          maxLength={MAX_FEEDBACK_MESSAGE}
          className={`${FIELD} resize-y leading-relaxed`}
          style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
        />
      </label>

      <label className="block mt-3">
        <span className="block font-sans text-[11.5px] pb-1" style={{ color: 'var(--text-muted)' }}>
          {t.emailLabel}
        </span>
        <input
          type="email"
          inputMode="email"
          value={email || signedInEmail}
          onChange={e => setEmail(e.target.value)}
          placeholder={t.emailPlaceholder}
          className={FIELD}
          style={{ borderColor: 'var(--border-medium)', background: 'var(--bg-white)', color: 'var(--text-primary)' }}
        />
        <span className="block font-sans text-[11px] leading-snug pt-1" style={{ color: 'var(--text-faint)' }}>
          {t.emailNote}
        </span>
      </label>

      <div className="flex items-center gap-3 pt-3.5">
        <button
          type="button"
          onClick={send}
          disabled={sending || tooShort}
          className="inline-flex items-center gap-2 h-9 px-3.5 border font-sans text-[12.5px] transition-opacity hover:opacity-85 disabled:opacity-45 disabled:cursor-default"
          style={{ background: 'var(--text-primary)', color: 'var(--bg-cream)', borderColor: 'var(--text-primary)' }}
        >
          {sending && <Loader2 size={13} className="animate-spin" />}
          {sending ? t.sending : t.send}
        </button>
      </div>

      {error && (
        <p className="font-sans text-[12.5px] pt-2.5" style={{ color: 'var(--status-error)' }} role="alert">
          {error}
        </p>
      )}

      {/* Said plainly rather than left implicit: the note carries the page,
          and a reader should know that before they write it. */}
      <p className="font-sans text-[11.5px] leading-snug pt-4" style={{ color: 'var(--text-faint)' }}>
        {t.aboutPage(page.page_number ?? '—')}
        {book.display_title || book.title ? ` ${book.display_title || book.title}` : ''}
      </p>
    </div>
  );
}
