'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// ── Types ──

interface ImageItem {
  id: string; type: string; quality: number; thumbnail: string;
  book_title: string; book_author: string; book_year: number | null;
  book_id: string; book_slug?: string; subjects: string[];
  x: number; y: number; z: number; cluster: number;
}

interface ClusterInfo {
  id: number; size: number; label: string; top_type: string;
  top_subjects: string[]; cx: number; cy: number; cz: number;
}

interface ConstellationData {
  meta: { total_images: number; n_clusters: number; quality_threshold: number; generated_at: string };
  clusters: Record<string, ClusterInfo>;
  images: ImageItem[];
}

interface AtlasManifest {
  thumbSize: number; atlasSize: number; grid: number;
  perAtlas: number; totalAtlases: number; atlases: string[];
}

// ── QuadTree ──

interface QTPoint { x: number; y: number; idx: number }
interface QTBounds { x: number; y: number; w: number; h: number }

class QuadTree {
  bounds: QTBounds; points: QTPoint[] = []; children: QuadTree[] | null = null;
  constructor(bounds: QTBounds, private cap = 32) { this.bounds = bounds; }
  insert(p: QTPoint): boolean {
    const b = this.bounds;
    if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) return false;
    if (!this.children && this.points.length < this.cap) { this.points.push(p); return true; }
    if (!this.children) this.sub();
    for (const c of this.children!) if (c.insert(p)) return true;
    return false;
  }
  private sub() {
    const { x, y, w, h } = this.bounds; const hw = w / 2, hh = h / 2;
    this.children = [
      new QuadTree({ x, y, w: hw, h: hh }, this.cap), new QuadTree({ x: x + hw, y, w: hw, h: hh }, this.cap),
      new QuadTree({ x, y: y + hh, w: hw, h: hh }, this.cap), new QuadTree({ x: x + hw, y: y + hh, w: hw, h: hh }, this.cap),
    ];
    for (const p of this.points) for (const c of this.children) if (c.insert(p)) break;
    this.points = [];
  }
  query(r: QTBounds, out: QTPoint[] = []): QTPoint[] {
    const b = this.bounds;
    if (r.x + r.w < b.x || r.x > b.x + b.w || r.y + r.h < b.y || r.y > b.y + b.h) return out;
    for (const p of this.points)
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) out.push(p);
    if (this.children) for (const c of this.children) c.query(r, out);
    return out;
  }
}

// ── Colors ──

const TYPE_COLORS: Record<string, [number, number, number]> = {
  emblem: [201,168,108], woodcut: [139,154,125], engraving: [96,125,139],
  portrait: [158,74,58], frontispiece: [212,146,74], diagram: [124,93,181],
  map: [26,188,156], symbol: [233,30,99], decorative: [121,85,72],
  musical_score: [93,143,181], illustration: [74,158,124], chart: [0,188,212],
  botanical: [76,175,80], anatomical: [231,76,60], coat_of_arms: [103,58,183],
};
const CLUSTER_COLORS: [number,number,number][] = [
  [231,76,60],[52,152,219],[46,204,113],[243,156,18],[155,89,182],
  [26,188,156],[233,30,99],[0,188,212],[255,152,0],[103,58,183],
  [76,175,80],[121,85,72],[96,125,139],[255,87,34],[0,150,136],
  [139,195,74],[201,168,108],[93,143,181],[212,146,74],[160,103,160],
  [94,109,82],[181,131,93],[124,93,181],[158,74,58],[74,158,124],
];
const DEF: [number,number,number] = [102,102,102];
type ColorMode = 'type' | 'cluster' | 'century';

function centuryRgb(y: number | null): [number,number,number] {
  if (!y) return DEF; if (y<0) return [212,146,74]; if (y<500) return [201,168,108];
  if (y<1000) return [158,74,58]; if (y<1200) return [181,131,93]; if (y<1400) return [124,93,181];
  if (y<1500) return [93,143,181]; if (y<1600) return [139,154,125]; if (y<1700) return [74,158,124];
  if (y<1800) return [94,109,82]; return [106,122,90];
}
function colorRgb(img: ImageItem, m: ColorMode): [number,number,number] {
  if (m === 'type') return TYPE_COLORS[img.type] || DEF;
  if (m === 'cluster') return CLUSTER_COLORS[img.cluster % CLUSTER_COLORS.length];
  return centuryRgb(img.book_year);
}
function hex(r: number, g: number, b: number) { return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1); }

