'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useStableSession } from '@/hooks/useStableSession';

interface Framing { x: number; y: number; scale: number }

/**
 * Admin-only inline framing tool for a background image rendered by
 * <ParallaxImage frameSlot="..."> elsewhere in the same section. Renders nothing
 * for non-admins. When active, drag the image to pan and use the zoom slider to
 * resize; Save persists to /api/admin/image-framing for that slot. Reusable: drop
 * it inside any `relative` section that contains a [data-frame-slot] image.
 */
export default function ImageFramingEditor({ slot, initial }: { slot: string; initial?: Framing | null }) {
  const { data: session } = useStableSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'admin' || role === 'superadmin';

  const router = useRouter();
  const start = initial ?? { x: 50, y: 50, scale: 1 };
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Framing>(start);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const target = useCallback(() => document.querySelector<HTMLImageElement>(`[data-frame-slot="${slot}"]`), [slot]);

  // Live-apply current framing to the rendered image.
  const apply = useCallback((fr: Framing) => {
    const img = target();
    if (!img) return;
    const op = `${fr.x}% ${fr.y}%`;
    img.style.objectPosition = op;
    img.style.transformOrigin = op;
    img.style.transform = `scale(${fr.scale})`;
  }, [target]);

  useEffect(() => { if (editing) apply(f); }, [editing, f, apply]);

  if (!isAdmin) return null;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: f.x, y: f.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !overlayRef.current) return;
    const { width, height } = overlayRef.current.getBoundingClientRect();
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    // Dragging the image right reveals its left edge → decrease object-position x.
    setF((cur) => ({
      ...cur,
      x: clamp(drag.current!.x - (dx / width) * 100, 0, 100),
      y: clamp(drag.current!.y - (dy / height) * 100, 0, 100),
    }));
  };
  const onPointerUp = () => { drag.current = null; };

  const cancel = () => { setEditing(false); setF(start); apply(start); setMsg(''); };

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/admin/image-framing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, ...f }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      setMsg('Saved');
      setEditing(false);
      router.refresh();
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : 'failed'}`);
    } finally {
      setSaving(false);
    }
  };

  const btn = 'text-xs px-3 py-1.5 rounded-md font-medium transition-colors';

  return (
    <>
      {/* Drag surface — only while editing. Sits above the bg, below the panel. */}
      {editing && (
        <div
          ref={overlayRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute inset-0 z-20 cursor-move"
          style={{ touchAction: 'none' }}
          aria-label="Drag to reposition the background image"
        />
      )}

      {/* Control panel */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-2">
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)}
            className={`${btn} bg-white/90 text-black hover:bg-white shadow`}>
            Frame image
          </button>
        ) : (
          <div className="bg-black/80 backdrop-blur text-white rounded-lg p-3 w-64 shadow-lg">
            <div className="text-xs font-semibold mb-2">Frame background</div>
            <label className="block text-[11px] text-white/70 mb-2">
              Zoom {Math.round(f.scale * 100)}%
              <input type="range" min={1} max={3} step={0.02} value={f.scale}
                onChange={(e) => setF((c) => ({ ...c, scale: Number(e.target.value) }))}
                className="w-full accent-white mt-1" />
            </label>
            <div className="text-[10px] text-white/50 mb-2">
              Drag the image to reposition · x {Math.round(f.x)}% · y {Math.round(f.y)}%
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={save} disabled={saving}
                className={`${btn} bg-white text-black hover:bg-white/90 disabled:opacity-50`}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={cancel} disabled={saving}
                className={`${btn} bg-white/10 text-white hover:bg-white/20`}>Cancel</button>
              <button type="button" onClick={() => setF({ x: 50, y: 50, scale: 1 })} disabled={saving}
                className={`${btn} bg-white/10 text-white hover:bg-white/20`}>Reset</button>
            </div>
            {msg && <div className="text-[11px] mt-2 text-white/80">{msg}</div>}
          </div>
        )}
      </div>
    </>
  );
}
