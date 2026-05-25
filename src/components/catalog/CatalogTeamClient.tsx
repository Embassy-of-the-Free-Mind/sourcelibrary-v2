'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Trash2, UserPlus } from 'lucide-react';

interface MembershipRow {
  email: string;
  role: 'superadmin' | 'admin' | 'editor' | 'contributor' | 'reader';
  status: string;
  addedAt: string | null;
  joinedAt: string | null;
  invitedBy: string | null;
  name: string | null;
}

interface Props {
  tenant: string;
  initialRows: MembershipRow[];
  /** True when the current user can invite at editor level (admin+). Editors can
   *  invite contributors only — see /api/[tenant]/catalog/team/invite. */
  canInviteEditor: boolean;
  currentUserEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  editor: 'Editor',
  contributor: 'Contributor',
  reader: 'Reader',
};

export default function CatalogTeamClient({ tenant, initialRows, canInviteEditor, currentUserEmail }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<MembershipRow[]>(initialRows);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'contributor' | 'editor'>('contributor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setInviteError('Enter a valid email address');
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`/api/${tenant}/catalog/team/invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(body.error || `Invite failed (${res.status})`);
        setInviting(false);
        return;
      }
      setInviteSuccess(`Invited ${email} as ${ROLE_LABEL[inviteRole]}. Invitation email queued.`);
      setInviteEmail('');
      // Optimistically prepend the new row; the server refresh will reconcile.
      setRows((prev) => {
        const filtered = prev.filter((r) => r.email.toLowerCase() !== email);
        return [
          {
            email,
            role: inviteRole,
            status: 'pending',
            addedAt: new Date().toISOString(),
            joinedAt: null,
            invitedBy: currentUserEmail,
            name: null,
          },
          ...filtered,
        ];
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setInviteError((err as Error).message || 'Invite failed');
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(email: string, role: 'contributor' | 'editor') {
    setBusyEmail(email);
    try {
      const res = await fetch(`/api/${tenant}/catalog/team/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Role change failed (${res.status})`);
        return;
      }
      setRows((prev) => prev.map((r) => (r.email === email ? { ...r, role } : r)));
      startTransition(() => router.refresh());
    } finally {
      setBusyEmail(null);
    }
  }

  async function remove(email: string) {
    if (!confirm(`Remove ${email} from the catalogue team?`)) return;
    setBusyEmail(email);
    try {
      const res = await fetch(`/api/${tenant}/catalog/team/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Remove failed (${res.status})`);
        return;
      }
      setRows((prev) => prev.filter((r) => r.email !== email));
      startTransition(() => router.refresh());
    } finally {
      setBusyEmail(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Invite */}
      <section className="p-4 bg-white border border-border-light rounded-lg">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-3 flex items-center gap-1.5">
          <UserPlus className="w-3.5 h-3.5" />
          Invite a new member
        </h2>
        <form onSubmit={invite} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[14rem]">
            <label className="block text-xs text-muted mb-1">Email</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="intern@efm.amsterdam"
              className="w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'contributor' | 'editor')}
              className="text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary"
            >
              <option value="contributor">Contributor (proposes edits)</option>
              {canInviteEditor && <option value="editor">Editor (applies edits + reviews)</option>}
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
          >
            <Mail className="w-3.5 h-3.5" />
            {inviting ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
        {inviteError && <p className="text-xs text-accent-rust mt-2">{inviteError}</p>}
        {inviteSuccess && <p className="text-xs text-primary mt-2">{inviteSuccess}</p>}
        <p className="text-[11px] text-muted mt-3 italic">
          {canInviteEditor
            ? 'Contributors propose changes for review. Editors apply changes and review contributor submissions.'
            : 'Contributors propose changes for review. Editor invitations require admin permissions.'}
        </p>
      </section>

      {/* Members list */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
          Current team ({rows.length})
        </h2>
        <ul className="divide-y divide-border-light border border-border-light rounded-lg bg-white">
          {rows.length === 0 && (
            <li className="p-4 text-sm text-muted text-center">No team members yet.</li>
          )}
          {rows.map((r) => {
            const isSelf = r.email.toLowerCase() === currentUserEmail.toLowerCase();
            const isBusy = busyEmail === r.email;
            // Editors can only manage contributors. Admin+ can manage editors.
            // Self is never editable here (avoid lockout).
            const canManage = !isSelf && (canInviteEditor || r.role === 'contributor');
            return (
              <li key={r.email} className="p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-primary">{r.name || r.email}</span>
                    {r.name && <span className="text-xs text-muted">{r.email}</span>}
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      r.role === 'editor' || r.role === 'admin' || r.role === 'superadmin'
                        ? 'bg-accent-rust/15 text-accent-rust'
                        : r.role === 'contributor'
                        ? 'bg-accent-gold/20 text-accent-gold-dark'
                        : 'bg-warm text-muted'
                    }`}>
                      {ROLE_LABEL[r.role] || r.role}
                    </span>
                    {r.status === 'pending' && (
                      <span className="text-[10px] uppercase tracking-wider text-muted px-1.5 py-0.5 rounded bg-warm">
                        invited
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {r.status === 'active'
                      ? `Joined ${formatDate(r.joinedAt || r.addedAt)}`
                      : `Invited ${formatDate(r.addedAt)}${r.invitedBy ? ` by ${r.invitedBy}` : ''}`}
                  </div>
                </div>

                {canManage && (
                  <div className="flex items-center gap-2 shrink-0">
                    {r.role === 'contributor' && canInviteEditor && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => changeRole(r.email, 'editor')}
                        className="text-xs px-2.5 py-1 rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary disabled:opacity-50 transition-colors"
                      >
                        Promote to editor
                      </button>
                    )}
                    {r.role === 'editor' && canInviteEditor && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => changeRole(r.email, 'contributor')}
                        className="text-xs px-2.5 py-1 rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary disabled:opacity-50 transition-colors"
                      >
                        Demote to contributor
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => remove(r.email)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border-light text-muted hover:bg-warm hover:text-accent-rust disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