// ── Constants ──

const DOT_MAP = 4096;
const WORLD = 8000;
const THUMB_W = 60;
const ZOOM_THUMB = 0.18;
const ZOOM_LABEL = 0.05;
const MIN_Z = 0.015;
const MAX_Z = 4;
const ATLAS_PATH = '/atlases';

// ── Atlas Loader ──

class AtlasLoader {
  private imgs: (HTMLImageElement | null)[] = [];
  private ok: boolean[] = [];
  private m: AtlasManifest | null = null;
  private cb: () => void;
  constructor(cb: () => void) { this.cb = cb; }

  async load() {
    try {
      const r = await fetch(`${ATLAS_PATH}/manifest.json`);
      if (!r.ok) return false;
      this.m = await r.json();
      this.imgs = new Array(this.m!.totalAtlases).fill(null);
      this.ok = new Array(this.m!.totalAtlases).fill(false);
      for (let i = 0; i < this.m!.totalAtlases; i++) {
        const img = new Image(); img.crossOrigin = 'anonymous';
        const idx = i;
        img.onload = () => { this.imgs[idx] = img; this.ok[idx] = true; this.cb(); };
        img.src = `${ATLAS_PATH}/${this.m!.atlases[i]}`;
      }
      return true;
    } catch { return false; }
  }

  get(i: number) {
    const m = this.m; if (!m) return null;
    const ai = Math.floor(i / m.perAtlas);
    const atlas = this.imgs[ai]; if (!atlas) return null;
    const w = i % m.perAtlas;
    return { atlas, sx: (w % m.grid) * m.thumbSize, sy: Math.floor(w / m.grid) * m.thumbSize, s: m.thumbSize };
  }

  get loaded() { return this.ok.filter(Boolean).length; }
  get total() { return this.m?.totalAtlases || 0; }
  get ready() { return this.m !== null; }
}

// ── Fallback individual loader ──

class ImgCache {
  private c = new Map<string, HTMLImageElement>();
  private l = new Set<string>();
  private q: string[] = [];
  private cb: () => void;
  constructor(cb: () => void) { this.cb = cb; }
  has(u: string) { return this.c.get(u) || null; }
  req(u: string) {
    if (this.c.has(u) || this.l.has(u)) return;
    this.q.push(u); this.flush();
  }
  private flush() {
    while (this.l.size < 8 && this.q.length > 0) {
      const u = this.q.pop()!;
      if (this.c.has(u) || this.l.has(u)) continue;
      this.l.add(u);
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { this.c.set(u, img); this.l.delete(u); this.flush(); this.cb(); };
      img.onerror = () => { this.l.delete(u); this.flush(); };
      img.src = u;
    }
  }
}

// ── Dot map (ImageData pixel writes) ──

function buildDotMap(images: ImageItem[], cm: ColorMode, matches: Set<number>|null, cluster: number|null) {
  const cv = document.createElement('canvas'); cv.width = DOT_MAP; cv.height = DOT_MAP;
  const ctx = cv.getContext('2d')!;
  const id = ctx.createImageData(DOT_MAP, DOT_MAP); const px = id.data;
  const filt = (matches && matches.size > 0) || cluster !== null;
  const rad = 2;
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const cx = Math.round(img.x * (DOT_MAP - 1)), cy = Math.round(img.y * (DOT_MAP - 1));
    const [r, g, b] = colorRgb(img, cm);
    const match = (!matches || matches.has(i)) && (cluster === null || img.cluster === cluster);
    const a = filt ? (match ? 220 : 12) : 200;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (dx*dx+dy*dy > rad*rad+1) continue;
      const x = cx+dx, y = cy+dy;
      if (x<0||x>=DOT_MAP||y<0||y>=DOT_MAP) continue;
      const o = (y*DOT_MAP+x)*4;
      const oA = px[o+3]/255, nA = a/255, out = nA+oA*(1-nA);
      if (out>0) {
        px[o]=Math.round((r*nA+px[o]*oA*(1-nA))/out);
        px[o+1]=Math.round((g*nA+px[o+1]*oA*(1-nA))/out);
        px[o+2]=Math.round((b*nA+px[o+2]*oA*(1-nA))/out);
        px[o+3]=Math.round(out*255);
      }
    }
  }
  ctx.putImageData(id, 0, 0); return cv;
}

