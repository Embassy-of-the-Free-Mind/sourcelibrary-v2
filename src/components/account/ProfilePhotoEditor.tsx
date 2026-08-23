'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Camera, Loader2, Search, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { gallery, likes } from '@/lib/api-client';
import { useIdentity } from '@/hooks/useIdentity';
import { isBrowserRenderableImageUrl } from '@/lib/csp-img-hosts';
import type { GalleryItem } from '@/lib/api-client/types/gallery';

// Profile photo editor for /account. Two sources:
//   1. Upload your own image.
//   2. Pick something from the library — an extracted illustration, an artwork,
//      or a page you've liked (a cropped drop cap or ornament from a text page
//      makes a fine avatar; a whole text page at 40px does not, which is why
//      there's always a crop step).
// Either way the reader frames a square crop client-side and the server does
// the actual cropping (see /api/me/avatar).

const VIEW = 280; // crop viewport, css px
// The reader must be able to frame a SMALL detail — a face, a drop cap, one
// flower — because the avatar renders at 40–96px and a whole-page crop reads
// as a speck. So the zoom ceiling is derived from the source resolution: zoom
// in until the crop covers ~MIN_DETAIL_PX of source (the server output is
// 512px, so below ~200px source it's upscale mush anyway), with a hard cap.
const MIN_DETAIL_PX = 200;
const ZOOM_CAP = 24;
const ZOOM_FLOOR_MAX = 4; // even tiny sources allow a little zoom

interface LikedPageItem {
  id: string;
  pageNumber: number;
  bookTitle: string;
  thumbnail?: string;
  /** Full-resolution source for cropping (thumbnail may be 150px). */
  image_full?: string;
}

interface PickableImage {
  key: string;
  thumb: string;
  source: string;
  label: string;
}

interface ProfilePhotoEditorProps {
  name: string | null;
  initialImage: string | null;
  /** Avatar display size — 'md' (56px) for compact rows, 'lg' (96px) for the account header. */
  size?: 'md' | 'lg';
  /** 'dark' renders the trigger controls for a dark hero background. The modal stays light. */
  theme?: 'light' | 'dark';
}

const AVATAR_SIZES = {
  md: { circle: 'w-14 h-14', initial: 'text-lg', camera: 'w-5 h-5' },
  lg: { circle: 'w-24 h-24', initial: 'text-3xl', camera: 'w-6 h-6' },
} as const;

