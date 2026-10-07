import { findInkArea, findTextBlocks, loadImage } from './analyze';
import { fillLayer, imageLayer, shapeLayer, shortAuthor, shortTitle, textLayer, yearOf } from './layers';
import { H, W, uid, type Crop, type ImageLayer, type Layer, type Leaf, type Materials, type ShapeKind, type Texture } from './types';

/**
 * The elements panel: everything a cover can be built from, as ready-made
 * pieces. Grounds, lettering and pictures all come from the book's own pages;
 * type comes from its catalogue record.
 */

export type AssetGroup = 'grounds' | 'lettering' | 'pictures' | 'ornaments' | 'type' | 'decoration';

export type Asset =
  | { id: string; group: 'grounds' | 'lettering' | 'pictures' | 'ornaments'; kind: 'image'; label: string; leaf: Leaf; crop: Crop; rot: 0 | 90 | 180 | 270; thumb: string | null; threshold?: number }
  | { id: string; group: 'type'; kind: 'text'; label: string; text: string; style: 'title' | 'author' | 'small' }
  | { id: string; group: 'decoration'; kind: 'shape'; label: string; shape: ShapeKind }
  | { id: string; group: 'decoration' | 'grounds'; kind: 'fill'; label: string; color: string; texture: Texture };

export const GROUP_LABEL: Record<AssetGroup, string> = {
  grounds: 'Binding, endpapers and cloth',
  lettering: 'Lettering from the title page',
  pictures: 'Plates and pictures',
  ornaments: 'Ornaments, initials and devices',
  type: 'Type',
  decoration: 'Frames, rules and labels',
};

const BOARD_CROP: Crop = { x: 0.06, y: 0.04, w: 0.88, h: 0.92 };
const ORNAMENT_TYPES = new Set(['decorative', 'emblem', 'symbol', 'exlibris', 'bookplate']);
const SKIP_TYPES = new Set(['table', 'chart', 'musical_score']);

/** The elements that need no image analysis. Lettering is added by `letteringAssets`. */
export function baseAssets(m: Materials): Asset[] {
  const { book, leaves, images } = m;
  const out: Asset[] = [];
  const byPage = new Map(leaves.map(l => [l.n, l]));

  for (const leaf of leaves.filter(l => l.role === 'outside' || l.role === 'endpaper')) {
    out.push({ id: `g${leaf.n}`, group: 'grounds', kind: 'image', label: `${leaf.role === 'outside' ? 'Binding' : 'Endpaper'}, p. ${leaf.n}`, leaf, crop: BOARD_CROP, rot: 0, thumb: leaf.thumb });
  }
  for (const [label, color, texture] of [
    ['Red cloth', '#5a2420', 'cloth'], ['Green cloth', '#2f4a2c', 'cloth'], ['Blue cloth', '#22324e', 'cloth'],
    ['Brown calf', '#5b3a24', 'leather'], ['Black morocco', '#211b18', 'leather'], ['Paper', '#e6dbc2', 'paper'],
  ] as const) {
    out.push({ id: `f-${label}`, group: 'grounds', kind: 'fill', label, color, texture });
  }

  const withCuts = new Set<number>();
  images.forEach((img, i) => {
    if (SKIP_TYPES.has(img.type)) return;
    const leaf = byPage.get(img.page);
    if (!leaf) return;
    withCuts.add(img.page);
    const ornament = ORNAMENT_TYPES.has(img.type);
    out.push({
      id: `i${i}`, group: ornament ? 'ornaments' : 'pictures', kind: 'image',
      label: `${img.description || img.type}, p. ${img.page}`, leaf,
      crop: { x: img.bbox.x, y: img.bbox.y, w: img.bbox.width, h: img.bbox.height },
      rot: img.rotation || 0, thumb: img.thumb || img.cut,
    });
  });
  // Plates nobody has cut out yet: offer the whole leaf.
  for (const leaf of leaves.filter(l => (l.role === 'plate' || l.role === 'frontispiece') && !withCuts.has(l.n))) {
    out.push({ id: `p${leaf.n}`, group: 'pictures', kind: 'image', label: `${leaf.role === 'frontispiece' ? 'Frontispiece' : 'Plate'}, p. ${leaf.n}`, leaf, crop: { x: 0.05, y: 0.04, w: 0.9, h: 0.92 }, rot: 0, thumb: leaf.thumb });
  }

  const year = yearOf(book.published);
  const imprint = [book.place, book.publisher, year].filter(Boolean).join(' · ');
  out.push({ id: 't-short', group: 'type', kind: 'text', label: 'Title', text: shortTitle(book.title), style: 'title' });
  if (shortTitle(book.title) !== book.title) out.push({ id: 't-full', group: 'type', kind: 'text', label: 'Full title', text: book.title, style: 'small' });
  if (book.display_title && book.display_title !== book.title) out.push({ id: 't-en', group: 'type', kind: 'text', label: 'English title', text: book.display_title, style: 'title' });
  if (book.author) out.push({ id: 't-author', group: 'type', kind: 'text', label: 'Author', text: shortAuthor(book.author), style: 'author' });
  if (year) out.push({ id: 't-year', group: 'type', kind: 'text', label: 'Year', text: year, style: 'author' });
  if (imprint && imprint !== year) out.push({ id: 't-imprint', group: 'type', kind: 'text', label: 'Imprint', text: imprint, style: 'small' });

  for (const [shape, label] of [
    ['frame', 'Frame'], ['double-frame', 'Double frame'], ['rule', 'Rule'], ['oval', 'Oval'], ['panel', 'Sunk panel'], ['label', 'Paper label'],
  ] as const) {
    out.push({ id: `s-${shape}`, group: 'decoration', kind: 'shape', label, shape });
  }
  out.push({ id: 'f-spine', group: 'decoration', kind: 'fill', label: 'Leather spine', color: '#4a2c1c', texture: 'leather' });
  return out;
}

