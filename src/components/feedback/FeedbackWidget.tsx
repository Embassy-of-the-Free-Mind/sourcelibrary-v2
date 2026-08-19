'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { useLocale, FEEDBACK_STRINGS } from '@/lib/i18n';

export default function FeedbackWidget({ className, style, initialMessage, label, heading, intro, placeholder, contactEmail }: { className?: string; style?: React.CSSProperties; initialMessage?: string; label?: string; heading?: string; intro?: string; placeholder?: string; contactEmail?: string }) {
  const { data: session } = useSession();
  // Explicit props still win — callers that pass copy (the 404 page, a book
  // page's "Request one") are saying something specific, not just labelling.
  const t = FEEDBACK_STRINGS[useLocale()];
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [wantsToHelp, setWantsToHelp] = useState(false);
  // Tracks whether the just-sent submission opted in to helping, so the success
  // state can route them to /welcome (the real onboarding capture) instead of
  // dead-ending at "we'll be in touch".
  const [submittedAsVolunteer, setSubmittedAsVolunteer] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const signedInName = session?.user?.name || '';
  const signedInEmail = session?.user?.email || '';
  const effectiveEmail = signedInEmail || email.trim();
  const needsEmailForVolunteer = wantsToHelp && !signedInEmail && !email.trim();

  useEffect(() => { setMounted(true); }, []);

  const submit = async () => {
    if (!message.trim()) return;
    if (needsEmailForVolunteer) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          name: signedInName || name.trim() || null,
          email: effectiveEmail || null,
          page: typeof window !== 'undefined' ? window.location.pathname : null,
          wantsToHelp,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      setMessage('');
      setName('');
      setEmail('');
      const sentWithVolunteer = wantsToHelp;
      setSubmittedAsVolunteer(sentWithVolunteer);
      setWantsToHelp(false);
      // Volunteers get a persistent success state with a link to /welcome — don't
      // auto-close it out from under them. Plain feedback still auto-dismisses.
      if (!sentWithVolunteer) setTimeout(() => { setOpen(false); setStatus('idle'); }, 2000);
    } catch {
      setStatus('error');
    }
  };

  const modal = open && mounted ? createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-start sm:items-center justify-center p-4 pt-16 sm:pt-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 max-h-[80dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {status === 'sent' ? (
          <div className="text-center py-4">
            <p className="text-lg font-medium text-stone-800">{t.thanks}</p>
            {submittedAsVolunteer ? (
              <>
                <p className="text-sm text-stone-500 mt-1">
                  We&rsquo;d love your help. Tell us a little about yourself and how you&rsquo;d like to contribute.
                </p>
                <a
                  href="/welcome"
                  className="inline-block mt-4 px-5 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
                  style={{ background: 'var(--accent-rust, #9e4a3a)' }}
                >
                  Tell us how you&rsquo;d like to help →
                </a>
                <button
                  onClick={() => { setOpen(false); setStatus('idle'); setSubmittedAsVolunteer(false); }}
                  className="block w-full mt-3 text-xs text-stone-400 hover:text-stone-600"
                >
                  Maybe later
                </button>
              </>
            ) : (
              <p className="text-sm text-stone-500 mt-1">{t.received}</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium text-stone-800">{heading || t.heading}</h3>
                {intro && <p className="text-sm text-stone-500 mt-0.5">{intro}</p>}
              </div>
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600 flex-shrink-0 ml-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={placeholder || t.placeholder}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-accent-gold resize-none"
              autoFocus
            />

            {signedInName ? (
              <p className="text-xs text-stone-500 mt-3">{t.sendingAs} {signedInName}</p>
            ) : (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.namePlaceholder}
                className="w-full px-3 py-2 mt-3 rounded-lg border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-accent-gold"
              />
            )}

            <label className="flex items-start gap-2.5 mt-4 p-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer hover:bg-stone-100 transition-colors">
              <input
                type="checkbox"
                checked={wantsToHelp}
                onChange={(e) => setWantsToHelp(e.target.checked)}
                className="mt-0.5 accent-stone-900"
              />
              <span className="text-sm text-stone-700 leading-snug">
                {t.helpLabel}
                <span className="block text-xs text-stone-500 mt-0.5">{t.helpHint}</span>
              </span>
            </label>

            {wantsToHelp && !signedInEmail && (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.emailPlaceholder}
                required
                className="w-full px-3 py-2 mt-2 rounded-lg border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-accent-gold"
              />
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 w-full">
              <p className="text-xs text-stone-400 truncate min-w-0 flex-1">
                {t.sentFrom} {typeof window !== 'undefined' ? window.location.pathname : '/'}
              </p>
              <button
                onClick={submit}
                disabled={!message.trim() || status === 'sending' || needsEmailForVolunteer}
                className="w-full sm:w-auto flex-shrink-0 px-4 py-2 bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {status === 'sending' ? t.sending : status === 'error' ? t.tryAgain : t.send}
              </button>
            </div>

            {contactEmail && (
              <p className="text-xs text-stone-400 mt-3 text-center">
                Prefer email?{' '}
                <a href={`mailto:${contactEmail}`} className="text-accent-rust hover:text-accent-gold underline">
                  {contactEmail}
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => { if (initialMessage && !message) setMessage(initialMessage); setStatus('idle'); setSubmittedAsVolunteer(false); setOpen(true); }}
        className={className || "text-accent-rust hover:text-accent-gold transition-colors"}
        style={style}
      >
        {label || 'Feedback'}
      </button>
      {modal}
    </>
  );
}
