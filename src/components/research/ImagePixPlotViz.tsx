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
  clusters: Record<string, { label?: string; size?: number; top_subjects?: string[] }>;
  images: ImageItem[];
}

interface AtlasManifest {
  thumbSize: number; atlasSize: number; grid: number;
  perAtlas: number; totalImages: number; totalAtlases: number; atlases: string[];
  imageIds?: string[];
}

// Precomputed per-image rendering data
interface RenderImage {
  worldX: number;
  worldY: number;
  atlasIdx: number;
  srcX: number;
  srcY: number;
  image: ImageItem;
}

const ATLAS_PATH = '/atlases';
const WORLD_SIZE = 8000;
const PADDING = 400;
const MIN_Z = 0.05;
const MAX_Z = 12.0;
const CELL_SIZE = 20;   // grid cell size (thumbnail + 2px gap)
const THUMB_WORLD = 18;  // drawn size within each cell

/**
 * Snap UMAP positions to a non-overlapping grid.
 * Each image gets a unique grid cell; collisions are resolved by
 * spiraling outward to the nearest empty cell.
 */
function snapToGrid(images: ImageItem[]): Float32Array {
  const usable = WORLD_SIZE - 2 * PADDING;
  const gridW = Math.ceil(usable / CELL_SIZE);
  const gridH = gridW;
  const occupied = new Uint8Array(gridW * gridH); // 0 = empty
  const out = new Float32Array(images.length * 2); // [x0, y0, x1, y1, ...]

  // Sort by distance to centroid so central images get priority placement
  const cx = images.reduce((s, im) => s + im.x, 0) / images.length;
  const cy = images.reduce((s, im) => s + im.y, 0) / images.length;
  const order = images.map((im, i) => ({
    i,
    d: (im.x - cx) ** 2 + (im.y - cy) ** 2,
  }));
  order.sort((a, b) => a.d - b.d);

  for (const { i } of order) {
    const im = images[i];
    const idealCol = Math.round(im.x * (gridW - 1));
    const idealRow = Math.round(im.y * (gridH - 1));

    // Try ideal cell first, then spiral outward
    let placed = false;
    for (let r = 0; r < 200 && !placed; r++) {
      const startC = Math.max(0, idealCol - r);
      const endC = Math.min(gridW - 1, idealCol + r);
      const startR = Math.max(0, idealRow - r);
      const endR = Math.min(gridH - 1, idealRow + r);

      // Only check the ring at radius r (skip interior which was checked)
      for (let row = startR; row <= endR && !placed; row++) {
        for (let col = startC; col <= endC && !placed; col++) {
          // Only the border of the ring
          if (r > 0 && row > startR && row < endR && col > startC && col < endC) continue;
          const key = row * gridW + col;
          if (!occupied[key]) {
            occupied[key] = 1;
            out[i * 2] = PADDING + col * CELL_SIZE + CELL_SIZE / 2;
            out[i * 2 + 1] = PADDING + row * CELL_SIZE + CELL_SIZE / 2;
            placed = true;
          }
        }
      }
    }

    // Fallback (shouldn't happen with 27% fill)
    if (!placed) {
      out[i * 2] = PADDING + im.x * usable;
      out[i * 2 + 1] = PADDING + im.y * usable;
    }
  }

  return out;
}

