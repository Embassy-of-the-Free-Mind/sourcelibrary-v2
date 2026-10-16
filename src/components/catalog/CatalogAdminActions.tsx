'use client';

import { useState } from 'react';

/**
 * Catalogue-admin panel on a record: correct the UBN, delete, restore.
 *
 * Rendered only for catalogue admins (isCatalogAdmin — José and Paul for the
 * BPH, #6799/#6800). The server route re-checks; hiding the panel is a
 * courtesy, not the gate.
 *
 * Deleting asks first, as José asked: the confirmation names the record by
 * UBN and title and needs a reason, which goes into the record's history.
 */

const BUTTON =
  'px-3 py-1.5 text-sm rounded-md border border-border-light text-secondary hover:bg-warm hover:text-primary transition-colors disabled:opacity-50';
const DANGER =
  'px-3 py-1.5 text-sm rounded-md bg-accent-rust text-white hover:bg-accent-rust/90 transition-colors disabled:opacity-50';
const INPUT =
  'w-full text-sm border border-border-light rounded-md px-3 py-2 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-accent-rust/30';

interface Props {
  tenant: string;
  /** The key the record is addressed by right now (UBN, else uuid). */
  recordKey: string;
  ubn: string | null;
  title: string;
  deleted: { at: string; by: string | null; reason: string | null } | null;
}

export default function CatalogAdminActions({ tenant, recordKey, ubn, title, deleted }: Props) {
  const [mode, setMode] = useState<'idle' | 'ubn' | 'delete'>('idle');
  const [newUbn, setNewUbn] = useState(ubn ?? '');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, string>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${tenant}/catalog/${encodeURIComponent(recordKey)}/admin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : `Failed (${res.status})`);
        return null;
      }
      return data;
    } catch {
      setError('Network error. Please try again');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitUbn() {
    const data = await call({ action: 'change_ubn', newUbn: newUbn.trim(), note: note.trim() });
    if (data && typeof data.ubn === 'string') window.location.href = `/catalog/${encodeURIComponent(data.ubn)}`;
  }

  async function submitDelete() {
    const data = await call({ action: 'delete', reason: reason.trim() });
    if (data) window.location.reload();
  }

  async function submitRestore() {
    const data = await call({ action: 'restore' });
    if (data) window.location.reload();
  }

  const label = `${ubn ? `UBN ${ubn}` : 'this record'}: “${title}”`;

  if (deleted) {
    return (
      <section className="mb-6 p-4 rounded-lg border border-accent-rust/40 bg-accent-rust/5">
        <h2 className="text-sm font-medium text-primary mb-1">This record is deleted</h2>
        <p className="text-sm text-secondary mb-3">
          Deleted {new Date(deleted.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          {deleted.by ? ` by ${deleted.by}` : ''}.{deleted.reason ? ` Reason: ${deleted.reason}` : ''} It is hidden
          from search, export and counts. Only catalogue administrators can see it.
        </p>
        <button type="button" className={BUTTON} disabled={busy} onClick={submitRestore}>
          {busy ? 'Restoring…' : 'Restore this record'}
        </button>
        {error && <p className="text-sm text-accent-rust mt-2">{error}</p>}
      </section>
    );
  }

  return (
    <section className="mb-6 p-4 rounded-lg border border-border-light bg-white">
      <h2 className="text-xs uppercase tracking-wider text-muted font-medium mb-3">
        Catalogue administration
      </h2>

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={() => { setMode('ubn'); setError(null); }}>
            {ubn ? 'Correct the UBN' : 'Assign a UBN'}
          </button>
          <button type="button" className={BUTTON} onClick={() => { setMode('delete'); setError(null); }}>
            Delete this record
          </button>
        </div>
      )}

      {mode === 'ubn' && (
        <div className="space-y-3">
          <label className="block text-sm text-secondary">
            New UBN
            <input className={`${INPUT} font-mono mt-1`} value={newUbn} onChange={(e) => setNewUbn(e.target.value)} />
          </label>
          <label className="block text-sm text-secondary">
            Note for the history (optional)
            <input className={`${INPUT} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="text-xs text-muted">
            The old number stays on the record, and links to it go to the new one.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={DANGER}
              disabled={busy || !newUbn.trim() || newUbn.trim() === ubn}
              onClick={submitUbn}
            >
              {busy ? 'Saving…' : 'Change UBN'}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'delete' && (
        <div className="space-y-3">
          <p className="text-sm text-primary">
            Are you sure you want to delete {label}?
          </p>
          <p className="text-xs text-muted">
            The record disappears from search, export and counts. Nothing is erased: a catalogue
            administrator can restore it from this page.
          </p>
          <label className="block text-sm text-secondary">
            Reason (required, saved in the history)
            <textarea className={`${INPUT} mt-1`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={DANGER} disabled={busy || !reason.trim()} onClick={submitDelete}>
              {busy ? 'Deleting…' : 'Yes, delete this record'}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-accent-rust mt-2">{error}</p>}
    </section>
  );
}
