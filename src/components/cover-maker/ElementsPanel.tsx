'use client';

import { useEffect, useRef } from 'react';
import { loadImage } from './analyze';
import { GROUP_LABEL, type Asset, type AssetGroup } from './assets';
import type { Crop } from './types';

/**
 * Every element a cover can use, as tiles. Click a tile to add it, or drag it
 * onto the cover. When a picture on the cover is selected, picture tiles offer
 * Replace instead.
 */

const ORDER: AssetGroup[] = ['grounds', 'lettering', 'pictures', 'ornaments', 'type', 'decoration'];
const JUMP: Record<AssetGroup, string> = { grounds: 'Backgrounds', lettering: 'Lettering', pictures: 'Plates', ornaments: 'Ornaments', type: 'Type', decoration: 'Frames' };

/** A crop of a page drawn into a tile, for elements that have no thumbnail of their own. */
function CropThumb({ src, crop }: { src: string; crop: Crop }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    loadImage(src).then(img => {
      const c = ref.current;
      if (!live || !c) return;
      const sw = crop.w * img.naturalWidth, sh = crop.h * img.naturalHeight;
      const s = Math.min(240 / sw, 160 / sh);
      c.width = Math.max(1, Math.round(sw * s));
      c.height = Math.max(1, Math.round(sh * s));
      c.getContext('2d')!.drawImage(img, crop.x * img.naturalWidth, crop.y * img.naturalHeight, sw, sh, 0, 0, c.width, c.height);
    }).catch(() => {});
    return () => { live = false; };
  }, [src, crop]);
  return <canvas ref={ref} className="max-w-full max-h-full" />;
}

function Swatch({ color, texture }: { color: string; texture: string }) {
  const bg = texture === 'cloth'
    ? `repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,.08) 0 1px, transparent 1px 3px), ${color}`
    : texture === 'leather' ? `radial-gradient(circle at 30% 30%, rgba(255,255,255,.08), transparent 60%), ${color}` : color;
  return <div className="w-full h-full rounded-sm" style={{ background: bg }} />;
}

function ShapePreview({ asset }: { asset: Extract<Asset, { kind: 'shape' | 'text' }> }) {
  if (asset.kind === 'text') {
    return <span className={`px-2 text-center leading-tight ${asset.style === 'title' ? 'text-[13px] uppercase tracking-wider' : 'text-[11px]'}`}>{asset.text.length > 60 ? `${asset.text.slice(0, 58)}…` : asset.text}</span>;
  }
  const s = asset.shape;
  return (
    <svg viewBox="0 0 60 80" className="h-[70%]">
      {s === 'frame' && <rect x="6" y="6" width="48" height="68" fill="none" stroke="#9e7c3c" strokeWidth="2" />}
      {s === 'double-frame' && <><rect x="5" y="5" width="50" height="70" fill="none" stroke="#9e7c3c" strokeWidth="2" /><rect x="10" y="10" width="40" height="60" fill="none" stroke="#9e7c3c" strokeWidth="1" /></>}
      {s === 'rule' && <rect x="8" y="39" width="44" height="2" fill="#9e7c3c" />}
      {s === 'oval' && <ellipse cx="30" cy="40" rx="22" ry="30" fill="none" stroke="#9e7c3c" strokeWidth="2" />}
      {s === 'panel' && <rect x="10" y="14" width="40" height="52" fill="rgba(0,0,0,.18)" stroke="rgba(0,0,0,.35)" />}
      {s === 'label' && <rect x="8" y="28" width="44" height="24" fill="#e9dfc6" stroke="#8a7a5c" />}
    </svg>
  );
}

/** Scroll the panel, never the page, to a group. */
function jump(g: AssetGroup) {
  const el = document.getElementById(`cm-group-${g}`);
  const box = el?.closest('[data-cm-scroll]');
  if (el && box) box.scrollTo({ top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8, behavior: 'smooth' });
}

export function ElementsPanel({ assets, letteringReady, canReplace, onAdd, onReplace }: {
  assets: Asset[];
  letteringReady: boolean;
  canReplace: boolean;
  onAdd: (a: Asset) => void;
  onReplace: (a: Asset) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap gap-1 -mb-2">
        {ORDER.filter(g => assets.some(a => a.group === g) || (g === 'lettering' && !letteringReady)).map(g => (
          <button key={g} type="button" className="cm-chip" onClick={() => jump(g)}>
            {JUMP[g]}
          </button>
        ))}
      </nav>
      <p className="text-sm text-[var(--text-muted)]">
        Click to add, or drag onto the cover.{canReplace ? ' A picture is selected: Replace swaps it for another.' : ''} Choosing a binding or cloth changes the background.
      </p>
      {ORDER.map(group => {
        const items = assets.filter(a => a.group === group);
        if (!items.length && !(group === 'lettering' && !letteringReady)) return null;
        const wide = group === 'lettering' || group === 'type';
        return (
          <section key={group} id={`cm-group-${group}`} className="scroll-mt-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">{GROUP_LABEL[group]}</h3>
            {group === 'lettering' && !letteringReady && <p className="text-sm text-[var(--text-muted)]">Reading the title page…</p>}
            <div className={`grid gap-2 ${wide ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {items.map(a => {
                const replaceable = canReplace && a.kind === 'image' && a.group !== 'grounds';
                return (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('application/x-cover-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    className="group relative flex flex-col gap-1 cursor-grab active:cursor-grabbing"
                    title={a.label}
                  >
                    <button
                      type="button"
                      onClick={() => (replaceable ? onReplace(a) : onAdd(a))}
                      className={`relative flex items-center justify-center overflow-hidden rounded bg-[var(--bg-warm)] border border-transparent hover:border-[var(--accent-rust)] ${wide ? 'h-20' : a.group === 'grounds' ? 'aspect-[2/3]' : 'aspect-square'}`}
                    >
                      {a.kind === 'image' && (a.thumb && a.group !== 'lettering'
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={a.thumb} alt="" draggable={false} loading="lazy" className={`w-full h-full ${a.group === 'grounds' ? 'object-cover' : 'object-contain'}`} />
                        : <CropThumb src={a.leaf.display} crop={a.crop} />)}
                      {a.kind === 'fill' && <Swatch color={a.color} texture={a.texture} />}
                      {(a.kind === 'shape' || a.kind === 'text') && <ShapePreview asset={a} />}
                      {replaceable && <span className="absolute bottom-1 right-1 text-[11px] px-1.5 py-0.5 rounded bg-[var(--text-primary)] text-[var(--bg-cream)]">Replace</span>}
                    </button>
                    {replaceable && (
                      <button type="button" className="text-[11px] text-left text-[var(--text-muted)] hover:underline" onClick={() => onAdd(a)}>or add as new</button>
                    )}
                    {(a.kind === 'fill' || a.kind === 'shape' || a.kind === 'text' || a.group === 'grounds') && (
                      <span className="text-[11px] leading-tight text-[var(--text-muted)] truncate">{a.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
