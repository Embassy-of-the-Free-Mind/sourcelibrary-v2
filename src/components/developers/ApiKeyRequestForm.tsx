'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Copy, Check, Key, Loader2 } from 'lucide-react';

/** Existing keys for the signed-in user */
interface UserKey {
  _id: string;
  key_prefix: string;
  tier: string;
  status: string;
  created_at: string;
  rate_limit: { requests_per_minute: number; pages_per_day: number };
}

export default function ApiKeyRequestForm() {
  const { data: session, status: authStatus } = useSession();
  const isSignedIn = authStatus === 'authenticated' && !!session?.user;

  // Self-serve state (signed-in users)
  const [existingKeys, setExistingKeys] = useState<UserKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [error, setError] = useState('');

  // Request form state (anonymous users)
  const [form, setForm] = useState({
    name: '',
    email: '',
    organization: '',
    use_case: '',
  });
  const [formStatus, setFormStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [formMessage, setFormMessage] = useState('');

  // Load existing keys for signed-in users
  useEffect(() => {
    if (!isSignedIn) return;
    setLoadingKeys(true);
    fetch('/api/dataset/v1/keys')
      .then(r => r.json())
      .then(data => setExistingKeys((data.keys || []).filter((k: UserKey) => k.status === 'active')))
      .catch(() => {})
      .finally(() => setLoadingKeys(false));
  }, [isSignedIn]);

  // Generate a new explorer key
  async function handleGenerate() {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/dataset/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName || 'API Key' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to generate key');
        return;
      }
      setNewKey(data.key);
      // Refresh the key list
      const keysRes = await fetch('/api/dataset/v1/keys');
      const keysData = await keysRes.json();
      setExistingKeys((keysData.keys || []).filter((k: UserKey) => k.status === 'active'));
    } catch {
      setError('Network error — please try again');
    } finally {
      setGenerating(false);
    }
  }

  function copyKey() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Anonymous request form submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormStatus('submitting');

    try {
      const res = await fetch('/api/dataset/v1/request-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setFormStatus('error');
        setFormMessage(data.error || 'Something went wrong');
        return;
      }

      setFormStatus('success');
      setFormMessage(data.message);
    } catch {
      setFormStatus('error');
      setFormMessage('Network error — please try again');
    }
  }

  // Loading auth state
  if (authStatus === 'loading') {
    return <div className="py-4 text-sm text-muted">Loading...</div>;
  }

  // ── Signed-in: self-serve explorer keys ──
  if (isSignedIn) {
    return (
      <div className="space-y-6">
        {/* Show new key (only visible once) */}
        {newKey && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <h3 className="text-base font-semibold text-green-800 mb-2">Your API key</h3>
            <p className="text-sm text-green-700 mb-3">Copy this now — it won&apos;t be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-white border border-green-300 rounded-lg text-sm font-mono text-stone-800 break-all">
                {newKey}
              </code>
              <button
                onClick={copyKey}
                className="shrink-0 p-2 rounded-lg hover:bg-green-100 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-green-700" />}
              </button>
            </div>
            <p className="text-xs text-green-600 mt-3">
              Explorer tier: 10 requests/min, 100 pages/day. Use header <code className="text-green-700">Authorization: Bearer YOUR_KEY</code>
            </p>
          </div>
        )}

        {/* Existing keys */}
        {loadingKeys ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your keys...
          </div>
        ) : existingKeys.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium text-stone-700 mb-2">Your keys</h3>
            <div className="space-y-2">
              {existingKeys.map(k => (
                <div key={k._id} className="flex items-center justify-between px-3 py-2 bg-stone-50 rounded-lg text-sm">
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-stone-400" />
                    <code className="font-mono text-stone-600">{k.key_prefix}</code>
                    <span className="text-xs text-muted capitalize">{k.tier}</span>
                  </div>
                  <span className="text-xs text-muted">{k.rate_limit.requests_per_minute} req/min</span>
                </div>
              ))}
            </div>
          </div>
        ) : !newKey ? (
          <p className="text-sm text-muted">You don&apos;t have any API keys yet.</p>
        ) : null}

        {/* Generate new key */}
        {!newKey && (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="key-name" className="block text-sm font-medium text-stone-700 mb-1">Key name</label>
              <input
                id="key-name"
                type="text"
                value={keyName}
                onChange={e => setKeyName(e.target.value)}
                placeholder="e.g. my-research-project"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-stone-900 focus:outline-none focus:ring-2 focus:ring-accent-rust/30 focus:border-accent-rust"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="shrink-0 px-5 py-2 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating...' : 'Generate API Key'}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <p className="text-xs text-muted">
          Explorer tier (free): 10 req/min, 100 pages/day.{' '}
          Need more? <Link href="/support" className="text-accent-rust hover:underline">Contact us</Link> for bulk access.
        </p>
      </div>
    );
  }

  // ── Anonymous: request form (requires admin review) ──
  if (formStatus === 'success') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-green-800 mb-2">Request received</h3>
        <p className="text-green-700">{formMessage}</p>
        <p className="text-sm text-green-600 mt-3">
          Want instant access? <Link href="/auth/signin" className="font-medium underline">Sign in</Link> to generate an Explorer key immediately.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-secondary mb-4">
        <Link href="/auth/signin" className="text-accent-rust font-medium hover:underline">Sign in</Link> to generate an API key instantly, or fill out the form below for review.
      </p>
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

        {formStatus === 'error' && (
          <p className="text-sm text-red-600">{formMessage}</p>
        )}

        <button
          type="submit"
          disabled={formStatus === 'submitting'}
          className="px-5 py-2.5 bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {formStatus === 'submitting' ? 'Submitting...' : 'Request API Key'}
        </button>
      </form>
    </div>
  );
}
