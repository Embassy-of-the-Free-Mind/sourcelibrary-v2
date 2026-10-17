import { ReactNode } from 'react';
import Link from 'next/link';

/**
 * A quotation from a book in the library, with the page it comes from beside
 * it (.claude/docs/article-rules.md, "Quotes"). The page image links to that
 * page in the reader, so the reader can check the wording against the print.
 *
 *   <SourceQuote
 *     book="the-book-slug" page={42}
 *     src="https://images.sourcelibrary.org/archived/<bookId>/42.jpg"
 *     source={<>Ficino, <em>Plotinus</em> (Basel, 1580)</>}
 *     original="Post haec anno 1463 ..."
 *   >
 *     After this, in the year 1463, ...
 *   </SourceQuote>
 *
 * `children` is the quotation as the article gives it (usually the library's
 * English); `original` is the source-language text when the article shows it.
 * On a phone the page sits under the quote.
 */
export default function SourceQuote({
  book,
  page,
  printedPage,
  src,
  source,
  original,
  pageAlt,
  children,
}: {
  book: string;
  page: number;
  /** The page number printed on the leaf, when it differs from the reader (scan) page. Shown in the source line. */
  printedPage?: number | string;
  src: string;
  source: ReactNode;
  original?: ReactNode;
  pageAlt?: string;
  children: ReactNode;
}) {
  const href = `/book/${book}?page=${page}`;
  return (
    <figure className="not-prose my-10 grid gap-6 md:grid-cols-[1fr_minmax(0,16rem)] items-center">
      <blockquote className="border-l-2 border-accent-gold/60 pl-5 font-body text-lg leading-relaxed text-primary">
        {original && <p className="mb-3 text-secondary italic">{original}</p>}
        <div>{children}</div>
        <figcaption className="mt-3 text-sm text-muted not-italic">
          {source}, <Link href={href}>p. {printedPage ?? page}</Link>
        </figcaption>
      </blockquote>
      <Link href={href} className="block border border-border-light bg-white p-2" aria-label={`Open p. ${page} in the reader`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={pageAlt ?? `The printed page, p. ${page}`} loading="lazy" className="w-full h-auto" />
      </Link>
    </figure>
  );
}
