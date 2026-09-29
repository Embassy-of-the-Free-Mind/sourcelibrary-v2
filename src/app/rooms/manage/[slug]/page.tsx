'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Copy, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import SiteHeader from '@/components/layout/SiteHeader';
import RoomForm from '@/components/rooms/RoomForm';
import { rooms, type RoomSummary, type RoomWrite } from '@/lib/api-client/rooms';

// Manage one reading room (#5266): the embed snippet, then the same form as
// creation. Owner only — anyone else sees "not found", never a 403 that
// confirms the room exists.

function errorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error || (err as Error)?.message || 'Something went wrong';
}

const SITE = 'https://sourcelibrary.org';

export default function ManageRoomPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const justCreated = search.get('new') === '1';

  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async (slug: string) => {
    try {
      const { room } = await rooms.get(slug);
      if (!room.is_owner) { setMissing(true); return; }
      setRoom(room);
    } catch {
      setMissing(true);
    }
  }, []);

  useEffect(() => { if (params.slug) load(params.slug); }, [params.slug, load]);

  async function save(body: RoomWrite) {
    if (!room) return;
    setSaving(true);
    setError(null);
    try {
      const { room: updated } = await rooms.update(room.slug, body);
      setRoom(updated);
      toast.success('Saved');
      if (updated.slug !== room.slug) router.replace(`/rooms/manage/${updated.slug}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!room) return;
    try {
      await rooms.remove(room.slug);
      toast.success('Room deleted');
      router.push('/rooms');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const roomUrl = room ? `${SITE}/rooms/${room.slug}` : '';
  const snippet = room
    ? `<iframe src="${roomUrl}" title="${room.name.replace(/"/g, '&quot;')}" style="width:100%;height:90vh;border:0" loading="lazy" allow="fullscreen"></iframe>`
    : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        <Link href="/rooms" className="inline-flex items-center gap-1 text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All rooms
        </Link>

        {missing ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No such room, or it is not yours.</p>
        ) : !room ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
        ) : (
          <>
            <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-1" style={{ color: 'var(--text-primary)' }}>{room.name}</h1>
            <p className="text-sm mb-8">
              <a href={roomUrl} className="underline underline-offset-2" style={{ color: 'var(--accent-rust)' }}>{roomUrl.replace(/^https:\/\//, '')}</a>
            </p>

            <section className="mb-12 p-6 bg-white" style={{ border: '1px solid var(--border-light)' }}>
              <h2 className="font-serif text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
                {justCreated ? 'Your room is live. Put it on your site.' : 'Put it on your site'}
              </h2>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                Paste this where the room should appear. It works on WordPress, Ghost, Squarespace, Webflow and any page you can add HTML to.
                {room.allowed_origins && room.allowed_origins.length === 0 ? (
                  <> Add your site&apos;s hostname under <em>Your website</em> below first, or the browser will refuse to show it.</>
                ) : null}
              </p>
              <pre className="text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all" style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}>{snippet}</pre>
              <button type="button" onClick={copy}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent-rust)', color: '#fff' }}>
                {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <p className="text-xs mt-4" style={{ color: 'var(--text-faint)' }}>
                Or link to the room directly; it already carries your name and colour. Substack and Medium do not allow frames, so link there.
              </p>
            </section>

            <div className="p-6 bg-white" style={{ border: '1px solid var(--border-light)' }}>
              <RoomForm initial={room} submitLabel="Save changes" saving={saving} error={error} onSubmit={save} />
            </div>

            <div className="mt-12 pt-6" style={{ borderTop: '1px solid var(--border-light)' }}>
              {confirmDelete ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span style={{ color: 'var(--text-secondary)' }}>Delete this room? The books are untouched; only the room and its URL go away.</span>
                  <button type="button" onClick={remove} className="px-3 py-1.5 rounded-lg font-medium" style={{ background: 'var(--status-error)', color: '#fff' }}>Delete</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>Keep it</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete room
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
