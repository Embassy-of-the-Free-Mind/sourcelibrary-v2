'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { RecordStatus } from '@/lib/types/status';

interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: RecordStatus;
  createdAt: string;
  settings: { publicBrowsing: boolean; allowSignup: boolean };
  pipeline: { geminiQuota: number };
}

interface PlatformMember {
  _id: string;
  email: string;
  role: string;
  status: RecordStatus;
  addedAt: string;
}

// ─── InviteModal ──────────────────────────────────────────────────────────────

interface InviteModalProps {
  title: string;
  description: string;
  showRoleSelector?: boolean;
  defaultRole?: string;
  onSubmit: (email: string, role: string) => Promise<string | null>;
  onClose: () => void;
}

function InviteModal({ title, description, showRoleSelector = true, defaultRole = 'admin', onSubmit, onClose }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(defaultRole);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const error = await onSubmit(email, role);
    if (error) {
      setMessage({ text: error, ok: false });
      setLoading(false);
    } else {
      setMessage({ text: 'Invite sent', ok: true });
      setTimeout(onClose, 1200);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={modalTitleStyle}>{title}</h2>
        <p style={modalSubtitleStyle}>{description}</p>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Email</label>
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com" style={{ ...inputStyle, marginBottom: 12 }} />
          {showRoleSelector && (
            <>
              <label style={labelStyle}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                style={{ ...inputStyle, marginBottom: 20 }}>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="reader">Reader</option>
              </select>
            </>
          )}
          {message && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13,
              background: message.ok ? '#1a3a2a' : '#3d1a1a', color: message.ok ? '#3fb950' : '#f87171' }}>
              {message.text}
            </div>
          )}
          <div style={modalFooterStyle}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={loading || !email}
              style={{ ...primaryBtnStyle, opacity: loading || !email ? 0.5 : 1 }}>
              {loading ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── EditTenantModal ──────────────────────────────────────────────────────────

interface EditTenantModalProps {
  tenant: Tenant;
  onSuccess: () => void;
  onClose: () => void;
}

function EditTenantModal({ tenant, onSuccess, onClose }: EditTenantModalProps) {
  const [name, setName] = useState(tenant.name);
  const [status, setStatus] = useState<'active' | 'suspended'>(tenant.status === 'suspended' ? 'suspended' : 'active');
  const [publicBrowsing, setPublicBrowsing] = useState(tenant.settings?.publicBrowsing ?? true);
  const [allowSignup, setAllowSignup] = useState(tenant.settings?.allowSignup ?? false);
  const [geminiQuota, setGeminiQuota] = useState(tenant.pipeline?.geminiQuota ?? 50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/platform/tenants/${tenant.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, status, settings: { publicBrowsing, allowSignup }, pipeline: { geminiQuota } }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error || 'Failed to update'); return; }
    onSuccess();
    onClose();
  };

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 460 }}>
        <h2 style={modalTitleStyle}>Edit Library</h2>
        <p style={modalSubtitleStyle}>
          <span style={{ fontFamily: 'monospace', color: '#58a6ff' }}>{tenant.slug}</span>
        </p>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Name</label>
          <input type="text" required value={name} onChange={e => setName(e.target.value)}
            style={{ ...inputStyle, marginBottom: 16 }} />

          <label style={labelStyle}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as 'active' | 'suspended')}
            style={{ ...inputStyle, marginBottom: 20 }}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>

          <div style={{ borderTop: '1px solid #21262d', paddingTop: 16, marginBottom: 16 }}>
            <p style={sectionLabelStyle}>Settings</p>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={publicBrowsing}
                onChange={e => setPublicBrowsing(e.target.checked)} style={{ marginRight: 8 }} />
              <span style={{ fontSize: 13, color: '#e6edf3' }}>Public browsing</span>
              <span style={{ fontSize: 12, color: '#8b949e', marginLeft: 8 }}>Anyone can view without signing in</span>
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={allowSignup}
                onChange={e => setAllowSignup(e.target.checked)} style={{ marginRight: 8 }} />
              <span style={{ fontSize: 13, color: '#e6edf3' }}>Allow open signup</span>
              <span style={{ fontSize: 12, color: '#8b949e', marginLeft: 8 }}>New users auto-join as members</span>
            </label>
          </div>

          <div style={{ borderTop: '1px solid #21262d', paddingTop: 16, marginBottom: 20 }}>
            <p style={sectionLabelStyle}>Pipeline</p>
            <label style={labelStyle}>Max concurrent Gemini jobs</label>
            <input type="number" min={1} max={500} value={geminiQuota}
              onChange={e => setGeminiQuota(Number(e.target.value))}
              style={{ ...inputStyle, width: 100 }} />
          </div>

          {error && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13, background: '#3d1a1a', color: '#f87171' }}>{error}</div>}
          <div style={modalFooterStyle}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={loading || !name.trim()}
              style={{ ...primaryBtnStyle, opacity: loading || !name.trim() ? 0.5 : 1 }}>
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel: string;
  requiredWord?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function ConfirmModal({ title, message, confirmLabel, requiredWord, onConfirm, onClose }: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');

  const canConfirm = !requiredWord || inputValue === requiredWord;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 380 }}>
        <h2 style={{ ...modalTitleStyle, fontSize: 15 }}>{title}</h2>
        <p style={{ ...modalSubtitleStyle, lineHeight: 1.6, marginBottom: 16 }}>{message}</p>
        {requiredWord && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>
              Type <span style={{ fontFamily: 'monospace', color: '#f87171' }}>{requiredWord}</span> to confirm
            </label>
            <input
              type="text" value={inputValue} onChange={e => setInputValue(e.target.value)}
              placeholder={requiredWord} autoFocus
              style={{ ...inputStyle, borderColor: inputValue && inputValue !== requiredWord ? '#6e2020' : '#30363d' }}
            />
          </div>
        )}
        {error && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13, background: '#3d1a1a', color: '#f87171' }}>{error}</div>}
        <div style={modalFooterStyle}>
          <button onClick={onClose} disabled={loading} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleConfirm} disabled={loading || !canConfirm}
            style={{ ...dangerSolidBtnStyle, opacity: loading || !canConfirm ? 0.4 : 1, cursor: !canConfirm ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #21262d', borderRadius: 8,
      padding: '16px 20px', minWidth: 110, flex: '1 1 0',
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#f0f6fc', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function PlatformDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [members, setMembers] = useState<PlatformMember[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [error, setError] = useState('');

  const [inviteTarget, setInviteTarget] = useState<'platform' | string | null>(null);
  const [editTarget, setEditTarget] = useState<Tenant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<PlatformMember | null>(null);

  const loadTenants = useCallback(() => {
    fetch('/api/platform/tenants')
      .then(r => r.json())
      .then(data => { if (data.error) setError(data.error); else setTenants(data.tenants || []); })
      .catch(() => setError('Failed to load libraries'))
      .finally(() => setLoadingTenants(false));
  }, []);

  const loadMembers = useCallback(() => {
    fetch('/api/platform/invites')
      .then(r => r.json())
      .then(data => setMembers(data.members || []))
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, []);

  useEffect(() => { loadTenants(); loadMembers(); }, [loadTenants, loadMembers]);

  const handleTenantInvite = async (email: string, role: string): Promise<string | null> => {
    const res = await fetch(`/api/platform/tenants/${inviteTarget}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    return res.ok ? null : (data.error || 'Failed to send invite');
  };

  const handlePlatformInvite = async (email: string): Promise<string | null> => {
    const res = await fetch('/api/platform/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) { loadMembers(); return null; }
    return data.error || 'Failed to send invite';
  };

  const handleDeleteTenant = async () => {
    const target = deleteTarget;
    if (!target) return;
    const res = await fetch(`/api/platform/tenants/${target.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted', confirmationWord: 'delete' }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete library');
    }
    loadTenants();
    setDeleteTarget(null);
  };

  const handleRemoveMember = async () => {
    const target = removeMemberTarget;
    if (!target) return;
    const res = await fetch(`/api/platform/invites/${target._id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove member');
    }
    loadMembers();
    setRemoveMemberTarget(null);
  };

  // Stats
  const activeTenants = tenants.filter(t => t.status === 'active').length;
  const suspendedTenants = tenants.filter(t => t.status === 'suspended').length;
  const deletedTenants = tenants.filter(t => t.status === 'deleted').length;
  const activeMembers = members.filter(m => m.status === 'active').length;
  const pendingMembers = members.filter(m => m.status === 'pending').length;

  return (
    <div style={{ maxWidth: 960, paddingBottom: 64 }}>

      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f0f6fc', margin: '0 0 4px' }}>Platform Overview</h1>
        <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>Manage libraries, members, and platform settings.</p>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 6, background: '#3d1a1a', color: '#f87171', fontSize: 13, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      {!loadingTenants && !loadingMembers && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 36, flexWrap: 'wrap' }}>
          <StatCard label="Total libraries" value={tenants.length} />
          <StatCard label="Active" value={activeTenants} color="#3fb950" />
          {suspendedTenants > 0 && <StatCard label="Suspended" value={suspendedTenants} color="#f87171" />}
          {deletedTenants > 0 && <StatCard label="Deleted" value={deletedTenants} color="#484f58" />}
          <div style={{ width: 1, background: '#21262d', alignSelf: 'stretch', margin: '0 4px' }} />
          <StatCard label="Platform members" value={activeMembers} />
          {pendingMembers > 0 && <StatCard label="Pending invites" value={pendingMembers} color="#d29922" />}
        </div>
      )}

      {/* ── Libraries ── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#f0f6fc', margin: '0 0 2px' }}>Libraries</h2>
            <p style={{ fontSize: 12, color: '#8b949e', margin: 0 }}>Each library is an independent tenant with its own content and members.</p>
          </div>
          <Link href="/platform/tenants/new" style={primaryLinkBtnStyle}>+ New Library</Link>
        </div>

        {loadingTenants
          ? <div style={loadingStyle}>Loading…</div>
          : tenants.length === 0
            ? (
              <div style={emptyStateStyle}>
                <p style={{ fontSize: 14, color: '#8b949e', marginBottom: 12 }}>No libraries yet.</p>
                <Link href="/platform/tenants/new" style={{ color: '#58a6ff', fontSize: 13 }}>
                  Create your first library →
                </Link>
              </div>
            )
            : (
              <table style={tableStyle}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262d' }}>
                    {['Name', 'Slug', 'Status', 'Created', ''].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenants.map(t => (
                    <tr key={t.id} style={trStyle}>
                      <td style={{ ...tdStyle, fontWeight: 500, color: '#e6edf3' }}>{t.name}</td>
                      <td style={{ ...tdStyle, color: '#58a6ff', fontFamily: 'monospace', fontSize: 12 }}>{t.slug}</td>
                      <td style={tdStyle}><StatusBadge status={t.status} /></td>
                      <td style={{ ...tdStyle, color: '#8b949e' }}>{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        {t.status !== 'deleted' && (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button onClick={() => setEditTarget(t)} style={ghostBtnStyle}>Edit</button>
                            <button onClick={() => setInviteTarget(t.slug)} style={ghostBtnStyle}>Invite Admin</button>
                            <button onClick={() => setDeleteTarget(t)} style={dangerBtnStyle}>Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        }
      </section>

      {/* ── Platform Members ── */}
      <section style={{ ...cardStyle, marginTop: 24 }}>
        <div style={cardHeaderStyle}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#f0f6fc', margin: '0 0 2px' }}>Platform Members</h2>
            <p style={{ fontSize: 12, color: '#8b949e', margin: 0 }}>People with superadmin access to this dashboard.</p>
          </div>
          <button onClick={() => setInviteTarget('platform')} style={ghostBtnStyle}>+ Invite</button>
        </div>

        {loadingMembers
          ? <div style={loadingStyle}>Loading…</div>
          : members.length === 0
            ? <div style={emptyStateStyle}><p style={{ color: '#8b949e', fontSize: 13 }}>No members yet.</p></div>
            : (
              <table style={tableStyle}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262d' }}>
                    {['Email', 'Role', 'Status', 'Added', ''].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const activeSuperadminCount = members.filter(m => m.status === 'active' && m.role === 'superadmin').length;
                    return members.map(m => {
                      const isLastActiveSuperadmin = m.status === 'active' && m.role === 'superadmin' && activeSuperadminCount <= 1;
                      return (
                        <tr key={m._id} style={trStyle}>
                          <td style={{ ...tdStyle, color: '#e6edf3' }}>{m.email}</td>
                          <td style={{ ...tdStyle, color: '#8b949e', textTransform: 'capitalize' }}>{m.role}</td>
                          <td style={tdStyle}><StatusBadge status={m.status} /></td>
                          <td style={{ ...tdStyle, color: '#8b949e' }}>{new Date(m.addedAt).toLocaleDateString()}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {m.status !== 'deleted' && (
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                                {m.status === 'pending' && (
                                  <button onClick={() => handlePlatformInvite(m.email)} style={ghostBtnStyle}>Resend</button>
                                )}
                                <button
                                  onClick={() => !isLastActiveSuperadmin && setRemoveMemberTarget(m)}
                                  disabled={isLastActiveSuperadmin}
                                  title={isLastActiveSuperadmin ? 'Cannot remove the last active superadmin' : undefined}
                                  style={{ ...dangerBtnStyle, opacity: isLastActiveSuperadmin ? 0.35 : 1, cursor: isLastActiveSuperadmin ? 'not-allowed' : 'pointer' }}
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            )
        }
      </section>

      {/* ── Modals ── */}
      {inviteTarget === 'platform' && (
        <InviteModal
          title="Invite Platform Admin"
          description="They'll receive an email with a sign-in link to /platform/login."
          showRoleSelector={false}
          onSubmit={(email) => handlePlatformInvite(email)}
          onClose={() => setInviteTarget(null)}
        />
      )}
      {inviteTarget && inviteTarget !== 'platform' && (
        <InviteModal
          title={`Invite to ${inviteTarget}`}
          description="An invitation email will be sent with a sign-in link."
          showRoleSelector
          onSubmit={handleTenantInvite}
          onClose={() => setInviteTarget(null)}
        />
      )}
      {editTarget && (
        <EditTenantModal tenant={editTarget} onSuccess={loadTenants} onClose={() => setEditTarget(null)} />
      )}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Library"
          message={`Are you sure you want to delete "${deleteTarget.name}"? The library will be marked as deleted. This can be reversed from the database.`}
          confirmLabel="Delete Library"
          requiredWord="delete"
          onConfirm={handleDeleteTenant}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {removeMemberTarget && (
        <ConfirmModal
          title="Remove Member"
          message={`Remove ${removeMemberTarget.email} from the platform? They will lose access to this dashboard.`}
          confirmLabel="Remove Member"
          requiredWord="delete"
          onConfirm={handleRemoveMember}
          onClose={() => setRemoveMemberTarget(null)}
        />
      )}
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RecordStatus }) {
  const map: Record<RecordStatus, { bg: string; color: string }> = {
    active:    { bg: '#1a3a2a', color: '#3fb950' },
    pending:   { bg: '#1a2a3a', color: '#58a6ff' },
    suspended: { bg: '#3d2a0a', color: '#d29922' },
    deleted:   { bg: '#1a1a1a', color: '#484f58' },
  };
  const s = map[status] ?? map.deleted;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500, background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};

const modalStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
  padding: '28px 32px', width: '100%', maxWidth: 400, margin: '0 16px',
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, color: '#f0f6fc', margin: '0 0 4px',
};

const modalSubtitleStyle: React.CSSProperties = {
  fontSize: 13, color: '#8b949e', margin: '0 0 20px',
};

const modalFooterStyle: React.CSSProperties = {
  display: 'flex', gap: 8, justifyContent: 'flex-end',
};

const cardStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #21262d', borderRadius: 10, overflow: 'hidden',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '18px 20px', borderBottom: '1px solid #21262d',
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: '10px 16px', textAlign: 'left', color: '#8b949e',
  fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
};

const trStyle: React.CSSProperties = {
  borderBottom: '1px solid #21262d',
};

const tdStyle: React.CSSProperties = {
  padding: '13px 16px', verticalAlign: 'middle',
};

const loadingStyle: React.CSSProperties = {
  padding: '32px 20px', color: '#8b949e', fontSize: 13,
};

const emptyStateStyle: React.CSSProperties = {
  padding: '40px 20px', textAlign: 'center',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11, color: '#8b949e', margin: '0 0 12px',
  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
};

const primaryLinkBtnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 6, background: '#238636', color: '#ffffff',
  textDecoration: 'none', fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 6, background: 'transparent',
  color: '#8b949e', border: '1px solid #30363d', fontSize: 12, cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const dangerBtnStyle: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 6, background: 'transparent',
  color: '#f87171', border: '1px solid #6e2020', fontSize: 12, cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const dangerSolidBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, background: '#b91c1c',
  color: '#ffffff', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 4,
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', marginBottom: 10, cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 6,
  background: '#0d1117', color: '#e6edf3', border: '1px solid #30363d',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, background: 'transparent',
  color: '#8b949e', border: '1px solid #30363d', fontSize: 13, cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, background: '#238636',
  color: '#ffffff', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
