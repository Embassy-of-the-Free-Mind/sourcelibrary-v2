'use client';

import { useState, useEffect } from 'react';

interface Member {
  _id: string;
  name: string | null;
  email: string | null;
  membership: {
    joined?: boolean;
    joinedAt?: string;
    active?: boolean;
    activatedAt?: string;
    plan?: string;
    expiresAt?: string;
    stripeCustomerId?: string;
    profile?: {
      displayName?: string;
      bio?: string;
      visible?: boolean;
    };
  };
  editCount?: number;
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'contributors' | 'free'>('all');
  const [stats, setStats] = useState({ total: 0, contributors: 0, free: 0 });

  useEffect(() => {
    fetch('/api/admin/members')
      .then(r => r.json())
      .then(data => {
        setMembers(data.members || []);
        setStats(data.stats || { total: 0, contributors: 0, free: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = members.filter(m => {
    if (filter === 'contributors') return m.membership?.active;
    if (filter === 'free') return m.membership?.joined && !m.membership?.active;
    return true;
  });

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, color: '#c9d1d9' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>
        Members
      </h1>
      <p style={{ color: '#8b949e', marginBottom: 24, fontSize: 14 }}>
        Ficino Society members and financial contributors
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Members', value: stats.total, color: '#58a6ff' },
          { label: 'Contributors', value: stats.contributors, color: '#3fb950' },
          { label: 'Free Members', value: stats.free, color: '#8b949e' },
        ].map(s => (
          <div key={s.label} style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
            padding: '14px 20px', minWidth: 140,
          }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: s.color }}>
              {loading ? '—' : s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'contributors', 'free'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none',
              background: filter === f ? '#30363d' : 'transparent',
              color: filter === f ? '#f0f6fc' : '#8b949e',
              cursor: 'pointer', fontSize: 13, textTransform: 'capitalize',
            }}
          >
            {f === 'all' ? 'All' : f === 'contributors' ? 'Contributors' : 'Free'}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: '#8b949e', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#8b949e', padding: 40, textAlign: 'center' }}>No members found</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Name</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Email</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Plan</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Joined</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Expires</th>
              <th style={{ padding: '8px 12px', fontWeight: 500 }}>Edits</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const displayName = m.membership?.profile?.displayName || m.name || 'Anonymous';
              const isContributor = m.membership?.active;
              const joined = m.membership?.joinedAt || m.membership?.activatedAt;
              return (
                <tr key={m._id} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '8px 12px' }}>
                    {displayName}
                    {m.membership?.profile?.visible === false && (
                      <span style={{ color: '#8b949e', marginLeft: 6, fontSize: 11 }}>hidden</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#8b949e' }}>{m.email || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11,
                      background: isContributor ? '#0d3117' : '#1c2128',
                      color: isContributor ? '#3fb950' : '#8b949e',
                    }}>
                      {isContributor ? 'Contributor' : 'Free'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#8b949e' }}>
                    {m.membership?.plan || '—'}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#8b949e' }}>
                    {joined ? new Date(joined).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#8b949e' }}>
                    {m.membership?.expiresAt
                      ? new Date(m.membership.expiresAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#8b949e' }}>
                    {m.editCount ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
