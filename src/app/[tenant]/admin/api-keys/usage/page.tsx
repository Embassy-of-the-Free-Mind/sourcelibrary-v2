'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface KeyUsage {
  key_id: string;
  name: string;
  user_id: string;
  tier: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  total_requests: number;
  total_pages: number;
  endpoints: Record<string, { requests: number; pages: number }>;
  daily: Array<{ date: string; requests: number; pages: number }>;
}

interface UsageData {
  days: number;
  since: string;
  totals: {
    total_requests: number;
    total_pages: number;
    active_keys: number;
    total_keys: number;
  };
  keys: KeyUsage[];
}

function Sparkline({ data, width = 200, height = 32 }: { data: number[]; width?: number; height?: number }) {
  if (data.length === 0) return <span style={{ color: '#c8c4be', fontSize: 12 }}>No activity</span>;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = height - (v / max) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke="#9e4a3a"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ApiKeyUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/api-keys/usage?days=${days}`);
      const json = await res.json();
      setData(json);
    } catch {
      console.error('Failed to load usage data');
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">API Usage</h1>
          <p className="text-sm text-stone-500 mt-1">
            <Link href="/admin/api-keys" className="text-stone-500 hover:text-stone-700 underline">
              API Keys
            </Link>
            {' / Usage Dashboard'}
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                days === d
                  ? 'bg-stone-800 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-stone-500">Loading...</p>
      ) : !data ? (
        <p className="text-stone-400">Failed to load usage data</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Requests', value: data.totals.total_requests.toLocaleString() },
              { label: 'Pages Served', value: data.totals.total_pages.toLocaleString() },
              { label: 'Active Keys', value: data.totals.active_keys },
              { label: 'Total Keys', value: data.totals.total_keys },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-stone-200 p-5">
                <div className="text-2xl font-semibold text-stone-900">{card.value}</div>
                <div className="text-sm text-stone-500 mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          {/* Per-key table */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-stone-600">Key</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-600">Tier</th>
                  <th className="text-right px-4 py-3 font-medium text-stone-600">Requests</th>
                  <th className="text-right px-4 py-3 font-medium text-stone-600">Pages</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-600">Activity ({days}d)</th>
                  <th className="text-left px-4 py-3 font-medium text-stone-600">Last Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.keys.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No API keys yet</td></tr>
                ) : data.keys.map(k => {
                  // Sort daily data chronologically for sparkline
                  const sorted = [...k.daily].sort((a, b) => a.date.localeCompare(b.date));
                  const sparkData = sorted.map(d => d.requests);
                  const isExpanded = expandedKey === k.key_id;

                  return (
                    <tr
                      key={k.key_id}
                      className="cursor-pointer hover:bg-stone-50 transition-colors"
                      onClick={() => setExpandedKey(isExpanded ? null : k.key_id)}
                    >
                      <td className="px-4 py-3">
                        <div className="text-stone-900 font-medium">{k.name}</div>
                        <div className="text-xs text-stone-400">{k.user_id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          k.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {k.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-stone-700">
                        {k.total_requests.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-stone-700">
                        {k.total_pages.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Sparkline data={sparkData} />
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-500">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Expanded detail */}
          {expandedKey && (() => {
            const k = data.keys.find(k => k.key_id === expandedKey);
            if (!k) return null;
            const endpoints = Object.entries(k.endpoints);
            const sorted = [...k.daily].sort((a, b) => b.date.localeCompare(a.date));

            return (
              <div className="mt-4 bg-white rounded-xl border border-stone-200 p-6">
                <h3 className="text-lg font-medium text-stone-900 mb-4">{k.name}</h3>
                <div className="grid grid-cols-2 gap-6">
                  {/* Endpoint breakdown */}
                  <div>
                    <h4 className="text-sm font-medium text-stone-600 mb-2">Endpoints</h4>
                    {endpoints.length === 0 ? (
                      <p className="text-stone-400 text-sm">No endpoint data</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-stone-100">
                            <th className="text-left py-1.5 font-medium text-stone-500">Endpoint</th>
                            <th className="text-right py-1.5 font-medium text-stone-500">Requests</th>
                            <th className="text-right py-1.5 font-medium text-stone-500">Pages</th>
                          </tr>
                        </thead>
                        <tbody>
                          {endpoints.map(([ep, stats]) => (
                            <tr key={ep} className="border-b border-stone-50">
                              <td className="py-1.5 font-mono text-xs text-stone-700">{ep}</td>
                              <td className="py-1.5 text-right text-stone-600">{stats.requests.toLocaleString()}</td>
                              <td className="py-1.5 text-right text-stone-600">{stats.pages.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Daily breakdown */}
                  <div>
                    <h4 className="text-sm font-medium text-stone-600 mb-2">Daily Activity</h4>
                    {sorted.length === 0 ? (
                      <p className="text-stone-400 text-sm">No daily data</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-stone-100">
                              <th className="text-left py-1.5 font-medium text-stone-500">Date</th>
                              <th className="text-right py-1.5 font-medium text-stone-500">Requests</th>
                              <th className="text-right py-1.5 font-medium text-stone-500">Pages</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map(d => (
                              <tr key={d.date} className="border-b border-stone-50">
                                <td className="py-1.5 text-stone-700">{d.date}</td>
                                <td className="py-1.5 text-right text-stone-600">{d.requests.toLocaleString()}</td>
                                <td className="py-1.5 text-right text-stone-600">{d.pages.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
