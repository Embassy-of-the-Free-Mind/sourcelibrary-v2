'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bookmark, Check, Loader2, Lock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { lists, type ListSummary } from '@/lib/api-client/lists';
import type { ListTargetType } from '@/lib/types/lists';
import { useIdentity } from '@/hooks/useIdentity';
import { useIsEmbedded } from '@/hooks/useEmbedContext';

// "Save to a list" — the playlist-style counterpart to LikeButton. Anonymous
// visitors can build lists too (same dual identity as likes; lists migrate to
// the account on first sign-in via /api/account/migrate).
//
// Deliberately NOT mounted on embed/tenant surfaces: list pages link to
// global /book and /gallery URLs, which leak off partner subdomains
// (tenant-lockdown.md invariant 6).

interface SaveToListButtonProps {
  targetType: ListTargetType;
  targetId: string;
  size?: 'sm' | 'md' | 'lg';
  /** Optional text label next to the bookmark icon. */
  label?: string;
  className?: string;
}

const sizeClasses = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' };
const buttonSizes = { sm: 'p-1', md: 'p-1.5', lg: 'p-2' };
const textSizes = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };

export default function SaveToListButton({
  targetType,
  targetId,
  size = 'md',
  label,
  className = '',
}: SaveToListButtonProps) {
  const identity = useIdentity();
  // Host-aware: true on /embed/ routes, iframes, AND tenant subdomains (the
  // global gallery/book routes can render there with tenant headers stamped).
  const embed = useIsEmbedded();
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [myLists, setMyLists] = useState<ListSummary[] | null>(null);
  const [busyListId, setBusyListId] = useState<string | null>(null);
  const [inAnyList, setInAnyList] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const newTitleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);

  const loadLists = useCallback(async () => {
    if (!identity.id) return;
    try {
      const data = await lists.getMine({
        visitorId: identity.id,
        containing: { type: targetType, id: targetId },
      });
      setMyLists(data.lists);
      setInAnyList(data.lists.some(l => l.contains));
    } catch {
      setMyLists([]);
    }
  }, [identity.id, targetType, targetId]);

  useEffect(() => {
    if (!isOpen) return;
    loadLists();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, loadLists]);

  const toggleList = async (list: ListSummary) => {
    if (busyListId || !identity.id) return;
    setBusyListId(list.id);
    const action = list.contains ? 'remove' : 'add';
    try {
      const res = await lists.toggleItem({
        listId: list.id,
        action,
        targetType,
        targetId,
        visitorId: identity.id,
      });
      setMyLists(prev => {
        const next = (prev || []).map(l =>
          l.id === list.id ? { ...l, contains: res.in_list, items_count: res.items_count } : l
        );
        setInAnyList(next.some(l => l.contains));
        return next;
      });
    } catch {
      toast.error('Could not update the list');
    } finally {
      setBusyListId(null);
    }
  };

  const createList = async () => {
    const title = newTitle.trim();
    if (!title || creating || !identity.id) return;
    setCreating(true);
    try {
      // New lists are PRIVATE by default; the list page has the visibility
      // control, labeled with what public actually means.
      const res = await lists.create({ title, visitorId: identity.id });
      await lists.toggleItem({
        listId: res.list.id,
        action: 'add',
        targetType,
        targetId,
        visitorId: identity.id,
      });
      setNewTitle('');
      await loadLists();
    } catch {
      toast.error('Could not create the list');
    } finally {
      setCreating(false);
    }
  };

  // Never on embed/tenant reading rooms — the modal and list pages link to
  // global URLs, which leak off partner subdomains (tenant-lockdown.md).
  if (embed) return null;

  // Match LikeButton's pre-mount placeholder to avoid hydration mismatch
  if (!mounted) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <div className={`${buttonSizes[size]} rounded-full`}>
          <Bookmark className={`${sizeClasses[size]} text-gray-400`} />
        </div>
        {label && <span className={`${textSizes[size]} text-gray-500`}>{label}</span>}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-1 group transition-all duration-200 cursor-pointer ${className}`}
        title="Save to a list"
        aria-label="Save to a list"
      >
        <div className={`${buttonSizes[size]} rounded-full transition-all duration-200 ${inAnyList ? 'text-accent-gold' : 'text-gray-400 group-hover:scale-110'}`}>
          <Bookmark
            className={`${sizeClasses[size]} transition-all duration-200`}
            fill={inAnyList ? 'currentColor' : 'none'}
            strokeWidth={inAnyList ? 0 : 2}
          />
        </div>
        {label && (
          <span className={`${textSizes[size]} font-medium transition-colors duration-200 ${inAnyList ? 'text-accent-gold' : 'text-gray-500'}`}>
            {label}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-to-list-title"
            className="rounded-xl shadow-2xl w-full max-w-sm max-h-[80vh] overflow-hidden flex flex-col"
            style={{ background: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <h2 id="save-to-list-title" className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                Save to a list
              </h2>
              <button onClick={() => setIsOpen(false)} aria-label="Close" className="p-1 hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto p-2">
              {myLists === null ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                </div>
              ) : myLists.length === 0 ? (
                <p className="text-sm text-center px-4 py-6" style={{ color: 'var(--text-muted)' }}>
                  No lists yet — name your first one below.
                </p>
              ) : (
                myLists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => toggleList(list)}
                    disabled={busyListId === list.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    <span
                      className="w-5 h-5 flex items-center justify-center shrink-0"
                      style={{
                        border: list.contains ? 'none' : '1px solid var(--border-medium)',
                        background: list.contains ? 'var(--accent-rust)' : 'transparent',
                      }}
                    >
                      {busyListId === list.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                        : list.contains && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate" style={{ color: 'var(--text-primary)' }}>{list.title}</span>
                      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {list.items_count} {list.items_count === 1 ? 'item' : 'items'}
                      </span>
                    </span>
                    {list.visibility === 'private' && (
                      <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="p-3" style={{ borderTop: '1px solid var(--border-light)' }}>
              <div className="flex gap-2">
                <input
                  ref={newTitleRef}
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createList(); }}
                  placeholder="New list…"
                  maxLength={100}
                  className="flex-1 px-3 py-2 rounded-lg"
                  style={{ fontSize: '16px', background: 'var(--bg-cream)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={createList}
                  disabled={creating || !newTitle.trim()}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1"
                  style={{ background: 'var(--text-primary)', color: 'white' }}
                  aria-label="Create list and add this item"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
                  Create
                </button>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                New lists are private. Manage them in{' '}
                <Link href="/lists" className="underline hover:opacity-70" onClick={() => setIsOpen(false)}>
                  your lists
                </Link>.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
