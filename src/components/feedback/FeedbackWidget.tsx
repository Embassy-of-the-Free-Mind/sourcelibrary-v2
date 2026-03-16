'use client';

import { useState } from 'react';

export default function FeedbackWidget({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const submit = async () => {
    if (!message.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          name: name.trim() || null,
          page: typeof window !== 'undefined' ? window.location.pathname : null,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      setMessage('');
      setName('');
      setTimeout(() => { setOpen(false); setStatus('idle'); }, 2000);
    } catch {
      setStatus('error');
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={className || "text-accent-rust hover:text-accent-gold transition-colors"}
        style={style}
      >
        Feedback
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 pt-16 sm:pt-4" onClick={() => setOpen(false)}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 max-h-[80dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {status === 'sent' ? (
          <div className="text-center py-4">
            <p className="text-lg font-medium text-stone-800">Thank you!</p>
            <p className="text-sm text-stone-500 mt-1">Your feedback has been received.</p>
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

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full px-3 py-2 mt-3 rounded-lg border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-accent-gold"
            />

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-stone-400">
                Sent from {typeof window !== 'undefined' ? window.location.pathname : '/'}
              </p>
              <button
                onClick={submit}
                disabled={!message.trim() || status === 'sending'}
                className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
              >
                {status === 'sending' ? 'Sending...' : status === 'error' ? 'Try again' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
