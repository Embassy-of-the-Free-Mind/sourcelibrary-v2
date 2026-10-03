'use client';

import { useRef, useState } from 'react';
import { AlignCenterHorizontal, AlignCenterVertical, Copy, Crop as CropIcon, Eraser, Replace, Trash2 } from 'lucide-react';
import { CoverCanvas } from './CoverCanvas';
import {
  aabb, boardToPage, cropEdge, effectiveCrop, imageDims, panCrop, rotate, snap, snapTargets, toLocal, toWorld,
  type Box, type Pt, type Targets,
} from './geometry';
import { layerHeight, type ImageMap } from './render';
import { H, W, type Cover, type Crop, type EraseMark, type ImageLayer, type Layer } from './types';

export interface EraseTool { shape: 'brush' | 'box'; mode: 'erase' | 'restore'; size: number }

/**
 * The cover with direct manipulation on top:
 *  - drag to move; corners resize (Alt: from the centre);
 *  - side handles crop a picture (drag out to reveal more of its page),
 *    set a text's measure, or stretch a shape;
 *  - double-click a picture to slide its page around inside the frame;
 *  - smart guides snap to the centre lines, the board edges and other
 *    elements (hold Alt to move freely), and show the gaps to each edge,
 *    lighting up when they match;
 *  - in erase mode, paint (brush) or drag a box to rub out parts of the
 *    selected picture, or bring them back.
 */

type Edge = 'n' | 's' | 'e' | 'w';
type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { mode: 'move'; p0: Pt; L0: Layer; T: Targets }
  | { mode: 'corner'; h: Corner; L0: Layer; T: Targets }
  | { mode: 'edge'; h: Edge; L0: Layer; c0: Crop | null; T: Targets }
  | { mode: 'rotate'; a0: number; L0: Layer }
  | { mode: 'pan'; p0: Pt; L0: ImageLayer; c0: Crop; iw: number; ih: number }
  | { mode: 'erase'; L0: ImageLayer; iw: number; ih: number; start: { x: number; y: number }; mark: EraseMark };

type Patch = Partial<Layer> & { id: string };

const GUIDE = '#e0457b';

