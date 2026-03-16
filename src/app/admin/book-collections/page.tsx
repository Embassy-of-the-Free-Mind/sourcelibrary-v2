'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Edit2,
  Loader2,
  Save,
  X,
} from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

interface CollectionDoc {
  slug: string;
  name: string;
  subtitle?: string;
  description?: string;
  expanded_description?: string;
  color?: string;
  order?: number;
  book_count?: number;
  parent?: string;
  languages?: { lang: string; count: number }[];
}

export default function BookCollectionsAdmin() {
  const [collections, setCollections] = useState<CollectionDoc[]>([]);
  const [subcollections, setSubcollections] = useState<Record<string, CollectionDoc[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CollectionDoc | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedParent, setExpandedParent] = useState<string | null>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editExpandedDesc, setEditExpandedDesc] = useState('');
  const [editColor, setEditColor] = useState('gold');
  const [editOrder, setEditOrder] = useState(99);

  const fetchAll = useCallback(async () => {
    try {
      // Fetch all collections (including subcollections) via direct DB query
      const res = await fetch('/api/admin/book-collections');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const all: CollectionDoc[] = data.collections;
      const topLevel = all.filter(c => !c.parent).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      const subs: Record<string, CollectionDoc[]> = {};
      for (const c of all.filter(c => c.parent)) {
        const p = c.parent!;
        if (!subs[p]) subs[p] = [];
        subs[p].push(c);
      }
      for (const key of Object.keys(subs)) {
        subs[key].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      }

      setCollections(topLevel);
      setSubcollections(subs);
    } catch (e) {
      console.error('Failed to load collections:', e);
      setMessage({ type: 'error', text: 'Failed to load collections' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const openEditor = (col: CollectionDoc) => {
    setEditing(col);
    setEditName(col.name);
    setEditSubtitle(col.subtitle || '');
    setEditDescription(col.description || '');
    setEditExpandedDesc(col.expanded_description || '');
    setEditColor(col.color || 'gold');
    setEditOrder(col.order ?? 99);
  };

  const saveChanges = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: editing.slug,
          name: editName,
          subtitle: editSubtitle,
          description: editDescription,
          expanded_description: editExpandedDesc,
          color: editColor,
          order: editOrder,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setMessage({ type: 'success', text: `Updated "${editName}"` });
      setEditing(null);
      fetchAll();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const hasSubcollections = (slug: string) => (subcollections[slug]?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <header className="bg-stone-900 text-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link
              href="/collections"
              className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              Public Collections
            </Link>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <h1 className="text-lg font-serif">Book Collections</h1>
                <p className="text-stone-400 text-xs">
                  {collections.length} collections &middot;{' '}
                  {Object.values(subcollections).flat().length} subcollections
                </p>
              </div>
              <BookOpen className="w-6 h-6 text-accent-gold" />
            </div>
          </div>
        </div>
      </header>

      {message && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
            message.type === 'success' ? 'bg-status-success text-white' : 'bg-status-error text-white'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="py-20">
            <BookLoader size="xs" />
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: Collection list */}
            <div>
              <h2 className="text-lg font-serif text-stone-800 mb-4">Collections</h2>
              <div className="space-y-2">
                {collections.map(col => (
                  <div key={col.slug}>
                    <div
                      className={`bg-white rounded-lg shadow-sm p-4 border-2 transition-colors ${
                        editing?.slug === col.slug ? 'border-accent-gold' : 'border-transparent hover:border-stone-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-stone-800 truncate">{col.name}</h3>
                            <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                              {col.book_count ?? 0} books
                            </span>
                          </div>
                          <p className="text-stone-400 text-xs mt-0.5 truncate">
                            {col.slug} &middot; order: {col.order ?? '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {hasSubcollections(col.slug) && (
                            <button
                              onClick={() => setExpandedParent(expandedParent === col.slug ? null : col.slug)}
                              className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors"
                              title="Show subcollections"
                            >
                              <ChevronRight
                                className={`w-4 h-4 transition-transform ${expandedParent === col.slug ? 'rotate-90' : ''}`}
                              />
                            </button>
                          )}
                          <button
                            onClick={() => openEditor(col)}
                            className="p-1.5 text-stone-400 hover:text-accent-rust transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <Link
                            href={`/collections/${col.slug}`}
                            className="p-1.5 text-stone-400 hover:text-blue-600 transition-colors text-xs"
                            title="View"
                          >
                            View
                          </Link>
                        </div>
                      </div>
                    </div>

                    {/* Subcollections */}
                    {expandedParent === col.slug && subcollections[col.slug] && (
                      <div className="ml-6 mt-1 space-y-1">
                        {subcollections[col.slug].map(sub => (
                          <div
                            key={sub.slug}
                            className={`bg-white/80 rounded-lg shadow-sm p-3 border-2 transition-colors ${
                              editing?.slug === sub.slug ? 'border-accent-gold' : 'border-transparent hover:border-stone-200'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-medium text-stone-700 truncate">{sub.name}</h4>
                                  <span className="text-xs text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                                    {sub.book_count ?? 0}
                                  </span>
                                </div>
                                <p className="text-stone-400 text-[11px] truncate">{sub.slug}</p>
                              </div>
                              <button
                                onClick={() => openEditor(sub)}
                                className="p-1 text-stone-400 hover:text-accent-rust transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Editor panel */}
            <div>
              {!editing && (
                <div className="bg-white rounded-lg shadow-sm p-8 text-center text-stone-400">
                  <Edit2 className="w-10 h-10 mx-auto mb-3" />
                  <p>Select a collection to edit</p>
                </div>
              )}

              {editing && (
                <div className="bg-white rounded-lg shadow-sm p-5 sticky top-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-serif text-stone-800">
                      Edit: {editing.name}
                      {editing.parent && (
                        <span className="text-xs text-stone-400 ml-2">
                          sub of {editing.parent}
                        </span>
                      )}
                    </h2>
                    <button onClick={() => setEditing(null)} className="text-stone-400 hover:text-stone-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus-visible:ring-accent-rust focus:border-accent-gold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Subtitle</label>
                      <input
                        type="text"
                        value={editSubtitle}
                        onChange={e => setEditSubtitle(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus-visible:ring-accent-rust focus:border-accent-gold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Description (short)</label>
                      <textarea
                        value={editDescription}
                        onChange={e => setEditDescription(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus-visible:ring-accent-rust focus:border-accent-gold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1">Expanded Description</label>
                      <textarea
                        value={editExpandedDesc}
                        onChange={e => setEditExpandedDesc(e.target.value)}
                        rows={6}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus-visible:ring-accent-rust focus:border-accent-gold"
                        placeholder="Longer description shown on collection detail page. Use double newlines for paragraphs."
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">Color</label>
                        <select
                          value={editColor}
                          onChange={e => setEditColor(e.target.value)}
                          className="px-3 py-2 border rounded-lg text-sm"
                        >
                          <option value="gold">Gold</option>
                          <option value="rust">Rust</option>
                          <option value="sage">Sage</option>
                          <option value="violet">Violet</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">Order</label>
                        <input
                          type="number"
                          value={editOrder}
                          onChange={e => setEditOrder(parseInt(e.target.value) || 0)}
                          className="w-20 px-3 py-2 border rounded-lg text-sm text-center"
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex items-center gap-3">
                      <button
                        onClick={saveChanges}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-accent-rust hover:bg-accent-rust/80 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                      </button>
                      <span className="text-xs text-stone-400">
                        {editing.book_count ?? 0} books &middot; slug: {editing.slug}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
