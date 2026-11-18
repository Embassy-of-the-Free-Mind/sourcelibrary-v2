'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { SKIP_PATH_PREFIXES, isApexHost } from '@/lib/welcome-gate';

// Same address as READER_REPLY_TO in src/lib/feedback-reply-email.ts, the
// Reply-To of the email copy. Not imported: that module pulls in the Resend SDK.
const READER_REPLY_TO = 'derek@sourcelibrary.org';

// A reply we wrote to this reader (from /admin/introductions), shown on the
// site as well as by email, so it reaches them even when the email went to
// spam (v3#405). Checked once per tab: one request for a signed-in reader's
// visit, never one per page. "Got it" records that they saw it.
const CHECKED_KEY = 'sl_reader_notes_checked';

interface Note { id: string; body: string; sent_at: string | null }

function checkedThisTab(): boolean {
  try { return window.sessionStorage.getItem(CHECKED_KEY) === '1'; } catch { return false; }
}
function markChecked(): void {
  try { window.sessionStorage.setItem(CHECKED_KEY, '1'); } catch { /* non-fatal */ }
}

export default function ReaderNotes() {
  const { status } = useSession();
  const pathname = usePathname();
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (status !== 'authenticated' || !pathname) return;
    if (SKIP_PATH_PREFIXES.some(p => pathname.startsWith(p))) return;
    if (!isApexHost(window.location.hostname) || checkedThisTab()) return;
    markChecked();
    fetch('/api/me/notes')
      .then(r => (r.ok ? r.json() : { notes: [] }))
      .then(d => setNotes(Array.isArray(d.notes) ? d.notes : []))
      .catch(() => { /* a missed note waits for the next visit */ });
  }, [status, pathname]);

  const note = notes[0];
  if (!note) return null;

  const dismiss = () => {
    fetch('/api/me/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: note.id }),
    }).catch(() => {});
    setNotes(n => n.slice(1));
  };

  return (
    <aside
      role="status"
      aria-label="A note from Source Library"
      className="fixed z-50 bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:w-96 bg-white border border-stone-200 rounded-lg shadow-lg p-4"
    >
      <p className="text-xs uppercase tracking-wide text-stone-500 mb-2">
        A note from Source Library
        {note.sent_at && (
          <span className="normal-case tracking-normal">
            {' · '}
            {new Date(note.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </p>
      <p className="font-serif text-[15px] leading-relaxed text-stone-800 whitespace-pre-wrap max-h-64 overflow-y-auto">
        {note.body}
      </p>
      <div className="mt-3 flex items-center justify-end gap-3">
        <a href={`mailto:${READER_REPLY_TO}`} className="text-sm text-accent-rust hover:underline">
          Write back
        </a>
        <button
          onClick={dismiss}
          className="text-sm px-3 py-1.5 rounded bg-stone-900 text-white hover:bg-stone-800"
        >
          Got it
        </button>
      </div>
    </aside>
  );
}
