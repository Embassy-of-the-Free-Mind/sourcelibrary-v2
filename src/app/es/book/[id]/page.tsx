import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { isHiddenBook } from '@/lib/book-access';
import { getBookThumbnailUrl } from '@/lib/utils';
import { authorUrl } from '@/lib/slugify';
import { displayPublished } from '@/lib/publication-date';
import { isPublishedFirstTranslation } from '@/lib/book';
import { getEffectiveByline } from '@/lib/byline';
import { localizedTitle, originalTitleIfDifferent, type LocalizedBookMap } from '@/lib/localized';
import { BOOK_STRINGS, languageName } from '@/lib/book-i18n';
import { spanishPageHref, startPageNumber } from '@/lib/es-collections';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import ReadingLanguagePreference from '@/components/ReadingLanguagePreference';
import AuthorName from '@/components/AuthorName';
import type { Chapter } from '@/lib/types';

/**
 * Spanish book page — the thin twin of /book/[id] (#4082 phase 1).
 *
 * What a Spanish reader needs from a book page: what this is (title gloss +
 * original), who wrote it, when and in what language, what it is about, its
 * contents, and ONE button that opens it in Spanish — without ever leaving /es.
 * The 2,400-line English page (editions, bibliography, illustrations, first-
 * translation evidence…) is linked, labelled as English. Phase 2 extracts that
 * page's strings so the two can converge; this page is deliberately small so
 * it can ship first.
 */
export const revalidate = 3600;
export const dynamicParams = true;
export const maxDuration = 60;

const t = BOOK_STRINGS.es;

const PROJECTION = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, localized: 1, author: 1, editor: 1, language: 1, published: 1,
  pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translated_es: 1, is_first_translation: 1, ft_disposition: 1,
  thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1, visible: 1, chapters: 1,
  'index.bookSummary.brief': 1, 'summary.data': 1, resource_type: 1,
};

type EsBook = {
  id: string; slug?: string; title: string; display_title?: string; localized?: LocalizedBookMap; author?: string; editor?: string | null;
  language?: string; published?: string; pages_count?: number; pages_translated?: number; pages_translated_es?: number;
  is_first_translation?: boolean; ft_disposition?: string; thumbnail?: string; thumbnail_blob?: string; image_display?: string; image_thumb?: string;
  visible?: boolean; chapters?: Chapter[]; index?: { bookSummary?: { brief?: string } }; summary?: { data?: string } | string; resource_type?: string;
};

async function load(id: string) {
  const db = await getReadDb();
  const result = await findBookByIdOrSlug(db, id, PROJECTION);
  const book = (result?.book ?? null) as unknown as EsBook | null;
  if (!book) return null;
  // First readable page: first chapter, else skip the binding leaves (same rule as the English page).
  const start = startPageNumber(book);
  const page = await db.collection('pages').findOne(
    { book_id: book.id, page_number: { $gte: start } },
    { projection: { _id: 0, id: 1, page_number: 1 }, sort: { page_number: 1 } },
  ) || await db.collection('pages').findOne({ book_id: book.id }, { projection: { _id: 0, id: 1, page_number: 1 }, sort: { page_number: 1 } });
  return { book, firstPageId: (page?.id as string | undefined) ?? null };
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id);
  if (!data || isHiddenBook(data.book)) return { title: 'Libro no encontrado | Source Library', robots: { index: false, follow: true } };
  const { book } = data;
  const title = localizedTitle(book, 'es');
  const path = `/book/${book.slug || book.id}`;
  const description = book.localized?.es?.summary?.slice(0, 200) || `${title} — ${book.author || ''}. Edición en español en Source Library.`;
  return {
    title: `${title} | Source Library`,
    description,
    alternates: { canonical: `/es${path}`, languages: { en: path, es: `/es${path}`, 'x-default': path } },
    openGraph: { title, description, locale: 'es_ES', url: `https://sourcelibrary.org/es${path}` },
  };
}

