'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Camera, Upload, Loader2, ExternalLink, Check } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { bookUrl } from '@/lib/slugify';

interface Match {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  published?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  match_image?: string;
  resource_type?: string;
  subject?: string;
  score: number;
  visual_similarity?: number;
  match_source?: 'text' | 'visual' | 'visual_confirmed' | 'semantic_artwork';
  page_number?: number;
  page_score?: number;
}

interface AlternativeIdentification {
  artist?: string | null;
  title?: string | null;
  reasoning?: string;
}

interface Identification {
  artist?: string | null;
  title?: string | null;
  inscriptions?: string | null;
  publisher?: string | null;
  subject?: string | null;
  medium?: string;
  period_guess?: string;
  confidence?: 'high' | 'medium' | 'low';
  confidence_reason?: string;
  alternative_identifications?: AlternativeIdentification[];
  search_terms?: string[];
  /** [ymin, xmin, ymax, xmax], normalized 0-1000 — the artwork's box within the photo (#4237) */
  artwork_bbox?: number[] | string | null;
  // From Google Search verification
  verified_artist?: string;
  verified_title?: string;
  catalog_numbers?: string[];
  web_sources?: { title: string; url: string }[];
}

interface ConfirmedMatch {
  book_id: string;
  book_slug?: string;
  book_title?: string;
  book_author?: string;
  gallery_image_id?: string;
  page_id?: string;
  page_number?: number;
  description?: string;
  /** The matched crop — what the photo was compared against. */
  image_url: string;
  /** The whole scan leaf the match sits on (display size), when the page was located. */
  page_image_url?: string;
  read_url: string;
  gallery_url?: string;
  source_type: string;
  /**
   * A confirmed ARTWORK record with a verified `source_book` (#4037): the book
   * the print comes from. `read_url` already points there (page when known).
   */
  source_book?: { book_id: string; book_slug?: string; book_title?: string; book_author?: string; page_id?: string; page_number?: number };
}

/**
 * Where each fact on the result came from — one vocabulary, real text (a
 * screen reader reads the chip; an icon would say nothing). The visitor is
 * deciding whether to trust an attribution, so a model's guess must never
 * look like a catalogue entry.
 */
type Provenance = 'ai-reading' | 'web-check' | 'catalogue' | 'ai-description';
const PROVENANCE: Record<Provenance, { label: string; className: string }> = {
  'ai-reading': { label: 'AI reading of your photo', className: 'text-amber-800 bg-amber-50' },
  'web-check': { label: 'Web check', className: 'text-blue-700 bg-blue-50' },
  'catalogue': { label: 'Library catalogue', className: 'text-green-700 bg-green-50' },
  'ai-description': { label: 'AI-generated description', className: 'text-stone-600 bg-stone-100' },
};
function ProvenanceChip({ kind, className = '' }: { kind: Provenance; className?: string }) {
  const p = PROVENANCE[kind];
  return (
    <span className={`inline-block text-[10px] leading-4 rounded px-1.5 py-0.5 whitespace-nowrap ${p.className} ${className}`}>
      {p.label}
    </span>
  );
}

/**
 * Back/forward keeps the result. State lived only in React, so tapping a match
 * and then pressing Back threw the identification away and the visitor paid
 * for a second one. A completed result is parked in sessionStorage under a
 * short id that rides on the URL (`?r=<id>`); the page restores from it on
 * mount and on popstate without re-fetching. Session-scoped and client-only —
 * a shareable result URL is a later step with its own photo-retention
 * questions.
 */
