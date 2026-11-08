'use client';

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CropSquare, cropKey, type Crop } from './CollectionsBrowser';

const centre = (src: string, aspect: number): Crop => {
  const w = aspect >= 1 ? 1 / aspect : 1; // side = the shorter edge
  return { src, aspect, w, x: (1 - w) / 2, y: (1 - (w * aspect)) / 2 };
};

/** Learns each picture's proportions, so a suggestion can be cut square from its centre. */
function useAspects(srcs: string[]) {
  const [a, setA] = useState<Record<string, number>>({});
  useEffect(() => {
    srcs.forEach((src) => {
      const i = new Image();
      i.onload = () => setA((p) => ({ ...p, [src]: i.naturalWidth / i.naturalHeight }));
      i.src = src;
    });
  }, [srcs]);
  return a;
}

export default function ThumbMaker({ slug, name, suggested, all }: { slug: string; name: string; suggested: string[]; all: string[] }) {
  const aspects = useAspects(suggested);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [saved, setSaved] = useState<Crop | null>(null);
  const [own, setOwn] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => { try { const v = localStorage.getItem(cropKey(slug)); if (v) { const c = JSON.parse(v); setSaved(c); setCrop(c); } } catch { /* none */ } }, [slug]);

  const pick = (src: string) => {
    const known = aspects[src];
    if (known) { setCrop(centre(src, known)); return; }
    const i = new Image();
    i.onload = () => setCrop(centre(src, i.naturalWidth / i.naturalHeight));
    i.src = src;
  };

  // The square as fractions of the picture: side h = w * aspect of its height.
  const clamp = (c: Crop): Crop => ({ ...c, x: Math.min(Math.max(0, c.x), 1 - c.w), y: Math.min(Math.max(0, c.y), 1 - c.w * c.aspect) });
  const maxW = crop ? (crop.aspect >= 1 ? 1 / crop.aspect : 1) : 1;
  const size = (v: number) => crop && setCrop(clamp({ ...crop, w: v, x: crop.x + (crop.w - v) / 2, y: crop.y + ((crop.w - v) * crop.aspect) / 2 }));

  const onDown = (e: React.PointerEvent) => { if (!crop) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; const r = box.current?.getBoundingClientRect();
    if (!d || !r || !crop) return;
    setCrop(clamp({ ...crop, x: d.x + (e.clientX - d.px) / r.width, y: d.y + (e.clientY - d.py) / r.height }));
  };

  const save = () => { if (!crop) return; localStorage.setItem(cropKey(slug), JSON.stringify(crop)); setSaved(crop); };
  const reset = () => { localStorage.removeItem(cropKey(slug)); setSaved(null); };

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-[1300px] mx-auto px-6 md:px-12 py-8 md:py-12">
        <h1 className="text-4xl sm:text-5xl text-primary font-display">Thumbnail for {name}</h1>
        <p className="text-secondary mt-3 max-w-2xl">The square picture that stands for the collection on cards and lists. Pick one of the suggestions, or choose any picture from the collection and move the square to the part you want.</p>

        <h2 className="text-lg font-semibold text-primary mt-10 mb-3">Suggested</h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {suggested.map((src) => (
            <button key={src} type="button" onClick={() => pick(src)} className={`block border-2 ${crop?.src === src ? 'border-primary' : 'border-transparent hover:border-border-medium'}`} aria-label="Use this suggestion">
              {aspects[src] ? <CropSquare crop={centre(src, aspects[src])} /> : <div className="aspect-square bg-warm" />}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => setOwn(!own)} className="mt-6 text-sm text-primary underline underline-offset-2 decoration-border-medium hover:decoration-primary">{own ? 'Hide the collection’s pictures' : `Choose your own from ${all.length} pictures`}</button>
        {own && (
          <div className="mt-3 flex flex-wrap gap-2 max-h-[340px] overflow-y-auto border border-border-light bg-white p-2">
            {all.map((src) => (
              <button key={src} type="button" onClick={() => pick(src)} className={`h-[110px] border-2 ${crop?.src === src ? 'border-primary' : 'border-transparent hover:border-border-medium'}`}>
                <img src={src} alt="" loading="lazy" className="h-full w-auto block" />
              </button>
            ))}
          </div>
        )}

        {crop && (
          <div className="grid md:grid-cols-[1fr_280px] gap-8 mt-10 items-start">
            <div>
              <h2 className="text-lg font-semibold text-primary mb-3">Move the square</h2>
              <div ref={box} className="relative inline-block select-none touch-none" style={{ maxWidth: '100%' }}>
                <img src={crop.src} alt="" draggable={false} className="block max-h-[520px] w-auto max-w-full" />
                <div className="absolute inset-0 bg-black/45 pointer-events-none" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${crop.x * 100}% ${crop.y * 100}%,${crop.x * 100}% ${(crop.y + crop.w * crop.aspect) * 100}%,${(crop.x + crop.w) * 100}% ${(crop.y + crop.w * crop.aspect) * 100}%,${(crop.x + crop.w) * 100}% ${crop.y * 100}%,${crop.x * 100}% ${crop.y * 100}%)` }} />
                <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
                  className="absolute border-2 border-white cursor-move" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.w * crop.aspect * 100}%` }} />
              </div>
              <label className="flex items-center gap-3 mt-4 text-sm text-secondary max-w-md">Size
                <input type="range" min={maxW * 0.25} max={maxW} step={0.005} value={crop.w} onChange={(e) => size(Number(e.target.value))} className="flex-1" />
              </label>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary mb-3">On a card</h2>
              <div className="w-[220px]"><CropSquare crop={crop} /><span className="block mt-2.5 text-[17px] text-primary font-display">{name}</span></div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={save} className="bg-primary text-cream text-sm px-5 py-2.5">Use this</button>
                {saved && <button type="button" onClick={reset} className="text-sm text-secondary underline underline-offset-2">Go back to the default</button>}
              </div>
              {saved && <p className="text-sm text-muted mt-3">Saved in this browser. <Link href="/revamp/c" className="underline underline-offset-2">See it on Collections</Link></p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
