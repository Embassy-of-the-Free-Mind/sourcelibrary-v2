'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DoorOpen, Loader2, Plus } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import RoomForm from '@/components/rooms/RoomForm';
import { rooms, type RoomSummary, type RoomWrite } from '@/lib/api-client/rooms';
import { useIdentity } from '@/hooks/useIdentity';

// Your reading rooms (#5266): white-label shelves of books, with the reader,
// that live at sourcelibrary.org/rooms/<name> and can sit inside a page on
// your own website. Signed-in only.

function errorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error || (err as Error)?.message || 'Something went wrong';
}

export default function RoomsPage() {
  const identity = useIdentity();
  const router = useRouter();
  const signedIn = identity.type === 'authenticated';
  const [mine, setMine] = useState<RoomSummary[] | null>(null);
  const [max, setMax] = useState(5);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await rooms.getMine();
      setMine(data.rooms);
      setMax(data.max);
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    if (identity.loading) return;
    if (signedIn) load();
    else setMine([]);
  }, [identity.loading, signedIn, load]);

  async function create(body: RoomWrite) {
    setSaving(true);
    setError(null);
    try {
      const { room } = await rooms.create(body);
      router.push(`/rooms/manage/${room.slug}?new=1`);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  if (!identity.loading && !signedIn) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
        <SiteHeader variant="light" />
        <div className="max-w-xl mx-auto px-4 py-24 text-center">
          <DoorOpen className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight mb-2" style={{ color: 'var(--text-primary)' }}>Reading rooms</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            Put a shelf of primary sources, and the reader for them, on your own website under your own name. Sign in to make one.
          </p>
          <Link href="/auth/signin?callbackUrl=/rooms" className="inline-block px-5 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent-rust)', color: '#fff' }}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight" style={{ color: 'var(--text-primary)' }}>Reading rooms</h1>
          {mine && mine.length < max ? (
            <button type="button" onClick={() => setShowCreate(v => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent-rust)', color: '#fff' }}>
              <Plus className="w-4 h-4" aria-hidden="true" /> New room
            </button>
          ) : null}
        </div>
        <p className="text-sm mb-8 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
          A reading room is a shelf of books from the library with the reader attached, carrying your name, logo and colour.
          It lives at sourcelibrary.org/rooms/&lt;name&gt; and can sit inside a page on your own site, so your readers never leave.
        </p>

        {showCreate ? (
          <div className="mb-12 p-6 bg-white" style={{ border: '1px solid var(--border-light)' }}>
            <RoomForm submitLabel="Create room" saving={saving} error={error} onSubmit={create} />
          </div>
        ) : null}

        {mine === null ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
        ) : mine.length === 0 && !showCreate ? (
          <div className="text-center py-20">
            <DoorOpen className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No rooms yet. Make one from a collection or one of your lists.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mine.map(r => (
              <div key={r.id} className="p-4 bg-white flex flex-col gap-2" style={{ border: '1px solid var(--border-light)' }}>
                <div className="flex items-center gap-3">
                  {r.theme.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.theme.logo_url} alt="" className="h-6 w-auto max-w-[96px] object-contain" referrerPolicy="no-referrer" />
                  ) : null}
                  <h2 className="font-serif text-xl truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</h2>
                  {r.theme.accent_hex ? <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.theme.accent_hex }} aria-hidden="true" /> : null}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  sourcelibrary.org/rooms/{r.slug} · {r.source.type === 'collection' ? `collection “${r.source.slug}”` : 'one of your lists'}
                </p>
                <div className="flex gap-4 text-sm mt-1">
                  <Link href={`/rooms/${r.slug}`} className="underline underline-offset-2" style={{ color: 'var(--accent-rust)' }}>Open</Link>
                  <Link href={`/rooms/manage/${r.slug}`} className="underline underline-offset-2" style={{ color: 'var(--accent-rust)' }}>Manage &amp; embed</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