export default async function EsBookPage({ params }: Props) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { book, firstPageId } = data;
  if (isHiddenBook(book)) notFound();
  if (book.resource_type) permanentRedirect(`/artwork/${book.slug || book.id}`);
  // Keep the address bar on the slug, like the English page does.
  if (book.slug && id !== book.slug) permanentRedirect(`/es/book/${book.slug}`);

  const title = localizedTitle(book, 'es');
  const original = originalTitleIfDifferent(book, 'es');
  const cover = getBookThumbnailUrl(book, 'display');
  const byline = getEffectiveByline({ ...book, author: book.author || '' });
  const authorHref = book.author ? authorUrl(book.author) : null;
  const esPages = book.pages_translated_es ?? 0;
  const enPages = book.pages_translated ?? 0;
  const hasSpanish = esPages > 0;
  const readHref = firstPageId ? spanishPageHref(book, firstPageId) : null;
  const summaryEs = book.localized?.es?.summary;
  const summaryEn = book.index?.bookSummary?.brief || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
  const chapters = (book.chapters || []).filter((c) => c.level <= 2);
  const chapterTitlesEs = book.localized?.es?.chapters;
  const when = displayPublished(book.published);

  return (
    <div className="min-h-screen bg-cream" lang="es">
      <ReadingLanguagePreference lang="es" />
      <ConditionalSiteHeader variant="light" />

      <div className="max-w-[1100px] mx-auto px-6 pt-8 pb-20">
        <Link href="/es/collections/en-espanol" className="inline-flex items-center gap-2 text-sm text-muted hover:text-accent-rust transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> {t.backToCollection}
        </Link>

        <div className="grid md:grid-cols-[260px_minmax(0,1fr)] gap-8 md:gap-12 items-start">
          {/* Cover */}
          <div className="w-[200px] md:w-full mx-auto">
            <div className="relative aspect-[3/4] border border-border-light bg-warm overflow-hidden">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt={title} className="absolute inset-0 w-full h-full object-cover" />
              ) : null}
              {(isPublishedFirstTranslation(book) || hasSpanish) && (
                <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
                  {hasSpanish && <span className="text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(20,16,12,0.5)' }}>{t.spanishEdition}</span>}
                  {isPublishedFirstTranslation(book) && <span className="text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(20,16,12,0.5)' }}>{t.firstTranslation}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Identity + CTA */}
          <div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-display text-primary leading-tight mb-2">{title}</h1>
            {original && <p className="text-lg text-secondary italic mb-3" lang="">{original}</p>}
            <p className="text-base text-secondary mb-5">
              {byline.role === 'editor'
                ? <>{t.editedBy} <AuthorName author={byline.editor} /></>
                : (authorHref ? <Link href={authorHref} className="hover:text-accent-rust">{book.author}</Link> : book.author)}
            </p>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm mb-7">
              {book.language && (<div><dt className="text-muted text-xs uppercase tracking-wider">{t.originalLanguage}</dt><dd className="text-primary capitalize">{languageName(book.language, 'es')}</dd></div>)}
              {when && (<div><dt className="text-muted text-xs uppercase tracking-wider">{t.published}</dt><dd className="text-primary">{when}</dd></div>)}
              {(book.pages_count ?? 0) > 0 && (<div><dt className="text-muted text-xs uppercase tracking-wider">{t.pages}</dt><dd className="text-primary">{book.pages_count!.toLocaleString('es-ES')}</dd></div>)}
              {hasSpanish && (<div><dt className="text-muted text-xs uppercase tracking-wider">{t.spanishEdition}</dt><dd className="text-primary">{t.spanishEditionOf(esPages, Math.max(enPages, esPages))}</dd></div>)}
            </dl>

            {readHref && (
              <Link
                href={readHref}
                className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-white transition-all hover:brightness-110"
                style={{ background: 'var(--accent-rust)' }}
              >
                <BookOpen className="w-5 h-5" /> {hasSpanish ? t.readInSpanish : t.read}
              </Link>
            )}

            {(summaryEs || summaryEn) && (
              <section className="mt-10">
                <h2 className="text-xl font-display text-primary mb-3">{t.summary}</h2>
                <p className="text-base leading-relaxed text-primary/90 whitespace-pre-line" lang={summaryEs ? 'es' : 'en'}>{summaryEs || summaryEn}</p>
                {!summaryEs && <p className="mt-2 text-sm text-muted">{t.summaryIsEnglish}</p>}
              </section>
            )}

            {chapters.length > 0 && (
              <section className="mt-10">
                <h2 className="text-xl font-display text-primary mb-3">{t.contents}</h2>
                <ol className="divide-y divide-border-light border-y border-border-light">
                  {chapters.map((c, i) => (
                    <li key={`${c.pageId}-${i}`}>
                      <Link href={spanishPageHref(book, c.pageId)} className={`flex items-baseline justify-between gap-4 py-2.5 hover:text-accent-rust ${c.level > 1 ? 'pl-5 text-sm' : ''}`}>
                        <span>{chapterTitlesEs?.[book.chapters!.indexOf(c)] || c.titleEn || c.title}</span>
                        <span className="text-xs text-muted tabular-nums">{c.pageNumber}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <p className="mt-10 text-sm text-muted">
              <Link href={`/book/${book.slug || book.id}`} className="underline hover:text-accent-rust">{t.fullPage}</Link>: {t.fullPageNote}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
