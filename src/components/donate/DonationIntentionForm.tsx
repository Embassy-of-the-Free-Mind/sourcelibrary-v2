'use client';

import { useState, type FormEvent } from 'react';

const AMOUNT_OPTIONS = [
  { value: 'under-1000', label: 'Under $1,000' },
  { value: '1000-5000', label: '$1,000 - $5,000' },
  { value: '5000-10000', label: '$5,000 - $10,000' },
  { value: '10000-25000', label: '$10,000 - $25,000' },
  { value: '25000-50000', label: '$25,000 - $50,000' },
  { value: '50000-plus', label: '$50,000+' },
];

const ROUTE_OPTIONS = [
  {
    value: 'naf',
    label: 'US Tax-Deductible (NAF)',
    description: 'Via the Netherland-America Foundation, a 501(c)(3) public charity.',
  },
  {
    value: 'efm',
    label: 'Direct to Embassy of the Free Mind',
    description: 'For European and international donors. ANBI-registered in the Netherlands.',
  },
  {
    value: 'undecided',
    label: "I'm not sure yet",
    description: "We'll help you find the best option for your situation.",
  },
];

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export default function DonationIntentionForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [route, setRoute] = useState('');
  const [amountRange, setAmountRange] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !route) return;

    setState('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('/api/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          route,
          amount_range: amountRange || undefined,
          message: message.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong');
      }

      setState('success');
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  if (state === 'success') {
    return (
      <div className="bg-[#faf8f5] rounded-2xl border border-stone-200 p-8 md:p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-2xl font-display text-stone-900 mb-3">Thank you, {name.split(' ')[0]}</h3>
        <p className="text-stone-600 text-lg leading-relaxed max-w-md mx-auto mb-4">
          We've sent you an email with next steps and a personal introduction to Derek Lomas, our Project Director, who can help with anything you need.
        </p>
        <p className="text-stone-500 text-sm">
          Check your inbox at <strong>{email}</strong>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[#faf8f5] rounded-2xl border border-stone-200 p-8 md:p-10">
      <div className="mb-8">
        <h3 className="text-2xl font-display text-stone-900 mb-2">Express Your Interest</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Tell us a bit about yourself and we'll follow up personally to help make your contribution as easy as possible.
        </p>
      </div>

      <div className="space-y-6">
        {/* Name + Email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="donor-name" className="block text-sm font-medium text-stone-700 mb-1.5">
              Your name
            </label>
            <input
              id="donor-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust transition-colors"
              placeholder="Full name"
            />
          </div>
          <div>
            <label htmlFor="donor-email" className="block text-sm font-medium text-stone-700 mb-1.5">
              Email
            </label>
            <input
              id="donor-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust transition-colors"
              placeholder="you@example.com"
            />
          </div>
        </div>

        {/* Donation Route */}
        <fieldset>
          <legend className="block text-sm font-medium text-stone-700 mb-3">
            How would you like to donate?
          </legend>
          <div className="space-y-3">
            {ROUTE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                  route === opt.value
                    ? 'border-accent-rust bg-white shadow-sm'
                    : 'border-stone-200 bg-white/50 hover:border-stone-300'
                }`}
              >
                <input
                  type="radio"
                  name="route"
                  value={opt.value}
                  checked={route === opt.value}
                  onChange={(e) => setRoute(e.target.value)}
                  className="mt-0.5 accent-accent-rust"
                  required
                />
                <div>
                  <div className="text-sm font-medium text-stone-900">{opt.label}</div>
                  <div className="text-xs text-stone-500 mt-0.5">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Amount Range */}
        <div>
          <label htmlFor="donor-amount" className="block text-sm font-medium text-stone-700 mb-1.5">
            Approximate amount <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <select
            id="donor-amount"
            value={amountRange}
            onChange={(e) => setAmountRange(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust transition-colors"
          >
            <option value="">Prefer not to say</option>
            {AMOUNT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Message */}
        <div>
          <label htmlFor="donor-message" className="block text-sm font-medium text-stone-700 mb-1.5">
            Anything you'd like us to know? <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <textarea
            id="donor-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 rounded-lg border border-stone-300 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust transition-colors resize-none"
            placeholder="What draws you to this work, how you found us, or anything else..."
          />
        </div>

        {/* Error */}
        {state === 'error' && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">
            {errorMsg || 'Something went wrong. Please try again or email team@sourcelibrary.org directly.'}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={state === 'submitting' || !name.trim() || !email.trim() || !route}
          className="w-full bg-stone-900 text-white py-3.5 px-6 rounded-full hover:bg-stone-800 transition-colors text-base font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state === 'submitting' ? 'Sending...' : 'Get in Touch'}
        </button>

        <p className="text-xs text-stone-400 text-center leading-relaxed">
          We'll respond personally within one business day. Your information is never shared.
        </p>
      </div>
    </form>
  );
}
