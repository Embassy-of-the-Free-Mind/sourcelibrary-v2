import LibrarianPage from '@/app/librarian/page';

/**
 * Spanish Librarian — "Pregunta a la fuente". The SAME page as `/librarian`,
 * rendered with `lang='es'` (#4116): Spanish chrome from
 * `src/lib/librarian-i18n.ts`, `/es`-prefixed links, and `lang: 'es'` on every
 * chat request so the tools quote `pages.translations.es` where we hold it and
 * label the English where we don't (`.claude/docs/i18n.md` rule 4).
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/librarian/page.tsx.
export const revalidate = 86400;

export default async function EsLibrarianPage() {
  return LibrarianPage({ lang: 'es' });
}
