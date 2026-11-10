import { Metadata } from 'next';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { gateLeafText, meteredReaderEnabled } from '@/lib/free-preview';
import { displayPublished } from '@/lib/publication-date';
// `cache()`d in its own module: generateMetadata, the shell below, and the
// (reader) group layout's visibility gate all read it, so one round trip
// serves the whole request.
import { getPageData, getTrimmedPageId } from './page-data';
import { type Locale, localePath } from '@/lib/locale-path';
import { READER_STRINGS } from '@/lib/book-i18n';
import { localizedTitle, hasLocalizedEdition } from '@/lib/localized';
import { bylineClaimsAuthorship } from '@/lib/corporate-bylines';
import { citationYear } from '@/lib/publication-date';
import { getShortUrl } from '@/lib/shortlinks';
import type { PrintedPage } from '@/lib/types';

export const preferredRegion = 'fra1';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

export async function generateMetadata({ params, lang = 'en' }: LayoutProps & { lang?: Locale }): Promise<Metadata> {
  const { id, pageId } = await params;
  const rs = READER_STRINGS[lang];
  const ctx = await getTenantContext();
  const { book, page } = await getPageData(id, pageId, ctx?.id ?? undefined, ctx?.slug ?? undefined);

  if (!book || !page) {
    // Self-referential canonical so this URL isn't seen as a duplicate of '/'
    // (inherited root canonical).
    return {
      title: 'Page Not Found - Source Library',
      robots: { index: false, follow: true },
      alternates: { canonical: `/book/${id}/page/${pageId}` },
    };
  }

  const bookTitle = localizedTitle(book as Parameters<typeof localizedTitle>[0], lang);
  const pageNum = page.page_number;
  const publishedDate = displayPublished(book.published);
  const ogBookTitle = publishedDate ? `${bookTitle} (${publishedDate})` : bookTitle;
  const title = rs.metaTitle(ogBookTitle, pageNum);

  // Use translation excerpt if available, otherwise OCR excerpt. Strip editorial
  // wrapper blocks first so <meta>/<summary>/… prose never lands in the OG
  // description / search snippet (#2232 invariant).
  // Then drop the remaining inline tags (<note>, <term>, <sig>, …) but keep
  // their words: they are body text, and a snippet is plain text — Google was
  // showing the literal "<note>original: …" markup.
  // Metered reader (#4357): a page past the free sample carries no excerpt of
  // its text — 200 characters a page, over every page, is a scrape of the
  // book's opening lines. Those pages are noindex, so no search snippet is
  // lost. Reading rooms are exempt, as on the page itself.
  const excerptPage = gateLeafText(page, (book as { pages_count?: number }).pages_count,
    meteredReaderEnabled() && !(ctx?.id || ctx?.isEmbedded));
  const textContent = stripEditorialWrappers(excerptPage.translation?.data || excerptPage.ocr?.data || '')
    .replace(/<\/?[a-z][a-z-]*(?:\s[^>]*)?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const excerpt = textContent.length > 200
    ? textContent.substring(0, 197) + '...'
    : textContent;

  // The excerpt is the page's own text in the reader's language; the sentence
  // around it follows the locale. An untranslated book keeps its English frame.
  const description = excerpt
    ? `${rs.metaPageOf(pageNum, bookTitle)}, ${book.author}. ${excerpt}`
    : `Page ${pageNum} of "${bookTitle}" by ${book.author}${publishedDate ? ` (${publishedDate})` : ''}. Digitized from the original ${book.language || 'manuscript'}.`;

  // Always use slug for canonical URL, even if accessed via hex ObjectId
  const bookPath = (book as unknown as { slug?: string }).slug || id;
  const pageUrl = `/book/${bookPath}/page/${pageId}`;

  // A reader page names its book's front page as canonical (#3755): Google
  // crawls ~150-250 HTML pages a day here, and ~380K reader URLs were splitting
  // that between thin pages instead of the books. Crawling stays open, so links
  // and text on the page still count toward the book. No noindex: combined with
  // a canonical elsewhere it sends mixed signals. `seo_indexable` no longer
  // affects metadata.
  const bookUrl = `/book/${bookPath}`;

  // Reference managers read these to save a page with its book, author and page
  // (#8161). Same rules as the book page's scholarMeta: a holder or issuer is no
  // author, and only a bare year is a date. `citation_firstpage` is the number
  // printed on the leaf; a scan index is not a page anyone can find, so a page
  // without one says nothing. A partner's reading room keeps its own links.
  const printedLabel = (page as unknown as { printed_page?: PrintedPage }).printed_page?.label?.trim();
  const citeYear = citationYear(book.published);
  const scholarMeta: Record<string, string> = ctx?.id ? {} : {
    citation_title: book.title,
    ...(book.author && bylineClaimsAuthorship(book.author) ? { citation_author: book.author } : {}),
    ...(citeYear ? { citation_publication_date: citeYear } : {}),
    ...(book.language ? { citation_language: book.language } : {}),
    ...(printedLabel ? { citation_firstpage: printedLabel } : {}),
    citation_fulltext_html_url: `https://sourcelibrary.org${pageUrl}`,
    citation_public_url: getShortUrl((book as unknown as { id: string }).id, pageNum, pageId),
  };

  return {
    title: `${title} - Source Library`,
    description,
    robots: { index: true, follow: true },
    other: scholarMeta,
    alternates: {
      canonical: bookUrl,
    },
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: pageUrl,
      // OG image generated by opengraph-image.tsx (branded 1200x630 card)
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      // Twitter image generated by opengraph-image.tsx
    },
  };
}

