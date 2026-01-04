/**
 * Single Image Detail Page
 *
 * INTENT:
 * This is the atomic unit of the gallery - a single image that can be:
 * - Linked to directly (stable URL)
 * - Shared on social media (with beautiful preview)
 * - Explored in detail (zoom, pan)
 * - Connected to its source (read in context)
 * - Cited in scholarly work
 *
 * The page should feel like looking at a work of art in a museum:
 * - The image dominates
 * - Metadata supports understanding, doesn't overwhelm
 * - Easy to go deeper (source text) or browse more (related images)
 *
 * This is infrastructure for making visual knowledge searchable, shareable, citable.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  BookOpen,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Move,
  Crop,
  Save
} from 'lucide-react';
import ImageWithMagnifier from '@/components/ImageWithMagnifier';

interface ImageMetadata {
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  style?: string;
  technique?: string;
}

interface ImageData {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  fullPageUrl: string;
  highResUrl?: string;
  description: string;
  type?: string;
  confidence?: number;
  model?: string;
  detectionSource?: string;
  galleryQuality?: number | null;
  galleryRationale?: string | null;
  featured?: boolean;
  metadata?: ImageMetadata | null;
  museumDescription?: string | null;
  bbox?: { x: number; y: number; width: number; height: number };
  book: {
    id: string;
    title: string;
    author?: string;
    year?: number;
    doi?: string;
  };
  pageNumber: number;
  readUrl: string;
  galleryUrl: string;
  citation: string;
}

export default function ImageDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const [imageId, setImageId] = useState<string | null>(null);
  const [data, setData] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingQuality, setEditingQuality] = useState(false);
  const [qualityValue, setQualityValue] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [museumDescValue, setMuseumDescValue] = useState('');
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataValues, setMetadataValues] = useState<ImageMetadata>({});
  const [editingBbox, setEditingBbox] = useState(false);
  const [bboxValues, setBboxValues] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState<'move' | 'resize' | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    params.then(p => setImageId(p.id));
  }, [params]);

  useEffect(() => {
    if (!imageId) return;

    async function fetchImage() {
      try {
        const res = await fetch(`/api/gallery/image/${imageId}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Image not found');
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchImage();
  }, [imageId]);

  // Initialize values when data loads
  useEffect(() => {
    if (data?.galleryQuality != null) {
      setQualityValue(data.galleryQuality);
    }
    if (data?.museumDescription) {
      setMuseumDescValue(data.museumDescription);
    }
    if (data?.metadata) {
      setMetadataValues(data.metadata);
    }
    if (data?.bbox) {
      setBboxValues(data.bbox);
    }
  }, [data?.galleryQuality, data?.museumDescription, data?.metadata, data?.bbox]);

  const saveQuality = async (newQuality: number) => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/gallery/image/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ galleryQuality: newQuality })
      });
      if (res.ok) {
        setData({ ...data, galleryQuality: newQuality });
        setEditingQuality(false);
      }
    } catch (e) {
      console.error('Failed to save quality:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveMuseumDescription = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/gallery/image/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ museumDescription: museumDescValue })
      });
      if (res.ok) {
        setData({ ...data, museumDescription: museumDescValue });
        setEditingDescription(false);
      }
    } catch (e) {
      console.error('Failed to save description:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveMetadata = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/gallery/image/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: metadataValues })
      });
      if (res.ok) {
        setData({ ...data, metadata: metadataValues });
        setEditingMetadata(false);
      }
    } catch (e) {
      console.error('Failed to save metadata:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveBbox = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/gallery/image/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: bboxValues })
      });
      if (res.ok) {
        // Rebuild the cropped image URL
        const imageUrl = data.fullPageUrl;
        const cropParams = new URLSearchParams({
          url: imageUrl,
          x: bboxValues.x.toString(),
          y: bboxValues.y.toString(),
          w: bboxValues.width.toString(),
          h: bboxValues.height.toString()
        });
        const newCroppedUrl = `/api/crop-image?${cropParams}`;
        setData({ ...data, bbox: bboxValues, imageUrl: newCroppedUrl });
        setEditingBbox(false);
      }
    } catch (e) {
      console.error('Failed to save bbox:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleBboxMouseDown = (e: React.MouseEvent, action: 'move' | 'resize') => {
    e.preventDefault();
    setIsDragging(action);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleBboxMouseMove = (e: React.MouseEvent, containerRect: DOMRect) => {
    if (!isDragging) return;

    const deltaX = (e.clientX - dragStart.x) / containerRect.width;
    const deltaY = (e.clientY - dragStart.y) / containerRect.height;

    if (isDragging === 'move') {
      setBboxValues(prev => ({
        ...prev,
        x: Math.max(0, Math.min(1 - prev.width, prev.x + deltaX)),
        y: Math.max(0, Math.min(1 - prev.height, prev.y + deltaY))
      }));
    } else if (isDragging === 'resize') {
      setBboxValues(prev => ({
        ...prev,
        width: Math.max(0.05, Math.min(1 - prev.x, prev.width + deltaX)),
        height: Math.max(0.05, Math.min(1 - prev.y, prev.height + deltaY))
      }));
    }

    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleBboxMouseUp = () => {
    setIsDragging(null);
  };

  const copyLink = async () => {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCitation = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.citation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToTwitter = () => {
    if (!data) return;
    const text = `${data.description}\n\nFrom "${data.book.title}"${data.book.author ? ` by ${data.book.author}` : ''}${data.book.year ? ` (${data.book.year})` : ''}\n\n`;
    const url = window.location.href;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank'
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">{error || 'Image not found'}</p>
          <Link href="/gallery" className="text-amber-500 hover:text-amber-400">
            Back to Gallery
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-900 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-stone-900/90 backdrop-blur-sm border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link
            href="/gallery"
            className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Gallery</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="p-2 rounded-lg hover:bg-stone-800 transition-colors"
              title="Copy link"
            >
              {copied ? (
                <Check className="w-5 h-5 text-green-500" />
              ) : (
                <Copy className="w-5 h-5" />
              )}
            </button>
            <button
              onClick={shareToTwitter}
              className="p-2 rounded-lg hover:bg-stone-800 transition-colors"
              title="Share on X"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="pt-16 pb-8">
        <div className="max-w-6xl mx-auto px-4">
          {/* Image container with magnifier */}
          <div className="relative bg-stone-800 rounded-xl overflow-hidden my-8">
            <div className="aspect-[4/3] h-96 relative">
              <ImageWithMagnifier
                src={data.imageUrl}
                alt={data.description}
                className="w-full h-full"
                magnifierSize={250}
                zoomLevel={4}
                highResSrc={data.highResUrl}
              />
            </div>

            {/* Type badge */}
            {data.type && (
              <span className="absolute top-4 left-4 px-3 py-1 rounded-full text-sm bg-amber-600/90 text-white capitalize z-10">
                {data.type}
              </span>
            )}

            {/* Hint for desktop users */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-stone-900/70 rounded-full text-xs text-stone-400 pointer-events-none">
              Hover to magnify · Tap for fullscreen
            </div>
          </div>

          {/* Metadata */}
          <div className="grid md:grid-cols-3 gap-8">
            {/* Description */}
            <div className="md:col-span-2 space-y-6">
              <div>
                <h1 className="text-2xl font-serif text-stone-100 leading-relaxed">
                  {data.description}
                </h1>

                {data.model && (
                  <p className="text-sm text-stone-500 mt-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Identified by {data.model}
                    {data.confidence && ` (${Math.round(data.confidence * 100)}% confidence)`}
                  </p>
                )}
              </div>

              {/* Gallery Quality Rating */}
              <div className="bg-stone-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-stone-400">Gallery Quality</p>
                  <span className="text-xs text-stone-500">Guide cutoff: 0.75</span>
                </div>

                {editingQuality ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={qualityValue}
                        onChange={(e) => setQualityValue(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                      <span className="text-lg font-mono text-amber-500 w-12 text-right">
                        {qualityValue.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveQuality(qualityValue)}
                        disabled={saving}
                        className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setQualityValue(data.galleryQuality ?? 0);
                          setEditingQuality(false);
                        }}
                        className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-stone-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (data.galleryQuality ?? 0) >= 0.75 ? 'bg-green-500' :
                            (data.galleryQuality ?? 0) >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${(data.galleryQuality ?? 0) * 100}%` }}
                        />
                      </div>
                      <span className={`text-lg font-mono ${
                        (data.galleryQuality ?? 0) >= 0.75 ? 'text-green-500' :
                        (data.galleryQuality ?? 0) >= 0.5 ? 'text-amber-500' : 'text-red-500'
                      }`}>
                        {data.galleryQuality != null ? data.galleryQuality.toFixed(2) : 'N/A'}
                      </span>
                    </div>
                    <button
                      onClick={() => setEditingQuality(true)}
                      className="text-xs text-amber-500 hover:text-amber-400"
                    >
                      Adjust
                    </button>
                  </div>
                )}

                {data.galleryRationale && (
                  <p className="text-xs text-stone-500 mt-2 italic">
                    {data.galleryRationale}
                  </p>
                )}
              </div>

              {/* Museum Description */}
              <div className="bg-stone-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-stone-400">Museum Description</p>
                  {!editingDescription && (
                    <button
                      onClick={() => setEditingDescription(true)}
                      className="text-xs text-amber-500 hover:text-amber-400"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingDescription ? (
                  <div className="space-y-3">
                    <textarea
                      value={museumDescValue}
                      onChange={(e) => setMuseumDescValue(e.target.value)}
                      className="w-full h-24 p-2 bg-stone-700 text-stone-200 rounded text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Write a 2-3 sentence museum-style description..."
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveMuseumDescription}
                        disabled={saving}
                        className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setMuseumDescValue(data.museumDescription || '');
                          setEditingDescription(false);
                        }}
                        className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-stone-300 text-sm leading-relaxed">
                    {data.museumDescription || <span className="text-stone-500 italic">No description yet</span>}
                  </p>
                )}
              </div>

              {/* Metadata Tags */}
              <div className="bg-stone-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-stone-400">Metadata</p>
                  {!editingMetadata && (
                    <button
                      onClick={() => setEditingMetadata(true)}
                      className="text-xs text-amber-500 hover:text-amber-400"
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingMetadata ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">Subjects (comma-separated)</label>
                      <input
                        type="text"
                        value={metadataValues.subjects?.join(', ') || ''}
                        onChange={(e) => setMetadataValues(prev => ({
                          ...prev,
                          subjects: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        }))}
                        className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                        placeholder="alchemy, transformation, mythology"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">Figures (comma-separated)</label>
                      <input
                        type="text"
                        value={metadataValues.figures?.join(', ') || ''}
                        onChange={(e) => setMetadataValues(prev => ({
                          ...prev,
                          figures: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        }))}
                        className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                        placeholder="Mercury, old man, serpent"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">Symbols (comma-separated)</label>
                      <input
                        type="text"
                        value={metadataValues.symbols?.join(', ') || ''}
                        onChange={(e) => setMetadataValues(prev => ({
                          ...prev,
                          symbols: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        }))}
                        className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                        placeholder="ouroboros, athanor, philosophical egg"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-stone-500 block mb-1">Style</label>
                        <input
                          type="text"
                          value={metadataValues.style || ''}
                          onChange={(e) => setMetadataValues(prev => ({
                            ...prev,
                            style: e.target.value
                          }))}
                          className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                          placeholder="Northern European Renaissance"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-stone-500 block mb-1">Technique</label>
                        <input
                          type="text"
                          value={metadataValues.technique || ''}
                          onChange={(e) => setMetadataValues(prev => ({
                            ...prev,
                            technique: e.target.value
                          }))}
                          className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                          placeholder="woodcut, engraving"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveMetadata}
                        disabled={saving}
                        className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-sm transition-colors disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setMetadataValues(data.metadata || {});
                          setEditingMetadata(false);
                        }}
                        className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    {metadataValues.subjects && metadataValues.subjects.length > 0 && (
                      <div>
                        <span className="text-stone-500">Subjects: </span>
                        <span className="text-stone-300">{metadataValues.subjects.join(', ')}</span>
                      </div>
                    )}
                    {metadataValues.figures && metadataValues.figures.length > 0 && (
                      <div>
                        <span className="text-stone-500">Figures: </span>
                        <span className="text-stone-300">{metadataValues.figures.join(', ')}</span>
                      </div>
                    )}
                    {metadataValues.symbols && metadataValues.symbols.length > 0 && (
                      <div>
                        <span className="text-stone-500">Symbols: </span>
                        <span className="text-stone-300">{metadataValues.symbols.join(', ')}</span>
                      </div>
                    )}
                    {metadataValues.style && (
                      <div>
                        <span className="text-stone-500">Style: </span>
                        <span className="text-stone-300">{metadataValues.style}</span>
                      </div>
                    )}
                    {metadataValues.technique && (
                      <div>
                        <span className="text-stone-500">Technique: </span>
                        <span className="text-stone-300">{metadataValues.technique}</span>
                      </div>
                    )}
                    {!metadataValues.subjects?.length && !metadataValues.figures?.length &&
                     !metadataValues.symbols?.length && !metadataValues.style && !metadataValues.technique && (
                      <p className="text-stone-500 italic">No metadata yet</p>
                    )}
                  </div>
                )}
              </div>

              {/* Bounding Box Editor */}
              {data.bbox && data.fullPageUrl && (
                <div className="bg-stone-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-stone-400 flex items-center gap-2">
                      <Crop className="w-4 h-4" />
                      Bounding Box
                    </p>
                    {!editingBbox ? (
                      <button
                        onClick={() => setEditingBbox(true)}
                        className="text-xs text-amber-500 hover:text-amber-400"
                      >
                        Edit Crop
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={saveBbox}
                          disabled={saving}
                          className="flex items-center gap-1 px-2 py-1 bg-amber-600 hover:bg-amber-500 rounded text-xs transition-colors disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" />
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setBboxValues(data.bbox || { x: 0, y: 0, width: 1, height: 1 });
                            setEditingBbox(false);
                          }}
                          className="px-2 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {editingBbox ? (
                    <div className="space-y-3">
                      <p className="text-xs text-stone-500">Drag the box to move, drag the corner to resize</p>
                      <div
                        className="relative bg-stone-900 rounded overflow-hidden cursor-crosshair select-none"
                        style={{ aspectRatio: '3/4' }}
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          handleBboxMouseMove(e, rect);
                        }}
                        onMouseUp={handleBboxMouseUp}
                        onMouseLeave={handleBboxMouseUp}
                      >
                        {/* Full page image */}
                        <Image
                          src={data.fullPageUrl}
                          alt="Full page"
                          fill
                          className="object-contain"
                          unoptimized
                        />
                        {/* Darkened overlay outside bbox */}
                        <div
                          className="absolute inset-0 bg-black/60 pointer-events-none"
                          style={{
                            clipPath: `polygon(
                              0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                              ${bboxValues.x * 100}% ${bboxValues.y * 100}%,
                              ${bboxValues.x * 100}% ${(bboxValues.y + bboxValues.height) * 100}%,
                              ${(bboxValues.x + bboxValues.width) * 100}% ${(bboxValues.y + bboxValues.height) * 100}%,
                              ${(bboxValues.x + bboxValues.width) * 100}% ${bboxValues.y * 100}%,
                              ${bboxValues.x * 100}% ${bboxValues.y * 100}%
                            )`
                          }}
                        />
                        {/* Draggable bbox */}
                        <div
                          className="absolute border-2 border-amber-500 cursor-move"
                          style={{
                            left: `${bboxValues.x * 100}%`,
                            top: `${bboxValues.y * 100}%`,
                            width: `${bboxValues.width * 100}%`,
                            height: `${bboxValues.height * 100}%`
                          }}
                          onMouseDown={(e) => handleBboxMouseDown(e, 'move')}
                        >
                          {/* Move handle in center */}
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <Move className="w-6 h-6 text-amber-500 opacity-50" />
                          </div>
                          {/* Resize handle at bottom-right */}
                          <div
                            className="absolute -bottom-1 -right-1 w-4 h-4 bg-amber-500 rounded-sm cursor-se-resize"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleBboxMouseDown(e, 'resize');
                            }}
                          />
                        </div>
                      </div>
                      {/* Coordinates display */}
                      <div className="grid grid-cols-4 gap-2 text-xs text-stone-500">
                        <div>x: {bboxValues.x.toFixed(3)}</div>
                        <div>y: {bboxValues.y.toFixed(3)}</div>
                        <div>w: {bboxValues.width.toFixed(3)}</div>
                        <div>h: {bboxValues.height.toFixed(3)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-stone-500 grid grid-cols-4 gap-2">
                      <div>x: {bboxValues.x.toFixed(3)}</div>
                      <div>y: {bboxValues.y.toFixed(3)}</div>
                      <div>w: {bboxValues.width.toFixed(3)}</div>
                      <div>h: {bboxValues.height.toFixed(3)}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Citation */}
              <div className="bg-stone-800 rounded-lg p-4">
                <p className="text-sm text-stone-400 mb-2">Cite this image:</p>
                <p className="text-stone-300 text-sm font-mono">{data.citation}</p>
                <button
                  onClick={copyCitation}
                  className="mt-3 text-xs text-amber-500 hover:text-amber-400 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Copy citation
                </button>
              </div>
            </div>

            {/* Source info */}
            <div className="space-y-4">
              <div className="bg-stone-800 rounded-lg p-4">
                <h2 className="text-sm text-stone-500 uppercase tracking-wide mb-3">Source</h2>

                <Link
                  href={`/book/${data.book.id}`}
                  className="block group"
                >
                  <p className="text-amber-500 group-hover:text-amber-400 font-medium">
                    {data.book.title}
                  </p>
                  {data.book.author && (
                    <p className="text-stone-400 text-sm">{data.book.author}</p>
                  )}
                  {data.book.year && (
                    <p className="text-stone-500 text-sm">{data.book.year}</p>
                  )}
                </Link>

                <div className="mt-4 pt-4 border-t border-stone-700">
                  <Link
                    href={data.readUrl}
                    className="flex items-center gap-2 text-sm text-stone-300 hover:text-white transition-colors"
                  >
                    <BookOpen className="w-4 h-4" />
                    Read page {data.pageNumber} in context
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>

              {/* Quick actions */}
              <div className="flex flex-col gap-2">
                <Link
                  href={data.galleryUrl}
                  className="block text-center py-2 px-4 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm transition-colors"
                >
                  More from this book
                </Link>
                <Link
                  href="/gallery"
                  className="block text-center py-2 px-4 bg-stone-800 hover:bg-stone-700 rounded-lg text-sm transition-colors"
                >
                  Explore all images
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
