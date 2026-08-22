'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Globe, Loader2, Lock, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import SiteHeader from '@/components/layout/SiteHeader';
import { lists, type ListSummary } from '@/lib/api-client/lists';
import type { EnrichedListItem } from '@/lib/user-lists';
import { useIdentity } from '@/hooks/useIdentity';

// One list. Owners can rename, describe, flip visibility, remove items, and
// delete the list. A public list shows title, description, and items only —
// deliberately NO owner name or identity (safe-defaults.md: nothing here
// attaches a person's name to a public surface).

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const listId = params.id;
  const router = useRouter();
  const identity = useIdentity();

  const [list, setList] = useState<ListSummary | null>(null);
  const [items, setItems] = useState<EnrichedListItem[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await lists.get(listId);
      setList(data.list);
      setItems(data.items);
    } catch {
      setNotFound(true);
    } finally {
      setLoaded(true);
    }
  }, [listId]);

  useEffect(() => {
    // Wait for the session to settle so the owner view doesn't first render
    // as the public (or 404) view and then flip.
    if (identity.loading || !listId) return;
    load();
  }, [identity.loading, listId, load]);

  const saveEdits = async () => {
    if (!list || saving) return;
    const title = editTitle.trim();
    if (!title) return;
    setSaving(true);
    try {
      const res = await lists.update(list.id, { title, description: editDescription.trim() });
      setList(res.list);
      setEditing(false);
    } catch {
      toast.error('Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  const toggleVisibility = async () => {
    if (!list || saving) return;
    setSaving(true);
    try {
      const res = await lists.update(
        list.id,
        { visibility: list.visibility === 'public' ? 'private' : 'public' }
      );
      setList(res.list);
      toast.success(res.list.visibility === 'public'
        ? 'List is public — anyone with the link can view it'
        : 'List is private again');
    } catch {
      toast.error('Could not change visibility');
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (item: EnrichedListItem) => {
    if (!list || busyItem) return;
    const key = `${item.target_type}:${item.target_id}`;
    setBusyItem(key);
    try {
      const res = await lists.toggleItem({
        listId: list.id,
        action: 'remove',
        targetType: item.target_type,
        targetId: item.target_id,
      });
      setItems(prev => prev.filter(i => `${i.target_type}:${i.target_id}` !== key));
      setList(prev => prev ? { ...prev, items_count: res.items_count } : prev);
    } catch {
      toast.error('Could not remove the item');
    } finally {
      setBusyItem(null);
    }
  };

  const deleteList = async () => {
    if (!list) return;
    if (!window.confirm(`Delete “${list.title}”? This cannot be undone.`)) return;
    try {
      await lists.remove(list.id);
      toast.success('List deleted');
      router.push('/lists');
    } catch {
      toast.error('Could not delete the list');
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      <div className="max-w-[var(--container-standard)] mx-auto px-4 py-12">
        {!loaded ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          </div>
        ) : notFound || !list ? (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This list doesn&rsquo;t exist, or it&rsquo;s private.
            </p>
            <Link href="/lists" className="text-sm underline mt-2 inline-block hover:opacity-70" style={{ color: 'var(--text-secondary)' }}>
              Back to your lists
            </Link>
          </div>
        ) : (
          <>
            {list.is_owner && (
              <Link href="/lists" className="inline-flex items-center gap-1 text-sm mb-6 hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Your lists
              </Link>
            )}

            {editing ? (
              <div className="max-w-xl mb-8 space-y-3">
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 rounded-lg text-xl font-serif"
                  style={{ fontSize: '20px', background: 'white', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="A few words about this list (optional)"
                  className="w-full px-3 py-2 rounded-lg resize-y"
                  style={{ fontSize: '16px', background: 'white', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveEdits}
                    disabled={saving || !editTitle.trim()}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--text-primary)', color: 'white' }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-4 py-1.5 text-sm hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-8">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-serif font-medium" style={{ color: 'var(--text-primary)' }}>
                    {list.title}
                  </h1>
                  {list.is_owner && (
                    <button
                      onClick={() => { setEditTitle(list.title); setEditDescription(list.description); setEditing(true); }}
                      className="p-1 hover:opacity-70 transition-opacity"
                      title="Edit title & description"
                      aria-label="Edit title and description"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {list.description && (
                  <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--text-secondary)' }}>{list.description}</p>
                )}
                <div className="flex items-center gap-4 mt-3 text-sm flex-wrap" style={{ color: 'var(--text-muted)' }}>
                  <span>{list.items_count} {list.items_count === 1 ? 'item' : 'items'}</span>
                  {list.is_owner ? (
                    <>
                      <button
                        onClick={toggleVisibility}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity disabled:opacity-50"
                        title={list.visibility === 'public'
                          ? 'Public — anyone with the link can view this list. Click to make it private.'
                          : 'Private — only you can see this list. Click to make it public (anyone with the link could view it; your name is never shown).'}
                      >
                        {list.visibility === 'public'
                          ? <><Globe className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} aria-hidden="true" /> Public — anyone with the link</>
                          : <><Lock className="w-4 h-4" aria-hidden="true" /> Private — only you</>}
                      </button>
                      <button
                        onClick={deleteList}
                        className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
                        style={{ color: 'var(--accent-rust)' }}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete list
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe className="w-4 h-4" aria-hidden="true" /> A reader&rsquo;s list on Source Library
                    </span>
                  )}
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <p className="text-sm py-10" style={{ color: 'var(--text-muted)' }}>
                Nothing saved here yet{list.is_owner ? ' — use the bookmark on any book, page, or image to add it.' : '.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map(item => {
                  const key = `${item.target_type}:${item.target_id}`;
                  return (
                    <div key={key} className="relative group">
                      <Link
                        href={item.href}
                        className="block hover:shadow-md transition-shadow"
                        style={{ background: 'white', border: '1px solid var(--border-light)' }}
                      >
                        <div className="aspect-[3/4] overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                          {item.thumbnail && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                          )}
                        </div>
                        <div className="p-2.5">
                          <p className="text-sm font-medium line-clamp-2" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                          {item.subtitle && (
                            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{item.subtitle}</p>
                          )}
                        </div>
                      </Link>
                      {list.is_owner && (
                        <button
                          onClick={() => removeItem(item)}
                          disabled={busyItem === key}
                          className="absolute top-1.5 right-1.5 p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                          style={{ background: 'rgba(0,0,0,0.55)', color: 'white' }}
                          title="Remove from list"
                          aria-label={`Remove ${item.title} from list`}
                        >
                          {busyItem === key
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                            : <X className="w-3.5 h-3.5" aria-hidden="true" />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
