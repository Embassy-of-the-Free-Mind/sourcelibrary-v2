import { ReactNode } from 'react';
import Link from 'next/link';
import ArticleImage from './ArticleImage';

/**
 * A page, plate, detail or screenshot in an article, shown whole at its own
 * proportions (.claude/docs/article-rules.md, "Pictures").
 *
 * From the library: pass `href` (the reader page, `/book/<slug>?page=N`) and
 * `source` (the book). From outside the library: pass `credit` with the
 * holder, the licence and a link, and only use the image when that licence
 * allows it (public domain, CC0, CC BY, CC BY-SA, or permission in writing).
 *
 *   <PageFigure src="..." alt="..." href="/book/x?page=12" source={<em>De divina proportione</em>}>
 *     Leonardo's hollow dodecahedron, drawn for Pacioli.
 *   </PageFigure>
 */
export default function PageFigure({
  src,
  alt,
  href,
  source,
  credit,
  wide = false,
  linkToPage = false,
  children,
}: {
  src: string;
  alt: string;
  href?: string;
  source?: ReactNode;
  credit?: ReactNode;
  wide?: boolean;
  /** Clicking the picture opens `href` (the reader page) instead of the lightbox. */
  linkToPage?: boolean;
  children?: ReactNode;
}) {
  const img = <ArticleImage src={src} alt={alt} sizes={wide ? '(max-width: 768px) 100vw, 1060px' : undefined} />;
  return (
    <figure className={`not-prose my-10 ${wide ? 'md:-mx-16' : ''}`}>
      {linkToPage && href ? <Link href={href} className="block">{img}</Link> : <div data-lightbox-href={href}>{img}</div>}
      {(children || source || credit) && (
        <figcaption className="mt-2 text-sm text-muted leading-relaxed">
          {children}
          {source && (
            <>
              {children ? ' ' : ''}
              {href ? <Link href={href}>{source}</Link> : source}.
            </>
          )}
          {credit && <span className="block mt-0.5">{credit}</span>}
        </figcaption>
      )}
    </figure>
  );
}
