'use client';

import { useState } from 'react';

export default function AcademicAccessForm() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    institution: '',
    role: '',
    research_area: '',
    intended_use: '',
    access_needs: [] as string[],
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  function toggleAccess(value: string) {
    setForm(f => ({
      ...f,
      access_needs: f.access_needs.includes(value)
        ? f.access_needs.filter(v => v !== value)
        : [...f.access_needs, value],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');

    try {
      const res = await fetch('/api/research-access', {
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
        <h3 className="text-lg font-semibold text-green-800 mb-2">Application received</h3>
        <p className="text-green-700">{message}</p>
      </div>
    );
  }

  const accessOptions = [
    { value: 'api', label: 'API access' },
    { value: 'bulk_data', label: 'Bulk data / corpus export' },
    { value: 'mcp', label: 'MCP server for AI tools' },
    { value: 'collaboration', label: 'Research collaboration' },
    { value: 'custom', label: 'Other (describe below)' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Name" required>
          <input
            type="text"
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            placeholder="Your name"
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            required
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            placeholder="you@university.edu"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Institution">
          <input
            type="text"
            value={form.institution}
            onChange={e => setForm(f => ({ ...f, institution: e.target.value }))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            placeholder="University, institute, or independent"
          />
        </Field>
        <Field label="Role">
          <input
            type="text"
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
            placeholder="PhD student, professor, librarian..."
          />
        </Field>
      </div>

      <Field label="Research area" required>
        <input
          type="text"
          required
          value={form.research_area}
          onChange={e => setForm(f => ({ ...f, research_area: e.target.value }))}
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
          placeholder="e.g., History of alchemy, Renaissance philosophy, digital humanities"
        />
      </Field>

      <Field label="What are you interested in?">
        <div className="flex flex-wrap gap-2">
          {accessOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggleAccess(opt.value)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                form.access_needs.includes(opt.value)
                  ? 'bg-accent-rust text-white border-accent-rust'
                  : 'bg-white text-stone-600 border-stone-300 hover:border-stone-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Tell us about your research" required>
        <textarea
          required
          rows={4}
          value={form.intended_use}
          onChange={e => setForm(f => ({ ...f, intended_use: e.target.value }))}
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust resize-none"
          placeholder="What are you working on? How would Source Library fit into your research?"
        />
      </Field>

      {status === 'error' && (
        <p className="text-sm text-red-600">{message}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="px-6 py-2.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'submitting' ? 'Submitting...' : 'Submit Application'}
      </button>

      <p className="text-xs text-muted">
        The library is free for everyone. This form is for researchers who need API access,
        bulk exports, or want to discuss collaboration. We typically respond within a few days.
      </p>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-1">
        {label}{required && ' *'}
      </label>
      {children}
    </div>
  );
}
