'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon, Loader2, X } from 'lucide-react';
import { useStableSession } from '@/hooks/useStableSession';
import { cardFramingStyle, COVER_EVENT, DEFAULT_CARD_FRAMING, type CardFraming, type CoverEventDetail } from '@/lib/collection-card-image';

/**
 * Editor-only affordance on a collection card: hover the card, click "Cover",
 * pick one of the collection's own plates (or paste a URL), drag it into
 * place, zoom, save. Writes hero_image + card_framing through
 * /api/admin/collections/[slug]/card-image and broadcasts the result so the
 * card it sits on updates in place.
 *
 * Drop it as a sibling of the card's <Link> inside a `relative group` wrapper.
 * It must not live inside the link: a button in an anchor navigates.
 * Renders nothing for readers; the API is gated on its own.
 */
type Aspect = '4/3' | '1/1';
interface Candidate { id: string; thumb: string; url: string; fallback: string | null; description: string; book_title: string }
interface Current { url: string | null; framing: CardFraming }

const ASPECT_CLS: Record<Aspect, string> = { '4/3': 'aspect-[4/3]', '1/1': 'aspect-square' };

export default function CollectionCoverEditor({ slug, name, aspect = '4/3' }: { slug: string; name: string; aspect?: Aspect }) {
  const { data: session } = useStableSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [open, setOpen] = useState(false);
  if (!(role === 'editor' || role === 'admin' || role === 'superadmin')) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Change the cover of ${name}`}
        className="absolute top-2 right-2 z-20 inline-flex items-center gap-1.5 rounded-md bg-white/90 px-2.5 py-1.5 text-[11px] font-medium text-black shadow opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-white"
      >
        <ImageIcon className="w-3.5 h-3.5" /> Cover
      </button>
      {open && <CoverDialog slug={slug} name={name} aspect={aspect} onClose={() => setOpen(false)} />}
    </>
  );
}

function CoverDialog({ slug, name, aspect, onClose }: { slug: string; name: string; aspect: Aspect; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [url, setUrl] = useState<string>('');
  const [fallback, setFallback] = useState<string | null>(null);
  const [f, setF] = useState<CardFraming>(DEFAULT_CARD_FRAMING);
  const [pasted, setPasted] = useState('');
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/collections/${slug}/card-image`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d: { candidates: Candidate[]; current: Current }) => {
        if (!live) return;
        setCandidates(d.candidates || []);
        setUrl(d.current?.url || '');
        setF(d.current?.framing || DEFAULT_CARD_FRAMING);
      })
      .catch((e) => live && setNote(`Could not load: ${e.message}`))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: f.x, y: f.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    // Dragging the plate to the right reveals more of its left edge, which is a
    // smaller object-position x. Zoomed in, the same drag moves less of the plate.
    setF((cur) => ({
      ...cur,
      x: clamp(drag.current!.x - (dx / Math.max(1, width)) * 100 / cur.scale, 0, 100),
      y: clamp(drag.current!.y - (dy / Math.max(1, height)) * 100 / cur.scale, 0, 100),
    }));
  };
  const onPointerUp = () => { drag.current = null; };

  const choose = (c: Candidate) => { setUrl(c.url); setFallback(c.fallback); setF(DEFAULT_CARD_FRAMING); setNote(''); };
  const usePasted = () => {
    const u = pasted.trim();
    if (!/^https:\/\//.test(u)) { setNote('Paste an https image URL.'); return; }
    setUrl(u); setFallback(null); setF(DEFAULT_CARD_FRAMING); setNote('');
  };

  const save = async () => {
    if (!url) { setNote('Pick an image first.'); return; }
    setSaving(true); setNote('');
    try {
      const r = await fetch(`/api/admin/collections/${slug}/card-image`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, fallback, ...f }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `${r.status}`);
      const detail: CoverEventDetail = { slug, url: d.url || url, framing: d.framing || f };
      window.dispatchEvent(new CustomEvent(COVER_EVENT, { detail }));
      router.refresh();
      onClose();
    } catch (e) {
      setNote(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const other: Aspect = aspect === '4/3' ? '1/1' : '4/3';
  const imgStyle = cardFramingStyle(f);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6" style={{ background: 'rgba(20,16,12,0.55)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[1080px] bg-cream border border-border-light shadow-xl" role="dialog" aria-modal="true" aria-label={`Cover for ${name}`}>
        <header className="flex items-center justify-between px-6 py-4 border-b border-border-light">
          <div>
            <h2 className="font-display text-[20px]" style={{ color: '#2b2620' }}>Cover for {name}</h2>
            <p className="text-xs" style={{ color: '#8a8170' }}>Pick a plate, drag it into place, zoom. The same cover is used on search, the collections index and the full list.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5" style={{ color: '#6b6560' }}><X className="w-4 h-4" /></button>
        </header>

        <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Preview + framing */}
          <div>
            <div
              ref={box}
              className={`relative overflow-hidden rounded-lg bg-warm ${ASPECT_CLS[aspect]} ${url ? 'cursor-move' : ''}`}
              style={{ touchAction: 'none' }}
              onPointerDown={url ? onPointerDown : undefined}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="Drag to reposition the cover"
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover select-none" style={imgStyle} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: '#8a8170' }}>No cover yet</div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent" />
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-end p-3">
                <h3 className="font-serif text-base text-white font-semibold leading-tight">{name}</h3>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-3">
              <div className={`relative w-24 shrink-0 overflow-hidden rounded bg-warm ${ASPECT_CLS[other]}`} title={`How it reads at ${other}`}>
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" style={imgStyle} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-[11px]" style={{ color: '#6b6560' }}>
                  Zoom {Math.round(f.scale * 100)}%
                  <input type="range" min={1} max={3} step={0.02} value={f.scale}
                    onChange={(e) => setF((c) => ({ ...c, scale: Number(e.target.value) }))}
                    className="mt-1 w-full" style={{ accentColor: '#1a1612' }} />
                </label>
                <p className="mt-1 text-[10px]" style={{ color: '#8a8170' }}>Drag the plate · x {Math.round(f.x)}% · y {Math.round(f.y)}% · small box shows the other card shape</p>
                <button type="button" onClick={() => setF(DEFAULT_CARD_FRAMING)} className="mt-2 text-[11px] underline" style={{ color: '#6b6560' }}>Centre again</button>
              </div>
            </div>
          </div>

          {/* Candidates */}
          <div className="min-w-0">
            {loading ? (
              <p className="flex items-center gap-2 text-sm" style={{ color: '#8a8170' }}><Loader2 className="w-4 h-4 animate-spin" /> Loading plates…</p>
            ) : (
              <>
                <div className="grid max-h-[52vh] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 lg:grid-cols-6">
                  {candidates.map((c) => {
                    const on = c.url === url;
                    return (
                      <button key={c.id} type="button" onClick={() => choose(c)} title={`${c.description}\n${c.book_title}`}
                        className="relative aspect-square overflow-hidden rounded border-2 transition-colors"
                        style={{ borderColor: on ? '#9e4a3a' : 'transparent' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </button>
                    );
                  })}
                </div>
                {candidates.length === 0 && (
                  <p className="text-sm" style={{ color: '#8a8170' }}>No extracted plates in this collection yet. Paste an image URL below.</p>
                )}
                <div className="mt-3 flex gap-2">
                  <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Or paste an image URL"
                    className="min-w-0 flex-1 border border-border-light bg-white px-2 py-1.5 text-[16px] sm:text-sm" />
                  <button type="button" onClick={usePasted} className="shrink-0 border px-3 py-1.5 text-xs" style={{ color: '#6b6560', borderColor: '#d4cfc4' }}>Use</button>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between px-6 py-4 border-t border-border-light">
          <span className="text-xs" style={{ color: note.startsWith('Save failed') || note.startsWith('Could not') ? '#9e4a3a' : '#8a8170' }}>
            {note || `${candidates.length} plates from this collection`}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-xs px-3 py-2 border" style={{ color: '#6b6560', borderColor: '#d4cfc4' }}>Cancel</button>
            <button type="button" onClick={save} disabled={saving || !url} className="text-xs px-4 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: '#1a1612' }}>
              {saving ? 'Saving…' : 'Save cover'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
