'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Download, Eye, EyeOff, FileDown, FileUp, Lock, Plus, Redo2, Save, Trash2, Undo2, Unlock } from 'lucide-react';
import { loadImage, surfaceStats } from './analyze';
import { assetToLayer, baseAssets, letteringAssets, replaceImage, type Asset } from './assets';
import { Board } from './Board';
import { CoverCanvas } from './CoverCanvas';
import { CropDialog } from './CropDialog';
import { ElementsPanel } from './ElementsPanel';
import { loadCoverFonts } from './fonts';
import { Inspector } from './Inspector';
import { fillLayer, imageLayer, shortTitle } from './layers';
import { clearRenderCache, renderCover, type ImageMap } from './render';
import { buildStarters } from './starters';
import { H, W, uid, type Cover, type Crop, type Layer, type Leaf, type Materials } from './types';

/**
 * The cover maker: starting covers made from a book's own scans, an elements
 * panel holding everything the book offers, and a board to arrange them on.
 * Admin only (/admin/covers). Work in progress is kept in this browser
 * (localStorage, per book); Save stores a concept in Source Library
 * (cover_concepts, never applied to the book); Save file downloads the layers
 * as JSON that Open file reads back; Download PNG exports the picture.
 */

const STORE_KEY = (id: string) => `cover-maker:v1:${id}`;
const FILE_FORMAT = 'sourcelibrary-cover';

/** What Save compares against: the parts of a design that are the design. */
const snapshot = (c: Cover) => JSON.stringify({ name: c.name, layers: c.layers });

interface Concept { id: string; book_id: string; name: string; layers: Layer[]; updated_at: string }

const ROLE_LABEL: Record<string, string> = {
  outside: 'binding', endpaper: 'endpaper', title: 'title page', frontispiece: 'frontispiece', plate: 'plate', leaf: 'page',
};

type Tab = 'start' | 'elements' | 'pages';

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

