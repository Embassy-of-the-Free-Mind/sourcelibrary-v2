'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Eye, EyeOff, Lock, Plus, Redo2, Trash2, Undo2, Unlock } from 'lucide-react';
import { findInkArea, findTitleBlock, loadImage } from './analyze';
import { CoverCanvas } from './CoverCanvas';
import { CropDialog } from './CropDialog';
import { loadCoverFonts } from './fonts';
import { Inspector } from './Inspector';
import { FULL, fillLayer, imageLayer, shapeLayer, shortTitle, textLayer } from './layers';
import { clearRenderCache, layerHeight, renderCover, type ImageMap } from './render';
import { buildStarters } from './starters';
import { H, W, uid, type Cover, type Crop, type CutImage, type Layer, type Leaf, type Materials, type ShapeKind } from './types';

/**
 * The cover maker: starting covers made from a book's own scans, then a free
 * editor. Covers are kept in this browser only (localStorage, per book); the
 * finished cover leaves as a PNG.
 */

const STORE_KEY = (id: string) => `cover-maker:v1:${id}`;

const ROLE_LABEL: Record<string, string> = {
  outside: 'binding', endpaper: 'endpaper', title: 'title page', frontispiece: 'frontispiece', plate: 'plate', leaf: 'page',
};

type Tab = 'starters' | 'outside' | 'title' | 'plates' | 'cuts' | 'pages';

interface Saved { designs: Cover[]; activeId: string | null }

function readSaved(bookId: string): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY(bookId));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(bookId: string, s: Saved) {
  try { localStorage.setItem(STORE_KEY(bookId), JSON.stringify(s)); } catch { /* private mode / full: drafts just don't persist */ }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number, number] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize([e.contentRect.width, e.contentRect.height]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size[0], size[1]];
}

