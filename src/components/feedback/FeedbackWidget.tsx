'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';

export default function FeedbackWidget({ className, style, initialMessage, label }: { className?: string; style?: React.CSSProperties; initialMessage?: string; label?: string }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [wantsToHelp, setWantsToHelp] = useState(false);
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
      setWantsToHelp(false);
      setTimeout(() => { setOpen(false); setStatus('idle'); }, sentWithVolunteer ? 2400 : 2000);
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
            <p className="text-lg font-medium text-stone-800">Thank you!</p>
            <p className="text-sm text-stone-500 mt-1">
              {wantsToHelp ? "We'll be in touch about helping out." : 'Your feedback has been received.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-stone-800">Send feedback</h3>
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Spot an error? Have an idea? Anything at all..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-accent-gold resize-none"
              autoFocus
            />

            {signedInName ? (
              <p className="text-xs text-stone-500 mt-3">Sending as {signedInName}</p>
            ) : (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name (optional)"
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
                I&rsquo;d like to help — translations, research, or suggesting books.
                <span className="block text-xs text-stone-500 mt-0.5">We&rsquo;ll email you to learn more.</span>
              </span>
            </label>

            {wantsToHelp && !signedInEmail && (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email (so we can reach out)"
                required
                className="w-full px-3 py-2 mt-2 rounded-lg border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-accent-gold"
              />
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 w-full">
              <p className="text-xs text-stone-400 truncate min-w-0 flex-1">
                Sent from {typeof window !== 'undefined' ? window.location.pathname : '/'}
              </p>
              <button
                onClick={submit}
                disabled={!message.trim() || status === 'sending' || needsEmailForVolunteer}
                className="w-full sm:w-auto flex-shrink-0 px-4 py-2 bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {status === 'sending' ? 'Sending...' : status === 'error' ? 'Try again' : 'Send'}
              </button>
            </div>
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
        onClick={() => { if (initialMessage && !message) setMessage(initialMessage); setOpen(true); }}
        className={className || "text-accent-rust hover:text-accent-gold transition-colors"}
        style={style}
      >
        {label || 'Feedback'}
      </button>
      {modal}
    </>
  );
}
