/**
 * Gallery Image Viewer
 *
 * Full-viewport lightbox for browsing all images in a book.
 * Left/right arrows cycle through images. Metadata is collapsible.
 */

'use client';

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ProseField from '@/components/ui/ProseField';
import {
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
  ChevronRight,
  Download,
  Loader2,
  Eye,
  Search
} from 'lucide-react';
import ImageWithMagnifier from '@/components/ui/ImageWithMagnifier';
import LikeButton from '@/components/ui/LikeButton';
import AiBadge, { formatModelName } from '@/components/ui/AiBadge';
import { BookLoader } from '@/components/ui/BookLoader';
import { gallery, views } from '@/lib/api-client';
import { getBookThumbnailUrl } from '@/lib/utils';
import type { GalleryImageDetail, GalleryItem, ImageMetadata } from '@/lib/api-client';
import SimilarImages from '@/components/gallery/SimilarImages';
// Deep zoom pulls in OpenSeadragon — lazy so its weight only lands when a
// reader actually opens the tiled viewer (#2714).
const DeepZoomOverlay = lazy(() => import('@/components/artwork/DeepZoomOverlay'));
import { useSession } from 'next-auth/react';
import { sendGAEvent } from '@/lib/ga';
import { trackEvent } from '@/lib/track-event';
import { toast } from 'sonner';

/** In-memory cache for prefetched gallery image API responses */
const prefetchCache = new Map<string, Promise<GalleryImageDetail>>();

function prefetchApiResponse(id: string) {
  if (prefetchCache.has(id)) return;
  const promise = gallery.get(id).then(detail => {
    const img = new window.Image();
    img.src = detail.imageUrl;
    return detail;
  });
  prefetchCache.set(id, promise);
  setTimeout(() => prefetchCache.delete(id), 120000);
}

async function getCachedOrFetch(id: string): Promise<GalleryImageDetail> {
  const cached = prefetchCache.get(id);
  if (cached) return cached;
  const promise = gallery.get(id);
  prefetchCache.set(id, promise);
  return promise;
}

