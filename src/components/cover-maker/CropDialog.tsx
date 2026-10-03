'use client';

import { useEffect, useRef, useState } from 'react';
import { findInkArea, findTitleBlock, loadImage } from './analyze';
import type { Crop } from './types';

type Drag = { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'new'; x0: number; y0: number; c0: Crop };

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * Choose the part of a page a layer shows. Drag the box or its corners, or
 * drag on the page to draw a new one.
 */
export function CropDialog({
  src, page, initial, onApply, onClose, applyLabel = 'Use this crop', onApplyGround,
}: {
  src: string;
  page: number | null;
  initial: Crop;
  onApply: (crop: Crop, threshold?: number) => void;
  onClose: () => void;
  applyLabel?: string;
  /** Offer "Use as background" too (choosing from All pages). */
  onApplyGround?: (crop: Crop) => void;
}) {
  const [crop, setCrop] = useState<Crop>(initial);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [threshold, setThreshold] = useState<number | undefined>();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    let live = true;
    loadImage(src).then(i => { if (live) setImg(i); }).catch(() => {});
    return () => { live = false; };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pt = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };

  const start = (mode: Drag['mode']) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = pt(e);
    drag.current = { mode, x0: p.x, y0: p.y, c0: mode === 'new' ? { x: p.x, y: p.y, w: 0, h: 0 } : crop };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pt(e);
    const { c0 } = d;
    const dx = p.x - d.x0, dy = p.y - d.y0;
    let next: Crop;
    if (d.mode === 'move') {
      next = { ...c0, x: clamp(c0.x + dx, 0, 1 - c0.w), y: clamp(c0.y + dy, 0, 1 - c0.h) };
    } else if (d.mode === 'new') {
      next = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(dx), h: Math.abs(dy) };
    } else {
      let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
      if (d.mode.includes('w')) x0 = Math.min(p.x, x1 - 0.02);
      if (d.mode.includes('e')) x1 = Math.max(p.x, x0 + 0.02);
      if (d.mode.includes('n')) y0 = Math.min(p.y, y1 - 0.02);
      if (d.mode.includes('s')) y1 = Math.max(p.y, y0 + 0.02);
      next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    setCrop(next);
  };

  const end = () => {
    if (drag.current?.mode === 'new' && (crop.w < 0.02 || crop.h < 0.02)) setCrop(drag.current.c0.w ? drag.current.c0 : initial);
    drag.current = null;
  };

  const auto = (fn: typeof findTitleBlock) => {
    if (!img) return;
    const r = fn(img);
    if (r) { setCrop(r.crop); setThreshold(Math.min(0.8, r.threshold + 0.05)); }
  };

  const aspect = img ? img.naturalWidth / img.naturalHeight : 0.66;
  const handle = 'absolute w-5 h-5 rounded-full bg-white border-2 border-[var(--accent-rust)] touch-none';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onPointerDown={onClose}>
      <div className="bg-[var(--bg-cream)] rounded-lg shadow-xl max-w-[min(92vw,900px)] w-full p-4 flex flex-col gap-3" onPointerDown={e => e.stopPropagation()}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium">Crop {page != null ? `page ${page}` : ''}</h2>
          <p className="text-sm text-[var(--text-muted)]">Drag the box or its corners, or drag on the page to draw a new one.</p>
        </div>
        <div className="flex justify-center bg-[var(--bg-warm)] rounded">
          <div
            ref={box}
            className="relative select-none touch-none"
            style={{ aspectRatio: String(aspect), height: 'min(64vh, 900px)', maxWidth: '100%' }}
            onPointerDown={start('new')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img && <img src={img.src} alt="" crossOrigin="anonymous" className="absolute inset-0 w-full h-full pointer-events-none" draggable={false} />}
            <div className="absolute inset-0 pointer-events-none" style={{
              background: 'rgba(20,16,12,0.55)',
              clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${crop.x * 100}% ${crop.y * 100}%,${crop.x * 100}% ${(crop.y + crop.h) * 100}%,${(crop.x + crop.w) * 100}% ${(crop.y + crop.h) * 100}%,${(crop.x + crop.w) * 100}% ${crop.y * 100}%,${crop.x * 100}% ${crop.y * 100}%)`,
            }} />
            <div
              className="absolute border-2 border-white cursor-move touch-none"
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,.4)' }}
              onPointerDown={start('move')}
            >
              <span className={`${handle} cursor-nwse-resize`} style={{ left: -10, top: -10 }} onPointerDown={start('nw')} />
              <span className={`${handle} cursor-nesw-resize`} style={{ right: -10, top: -10 }} onPointerDown={start('ne')} />
              <span className={`${handle} cursor-nesw-resize`} style={{ left: -10, bottom: -10 }} onPointerDown={start('sw')} />
              <span className={`${handle} cursor-nwse-resize`} style={{ right: -10, bottom: -10 }} onPointerDown={start('se')} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            <button className="cm-btn" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}>Whole page</button>
            <button className="cm-btn" disabled={!img} onClick={() => auto(findTitleBlock)}>Find the title</button>
            <button className="cm-btn" disabled={!img} onClick={() => auto(findInkArea)}>All the printing</button>
          </div>
          <div className="flex gap-2">
            <button className="cm-btn" onClick={onClose}>Cancel</button>
            {onApplyGround && <button className="cm-btn" onClick={() => onApplyGround(crop)}>Use as background</button>}
            <button className="cm-btn cm-btn-primary" onClick={() => onApply(crop, threshold)}>{applyLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
