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
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  Sparkles,
  X
} from 'lucide-react';

interface ImageData {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  fullPageUrl: string;
  description: string;
  type?: string;
  confidence?: number;
  model?: string;
  detectionSource?: string;
  galleryQuality?: number | null;
  galleryRationale?: string | null;
  featured?: boolean;
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
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [editingQuality, setEditingQuality] = useState(false);
  const [qualityValue, setQualityValue] = useState<number>(0);
  const [saving, setSaving] = useState(false);

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

  // Initialize quality value when data loads
  useEffect(() => {
    if (data?.galleryQuality != null) {
      setQualityValue(data.galleryQuality);
    }
  }, [data?.galleryQuality]);

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
            <button
              onClick={() => setShowFullscreen(true)}
              className="p-2 rounded-lg hover:bg-stone-800 transition-colors"
              title="Fullscreen"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="pt-16 pb-8">
        <div className="max-w-6xl mx-auto px-4">
          {/* Image container */}
          <div className="relative bg-stone-800 rounded-xl overflow-hidden my-8">
            <div className="aspect-[4/3] md:aspect-[16/10] relative flex items-center justify-center p-4">
              <div
                className="relative w-full h-full flex items-center justify-center"
                style={{ transform: `scale(${zoom})`, transition: 'transform 0.2s' }}
              >
                <Image
                  src={data.imageUrl}
                  alt={data.description}
                  fill
                  className="object-contain"
                  sizes="(max-width: 1200px) 100vw, 1200px"
                  priority
                  unoptimized={!!data.bbox}
                />
              </div>
            </div>

            {/* Zoom controls */}
            <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-stone-900/80 rounded-lg p-1">
              <button
                onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                className="p-2 hover:bg-stone-700 rounded transition-colors"
                disabled={zoom <= 0.5}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs px-2">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                className="p-2 hover:bg-stone-700 rounded transition-colors"
                disabled={zoom >= 3}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Type badge */}
            {data.type && (
              <span className="absolute top-4 left-4 px-3 py-1 rounded-full text-sm bg-amber-600/90 text-white capitalize">
                {data.type}
              </span>
            )}
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

      {/* Fullscreen modal */}
      {showFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setShowFullscreen(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white"
            onClick={() => setShowFullscreen(false)}
          >
            <X className="w-8 h-8" />
          </button>
          <div className="relative w-full h-full p-8">
            <Image
              src={data.imageUrl}
              alt={data.description}
              fill
              className="object-contain"
              sizes="100vw"
              unoptimized={!!data.bbox}
            />
          </div>
        </div>
      )}
    </div>
  );
}
