/**
 * The cover a collection shows on its cards (search results, the collections
 * index, /collections/all) and how it is framed in them.
 *
 * Stored on the collection document as:
 *   hero_image:   the image URL (already read by every card surface)
 *   card_framing: { x, y, scale }  object-position in % and a zoom factor
 *
 * A plate is rarely the shape of a card, so `object-cover` alone crops it
 * wherever the browser likes. The framing lets an editor say which part of
 * the plate the card should show. It is presentation only: no book data, and
 * absent framing means the old centred crop.
 *
 * Client-safe: no server imports. The editor and the cards both use it.
 */
export interface CardFraming { x: number; y: number; scale: number }

export const DEFAULT_CARD_FRAMING: CardFraming = { x: 50, y: 50, scale: 1 };

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Normalise whatever is stored (or posted) into a valid framing. */
export function readCardFraming(raw: unknown): CardFraming | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    x: clamp(r.x, 0, 100, 50),
    y: clamp(r.y, 0, 100, 50),
    scale: clamp(r.scale, 1, 4, 1),
  };
}

/**
 * Inline style for the card's <img>. The zoom is a transform about the same
 * point object-position anchors, so dragging in the editor and the rendered
 * card agree about which part of the plate is in view.
 */
export function cardFramingStyle(f: CardFraming | undefined): React.CSSProperties | undefined {
  if (!f) return undefined;
  const style: React.CSSProperties = { objectPosition: `${f.x}% ${f.y}%` };
  if (f.scale !== 1) {
    style.transform = `scale(${f.scale})`;
    style.transformOrigin = `${f.x}% ${f.y}%`;
  }
  return style;
}

/** Live update from the cover editor, so a saved cover shows without a reload. */
export const COVER_EVENT = 'collection-cover:updated';
export interface CoverEventDetail { slug: string; url: string; framing: CardFraming }
