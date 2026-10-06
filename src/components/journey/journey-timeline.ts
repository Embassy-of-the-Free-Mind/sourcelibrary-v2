/**
 * The journey film's timeline (#5861), ported from the approved prototype
 * (branch feat/journey-film-prototype, docs/prototypes/journey-film/index.html).
 *
 * Everything on screen is a pure function of film time T. The film is a list
 * of segments: a part card, a stretch of 3D scene time [s, e], a "screen"
 * (a rendered reader pane with a slow move and a highlight), or the end card.
 * Segments are built from the data, so a step that did not happen to this
 * page (no copy in our storage, no stored Trace, no description) is simply
 * not in the film.
 */
import type { JourneyData, JourneyPart, JourneyStep } from '@/lib/journey/types';

export type ScreenKey = 'ocr' | 'english' | 'trace' | 'draft' | 'overview' | 'cite';

export interface Seg {
  /** Index into the film's steps (chapters). */
  ch: number;
  d: number;
  f0: number;
  card?: 'pro' | JourneyPart['key'];
  /** 3D scene time range. */
  s?: number;
  e?: number;
  screen?: ScreenKey;
  end?: boolean;
}

/** Scene time where the film rests behind the end card. */
export const SCENE_END = 53.5;

export interface Timeline {
  segs: Seg[];
  total: number;
  chStart: number[];
}

export function buildTimeline(d: JourneyData, steps: JourneyStep[]): Timeline {
  const ch = (k: JourneyStep['key']) => steps.findIndex(s => s.key === k);
  const has = (k: JourneyStep['key']) => ch(k) >= 0;
  const raw: Omit<Seg, 'f0'>[] = [];
  const push = (g: Omit<Seg, 'f0' | 'd'> & { d?: number }) => raw.push({ ...g, d: g.d ?? (g.e! - g.s!) });

  push({ card: 'pro', d: 8, ch: 0 });
  push({ card: 'p1', d: 4, ch: 0 });
  push({ s: 0, e: 9, ch: ch('find') });
  if (has('copy')) push({ s: 9, e: 18, ch: ch('copy') });

  push({ card: 'p2', d: 4, ch: ch('read') });
  push({ s: 27, e: 36.4, ch: ch('read') });
  push({ screen: 'ocr', d: 6.5, ch: ch('read') });
  push({ s: 36.4, e: 44, ch: ch('translate') });
  push({ screen: 'english', d: 6.5, ch: ch('translate') });

  push({ card: 'p3', d: 4.5, ch: ch('check') });
  if (d.trace) push({ screen: 'trace', d: 8, ch: ch('check') });
  if (d.machineDraft) push({ screen: 'draft', d: 7, ch: ch('check') });

  const pubCh = ch('publish');
  push({ card: 'p4', d: 4, ch: has('describe') ? ch('describe') : pubCh });
  if (has('describe')) push({ s: 45, e: 53, ch: ch('describe') });
  push({ screen: 'overview', d: 6.5, ch: pubCh });
  push({ screen: 'cite', d: 7, ch: pubCh });
  push({ end: true, d: 7, ch: pubCh });

  let f0 = 0;
  const segs: Seg[] = raw.map(g => {
    const out = { ...g, f0 } as Seg;
    f0 += g.d;
    return out;
  });
  const total = f0;
  const chStart = steps.map((_, c) => {
    const g = segs.find(x => x.ch === c);
    return g ? g.f0 : 0;
  });
  return { segs, total, chStart };
}

export interface SegAt {
  g: Seg;
  i: number;
  local: number;
  /** Scene time to render. */
  t: number;
}

export function segAt(tl: Timeline, T: number): SegAt {
  const { segs } = tl;
  let i = 0;
  while (i < segs.length - 1 && T >= segs[i + 1].f0) i++;
  const g = segs[i];
  const local = T - g.f0;
  if (g.s !== undefined) return { g, i, local, t: Math.min(g.e!, g.s + local) };
  if (g.end) return { g, i, local, t: SCENE_END };
  const nx = segs.slice(i).find(x => x.s !== undefined);
  const pv = segs.slice(0, i).reverse().find(x => x.s !== undefined);
  if (g.screen && pv) return { g, i, local, t: pv.e! };
  return { g, i, local, t: nx ? nx.s! : SCENE_END };
}

export function chapterAt(tl: Timeline, T: number): number {
  let i = 0;
  while (i < tl.chStart.length - 1 && T >= tl.chStart[i + 1]) i++;
  return i;
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** Smoothstep from a to b. */
export const S = (a: number, b: number, x: number) => {
  const y = clamp((x - a) / (b - a));
  return y * y * (3 - 2 * y);
};
export const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
/** Fade in over k, out over k, across a segment of length d. */
export const fade = (local: number, d: number, k = 0.6) => S(0, k, local) * (1 - S(d - k, d, local));
