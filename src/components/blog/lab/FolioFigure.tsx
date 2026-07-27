import { ReactNode } from 'react';
import Link from 'next/link';

/**
 * A captioned plate from a held book, for the Sound Laboratory stations.
 * Every plate must gesture at a specific source page (house rule, #3159) —
 * `href` is the reader page (always the ?page=N query form; the /page/<n>
 * path form soft-404s), `sourceLabel` names the book. When the plate is NOT
 * from the book the station cites, say so in the caption.
 */
export function FolioFigure({
  src,
  alt,
  caption,
  href,
  sourceLabel,
}: {
  src: string;
  alt: string;
  caption: ReactNode;
  href: string;
  sourceLabel: string;
}) {
  return (
    <figure className="my-8 not-prose">
      <div className="rounded-lg border border-border-light bg-white/70 p-3">
        <img
          src={src}
          alt={alt}
          className="w-full h-auto max-h-[560px] object-contain bg-cream rounded"
          loading="lazy"
        />
      </div>
      <figcaption className="text-sm text-muted mt-2">
        {caption}{' '}
        <Link href={href} className="text-accent-rust hover:text-accent-rust underline whitespace-nowrap">
          {sourceLabel}
        </Link>
      </figcaption>
    </figure>
  );
}

/** Two plates side by side on desktop, stacked on mobile. */
export function FolioPair({ children }: { children: ReactNode }) {
  return <div className="grid md:grid-cols-2 gap-4 my-8 not-prose [&>figure]:my-0">{children}</div>;
}