const STORE_PREFIX = 'sl-identify:';
const PHOTO_STORE_LIMIT = 1.5 * 1024 * 1024;
interface StoredResult { result: Result; photoDataUrl?: string; ts: number }
function storeResult(id: string, entry: StoredResult): void {
  try {
    sessionStorage.setItem(STORE_PREFIX + id, JSON.stringify(entry));
  } catch {
    // Quota: keep the result and drop the photo rather than keep nothing.
    try { sessionStorage.setItem(STORE_PREFIX + id, JSON.stringify({ ...entry, photoDataUrl: undefined })); } catch { /* private mode */ }
  }
}
function loadResult(id: string | null): StoredResult | null {
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredResult;
    return parsed && parsed.result && Array.isArray(parsed.result.matches) ? parsed : null;
  } catch {
    return null;
  }
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Client-side mirror of the server's bbox guard: malformed → no overlay. */
function parseBbox(raw: unknown): { ymin: number; xmin: number; ymax: number; xmax: number } | null {
  let a = raw;
  if (typeof a === 'string') {
    try { a = JSON.parse(a.replace(/[^\d,.[\]-]/g, '')); } catch { return null; }
  }
  if (!Array.isArray(a) || a.length !== 4 || a.some(v => typeof v !== 'number' || !isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = a as number[];
  if (!(ymax > ymin && xmax > xmin) || ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) return null;
  // Boxes covering nearly the whole photo carry no information — don't draw them.
  if ((ymax - ymin) * (xmax - xmin) > 900000) return null;
  return { ymin, xmin, ymax, xmax };
}

interface Result {
  identification: Identification;
  matches: Match[];
  visual_search?: boolean;
  verified?: boolean;
  confirmed?: ConfirmedMatch | null;
  page?: { book_id: string; page_number: number; score: number } | null;
}

export default function IdentifyPage() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the pipeline is doing right now — timer-driven until the first stream
  // event arrives, event-driven after. The stages named here are real (#4232).
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // The downscaled photo as a data URL, kept only when small enough to park
  // in sessionStorage beside the result (see storeResult).
  const photoForStoreRef = useRef<string | undefined>(undefined);

  // Restore a parked result: on mount with `?r=`, and on every history
  // traversal (Back from the reader lands here with the id still in the URL;
  // Back once more, to the landing entry, has no id and clears the screen).
  useEffect(() => {
    const restore = () => {
      const id = new URLSearchParams(window.location.search).get('r');
      const stored = loadResult(id);
      if (stored) {
        setError(null);
        setResult(stored.result);
        setImage(stored.photoDataUrl ?? null);
      } else if (id === null) {
        setResult(null);
        setImage(null);
        setError(null);
      }
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const parkResult = useCallback((final: Result) => {
    const id = Math.random().toString(36).slice(2, 10);
    storeResult(id, { result: final, photoDataUrl: photoForStoreRef.current, ts: Date.now() });
    const url = new URL(window.location.href);
    url.searchParams.set('r', id);
    window.history.pushState({ identifyId: id }, '', url.pathname + url.search);
  }, []);

  const submitFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    photoForStoreRef.current = undefined;

    // Fallback narration: if the stream is slow to open (or unsupported), the
    // spinner still tells the truth about what is happening and when.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => { timers.forEach(clearTimeout); timers.length = 0; };
    setStageMessage('Reading the image…');
    timers.push(setTimeout(() => setStageMessage('Comparing against 152,000 illustrations…'), 6000));
    timers.push(setTimeout(() => setStageMessage('Confirming the match…'), 14000));

    // Compress large images client-side (phone cameras produce 5-10MB files).
    // 1600px / q0.8 is still ample for reading inscriptions, and the photo is
    // the dominant payload THREE times over: the mobile upload, the vision
    // identification call, and the visual-rerank call all carry it — so every
    // byte saved here is saved at each stage (#4232 perf).
    let imageFile = file;
    if (file.size > 1.5 * 1024 * 1024) {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(bitmap.width * scale, bitmap.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        imageFile = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      } catch {
        // Fall through with original file if compression fails
      }
    }
    if (imageFile.size < PHOTO_STORE_LIMIT) {
      try { photoForStoreRef.current = await fileToDataUrl(imageFile); } catch { /* preview still works */ }
    }

    const formData = new FormData();
    formData.append('image', imageFile);

    try {
      const res = await fetch('/api/identify?stream=1', { method: 'POST', body: formData });
      const ctype = res.headers.get('content-type') || '';

      // Errors (rate limit, size) and any non-streaming server are plain JSON.
      if (!res.ok || !ctype.includes('ndjson') || !res.body) {
        let data;
        try {
          data = await res.json();
        } catch {
          setError(`Server error (${res.status}) — try again`);
          return;
        }
        if (!res.ok) {
          setError(data.detail || data.error || `Failed to identify (${res.status})`);
        } else {
          setResult(data);
          parkResult(data);
        }
        return;
      }

      // NDJSON stream: one event per line, rendered as it lands. The photo is
      // identified in ~6s; retrieval and visual confirmation follow — this is
      // what turns a ~25s opaque wait into visible progress.
      let sawTerminal = false;
      // `acc` mirrors what setResult holds so the terminal event can park the
      // finished result without waiting for a render.
      let acc: Result | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handleEvent = (evt: any) => {
        switch (evt.type) {
          case 'identification':
            clearTimers();
            setStageMessage('Searching the library…');
            acc = { identification: evt.data, matches: [], confirmed: null, page: null };
            setResult(acc);
            break;
          case 'matches':
            setStageMessage('Confirming the match visually…');
            if (acc) acc = { ...acc, matches: evt.data || [], visual_search: evt.visual_search };
            setResult(acc);
            break;
          case 'confirmed':
            // A confirmed match cancels the web check server-side; nothing
            // else is coming that changes the answer, so stop narrating.
            setStageMessage(evt.data ? null : 'Checking the web…');
            if (acc) acc = { ...acc, confirmed: evt.data, page: evt.page ?? null, matches: evt.matches || acc.matches };
            setResult(acc);
            break;
          case 'verification':
            if (acc) acc = { ...acc, identification: evt.data, verified: true };
            setResult(acc);
            break;
          case 'done':
            sawTerminal = true;
            if (acc) parkResult(acc);
            break;
          case 'error':
            sawTerminal = true;
            setError(evt.detail || evt.message || 'Identification failed');
            break;
        }
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line));
          } catch {
            // Skip a malformed line rather than killing the whole stream
          }
        }
      }
      if (!sawTerminal) {
        setError('Connection interrupted — try again');
      }
    } catch {
      setError('Network error — check your connection and try again');
    } finally {
      clearTimers();
      setStageMessage(null);
      setLoading(false);
    }
  }, [parkResult]);

  const handleFile = useCallback(async (file: File) => {
    lastFileRef.current = file;
    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setImage(e.target?.result as string);
    reader.readAsDataURL(file);
    submitFile(file);
  }, [submitFile]);

  // Paste an image from the clipboard (a screenshot, or "Copy image" from
  // another site) anywhere on the page — desktop visitors rarely have a camera
  // pointed at the print, but often have the picture on screen already.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (loading) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(e.clipboardData?.items ?? []).find(
        i => i.kind === 'file' && i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      handleFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loading, handleFile]);

  const retry = useCallback(() => {
    if (lastFileRef.current) {
      submitFile(lastFileRef.current);
    }
  }, [submitFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const reset = useCallback(() => {
    setImage(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    // A new history entry, so Back returns to the result just left.
    if (new URLSearchParams(window.location.search).has('r')) {
      window.history.pushState({}, '', window.location.pathname);
    }
  }, []);

  // "Copy citation": the quote endpoint mints the shortlink and the inline
  // citation for the located page; both go on the clipboard as one block.
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const copyCitation = useCallback(async (bookId: string, pageNumber: number) => {
    setCopyState('busy');
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/quote?page=${pageNumber}`);
      if (!res.ok) throw new Error(`quote ${res.status}`);
      const data = await res.json();
      const inline: string | undefined = data?.citation?.inline;
      const shortUrl: string | undefined = data?.citation?.short_url;
      if (!inline && !shortUrl) throw new Error('no citation');
      await navigator.clipboard.writeText([inline, shortUrl].filter(Boolean).join('\n'));
      setCopyState('done');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  }, []);

  return (
    <div className="min-h-screen bg-cream">
      {/* Header — the page title band only appears once a photo is in play;
          the landing hero speaks for itself */}
      <div className="bg-dark text-white">
        <SiteHeader variant="dark" />
        {(image || result) && (
          <div className="max-w-2xl mx-auto px-4 py-6">
            <h1 className="text-2xl sm:text-3xl font-display font-semibold">Identify</h1>
            <p className="text-white/60 mt-1 text-sm">Photograph an artwork or book to find it in Source Library</p>
          </div>
        )}
      </div>

      {/* Hidden inputs live outside the conditional states so the hero and
          any future entry points can share them */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleInputChange}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleInputChange}
        className="hidden"
      />

      {/* Landing: you are standing in the room. Gated on submission state, not
          just the preview — if FileReader ever fails to produce a preview, the
          results must not render underneath the hero. */}
      {!image && !loading && !result && !error && (
        <>
          <section className="relative bg-dark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/identify-hero.jpg"
              alt="The picture room at the Embassy of the Free Mind in Amsterdam, its walls covered with framed engravings and prints"
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Blend the dark site header into the room's ceiling, and carry
                the text on a deep bottom gradient */}
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-dark to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

            <div className="relative max-w-5xl mx-auto px-5 sm:px-8 min-h-[78vh] sm:min-h-[72vh] flex flex-col justify-end pb-12 sm:pb-16 pt-40">
              <p className="text-[11px] uppercase tracking-[0.22em] text-white/60 mb-3">
                Embassy of the Free Mind · Amsterdam
              </p>
              <h1 className="font-display text-white font-semibold leading-[1.05] text-[clamp(2.1rem,5.5vw,3.8rem)] max-w-3xl [text-shadow:0_1px_24px_rgba(0,0,0,0.45)]">
                Every picture here comes from a book.
              </h1>
              <p className="text-white/85 mt-4 max-w-xl text-base sm:text-lg leading-relaxed">
                Photograph any print or engraving — on this wall, or on a page in
                your hands — and we&apos;ll open the book it comes from.
              </p>

              {/* Signature: the viewfinder CTA — one more frame on a wall of frames */}
              <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="group relative inline-flex items-center gap-3 px-8 py-5 text-white cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
                  aria-label="Take a photo of an artwork or page"
                >
                  <span aria-hidden className="pointer-events-none absolute inset-0">
                    <span className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-white/90 transition-all duration-300 motion-safe:group-hover:-top-1.5 motion-safe:group-hover:-left-1.5" />
                    <span className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-white/90 transition-all duration-300 motion-safe:group-hover:-top-1.5 motion-safe:group-hover:-right-1.5" />
                    <span className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-white/90 transition-all duration-300 motion-safe:group-hover:-bottom-1.5 motion-safe:group-hover:-left-1.5" />
                    <span className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-white/90 transition-all duration-300 motion-safe:group-hover:-bottom-1.5 motion-safe:group-hover:-right-1.5" />
                  </span>
                  <Camera className="w-6 h-6" />
                  <span className="text-lg font-medium tracking-wide">Take a photo</span>
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors cursor-pointer underline-offset-4 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-sm"
                >
                  <Upload className="w-4 h-4" />
                  Upload an image
                </button>
                <span className="hidden sm:inline text-sm text-white/50">
                  or paste one with {'\u2318'}V / Ctrl+V
                </span>
              </div>
            </div>
          </section>

          {/* How it works — one quiet strip, order is the information */}
          <section className="border-b border-border-light bg-cream">
            <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-10">
              {[
                { label: 'Photograph', body: 'Frames, glare, and angles are fine.' },
                { label: 'Match', body: 'Compared against every illustration in the library.' },
                { label: 'Read', body: 'The exact page opens in the reader, with translation.' },
              ].map(step => (
                <div key={step.label}>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-accent-rust">{step.label}</p>
                  <p className="text-sm text-secondary mt-1.5 leading-snug">{step.body}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className={`max-w-2xl mx-auto px-4 space-y-6 ${image || result ? 'py-8' : ''}`}>
        {/* Preview + loading */}
        {image && (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-stone-100 flex justify-center">
              {/* Inner wrapper shrinks to the image's rendered box so the bbox
                  overlay's percentages map onto the PHOTO, not the letterboxed
                  container (#4237). */}
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Your photo" className="max-h-[50vh] max-w-full w-auto h-auto object-contain" />
                {(() => {
                  const b = result ? parseBbox(result.identification.artwork_bbox) : null;
                  if (!b) return null;
                  return (
                    <div
                      aria-hidden
                      title="The region we searched for"
                      className="absolute border-2 border-white/90 rounded-sm pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                      style={{
                        top: `${b.ymin / 10}%`,
                        left: `${b.xmin / 10}%`,
                        width: `${(b.xmax - b.xmin) / 10}%`,
                        height: `${(b.ymax - b.ymin) / 10}%`,
                      }}
                    />
                  );
                })()}
              </div>
              {loading && !result && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="flex items-center gap-3 bg-white/90 rounded-full px-5 py-2.5">
                    <Loader2 className="w-5 h-5 animate-spin text-accent-rust" />
                    <span className="text-sm font-medium">{stageMessage || 'Identifying…'}</span>
                  </div>
                </div>
              )}
            </div>

            {!loading && (
              <button
                onClick={reset}
                className="text-sm text-accent-rust hover:underline cursor-pointer"
              >
                Try another image
              </button>
            )}
          </div>
        )}
        {!image && result && !loading && (
          <button onClick={reset} className="text-sm text-accent-rust hover:underline cursor-pointer">
            Try another image
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800 space-y-2">
            <p>{error}</p>
            <button
              onClick={retry}
              disabled={loading}
              className="text-accent-rust font-medium hover:underline cursor-pointer disabled:opacity-50"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Streaming: analysis is already on screen while retrieval and
                visual confirmation continue — say so instead of overlaying */}
            {loading && stageMessage && (
              <div className="flex items-center gap-2.5 text-sm text-secondary" role="status">
                <Loader2 className="w-4 h-4 animate-spin text-accent-rust" />
                <span>{stageMessage || 'Searching the library…'}</span>
              </div>
            )}

            {/* Visually confirmed match — the answer, front and center. The
                visitor photographed a print and wants to GET TO IT: the page in
                the reader, with translation. So the primary action is the page,
                and the card says which facts are the catalogue's. */}
            {result.confirmed && (() => {
              const c = result.confirmed;
              const pageLocated = !!c.page_id || c.page_number != null;
              const secondaryBtn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-light text-xs text-secondary hover:border-accent-rust/30 hover:text-primary transition-colors cursor-pointer';
              return (
              <div className="rounded-xl overflow-hidden bg-white border-2 border-accent-rust/40 shadow-sm">
                <div className="flex items-center gap-2 px-5 py-3 bg-accent-rust/5 border-b border-accent-rust/20 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent-rust">Found in the library</span>
                  <span className="text-[10px] text-green-700 bg-green-50 rounded px-1.5 py-0.5">confirmed by visual comparison</span>
                </div>
                <div className="flex gap-4 p-5">
                  {/* self-start keeps the thumb box hugging the image instead of
                      stretching to row height and leaving a gray dead zone */}
                  <div className="w-24 sm:w-32 flex-shrink-0 self-start rounded overflow-hidden bg-stone-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.image_url} alt="The matched illustration" className="w-full h-auto object-contain" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <ProvenanceChip kind="catalogue" />
                    <p className="font-display font-semibold text-primary">
                      {c.source_book?.book_title || c.book_title}
                      {/* "scan page", not "page": the work's own plate numbering
                          (e.g. the Codex Borgia's "Page 56") can differ from our
                          scan sequence, and the Analysis card may show it */}
                      {c.page_number != null && (
                        <span className="text-sm font-normal text-muted ml-2">scan page {c.page_number}</span>
                      )}
                    </p>
                    {(c.source_book?.book_author || c.book_author) && (
                      <p className="text-sm text-secondary">{c.source_book?.book_author || c.book_author}</p>
                    )}
                    {c.source_book && (
                      <p className="text-xs text-muted">
                        Matched through the print record{' '}
                        {c.book_slug
                          ? <Link href={`/artwork/${c.book_slug}`} className="underline hover:text-accent-rust">{c.book_title}</Link>
                          : c.book_title}
                      </p>
                    )}
                    {c.description && (
                      <div className="pt-1">
                        <ProvenanceChip kind="ai-description" />
                        <p className="text-sm text-secondary line-clamp-3 mt-1">{c.description}</p>
                      </div>
                    )}
                    <div className="pt-2">
                      <Link
                        href={c.read_url}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-rust text-white text-sm font-medium hover:bg-accent-rust/85 transition-colors"
                      >
                        {pageLocated ? 'Go to the source' : 'Open the book (page not located)'}
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {c.gallery_url && (
                        <Link href={c.gallery_url} className={secondaryBtn}>View in gallery</Link>
                      )}
                      {c.page_image_url && (
                        <a href={c.page_image_url} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
                          Open the scan
                          <ExternalLink className="w-3 h-3" aria-hidden />
                        </a>
                      )}
                      {c.page_number != null && (
                        <button
                          type="button"
                          onClick={() => copyCitation(c.book_id, c.page_number as number)}
                          disabled={copyState === 'busy'}
                          className={`${secondaryBtn} disabled:opacity-60`}
                          aria-live="polite"
                        >
                          {copyState === 'done' ? (
                            <><Check className="w-3 h-3" aria-hidden /> Copied</>
                          ) : copyState === 'failed' ? (
                            'Could not copy'
                          ) : copyState === 'busy' ? (
                            'Copying…'
                          ) : (
                            'Copy citation'
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* The whole leaf, not just the matched crop — this is the
                    page the primary button lands on */}
                {c.page_image_url && pageLocated && (
                  <div className="border-t border-border-light bg-stone-50 px-5 py-4">
                    <Link href={c.read_url} className="block group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.page_image_url}
                        alt={`Scan of ${c.book_title || 'the book'}${c.page_number != null ? `, page ${c.page_number}` : ''}`}
                        loading="lazy"
                        className="mx-auto max-h-72 w-auto h-auto rounded shadow-sm bg-white group-hover:shadow-md transition-shadow"
                      />
                      <p className="text-center text-xs text-muted mt-2 group-hover:text-accent-rust transition-colors">
                        {c.page_number != null ? `Scan page ${c.page_number}` : 'The scan page'} — open in the reader
                      </p>
                    </Link>
                  </div>
                )}
              </div>
              );
            })()}

            {/* What Gemini saw */}
            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-display font-semibold text-primary">Analysis</h2>
                  <ProvenanceChip kind="ai-reading" />
                </div>
                {result.identification.confidence && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    result.identification.confidence === 'high'
                      ? 'bg-green-100 text-green-800'
                      : result.identification.confidence === 'medium'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-stone-100 text-stone-600'
                  }`}>
                    {result.identification.confidence} confidence
                  </span>
                )}
              </div>
              {/* Legend: one line, same vocabulary as every chip on the page */}
              <details className="text-xs text-muted">
                <summary className="cursor-pointer select-none">What the labels mean</summary>
                <p className="mt-1">
                Labels say where each fact comes from: <span className="text-amber-800">AI reading of your photo</span> is a
                model&apos;s guess from the image; <span className="text-blue-700">Web check</span> is what a web search
                found for that guess; <span className="text-green-700">Library catalogue</span> is our own record of the
                book; <span className="text-stone-600">AI-generated description</span> was written by a model, not a curator.
                </p>
              </details>
              {result.identification.confidence_reason && (
                <p className="text-xs text-muted italic">{result.identification.confidence_reason}</p>
              )}
              <dl className="text-sm space-y-2">
                {(result.identification.artist || result.identification.verified_artist) && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Artist</dt>
                    {result.identification.verified_artist ? (
                      <dd>
                        <span className="text-primary font-medium">{result.identification.verified_artist}</span>
                        <ProvenanceChip kind="web-check" className="ml-1.5" />
                        {result.identification.artist && result.identification.artist !== result.identification.verified_artist && (
                          <span className="block text-xs text-muted">AI read: {result.identification.artist}</span>
                        )}
                      </dd>
                    ) : (
                      <dd className="text-primary font-medium">{result.identification.artist}</dd>
                    )}
                  </div>
                )}
                {(result.identification.title || result.identification.verified_title) && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Title</dt>
                    {result.identification.verified_title ? (
                      <dd>
                        <span className="text-primary">{result.identification.verified_title}</span>
                        <ProvenanceChip kind="web-check" className="ml-1.5" />
                        {result.identification.title && result.identification.title !== result.identification.verified_title && (
                          <span className="block text-xs text-muted">AI read: {result.identification.title}</span>
                        )}
                      </dd>
                    ) : (
                      <dd className="text-primary">{result.identification.title}</dd>
                    )}
                  </div>
                )}
                {result.identification.subject && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Subject</dt>
                    <dd className="text-secondary">{result.identification.subject}</dd>
                  </div>
                )}
                {result.identification.medium && (
                  <div className="flex gap-4">
                    <div>
                      <dt className="text-muted text-xs uppercase tracking-wider">Medium</dt>
                      <dd className="text-secondary capitalize">{result.identification.medium}</dd>
                    </div>
                    {result.identification.period_guess && (
                      <div>
                        <dt className="text-muted text-xs uppercase tracking-wider">Period</dt>
                        <dd className="text-secondary">{result.identification.period_guess}</dd>
                      </div>
                    )}
                  </div>
                )}
                {result.identification.publisher && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Publisher</dt>
                    <dd className="text-secondary">{result.identification.publisher}</dd>
                  </div>
                )}
                {result.identification.inscriptions && (
                  <div>
                    {/* The full transcription is a screenful on a phone; once the
                        library has the page it is reference material, not the answer */}
                    {result.confirmed && result.identification.inscriptions.length > 160 ? (
                      <details>
                        <summary className="text-muted text-xs uppercase tracking-wider cursor-pointer select-none">Inscriptions (transcribed)</summary>
                        <p className="text-secondary whitespace-pre-line font-serif text-xs mt-1">{result.identification.inscriptions}</p>
                      </details>
                    ) : (
                      <>
                        <dt className="text-muted text-xs uppercase tracking-wider">Inscriptions</dt>
                        <dd className="text-secondary whitespace-pre-line font-serif text-xs mt-1">
                          {result.identification.inscriptions}
                        </dd>
                      </>
                    )}
                  </div>
                )}
              </dl>

              {/* Catalog numbers */}
              {result.identification.catalog_numbers && result.identification.catalog_numbers.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-1 flex items-center gap-2">Catalogue references <ProvenanceChip kind="web-check" /></h3>
                  <div className="flex flex-wrap gap-1.5">
                    {result.identification.catalog_numbers.map((num, i) => (
                      <span key={i} className="text-xs bg-stone-100 text-stone-700 rounded px-2 py-0.5">{num}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Web sources from Google Search verification */}
              {result.identification.web_sources && result.identification.web_sources.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-1 flex items-center gap-2">Sources <ProvenanceChip kind="web-check" /></h3>
                  <div className="space-y-1">
                    {result.identification.web_sources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-blue-700 hover:text-blue-900 hover:underline truncate"
                      >
                        {src.title || src.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Alternative identifications */}
              {!result.confirmed && result.identification.alternative_identifications && result.identification.alternative_identifications.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-2 flex items-center gap-2">Other possibilities <ProvenanceChip kind="ai-reading" /></h3>
                  <div className="space-y-2">
                    {result.identification.alternative_identifications.map((alt, i) => (
                      <div key={i} className="text-sm bg-stone-50 rounded-lg p-3">
                        {alt.artist && <p className="font-medium text-primary">{alt.artist}</p>}
                        {alt.title && <p className="text-secondary">{alt.title}</p>}
                        {alt.reasoning && <p className="text-xs text-muted mt-1">{alt.reasoning}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Matches */}
            {result.matches.filter(m => !result.confirmed || m.id !== result.confirmed.book_id).length > 0 ? (
              /* With a confirmed answer the rail is the OTHER candidates the
                 comparison saw — mostly look-alikes — so it folds away */
              <details open={!result.confirmed}>
                <summary className="flex items-center gap-2 mb-3 cursor-pointer select-none">
                  <h2 className="text-lg font-display font-semibold text-primary">
                    {result.confirmed
                      ? `Other candidates we compared (${result.matches.filter(m => m.id !== result.confirmed!.book_id).length})`
                      : result.matches.length === 1 ? 'Closest Match' : `${result.matches.length} Possible Matches`}
                  </h2>
                  <ProvenanceChip kind="catalogue" />
                  {result.visual_search && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">visual search</span>
                  )}
                </summary>
                <div className="space-y-2">
                  {result.matches.filter(m => !result.confirmed || m.id !== result.confirmed.book_id).map((match, i) => {
                    const pageUrl = match.page_number
                      ? `${bookUrl({ slug: match.slug, id: match.id })}/page-number/${match.page_number}`
                      : bookUrl({ slug: match.slug, id: match.id });
                    return (
                    <Link
                      key={match.id}
                      href={pageUrl}
                      className="flex gap-4 p-3 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-sm transition-all group"
                    >
                      {(match.match_image || match.thumbnail_blob || match.thumbnail) && (
                        <div className="w-16 h-20 flex-shrink-0 rounded overflow-hidden bg-stone-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={match.match_image || match.thumbnail_blob || match.thumbnail || ''}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-primary group-hover:text-accent-rust transition-colors line-clamp-1">
                          {i === 0 && !result.confirmed && result.matches.length > 1 && (
                            <span className="text-xs bg-accent-rust/10 text-accent-rust rounded px-1.5 py-0.5 mr-2">Best match</span>
                          )}
                          {match.display_title || match.title}
                        </p>
                        {match.author && (
                          <p className="text-sm text-secondary mt-0.5">{match.author}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
                          {match.visual_similarity && (
                            <span className="font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                              {Math.round(match.visual_similarity * 100)}% visual match
                            </span>
                          )}
                          {match.published && <span>{match.published}</span>}
                          {match.resource_type && (
                            <span className="capitalize">{match.resource_type}</span>
                          )}
                          {match.page_number && (
                            <span className="font-medium text-accent-rust">Page {match.page_number}</span>
                          )}
                          {match.subject && !match.page_number && (
                            <span className="line-clamp-1">{match.subject}</span>
                          )}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted group-hover:text-accent-rust flex-shrink-0 mt-1" />
                    </Link>
                    );
                  })}
                </div>
              </details>
            ) : loading ? null : (
              <div className="card p-5 text-center">
                <p className="text-secondary">Not found in Source Library</p>
                <p className="text-sm text-muted mt-1">
                  We searched {result.identification.medium === 'book' || result.identification.medium === 'manuscript'
                    ? 'our book collection' : 'our books and artworks'} but couldn&apos;t find this specific work.
                  The identification above is our best analysis of the image itself.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