// ── Component ──

export default function ImagePixPlotViz({ data }: { data: ConstellationData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ x: WORLD/2, y: WORLD/2, zoom: MIN_Z*2.5 });
  const dragRef = useRef<{sx:number;sy:number;cx:number;cy:number}|null>(null);
  const atlasRef = useRef<AtlasLoader|null>(null);
  const cacheRef = useRef<ImgCache|null>(null);
  const qtRef = useRef<QuadTree|null>(null);
  const dotRef = useRef<HTMLCanvasElement|null>(null);
  const rafRef = useRef(0);
  const dirtyRef = useRef(true);
  const useAtlasRef = useRef(false);

  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [search, setSearch] = useState('');
  const [selIdx, setSelIdx] = useState<number|null>(null);
  const [hovIdx, setHovIdx] = useState<number|null>(null);
  const [selCluster, setSelCluster] = useState<number|null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [status, setStatus] = useState('');

  const matches = useMemo(() => {
    if (!search || search.length < 2) return null;
    const q = search.toLowerCase(); const s = new Set<number>();
    data.images.forEach((img, i) => {
      if (img.book_title.toLowerCase().includes(q)||img.book_author.toLowerCase().includes(q)||
        img.type.toLowerCase().includes(q)||img.subjects.some(s=>s.toLowerCase().includes(q))) s.add(i);
    }); return s;
  }, [search, data.images]);

  const stats = useMemo(() => ({
    total: data.meta.total_images, clusters: data.meta.n_clusters,
    types: new Set(data.images.map(i=>i.type)).size,
    books: new Set(data.images.map(i=>i.book_id)).size,
  }), [data]);

  const legend = useMemo(() => {
    if (colorMode === 'type') {
      const c: Record<string,number> = {};
      data.images.forEach(i => { c[i.type] = (c[i.type]||0)+1; });
      return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,12)
        .map(([t,n]) => ({ label: t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), color: hex(...(TYPE_COLORS[t]||DEF)), count: n }));
    }
    if (colorMode === 'cluster') {
      return Object.values(data.clusters).sort((a,b)=>b.size-a.size).slice(0,10)
        .map(c => ({ label: c.label, color: hex(...CLUSTER_COLORS[c.id%CLUSTER_COLORS.length]), count: c.size }));
    }
    return [[100,'Before 500'],[700,'500-999'],[1200,'1000-1399'],[1450,'1400-1499'],[1550,'1500-1599'],[1650,'1600-1699'],[1750,'1700+']]
      .map(([y,l]) => ({ label: l as string, color: hex(...centuryRgb(y as number)), count: 0 }));
  }, [colorMode, data]);

  useEffect(() => {
    const qt = new QuadTree({ x:0, y:0, w:WORLD, h:WORLD });
    data.images.forEach((img,i) => qt.insert({ x:img.x*WORLD, y:img.y*WORLD, idx:i }));
    qtRef.current = qt;
  }, [data.images]);

  useEffect(() => {
    dotRef.current = buildDotMap(data.images, colorMode, matches, selCluster);
    dirtyRef.current = true;
  }, [data.images, colorMode, matches, selCluster]);

  useEffect(() => {
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;

    const redraw = () => { dirtyRef.current = true; };
    const atlas = new AtlasLoader(() => { setStatus(`${atlas.loaded}/${atlas.total} atlases`); redraw(); });
    atlasRef.current = atlas;
    const cache = new ImgCache(redraw); cacheRef.current = cache;
    atlas.load().then(ok => { useAtlasRef.current = ok; setStatus(ok ? 'loading atlases...' : 'loading thumbnails'); });

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      canvas.width = container.clientWidth*dpr; canvas.height = container.clientHeight*dpr;
      canvas.style.width = `${container.clientWidth}px`; canvas.style.height = `${container.clientHeight}px`;
      dirtyRef.current = true;
    };
    resize();
    const obs = new ResizeObserver(resize); obs.observe(container);

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const dpr = devicePixelRatio || 1;
      const w = canvas.width, h = canvas.height, cam = camRef.current;
      ctx.fillStyle = '#08080d'; ctx.fillRect(0, 0, w, h);

      const sc = cam.zoom * dpr;
      const toS = (wx: number, wy: number) => ({ sx: (wx-cam.x)*sc+w/2, sy: (wy-cam.y)*sc+h/2 });

      // Tier 1: dot map
      const dm = dotRef.current;
      if (dm) {
        const ps = (WORLD/DOT_MAP)*sc; const {sx:ox,sy:oy} = toS(0,0);
        ctx.imageSmoothingEnabled = cam.zoom<0.3;
        ctx.drawImage(dm, ox, oy, DOT_MAP*ps, DOT_MAP*ps);
        ctx.imageSmoothingEnabled = true;
      }

      // Tier 2: thumbnails
      const showT = cam.zoom >= ZOOM_THUMB;
      const qt = qtRef.current;
      if (showT && qt) {
        const vw = w/sc, vh = h/sc, mg = THUMB_W*2;
        const vis = qt.query({ x:cam.x-vw/2-mg, y:cam.y-vh/2-mg, w:vw+mg*2, h:vh+mg*2 });
        const ts = THUMB_W*sc, ht = ts/2;
        const filt = (matches && matches.size>0)||selCluster!==null;
        const uAtlas = useAtlasRef.current;

        for (const p of vis) {
          const img = data.images[p.idx];
          const isM = (!matches||matches.has(p.idx))&&(selCluster===null||img.cluster===selCluster);
          const isSel = p.idx===selIdx, isHov = p.idx===hovIdx;
          if (filt && !isM && !isSel && !isHov) continue;
          const {sx,sy} = toS(p.x, p.y);
          let drawn = false;

          if (uAtlas) {
            const t = atlas.get(p.idx);
            if (t) {
              ctx.globalAlpha = filt&&!isM ? 0.15 : 1;
              ctx.drawImage(t.atlas, t.sx, t.sy, t.s, t.s, sx-ht, sy-ht, ts, ts);
              drawn = true;
            }
          } else {
            const ci = cache.has(img.thumbnail);
            if (ci) {
              ctx.globalAlpha = filt&&!isM ? 0.15 : 1;
              ctx.drawImage(ci, sx-ht, sy-ht, ts, ts);
              drawn = true;
            } else cache.req(img.thumbnail);
          }

          if (drawn) {
            if (isSel||isHov) {
              ctx.strokeStyle='#fff'; ctx.lineWidth=2*dpr; ctx.globalAlpha=1;
              ctx.strokeRect(sx-ht-2*dpr, sy-ht-2*dpr, ts+4*dpr, ts+4*dpr);
            } else if (ts>24) {
              const [r,g,b] = colorRgb(img, colorMode);
              ctx.strokeStyle=hex(r,g,b); ctx.lineWidth=1.5*dpr; ctx.globalAlpha=0.4;
              ctx.strokeRect(sx-ht, sy-ht, ts, ts);
            }
            ctx.globalAlpha=1;
          } else {
            const [r,g,b] = colorRgb(img, colorMode);
            ctx.globalAlpha=0.2; ctx.fillStyle=hex(r,g,b);
            ctx.fillRect(sx-ht, sy-ht, ts, ts); ctx.globalAlpha=1;
          }
        }
      }

      // Labels
      if (cam.zoom >= ZOOM_LABEL) {
        ctx.textAlign='center'; ctx.textBaseline='middle';
        for (const cl of Object.values(data.clusters)) {
          const {sx,sy} = toS(cl.cx*WORLD, cl.cy*WORLD);
          if (sx<-300||sx>w+300||sy<-50||sy>h+50) continue;
          const act = selCluster===cl.id;
          const fs = Math.min(Math.max(13, 11/cam.zoom), 26)*dpr;
          ctx.font = `500 ${fs}px Inter,system-ui,sans-serif`;
          const tw=ctx.measureText(cl.label).width, pd=6*dpr, ph=fs+pd*2;
          ctx.globalAlpha=act?0.85:0.5; ctx.fillStyle='rgba(0,0,0,0.65)';
          ctx.beginPath(); ctx.roundRect(sx-tw/2-pd, sy-ph/2, tw+pd*2, ph, ph/3); ctx.fill();
          ctx.fillStyle='#fff'; ctx.globalAlpha=act?0.95:0.6;
          ctx.fillText(cl.label, sx, sy+dpr); ctx.globalAlpha=1;
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); obs.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, colorMode, matches, selCluster, selIdx, hovIdx]);

  // ── Interaction ──
  const worldAt = useCallback((cx: number, cy: number) => {
    const r = canvasRef.current?.getBoundingClientRect(); if (!r) return {wx:0,wy:0};
    const c = camRef.current;
    return { wx:(cx-r.left-r.width/2)/c.zoom+c.x, wy:(cy-r.top-r.height/2)/c.zoom+c.y };
  }, []);

  const hitTest = useCallback((wx: number, wy: number) => {
    const qt=qtRef.current; if (!qt) return null;
    const r = camRef.current.zoom>=ZOOM_THUMB ? THUMB_W/2 : 30/camRef.current.zoom;
    const near = qt.query({x:wx-r,y:wy-r,w:r*2,h:r*2});
    let best: number|null=null, bd=Infinity;
    for (const p of near) { const d=(p.x-wx)**2+(p.y-wy)**2; if (d<bd){bd=d;best=p.idx;} }
    return best;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const r=canvasRef.current?.getBoundingClientRect(); if(!r) return;
    const c=camRef.current, mx=e.clientX-r.left, my=e.clientY-r.top;
    const f=e.deltaY>0?0.88:1.14, nz=Math.max(MIN_Z,Math.min(MAX_Z,c.zoom*f));
    const wx=(mx-r.width/2)/c.zoom+c.x, wy=(my-r.height/2)/c.zoom+c.y;
    c.x=wx-(mx-r.width/2)/nz; c.y=wy-(my-r.height/2)/nz; c.zoom=nz;
    dirtyRef.current=true;
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    if(e.button!==0) return;
    dragRef.current={sx:e.clientX,sy:e.clientY,cx:camRef.current.x,cy:camRef.current.y};
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const d=dragRef.current;
    if(d){ const c=camRef.current; c.x=d.cx-(e.clientX-d.sx)/c.zoom; c.y=d.cy-(e.clientY-d.sy)/c.zoom; dirtyRef.current=true; setHovIdx(null); }
    else { const{wx,wy}=worldAt(e.clientX,e.clientY); const i=hitTest(wx,wy); if(i!==hovIdx) setHovIdx(i); }
  }, [worldAt, hitTest, hovIdx]);

  const onUp = useCallback((e: React.PointerEvent) => {
    const d=dragRef.current; dragRef.current=null;
    if(d&&Math.abs(e.clientX-d.sx)+Math.abs(e.clientY-d.sy)<5){
      const{wx,wy}=worldAt(e.clientX,e.clientY); setSelIdx(hitTest(wx,wy));
    }
  }, [worldAt, hitTest]);

  const flyTo = useCallback((id: number) => {
    const cl=data.clusters[String(id)]; if(!cl) return;
    camRef.current.x=cl.cx*WORLD; camRef.current.y=cl.cy*WORLD; camRef.current.zoom=0.3;
    setSelCluster(p=>p===id?null:id); setSelIdx(null); dirtyRef.current=true;
  }, [data.clusters]);

  const reset = useCallback(() => {
    camRef.current={x:WORLD/2,y:WORLD/2,zoom:MIN_Z*2.5};
    setSearch(''); setSelCluster(null); setSelIdx(null); setHovIdx(null); dirtyRef.current=true;
  }, []);

  const sel = selIdx!==null ? data.images[selIdx] : null;
  const hov = hovIdx!==null&&hovIdx!==selIdx ? data.images[hovIdx] : null;

  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      <canvas ref={canvasRef} className="absolute inset-0"
        style={{cursor:dragRef.current?'grabbing':hovIdx!==null?'pointer':'grab'}}
        onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}/>

      <div className="absolute top-4 left-5 z-10 pointer-events-none">
        <a href="/" className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors pointer-events-auto">Source Library</a>
        <div className="text-white/70 font-serif text-xl leading-tight">Image Atlas</div>
        <div className="text-white/25 text-xs mt-0.5 font-mono">{stats.total.toLocaleString()} illustrations from {stats.books.toLocaleString()} books</div>
        {status && <div className="text-white/15 text-xs mt-0.5 font-mono">{status}</div>}
      </div>

      <div className="absolute top-4 right-5 z-10 flex items-center gap-2">
        <div className="relative">
          <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..."
            className="w-48 pl-7 pr-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white/80 placeholder:text-white/25 placeholder:font-mono focus:outline-none focus:border-white/25 transition-colors"/>
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/25" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          {matches && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">{matches.size}</span>}
        </div>
        {(['type','cluster','century'] as ColorMode[]).map(m=>(
          <button key={m} onClick={()=>setColorMode(m)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${colorMode===m?'bg-white/10 border-white/20 text-white/80':'bg-transparent border-white/8 text-white/30 hover:text-white/50 hover:border-white/15'}`}>
            {m==='type'?'Type':m==='cluster'?'Topic':'Century'}</button>
        ))}
        <button onClick={()=>setShowInfo(!showInfo)}
          className={`w-7 h-7 flex items-center justify-center rounded border text-sm font-serif italic transition-colors ${showInfo?'bg-white/10 border-white/20 text-white/70':'bg-transparent border-white/8 text-white/30 hover:text-white/50'}`}>i</button>
        <button onClick={reset} className="px-2.5 py-1 text-xs rounded border border-white/8 text-white/30 hover:text-white/50 hover:border-white/15 transition-colors">Reset</button>
      </div>

      {showInfo && (
        <div className="absolute top-14 right-5 w-[300px] bg-white/95 backdrop-blur-md border border-black/10 rounded-md p-4 z-20 max-h-[85vh] overflow-y-auto shadow-lg">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><div className="text-gray-800 font-mono text-xl">{stats.total.toLocaleString()}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Images</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.clusters}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Clusters</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.types}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Image Types</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.books.toLocaleString()}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Books</div></div>
          </div>
          <div className="border-t border-gray-200 pt-3 text-gray-500 text-sm leading-relaxed space-y-2">
            <p>Each point is an illustration extracted from a pre-modern text, arranged by visual/thematic similarity using UMAP.</p>
            <p><strong className="text-gray-600">Zoom in</strong> to see thumbnails. Click any image for details.</p>
          </div>
        </div>
      )}

      {hov && <Tip image={hov}/>}

      {sel && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-md border border-black/10 rounded-lg p-4 z-20 shadow-2xl max-w-[400px] w-full" onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setSelIdx(null)} className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          <div className="flex gap-4">
            {sel.thumbnail && <div className="shrink-0 rounded overflow-hidden bg-gray-100 w-[140px] h-[140px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sel.thumbnail} alt={sel.subjects.join(', ')||sel.type} className="w-full h-full object-contain" loading="lazy"/></div>}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 font-medium">{sel.type.replace(/_/g,' ')}</span>
                <span className="px-1.5 py-0.5 text-xs rounded bg-amber-50 text-amber-700 font-mono">q{sel.quality.toFixed(2)}</span>
              </div>
              {sel.subjects.length>0 && <div className="flex flex-wrap gap-1 mb-2">
                {sel.subjects.slice(0,4).map(s=>(<span key={s} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{s}</span>))}
              </div>}
              <a href={`/book/${sel.book_slug||sel.book_id}`} target="_blank" rel="noopener noreferrer"
                className="font-serif text-sm text-gray-900 hover:text-black leading-tight block mb-1">{sel.book_title}</a>
              <div className="text-sm text-gray-500">
                {sel.book_author!=='Unknown'?sel.book_author:''}{sel.book_author!=='Unknown'&&sel.book_year?' · ':''}{sel.book_year||''}
              </div>
              <a href={`/gallery?book=${sel.book_id}`} target="_blank" rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 transition-colors text-xs mt-2 inline-block">View in Gallery &rarr;</a>
            </div>
          </div>
        </div>
      )}

      <div className="absolute bottom-12 left-5 z-10 bg-black/50 backdrop-blur-sm border border-white/8 rounded p-2.5 max-w-[200px]">
        <div className="grid grid-cols-1 gap-y-0.5">
          {legend.map(i=>(<div key={i.label} className="flex items-center gap-1.5 text-xs text-white/50">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{backgroundColor:i.color}}/><span className="truncate">{i.label}</span>
            {i.count>0&&<span className="ml-auto text-white/25 font-mono">{i.count}</span>}
          </div>))}
        </div>
      </div>

      <div className="absolute bottom-3 left-5 right-5 z-10">
        <Pills clusters={data.clusters} sel={selCluster} onSel={flyTo} onClear={()=>{setSelCluster(null);dirtyRef.current=true;}}/>
      </div>
      <div className="absolute bottom-12 right-5 z-10 text-xs text-white/20 font-mono">Scroll to zoom · Drag to pan · Click to inspect</div>
    </div>
  );
}

function Tip({ image: i }: { image: ImageItem }) {
  const [p, setP] = useState({x:0,y:0});
  useEffect(() => { const h=(e:MouseEvent)=>setP({x:e.clientX,y:e.clientY}); window.addEventListener('mousemove',h); return()=>window.removeEventListener('mousemove',h); }, []);
  return (
    <div className="fixed pointer-events-none bg-black/80 backdrop-blur-md border border-white/10 rounded-md p-2.5 max-w-[260px] z-30" style={{left:p.x+16,top:p.y-40}}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="px-1.5 py-0.5 text-xs rounded bg-white/10 text-white/70">{i.type.replace(/_/g,' ')}</span>
        {i.subjects.slice(0,2).map(s=>(<span key={s} className="px-1.5 py-0.5 text-xs rounded bg-white/5 text-white/40">{s}</span>))}
      </div>
      <div className="text-sm text-white/60 leading-tight">{i.book_title}{i.book_year?` (${i.book_year})`:''}</div>
    </div>
  );
}

function Pills({ clusters, sel, onSel, onClear }: { clusters:Record<string,ClusterInfo>; sel:number|null; onSel:(id:number)=>void; onClear:()=>void }) {
  const [exp, setExp] = useState(false);
  const sorted = useMemo(()=>Object.values(clusters).sort((a,b)=>b.size-a.size), [clusters]);
  const vis = exp ? sorted : sorted.slice(0,20);
  return (
    <div className="flex flex-wrap gap-1">
      <button onClick={onClear} className={`px-2 py-0.5 rounded text-xs border transition-colors ${sel===null?'bg-white/10 border-white/20 text-white/70':'bg-transparent border-white/8 text-white/25 hover:text-white/40'}`}>All</button>
      {vis.map(c=>(<button key={c.id} onClick={()=>onSel(c.id)}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${sel===c.id?'bg-white/10 border-white/20 text-white/70':'bg-transparent border-white/8 text-white/25 hover:text-white/40'}`}>
        {c.label}<span className="ml-1 text-white/15 font-mono">{c.size}</span></button>))}
      {sorted.length>20&&<button onClick={()=>setExp(!exp)} className="px-2 py-0.5 rounded text-[10px] border border-white/8 text-white/25 hover:text-white/40 transition-colors">{exp?'fewer':`+${sorted.length-20}`}</button>}
    </div>
  );
}