export default function ImageDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;
  const isAdmin = userRole === 'admin' || userRole === 'inner_circle';
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
  const [deepZoomOpen, setDeepZoomOpen] = useState(false);
  const [pageImageAspect, setPageImageAspect] = useState<string>('3/4');
  const [showInfo, setShowInfo] = useState(false);

  // Navigation state
  const [bookImageIds, setBookImageIds] = useState<string[]>([]);
  const [bookThumbnails, setBookThumbnails] = useState<Map<string, { thumb: string; desc: string }>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [imageOpacity, setImageOpacity] = useState(1);

  // Collection scope for prev/next navigation. When the viewer is opened from a
  // collection (via ?collection=<book-collection-slug> from the /gallery listing,
  // or ?gcollection=<gallery-collection-slug> from a curated gallery collection),
  // the prev/next list is built from that collection's image set instead of every
  // image in the book. This mirrors the artwork fix (PR #2363) so paging left/right
  // stays inside the set the reader is browsing. When neither is present, navigation
  // stays book-scoped (unchanged).
  const [collectionScope, setCollectionScope] = useState<{ collection?: string; gcollection?: string } | null>(null);
  const collectionQuery = collectionScope?.collection
    ? `?collection=${encodeURIComponent(collectionScope.collection)}`
    : collectionScope?.gcollection
    ? `?gcollection=${encodeURIComponent(collectionScope.gcollection)}`
    : '';
  useEffect(() => {
    collectionQueryRef.current = collectionQuery;
  }, [collectionQuery]);

  // Ref to prevent stale closures in keyboard handler
  const navRef = useRef({ bookImageIds: [] as string[], currentIndex: -1 });
  const isNavigatingRef = useRef(false);
  useEffect(() => {
    navRef.current = { bookImageIds, currentIndex };
  }, [bookImageIds, currentIndex]);

  // Ref so the (empty-deps) navigateTo callback always reads the live collection query.
  const collectionQueryRef = useRef('');

  // Resolve params
  useEffect(() => {
    params.then(p => setImageId(p.id));
  }, [params]);

  // Read collection scope from the URL once on mount (kept stable across in-page
  // navigation, which only mutates the path via replaceState — see navigateTo).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const collection = sp.get('collection') || undefined;
    const gcollection = sp.get('gcollection') || undefined;
    if (collection || gcollection) setCollectionScope({ collection, gcollection });
  }, []);

  // Fetch image data (initial load only — navigation handles its own fetching)
  useEffect(() => {
    if (!imageId) return;
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    async function fetchImage() {
      try {
        const json = await getCachedOrFetch(imageId!);
        setData(json);
        // Preload image before showing
        const preload = new window.Image();
        preload.onload = () => requestAnimationFrame(() => setImageOpacity(1));
        preload.onerror = () => requestAnimationFrame(() => setImageOpacity(1));
        preload.src = json.imageUrl;
        sendGAEvent({ action: 'view_item', category: 'gallery', label: imageId!, content_type: 'image' });
        views.record('image', imageId!);
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

  // Fetch the prev/next navigation list. Default scope is "all images in this book"
  // (sorted by page number). When opened from a collection, scope to that collection's
  // image set instead, preserving its native ordering so paging stays inside the set
  // the reader is browsing (mirrors the artwork fix, PR #2363).
  useEffect(() => {
    // Collection-scoped navigation doesn't depend on the loaded book, so it can run
    // as soon as the scope is known. Book-scoped navigation waits for the book id.
    if (!collectionScope && !data?.book?.id) return;

    let cancelled = false;

    async function loadNav(): Promise<{
      ids: string[];
      thumbs: Map<string, { thumb: string; desc: string }>;
    }> {
      // Curated gallery collection (ordered image_ids list) — use its own ordering.
      if (collectionScope?.gcollection) {
        const coll = await gallery.collections.get(collectionScope.gcollection);
        const items = (coll?.items || []) as Array<{
          id: string;
          thumbnailUrl?: string;
          extractedUrl?: string;
          imageUrl?: string;
          description?: string;
        }>;
        const ids = items.map(item => item.id);
        const thumbs = new Map<string, { thumb: string; desc: string }>();
        items.forEach(item => {
          thumbs.set(item.id, {
            thumb: item.thumbnailUrl || item.extractedUrl || item.imageUrl || '',
            desc: item.description || '',
          });
        });
        return { ids, thumbs };
      }

      // Book-collection slug — same source the /gallery listing uses; keep the API's
      // native ordering (quality, year, book, page) rather than re-sorting by page,
      // since a collection can span multiple books.
      const res = await gallery.list({
        collection: collectionScope?.collection,
        bookId: collectionScope ? undefined : data!.book.id,
        limit: 500,
        includeArchive: true,
        maxPerBook: 500,
        minQuality: 0,
      });
      // Book scope keeps its original page-number ordering for backward compatibility.
      const items = collectionScope
        ? res.items
        : [...res.items].sort((a, b) => a.pageNumber - b.pageNumber);
      const ids = items.map(item => `${item.pageId}-${item.detectionIndex}`);
      const thumbs = new Map<string, { thumb: string; desc: string }>();
      items.forEach(item => {
        const id = `${item.pageId}-${item.detectionIndex}`;
        thumbs.set(id, { thumb: item.thumbnailUrl || item.extractedUrl || item.imageUrl, desc: item.description });
      });
      return { ids, thumbs };
    }

    loadNav().then(({ ids, thumbs }) => {
      if (cancelled) return;
      // If the current image isn't in the scoped set (e.g. a stale link), fall back to
      // book scope so navigation still works rather than showing a single-image set.
      if (collectionScope && imageId && !ids.includes(imageId) && data?.book?.id) {
        setCollectionScope(null);
        return;
      }
      setBookImageIds(ids);
      setBookThumbnails(thumbs);
      const idx = ids.indexOf(imageId!);
      setCurrentIndex(idx >= 0 ? idx : 0);
    }).catch((err) => {
      if (cancelled) return;
      // A missing/deleted collection (e.g. a stale ?gcollection= link that 404s) must
      // not break the viewer. Drop to book scope so book-wide prev/next still works.
      if (collectionScope && data?.book?.id) {
        setCollectionScope(null);
        return;
      }
      console.error('Failed to load gallery navigation:', err);
    });

    return () => { cancelled = true; };
  }, [data?.book?.id, collectionScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update currentIndex when imageId changes (after navigation)
  useEffect(() => {
    if (bookImageIds.length > 0 && imageId) {
      const idx = bookImageIds.indexOf(imageId);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [imageId, bookImageIds]);

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

  // Prefetch next image's API response (delayed to avoid competing with current load)
  useEffect(() => {
    if (bookImageIds.length === 0 || currentIndex < 0) return;
    const timer = setTimeout(() => {
      // Prefetch next (most common navigation direction)
      if (currentIndex < bookImageIds.length - 1) prefetchApiResponse(bookImageIds[currentIndex + 1]);
      // Prefetch prev after a longer delay
      if (currentIndex > 0) prefetchApiResponse(bookImageIds[currentIndex - 1]);
    }, 500);
    return () => clearTimeout(timer);
  }, [currentIndex, bookImageIds]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const { bookImageIds: imgs, currentIndex: idx } = navRef.current;

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

  // Navigation — fade out, fetch from prefetch cache, preload pixels, fade in
  const navigateTo = useCallback(async (index: number) => {
    if (index < 0 || index >= navRef.current.bookImageIds.length) return;
    const imgId = navRef.current.bookImageIds[index];

    // Fade out
    setImageOpacity(0);
    await new Promise(r => setTimeout(r, 280));

    // Update URL and reset editing state while screen is black. Preserve the collection
    // scope query param so a reload / share keeps prev/next inside the collection.
    setCurrentIndex(index);
    window.history.replaceState(null, '', `/gallery/image/${imgId}${collectionQueryRef.current}`);
    setEditingTitle(false);
    setEditingQuality(false);
    setEditingDescription(false);
    setEditingMetadata(false);
    setEditingBbox(false);
    setBrightness(100);
    setContrast(100);

    try {
      // Fetch from prefetch cache (usually already resolved)
      const json = await getCachedOrFetch(imgId);

      // Preload the actual image (gallery uses thumbnail={src} to bypass proxy)
      await new Promise<void>((resolve) => {
        const preload = new window.Image();
        preload.onload = () => resolve();
        preload.onerror = () => resolve();
        preload.src = json.imageUrl;
      });

      // Now update data and fade in — image is already in browser cache
      isNavigatingRef.current = true;
      setImageId(imgId);
      setData(json);
      sendGAEvent({ action: 'view_item', category: 'gallery', label: imgId, content_type: 'image' });
      views.record('image', imgId);
      requestAnimationFrame(() => setImageOpacity(1));
    } catch {
      // On error, fade back in with old content
      setImageOpacity(1);
    }
  }, []);


  // Save handlers (unchanged)
  const saveTitle = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      await gallery.update(data.id, { description: titleValue });
      prefetchCache.delete(data.id);
      setData({ ...data, description: titleValue });
      setEditingTitle(false);
    } catch (e) {
      console.error('Failed to save title:', e);
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveQuality = async (newQuality: number) => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      await gallery.update(data.id, { galleryQuality: newQuality });
      // Invalidate the prefetch cache for this image so a soft-nav back
      // doesn't resolve to the pre-edit promise.
      prefetchCache.delete(data.id);
      setData({ ...data, galleryQuality: newQuality });
      setEditingQuality(false);
    } catch (e) {
      console.error('Failed to save quality:', e);
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveType = async (newType: string) => {
    if (!data || newType === data.type) return;
    setSaving(true);
    setError(null);
    try {
      await gallery.update(data.id, { type: newType });
      prefetchCache.delete(data.id);
      setData({ ...data, type: newType });
    } catch (e) {
      console.error('Failed to save type:', e);
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveMuseumDescription = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      await gallery.update(data.id, { museumDescription: museumDescValue });
      prefetchCache.delete(data.id);
      setData({ ...data, museumDescription: museumDescValue });
      setEditingDescription(false);
    } catch (e) {
      console.error('Failed to save description:', e);
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveMetadata = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      await gallery.update(data.id, { metadata: metadataValues });
      prefetchCache.delete(data.id);
      setData({ ...data, metadata: metadataValues });
      setEditingMetadata(false);
    } catch (e) {
      console.error('Failed to save metadata:', e);
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveBbox = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const result = await gallery.update(data.id, { bbox: bboxValues });
      prefetchCache.delete(data.id);
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
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveRotation = async (newRotation: 0 | 90 | 180 | 270) => {
    if (!data) return;
    setRotation(newRotation);
    setSavingRotation(true);
    setError(null);
    try {
      const result = await gallery.update(data.id, { rotation: newRotation });
      prefetchCache.delete(data.id);
      if (result.extractedUrl) {
        setData({ ...data, rotation: newRotation, imageUrl: result.extractedUrl, extractedUrl: result.extractedUrl, thumbnailUrl: result.thumbnailUrl });
      } else {
        setData({ ...data, rotation: newRotation });
      }
    } catch (e) {
      console.error('Failed to save rotation:', e);
      setError(e instanceof Error ? `Save failed: ${e.message}` : 'Save failed');
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

  const isMember = (session?.user as any)?.membership != null;
  const [imagePurchased, setImagePurchased] = useState(false);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);

  // Check if payments are enabled
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(cfg => {
      setPaymentsEnabled(!!cfg.payments);
    }).catch(() => { });
  }, []);

  // Check if user has purchased this specific image
  useEffect(() => {
    if (!paymentsEnabled || isMember || !session?.user || !imageId) return;
    fetch(`/api/access?type=image&itemId=${imageId}`)
      .then(r => r.json())
      .then(d => { if (d.allowed) setImagePurchased(true); })
      .catch(() => { });
  }, [paymentsEnabled, isMember, session, imageId]);

  // Also check after returning from purchase
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('purchased') === 'true') {
      setImagePurchased(true);
    }
  }, []);

  // No payments = everyone can download; payments on = need membership or purchase
  const canDownloadImage = !paymentsEnabled || isMember || imagePurchased;

  const purchaseImage = async () => {
    if (!data || !imageId) return;
    if (!session?.user) {
      window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    try {
      const res = await fetch('/api/stripe/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'image',
          itemId: imageId,
          itemName: data.description?.slice(0, 60) || imageId,
          returnUrl: window.location.pathname,
        }),
      });
      const result = await res.json();
      if (result.url) window.location.href = result.url;
    } catch {
      // Ignore
    }
  };

  const [downloading, setDownloading] = useState(false);

  /**
   * Save a blob under a real filename.
   *
   * The anchor goes into the document and the object URL is revoked on a later
   * tick: a detached anchor plus an immediate revoke is a race the browser
   * sometimes loses, and losing it looks exactly like a dead button.
   */
  const saveBlob = (blob: Blob, suffix?: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const bookSlug = data!.book.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
    a.download = `source-library-${bookSlug}-p${data!.pageNumber}${suffix || ''}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /**
   * Fetch an image for download, cross-origin included.
   *
   * Our own images live on images.sourcelibrary.org, which is a DIFFERENT
   * ORIGIN from the page. That fetch needs two permissions and had neither
   * until 2026-09-03: the bucket must send `Access-Control-Allow-Origin` (now
   * set on R2) and our CSP must list the host in `connect-src` (now in
   * next.config.ts). Both buttons therefore threw on every click, and the
   * `window.open` fallback ran after an `await` — no longer a user gesture, so
   * the popup blocker ate it and nothing at all happened (#4630, Corey, 2026-09-03).
   *
   * The /api/image proxy is the belt-and-braces path: same-origin, so it works
   * whatever the CDN is sending today. It re-encodes and stamps the visible
   * provenance mark, so it is a fallback, not the default.
   */
  const fetchImageBlob = async (sourceUrl: string, proxyWidth: number): Promise<Blob> => {
    const sameOrigin = (() => {
      try {
        return new URL(sourceUrl, window.location.href).origin === window.location.origin;
      } catch {
        return false;
      }
    })();

    if (sameOrigin) {
      const res = await fetch(sourceUrl);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return res.blob();
    }

    try {
      const direct = await fetch(sourceUrl, { mode: 'cors' });
      // An error body must never be saved as a .jpg — that is how a download
      // becomes a file that "won't open" (DownloadButton, 2026-07-02).
      if (direct.ok) return await direct.blob();
    } catch {
      // CORS or CSP refused it; fall through to the same-origin proxy.
    }

    const proxied = await fetch(
      `/api/image?url=${encodeURIComponent(sourceUrl)}&w=${proxyWidth}&q=90`,
    );
    if (!proxied.ok) throw new Error(`Download failed (${proxied.status})`);
    return proxied.blob();
  };

  const downloadImage = async () => {
    if (!data || !imageId) return;
    if (!canDownloadImage) { purchaseImage(); return; }

    // Quick download: use existing extracted image
    const sourceUrl = data.extractedUrl || data.highResUrl || data.imageUrl;

    try {
      saveBlob(await fetchImageBlob(sourceUrl, 2000));
      sendGAEvent({ action: 'gallery_download', label: imageId || undefined });
    } catch {
      toast.error('Download failed — please try again.');
    }
  };

  const downloadHighRes = async () => {
    if (!data || !imageId) return;
    if (!canDownloadImage) { purchaseImage(); return; }

    setDownloading(true);
    try {
      const hiresRes = await fetch(`/api/gallery/image/${imageId}/hires`);
      if (!hiresRes.ok) throw new Error('High-res generation failed');
      const { url } = await hiresRes.json();
      saveBlob(await fetchImageBlob(url, 4000), '-hires');
      sendGAEvent({ action: 'gallery_download_hires', label: imageId || undefined });
    } catch {
      // Fall back to standard download, which reports its own failure.
      await downloadImage();
    } finally {
      setDownloading(false);
    }
  };

  const shareToTwitter = () => {
    if (!data) return;
    const displayAuthor = data.book.author && data.book.author !== 'Various' ? data.book.author : '';
    const text = `${data.description}\n\nFrom "${data.book.title}"${displayAuthor ? ` by ${displayAuthor}` : ''}${data.book.year ? ` (${data.book.year})` : ''}\n\n`;
    const url = window.location.href;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      '_blank'
    );
    trackEvent('share', { channel: 'twitter', url, surface: 'gallery_image' });
  };

  const shareToPinterest = () => {
    if (!data) return;
    const imageUrl = data.extractedUrl || data.imageUrl;
    const pageUrl = window.location.href;
    const desc = `${data.description} — From "${data.book.title}"${data.book.year ? ` (${data.book.year})` : ''} via Source Library`;
    window.open(
      `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&media=${encodeURIComponent(imageUrl)}&description=${encodeURIComponent(desc)}`,
      '_blank',
      'width=750,height=550'
    );
    trackEvent('share', { channel: 'pinterest', url: pageUrl, surface: 'gallery_image' });
  };

  const shareNative = async () => {
    if (!data || !navigator.share) return;
    const url = window.location.href;
    try {
      await navigator.share({
        title: `${data.description} — Source Library`,
        text: `From "${data.book.title}"${data.book.author && data.book.author !== 'Various' ? ` by ${data.book.author}` : ''}`,
        url,
      });
      // Only counted once the share sheet resolves — a cancel throws and is not a share.
      trackEvent('share', { channel: 'native', url, surface: 'gallery_image' });
    } catch {
      // User cancelled or not supported
    }
  };

  // --- RENDER ---

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <BookLoader size="md" variant="light" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <p className="text-xl mb-4">{error || 'Image not found'}</p>
          <Link href={`/gallery`} className="text-accent-gold hover:text-accent-gold">
            Back to Gallery
          </Link>
        </div>
      </div>
    );
  }

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < bookImageIds.length - 1;

  // AI provenance: title, museum description, and Details metadata are all
  // generated by a vision model (recorded per-image at extraction time); book
  // title/author/year/page number are catalog records.
  const modelLabel = data.model ? formatModelName(data.model) : null;
  const detectedDate = data.detectedAt
    ? new Date(data.detectedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : null;
  const aiBadgeTitle = `${modelLabel ? `Generated by ${data.model}` : 'AI-generated'}${detectedDate ? ` in ${detectedDate}` : ''} — may contain errors`;

  return (
    <div className="bg-black text-white max-w-[100vw] overflow-x-hidden">
      {/* Image viewer - fills viewport */}
      <div className="h-screen relative flex flex-col overflow-hidden">
        {/* Minimal header */}
        <header className="flex-shrink-0 z-40 bg-black/80 backdrop-blur-sm border-b border-white/10">
          <div className="px-4 py-2 flex items-center justify-between gap-2 min-w-0">
            <nav className="flex items-center gap-1.5 text-sm">
              <Link href={`/`} className="text-stone-500 hover:text-white transition-colors">Source Library</Link>
              <span className="text-stone-600">/</span>
              <Link href={`/gallery`} className="text-stone-400 hover:text-white transition-colors">Gallery</Link>
            </nav>

            {/* Counter */}
            {bookImageIds.length > 1 && (
              <span className="text-stone-500 text-sm tabular-nums">
                {currentIndex + 1} / {bookImageIds.length}
              </span>
            )}

            <div className="flex items-center gap-1 flex-shrink-0 overflow-x-auto">
              {(data?.viewCount ?? 0) > 0 && (
                <span
                  className="hidden sm:inline-flex items-center gap-1 px-1.5 text-sm text-stone-500 tabular-nums flex-shrink-0"
                  title={`${data!.viewCount!.toLocaleString()} views`}
                >
                  <Eye className="w-4 h-4" />
                  {data!.viewCount!.toLocaleString()}
                </span>
              )}
              {imageId && (
                <div className="p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0">
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
                onClick={shareToPinterest}
                className="hidden sm:block p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Pin on Pinterest"
              >
                <svg className="w-4 h-4 text-stone-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" /></svg>
              </button>
              <button
                onClick={shareToTwitter}
                className="hidden sm:block p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Share on X"
              >
                <Share2 className="w-4 h-4 text-stone-400" />
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  onClick={shareNative}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  title="Share..."
                >
                  <ExternalLink className="w-4 h-4 text-stone-400" />
                </button>
              )}
              <button
                onClick={downloadImage}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Download"
              >
                <Download className="w-4 h-4 text-stone-400" />
              </button>
            </div>
          </div>
        </header>

        {/* Image area - fills remaining viewport */}
        <div className="flex-1 relative min-h-0 min-w-0 overflow-hidden">
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
                thumbnail={data.imageUrl}
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

          {/* Type badge — left-12 clears the magnifier's lens toggle, which owns top-left */}
          {data.type && (
            <span className="absolute top-3 left-12 px-2.5 py-0.5 rounded-full text-xs bg-accent-rust/90 text-white capitalize z-10">
              {data.type}
            </span>
          )}

          {/* Brightness/contrast controls */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            {/* Deep zoom (#2714) — only when the page has a tile pyramid AND the
                detection could be located in the master's coordinate space. The
                API withholds both fields together, so no focus means no button
                and the lens magnifier stays the high-res path. */}
            {data.deepzoom && data.focusBbox && (
              <button
                onClick={() => setDeepZoomOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/70 rounded-lg text-xs text-stone-300 hover:text-white transition-colors"
                title="Deep zoom into this illustration"
              >
                <Search className="w-4 h-4" />
                <span className="hidden sm:inline">Deep zoom</span>
              </button>
            )}
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

          {deepZoomOpen && data.deepzoom && (
            <Suspense fallback={null}>
              <DeepZoomOverlay
                manifest={data.deepzoom}
                title={data.description}
                caption={`${data.book.title}${data.book.year ? ` (${data.book.year})` : ''}, p.${data.pageNumber}`}
                initialBounds={data.focusBbox}
                onClose={() => setDeepZoomOpen(false)}
              />
            </Suspense>
          )}

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

          {/* Title + attribution overlay at bottom of image.
              pointer-events-none: this band (plus its 96px of gradient padding)
              lies over the bottom of the image, and swallowing the pointer there
              killed the magnifier lens across the lower fifth of every plate.
              The same title and caption are selectable in the details section below. */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 px-5 pb-5 pt-24 bg-gradient-to-t from-black/70 via-black/40 to-transparent">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-serif text-white leading-snug line-clamp-2">{data.description}</h1>
            <p className="text-base sm:text-lg text-white/60 mt-1.5">
              {data.book.title}{data.book.author && data.book.author !== 'Various' ? ` \u2014 ${data.book.author}` : ''}{data.book.year ? ` (${data.book.year})` : ''}, p.{data.pageNumber}
            </p>
          </div>
        </div>
      </div>

      {/* Details below the fold - always visible, scroll to see */}
      <div className="bg-stone-900 border-t border-white/10 overflow-hidden">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 sm:py-10 overflow-hidden">
          <div className="grid md:grid-cols-3 gap-8">
            {/* Left column: description + metadata */}
            <div className="md:col-span-2 space-y-6 min-w-0">
              {/* Title / Description */}
              <div>
                {isAdmin && editingTitle ? (
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
                    <h1 className="text-2xl sm:text-3xl font-serif text-stone-100 leading-relaxed">
                      {data.description}
                    </h1>
                    {isAdmin && (
                      <button onClick={() => setEditingTitle(true)} className="absolute top-0 right-0 text-xs text-accent-gold hover:text-accent-gold opacity-0 group-hover:opacity-100 transition-opacity">
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Museum Description */}
              {(data.museumDescription || isAdmin) && (
                <div className="bg-stone-800 rounded-lg p-5" data-view-section="ai-summary">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300">About this image <AiBadge className="ml-1" title={aiBadgeTitle} /></h3>
                    {isAdmin && !editingDescription && (
                      <button onClick={() => setEditingDescription(true)} className="text-sm text-accent-gold hover:text-accent-gold">Edit</button>
                    )}
                  </div>
                  {isAdmin && editingDescription ? (
                    <div className="space-y-3">
                      <ProseField
                        value={museumDescValue}
                        onChange={setMuseumDescValue}
                        savedValue={data.museumDescription || ''}
                        help="Two or three sentences, in the museum voice."
                        placeholder="Write a 2-3 sentence museum-style description..."
                        inputClassName="w-full h-28 p-3 bg-stone-700 text-stone-200 rounded text-base resize-none focus:outline-none focus:ring-1 focus-visible:ring-accent-rust leading-relaxed"
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
              )}

              {/* Metadata Tags */}
              {(metadataValues.subjects?.length || metadataValues.figures?.length || metadataValues.symbols?.length || metadataValues.style || metadataValues.technique || isAdmin) && (
                <div className="bg-stone-800 rounded-lg p-5" data-view-section="ai-summary">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300">Details <AiBadge className="ml-1" title={aiBadgeTitle} /></h3>
                    {isAdmin && !editingMetadata && (
                      <button onClick={() => setEditingMetadata(true)} className="text-sm text-accent-gold hover:text-accent-gold">Edit</button>
                    )}
                  </div>
                  {isAdmin && editingMetadata ? (
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
              )}

              {/* AI provenance / data attribution */}
              <p className="flex items-start gap-2 text-xs text-stone-500 leading-relaxed px-1" data-view-section="ai-summary">
                <AiBadge className="mt-0.5 flex-shrink-0" title={aiBadgeTitle} />
                <span>
                  The image title, description, and details above were {modelLabel ? `generated by ${modelLabel}` : 'AI-generated'}
                  {detectedDate ? ` (${detectedDate})` : ''} from the page scan and may contain errors.
                  Book title, author, date, and page number come from the library catalog.
                </span>
              </p>

              {/* Citation + Sharing */}
              <div className="bg-stone-800 rounded-lg p-5">
                <h3 className="text-base font-medium text-stone-300 mb-3">Cite this image</h3>
                <p className="text-stone-400 text-sm font-mono leading-relaxed bg-stone-900 rounded p-3 break-all">{data.citation}{'\n'}URL: {typeof window !== 'undefined' ? window.location.href : ''}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button onClick={copyCitation} className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-sm text-stone-300 transition-colors">
                    <Copy className="w-4 h-4" />Copy citation
                  </button>
                  <button onClick={copyLink} className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-sm text-stone-300 transition-colors">
                    {copied ? <Check className="w-4 h-4 text-status-success" /> : <ExternalLink className="w-4 h-4" />}
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>
                  <button onClick={shareToTwitter} className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-sm text-stone-300 transition-colors">
                    <Share2 className="w-4 h-4" />Share on X
                  </button>
                  <button onClick={shareToPinterest} className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 hover:bg-stone-600 rounded-lg text-sm text-stone-300 transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" /></svg>
                    Pin it
                  </button>
                  <button
                    onClick={downloadImage}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors ${canDownloadImage
                      ? 'bg-stone-800 hover:bg-stone-700 text-white'
                      : 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                      }`}
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                  <button
                    onClick={downloadHighRes}
                    disabled={downloading}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 ${canDownloadImage
                      ? 'bg-amber-900/60 hover:bg-amber-800/60 text-amber-100'
                      : 'bg-stone-800 hover:bg-stone-700 text-stone-200'
                      }`}
                  >
                    {downloading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Download className="w-4 h-4" />
                    }
                    {downloading ? 'Generating...' : 'Download High-Res'}
                  </button>
                </div>
              </div>

              {/* Admin-only editing tools */}
              {isAdmin && (
                <div className="space-y-6 border-t border-white/10 pt-6">
                  <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Admin Tools</h3>

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

                  {/* Image Type — re-tag a mis-classified image (e.g. an
                      ex-libris bookplate auto-labelled "emblem"). */}
                  <div className="bg-stone-800 rounded-lg p-5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-medium text-stone-300">Image Type</h3>
                      <select
                        value={data.type || 'unknown'}
                        disabled={saving}
                        onChange={(e) => saveType(e.target.value)}
                        className="bg-stone-700 text-stone-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus-visible:ring-accent-rust disabled:opacity-50 capitalize"
                      >
                        {['woodcut', 'diagram', 'chart', 'illustration', 'symbol', 'table', 'map', 'decorative', 'emblem', 'engraving', 'portrait', 'frontispiece', 'musical_score', 'exlibris', 'bookplate', 'unknown'].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-stone-500 mt-2">Ex-libris and bookplates are provenance marks, not the book&apos;s own illustrations.</p>
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
                            <Image src={data.fullPageUrl} alt="Full page" fill sizes="(max-width: 768px) 90vw, 80vw" className="object-contain pointer-events-none" onDragStart={(e) => e.preventDefault()} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} unoptimized />
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

                  {/* Processing Info */}
                  <button
                    onClick={() => setShowInfo(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-stone-700 hover:bg-stone-600 text-stone-400 hover:text-stone-300 transition-colors"
                  >
                    <Info className="w-3.5 h-3.5" />
                    Processing Info
                  </button>
                </div>
              )}
            </div>

            {/* Right column: book card + more from book + similar */}
            <div className="space-y-5 min-w-0">
              <div className="bg-stone-800 rounded-lg overflow-hidden">
                <Link href={data.readUrl} className="block group">
                  {getBookThumbnailUrl(data.book) && (
                    <div className="relative w-full aspect-[3/4] bg-stone-900">
                      <Image src={getBookThumbnailUrl(data.book)!} alt={data.book.title} fill sizes="(max-width: 768px) 90vw, 300px" className="object-cover group-hover:opacity-90 transition-opacity" unoptimized />
                    </div>
                  )}
                  <div className="p-5">
                    <p className="text-lg text-white font-medium group-hover:text-accent-gold transition-colors">{data.book.title}</p>
                    {data.book.author && data.book.author !== 'Various' && <p className="text-stone-400 text-base mt-1">{data.book.author}</p>}
                    {data.book.year && <p className="text-stone-500 text-base">{data.book.year}</p>}
                  </div>
                </Link>
                <div className="px-5 pb-5">
                  <Link href={data.readUrl} className="flex items-center justify-center gap-2 py-3 px-4 bg-accent-rust hover:bg-accent-rust/80 text-white rounded-lg transition-colors font-medium text-base">
                    <BookOpen className="w-5 h-5" />Read page {data.pageNumber} in context
                  </Link>
                </div>
              </div>

              {/* More pictures — from this collection when collection-scoped, else this book */}
              {bookImageIds.length > 1 && (
                <div className="bg-stone-800 rounded-lg p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-stone-300">
                      {collectionScope ? 'More pictures from this collection' : 'More pictures from this book'}
                    </h3>
                    <Link
                      href={
                        collectionScope?.gcollection
                          ? `/gallery/collections/${collectionScope.gcollection}`
                          : collectionScope?.collection
                          ? `/gallery?collection=${encodeURIComponent(collectionScope.collection)}`
                          : data.galleryUrl
                      }
                      className="text-sm text-accent-gold hover:text-accent-gold"
                    >
                      See all
                    </Link>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {bookImageIds
                      .filter(id => id !== imageId)
                      .slice(0, 3)
                      .map((id) => {
                        const info = bookThumbnails.get(id);
                        if (!info) return null;
                        return (
                          <Link
                            key={id}
                            href={`/gallery/image/${id}${collectionQuery}`}
                            onClick={(e) => {
                              e.preventDefault();
                              const idx = bookImageIds.indexOf(id);
                              if (idx >= 0) navigateTo(idx);
                            }}
                            className="group relative aspect-square bg-stone-700 rounded overflow-hidden"
                            title={info.desc}
                          >
                            <Image
                              src={info.thumb}
                              alt={info.desc}
                              fill
                              sizes="120px"
                              className="object-cover group-hover:scale-105 transition-transform duration-200"
                              unoptimized
                            />
                          </Link>
                        );
                      })}
                  </div>
                </div>
              )}

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