function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, number, number] {
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

/** Is a layer the cover's background: a full-board picture or an all-over colour? */
const isGround = (l: Layer) => (l.kind === 'fill' && l.region === 'all') || (l.kind === 'image' && l.w >= W - 1 && l.h >= H - 1);

function hexLum(hex: string): number {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export default function CoverMaker({ bookId, openDesign }: { bookId: string; openDesign?: string }) {
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starters, setStarters] = useState<Cover[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [letteringReady, setLetteringReady] = useState(false);
  const [designs, setDesigns] = useState<Cover[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('start');
  const [cropFor, setCropFor] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [pagePick, setPagePick] = useState<Leaf | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const images = useRef<ImageMap>(new Map()).current;
  const [tick, setTick] = useState(0);
  const history = useRef<{ past: Cover[]; future: Cover[]; base: Cover | null }>({ past: [], future: [], base: null });
  const lumCache = useRef(new Map<string, number>()).current;
  /** Snapshot of each design as last saved to Source Library, by design id. */
  const [savedAs, setSavedAs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // ── Load ──
  useEffect(() => {
    let live = true;
    loadCoverFonts().then(() => { if (live) { clearRenderCache(); setFontsReady(true); } });
    fetch(`/api/admin/cover-materials/${encodeURIComponent(bookId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'This book was not found.' : 'Could not load this book.'))))
      .then((m: Materials) => { if (live) { setMaterials(m); setAssets(baseAssets(m)); } })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [bookId]);

  useEffect(() => {
    if (!materials) return;
    let live = true;
    letteringAssets(materials).then(ls => {
      if (!live) return;
      setAssets(a => [...a.filter(x => x.group !== 'lettering'), ...ls]);
      setLetteringReady(true);
    });
    return () => { live = false; };
  }, [materials]);

  useEffect(() => {
    if (!materials || !fontsReady) return;
    let live = true;
    const server = fetch(`/api/admin/cover-concepts?book=${encodeURIComponent(materials.book.id)}`)
      .then(r => (r.ok ? r.json() : { concepts: [] }))
      .then((d: { concepts: Concept[] }) => d.concepts || [])
      .catch(() => [] as Concept[]);
    Promise.all([buildStarters(materials), server]).then(([s, concepts]) => {
      if (!live) return;
      setStarters(s);
      const local = readSaved(materials.book.id)?.designs || [];
      // This browser's copy wins when both exist: it holds the latest edits.
      // Saved concepts this browser doesn't have are added.
      const ids = new Set(local.map(d => d.id));
      const fromServer = concepts.filter(c => !ids.has(c.id)).map(c => ({ id: c.id, name: c.name, layers: c.layers }));
      const all = [...local, ...fromServer];
      setSavedAs(Object.fromEntries(concepts.map(c => [c.id, snapshot({ id: c.id, name: c.name, layers: c.layers })])));
      if (all.length) {
        setDesigns(all);
        const want = openDesign && all.some(d => d.id === openDesign) ? openDesign : readSaved(materials.book.id)?.activeId;
        setActiveId(want && all.some(d => d.id === want) ? want : all[0].id);
        setTab('elements');
      } else if (s.length) {
        const first = { ...clone(s[0]), id: uid() };
        setDesigns([first]);
        setActiveId(first.id);
      }
    });
    return () => { live = false; };
  }, [materials, fontsReady, openDesign]);

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
    setActive({ ...active, layers: active.layers.map(l => (l.id === id ? ({ ...l, ...patch, id } as Layer) : l)) }, commit);
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

  const removeLayer = useCallback((id: string) => {
    if (!active) return;
    setActive({ ...active, layers: active.layers.filter(l => l.id !== id) });
    setSelected(null);
    setCropMode(false);
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
    d.layers = d.layers.map(l => ({ ...l, id: uid() }));
    setDesigns(ds => [...ds, d]);
    setActiveId(d.id);
    setSelected(null);
    setCropMode(false);
    setTab('elements');
  };

  const deleteDesign = (id: string) => {
    const d = designs.find(x => x.id === id);
    if (savedAs[id] && !window.confirm(`Remove “${d?.name}” from the saved concepts too?`)) return;
    if (savedAs[id]) {
      fetch(`/api/admin/cover-concepts/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
      setSavedAs(m => { const n = { ...m }; delete n[id]; return n; });
    }
    const rest = designs.filter(d => d.id !== id);
    setDesigns(rest);
    if (activeId === id) setActiveId(rest[0]?.id ?? null);
    if (!rest.length && materials) writeSaved(materials.book.id, { designs: [], activeId: null });
  };

  /** Blank starting points: the book's own binding if it has one, and plain cloth. */
  const blanks = useMemo<Cover[]>(() => {
    if (!materials) return [];
    const out: Cover[] = [];
    const board = materials.leaves.find(l => l.role === 'outside') || materials.leaves.find(l => l.role === 'endpaper');
    if (board) {
      out.push({ id: 'blank-board', name: 'Blank', layers: [imageLayer(board, board.w || 1000, board.h || 1500, { ground: true, crop: { x: 0.06, y: 0.04, w: 0.88, h: 0.92 }, name: `${board.role === 'outside' ? 'Binding' : 'Endpaper'}, p. ${board.n}` })] });
    }
    out.push({ id: 'blank-cloth', name: 'Blank', layers: [fillLayer('#4a2620', { texture: 'cloth', name: 'Cloth' })] });
    return out;
  }, [materials]);

  // ── Adding elements ──
  const groundIsDark = (): boolean => {
    const g = active?.layers.find(isGround);
    if (!g) return true;
    if (g.kind === 'fill') return hexLum(g.color) < 0.5;
    if (g.kind !== 'image') return true;
    let lum = lumCache.get(g.src);
    const img = images.get(g.src);
    if (lum == null && img instanceof HTMLImageElement) { lum = surfaceStats(img).lum; lumCache.set(g.src, lum); }
    return lum == null ? true : lum < 0.55;
  };

  const dimsFor = async (leaf: Leaf): Promise<[number, number]> => {
    const img = await loadImage(leaf.display);
    images.set(leaf.display, img);
    setTick(t => t + 1);
    return [img.naturalWidth, img.naturalHeight];
  };

  const addAsset = async (a: Asset, at?: { x: number; y: number }) => {
    if (!active) return;
    try {
      if (a.kind === 'image') setBusy('Loading…');
      const dims = a.kind === 'image' ? await dimsFor(a.leaf) : undefined;
      const { layer, ground } = assetToLayer(a, { dark: groundIsDark(), dims, at });
      let layers: Layer[];
      if (ground) {
        // A new binding or cloth replaces the background rather than piling up.
        const i = active.layers.findIndex(isGround);
        layers = i >= 0 ? active.layers.map((l, k) => (k === i ? layer : l)) : [layer, ...active.layers];
      } else if (layer.kind === 'fill') {
        const i = active.layers.findIndex(isGround);
        layers = [...active.layers];
        layers.splice(i + 1, 0, layer);
      } else {
        layers = [...active.layers, layer];
      }
      setActive({ ...active, layers });
      setSelected(ground ? null : layer.id);
      setCropMode(false);
    } catch {
      setError('That page could not be loaded.');
    } finally {
      setBusy(null);
    }
  };

  const replaceSelected = async (a: Asset) => {
    if (!active || !sel || sel.kind !== 'image' || a.kind !== 'image') return addAsset(a);
    try {
      setBusy('Loading…');
      const dims = await dimsFor(a.leaf);
      const next = replaceImage(sel, a, dims);
      setActive({ ...active, layers: active.layers.map(l => (l.id === sel.id ? next : l)) });
    } catch {
      setError('That page could not be loaded.');
    } finally {
      setBusy(null);
    }
  };

  const addFromPage = async (leaf: Leaf, crop: Crop, asGround: boolean) => {
    if (!active) return;
    const dims = await dimsFor(leaf);
    const l = imageLayer(leaf, dims[0], dims[1], { crop, ground: asGround, width: W * 0.6, name: asGround ? `Page ${leaf.n}` : `Picture, p. ${leaf.n}` });
    if (!asGround && l.h > H * 0.7) { l.w *= (H * 0.7) / l.h; l.h = H * 0.7; }
    if (asGround) {
      const i = active.layers.findIndex(isGround);
      setActive({ ...active, layers: i >= 0 ? active.layers.map((x, k) => (k === i ? l : x)) : [l, ...active.layers] });
    } else {
      setActive({ ...active, layers: [...active.layers, l] });
      setSelected(l.id);
    }
    setPagePick(null);
  };

  // ── Save ──
  const thumbOf = (c: Cover): string | null => {
    try {
      const s = 240 / W;
      const cv = document.createElement('canvas');
      cv.width = 240;
      cv.height = Math.round(H * s);
      renderCover(cv.getContext('2d')!, c, s, images);
      return cv.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    }
  };

  const saveActive = async () => {
    if (!active || !materials) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/cover-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: active.id, book_id: materials.book.id, name: active.name, layers: active.layers, thumb: thumbOf(active) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setSavedAs(m => ({ ...m, [active.id]: snapshot(active) }));
    } catch (e) {
      setError(`Not saved: ${e instanceof Error ? e.message : 'unknown error'}. Your work is still kept in this browser.`);
    } finally {
      setSaving(false);
    }
  };

  const fileSlug = () => materials ? shortTitle(materials.book.title).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) : 'cover';

  const saveFile = () => {
    if (!active || !materials) return;
    const data = {
      format: FILE_FORMAT, version: 1, saved_at: new Date().toISOString(),
      book: { id: materials.book.id, title: materials.book.title },
      cover: { id: active.id, name: active.name, layers: active.layers },
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${fileSlug() || 'cover'}-${active.name.toLowerCase().replace(/\s+/g, '-')}.cover.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const openFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== FILE_FORMAT || !Array.isArray(data?.cover?.layers)) throw new Error('not a cover file');
      if (materials && data.book?.id && data.book.id !== materials.book.id
        && !window.confirm(`This cover was made for “${data.book.title}”. Open it here anyway? Its pictures still come from that book.`)) return;
      const c: Cover = { id: uid(), name: `${data.cover.name || 'Opened'} (file)`, layers: data.cover.layers };
      setDesigns(ds => [...ds, c]);
      setActiveId(c.id);
      setSelected(null);
      setTab('elements');
    } catch {
      setError('That file is not a cover saved from the cover maker.');
    }
  };

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
      a.download = `${fileSlug() || 'cover'}-${active.name.toLowerCase().replace(/\s+/g, '-')}.png`;
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
      if (cropFor || pagePick || t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (e.key === 'Escape') { if (cropMode) setCropMode(false); else setSelected(null); return; }
      if (e.key === 'Enter' && cropMode) { setCropMode(false); return; }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(sel.id); return; }
      const step = e.shiftKey ? 20 : 2;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key] && sel.kind !== 'fill') {
        e.preventDefault();
        patchLayer(sel.id, { x: sel.x + moves[e.key][0], y: sel.y + moves[e.key][1] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, cropFor, pagePick, cropMode, undo, redo, removeLayer, patchLayer]);

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

  const [stageRef, stageW, stageH] = useSize<HTMLDivElement>();
  const boardW = Math.max(160, Math.min(stageW - 32, ((stageH - 40) * W) / H, 640));

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
  const hint = !sel
    ? 'Click something on the cover to change it. Double-click a picture or the background to reposition what shows inside it.'
    : cropMode
      ? 'Drag the page to choose what shows. Drag the sides to show more or less. Enter or Done when finished.'
      : sel.kind === 'image'
        ? 'Drag to move. Corners resize. Sides crop: drag outward to show more of the page. Hold Alt to move without snapping.'
        : sel.kind === 'text'
          ? 'Drag to move. Corners resize the lettering. Sides set how wide the lines run.'
          : 'Drag to move. Corners resize, sides stretch.';

  const tabs: { v: Tab; label: string }[] = [
    { v: 'start', label: 'New cover' },
    { v: 'elements', label: 'Elements' },
    { v: 'pages', label: `All pages${leaves.length ? ` ${leaves.length}` : ''}` },
  ];

  return (
    <div className="cover-maker fixed inset-0 z-40 flex flex-col bg-[var(--bg-cream)] text-[var(--text-primary)]">
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

      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border-light)]">
        <Link href={`/book/${bookId}`} className="p-1.5 -ml-1.5 rounded hover:bg-[var(--bg-warm)]" aria-label="Back to the book"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-[var(--text-muted)]">Cover maker</div>
          <div className="truncate text-sm font-medium">{book ? shortTitle(book.title) : 'Loading…'}</div>
        </div>
        <Link href="/admin/covers" className="text-sm px-2 py-1 rounded hover:bg-[var(--bg-warm)] hidden sm:block">All concepts</Link>
        <button className="cm-btn" onClick={undo} disabled={!history.current.past.length} aria-label="Undo" title="Undo"><Undo2 className="w-4 h-4" /></button>
        <button className="cm-btn" onClick={redo} disabled={!history.current.future.length} aria-label="Redo" title="Redo"><Redo2 className="w-4 h-4" /></button>
        <button className="cm-btn" onClick={() => fileInput.current?.click()} title="Open a .cover.json file"><FileUp className="w-4 h-4" /> Open file</button>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
        <button className="cm-btn" onClick={saveFile} disabled={!active} title="Download this cover with all its layers as a file"><FileDown className="w-4 h-4" /> Save file</button>
        <button className="cm-btn" onClick={exportPng} disabled={!active || exporting}>
          <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'PNG'}
        </button>
        {active && savedAs[active.id] === snapshot(active)
          ? <span className="cm-btn cm-btn-primary opacity-80" title="Saved as a concept in Source Library"><Check className="w-4 h-4" /> Saved</span>
          : <button className="cm-btn cm-btn-primary" onClick={saveActive} disabled={!active || saving} title="Save as a concept in Source Library (never applied to the book)">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : savedAs[active?.id || ''] ? 'Save changes' : 'Save'}
            </button>}
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Left: new cover, elements, pages */}
        <aside className="lg:w-[360px] lg:border-r border-[var(--border-light)] flex flex-col min-h-0 order-2 lg:order-1 max-h-[45dvh] lg:max-h-none">
          <nav className="flex gap-1 px-3 py-2 border-b border-[var(--border-light)] shrink-0">
            {tabs.map(t => (
              <button key={t.v} onClick={() => setTab(t.v)}
                className={`whitespace-nowrap px-3 py-1.5 rounded text-sm ${tab === t.v ? 'bg-[var(--text-primary)] text-[var(--bg-cream)]' : 'hover:bg-[var(--bg-warm)]'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          <div data-cm-scroll className="flex-1 overflow-y-auto p-3">
            {tab === 'start' && (
              <div className="flex flex-col gap-5">
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">Start empty</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {blanks.map(b => (
                      <button key={b.id} onClick={() => startFrom(b)} className="text-left group">
                        <CoverCanvas cover={b} width={96} images={images} tick={tick} fontsReady={fontsReady} className="rounded-sm shadow group-hover:ring-2 ring-[var(--accent-rust)] max-w-full !h-auto aspect-[2/3]" />
                        <span className="block text-xs mt-1 text-[var(--text-muted)]">{b.id === 'blank-board' ? 'On its binding' : 'On cloth'}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] mb-2">Or start from a design</h3>
                  {!starters ? <p className="text-sm text-[var(--text-muted)]">Reading the scans…</p> : (
                    <div className="grid grid-cols-3 gap-3">
                      {starters.map(s => (
                        <button key={s.id} onClick={() => startFrom(s)} className="text-left group">
                          <CoverCanvas cover={s} width={96} images={images} tick={tick} fontsReady={fontsReady} className="rounded-sm shadow group-hover:ring-2 ring-[var(--accent-rust)] max-w-full !h-auto aspect-[2/3]" />
                          <span className="block text-xs mt-1">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                <p className="text-xs text-[var(--text-muted)]">Everything is made from this book&apos;s own scans and catalogue record. Each new cover opens as a tab above the board; your covers stay in this browser.</p>
              </div>
            )}
            {tab === 'elements' && (
              <ElementsPanel
                assets={assets}
                letteringReady={letteringReady}
                canReplace={sel?.kind === 'image' && !isGround(sel)}
                onAdd={a => addAsset(a)}
                onReplace={a => replaceSelected(a)}
              />
            )}
            {tab === 'pages' && (
              <>
                <p className="text-sm text-[var(--text-muted)] mb-3">Any page of the book. Click one to choose the part you want.</p>
                <div className="grid grid-cols-3 gap-2">
                  {leaves.map(leaf => (
                    <button key={leaf.n} onClick={() => setPagePick(leaf)} className="flex flex-col gap-1 text-left group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={leaf.thumb} alt={`Page ${leaf.n}`} title={leaf.note || `Page ${leaf.n}`} className="w-full aspect-[2/3] object-cover bg-[var(--bg-warm)] rounded border border-transparent group-hover:border-[var(--accent-rust)]" loading="lazy" />
                      <span className="text-xs text-[var(--text-muted)]">p. {leaf.n}{leaf.role !== 'leaf' ? ` · ${ROLE_LABEL[leaf.role]}` : ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Board */}
        <main className="flex-1 min-h-0 flex flex-col order-1 lg:order-2 min-w-0">
          <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-[var(--border-light)] shrink-0">
            {designs.map(d => (
              <div key={d.id} className={`flex items-center rounded text-sm whitespace-nowrap ${d.id === activeId ? 'bg-[var(--bg-warm)]' : ''}`}>
                <button className="px-2.5 py-1" onClick={() => { setActiveId(d.id); setSelected(null); setCropMode(false); }} title={savedAs[d.id] ? (savedAs[d.id] === snapshot(d) ? 'Saved' : 'Saved, with unsaved changes') : 'Not saved yet'}>
                  {d.name}{savedAs[d.id] && <span className={`ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle ${savedAs[d.id] === snapshot(d) ? 'bg-[var(--status-success)]' : 'bg-[var(--status-warning)]'}`} />}
                </button>
                {d.id === activeId && designs.length > 1 && (
                  <button className="pr-2 opacity-50 hover:opacity-100" aria-label={`Delete ${d.name}`} title="Delete this cover" onClick={() => deleteDesign(d.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
            <button className="px-2 py-1 text-sm rounded hover:bg-[var(--bg-warm)] whitespace-nowrap" onClick={() => setTab('start')}>
              <Plus className="w-3.5 h-3.5 inline -mt-0.5" /> New cover
            </button>
            {active && (
              <button className="px-2 py-1 text-sm rounded opacity-70 hover:opacity-100 hover:bg-[var(--bg-warm)] whitespace-nowrap" onClick={() => startFrom(active)}>
                <Copy className="w-3.5 h-3.5 inline -mt-0.5" /> Duplicate
              </button>
            )}
          </div>
          <div ref={stageRef} className="flex-1 min-h-[300px] flex items-center justify-center bg-[var(--bg-warm)] relative overflow-hidden">
            {active && stageW > 0 && (
              <Board
                cover={active}
                width={boardW}
                images={images}
                tick={tick}
                fontsReady={fontsReady}
                selected={selected}
                cropMode={cropMode}
                onSelect={id => { setSelected(id); if (id !== selected) setCropMode(false); }}
                onChange={(p, commit) => patchLayer(p.id, p, commit)}
                onCropMode={setCropMode}
                onDropAsset={(id, at) => { const a = assets.find(x => x.id === id); if (a) addAsset(a, at); }}
                onDuplicate={duplicateLayer}
                onDelete={removeLayer}
                onReplace={() => setTab('elements')}
              />
            )}
            {!active && <p className="text-sm text-[var(--text-muted)]">{starters ? 'Choose how to start, on the left.' : 'Making starting covers…'}</p>}
            {busy && <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-sm bg-[var(--bg-white)] rounded px-3 py-1.5 shadow">{busy}</div>}
            {error && materials && (
              <button className="absolute top-3 left-1/2 -translate-x-1/2 text-sm bg-[var(--bg-white)] rounded px-3 py-1.5 shadow text-[var(--status-error)]" onClick={() => setError(null)}>{error} ✕</button>
            )}
          </div>
          <div className="px-4 py-2 border-t border-[var(--border-light)] shrink-0 text-xs flex flex-col gap-0.5">
            <span>{hint}</span>
            {provenance && <span className="text-[var(--text-muted)]">From this book&apos;s scans: {provenance}. Lettering from the catalogue record.</span>}
          </div>
        </main>

        {/* Right: layers + inspector */}
        <aside className="lg:w-[320px] lg:border-l border-[var(--border-light)] flex flex-col min-h-0 order-3 overflow-y-auto max-h-[50dvh] lg:max-h-none">
          {active && (
            <section className="p-3 border-b border-[var(--border-light)]">
              <h2 className="text-sm font-medium mb-2">Layers</h2>
              <ul className="flex flex-col-reverse gap-0.5">
                {active.layers.map((l, i) => (
                  <li
                    key={l.id}
                    className={`group flex items-center gap-1 rounded px-1.5 py-1 text-sm cursor-pointer ${l.id === selected ? 'bg-[var(--text-primary)] text-[var(--bg-cream)]' : 'hover:bg-[var(--bg-warm)]'}`}
                    onClick={() => { setSelected(l.id); setCropMode(false); }}
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
                onCropInPlace={() => setCropMode(true)}
                onFillBoard={() => patchLayer(sel.id, { x: W / 2, y: H / 2, w: W, h: H, rot: 0 })}
              />
            </section>
          )}
          {!sel && active && <p className="p-3 text-sm text-[var(--text-muted)]">Nothing selected. Backgrounds are locked so they don&apos;t move when you drag on them; double-click the background to reposition it, or unlock it here.</p>}
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
              patchLayer(l.id, { crop, ...(isGround(l) ? {} : { h: l.w / shown }), ...(threshold != null && l.treatment !== 'photo' ? { threshold } : {}) });
              setCropFor(null);
            }}
          />
        );
      })()}

      {pagePick && (
        <CropDialog
          src={pagePick.display}
          page={pagePick.n}
          initial={{ x: 0.04, y: 0.03, w: 0.92, h: 0.94 }}
          applyLabel="Add to cover"
          onClose={() => setPagePick(null)}
          onApply={crop => addFromPage(pagePick, crop, false)}
          onApplyGround={crop => addFromPage(pagePick, crop, true)}
        />
      )}
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
