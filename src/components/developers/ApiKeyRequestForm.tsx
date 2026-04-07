'use client';

import { useState } from 'react';

export default function ApiKeyRequestForm() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    organization: '',
    use_case: '',
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');

    try {
      const res = await fetch('/api/dataset/v1/request-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || 'Something went wrong');
        return;
      }

      setStatus('success');
      setMessage(data.message);
    } catch {
      setStatus('error');
      setMessage('Network error — please try again');
    }
  }

  if (status === 'success') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-green-800 mb-2">Request received</h3>
        <p className="text-green-700">{message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-stone-700 mb-1">Name *</label>
          <input
            id="name"
            type="text"
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1">Email *</label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            placeholder="you@example.com"
          />
        </div>
      </div>
      <div>
        <label htmlFor="organization" className="block text-sm font-medium text-stone-700 mb-1">Organization</label>
        <input
          id="organization"
          type="text"
          value={form.organization}
          onChange={e => setForm(f => ({ ...f, organization: e.target.value }))}
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
          placeholder="University, company, or project"
        />
      </div>
      <div>
        <label htmlFor="use_case" className="block text-sm font-medium text-stone-700 mb-1">What will you use it for? *</label>
        <textarea
          id="use_case"
          required
          rows={3}
          value={form.use_case}
          onChange={e => setForm(f => ({ ...f, use_case: e.target.value }))}
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-none"
          placeholder="Research project, app integration, dataset access..."
        />
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-600">{message}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="px-5 py-2.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'submitting' ? 'Submitting...' : 'Request API Key'}
      </button>
    </form>
  );
}
