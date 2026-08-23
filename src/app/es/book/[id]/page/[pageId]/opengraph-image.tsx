import BaseImage from '@/app/book/[id]/page/[pageId]/opengraph-image';

/**
 * Spanish twin of the reader-page share card. `opengraph-image.tsx` is a
 * per-ROUTE-SEGMENT file convention (.claude/docs/i18n.md, "the share card
 * is part of the page") — without a file here, `/es/book/[id]/page/[pageId]`
 * would silently fall back to the site-wide English card.
 *
 * `alt`/`size`/`contentType` are declared LOCALLY rather than re-exported
 * from the base file, because Next's image-route convention is detected by
 * static analysis of THIS file at build time — a re-export isn't guaranteed
 * to satisfy that the same way a normal const declaration does. Values match
 * the base file (`size`/`contentType` are format-only and identical either
 * way; `alt` is translated).
 *
 * This wraps the SAME image generator, not a translation of it: the "Page N"
 * badge baked into the image stays English (the generator has no `lang`
 * parameter and does not thread one through its book/page lookups). Flagged
 * for a follow-up pass — see the session report.
 */
export const alt = 'Página de Source Library';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  return BaseImage({ params });
}
