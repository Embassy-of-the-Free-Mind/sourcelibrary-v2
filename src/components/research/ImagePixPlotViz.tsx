'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// ── Types ──

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

// ── Constants ──

const ATLAS_PATH = '/atlases';
const COLS = 5; // atlases per row in the mosaic
const MIN_Z = 0.02;
const MAX_Z = 6;

// ── Component ──

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
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const [loadStatus, setLoadStatus] = useState('loading...');

  const stats = useMemo(() => ({
    total: data.meta.total_images,
    books: new Set(data.images.map(i => i.book_id)).size,
  }), [data]);

  // Load manifest + atlases
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
            setLoadStatus(`${loaded}/${m.totalAtlases} sheets`);
            dirtyRef.current = true;

            // Set initial zoom to fit all content once first atlas loads
            if (loaded === 1) {
              const rows = Math.ceil(m.totalAtlases / COLS);
              const totalW = COLS * m.atlasSize;
              const totalH = rows * m.atlasSize;
              const fitZoom = Math.min(
                container.clientWidth / totalW,
                container.clientHeight / totalH,
              ) * 0.9;
              camRef.current = { x: totalW / 2, y: totalH / 2, zoom: fitZoom };
              dirtyRef.current = true;
            }
          };
          img.src = `${ATLAS_PATH}/${m.atlases[i]}`;
        }
      } catch { setLoadStatus('failed to load'); }
    })();

    // Canvas sizing
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

    // Render loop
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

      // Background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      if (!m) return;

      // World -> screen
      const toSx = (wx: number) => (wx - cam.x) * scale + w / 2;
      const toSy = (wy: number) => (wy - cam.y) * scale + h / 2;

      // Draw each atlas as a tile in the mosaic
      for (let i = 0; i < m.totalAtlases; i++) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const wx = col * m.atlasSize;
        const wy = row * m.atlasSize;
        const sx = toSx(wx);
        const sy = toSy(wy);
        const sz = m.atlasSize * scale;

        // Skip if off-screen
        if (sx + sz < 0 || sx > w || sy + sz < 0 || sy > h) continue;

        const img = atlasImgs.current[i];
        if (img) {
          ctx.drawImage(img, sx, sy, sz, sz);
        } else {
          ctx.fillStyle = '#111118';
          ctx.fillRect(sx, sy, sz, sz);
        }
      }

      // Highlight hovered/selected image
      const highlightIdx = hovIdx ?? selIdx;
      if (highlightIdx !== null) {
        const atlasIdx = Math.floor(highlightIdx / m.perAtlas);
        const within = highlightIdx % m.perAtlas;
        const imgCol = within % m.grid;
        const imgRow = Math.floor(within / m.grid);
        const aCol = atlasIdx % COLS;
        const aRow = Math.floor(atlasIdx / COLS);

        const wx = aCol * m.atlasSize + imgCol * m.thumbSize;
        const wy = aRow * m.atlasSize + imgRow * m.thumbSize;
        const sx = toSx(wx);
        const sy = toSy(wy);
        const sz = m.thumbSize * scale;

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, 2 * dpr);
        ctx.strokeRect(sx, sy, sz, sz);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); obs.disconnect(); };
  }, [data, hovIdx, selIdx]);

  // ── Interaction ──
  const worldAt = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { wx: 0, wy: 0 };
    const cam = camRef.current;
    return {
      wx: (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x,
      wy: (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y,
    };
  }, []);

  const hitTest = useCallback((wx: number, wy: number): number | null => {
    const m = manifestRef.current;
    if (!m) return null;
    const aCol = Math.floor(wx / m.atlasSize);
    const aRow = Math.floor(wy / m.atlasSize);
    if (aCol < 0 || aCol >= COLS || aRow < 0) return null;
    const atlasIdx = aRow * COLS + aCol;
    if (atlasIdx >= m.totalAtlases) return null;
    const localX = wx - aCol * m.atlasSize;
    const localY = wy - aRow * m.atlasSize;
    const imgCol = Math.floor(localX / m.thumbSize);
    const imgRow = Math.floor(localY / m.thumbSize);
    if (imgCol < 0 || imgCol >= m.grid || imgRow < 0 || imgRow >= m.grid) return null;
    const idx = atlasIdx * m.perAtlas + imgRow * m.grid + imgCol;
    if (idx >= data.images.length) return null;
    return idx;
  }, [data.images.length]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cam = camRef.current;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.88 : 1.14;
    const newZoom = Math.max(MIN_Z, Math.min(MAX_Z, cam.zoom * factor));
    const worldX = (mx - rect.width / 2) / cam.zoom + cam.x;
    const worldY = (my - rect.height / 2) / cam.zoom + cam.y;
    cam.x = worldX - (mx - rect.width / 2) / newZoom;
    cam.y = worldY - (my - rect.height / 2) / newZoom;
    cam.zoom = newZoom;
    dirtyRef.current = true;
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) {
      const cam = camRef.current;
      cam.x = d.cx - (e.clientX - d.sx) / cam.zoom;
      cam.y = d.cy - (e.clientY - d.sy) / cam.zoom;
      dirtyRef.current = true;
      setHovIdx(null);
    } else {
      const { wx, wy } = worldAt(e.clientX, e.clientY);
      const idx = hitTest(wx, wy);
      if (idx !== hovIdx) { setHovIdx(idx); dirtyRef.current = true; }
    }
  }, [worldAt, hitTest, hovIdx]);

  const onUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 5) {
      const { wx, wy } = worldAt(e.clientX, e.clientY);
      setSelIdx(hitTest(wx, wy));
      dirtyRef.current = true;
    }
  }, [worldAt, hitTest]);

  const sel = selIdx !== null ? data.images[selIdx] : null;
  const hov = hovIdx !== null && hovIdx !== selIdx ? data.images[hovIdx] : null;

  return (
    <div ref={containerRef} className="relative w-full h-full select-none bg-[#0a0a0f]">
      <canvas ref={canvasRef} className="absolute inset-0"
        style={{ cursor: dragRef.current ? 'grabbing' : hovIdx !== null ? 'pointer' : 'grab' }}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />

      {/* Top-left */}
      <div className="absolute top-4 left-5 z-10 pointer-events-none">
        <a href="/" className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors pointer-events-auto">Source Library</a>
        <div className="text-white/70 font-serif text-xl leading-tight">Image Atlas</div>
        <div className="text-white/25 text-xs mt-0.5 font-mono">
          {stats.total.toLocaleString()} illustrations from {stats.books.toLocaleString()} books
        </div>
        <div className="text-white/15 text-xs mt-0.5 font-mono">{loadStatus}</div>
      </div>

      {/* Hover tooltip */}
      {hov && <Tip image={hov} />}

      {/* Selected detail */}
      {sel && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md border border-black/10 rounded-lg p-4 z-20 shadow-2xl max-w-[420px] w-full"
          onClick={e => e.stopPropagation()}>
          <button onClick={() => { setSelIdx(null); dirtyRef.current = true; }}
            className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          <div className="flex gap-4">
            {sel.thumbnail && (
              <div className="shrink-0 rounded overflow-hidden bg-gray-100 w-[140px] h-[140px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sel.thumbnail} alt={sel.subjects.join(', ') || sel.type}
                  className="w-full h-full object-contain" loading="lazy" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 font-medium">
                  {sel.type.replace(/_/g, ' ')}
                </span>
              </div>
              {sel.subjects.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {sel.subjects.slice(0, 4).map(s => (
                    <span key={s} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{s}</span>
                  ))}
                </div>
              )}
              <a href={`/book/${sel.book_slug || sel.book_id}`} target="_blank" rel="noopener noreferrer"
                className="font-serif text-sm text-gray-900 hover:text-black leading-tight block mb-1">
                {sel.book_title}
              </a>
              <div className="text-sm text-gray-500">
                {sel.book_author !== 'Unknown' ? sel.book_author : ''}
                {sel.book_author !== 'Unknown' && sel.book_year ? ' · ' : ''}
                {sel.book_year || ''}
              </div>
              <a href={`/gallery?book=${sel.book_id}`} target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 transition-colors text-xs mt-2 inline-block">
                View in Gallery &rarr;
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 right-5 z-10 text-xs text-white/20 font-mono">
        Scroll to zoom · Drag to pan · Click to inspect
      </div>
    </div>
  );
}

function Tip({ image: i }: { image: ImageItem }) {
  const [p, setP] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const h = (e: MouseEvent) => setP({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);
  return (
    <div className="fixed pointer-events-none bg-black/80 backdrop-blur-md border border-white/10 rounded-md p-2.5 max-w-[260px] z-30"
      style={{ left: p.x + 16, top: p.y - 40 }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="px-1.5 py-0.5 text-xs rounded bg-white/10 text-white/70">{i.type.replace(/_/g, ' ')}</span>
        {i.subjects.slice(0, 2).map(s => (
          <span key={s} className="px-1.5 py-0.5 text-xs rounded bg-white/5 text-white/40">{s}</span>
        ))}
      </div>
      <div className="text-sm text-white/60 leading-tight">
        {i.book_title}{i.book_year ? ` (${i.book_year})` : ''}
      </div>
    </div>
  );
}
