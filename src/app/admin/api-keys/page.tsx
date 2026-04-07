'use client';

import { useState, useEffect, useCallback } from 'react';

interface KeyRequest {
  _id: string;
  name: string;
  email: string;
  organization: string | null;
  use_case: string;
  requested_tier: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  approved_tier?: string;
  api_key_prefix?: string;
  notes: string | null;
}

interface ApiKey {
  _id: string;
  key_prefix: string;
  user_id: string;
  name: string;
  tier: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
}

export default function ApiKeysAdminPage() {
  const [requests, setRequests] = useState<KeyRequest[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [tab, setTab] = useState<'pending' | 'reviewed' | 'keys'>('pending');
  const [loading, setLoading] = useState(true);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'keys') {
        const res = await fetch('/api/admin/api-keys');
        const data = await res.json();
        setKeys(data.keys || []);
      } else {
        const status = tab === 'pending' ? 'pending' : 'approved';
        const res = await fetch(`/api/admin/api-key-requests?status=${status}`);
        const data = await res.json();
        setRequests(data.requests || []);
        // Also fetch denied for the reviewed tab
        if (tab === 'reviewed') {
          const res2 = await fetch('/api/admin/api-key-requests?status=denied');
          const data2 = await res2.json();
          setRequests(prev => [...prev, ...(data2.requests || [])].sort(
            (a, b) => new Date(b.reviewed_at || b.created_at).getTime() - new Date(a.reviewed_at || a.created_at).getTime()
          ));
        }
      }
    } catch {
      setActionResult({ type: 'error', message: 'Failed to fetch data' });
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAction(requestId: string, action: 'approve' | 'deny') {
    setActionResult(null);
    try {
      const res = await fetch('/api/admin/api-key-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action }),
      });
      const data = await res.json();

      if (!res.ok) {
        setActionResult({ type: 'error', message: data.error });
        return;
      }

      if (action === 'approve' && data.key) {
        setActionResult({
          type: 'success',
          message: `Key minted for ${data.email}: ${data.key}`,
        });
      } else {
        setActionResult({ type: 'success', message: `Request ${action}d.` });
      }

      fetchData();
    } catch {
      setActionResult({ type: 'error', message: 'Network error' });
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm('Revoke this key?')) return;
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: keyId }),
      });
      if (res.ok) {
        setActionResult({ type: 'success', message: 'Key revoked.' });
        fetchData();
      }
    } catch {
      setActionResult({ type: 'error', message: 'Failed to revoke' });
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-stone-900 mb-6">API Keys</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-stone-200">
        {(['pending', 'reviewed', 'keys'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-stone-800 text-stone-900'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {t === 'pending' ? 'Pending Requests' : t === 'reviewed' ? 'Reviewed' : 'Active Keys'}
          </button>
        ))}
      </div>

      {/* Action result banner */}
      {actionResult && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            actionResult.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {actionResult.type === 'success' && actionResult.message.includes('sl_data_') ? (
            <div>
              <p className="font-medium mb-1">Key minted — copy it now (shown once):</p>
              <code className="block bg-green-100 p-2 rounded text-xs break-all select-all">
                {actionResult.message.split(': ').slice(1).join(': ')}
              </code>
            </div>
          ) : (
            actionResult.message
          )}
        </div>
      )}

      {loading ? (
        <p className="text-stone-500">Loading...</p>
      ) : tab === 'keys' ? (
        /* Active keys table */
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">User</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Tier</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-stone-600">Last Used</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {keys.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No keys yet</td></tr>
              ) : keys.map(k => (
                <tr key={k._id}>
                  <td className="px-4 py-3 text-stone-900">{k.name}</td>
                  <td className="px-4 py-3 text-stone-600 font-mono text-xs">{k.user_id}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-stone-100 text-stone-700 text-xs rounded">{k.tier}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      k.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>{k.status}</span>
                  </td>
                  <td className="px-4 py-3 text-stone-500 text-xs">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    {k.status === 'active' && (
                      <button
                        onClick={() => handleRevoke(k._id)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Requests */
        <div className="space-y-4">
          {requests.length === 0 ? (
            <p className="text-stone-400 py-8 text-center">No {tab} requests</p>
          ) : requests.map(r => (
            <div key={r._id} className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-stone-900">{r.name}</span>
                    {r.organization && (
                      <span className="text-stone-500">— {r.organization}</span>
                    )}
                    <span className={`px-2 py-0.5 text-xs rounded ${
                      r.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                        : r.status === 'approved' ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>{r.status}</span>
                  </div>
                  <p className="text-sm text-stone-600 mb-2">{r.email}</p>
                  <p className="text-sm text-stone-700">{r.use_case}</p>
                  <p className="text-xs text-stone-400 mt-2">
                    Requested: {new Date(r.created_at).toLocaleDateString()} · Tier: {r.requested_tier}
                    {r.reviewed_at && ` · Reviewed: ${new Date(r.reviewed_at).toLocaleDateString()} by ${r.reviewed_by}`}
                    {r.api_key_prefix && ` · Key: ${r.api_key_prefix}`}
                  </p>
                </div>
                {r.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleAction(r._id, 'approve')}
                      className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(r._id, 'deny')}
                      className="px-3 py-1.5 bg-stone-200 text-stone-700 text-sm rounded-lg hover:bg-stone-300 transition-colors"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