export function Board({
  cover, width, images, tick, fontsReady, selected, cropMode, eraseTool,
  onSelect, onChange, onCropMode, onEraseMode, onDropAsset, onDuplicate, onDelete, onReplace,
}: {
  cover: Cover;
  width: number;
  images: ImageMap;
  tick: number;
  fontsReady: boolean;
  selected: string | null;
  cropMode: boolean;
  /** Set while erasing the selected picture. */
  eraseTool: EraseTool | null;
  onSelect: (id: string | null) => void;
  onChange: (p: Patch, commit: boolean) => void;
  onCropMode: (on: boolean) => void;
  onEraseMode: (on: boolean) => void;
  onDropAsset: (assetId: string, at: Pt) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReplace: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);
  const [guides, setGuides] = useState<{ xs: number[]; ys: number[]; box: Box | null }>({ xs: [], ys: [], box: null });
  const [dropping, setDropping] = useState(false);
  const [moving, setMoving] = useState(false);
  const k = W / width; // board units per CSS pixel
  const thr = 7 * k;
  const sel = cover.layers.find(l => l.id === selected && !l.hidden) || null;
  const selImg = sel?.kind === 'image' ? sel : null;
  const cropping = cropMode && !!selImg;
  const erasing = !!eraseTool && !!selImg;
  const [hover, setHover] = useState<Pt | null>(null);

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const hit = (p: Pt, includeLocked = false): Layer | null => {
    for (let i = cover.layers.length - 1; i >= 0; i--) {
      const l = cover.layers[i];
      if (l.hidden || l.kind === 'fill' || (l.locked && !includeLocked)) continue;
      const q = toLocal(p, l);
      const pad = 6 * k;
      if (Math.abs(q.x) <= l.w / 2 + pad && Math.abs(q.y) <= layerHeight(l) / 2 + pad) return l;
    }
    return null;
  };

  const startCrop = (L: ImageLayer): { c0: Crop; iw: number; ih: number } | null => {
    const d = imageDims(L, images);
    if (!d) return null;
    return { c0: effectiveCrop(L, d[0], d[1]), iw: d[0], ih: d[1] };
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    svg.current!.setPointerCapture(e.pointerId);
    const p = pt(e);
    const role = (e.target as Element).getAttribute('data-handle');
    moved.current = false;
    if (erasing && selImg && eraseTool) {
      const d = imageDims(selImg, images);
      if (!d) return;
      const q = boardToPage(selImg, p, d[0], d[1]);
      const mark: EraseMark = eraseTool.shape === 'brush'
        ? { t: 'brush', m: eraseTool.mode, r: (eraseTool.size / 2) * q.perUnit, p: [q.x, q.y] }
        : { t: 'box', m: eraseTool.mode, x: q.x, y: q.y, w: 0, h: 0 };
      drag.current = { mode: 'erase', L0: selImg, iw: d[0], ih: d[1], start: { x: q.x, y: q.y }, mark };
      if (mark.t === 'brush') { moved.current = true; onChange({ id: selImg.id, erase: [...(selImg.erase || []), mark] } as Patch, false); }
      return;
    }
    if (sel && role === 'rotate') {
      drag.current = { mode: 'rotate', a0: Math.atan2(p.y - sel.y, p.x - sel.x), L0: sel };
      return;
    }
    if (sel && role && ['nw', 'ne', 'sw', 'se'].includes(role)) {
      drag.current = { mode: 'corner', h: role as Corner, L0: sel, T: snapTargets(cover.layers, sel.id) };
      return;
    }
    if (sel && role && ['n', 's', 'e', 'w'].includes(role)) {
      const c = selImg ? startCrop(selImg) : null;
      if (selImg && !c) return;
      drag.current = { mode: 'edge', h: role as Edge, L0: sel, c0: c?.c0 ?? null, T: snapTargets(cover.layers, sel.id) };
      return;
    }
    if (cropping && selImg) {
      const q = toLocal(p, selImg);
      if (Math.abs(q.x) <= selImg.w / 2 && Math.abs(q.y) <= selImg.h / 2) {
        const c = startCrop(selImg);
        if (c) drag.current = { mode: 'pan', p0: p, L0: selImg, ...c };
        return;
      }
      onCropMode(false);
    }
    const l = hit(p);
    onSelect(l ? l.id : null);
    if (l) drag.current = { mode: 'move', p0: p, L0: l, T: snapTargets(cover.layers, l.id) };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = pt(e);
    if (erasing) setHover(p);
    if (!d) return;
    if (!moved.current) setMoving(true);
    moved.current = true;
    const free = e.altKey;

    if (d.mode === 'erase') {
      const q = boardToPage(d.L0, p, d.iw, d.ih);
      let mark: EraseMark;
      if (d.mark.t === 'brush') {
        const pts = d.mark.p;
        const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
        // Skip points closer than a third of the brush: smoother strokes, smaller files.
        if (Math.hypot(q.x - lx, (q.y - ly) * (d.ih / d.iw)) < d.mark.r * 0.35) return;
        mark = { ...d.mark, p: [...pts, q.x, q.y] };
      } else {
        mark = { ...d.mark, x: Math.min(d.start.x, q.x), y: Math.min(d.start.y, q.y), w: Math.abs(q.x - d.start.x), h: Math.abs(q.y - d.start.y) };
      }
      d.mark = mark;
      onChange({ id: d.L0.id, erase: [...(d.L0.erase || []), mark] } as Patch, false);
      return;
    }

    if (d.mode === 'move') {
      const L0 = d.L0;
      let dx = p.x - d.p0.x, dy = p.y - d.p0.y;
      const b0 = aabb(L0);
      const xs: number[] = [], ys: number[] = [];
      if (!free) {
        const sx = snap([b0.l + dx, (b0.l + b0.r) / 2 + dx, b0.r + dx], d.T.xs, thr);
        const sy = snap([b0.t + dy, (b0.t + b0.b) / 2 + dy, b0.b + dy], d.T.ys, thr);
        if (sx) { dx += sx.d; xs.push(sx.at); }
        if (sy) { dy += sy.d; ys.push(sy.at); }
      }
      setGuides({ xs, ys, box: { l: b0.l + dx, r: b0.r + dx, t: b0.t + dy, b: b0.b + dy } });
      onChange({ id: L0.id, x: L0.x + dx, y: L0.y + dy }, false);
      return;
    }

    if (d.mode === 'rotate') {
      const L0 = d.L0;
      let r = L0.rot + ((Math.atan2(p.y - L0.y, p.x - L0.x) - d.a0) * 180) / Math.PI;
      r = ((r + 540) % 360) - 180;
      if (!e.shiftKey) for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(r - s) < 4) r = s;
      onChange({ id: L0.id, rot: r }, false);
      return;
    }

    if (d.mode === 'pan') {
      const a = rotate({ x: p.x - d.p0.x, y: p.y - d.p0.y }, -d.L0.rot);
      onChange({ id: d.L0.id, crop: panCrop(d.L0, d.c0, d.iw, d.ih, a.x, a.y) } as Patch, false);
      return;
    }

    if (d.mode === 'corner') {
      const L0 = d.L0;
      const h0 = layerHeight(L0);
      const sx = d.h.includes('e') ? 1 : -1, sy = d.h.includes('s') ? 1 : -1;
      const fromCentre = e.altKey;
      const anchor = fromCentre ? { x: 0, y: 0 } : { x: (-sx * L0.w) / 2, y: (-sy * h0) / 2 };
      const corner = { x: (sx * L0.w) / 2, y: (sy * h0) / 2 };
      const q = toLocal(p, L0);
      const dv = { x: corner.x - anchor.x, y: corner.y - anchor.y };
      let f = ((q.x - anchor.x) * dv.x + (q.y - anchor.y) * dv.y) / (dv.x * dv.x + dv.y * dv.y);
      f = Math.max(0.04, f);
      const xs: number[] = [], ys: number[] = [];
      if (L0.rot === 0 && !fromCentre) {
        const ax = L0.x + anchor.x, ay = L0.y + anchor.y;
        const s1 = snap([ax + sx * L0.w * f], d.T.xs, thr);
        const s2 = snap([ay + sy * h0 * f], d.T.ys, thr);
        if (s1 && (!s2 || Math.abs(s1.d) <= Math.abs(s2.d))) { f = Math.abs(s1.at - ax) / L0.w; xs.push(s1.at); }
        else if (s2) { f = Math.abs(s2.at - ay) / h0; ys.push(s2.at); }
      }
      const w = L0.w * f, h = h0 * f;
      const c = fromCentre ? { x: L0.x, y: L0.y } : toWorld({ x: anchor.x + (sx * w) / 2, y: anchor.y + (sy * h) / 2 }, L0);
      const box = { l: c.x - w / 2, r: c.x + w / 2, t: c.y - h / 2, b: c.y + h / 2 };
      setGuides({ xs, ys, box: L0.rot === 0 ? box : null });
      if (L0.kind === 'text') onChange({ id: L0.id, x: c.x, y: c.y, w, size: L0.size * f } as Patch, false);
      else onChange({ id: L0.id, x: c.x, y: c.y, w, h }, false);
      return;
    }

    // Edge: crop a picture, set a text measure, stretch a shape.
    const L0 = d.L0;
    const h0 = layerHeight(L0);
    const q = toLocal(p, L0);
    const horiz = d.h === 'e' || d.h === 'w';
    const sign = d.h === 'e' || d.h === 's' ? 1 : -1;
    const half = horiz ? L0.w / 2 : h0 / 2;
    let delta = (horiz ? q.x : q.y) * sign - half;
    const xs: number[] = [], ys: number[] = [];
    if (L0.rot === 0 && !free) {
      const edgeAt = (horiz ? L0.x : L0.y) + sign * (half + delta);
      const s = snap([edgeAt], horiz ? d.T.xs : d.T.ys, thr);
      if (s) { delta += sign * s.d; (horiz ? xs : ys).push(s.at); }
    }
    let crop: Crop | undefined;
    if (L0.kind === 'image' && d.c0) {
      const r = cropEdge(L0, d.c0, d.h, delta);
      crop = r.crop;
      delta = r.delta;
    }
    const minSize = 12;
    delta = Math.max(minSize - (horiz ? L0.w : h0), delta);
    const shift = rotate(horiz ? { x: (sign * delta) / 2, y: 0 } : { x: 0, y: (sign * delta) / 2 }, L0.rot);
    const patch: Patch = { id: L0.id, x: L0.x + shift.x, y: L0.y + shift.y };
    if (horiz) patch.w = L0.w + delta; else patch.h = L0.h + delta;
    if (crop) (patch as Partial<ImageLayer>).crop = crop;
    setGuides({ xs, ys, box: L0.rot === 0 ? aabb({ ...L0, ...patch } as Layer) : null });
    onChange(patch, false);
  };

  const up = () => {
    const d = drag.current;
    if (d && moved.current) onChange({ id: d.L0.id }, true);
    drag.current = null;
    setMoving(false);
    setGuides({ xs: [], ys: [], box: null });
  };

  const dbl = (e: React.MouseEvent) => {
    if (erasing) return;
    const p = pt(e);
    // Double-click reaches locked grounds too, so a background can be repositioned.
    const l = hit(p) || hit(p, true);
    if (l?.kind === 'image') { onSelect(l.id); onCropMode(true); }
  };

  // ── Drawing ──
  const hs = 8 * k;
  const selH = sel ? layerHeight(sel) : 0;
  const box = sel ? aabb(sel) : null;
  const showCorners = sel && !sel.locked && !cropping && !erasing && sel.kind !== 'fill';
  const edges: Edge[] = !sel || sel.locked || erasing || sel.kind === 'fill' ? []
    : sel.kind === 'text' ? ['e', 'w']
    : sel.kind === 'shape' && sel.shape === 'rule' ? ['e', 'w']
    : ['n', 's', 'e', 'w'];
  const edgeHandle = (h: Edge) => {
    const horiz = h === 'e' || h === 'w';
    const cx = h === 'e' ? sel!.w / 2 : h === 'w' ? -sel!.w / 2 : 0;
    const cy = h === 's' ? selH / 2 : h === 'n' ? -selH / 2 : 0;
    const lw = horiz ? 7 * k : 26 * k, lh = horiz ? 26 * k : 7 * k;
    return (
      <rect key={h} data-handle={h} x={cx - lw / 2} y={cy - lh / 2} width={lw} height={lh} rx={3.5 * k}
        fill="#fff" stroke="#9e4a3a" strokeWidth={1.6 * k} style={{ cursor: horiz ? 'ew-resize' : 'ns-resize' }} />
    );
  };

  // The whole page, ghosted, while cropping in place.
  let ghost: React.ReactNode = null;
  if (cropping && selImg) {
    const dims = imageDims(selImg, images);
    const img = images.get(selImg.src);
    if (dims && img instanceof HTMLImageElement) {
      const c = effectiveCrop(selImg, dims[0], dims[1]);
      const side = selImg.srcRot === 90 || selImg.srcRot === 270;
      const tw = side ? selImg.h : selImg.w, th = side ? selImg.w : selImg.h;
      const PW = tw / c.w, PH = th / c.h;
      ghost = (
        <g transform={`translate(${selImg.x} ${selImg.y}) rotate(${selImg.rot}) rotate(${selImg.srcRot})`} pointerEvents="none">
          <image href={img.src} x={-tw / 2 - c.x * PW} y={-th / 2 - c.y * PH} width={PW} height={PH} opacity={0.42} preserveAspectRatio="none" />
          <rect x={-tw / 2 - c.x * PW} y={-th / 2 - c.y * PH} width={PW} height={PH} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.2 * k} strokeDasharray={`${4 * k} ${4 * k}`} />
        </g>
      );
    }
  }

  // Gaps from the dragged box to the board edges; matching pairs light up.
  const gapMarks = (() => {
    const b = guides.box;
    if (!b) return null;
    const gl = b.l, gr = W - b.r, gt = b.t, gb = H - b.b;
    const eqX = Math.abs(gl - gr) < 1, eqY = Math.abs(gt - gb) < 1;
    const cy = (b.t + b.b) / 2, cx = (b.l + b.r) / 2;
    const fs = 11 * k;
    const mark = (x1: number, y1: number, x2: number, y2: number, v: number, hot: boolean, key: string) => v > 2 && (
      <g key={key}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={hot ? GUIDE : '#fff'} strokeWidth={1.2 * k} strokeDasharray={hot ? undefined : `${3 * k} ${3 * k}`} />
        <rect x={(x1 + x2) / 2 - 18 * k} y={(y1 + y2) / 2 - 8 * k} width={36 * k} height={16 * k} rx={3 * k} fill={hot ? GUIDE : 'rgba(0,0,0,0.65)'} />
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 4 * k} fontSize={fs} fill="#fff" textAnchor="middle" fontFamily="system-ui, sans-serif">{Math.round(v)}</text>
      </g>
    );
    return (
      <g pointerEvents="none">
        {mark(0, cy, b.l, cy, gl, eqX, 'l')}
        {mark(b.r, cy, W, cy, gr, eqX, 'r')}
        {mark(cx, 0, cx, b.t, gt, eqY, 't')}
        {mark(cx, b.b, cx, H, gb, eqY, 'b')}
      </g>
    );
  })();

  // Small toolbar over the selection, in CSS pixels.
  const bar = sel && box && !moving && !erasing ? {
    left: Math.min(Math.max(((box.l + box.r) / 2) / k, 120), width - 120),
    top: box.t / k > 48 ? box.t / k - 44 : Math.min(box.b / k + 10, (H / k) - 40),
  } : null;

  return (
    <div
      className="relative shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
      style={{ width, height: (width * H) / W, outline: dropping ? `3px solid ${GUIDE}` : undefined }}
      onDragOver={e => { if (e.dataTransfer.types.includes('application/x-cover-asset')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={e => {
        setDropping(false);
        const id = e.dataTransfer.getData('application/x-cover-asset');
        if (id) { e.preventDefault(); onDropAsset(id, pt(e)); }
      }}
    >
      <CoverCanvas cover={cover} width={width} images={images} tick={tick} fontsReady={fontsReady} ghost={erasing ? selImg?.id : null} />
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 w-full h-full touch-none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={dbl}
        style={{ overflow: 'visible', cursor: erasing ? (eraseTool?.shape === 'brush' ? 'none' : 'crosshair') : undefined }}
      >
        {ghost}
        {guides.xs.map((x, i) => <line key={`x${i}`} x1={x} y1={0} x2={x} y2={H} stroke={GUIDE} strokeWidth={1.4 * k} pointerEvents="none" />)}
        {guides.ys.map((y, i) => <line key={`y${i}`} x1={0} y1={y} x2={W} y2={y} stroke={GUIDE} strokeWidth={1.4 * k} pointerEvents="none" />)}
        {gapMarks}
        {erasing && hover && eraseTool?.shape === 'brush' && (
          <g pointerEvents="none">
            <circle cx={hover.x} cy={hover.y} r={eraseTool.size / 2} fill={eraseTool.mode === 'erase' ? 'rgba(224,69,123,0.12)' : 'rgba(255,255,255,0.15)'} stroke="#fff" strokeWidth={1.5 * k} />
            <circle cx={hover.x} cy={hover.y} r={eraseTool.size / 2} fill="none" stroke={GUIDE} strokeWidth={1 * k} strokeDasharray={`${3 * k} ${3 * k}`} />
          </g>
        )}
        {sel && sel.kind !== 'fill' && (
          <g transform={`translate(${sel.x} ${sel.y}) rotate(${sel.rot})`}>
            <rect x={-sel.w / 2} y={-selH / 2} width={sel.w} height={selH} fill="none" stroke="#fff" strokeWidth={2.4 * k} pointerEvents="none" />
            <rect x={-sel.w / 2} y={-selH / 2} width={sel.w} height={selH} fill="none" stroke={cropping || erasing ? GUIDE : '#9e4a3a'} strokeWidth={1.4 * k} strokeDasharray={cropping || erasing ? undefined : `${6 * k} ${4 * k}`} pointerEvents="none" />
            {showCorners && (['nw', 'ne', 'sw', 'se'] as Corner[]).map(h => (
              <circle key={h} data-handle={h} cx={(h.includes('e') ? 1 : -1) * sel.w / 2} cy={(h.includes('s') ? 1 : -1) * selH / 2} r={hs}
                fill="#fff" stroke="#9e4a3a" strokeWidth={2 * k} style={{ cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }} />
            ))}
            {edges.map(edgeHandle)}
            {showCorners && (
              <>
                <line x1={0} y1={-selH / 2} x2={0} y2={-selH / 2 - 30 * k} stroke="#fff" strokeWidth={2 * k} pointerEvents="none" />
                <circle data-handle="rotate" cx={0} cy={-selH / 2 - 30 * k} r={hs} fill="#9e4a3a" stroke="#fff" strokeWidth={2 * k} style={{ cursor: 'grab' }} />
              </>
            )}
          </g>
        )}
      </svg>
      {bar && sel && (
        <div className="absolute -translate-x-1/2 flex items-center gap-0.5 rounded-md bg-[var(--text-primary)] text-[var(--bg-cream)] shadow-lg px-1 py-1 text-xs whitespace-nowrap z-10"
          style={{ left: bar.left, top: bar.top }}
          onPointerDown={e => e.stopPropagation()}>
          {sel.kind === 'image' && (
            <>
              <ToolBtn on={cropping} label={cropping ? 'Done' : 'Crop'} onClick={() => onCropMode(!cropping)}><CropIcon className="w-3.5 h-3.5" /></ToolBtn>
              <ToolBtn label="Erase" onClick={() => onEraseMode(true)}><Eraser className="w-3.5 h-3.5" /></ToolBtn>
              <ToolBtn label="Replace" onClick={onReplace}><Replace className="w-3.5 h-3.5" /></ToolBtn>
            </>
          )}
          {sel.kind !== 'fill' && (
            <>
              <ToolBtn label="Centre across" onClick={() => onChange({ id: sel.id, x: W / 2 }, true)}><AlignCenterVertical className="w-3.5 h-3.5" /></ToolBtn>
              <ToolBtn label="Centre up and down" onClick={() => onChange({ id: sel.id, y: H / 2 }, true)}><AlignCenterHorizontal className="w-3.5 h-3.5" /></ToolBtn>
            </>
          )}
          <ToolBtn label="Duplicate" onClick={() => onDuplicate(sel.id)}><Copy className="w-3.5 h-3.5" /></ToolBtn>
          <ToolBtn label="Delete" onClick={() => onDelete(sel.id)}><Trash2 className="w-3.5 h-3.5" /></ToolBtn>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, onClick, on, children }: { label: string; onClick: () => void; on?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded ${on ? 'bg-[#e0457b]' : 'hover:bg-white/15'}`}>
      {children}<span>{label}</span>
    </button>
  );
}