export default function CoverMaker({ bookId }: { bookId: string }) {
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starters, setStarters] = useState<Cover[] | null>(null);
  const [designs, setDesigns] = useState<Cover[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('starters');
  const [cropFor, setCropFor] = useState<string | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const images = useRef<ImageMap>(new Map()).current;
  const [tick, setTick] = useState(0);
  const history = useRef<{ past: Cover[]; future: Cover[]; base: Cover | null }>({ past: [], future: [], base: null });

  // ── Load ──
  useEffect(() => {
    let live = true;
    loadCoverFonts().then(() => { if (live) { clearRenderCache(); setFontsReady(true); } });
    fetch(`/api/books/${encodeURIComponent(bookId)}/cover-materials`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'This book was not found.' : 'Could not load this book.'))))
      .then((m: Materials) => { if (live) setMaterials(m); })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [bookId]);

  useEffect(() => {
    if (!materials || !fontsReady) return;
    let live = true;
    buildStarters(materials).then(s => {
      if (!live) return;
      setStarters(s);
      const saved = readSaved(materials.book.id);
      if (saved?.designs?.length) {
        setDesigns(saved.designs);
        setActiveId(saved.activeId && saved.designs.some(d => d.id === saved.activeId) ? saved.activeId : saved.designs[0].id);
      } else if (s.length) {
        const first = { ...clone(s[0]), id: uid() };
        setDesigns([first]);
        setActiveId(first.id);
      }
    });
    return () => { live = false; };
  }, [materials, fontsReady, bookId]);

  useEffect(() => {
    if (designs.length && materials) writeSaved(materials.book.id, { designs, activeId });
  }, [designs, activeId, materials]);

  const active = designs.find(d => d.id === activeId) || null;
  const sel = active?.layers.find(l => l.id === selected) || null;

  // Make sure every image a visible cover uses is loading.
  useEffect(() => {
    const srcs = new Set<string>();
    for (const c of [...designs, ...(starters || [])]) for (const l of c.layers) if (l.kind === 'image') srcs.add(l.src);
    for (const src of srcs) {
      if (images.has(src)) continue;
      loadImage(src).then(img => { images.set(src, img); setTick(t => t + 1); }).catch(() => {});
    }
  }, [designs, starters, images]);

  // ── Editing with history ──
  useEffect(() => {
    history.current = { past: [], future: [], base: active ? clone(active) : null };
    // Reset only when switching designs, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const setActive = useCallback((next: Cover, commit = true) => {
    setDesigns(ds => ds.map(d => (d.id === next.id ? next : d)));
    if (commit) {
      const h = history.current;
      if (h.base && JSON.stringify(h.base) !== JSON.stringify(next)) {
        h.past.push(h.base);
        if (h.past.length > 80) h.past.shift();
        h.future = [];
      }
      h.base = clone(next);
    }
  }, []);

  const patchLayer = useCallback((id: string, patch: Partial<Layer>, commit = true) => {
    if (!active) return;
    setActive({ ...active, layers: active.layers.map(l => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }, commit);
  }, [active, setActive]);

  const undo = useCallback(() => {
    const h = history.current;
    if (!active || !h.past.length) return;
    h.future.push(clone(active));
    const prev = h.past.pop()!;
    h.base = clone(prev);
    setDesigns(ds => ds.map(d => (d.id === prev.id ? prev : d)));
  }, [active]);

  const redo = useCallback(() => {
    const h = history.current;
    if (!active || !h.future.length) return;
    h.past.push(clone(active));
    const next = h.future.pop()!;
    h.base = clone(next);
    setDesigns(ds => ds.map(d => (d.id === next.id ? next : d)));
  }, [active]);

  const addLayers = useCallback((ls: Layer[], below = false) => {
    if (!active) return;
    setActive({ ...active, layers: below ? [...ls, ...active.layers] : [...active.layers, ...ls] });
    setSelected(ls[ls.length - 1].id);
  }, [active, setActive]);

  const removeLayer = useCallback((id: string) => {
    if (!active) return;
    setActive({ ...active, layers: active.layers.filter(l => l.id !== id) });
    setSelected(null);
  }, [active, setActive]);

  const moveLayer = (id: string, dir: 1 | -1) => {
    if (!active) return;
    const i = active.layers.findIndex(l => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= active.layers.length) return;
    const layers = [...active.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setActive({ ...active, layers });
  };

  const duplicateLayer = (id: string) => {
    const l = active?.layers.find(x => x.id === id);
    if (!l || !active) return;
    const copy = { ...clone(l), id: uid(), name: `${l.name} copy`, x: l.x + 24, y: l.y + 24, locked: false };
    const i = active.layers.indexOf(l);
    const layers = [...active.layers];
    layers.splice(i + 1, 0, copy);
    setActive({ ...active, layers });
    setSelected(copy.id);
  };

  // ── Designs ──
  const startFrom = (c: Cover) => {
    const n = designs.filter(d => d.name.startsWith(c.name)).length;
    const d = { ...clone(c), id: uid(), name: n ? `${c.name} ${n + 1}` : c.name };
    setDesigns(ds => [...ds, d]);
    setActiveId(d.id);
    setSelected(null);
  };

  const deleteDesign = (id: string) => {
    const rest = designs.filter(d => d.id !== id);
    setDesigns(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
    if (!rest.length && materials) writeSaved(materials.book.id, { designs: [], activeId: null });
  };

  // ── Adding material ──
  const dimsOf = async (url: string) => {
    const img = await loadImage(url);
    images.set(url, img);
    setTick(t => t + 1);
    return img;
  };

  const addLeaf = async (leaf: Leaf, how: 'ground' | 'add' | 'lift-title' | 'lift-page', crop?: Crop, rot: 0 | 90 | 180 | 270 = 0) => {
    if (!active) return;
    setBusy(`Loading page ${leaf.n}…`);
    try {
      const img = await dimsOf(leaf.display);
      const [iw, ih] = [img.naturalWidth, img.naturalHeight];
      if (how === 'ground') {
        addLayers([imageLayer(leaf, iw, ih, { ground: true, crop: crop || { x: 0.06, y: 0.04, w: 0.88, h: 0.92 }, srcRot: rot, name: `Ground · p. ${leaf.n}` })], true);
        return;
      }
      if (how === 'lift-title' || how === 'lift-page') {
        const r = how === 'lift-title' ? findTitleBlock(img) : findInkArea(img);
        const ground = active.layers.find(l => l.kind !== 'text' && l.kind !== 'shape');
        const dark = !ground || ground.kind === 'fill' || (ground.kind === 'image' && ground.role !== 'leaf');
        addLayers([imageLayer(leaf, iw, ih, {
          crop: r?.crop || FULL, threshold: r ? Math.min(0.8, r.threshold + 0.05) : 0.5, softness: 0.12,
          treatment: dark ? 'gilt' : 'ink', width: how === 'lift-title' ? W * 0.74 : W * 0.7,
          name: how === 'lift-title' ? `Title lifted · p. ${leaf.n}` : `Title page · p. ${leaf.n}`,
        })]);
        return;
      }
      const l = imageLayer(leaf, iw, ih, { crop: crop || FULL, srcRot: rot, width: W * 0.6 });
      if (l.h > H * 0.8) { l.w *= (H * 0.8) / l.h; l.h = H * 0.8; }
      addLayers([l]);
    } catch {
      setError(`Page ${leaf.n} could not be loaded.`);
    } finally {
      setBusy(null);
    }
  };

  const leafOf = (n: number) => materials?.leaves.find(l => l.n === n);
  const cutCrop = (c: CutImage): Crop => ({ x: c.bbox.x, y: c.bbox.y, w: c.bbox.width, h: c.bbox.height });

  const addShape = (shape: ShapeKind) => addLayers([shapeLayer(shape)]);
  const addText = () => addLayers([textLayer(materials ? shortTitle(materials.book.title) : 'Title', { y: H * 0.3, name: 'Title' })]);
  const addFill = () => addLayers([fillLayer('#4a2620', { texture: 'cloth', name: 'Cloth', locked: true })], true);

  // ── Export ──
  const exportPng = async () => {
    if (!active || !materials) return;
    setExporting(true);
    try {
      const full: ImageMap = new Map();
      await Promise.all(active.layers.map(async l => {
        if (l.kind !== 'image') return;
        try { full.set(l.src, await loadImage(l.full)); } catch { const d = images.get(l.src); if (d) full.set(l.src, d); }
      }));
      const s = 2;
      const c = document.createElement('canvas');
      c.width = W * s;
      c.height = H * s;
      renderCover(c.getContext('2d')!, active, s, full);
      const blob: Blob | null = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('export failed');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const slug = shortTitle(materials.book.title).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      a.download = `${slug || 'cover'}-${active.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      setError('The cover could not be exported. A scan may have failed to load at full size.');
    } finally {
      setExporting(false);
    }
  };

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (cropFor || t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(sel.id); return; }
      const step = e.shiftKey ? 20 : 2;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key] && sel.kind !== 'fill') {
        e.preventDefault();
        patchLayer(sel.id, { x: sel.x + moves[e.key][0], y: sel.y + moves[e.key][1] });
      }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, cropFor, undo, redo, removeLayer, patchLayer]);

  // ── Provenance ──
  const provenance = useMemo(() => {
    if (!active) return '';
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const l of active.layers) {
      if (l.kind !== 'image' || l.hidden || l.page == null) continue;
      const p = `${ROLE_LABEL[l.role] || 'page'} p. ${l.page}`;
      if (!seen.has(p)) { seen.add(p); parts.push(p); }
    }
    return parts.join(' · ');
  }, [active]);

  // ── Board size ──
  const [stageRef, stageW, stageH] = useWidth<HTMLDivElement>();
  const boardW = Math.max(160, Math.min(stageW - 16, ((stageH - 16) * W) / H, 640));

  if (error && !materials) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p>{error}</p>
        <Link href={`/book/${bookId}`} className="underline">Back to the book</Link>
      </div>
    );
  }

  const book = materials?.book;
  const leaves = materials?.leaves || [];
  const lists: Record<Exclude<Tab, 'starters' | 'cuts'>, Leaf[]> = {
    outside: leaves.filter(l => l.role === 'outside' || l.role === 'endpaper'),
    title: leaves.filter(l => l.role === 'title' || l.role === 'frontispiece'),
    plates: leaves.filter(l => l.role === 'plate' || l.role === 'frontispiece'),
    pages: leaves,
  };
  const tabs: { v: Tab; label: string; count?: number }[] = [
    { v: 'starters', label: 'Starters', count: starters?.length },
    { v: 'outside', label: 'Binding & endpapers', count: lists.outside.length },
    { v: 'title', label: 'Title page', count: lists.title.length },
    { v: 'plates', label: 'Plates', count: lists.plates.length },
    { v: 'cuts', label: 'Illustrations', count: materials?.images.length },
    { v: 'pages', label: 'All pages', count: leaves.length },
  ];

  return (
    <div className="cover-maker h-[100dvh] flex flex-col bg-[var(--bg-cream)] text-[var(--text-primary)]">
      <style>{`
        .cover-maker .cm-btn { display:inline-flex; align-items:center; gap:.4rem; padding:.45rem .75rem; border-radius:.375rem; border:1px solid var(--border-medium); font-size:.875rem; background:var(--bg-white); }
        .cover-maker .cm-btn:hover:not(:disabled) { background:var(--bg-warm); }
        .cover-maker .cm-btn:disabled { opacity:.45; }
        .cover-maker .cm-btn-primary { background:var(--text-primary); color:var(--bg-cream); border-color:var(--text-primary); }
        .cover-maker .cm-btn-primary:hover:not(:disabled) { background:#000; }
        .cover-maker .cm-chip { padding:.2rem .55rem; border-radius:999px; border:1px solid var(--border-medium); font-size:.8rem; }
        .cover-maker .cm-chip:hover { background:var(--bg-warm); }
        .cover-maker .cm-input { width:100%; padding:.45rem .6rem; border-radius:.375rem; border:1px solid var(--border-medium); background:var(--bg-white); font-size:16px; }
      `}</style>

      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-light)]">
        <Link href={`/book/${bookId}`} className="p-1.5 -ml-1.5 rounded hover:bg-[var(--bg-warm)]" aria-label="Back to the book"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--text-muted)]">Cover maker</div>
          <div className="truncate text-sm font-medium">{book ? shortTitle(book.title) : 'Loading…'}</div>
        </div>
        <button className="cm-btn" onClick={undo} disabled={!history.current.past.length} aria-label="Undo"><Undo2 className="w-4 h-4" /></button>
        <button className="cm-btn" onClick={redo} disabled={!history.current.future.length} aria-label="Redo"><Redo2 className="w-4 h-4" /></button>
        <button className="cm-btn cm-btn-primary" onClick={exportPng} disabled={!active || exporting}>
          <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Download PNG'}
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Materials */}
        <aside className="lg:w-[340px] lg:border-r border-[var(--border-light)] flex flex-col min-h-0 order-2 lg:order-1 max-h-[42dvh] lg:max-h-none">
          <nav className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-[var(--border-light)] shrink-0">
            {tabs.map(t => (
              <button
                key={t.v}
                onClick={() => setTab(t.v)}
                className={`whitespace-nowrap px-2.5 py-1 rounded text-sm ${tab === t.v ? 'bg-[var(--text-primary)] text-[var(--bg-cream)]' : 'hover:bg-[var(--bg-warm)]'}`}
              >
                {t.label}{t.count != null ? <span className="opacity-60"> {t.count}</span> : null}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto p-3">
            {tab === 'starters' && (
              !starters ? <p className="text-sm text-[var(--text-muted)]">Reading the scans and making starting covers…</p> : (
                <>
                  <p className="text-sm text-[var(--text-muted)] mb-3">Made only from this book&apos;s scans and its catalogue record. Pick one to start a new cover.</p>
                  <div className="grid grid-cols-3 lg:grid-cols-2 gap-3">
                    {starters.map(s => (
                      <button key={s.id} onClick={() => startFrom(s)} className="text-left group">
                        <CoverCanvas cover={s} width={140} images={images} tick={tick} fontsReady={fontsReady} className="rounded-sm shadow group-hover:ring-2 ring-[var(--accent-rust)] max-w-full !h-auto aspect-[2/3]" />
                        <span className="block text-sm mt-1">{s.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )
            )}
            {tab === 'cuts' && (
              <div className="grid grid-cols-3 gap-2">
                {(materials?.images || []).map((c, i) => {
                  const leaf = leafOf(c.page);
                  if (!leaf) return null;
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.thumb || c.cut || leaf.thumb} alt={c.description} title={`${c.description} (p. ${c.page})`} className="w-full aspect-square object-contain bg-[var(--bg-warm)] rounded" loading="lazy" />
                      <div className="flex gap-1">
                        <button className="cm-chip flex-1" onClick={() => addLeaf(leaf, 'add', cutCrop(c), c.rotation)}>Add</button>
                        <button className="cm-chip flex-1" onClick={() => addLeaf(leaf, 'ground', cutCrop(c), c.rotation)}>Ground</button>
                      </div>
                    </div>
                  );
                })}
                {!materials?.images.length && <p className="col-span-3 text-sm text-[var(--text-muted)]">No illustrations have been cut out of this book yet. Use Plates or All pages and crop.</p>}
              </div>
            )}
            {tab !== 'starters' && tab !== 'cuts' && (
              <div className="grid grid-cols-3 gap-2">
                {lists[tab].map(leaf => (
                  <div key={leaf.n} className="flex flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={leaf.thumb} alt={`Page ${leaf.n}`} title={leaf.note || `Page ${leaf.n}`} className="w-full aspect-[2/3] object-cover bg-[var(--bg-warm)] rounded" loading="lazy" />
                    <span className="text-xs text-[var(--text-muted)]">p. {leaf.n} · {ROLE_LABEL[leaf.role]}</span>
                    {tab === 'title' && leaf.role === 'title' ? (
                      <div className="flex flex-wrap gap-1">
                        <button className="cm-chip" onClick={() => addLeaf(leaf, 'lift-title')}>Lift title</button>
                        <button className="cm-chip" onClick={() => addLeaf(leaf, 'lift-page')}>Lift page</button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button className="cm-chip flex-1" onClick={() => addLeaf(leaf, 'add')}>Add</button>
                        <button className="cm-chip flex-1" onClick={() => addLeaf(leaf, 'ground')}>Ground</button>
                      </div>
                    )}
                  </div>
                ))}
                {!lists[tab].length && <p className="col-span-3 text-sm text-[var(--text-muted)]">Nothing of this kind was found. Try All pages.</p>}
              </div>
            )}
          </div>
        </aside>

        {/* Board */}
        <main className="flex-1 min-h-0 flex flex-col order-1 lg:order-2 min-w-0">
          <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-[var(--border-light)] shrink-0">
            {designs.map(d => (
              <div key={d.id} className={`flex items-center rounded text-sm whitespace-nowrap ${d.id === activeId ? 'bg-[var(--bg-warm)]' : ''}`}>
                <button className="px-2.5 py-1" onClick={() => { setActiveId(d.id); setSelected(null); }}>{d.name}</button>
                {d.id === activeId && designs.length > 1 && (
                  <button className="pr-2 opacity-50 hover:opacity-100" aria-label={`Delete ${d.name}`} onClick={() => deleteDesign(d.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
            {active && (
              <button className="px-2 py-1 text-sm opacity-70 hover:opacity-100 whitespace-nowrap" onClick={() => startFrom(active)}>
                <Copy className="w-3.5 h-3.5 inline -mt-0.5" /> Duplicate
              </button>
            )}
          </div>
          <div ref={stageRef} className="flex-1 min-h-[300px] flex items-center justify-center bg-[var(--bg-warm)] relative">
            {active && stageW > 0 && (
              <Board
                cover={active}
                width={boardW}
                images={images}
                tick={tick}
                fontsReady={fontsReady}
                selected={selected}
                onSelect={setSelected}
                onChange={(l, commit) => patchLayer(l.id, l, commit)}
              />
            )}
            {!active && <p className="text-sm text-[var(--text-muted)]">{starters ? 'Pick a starter to begin.' : 'Making starting covers…'}</p>}
            {busy && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-sm bg-[var(--bg-white)] rounded px-3 py-1.5 shadow">{busy}</div>}
            {error && materials && (
              <button className="absolute top-3 left-1/2 -translate-x-1/2 text-sm bg-[var(--bg-white)] rounded px-3 py-1.5 shadow text-[var(--status-error)]" onClick={() => setError(null)}>{error} ✕</button>
            )}
          </div>
          {provenance && (
            <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--border-light)] shrink-0">
              From this book&apos;s scans: {provenance}. Lettering from the catalogue record.
            </p>
          )}
        </main>

        {/* Layers + inspector */}
        <aside className="lg:w-[320px] lg:border-l border-[var(--border-light)] flex flex-col min-h-0 order-3 overflow-y-auto max-h-[50dvh] lg:max-h-none">
          {active && (
            <section className="p-3 border-b border-[var(--border-light)]">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium">Layers</h2>
                <AddMenu onText={addText} onShape={addShape} onFill={addFill} />
              </div>
              <ul className="flex flex-col-reverse gap-0.5">
                {active.layers.map((l, i) => (
                  <li
                    key={l.id}
                    className={`group flex items-center gap-1 rounded px-1.5 py-1 text-sm cursor-pointer ${l.id === selected ? 'bg-[var(--text-primary)] text-[var(--bg-cream)]' : 'hover:bg-[var(--bg-warm)]'}`}
                    onClick={() => setSelected(l.id)}
                  >
                    <span className={`flex-1 truncate ${l.hidden ? 'opacity-40' : ''}`}>{l.name}</span>
                    <IconBtn label="Move up" onClick={() => moveLayer(l.id, 1)} disabled={i === active.layers.length - 1}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn label="Move down" onClick={() => moveLayer(l.id, -1)} disabled={i === 0}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn label={l.locked ? 'Unlock' : 'Lock'} onClick={() => patchLayer(l.id, { locked: !l.locked })}>{l.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5 opacity-40" />}</IconBtn>
                    <IconBtn label={l.hidden ? 'Show' : 'Hide'} onClick={() => patchLayer(l.id, { hidden: !l.hidden })}>{l.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</IconBtn>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sel && materials && (
            <section className="p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium truncate">{sel.name}</h2>
                <div className="flex gap-1">
                  <IconBtn label="Duplicate" onClick={() => duplicateLayer(sel.id)}><Copy className="w-4 h-4" /></IconBtn>
                  <IconBtn label="Delete" onClick={() => removeLayer(sel.id)}><Trash2 className="w-4 h-4" /></IconBtn>
                </div>
              </div>
              <Inspector
                key={sel.id}
                layer={sel}
                materials={materials}
                patch={(p, commit = true) => patchLayer(sel.id, p, commit)}
                onCrop={() => setCropFor(sel.id)}
                onFillBoard={() => patchLayer(sel.id, { x: W / 2, y: H / 2, w: W, h: H, rot: 0 })}
              />
            </section>
          )}
          {!sel && active && <p className="p-3 text-sm text-[var(--text-muted)]">Click something on the cover, or a layer, to change it. Grounds start locked so they don&apos;t move when you drag on them.</p>}
        </aside>
      </div>

      {cropFor && (() => {
        const l = active?.layers.find(x => x.id === cropFor);
        if (!l || l.kind !== 'image') return null;
        return (
          <CropDialog
            src={l.src}
            page={l.page}
            initial={l.crop}
            onClose={() => setCropFor(null)}
            onApply={(crop, threshold) => {
              const img = images.get(l.src);
              const iw = img instanceof HTMLImageElement ? img.naturalWidth : 1;
              const ih = img instanceof HTMLImageElement ? img.naturalHeight : 1;
              const aspect = (crop.w * iw) / (crop.h * ih);
              const shown = l.srcRot === 90 || l.srcRot === 270 ? 1 / aspect : aspect;
              const isGround = l.w === W && l.h === H;
              patchLayer(l.id, { crop, ...(isGround ? {} : { h: l.w / shown }), ...(threshold != null && l.treatment !== 'photo' ? { threshold } : {}) });
              setCropFor(null);
            }}
          />
        );
      })()}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="p-1 rounded opacity-70 hover:opacity-100 disabled:opacity-20"
    >
      {children}
    </button>
  );
}

function AddMenu({ onText, onShape, onFill }: { onText: () => void; onShape: (s: ShapeKind) => void; onFill: () => void }) {
  const [open, setOpen] = useState(false);
  const items: [string, () => void][] = [
    ['Text', onText],
    ['Frame', () => onShape('frame')],
    ['Double frame', () => onShape('double-frame')],
    ['Rule', () => onShape('rule')],
    ['Oval', () => onShape('oval')],
    ['Sunk panel', () => onShape('panel')],
    ['Paper label', () => onShape('label')],
    ['Cloth or colour', onFill],
  ];
  return (
    <div className="relative">
      <button className="cm-btn !py-1" onClick={() => setOpen(o => !o)}><Plus className="w-4 h-4" /> Add</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 mt-1 z-20 bg-[var(--bg-white)] border border-[var(--border-light)] rounded shadow-lg py-1 w-44">
            {items.map(([label, fn]) => (
              <li key={label}><button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-warm)]" onClick={() => { fn(); setOpen(false); }}>{label}</button></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── The board with direct manipulation ──────────────────────────────────────

type DragState =
  | { mode: 'move'; id: string; px: number; py: number; x0: number; y0: number }
  | { mode: 'scale'; id: string; d0: number; l0: Layer }
  | { mode: 'rotate'; id: string; a0: number; r0: number };

function Board({ cover, width, images, tick, fontsReady, selected, onSelect, onChange }: {
  cover: Cover;
  width: number;
  images: ImageMap;
  tick: number;
  fontsReady: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (l: Partial<Layer> & { id: string }, commit: boolean) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const moved = useRef(false);
  const k = W / width;
  const sel = cover.layers.find(l => l.id === selected && !l.hidden);

  const pt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const hit = (x: number, y: number): Layer | null => {
    for (let i = cover.layers.length - 1; i >= 0; i--) {
      const l = cover.layers[i];
      if (l.hidden || l.locked || l.kind === 'fill') continue;
      const a = (-l.rot * Math.PI) / 180;
      const dx = x - l.x, dy = y - l.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const pad = 8 * k;
      if (Math.abs(lx) <= l.w / 2 + pad && Math.abs(ly) <= layerHeight(l) / 2 + pad) return l;
    }
    return null;
  };

  const down = (e: React.PointerEvent) => {
    svg.current!.setPointerCapture(e.pointerId);
    const p = pt(e);
    const role = (e.target as Element).getAttribute('data-handle');
    moved.current = false;
    if (sel && role === 'scale') {
      drag.current = { mode: 'scale', id: sel.id, d0: Math.hypot(p.x - sel.x, p.y - sel.y), l0: sel };
      return;
    }
    if (sel && role === 'rotate') {
      drag.current = { mode: 'rotate', id: sel.id, a0: Math.atan2(p.y - sel.y, p.x - sel.x), r0: sel.rot };
      return;
    }
    const l = hit(p.x, p.y);
    onSelect(l ? l.id : null);
    if (l) drag.current = { mode: 'move', id: l.id, px: p.x, py: p.y, x0: l.x, y0: l.y };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pt(e);
    moved.current = true;
    if (d.mode === 'move') {
      let x = d.x0 + p.x - d.px, y = d.y0 + p.y - d.py;
      // Snap to the board's centre lines.
      if (Math.abs(x - W / 2) < 8 * k) x = W / 2;
      if (Math.abs(y - H / 2) < 8 * k) y = H / 2;
      onChange({ id: d.id, x, y }, false);
    } else if (d.mode === 'scale') {
      const f = Math.max(0.05, Math.hypot(p.x - d.l0.x, p.y - d.l0.y) / Math.max(1, d.d0));
      const l0 = d.l0;
      if (l0.kind === 'text') onChange({ id: d.id, size: l0.size * f, w: l0.w * f } as Partial<Layer> & { id: string }, false);
      else onChange({ id: d.id, w: l0.w * f, h: l0.h * f }, false);
    } else {
      let r = d.r0 + ((Math.atan2(p.y - (sel?.y ?? 0), p.x - (sel?.x ?? 0)) - d.a0) * 180) / Math.PI;
      r = ((r + 540) % 360) - 180;
      if (!e.shiftKey) for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(r - snap) < 3) r = snap;
      onChange({ id: d.id, rot: r }, false);
    }
  };

  const up = () => {
    if (drag.current && moved.current) onChange({ id: drag.current.id }, true);
    drag.current = null;
  };

  const hs = 9 * k;
  const selH = sel ? layerHeight(sel) : 0;

  return (
    <div className="relative shadow-[0_10px_40px_rgba(0,0,0,0.35)]" style={{ width, height: (width * H) / W }}>
      <CoverCanvas cover={cover} width={width} images={images} tick={tick} fontsReady={fontsReady} />
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 w-full h-full touch-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {sel && sel.kind !== 'fill' && (
          <g transform={`translate(${sel.x} ${sel.y}) rotate(${sel.rot})`}>
            <rect x={-sel.w / 2} y={-selH / 2} width={sel.w} height={selH} fill="none" stroke="#fff" strokeWidth={2.5 * k} />
            <rect x={-sel.w / 2} y={-selH / 2} width={sel.w} height={selH} fill="none" stroke="#9e4a3a" strokeWidth={1.2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
            {!sel.locked && (
              <>
                {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
                  <circle key={`${sx}${sy}`} data-handle="scale" cx={(sx * sel.w) / 2} cy={(sy * selH) / 2} r={hs} fill="#fff" stroke="#9e4a3a" strokeWidth={2 * k} style={{ cursor: 'nwse-resize' }} />
                ))}
                <line x1={0} y1={-selH / 2} x2={0} y2={-selH / 2 - 34 * k} stroke="#fff" strokeWidth={2 * k} />
                <circle data-handle="rotate" cx={0} cy={-selH / 2 - 34 * k} r={hs} fill="#9e4a3a" stroke="#fff" strokeWidth={2 * k} style={{ cursor: 'grab' }} />
              </>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}