/** Each block of lettering on the title page(s), found by looking at the scan. */
export async function letteringAssets(m: Materials): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const leaf of m.leaves.filter(l => l.role === 'title').slice(0, 3)) {
    let img: HTMLImageElement;
    try { img = await loadImage(leaf.display); } catch { continue; }
    findTextBlocks(img).forEach((b, i) => {
      out.push({ id: `l${leaf.n}-${i}`, group: 'lettering', kind: 'image', label: `Title page p. ${leaf.n}, block ${i + 1}`, leaf, crop: b.crop, rot: 0, thumb: null, threshold: b.threshold });
    });
    const all = findInkArea(img);
    out.push({ id: `l${leaf.n}-all`, group: 'lettering', kind: 'image', label: `Whole title page, p. ${leaf.n}`, leaf, crop: all?.crop || BOARD_CROP, rot: 0, thumb: leaf.thumb, threshold: all?.threshold });
  }
  return out;
}

export interface PlaceEnv {
  /** Is the current ground dark (so stamping should be gilt) or light (ink)? */
  dark: boolean;
  /** Natural size of the asset's page, when it is an image. */
  dims?: [number, number];
  at?: { x: number; y: number };
}

/** A new layer for an asset. Grounds come back flagged so the caller can swap them in. */
export function assetToLayer(a: Asset, env: PlaceEnv): { layer: Layer; ground: boolean } {
  const stamp = env.dark ? 'gilt' : 'ink';
  const ink = env.dark ? '#c9a86c' : '#241c14';
  let layer: Layer;
  let ground = false;
  if (a.kind === 'image') {
    const [iw, ih] = env.dims || [1000, 1500];
    if (a.group === 'grounds') {
      layer = imageLayer(a.leaf, iw, ih, { ground: true, crop: a.crop, srcRot: a.rot, name: a.label });
      ground = true;
    } else if (a.group === 'lettering') {
      layer = imageLayer(a.leaf, iw, ih, { crop: a.crop, treatment: stamp, color: ink, threshold: Math.min(0.8, (a.threshold ?? 0.5) + 0.05), softness: 0.12, width: W * 0.7, name: a.label });
    } else if (a.group === 'ornaments') {
      layer = imageLayer(a.leaf, iw, ih, { crop: a.crop, srcRot: a.rot, treatment: stamp, color: ink, threshold: 0.55, width: W * 0.4, name: a.label.split(',')[0].slice(0, 30) });
    } else {
      layer = imageLayer(a.leaf, iw, ih, { crop: a.crop, srcRot: a.rot, width: W * 0.6, name: `Picture, p. ${a.leaf.n}` });
    }
    if (!ground && layer.h > H * 0.7) { layer.w *= (H * 0.7) / layer.h; layer.h = H * 0.7; }
  } else if (a.kind === 'text') {
    const sizes = { title: a.text.length > 50 ? 44 : a.text.length > 26 ? 56 : 68, author: 34, small: 24 };
    layer = textLayer(a.text, {
      name: a.label, size: sizes[a.style], finish: env.dark ? 'gilt' : 'ink', color: ink,
      caps: a.style !== 'small', tracking: a.style === 'title' ? 0.08 : a.style === 'author' ? 0.14 : 0.04,
    });
  } else if (a.kind === 'shape') {
    layer = shapeLayer(a.shape, a.shape === 'label' ? {} : { finish: env.dark ? 'gilt' : 'ink', color: ink });
  } else {
    const spine = a.id === 'f-spine';
    layer = fillLayer(a.color, { texture: a.texture, name: a.label, region: spine ? 'spine' : 'all' });
    ground = !spine;
  }
  if (env.at && !ground && layer.kind !== 'fill') { layer.x = env.at.x; layer.y = env.at.y; }
  return { layer: { ...layer, id: uid() }, ground };
}

/** Swap the picture in an image layer for another, keeping its place, width and treatment. */
export function replaceImage(L: ImageLayer, a: Extract<Asset, { kind: 'image' }>, dims: [number, number]): ImageLayer {
  const isGround = L.w >= W - 1 && L.h >= H - 1;
  const next = imageLayer(a.leaf, dims[0], dims[1], { crop: a.crop, srcRot: a.rot, width: L.w, ground: isGround });
  return {
    ...L,
    src: next.src, full: next.full, page: next.page, role: next.role, crop: next.crop, srcRot: next.srcRot,
    erase: [], // marks belong to the old page
    h: isGround ? L.h : next.h,
    name: isGround ? a.label : L.name.replace(/p\. \d+/, `p. ${a.leaf.n}`),
    ...(a.threshold != null ? { threshold: Math.min(0.8, a.threshold + 0.05) } : {}),
  };
}
