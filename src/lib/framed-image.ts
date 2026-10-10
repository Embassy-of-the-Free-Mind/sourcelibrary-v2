/**
 * Which stored frame, if any, belongs to the image a card or thumbnail is about
 * to draw (#6010). The crop itself is done by `<FramedImg>`; this only answers
 * "is this frame about THIS picture?".
 *
 * A frame is fractions of one image. It carries to another URL only when that
 * URL is the same image at another size: same R2 page identity here, same shape
 * once the pixels arrive (`frameForImage`, checked by FramedImg on load). When
 * either says no, the image is shown whole, exactly as before.
 *
 * PRIOR ART: src/lib/page-frame.ts — the detector and the frame type, kept
 * dependency-free for the sweep scripts; src/lib/utils.ts getBookCardUrl — the
 * same "validate the stored thing against the cover being drawn" guard, for
 * image_card.
 */
import { usablePageFrame, type PageFrame } from '@/lib/page-frame';
import { r2PageIdentity } from '@/lib/r2-page-identity';

/**
 * `books.thumbnail_frame` for the cover URL being drawn. The stored frame names
 * the image it was measured on (`of`); a cover changed since, or a surface that
 * draws a different cover field, gets null.
 */
export function coverFrame(book: { thumbnail_frame?: unknown } | null | undefined, url: string | null | undefined): PageFrame | null {
  const stored = book?.thumbnail_frame;
  const f = usablePageFrame(stored);
  if (!f || !url) return null;
  const of = (stored as { of?: unknown }).of;
  return typeof of === 'string' && of.length > 0 && r2PageIdentity(url) === of ? f : null;
}

/**
 * `pages.page_frame` for a thumbnail (or any other size) of that page. The
 * sweep measures display_photo, else archived_photo; a split half or cropped
 * copy is a different picture and is refused here when the URLs can tell, and
 * by shape on load when they cannot (a proxied URL has no identity).
 */
export function pageImageFrame(
  page: { page_frame?: unknown; display_photo?: string | null; archived_photo?: string | null; cropped_photo?: string | null; split_from_spread?: unknown; crop?: unknown } | null | undefined,
  url: string | null | undefined,
): PageFrame | null {
  const f = usablePageFrame(page?.page_frame);
  if (!f || !page || !url) return null;
  if (page.split_from_spread || page.cropped_photo || page.crop) return null;
  const measured = [page.display_photo, page.archived_photo].find(u => typeof u === 'string' && u.includes('images.sourcelibrary.org/'));
  const a = r2PageIdentity(url), b = measured ? r2PageIdentity(measured) : null;
  return a !== null && b !== null && a !== b ? null : f;
}

/** Shape (w/h) of the page a frame shows. */
export function framedAspect(f: PageFrame): number {
  return (f.ar * f.w) / f.h;
}

/**
 * Where the whole image goes inside a box that has the framed page's shape, in
 * percentages of that box — so the crop needs no measured pixels.
 */
export function framedImageStyle(f: PageFrame): { left: string; top: string; width: string; height: string } {
  const pct = (n: number) => `${Math.round(n * 1e6) / 1e4}%`;
  return { left: pct(-f.x / f.w), top: pct(-f.y / f.h), width: pct(1 / f.w), height: pct(1 / f.h) };
}

/**
 * How much bigger the source must be so the framed page keeps the pixels it
 * had uncropped (#6010, Derek's source-size requirement). The scan is drawn
 * 1/frame.w times the width of the page box, so a width-based request (a
 * `sizes` length, a thumb's `w`) is scaled by that. This is at least the
 * 1/max(frame.w, frame.h) the issue asks for.
 */
export function frameSourceScale(f: PageFrame | null): number {
  return f && f.w > 0 && f.w < 1 ? 1 / f.w : 1;
}

/**
 * A `sizes` attribute with each slot length scaled by `k`, so next/image's
 * srcset picks a source big enough for the cropped page. Media conditions are
 * left alone; only the trailing `vw`/`px` length of each entry is scaled.
 */
export function scaleSizes(sizes: string, k: number): string {
  if (!(k > 1)) return sizes;
  return sizes.split(',').map(part => part.replace(/(\d+(?:\.\d+)?)(vw|px)\s*$/, (_, n: string, unit: string) =>
    `${Math.ceil(parseFloat(n) * k * 100) / 100}${unit}`)).join(',');
}

/**
 * Width in source pixels a thumbnail needs so its framed page is as sharp as
 * the uncropped thumb was: the scan is drawn at boxWidth / frame.w, where the
 * page box covers the slot (`fit="cover"`).
 */
export function framedThumbSourceWidth(f: PageFrame, slotW: number, slotH: number, dpr: number): number {
  const boxW = Math.max(slotW, slotH * framedAspect(f));
  return Math.ceil((boxW / f.w) * dpr);
}
