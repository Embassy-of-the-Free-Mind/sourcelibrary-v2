/**
 * Gallery Image Viewer
 *
 * Full-viewport lightbox for browsing all images in a book.
 * Left/right arrows cycle through images. Metadata is collapsible.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
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
  Save,
  RotateCw,
  Info,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import LikeButton from '@/components/ui/LikeButton';
import { BookLoader } from '@/components/ui/BookLoader';
import { gallery } from '@/lib/api-client';
import type { GalleryImageDetail, ImageMetadata } from '@/lib/api-client';
import SimilarImages from '@/components/gallery/SimilarImages';
import { sendGAEvent } from '@/lib/ga';

interface BookImage {
  id: string;
  pageNumber: number;
  imageUrl: string;
  description: string;
  thumbnailUrl?: string;
}

export default function ImageDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [imageId, setImageId] = useState<string | null>(null);
  const [data, setData] = useState<GalleryImageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Admin editing state
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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [savingRotation, setSavingRotation] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [pageImageAspect, setPageImageAspect] = useState<string>('3/4');
  const [showInfo, setShowInfo] = useState(false);

  // Navigation state
  const [bookImages, setBookImages] = useState<BookImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [imageOpacity, setImageOpacity] = useState(1);

  // Ref to prevent stale closures in keyboard handler
  const navRef = useRef({ bookImages: [] as BookImage[], currentIndex: -1 });
  const isNavigatingRef = useRef(false);
  useEffect(() => {
    navRef.current = { bookImages, currentIndex };
  }, [bookImages, currentIndex]);

  // Resolve params
  useEffect(() => {
    params.then(p => setImageId(p.id));
  }, [params]);

  // Fetch image data (initial load only — navigation handles its own fetching)
  useEffect(() => {
    if (!imageId) return;
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    async function fetchImage() {
      try {
        const json = await gallery.get(imageId!);
        setData(json);
        // Preload image before showing
        const preload = new window.Image();
        preload.onload = () => requestAnimationFrame(() => setImageOpacity(1));
        preload.onerror = () => requestAnimationFrame(() => setImageOpacity(1));
        preload.src = json.imageUrl;
        sendGAEvent({ action: 'view_item', category: 'gallery', label: imageId!, content_type: 'image' });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchImage();
  }, [imageId]);

  // Initialize editing values when data loads
  useEffect(() => {
    if (data?.description) setTitleValue(data.description);
    if (data?.galleryQuality != null) setQualityValue(data.galleryQuality);
    if (data?.museumDescription) setMuseumDescValue(data.museumDescription);
    if (data?.metadata) setMetadataValues(data.metadata);
    if (data?.bbox) {
      const b = data.bbox;
      if (b.x > 1 || b.y > 1 || b.width > 10 || b.height > 10) {
        const scale = Math.max(b.x + b.width, b.y + b.height, 1000);
        setBboxValues({
          x: Math.min(b.x / scale, 0.95),
          y: Math.min(b.y / scale, 0.95),
          width: Math.min(b.width / scale, 1),
          height: Math.min(b.height / scale, 1),
        });
      } else {
        setBboxValues(b);
      }
    }
    if (data?.rotation != null) setRotation(data.rotation as 0 | 90 | 180 | 270);
  }, [data?.description, data?.galleryQuality, data?.museumDescription, data?.metadata, data?.bbox, data?.rotation]);

  // Fetch all images for this book (for navigation)
  useEffect(() => {
    if (!data?.book?.id) return;

    gallery.list({
      bookId: data.book.id,
      limit: 500,
      includeArchive: true,
      maxPerBook: 500,
      minQuality: 0,
    }).then(res => {
      const items: BookImage[] = res.items.map(item => ({
        id: `${item.pageId}-${item.detectionIndex}`,
        pageNumber: item.pageNumber,
        imageUrl: item.extractedUrl || item.imageUrl,
        description: item.description,
        thumbnailUrl: item.thumbnailUrl,
      }));
      // Sort by page number
      items.sort((a, b) => a.pageNumber - b.pageNumber);
      setBookImages(items);
      const idx = items.findIndex(img => img.id === imageId);
      setCurrentIndex(idx >= 0 ? idx : 0);
    });
  }, [data?.book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update currentIndex when imageId changes (after navigation)
  useEffect(() => {
    if (bookImages.length > 0 && imageId) {
      const idx = bookImages.findIndex(img => img.id === imageId);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [imageId, bookImages]);

  // Load natural aspect ratio for bbox editor
  useEffect(() => {
    if (!data?.fullPageUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setPageImageAspect(`${img.naturalWidth}/${img.naturalHeight}`);
      }
    };
    img.src = data.fullPageUrl;
  }, [data?.fullPageUrl]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const { bookImages: imgs, currentIndex: idx } = navRef.current;

      if (e.key === 'ArrowLeft' && idx > 0) {
        e.preventDefault();
        navigateTo(idx - 1);
      } else if (e.key === 'ArrowRight' && idx < imgs.length - 1) {
        e.preventDefault();
        navigateTo(idx + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation — fade out, preload next image, fade in only when ready
  const navigateTo = useCallback(async (index: number) => {
    if (index < 0 || index >= navRef.current.bookImages.length) return;
    const img = navRef.current.bookImages[index];

    // Fade out
    setImageOpacity(0);
    await new Promise(r => setTimeout(r, 280));

    // Update URL and reset editing state while screen is black
    setCurrentIndex(index);
    window.history.replaceState(null, '', `/gallery/image/${img.id}`);
    setEditingTitle(false);
    setEditingQuality(false);
    setEditingDescription(false);
    setEditingMetadata(false);
    setEditingBbox(false);
    setBrightness(100);
    setContrast(100);

    try {
      // Fetch new image data
      const json = await gallery.get(img.id);

      // Preload the actual image pixels before showing anything
      await new Promise<void>((resolve) => {
        const preload = new window.Image();
        preload.onload = () => resolve();
        preload.onerror = () => resolve();
        preload.src = json.imageUrl;
      });

      // Now update data and fade in — image is already cached
      isNavigatingRef.current = true;
      setImageId(img.id);
      setData(json);
      sendGAEvent({ action: 'view_item', category: 'gallery', label: img.id, content_type: 'image' });
      requestAnimationFrame(() => setImageOpacity(1));
    } catch {
      // On error, fade back in with old content
      setImageOpacity(1);
    }
  }, []);

  // Back navigation
  const handleBackClick = useCallback((e: React.MouseEvent) => {
    if (window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  }, [router]);

  // Save handlers (unchanged)
  const saveTitle = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await gallery.update(data.id, { description: titleValue });
      setData({ ...data, description: titleValue });
      setEditingTitle(false);
    } catch (e) {
      console.error('Failed to save title:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveQuality = async (newQuality: number) => {
    if (!data) return;
    setSaving(true);
    try {
      await gallery.update(data.id, { galleryQuality: newQuality });
      setData({ ...data, galleryQuality: newQuality });
      setEditingQuality(false);
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
      await gallery.update(data.id, { museumDescription: museumDescValue });
      setData({ ...data, museumDescription: museumDescValue });
      setEditingDescription(false);
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
      await gallery.update(data.id, { metadata: metadataValues });
      setData({ ...data, metadata: metadataValues });
      setEditingMetadata(false);
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
      const result = await gallery.update(data.id, { bbox: bboxValues });
      if (result.extractedUrl) {
        setData({
          ...data,
          bbox: bboxValues,
          imageUrl: result.extractedUrl,
          extractedUrl: result.extractedUrl,
          thumbnailUrl: result.thumbnailUrl,
        });
      } else {
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
      }
      setEditingBbox(false);
    } catch (e) {
      console.error('Failed to save bbox:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveRotation = async (newRotation: 0 | 90 | 180 | 270) => {
    if (!data) return;
    setRotation(newRotation);
    setSavingRotation(true);
    try {
      const result = await gallery.update(data.id, { rotation: newRotation });
      if (result.extractedUrl) {
        setData({ ...data, rotation: newRotation, imageUrl: result.extractedUrl, extractedUrl: result.extractedUrl, thumbnailUrl: result.thumbnailUrl });
      } else {
        setData({ ...data, rotation: newRotation });
      }
    } catch (e) {
      console.error('Failed to save rotation:', e);
      setRotation(data.rotation ?? 0);
    } finally {
      setSavingRotation(false);
    }
  };

  // Bbox drag handlers
  const handleBboxMouseDown = (e: React.MouseEvent, action: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
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

  // --- RENDER ---

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <BookLoader size="md" variant="dark" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">{error || 'Image not found'}</p>
          <Link href="/gallery" className="text-accent-gold hover:text-accent-gold">
            Back to Gallery
          </Link>
        </div>
      </div>
    );
  }

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < bookImages.length - 1;

  return (
    <div className="bg-black text-white">
      {/* Image viewer - fills viewport */}
      <div className="h-screen relative flex flex-col">
        {/* Minimal header */}
        <header className="flex-shrink-0 z-40 bg-black/80 backdrop-blur-sm border-b border-white/10">
          <div className="px-4 py-2 flex items-center justify-between">
            <Link
              href={data?.galleryUrl || '/gallery'}
              onClick={handleBackClick}
              className="flex items-center gap-2 text-stone-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline text-sm">Back</span>
            </Link>

            {/* Counter */}
            {bookImages.length > 1 && (
              <span className="text-stone-500 text-sm tabular-nums">
                {currentIndex + 1} / {bookImages.length}
              </span>
            )}

            <div className="flex items-center gap-1">
              {imageId && (
                <div className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                  <LikeButton
                    targetType="image"
                    targetId={imageId}
                    size="md"
                    showCount={true}
                  />
                </div>
              )}
              <button
                onClick={copyLink}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Copy link"
              >
                {copied ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4 text-stone-400" />}
              </button>
              <button
                onClick={shareToTwitter}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Share on X"
              >
                <Share2 className="w-4 h-4 text-stone-400" />
              </button>
            </div>
          </div>
        </header>

        {/* Image area - fills remaining viewport */}
        <div className="flex-1 relative min-h-0">
          {/* The image */}
          <div
            className="w-full h-full relative"
            style={{
              opacity: imageOpacity,
              transition: 'opacity 0.25s ease-in-out',
              filter: (brightness !== 100 || contrast !== 100)
                ? `brightness(${brightness}%) contrast(${contrast}%)`
                : undefined,
            }}
          >
            <div
              className="w-full h-full transition-transform duration-300"
              style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
            >
              <ImageWithMagnifier
                src={data.imageUrl}
                alt={data.description}
                className="w-full h-full"
                magnifierSize={250}
                zoomLevel={4}
                highResSrc={data.highResUrl}
                fallbackSrc={data.cropUrl || undefined}
                darkMode
              />
            </div>
          </div>

          {/* Type badge */}
          {data.type && (
            <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-xs bg-accent-rust/90 text-white capitalize z-10">
              {data.type}
            </span>
          )}

          {/* Brightness/contrast controls */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            {(brightness !== 100 || contrast !== 100) && (
              <button
                onClick={() => { setBrightness(100); setContrast(100); }}
                className="px-2 py-1 bg-black/70 rounded text-xs text-stone-400 hover:text-white transition-colors"
              >
                Reset
              </button>
            )}
            <div className="group relative">
              <button className="p-1.5 bg-black/70 rounded-lg text-stone-400 hover:text-white transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              </button>
              <div className="invisible group-hover:visible absolute right-0 top-full mt-2 p-3 bg-stone-900/95 backdrop-blur-sm rounded-lg shadow-xl min-w-[180px] space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-stone-400 mb-1">
                    <span>Brightness</span><span>{brightness}%</span>
                  </div>
                  <input type="range" min="50" max="200" value={brightness} onChange={(e) => setBrightness(parseInt(e.target.value))} className="w-full h-1.5 bg-stone-700 rounded appearance-none cursor-pointer accent-accent-gold" />
                </div>
                <div>
                  <div className="flex justify-between text-xs text-stone-400 mb-1">
                    <span>Contrast</span><span>{contrast}%</span>
                  </div>
                  <input type="range" min="50" max="200" value={contrast} onChange={(e) => setContrast(parseInt(e.target.value))} className="w-full h-1.5 bg-stone-700 rounded appearance-none cursor-pointer accent-accent-gold" />
                </div>
              </div>
            </div>
          </div>

          {/* Navigation arrows */}
          {hasPrev && (
            <button
              onClick={() => navigateTo(currentIndex - 1)}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 p-2 sm:p-3 rounded-full bg-black/50 hover:bg-black/80 text-white/70 hover:text-white transition-all"
              title="Previous image (Left arrow)"
            >
              <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
            </button>
          )}
          {hasNext && (
            <button
              onClick={() => navigateTo(currentIndex + 1)}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 p-2 sm:p-3 rounded-full bg-black/50 hover:bg-black/80 text-white/70 hover:text-white transition-all"
              title="Next image (Right arrow)"
            >
              <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
            </button>
          )}

          {/* Title + attribution overlay at bottom of image */}
          <div className="absolute bottom-0 left-0 right-0 z-20 px-5 pb-5 pt-24 bg-gradient-to-t from-black via-black/80 via-30% to-transparent">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-serif text-white leading-snug line-clamp-2">{data.description}</h1>
            <p className="text-base sm:text-lg text-white/60 mt-1.5">
              {data.book.title}{data.book.author ? ` \u2014 ${data.book.author}` : ''}{data.book.year ? ` (${data.book.year})` : ''} \u00b7 p.{data.pageNumber}
            </p>
          </div>
        </div>
      </div>

      {/* Details below the fold - always visible, scroll to see */}
      <div className="bg-stone-900 border-t border-white/10">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
            <div className="grid md:grid-cols-3 gap-8">
              {/* Left column: description + metadata */}
              <div className="md:col-span-2 space-y-6">
                {/* Title / Description */}
                <div>
                  {editingTitle ? (
                    <div className="space-y-3">
                      <textarea
                        value={titleValue}
                        onChange={(e) => setTitleValue(e.target.value)}
                        className="w-full p-3 bg-stone-800 text-stone-100 text-2xl font-serif rounded-lg resize-none focus:outline-none focus:ring-2 focus-visible:ring-accent-rust leading-relaxed"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button onClick={saveTitle} disabled={saving} className="px-4 py-1.5 bg-accent-rust hover:bg-accent-gold/80 rounded text-sm transition-colors disabled:opacity-50">
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => { setTitleValue(data.description); setEditingTitle(false); }} className="px-4 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="group relative">
                      <h1 className="text-2xl sm:text-3xl font-serif text-stone-100 leading-relaxed pr-12">
                        {data.description}
                      </h1>
                      <button onClick={() => setEditingTitle(true)} className="absolute top-0 right-0 text-xs text-accent-gold hover:text-accent-gold opacity-0 group-hover:opacity-100 transition-opacity">
                        Edit
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-3 flex-wrap">
                    {data.model && (
                      <p className="text-sm text-stone-500 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        {data.model}
                        {data.confidence ? ` (${Math.round(data.confidence * 100)}%)` : ''}
                      </p>
                    )}
                    <button
                      onClick={() => setShowInfo(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-sm bg-stone-700 hover:bg-stone-600 text-stone-400 hover:text-stone-300 transition-colors"
                    >
                      <Info className="w-3.5 h-3.5" />
                      Info
                    </button>
                  </div>
                </div>

                {/* Museum Description */}
                <div className="bg-stone-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300">Museum Description</h3>
                    {!editingDescription && (
                      <button onClick={() => setEditingDescription(true)} className="text-sm text-accent-gold hover:text-accent-gold">Edit</button>
                    )}
                  </div>
                  {editingDescription ? (
                    <div className="space-y-3">
                      <textarea
                        value={museumDescValue}
                        onChange={(e) => setMuseumDescValue(e.target.value)}
                        className="w-full h-28 p-3 bg-stone-700 text-stone-200 rounded text-base resize-none focus:outline-none focus:ring-1 focus-visible:ring-accent-rust leading-relaxed"
                        placeholder="Write a 2-3 sentence museum-style description..."
                      />
                      <div className="flex gap-2">
                        <button onClick={saveMuseumDescription} disabled={saving} className="flex-1 py-2 bg-accent-rust hover:bg-accent-gold/80 rounded text-sm transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => { setMuseumDescValue(data.museumDescription || ''); setEditingDescription(false); }} className="px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-stone-300 text-base leading-relaxed">
                      {data.museumDescription || <span className="text-stone-500 italic">No description yet</span>}
                    </p>
                  )}
                </div>

                {/* Gallery Quality */}
                <div className="bg-stone-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300">Gallery Quality</h3>
                    <span className="text-sm text-stone-500">Guide cutoff: 0.75</span>
                  </div>
                  {editingQuality ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <input type="range" min="0" max="1" step="0.05" value={qualityValue} onChange={(e) => setQualityValue(parseFloat(e.target.value))} className="flex-1 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-accent-gold" />
                        <span className="text-lg font-mono text-accent-gold w-12 text-right">{qualityValue.toFixed(2)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveQuality(qualityValue)} disabled={saving} className="flex-1 py-1.5 bg-accent-rust hover:bg-accent-gold/80 rounded text-sm transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => { setQualityValue(data.galleryQuality ?? 0); setEditingQuality(false); }} className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-32 h-2 bg-stone-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${(data.galleryQuality ?? 0) >= 0.75 ? 'bg-status-success' : (data.galleryQuality ?? 0) >= 0.5 ? 'bg-accent-gold/80' : 'bg-status-error'}`}
                            style={{ width: `${(data.galleryQuality ?? 0) * 100}%` }}
                          />
                        </div>
                        <span className={`text-lg font-mono ${(data.galleryQuality ?? 0) >= 0.75 ? 'text-status-success' : (data.galleryQuality ?? 0) >= 0.5 ? 'text-accent-gold' : 'text-status-error'}`}>
                          {data.galleryQuality != null ? data.galleryQuality.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                      <button onClick={() => setEditingQuality(true)} className="text-xs text-accent-gold hover:text-accent-gold">Adjust</button>
                    </div>
                  )}
                  {data.galleryRationale && <p className="text-xs text-stone-500 mt-2 italic">{data.galleryRationale}</p>}
                </div>

                {/* Metadata Tags */}
                <div className="bg-stone-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300">Metadata</h3>
                    {!editingMetadata && (
                      <button onClick={() => setEditingMetadata(true)} className="text-sm text-accent-gold hover:text-accent-gold">Edit</button>
                    )}
                  </div>
                  {editingMetadata ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-stone-500 block mb-1">Subjects (comma-separated)</label>
                        <input type="text" value={metadataValues.subjects?.join(', ') || ''} onChange={(e) => setMetadataValues(prev => ({ ...prev, subjects: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus-visible:ring-accent-rust" placeholder="alchemy, transformation, mythology" />
                      </div>
                      <div>
                        <label className="text-xs text-stone-500 block mb-1">Figures (comma-separated)</label>
                        <input type="text" value={metadataValues.figures?.join(', ') || ''} onChange={(e) => setMetadataValues(prev => ({ ...prev, figures: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus-visible:ring-accent-rust" placeholder="Mercury, old man, serpent" />
                      </div>
                      <div>
                        <label className="text-xs text-stone-500 block mb-1">Symbols (comma-separated)</label>
                        <input type="text" value={metadataValues.symbols?.join(', ') || ''} onChange={(e) => setMetadataValues(prev => ({ ...prev, symbols: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus-visible:ring-accent-rust" placeholder="ouroboros, athanor, philosophical egg" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-stone-500 block mb-1">Style</label>
                          <input type="text" value={metadataValues.style || ''} onChange={(e) => setMetadataValues(prev => ({ ...prev, style: e.target.value }))} className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus-visible:ring-accent-rust" placeholder="Northern European Renaissance" />
                        </div>
                        <div>
                          <label className="text-xs text-stone-500 block mb-1">Technique</label>
                          <input type="text" value={metadataValues.technique || ''} onChange={(e) => setMetadataValues(prev => ({ ...prev, technique: e.target.value }))} className="w-full p-2 bg-stone-700 text-stone-200 rounded text-sm focus:outline-none focus:ring-1 focus-visible:ring-accent-rust" placeholder="woodcut, engraving" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveMetadata} disabled={saving} className="flex-1 py-1.5 bg-accent-rust hover:bg-accent-gold/80 rounded text-sm transition-colors disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => { setMetadataValues(data.metadata || {}); setEditingMetadata(false); }} className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 rounded text-sm transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5 text-base">
                      {metadataValues.subjects && metadataValues.subjects.length > 0 && (
                        <div><span className="text-stone-500">Subjects: </span><span className="text-stone-300">{metadataValues.subjects.join(', ')}</span></div>
                      )}
                      {metadataValues.figures && metadataValues.figures.length > 0 && (
                        <div><span className="text-stone-500">Figures: </span><span className="text-stone-300">{metadataValues.figures.join(', ')}</span></div>
                      )}
                      {metadataValues.symbols && metadataValues.symbols.length > 0 && (
                        <div><span className="text-stone-500">Symbols: </span><span className="text-stone-300">{metadataValues.symbols.join(', ')}</span></div>
                      )}
                      {metadataValues.style && (
                        <div><span className="text-stone-500">Style: </span><span className="text-stone-300">{metadataValues.style}</span></div>
                      )}
                      {metadataValues.technique && (
                        <div><span className="text-stone-500">Technique: </span><span className="text-stone-300">{metadataValues.technique}</span></div>
                      )}
                      {!metadataValues.subjects?.length && !metadataValues.figures?.length && !metadataValues.symbols?.length && !metadataValues.style && !metadataValues.technique && (
                        <p className="text-stone-500 italic">No metadata yet</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Bounding Box Editor */}
                {data.bbox && data.fullPageUrl && (
                  <div className="bg-stone-800 rounded-lg p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-medium text-stone-300 flex items-center gap-2"><Crop className="w-4 h-4" />Bounding Box</h3>
                      {!editingBbox ? (
                        <div className="flex gap-2">
                          <button onClick={() => setEditingBbox(true)} className="text-xs text-accent-gold hover:text-accent-gold">Edit Crop</button>
                          <button onClick={() => { setBboxValues({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }); setEditingBbox(true); }} className="text-xs text-stone-500 hover:text-stone-400">Reset</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button onClick={saveBbox} disabled={saving} className="flex items-center gap-1 px-2 py-1 bg-accent-rust hover:bg-accent-gold/80 rounded text-xs transition-colors disabled:opacity-50"><Save className="w-3 h-3" />{saving ? 'Saving...' : 'Save'}</button>
                          <button onClick={() => setBboxValues({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })} className="px-2 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs transition-colors">Reset</button>
                          <button onClick={() => { setBboxValues(data.bbox || { x: 0, y: 0, width: 1, height: 1 }); setEditingBbox(false); }} className="px-2 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs transition-colors">Cancel</button>
                        </div>
                      )}
                    </div>
                    {editingBbox ? (
                      <div className="space-y-3">
                        <p className="text-xs text-stone-500">Drag the box to move, drag the corner to resize</p>
                        <div
                          className="relative bg-stone-900 rounded overflow-hidden cursor-crosshair select-none"
                          style={{ aspectRatio: pageImageAspect }}
                          onMouseDown={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = (e.clientX - rect.left) / rect.width;
                            const y = (e.clientY - rect.top) / rect.height;
                            setBboxValues(prev => ({
                              ...prev,
                              x: Math.max(0, Math.min(1 - prev.width, x - prev.width / 2)),
                              y: Math.max(0, Math.min(1 - prev.height, y - prev.height / 2))
                            }));
                            setIsDragging('move');
                            setDragStart({ x: e.clientX, y: e.clientY });
                            e.preventDefault();
                          }}
                          onMouseMove={(e) => { handleBboxMouseMove(e, e.currentTarget.getBoundingClientRect()); }}
                          onMouseUp={handleBboxMouseUp}
                          onMouseLeave={handleBboxMouseUp}
                        >
                          <Image src={data.fullPageUrl} alt="Full page" fill sizes="(max-width: 768px) 90vw, 80vw" className="object-contain pointer-events-none" onDragStart={(e) => e.preventDefault()} unoptimized />
                          <div className="absolute inset-0 bg-black/60 pointer-events-none" style={{
                            clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${bboxValues.x * 100}% ${bboxValues.y * 100}%, ${bboxValues.x * 100}% ${(bboxValues.y + bboxValues.height) * 100}%, ${(bboxValues.x + bboxValues.width) * 100}% ${(bboxValues.y + bboxValues.height) * 100}%, ${(bboxValues.x + bboxValues.width) * 100}% ${bboxValues.y * 100}%, ${bboxValues.x * 100}% ${bboxValues.y * 100}%)`
                          }} />
                          <div className="absolute border-2 border-accent-gold cursor-move" style={{ left: `${bboxValues.x * 100}%`, top: `${bboxValues.y * 100}%`, width: `${bboxValues.width * 100}%`, height: `${bboxValues.height * 100}%` }} onMouseDown={(e) => handleBboxMouseDown(e, 'move')}>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Move className="w-6 h-6 text-accent-gold opacity-50" /></div>
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-accent-gold/80 rounded-sm cursor-se-resize" onMouseDown={(e) => { e.stopPropagation(); handleBboxMouseDown(e, 'resize'); }} />
                          </div>
                        </div>
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

                {/* Rotation Control */}
                <div className="bg-stone-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300 flex items-center gap-2"><RotateCw className="w-4 h-4" />Rotation</h3>
                    {savingRotation && <span className="text-sm text-accent-gold">Saving...</span>}
                  </div>
                  <div className="flex gap-2">
                    {([0, 90, 180, 270] as const).map((deg) => (
                      <button key={deg} onClick={() => saveRotation(deg)} disabled={savingRotation} className={`flex-1 py-2 rounded text-base transition-colors ${rotation === deg ? 'bg-accent-rust text-white' : 'bg-stone-700 text-stone-300 hover:bg-stone-600'} disabled:opacity-50`}>
                        {deg}&deg;
                      </button>
                    ))}
                  </div>
                </div>

                {/* Citation */}
                <div className="bg-stone-800 rounded-lg p-5">
                  <h3 className="text-base font-medium text-stone-300 mb-2">Cite this image</h3>
                  <p className="text-stone-300 text-base font-mono leading-relaxed">{data.citation}</p>
                  <button onClick={copyCitation} className="mt-3 text-sm text-accent-gold hover:text-accent-gold flex items-center gap-1.5">
                    <Copy className="w-4 h-4" />Copy citation
                  </button>
                </div>
              </div>

              {/* Right column: book card + similar */}
              <div className="space-y-5">
                <div className="bg-stone-800 rounded-lg overflow-hidden">
                  <Link href={data.readUrl} className="block group">
                    {data.book.thumbnail && (
                      <div className="relative w-full aspect-[3/4] bg-stone-900">
                        <Image src={data.book.thumbnail} alt={data.book.title} fill sizes="(max-width: 768px) 90vw, 300px" className="object-cover group-hover:opacity-90 transition-opacity" unoptimized />
                      </div>
                    )}
                    <div className="p-5">
                      <p className="text-lg text-white font-medium group-hover:text-accent-gold transition-colors">{data.book.title}</p>
                      {data.book.author && <p className="text-stone-400 text-base mt-1">{data.book.author}</p>}
                      {data.book.year && <p className="text-stone-500 text-base">{data.book.year}</p>}
                    </div>
                  </Link>
                  <div className="px-5 pb-5">
                    <Link href={data.readUrl} className="flex items-center justify-center gap-2 py-3 px-4 bg-accent-rust hover:bg-accent-rust/80 text-white rounded-lg transition-colors font-medium text-base">
                      <BookOpen className="w-5 h-5" />Read page {data.pageNumber} in context
                    </Link>
                  </div>
                </div>

                <Link href={data.galleryUrl} className="block text-center py-3 px-4 bg-stone-800 hover:bg-stone-700 rounded-lg text-base transition-colors">
                  More from this book
                </Link>

                {imageId && <SimilarImages imageId={imageId} />}
              </div>
            </div>
          </div>
        </div>

      {/* Processing Info Modal */}
      {showInfo && data && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-stone-800 rounded-xl max-w-md w-full shadow-2xl border border-stone-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-stone-700">
              <h3 className="text-white font-medium flex items-center gap-2"><Info className="w-4 h-4 text-stone-400" />Processing Info</h3>
              <button onClick={() => setShowInfo(false)} className="text-stone-400 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Extraction Model</p>
                <div className="flex items-center gap-2">
                  <p className="text-stone-200 text-sm">{data.model || 'Unknown'}</p>
                  {data.model === 'gemini-3-flash-preview' ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-status-success/15 text-status-success">Current</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning">Outdated</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Detection Source</p>
                <p className="text-stone-200 text-sm">
                  {data.detectionSource === 'vision_model' && 'Vision model (dedicated image extraction)'}
                  {data.detectionSource === 'ocr_tag' && 'OCR tag (detected during text extraction)'}
                  {data.detectionSource === 'manual' && 'Manually added'}
                  {!data.detectionSource && 'Unknown'}
                </p>
              </div>
              {data.confidence != null && (
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Confidence</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-stone-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-accent-gold" style={{ width: `${Math.round(data.confidence * 100)}%` }} />
                    </div>
                    <span className="text-stone-300 text-sm font-mono w-10 text-right">{Math.round(data.confidence * 100)}%</span>
                  </div>
                </div>
              )}
              {data.galleryQuality != null && (
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Gallery Quality</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-stone-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round(data.galleryQuality * 100)}%`, backgroundColor: data.galleryQuality >= 0.75 ? 'var(--status-success)' : data.galleryQuality >= 0.5 ? 'var(--accent-gold)' : 'var(--status-error)' }} />
                    </div>
                    <span className="text-stone-300 text-sm font-mono w-10 text-right">{data.galleryQuality.toFixed(2)}</span>
                  </div>
                </div>
              )}
              {data.galleryRationale && (
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Quality Rationale</p>
                  <p className="text-stone-300 text-sm leading-relaxed">{data.galleryRationale}</p>
                </div>
              )}
              {data.type && (
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Image Type</p>
                  <p className="text-stone-200 text-sm capitalize">{data.type}</p>
                </div>
              )}
              {data.featured && (
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent-gold" />
                  <p className="text-accent-gold text-sm">Featured image</p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-stone-700">
              <button onClick={() => setShowInfo(false)} className="w-full py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-stone-300 text-sm transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