export default function ImagePixPlotViz({ data }: { data: ConstellationData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, zoom: 0.12 });
  const dragRef = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const atlasImgs = useRef<(HTMLImageElement | null)[]>([]);
  const manifestRef = useRef<AtlasManifest | null>(null);
  const rafRef = useRef(0);
  const dirtyRef = useRef(true);
  const renderImagesRef = useRef<RenderImage[]>([]);

  const [selected, setSelected] = useState<ImageItem | null>(null);
  const [loadStatus, setLoadStatus] = useState('loading...');

  const stats = useMemo(() => ({
    total: data.meta.total_images,
    books: new Set(data.images.map(i => i.book_id)).size,
  }), [data]);

  // Precompute world positions with grid snapping (no overlaps)
  useEffect(() => {
    const positions = snapToGrid(data.images);
    renderImagesRef.current = data.images.map((img, i) => ({
      worldX: positions[i * 2],
      worldY: positions[i * 2 + 1],
      atlasIdx: -1,
      srcX: 0,
      srcY: 0,
      image: img,
    }));
    dirtyRef.current = true;
  }, [data.images]);

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

        // Map image IDs to atlas positions
        const idToAtlasPos = new Map<string, number>();
        if (m.imageIds) {
          m.imageIds.forEach((id, i) => idToAtlasPos.set(id, i));
        }

        // Fill atlas source coordinates
        renderImagesRef.current.forEach((ri, dataIdx) => {
          const atlasPos = idToAtlasPos.get(ri.image.id) ?? dataIdx;
          const ai = Math.floor(atlasPos / m.perAtlas);
          const posInAtlas = atlasPos % m.perAtlas;
          ri.atlasIdx = ai;
          ri.srcX = (posInAtlas % m.grid) * m.thumbSize;
          ri.srcY = Math.floor(posInAtlas / m.grid) * m.thumbSize;
        });

        // Load atlas sheets
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
              camRef.current = {
                x: WORLD_SIZE / 2,
                y: WORLD_SIZE / 2,
                zoom: Math.min(container.clientWidth, container.clientHeight) / (WORLD_SIZE * 1.1),
              };
            }
          };
          img.src = `${ATLAS_PATH}/${m.atlases[i]}`;
        }
      } catch { setLoadStatus('failed to load'); }
    })();

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      dirtyRef.current = true;
    };
    resize();
    window.addEventListener('resize', resize);

    // --- Render loop ---
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

      const drawSize = THUMB_WORLD * scale;
      const halfDraw = drawSize / 2;
      const items = renderImagesRef.current;
      const atlases = atlasImgs.current;
      const thumbSz = m.thumbSize;

      // If thumbnails too small, draw dots
      if (drawSize < 1.5) {
        ctx.fillStyle = 'rgba(140, 130, 180, 0.35)';
        for (let i = 0; i < items.length; i++) {
          const sx = toSx(items[i].worldX);
          const sy = toSy(items[i].worldY);
          if (sx < -2 || sx > w + 2 || sy < -2 || sy > h + 2) continue;
          ctx.fillRect(sx - 0.5, sy - 0.5, 1.5, 1.5);
        }
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = cam.zoom > 2 ? 'high' : 'medium';

      let drawn = 0;
      for (let i = 0; i < items.length; i++) {
        const ri = items[i];
        const sx = toSx(ri.worldX) - halfDraw;
        const sy = toSy(ri.worldY) - halfDraw;
        if (sx + drawSize < 0 || sx > w || sy + drawSize < 0 || sy > h) continue;
        const atlas = atlases[ri.atlasIdx];
        if (!atlas) continue;
        ctx.drawImage(atlas, ri.srcX, ri.srcY, thumbSz, thumbSz, sx, sy, drawSize, drawSize);
        drawn++;
      }

      // Visible count HUD
      if (drawn > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.font = `${11 * dpr}px monospace`;
        ctx.fillText(`${drawn.toLocaleString()} visible`, 10 * dpr, h - 10 * dpr);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    // Zoom
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const cam = camRef.current;
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      const nz = Math.max(MIN_Z, Math.min(MAX_Z, cam.zoom * factor));
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
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', wheelHandler);
    };
  }, [data]);

  // Hit test — find closest image in world space
  const hitTest = useCallback((clientX: number, clientY: number): ImageItem | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cam = camRef.current;
    const wx = (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x;
    const wy = (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y;
    const hitR2 = (CELL_SIZE / 2) * (CELL_SIZE / 2);
    let best: RenderImage | null = null;
    let bestDist = hitR2;
    const items = renderImagesRef.current;
    for (let i = 0; i < items.length; i++) {
      const dx = items[i].worldX - wx, dy = items[i].worldY - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { bestDist = d2; best = items[i]; }
    }
    return best?.image ?? null;
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    const c = camRef.current;
    c.x = d.cx - (e.clientX - d.sx) / c.zoom;
    c.y = d.cy - (e.clientY - d.sy) / c.zoom;
    dirtyRef.current = true;
  }, []);

  const onUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) {
      setSelected(hitTest(e.clientX, e.clientY));
    }
  }, [hitTest]);

  return (
    <div ref={containerRef} className="relative w-full h-full select-none bg-[#0a0a0f] overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0"
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />

      <div className="absolute top-4 left-5 z-10 pointer-events-none">
        <a href="/" className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors pointer-events-auto">Source Library</a>
        <div className="text-white/70 font-serif text-xl leading-tight">Image Constellation</div>
        <div className="text-white/25 text-xs mt-0.5 font-mono">{stats.total.toLocaleString()} illustrations from {stats.books.toLocaleString()} books</div>
        <div className="text-white/15 text-xs mt-0.5 font-mono">{loadStatus}</div>
      </div>

      {selected && (
        <div className="absolute top-0 right-0 w-[380px] h-full bg-white border-l border-black/10 z-20 flex flex-col shadow-2xl overflow-hidden"
          onWheelCapture={e => e.stopPropagation()}
          onPointerDownCapture={e => e.stopPropagation()}>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">
            <span className="text-gray-400 text-xs font-mono">{selected.type.replace(/_/g, ' ')}</span>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>
          {selected.thumbnail && (
            <div className="bg-gray-50 flex items-center justify-center p-6 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.thumbnail} alt={selected.subjects.join(', ') || selected.type}
                className="max-w-full max-h-[320px] object-contain rounded shadow-md" />
            </div>
          )}
          <div className="p-4 overflow-y-auto flex-1 min-h-0">
            {selected.subjects.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {selected.subjects.map(s => (<span key={s} className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">{s}</span>))}
              </div>
            )}
            <a href={`/book/${selected.book_slug || selected.book_id}`} target="_blank" rel="noopener noreferrer"
              className="font-serif text-base text-gray-900 hover:text-black leading-snug block mb-1">{selected.book_title}</a>
            <div className="text-sm text-gray-500 mb-4">
              {selected.book_author !== 'Unknown' ? selected.book_author : ''}{selected.book_author !== 'Unknown' && selected.book_year ? ' · ' : ''}{selected.book_year || ''}
            </div>
            <div className="flex flex-col gap-2">
              <a href={`/gallery?book=${selected.book_id}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">Browse all images from this book &rarr;</a>
              <a href={`/book/${selected.book_slug || selected.book_id}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 transition-colors text-sm">View book &rarr;</a>
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 right-5 z-10 text-xs text-white/20 font-mono">Scroll to zoom · Drag to pan · Click to inspect</div>
    </div>
  );
}
