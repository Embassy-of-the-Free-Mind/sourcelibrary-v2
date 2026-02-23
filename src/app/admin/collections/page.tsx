'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Edit2,
  Eye,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { gallery } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';

interface CollectionItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageCount: number;
  featured: boolean;
  coverImage: { url: string; description: string } | null;
}

interface CollectionDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  featured: boolean;
  imageCount: number;
  items: Array<{
    id: string;
    pageId: string;
    bookId: string;
    bookTitle: string;
    author?: string;
    year?: number;
    description: string;
    type: string;
    thumbnailUrl?: string;
    extractedUrl?: string;
    imageUrl?: string;
    galleryQuality?: number;
  }>;
}

export default function AdminCollectionsPage() {
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFeatured, setEditFeatured] = useState(false);
  const [editSortOrder, setEditSortOrder] = useState(0);

  const fetchCollections = useCallback(async () => {
    try {
      const data = await gallery.collections.list();
      setCollections(data.collections);
    } catch (e) {
      console.error('Failed to load collections:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const openEditor = async (slug: string) => {
    setEditingSlug(slug);
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await gallery.collections.get(slug);
      setDetail(data);
      setEditTitle(data.title);
      setEditDescription(data.description);
      setEditFeatured(data.featured);
      // Find sort_order from collections list
      const col = collections.find((c) => c.slug === slug);
      setEditSortOrder(col ? collections.indexOf(col) + 1 : 1);
    } catch (e) {
      console.error('Failed to load collection:', e);
      setMessage({ type: 'error', text: 'Failed to load collection' });
    } finally {
      setDetailLoading(false);
    }
  };

  const saveChanges = async () => {
    if (!editingSlug || !detail) return;
    setSaving(true);
    try {
      await gallery.collections.update(editingSlug, {
        title: editTitle,
        description: editDescription,
        featured: editFeatured,
        sort_order: editSortOrder,
      });
      setMessage({ type: 'success', text: 'Collection updated' });
      fetchCollections();
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to save changes' });
    } finally {
      setSaving(false);
    }
  };

  const removeImage = async (imageId: string) => {
    if (!detail || !editingSlug) return;
    const newIds = detail.items.filter((i) => i.id !== imageId).map((i) => i.id);
    try {
      await gallery.collections.update(editingSlug, { image_ids: newIds });
      setDetail({
        ...detail,
        items: detail.items.filter((i) => i.id !== imageId),
        imageCount: newIds.length,
      });
      setMessage({ type: 'success', text: 'Image removed' });
      fetchCollections();
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to remove image' });
    }
  };

  const setCover = async (imageId: string) => {
    if (!editingSlug) return;
    try {
      await gallery.collections.update(editingSlug, { cover_image_id: imageId });
      setMessage({ type: 'success', text: 'Cover image updated' });
      fetchCollections();
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to update cover' });
    }
  };

  const deleteCollection = async (slug: string) => {
    if (!confirm(`Delete collection "${slug}"? This cannot be undone.`)) return;
    try {
      await gallery.collections.remove(slug);
      setCollections((prev) => prev.filter((c) => c.slug !== slug));
      if (editingSlug === slug) {
        setEditingSlug(null);
        setDetail(null);
      }
      setMessage({ type: 'success', text: 'Collection deleted' });
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to delete collection' });
    }
  };

  const reseed = async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch('/api/admin/seed-collections?force=true', { method: 'POST' });
      const data = await res.json();
      const summary = data.results
        ?.map((r: any) => `${r.title}: ${r.imageCount} images (${r.status})`)
        .join('\n');
      setSeedResult(summary || 'No results');
      fetchCollections();
    } catch (e) {
      setSeedResult('Failed to re-seed');
    } finally {
      setSeeding(false);
    }
  };

  // Auto-dismiss messages
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-stone-900 text-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link
              href="/gallery/collections"
              className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Public Collections</span>
            </Link>
            <div className="flex items-center gap-4">
              <button
                onClick={reseed}
                disabled={seeding}
                className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {seeding ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Re-seed All
              </button>
              <div className="text-right">
                <h1 className="text-lg font-serif">Collection Admin</h1>
                <p className="text-stone-400 text-xs">
                  {collections.length} collections
                </p>
              </div>
              <Layers className="w-6 h-6 text-amber-500" />
            </div>
          </div>
        </div>
      </header>

      {/* Toast */}
      {message && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
            message.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Seed results */}
        {seedResult && (
          <div className="mb-6 p-4 bg-stone-100 rounded-lg text-sm font-mono whitespace-pre-line">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-stone-700">Seed Results</span>
              <button onClick={() => setSeedResult(null)} className="text-stone-400 hover:text-stone-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            {seedResult}
          </div>
        )}

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
              <div className="space-y-3">
                {collections.map((col) => (
                  <div
                    key={col.id}
                    className={`bg-white rounded-lg shadow-sm p-4 border-2 transition-colors ${
                      editingSlug === col.slug
                        ? 'border-amber-500'
                        : 'border-transparent hover:border-stone-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                        {col.coverImage?.url ? (
                          <Image
                            src={col.coverImage.url}
                            alt={col.title}
                            width={64}
                            height={64}
                            sizes="64px"
                            className="object-cover w-full h-full"
                            unoptimized
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-stone-300">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-stone-800 truncate">{col.title}</h3>
                          {col.featured && (
                            <Star className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="currentColor" />
                          )}
                        </div>
                        <p className="text-stone-500 text-xs mt-0.5">
                          {col.imageCount} images &middot; {col.slug}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => openEditor(col.slug)}
                          className="p-1.5 text-stone-400 hover:text-amber-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <Link
                          href={`/gallery/collections/${col.slug}`}
                          className="p-1.5 text-stone-400 hover:text-blue-600 transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => deleteCollection(col.slug)}
                          className="p-1.5 text-stone-400 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Editor panel */}
            <div>
              {!editingSlug && (
                <div className="bg-white rounded-lg shadow-sm p-8 text-center text-stone-400">
                  <Edit2 className="w-10 h-10 mx-auto mb-3" />
                  <p>Select a collection to edit</p>
                </div>
              )}

              {editingSlug && detailLoading && (
                <div className="bg-white rounded-lg shadow-sm p-8">
                  <BookLoader size="xs" />
                </div>
              )}

              {editingSlug && detail && !detailLoading && (
                <div className="space-y-6">
                  {/* Edit form */}
                  <div className="bg-white rounded-lg shadow-sm p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-serif text-stone-800">Edit Collection</h2>
                      <button
                        onClick={() => {
                          setEditingSlug(null);
                          setDetail(null);
                        }}
                        className="text-stone-400 hover:text-stone-600"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">Title</label>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-stone-500 mb-1">Description</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                      </div>

                      <div className="flex items-center gap-6">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editFeatured}
                            onChange={(e) => setEditFeatured(e.target.checked)}
                            className="rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                          />
                          Featured
                        </label>

                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-stone-500">Sort Order</label>
                          <input
                            type="number"
                            value={editSortOrder}
                            onChange={(e) => setEditSortOrder(parseInt(e.target.value) || 0)}
                            className="w-16 px-2 py-1 border rounded text-sm text-center"
                          />
                        </div>
                      </div>

                      <button
                        onClick={saveChanges}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Save Changes
                      </button>
                    </div>
                  </div>

                  {/* Image grid */}
                  <div className="bg-white rounded-lg shadow-sm p-5">
                    <h3 className="text-sm font-medium text-stone-700 mb-3">
                      Images ({detail.items.length})
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[600px] overflow-y-auto">
                      {detail.items.map((item) => (
                        <div key={item.id} className="group relative">
                          <div className="aspect-square rounded-lg overflow-hidden bg-stone-100">
                            <Image
                              src={item.thumbnailUrl || item.extractedUrl || item.imageUrl || ''}
                              alt={item.description}
                              width={150}
                              height={150}
                              sizes="150px"
                              className="object-cover w-full h-full"
                              unoptimized
                            />
                          </div>
                          {/* Hover overlay */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex flex-col items-center justify-center gap-1">
                            <button
                              onClick={() => setCover(item.id)}
                              className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-500"
                              title="Set as cover"
                            >
                              <Star className="w-3 h-3 inline mr-1" />
                              Cover
                            </button>
                            <button
                              onClick={() => removeImage(item.id)}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-500"
                              title="Remove from collection"
                            >
                              <Trash2 className="w-3 h-3 inline mr-1" />
                              Remove
                            </button>
                            <Link
                              href={`/gallery/image/${item.id}`}
                              className="px-2 py-1 bg-stone-600 text-white text-xs rounded hover:bg-stone-500"
                            >
                              <Eye className="w-3 h-3 inline mr-1" />
                              View
                            </Link>
                          </div>
                          {/* Quality badge */}
                          {item.galleryQuality && (
                            <span className="absolute top-1 right-1 px-1 py-0.5 bg-black/50 text-white text-[10px] rounded">
                              {(item.galleryQuality * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      ))}
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
