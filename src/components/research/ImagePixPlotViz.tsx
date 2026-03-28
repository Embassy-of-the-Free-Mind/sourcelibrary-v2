'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

interface ImageItem {
  id: string; type: string; quality: number; thumbnail: string;
  book_title: string; book_author: string; book_year: number | null;
  book_id: string; book_slug?: string; subjects: string[];
  x: number; y: number; z: number; cluster: number;
}

interface ConstellationData {
  meta: { total_images: number; n_clusters: number; quality_threshold: number; generated_at: string };
  clusters: Record<string, unknown>;
  images: ImageItem[];
}

interface AtlasManifest {
  thumbSize: number; atlasSize: number; grid: number;
  perAtlas: number; totalAtlases: number; atlases: string[];
}

const ATLAS_PATH = '/atlases';
const COLS = 5;
const MIN_Z = 0.02;
const MAX_Z = 2.0;

export default function ImagePixPlotViz({ data }: { data: ConstellationData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ x: 0, y: 0, zoom: 0.05 });
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const atlasImgs = useRef<(HTMLImageElement | null)[]>([]);
  const manifestRef = useRef<AtlasManifest | null>(null);
  const rafRef = useRef(0);
  const dirtyRef = useRef(true);

  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [loadStatus, setLoadStatus] = useState('loading...');

  const stats = useMemo(() => ({
    total: data.meta.total_images,
    books: new Set(data.images.map(i => i.book_id)).size,
  }), [data]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${ATLAS_PATH}/manifest.json`);
        if (!res.ok) { setLoadStatus('no atlases found'); return; }
        const m: AtlasManifest = await res.json();
        manifestRef.current = m;
        atlasImgs.current = new Array(m.totalAtlases).fill(null);
        let loaded = 0;
        for (let i = 0; i < m.totalAtlases; i++) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            if (cancelled) return;
            atlasImgs.current[i] = img;
            loaded++;
            setLoadStatus(loaded < m.totalAtlases ? `${loaded}/${m.totalAtlases} sheets` : `${m.totalAtlases} sheets loaded`);
            dirtyRef.current = true;
            if (loaded === 1) {
              const rows = Math.ceil(m.totalAtlases / COLS);
              const totalW = COLS * m.atlasSize;
              const totalH = rows * m.atlasSize;
              camRef.current = {
                x: totalW / 2, y: totalH / 2,
                zoom: Math.min(container.clientWidth / totalW, container.clientHeight / totalH) * 0.9,
              };
            }
          };
          img.src = `${ATLAS_PATH}/${m.atlases[i]}`;
        }
      } catch { setLoadStatus('failed to load'); }
    })();

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      dirtyRef.current = true;
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(container);

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const m = manifestRef.current;
      const dpr = devicePixelRatio || 1;
      const w = canvas.width, h = canvas.height;
      const cam = camRef.current;
      const scale = cam.zoom * dpr;
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);
      if (!m) return;
      const toSx = (wx: number) => (wx - cam.x) * scale + w / 2;
      const toSy = (wy: number) => (wy - cam.y) * scale + h / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (let i = 0; i < m.totalAtlases; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const sx = toSx(col * m.atlasSize);
        const sy = toSy(row * m.atlasSize);
        const sz = m.atlasSize * scale;
        if (sx + sz < 0 || sx > w || sy + sz < 0 || sy > h) continue;
        const img = atlasImgs.current[i];
        if (img) ctx.drawImage(img, sx, sy, sz, sz);
        else { ctx.fillStyle = '#111118'; ctx.fillRect(sx, sy, sz, sz); }
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const cam = camRef.current;
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const nz = Math.max(MIN_Z, Math.min(MAX_Z, cam.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
      const wx = (mx - rect.width / 2) / cam.zoom + cam.x;
      const wy = (my - rect.height / 2) / cam.zoom + cam.y;
      cam.x = wx - (mx - rect.width / 2) / nz;
      cam.y = wy - (my - rect.height / 2) / nz;
      cam.zoom = nz;
      dirtyRef.current = true;
    };
    canvas.addEventListener('wheel', wheelHandler, { passive: false });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      obs.disconnect();
      canvas.removeEventListener('wheel', wheelHandler);
    };
  }, [data]);

  const hitTest = useCallback((clientX: number, clientY: number): number | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const m = manifestRef.current;
    if (!rect || !m) return null;
    const cam = camRef.current;
    const wx = (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x;
    const wy = (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y;
    const aC = Math.floor(wx / m.atlasSize), aR = Math.floor(wy / m.atlasSize);
    if (aC < 0 || aC >= COLS || aR < 0) return null;
    const ai = aR * COLS + aC;
    if (ai >= m.totalAtlases) return null;
    const iC = Math.floor((wx - aC * m.atlasSize) / m.thumbSize);
    const iR = Math.floor((wy - aR * m.atlasSize) / m.thumbSize);
    if (iC < 0 || iC >= m.grid || iR < 0 || iR >= m.grid) return null;
    const idx = ai * m.perAtlas + iR * m.grid + iC;
    return idx < data.images.length ? idx : null;
  }, [data.images.length]);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const c = camRef.current, d = dragRef.current;
    c.x = d.cx - (e.clientX - d.sx) / c.zoom;
    c.y = d.cy - (e.clientY - d.sy) / c.zoom;
    dirtyRef.current = true;
  }, []);

  const onUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 5) {
      setSelIdx(hitTest(e.clientX, e.clientY));
    }
  }, [hitTest]);

  const sel = selIdx !== null ? data.images[selIdx] : null;

  return (
    <div ref={containerRef} className="relative w-full h-full select-none bg-[#0a0a0f] overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0"
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />

      <div className="absolute top-4 left-5 z-10 pointer-events-none">
        <a href="/" className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors pointer-events-auto">Source Library</a>
        <div className="text-white/70 font-serif text-xl leading-tight">Image Atlas</div>
        <div className="text-white/25 text-xs mt-0.5 font-mono">{stats.total.toLocaleString()} illustrations from {stats.books.toLocaleString()} books</div>
        <div className="text-white/15 text-xs mt-0.5 font-mono">{loadStatus}</div>
      </div>

      {sel && (
        <div className="absolute top-0 right-0 w-[380px] h-full bg-white border-l border-black/10 z-20 flex flex-col shadow-2xl overflow-hidden"
          onWheelCapture={e => e.stopPropagation()}
          onPointerDownCapture={e => e.stopPropagation()}>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">
            <span className="text-gray-400 text-xs font-mono">{sel.type.replace(/_/g, ' ')}</span>
            <button onClick={() => setSelIdx(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>
          {sel.thumbnail && (
            <div className="bg-gray-50 flex items-center justify-center p-6 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sel.thumbnail} alt={sel.subjects.join(', ') || sel.type}
                className="max-w-full max-h-[320px] object-contain rounded shadow-md" />
            </div>
          )}
          <div className="p-4 overflow-y-auto flex-1 min-h-0">
            {sel.subjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {sel.subjects.map(s => (<span key={s} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">{s}</span>))}
              </div>
            )}
            <a href={`/book/${sel.book_slug || sel.book_id}`} target="_blank" rel="noopener noreferrer"
              className="font-serif text-base text-gray-900 hover:text-black leading-snug block mb-1">{sel.book_title}</a>
            <div className="text-sm text-gray-500 mb-4">
              {sel.book_author !== 'Unknown' ? sel.book_author : ''}{sel.book_author !== 'Unknown' && sel.book_year ? ' · ' : ''}{sel.book_year || ''}
            </div>
            <div className="flex flex-col gap-2">
              <a href={`/gallery?book=${sel.book_id}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">Browse all images from this book &rarr;</a>
              <a href={`/book/${sel.book_slug || sel.book_id}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">View book &rarr;</a>
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 right-5 z-10 text-xs text-white/20 font-mono">Scroll to zoom · Drag to pan · Click to inspect</div>
    </div>
  );
}
