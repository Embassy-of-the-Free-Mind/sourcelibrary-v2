import {
  H, W, uid,
  type Crop, type FillLayer, type ImageLayer, type Leaf, type ShapeKind, type ShapeLayer, type TextLayer,
} from './types';

/** Layer factories with sensible defaults, shared by the starters and the editor. */

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

export function imageLayer(
  leaf: Pick<Leaf, 'n' | 'role' | 'display' | 'full'>,
  srcW: number,
  srcH: number,
  opts: Partial<ImageLayer> & { ground?: boolean; width?: number } = {},
): ImageLayer {
  const crop = opts.crop || FULL;
  const rot = opts.srcRot || 0;
  const sideways = rot === 90 || rot === 270;
  const aspect = (crop.w * srcW) / (crop.h * srcH);
  const shown = sideways ? 1 / aspect : aspect;
  const w = opts.ground ? W : opts.width || W * 0.6;
  const { ground, width, ...rest } = opts;
  void width;
  return {
    id: uid(),
    kind: 'image',
    name: ground ? `Ground · p. ${leaf.n}` : `Page ${leaf.n}`,
    x: W / 2,
    y: H / 2,
    w,
    h: ground ? H : w / shown,
    rot: 0,
    opacity: 1,
    blend: 'normal',
    locked: !!ground,
    page: leaf.n,
    role: leaf.role,
    src: leaf.display,
    full: leaf.full,
    crop,
    srcRot: rot,
    treatment: 'photo',
    color: '#1a1612',
    threshold: 0.5,
    softness: 0.18,
    invert: false,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    depth: 2,
    ...rest,
  };
}

export function textLayer(text: string, opts: Partial<TextLayer> = {}): TextLayer {
  return {
    id: uid(),
    kind: 'text',
    name: text.split('\n')[0].slice(0, 28) || 'Text',
    x: W / 2,
    y: H * 0.3,
    w: W * 0.72,
    h: 80,
    rot: 0,
    opacity: 1,
    blend: 'normal',
    text,
    font: 'cardo',
    size: 64,
    weight: 400,
    italic: false,
    caps: true,
    tracking: 0.08,
    leading: 1.15,
    align: 'center',
    finish: 'gilt',
    color: '#c9a86c',
    depth: 1.5,
    ...opts,
  };
}

const SHAPE_NAMES: Record<ShapeKind, string> = {
  frame: 'Frame', 'double-frame': 'Double frame', rule: 'Rule', oval: 'Oval', panel: 'Sunk panel', label: 'Paper label',
};

export function shapeLayer(shape: ShapeKind, opts: Partial<ShapeLayer> = {}): ShapeLayer {
  const sizes: Record<ShapeKind, [number, number]> = {
    frame: [W - 110, H - 110],
    'double-frame': [W - 110, H - 110],
    rule: [W * 0.4, 5],
    oval: [W * 0.55, W * 0.7],
    panel: [W * 0.6, W * 0.75],
    label: [W * 0.62, H * 0.2],
  };
  const [w, h] = sizes[shape];
  return {
    id: uid(),
    kind: 'shape',
    name: SHAPE_NAMES[shape],
    x: W / 2,
    y: H / 2,
    w,
    h,
    rot: 0,
    opacity: 1,
    blend: 'normal',
    shape,
    stroke: shape === 'rule' ? 5 : 6,
    finish: shape === 'label' ? 'ink' : 'gilt',
    color: shape === 'label' ? '#e9dfc6' : '#c9a86c',
    depth: shape === 'panel' ? 4 : 1.5,
    ...opts,
  };
}

export function fillLayer(color: string, opts: Partial<FillLayer> = {}): FillLayer {
  return {
    id: uid(),
    kind: 'fill',
    name: opts.texture && opts.texture !== 'none' ? `${opts.texture[0].toUpperCase()}${opts.texture.slice(1)}` : 'Colour',
    x: W / 2,
    y: H / 2,
    w: W,
    h: H,
    rot: 0,
    opacity: 1,
    blend: 'normal',
    locked: true,
    color,
    texture: 'cloth',
    region: 'all',
    ...opts,
  };
}

/**
 * The working title for a cover: the book's own title, cut at the point where
 * early-modern titles turn into a description of the contents. Never rewritten,
 * only shortened; the full title is one click away in the editor.
 */
export function shortTitle(title: string): string {
  const t = title.trim();
  const cut = t.search(/\s*(?:[:;.]\s|,\s*(?:being|or|containing|with|wherein|in which|together|and also|nebst|oder|sive|seu|in quo|darinnen)\b)/i);
  const head = cut > 8 ? t.slice(0, cut) : t;
  return head.length > 90 ? `${head.slice(0, 88).replace(/\s+\S*$/, '')}…` : head;
}

/** "Arthur Lister (1830-1908); plates by Gulielma Lister" → "Arthur Lister". */
export function shortAuthor(author: string): string {
  return author.split(/;|\bplates by\b|\brevised by\b/i)[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim();
}

export function yearOf(published: string): string {
  return published.match(/\d{3,4}/)?.[0] || published;
}
