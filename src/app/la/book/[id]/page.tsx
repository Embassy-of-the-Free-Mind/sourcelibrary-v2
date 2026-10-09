import type { Metadata } from 'next';
import BookDetailPage, { generateMetadata as baseMetadata } from '@/app/book/[id]/page';

/**
 * Latin book page (#6254) — the SAME page as `/book/[id]`, rendered with
 * `lang='la'`, exactly as the Spanish twin is (#4082 phase 2).
 *
 * It exists only for a book WRITTEN in Latin: the base page 307s every other
 * book to its English URL (`hasLocalizedEdition`, `NATIVE_EDITION_LANGUAGE.la`).
 * Nothing is translated into Latin, so there is no Latin gloss or summary to
 * show; the title is the original, and what has no Latin text stays English
 * and is labelled (`.claude/docs/i18n.md` rule 4).
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/book/[id]/page.tsx.
export const revalidate = 86400;
export const preferredRegion = 'fra1';
export const dynamicParams = true;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  return baseMetadata({ ...props, lang: 'la' });
}

export default async function LaBookPage(props: Props) {
  return BookDetailPage({ ...props, lang: 'la' });
}