export default function ProfilePhotoEditor({ name, initialImage, size = 'md', theme = 'light' }: ProfilePhotoEditorProps) {
  const dark = theme === 'dark';
  const router = useRouter();
  const { update } = useSession();
  const identity = useIdentity();

  const [current, setCurrent] = useState<string | null>(initialImage);
  const [imgError, setImgError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<'library' | 'upload'>('library');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Library tab
  const [query, setQuery] = useState('');
  const [libraryItems, setLibraryItems] = useState<PickableImage[]>([]);
  const [likedPages, setLikedPages] = useState<PickableImage[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // Crop stage — non-null source means we're cropping
  const [cropSource, setCropSource] = useState<{ url: string; file?: File } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const dragRef = useRef<{ startX: number; startY: number; cx: number; cy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setCropSource(null);
    setNatural(null);
    setError(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  // Load library candidates when the tab first shows; debounced so typing in
  // the search box doesn't fire a request per keystroke.
  useEffect(() => {
    if (!isOpen || tab !== 'library') return;
    let cancelled = false;
    setLoadingLibrary(true);

    const timer = setTimeout(() => {
    const galleryPromise = gallery.list({
      query: query.trim() || undefined,
      limit: 48,
      minQuality: 0.6,
    }).then(res => (res.items || [])
      .map((item: GalleryItem) => {
        const source = item.extractedUrl || item.imageUrl;
        return {
          key: `g-${item.pageId}-${item.detectionIndex}`,
          thumb: item.thumbnailUrl || item.extractedUrl || item.imageUrl,
          source,
          label: item.description || item.bookTitle,
        };
      })
      .filter(item => isBrowserRenderableImageUrl(item.source))
    ).catch(() => [] as PickableImage[]);

    // Pages the reader has liked — the route into using a page of text
    // (or any page) as a photo: like it in the reader, crop it here.
    const likedPromise = (!query.trim() && identity.id)
      ? likes.getMine<LikedPageItem>({ type: 'page', visitorId: identity.id })
          .then(res => (res.items || [])
            .map(p => ({
              key: `p-${p.id}`,
              thumb: p.thumbnail as string,
              // Crop from the full-resolution image, not the 150px thumb
              source: (p.image_full || p.thumbnail) as string,
              label: `${p.bookTitle} — p. ${p.pageNumber}`,
            }))
            .filter(p => isBrowserRenderableImageUrl(p.thumb) && isBrowserRenderableImageUrl(p.source)))
          .catch(() => [] as PickableImage[])
      : Promise.resolve([] as PickableImage[]);

    Promise.all([galleryPromise, likedPromise]).then(([galleryHits, liked]) => {
      if (cancelled) return;
      setLibraryItems(galleryHits);
      setLikedPages(liked);
      setLoadingLibrary(false);
    });
    }, query.trim() ? 300 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [isOpen, tab, query, identity.id]);

  const startUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Images must be under 10 MB.');
      return;
    }
    setError(null);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setNatural(null);
    setZoom(1);
    setCenter({ x: 0.5, y: 0.5 });
    setCropSource({ url, file });
  };

  const startLibraryCrop = (source: string) => {
    setError(null);
    setNatural(null);
    setZoom(1);
    setCenter({ x: 0.5, y: 0.5 });
    setCropSource({ url: source });
  };

  // --- crop geometry ---
  // baseScale makes the shorter image side exactly fill the viewport (cover).
  // zoom multiplies it. center is in normalized source coords, clamped so the
  // viewport never shows past the image edge.
  //
  // maxZoom scales with the source: a 3000px page scan can zoom to ~15× so a
  // single ornament fills the frame; a 300px thumb stays near 1.5×.
  const maxZoom = useMemo(() => {
    if (!natural) return ZOOM_FLOOR_MAX;
    return Math.max(ZOOM_FLOOR_MAX, Math.min(ZOOM_CAP, Math.min(natural.w, natural.h) / MIN_DETAIL_PX));
  }, [natural]);

  const geometry = useMemo(() => {
    if (!natural) return null;
    const baseScale = VIEW / Math.min(natural.w, natural.h);
    const scale = baseScale * zoom;
    const halfX = VIEW / (2 * scale) / natural.w;  // half viewport width, normalized
    const halfY = VIEW / (2 * scale) / natural.h;
    return { scale, halfX, halfY };
  }, [natural, zoom]);

  const clampCenter = useCallback((cx: number, cy: number) => {
    if (!geometry) return { x: cx, y: cy };
    return {
      x: Math.min(1 - geometry.halfX, Math.max(geometry.halfX, cx)),
      y: Math.min(1 - geometry.halfY, Math.max(geometry.halfY, cy)),
    };
  }, [geometry]);

  useEffect(() => {
    // Re-clamp when zoom changes (zooming out can push the frame off-image)
    setCenter(c => clampCenter(c.x, c.y));
  }, [clampCenter]);

  const bbox = useMemo(() => {
    if (!geometry) return null;
    return {
      x: center.x - geometry.halfX,
      y: center.y - geometry.halfY,
      w: geometry.halfX * 2,
      h: geometry.halfY * 2,
    };
  }, [geometry, center]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, cx: center.x, cy: center.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !geometry || !natural) return;
    const dx = (e.clientX - dragRef.current.startX) / geometry.scale / natural.w;
    const dy = (e.clientY - dragRef.current.startY) / geometry.scale / natural.h;
    setCenter(clampCenter(dragRef.current.cx - dx, dragRef.current.cy - dy));
  };
  const onPointerUp = () => { dragRef.current = null; };

  // Scroll-wheel / trackpad zoom over the viewport — much finer control than
  // the slider when hunting for a small detail. Attached natively (non-passive)
  // because React registers onWheel passively, which makes preventDefault a
  // no-op and the page scrolls under the modal instead.
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom(z => Math.min(maxZoom, Math.max(1, z * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [maxZoom, cropSource]);

  const savePhoto = async () => {
    if (!cropSource || !bbox) return;
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (cropSource.file) {
        const form = new FormData();
        form.append('file', cropSource.file);
        form.append('x', String(bbox.x));
        form.append('y', String(bbox.y));
        form.append('w', String(bbox.w));
        form.append('h', String(bbox.h));
        res = await fetch('/api/me/avatar', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/me/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_url: cropSource.url, bbox }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save photo');
      setCurrent(data.url);
      setImgError(false);
      close();
      // Payload is required: a bare update() issues a GET and the JWT never
      // refreshes (session-flags-and-forms.md) — the new photo would not show
      // until the next sign-in.
      await update({ imageRefreshed: true });
      router.refresh();
      toast.success('Profile photo updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save photo');
    } finally {
      setSaving(false);
    }
  };

  const removePhoto = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/me/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remove: true }),
      });
      if (!res.ok) throw new Error();
      setCurrent(null);
      await update({ imageRefreshed: true });
      router.refresh();
      toast.success('Profile photo removed');
    } catch {
      toast.error('Failed to remove photo');
    } finally {
      setSaving(false);
    }
  };

  const displayedWidth = natural && geometry ? natural.w * geometry.scale : 0;
  const displayedHeight = natural && geometry ? natural.h * geometry.scale : 0;

  return (
    <>
      {/* Avatar + change/remove controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => { setIsOpen(true); setTab(current ? 'upload' : 'library'); }}
          className="relative group shrink-0"
          title="Change profile photo"
          aria-label="Change profile photo"
        >
          {current && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current}
              alt={name || 'Profile'}
              data-avatar="true"
              className={`${AVATAR_SIZES[size].circle} rounded-full object-cover`}
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              data-avatar="true"
              className={`${AVATAR_SIZES[size].circle} rounded-full flex items-center justify-center ${AVATAR_SIZES[size].initial} font-serif`}
              style={dark
                ? { background: 'rgba(245,240,232,0.12)', color: '#e7e0d4' }
                : { background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
            >
              {name?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
          <span
            data-avatar="true"
            className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.4)' }}
          >
            <Camera className={`${AVATAR_SIZES[size].camera} text-white`} aria-hidden="true" />
          </span>
        </button>
        <div className="flex flex-col gap-0.5 text-sm">
          <button
            onClick={() => { setIsOpen(true); setTab(current ? 'upload' : 'library'); }}
            className="text-left hover:opacity-70 transition-opacity"
            style={{ color: dark ? '#d6cfc2' : 'var(--text-secondary)' }}
          >
            {current ? 'Change photo' : 'Add a profile photo'}
          </button>
          {current && (
            <button
              onClick={removePhoto}
              disabled={saving}
              className="text-left hover:opacity-70 transition-opacity disabled:opacity-50"
              style={{ color: dark ? '#8f887c' : 'var(--text-muted)' }}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-editor-title"
            className="rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
            style={{ background: 'white' }}
          >
            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <h2 id="photo-editor-title" className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                {cropSource ? 'Frame your photo' : 'Profile photo'}
              </h2>
              <button onClick={close} aria-label="Close" className="p-1 hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {error && (
              <div role="alert" className="mx-4 mt-3 px-3 py-2 text-sm" style={{ background: '#fdf0ee', border: '1px solid var(--accent-rust)', color: 'var(--accent-rust)' }}>
                {error}
              </div>
            )}

            {cropSource ? (
              /* ---- Crop stage ---- */
              <div className="p-4 flex flex-col items-center gap-4 overflow-y-auto">
                <div
                  className="relative overflow-hidden touch-none select-none cursor-move shrink-0"
                  style={{ width: VIEW, height: VIEW, background: 'var(--bg-warm)' }}
                  ref={viewportRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cropSource.url}
                    alt="Photo to crop"
                    draggable={false}
                    onLoad={e => {
                      const img = e.currentTarget;
                      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                    className="absolute max-w-none pointer-events-none"
                    style={natural && geometry ? {
                      width: displayedWidth,
                      height: displayedHeight,
                      left: VIEW / 2 - center.x * natural.w * geometry.scale,
                      top: VIEW / 2 - center.y * natural.h * geometry.scale,
                    } : { opacity: 0 }}
                  />
                  {!natural && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                    </div>
                  )}
                  {/* Circular preview mask — what falls outside the circle is dimmed */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{ borderRadius: '9999px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
                  />
                </div>

                <label className="flex items-center gap-3 w-full max-w-xs text-sm" style={{ color: 'var(--text-muted)' }}>
                  Zoom
                  <input
                    type="range"
                    min={1}
                    max={maxZoom}
                    step={0.01}
                    value={Math.min(zoom, maxZoom)}
                    onChange={e => setZoom(parseFloat(e.target.value))}
                    className="flex-1"
                    aria-label="Zoom"
                  />
                </label>
                <p className="text-sm -mt-2" style={{ color: 'var(--text-muted)' }}>
                  Drag to reposition · scroll to zoom in on a small detail
                </p>

                <div className="flex items-center justify-between w-full pt-1">
                  <button
                    onClick={() => setCropSource(null)}
                    className="px-4 py-1.5 text-sm hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Back
                  </button>
                  <button
                    onClick={savePhoto}
                    disabled={saving || !natural}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--text-primary)', color: 'white' }}
                  >
                    {saving ? 'Saving…' : 'Use photo'}
                  </button>
                </div>
              </div>
            ) : (
              /* ---- Source picker ---- */
              <div className="flex flex-col overflow-hidden">
                <div className="flex gap-1 px-4 pt-3">
                  {(['library', 'upload'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className="px-3 py-1.5 text-sm font-medium transition-opacity"
                      style={tab === t
                        ? { color: 'var(--text-primary)', borderBottom: '2px solid var(--accent-rust)' }
                        : { color: 'var(--text-muted)' }}
                    >
                      {t === 'library' ? 'From the library' : 'Upload'}
                    </button>
                  ))}
                </div>

                {tab === 'upload' ? (
                  <div className="p-6 flex flex-col items-center gap-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-2 py-10 rounded-lg hover:opacity-80 transition-opacity"
                      style={{ border: '1px dashed var(--border-medium)', color: 'var(--text-muted)' }}
                    >
                      <Upload className="w-6 h-6" aria-hidden="true" />
                      <span className="text-sm">Choose an image…</span>
                      <span className="text-xs">JPEG, PNG or WebP, up to 10 MB</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) startUpload(file);
                        e.target.value = '';
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col overflow-hidden">
                    <div className="px-4 pt-3 pb-2">
                      <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
                        <input
                          type="search"
                          value={query}
                          onChange={e => setQuery(e.target.value)}
                          placeholder="Search illustrations & artwork…"
                          className="w-full pl-9 pr-3 py-2 rounded-lg"
                          style={{ fontSize: '16px', background: 'var(--bg-cream)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                        />
                      </div>
                    </div>

                    <div className="px-4 pb-4 overflow-y-auto" style={{ maxHeight: '50vh' }}>
                      {loadingLibrary ? (
                        <div className="flex justify-center py-10">
                          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                        </div>
                      ) : (
                        <>
                          {likedPages.length > 0 && !query.trim() && (
                            <>
                              <p className="text-xs mb-2 mt-1" style={{ color: 'var(--text-muted)' }}>Pages you&rsquo;ve liked</p>
                              <div className="grid grid-cols-4 gap-2 mb-4">
                                {likedPages.map(item => (
                                  <button
                                    key={item.key}
                                    onClick={() => startLibraryCrop(item.source)}
                                    className="relative aspect-square overflow-hidden hover:opacity-80 transition-opacity"
                                    style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                                    title={item.label}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={item.thumb} alt={item.label} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>From the gallery</p>
                            </>
                          )}
                          <div className="grid grid-cols-4 gap-2">
                            {libraryItems.map(item => (
                              <button
                                key={item.key}
                                onClick={() => startLibraryCrop(item.source)}
                                className="relative aspect-square overflow-hidden hover:opacity-80 transition-opacity"
                                style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                                title={item.label}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={item.thumb} alt={item.label} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                              </button>
                            ))}
                          </div>
                          {libraryItems.length === 0 && likedPages.length === 0 && (
                            <p className="text-sm text-center py-10" style={{ color: 'var(--text-muted)' }}>
                              Nothing found — try another search.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
