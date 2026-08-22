'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Globe, Loader2, Lock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import SiteHeader from '@/components/layout/SiteHeader';
import { lists, type ListSummary } from '@/lib/api-client/lists';
import { useIdentity } from '@/hooks/useIdentity';

// Your lists — playlist-style collections of books, pages, and images.
// Client page: anonymous visitors have lists too (localStorage identity), so
// this can't be resolved server-side.

export default function ListsPage() {
  const identity = useIdentity();
  const [myLists, setMyLists] = useState<ListSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!identity.id) return;
    try {
      const data = await lists.getMine({ visitorId: identity.id, covers: true });
      setMyLists(data.lists);
    } catch {
      setMyLists([]);
    }
  }, [identity.id]);

  useEffect(() => {
    if (identity.loading) return;
    load();
  }, [identity.loading, load]);

  const createList = async () => {
    const title = newTitle.trim();
    if (!title || creating || !identity.id) return;
    setCreating(true);
    try {
      await lists.create({ title, visitorId: identity.id });
      setNewTitle('');
      setShowCreate(false);
      await load();
    } catch {
      toast.error('Could not create the list');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      <div className="max-w-[var(--container-standard)] mx-auto px-4 py-12">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h1 className="text-2xl font-serif font-medium" style={{ color: 'var(--text-primary)' }}>
            Your lists
          </h1>
          <button
            onClick={() => setShowCreate(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--text-primary)', color: 'white' }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> New list
          </button>
        </div>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
          Collect books, pages, and images into lists of your own. Lists start private;
          you can make one public from its page.
        </p>

        {showCreate && (
          <div className="flex gap-2 mb-8 max-w-md">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createList(); }}
              placeholder="Name your list…"
              maxLength={100}
              autoFocus
              className="flex-1 px-3 py-2 rounded-lg"
              style={{ fontSize: '16px', background: 'white', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={createList}
              disabled={creating || !newTitle.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--text-primary)', color: 'white' }}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        )}

        {myLists === null ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
        ) : myLists.length === 0 ? (
          <div className="text-center py-20">
            <Bookmark className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No lists yet. Use the bookmark on any book or image to start one,
              or create one here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myLists.map(list => (
              <Link
                key={list.id}
                href={`/lists/${list.id}`}
                className="block p-4 hover:shadow-md transition-shadow"
                style={{ background: 'white', border: '1px solid var(--border-light)' }}
              >
                <div className="grid grid-cols-4 gap-1 mb-3 h-20">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                      {list.covers?.[i] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={list.covers[i]} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{list.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {list.items_count} {list.items_count === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  {list.visibility === 'public'
                    ? <Globe className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--accent-sage)' }} aria-label="Public list" />
                    : <Lock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} aria-label="Private list" />}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
