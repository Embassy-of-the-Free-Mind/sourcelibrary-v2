import type { Metadata } from 'next';
import BookDetailPage, { generateMetadata as baseMetadata } from '@/app/book/[id]/page';

/**
 * Spanish book page — the SAME page as `/book/[id]`, rendered with `lang='es'`
 * (#4082 phase 2).
 *
 * Phase 1 shipped a thin, hand-written Spanish page. It was the wrong shape:
 * two pages describing one book drift apart with every change to the English
 * one, and a Spanish reader got a lesser record. So this is now a re-export.
 * Everything the reader sees — the hero, the About text, contents, the pages
 * grid, illustrations, related books — comes from one component; `lang`
 * decides the chrome dictionary (`src/lib/book-i18n.ts`), which title/summary/
 * chapter text is shown (`books.localized.es`), and the `/es` prefix that every
 * internal link keeps. What has no Spanish text stays English and is labelled;
 * nothing is machine-translated at render time (`.claude/docs/i18n.md` rule 4).
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/book/[id]/page.tsx.
export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  return baseMetadata({ ...props, lang: 'es' });
}

export default async function EsBookPage(props: Props) {
  return BookDetailPage({ ...props, lang: 'es' });
}
