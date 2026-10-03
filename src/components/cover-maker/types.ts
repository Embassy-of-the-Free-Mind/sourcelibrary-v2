/**
 * The cover maker's document model. A cover is a stack of layers on a fixed
 * 1000 × 1500 board (2:3); every position is in board units with (x, y) the
 * layer's centre, so a cover renders identically at preview and export sizes.
 */

export const W = 1000;
export const H = 1500;

/** How a layer's shape meets the board. Stamped finishes are rendered as an
 *  impression pressed into the board, the way a finisher's tools work. */
export type Finish = 'ink' | 'gilt' | 'silver' | 'foil' | 'blind';

/** What happens to the pixels of an image layer. `photo` keeps the scan;
 *  every other treatment turns its dark marks into a mask (paper drops out)
 *  and gives that mask a finish. */
export type Treatment = 'photo' | Finish;

export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';

export type FontKey = 'cardo' | 'aldine' | 'fell' | 'garamond' | 'fraktur' | 'cinzel' | 'sans';

export interface Crop { x: number; y: number; w: number; h: number }

interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  opacity: number;
  blend: Blend;
  hidden?: boolean;
  locked?: boolean;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  /** Page number this came from, for the provenance line. */
  page: number | null;
  /** What the page is (outside, endpaper, title, plate…), for the provenance line. */
  role: string;
  src: string;
  full: string;
  crop: Crop;
  /** Clockwise rotation applied to the cropped content (detected images on a sideways plate). */
  srcRot: 0 | 90 | 180 | 270;
  treatment: Treatment;
  color: string;
  /** Ink threshold, 0–1 of luminance. */
  threshold: number;
  softness: number;
  invert: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  depth: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  font: FontKey;
  size: number;
  weight: 400 | 700;
  italic: boolean;
  caps: boolean;
  /** Letter spacing in em. */
  tracking: number;
  leading: number;
  align: 'left' | 'center' | 'right';
  finish: Finish;
  color: string;
  depth: number;
}

export type ShapeKind = 'frame' | 'double-frame' | 'rule' | 'oval' | 'panel' | 'label';

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  shape: ShapeKind;
  stroke: number;
  finish: Finish;
  color: string;
  depth: number;
}

export type Texture = 'none' | 'cloth' | 'leather' | 'paper';

/** A flat colour over the whole board, with an optional generated surface. */
export interface FillLayer extends LayerBase {
  kind: 'fill';
  color: string;
  texture: Texture;
  /** Fill only part of the board, e.g. a leather spine on a half binding. */
  region: 'all' | 'spine' | 'corners';
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | FillLayer;

export interface Cover {
  id: string;
  name: string;
  layers: Layer[];
}

export interface Leaf {
  n: number;
  role: 'outside' | 'endpaper' | 'title' | 'frontispiece' | 'plate' | 'leaf';
  type: string | null;
  note: string;
  thumb: string;
  display: string;
  full: string;
  w: number | null;
  h: number | null;
}

export interface CutImage {
  page: number;
  type: string;
  description: string;
  bbox: { x: number; y: number; width: number; height: number };
  rotation: 0 | 90 | 180 | 270;
  cut: string | null;
  thumb: string | null;
  quality: number | null;
}

export interface Materials {
  book: {
    id: string;
    title: string;
    display_title: string | null;
    author: string;
    published: string;
    publisher: string;
    place: string;
    language: string;
  };
  leaves: Leaf[];
  images: CutImage[];
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