export default async function PageLayout({ children, params, lang = 'en' }: LayoutProps & { lang?: Locale }) {
  // Resolve existence HERE, in the shell, rather than leaving it to page.tsx.
  //
  // This segment has a loading.tsx and deliberately keeps it — the reader is
  // the one route where the skeleton earns its place, on every page turn. But
  // a loading.tsx wraps its page.tsx in an automatic <Suspense>, so Next.js
  // flushes the 200 shell the moment the page's data fetch suspends, before
  // page.tsx's notFound() runs. The status is committed by then and notFound()
  // can only swap the body — the soft-404 documented in CLAUDE.md and fixed on
  // sibling routes in #3277 and #3376.
  //
  // A layout sits ABOVE that boundary, so awaiting here still sets a real 404
  // and the skeleton is untouched.
  //
  // The condition is deliberately a strict SUBSET of page.tsx's four notFound()
  // cases: missing page, missing book, and (inside getPageData) a page whose
  // book_id doesn't match the book in the URL. The hidden-book gate CANNOT live
  // here — this layout also wraps page/[pageId]/preview, the auth-gated editor
  // route that renders hidden books on purpose (allowHidden), and a layout gets
  // no signal about which child segment is rendering. It lives one level down in
  // (reader)/layout.tsx, a URL-neutral route group that /preview sits outside
  // of (#3385).
  const { id, pageId } = await params;
  const ctx = await getTenantContext();
  const { book, page } = await getPageData(id, pageId, ctx?.id ?? undefined, ctx?.slug ?? undefined);
  // A real page id with junk on its end (a mangled copied link) goes to that
  // page instead of a 404 — same book only (getTrimmedPageId).
  if (book && !page) {
    const bookKey = (book as unknown as { id?: string }).id;
    const trimmed = bookKey ? await getTrimmedPageId(bookKey, pageId) : null;
    if (trimmed) {
      permanentRedirect(localePath(`/book/${(book as unknown as { slug?: string }).slug || id}/page/${trimmed}`, lang));
    }
  }
  if (!book || !page) notFound();

  // A localized URL is a promise the page is in that language, so a book with
  // no edition in it has no localized reader URL — 307 to the English one.
  //
  // This MUST live in the layout, not in page.tsx. The (reader) segment has a
  // loading.tsx, so the page is wrapped in an automatic <Suspense> and the 200
  // shell flushes before the page's code runs: a redirect() down there degrades
  // into a client-side meta-refresh (#4036), which a crawler will happily index.
  // Measured — the page-level version returned 200 with NEXT_REDIRECT in the
  // body. The layout sits above that boundary, so this is a real HTTP 307.
  //
  // 307, not 308: the day the book is translated the URL must start working.
  // `?? false` because PAGE_META_PROJECTION asks for BOTH inputs — the
  // `pages_translated_es` counter and `language` — so an absent value means the
  // book has no edition in the language rather than "could not tell". If that
  // projection ever drops `language`, every natively-Spanish book starts
  // redirecting away from its own /es reader.
  if (lang !== 'en' && (hasLocalizedEdition(book as unknown as Record<string, unknown>, lang) ?? false) === false) {
    // `?lang=` keeps the header in the reader's language on the English page (#6938).
    redirect(`/book/${(book as unknown as { slug?: string }).slug || id}/page/${pageId}?lang=${lang}`);
  }

  return children;
}
