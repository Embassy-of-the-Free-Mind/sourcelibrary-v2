'use client';

import { useState } from 'react';

/**
 * A one-field email capture that feeds the same mailing list as the beta
 * signup (Mongo `beta_subscribers` + Resend audience). No account required.
 * `source` tags where the signup came from so it's traceable in the data.
 */
export default function QuickSubscribe({ source = 'support' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/beta/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      const data = await res.json();
      if (res.ok) setDone(true);
      else setError(data.error || 'Something went wrong');
    } catch {
      setError('Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <p className="text-stone-600 text-sm">
        Thank you — you&apos;re on the list. We&apos;ll share new translations as they land.
      </p>
    );
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-md">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          aria-label="Email address"
          className="flex-1 px-4 py-3 rounded-lg border border-stone-300 text-stone-900 placeholder-stone-400 text-sm focus:outline-none focus:border-accent-rust transition-colors"
        />
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-3 rounded-lg bg-accent-rust text-white text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition-all whitespace-nowrap"
        >
          {submitting ? 'Joining…' : 'Keep me posted'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-accent-rust">{error}</p>}
    </div>
  );
}
