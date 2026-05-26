'use client';

interface SectionDividerProps {
  imageUrl: string;
  alt: string;
  caption: string;
  source: string;
  /** Optional URL to the book in Source Library */
  bookUrl?: string;
}

/**
 * A visual breather between sections. One large vintage illustration
 * from the Source Library gallery, with a small attribution caption.
 * Pudding/NYT-style "section break" image.
 */
export function SectionDivider({ imageUrl, alt, caption, source, bookUrl }: SectionDividerProps) {
  return (
    <div className="my-20 -mx-6 sm:-mx-8 md:mx-0">
      <figure className="relative">
        <img
          src={imageUrl}
          alt={alt}
          className="w-full max-h-[480px] object-contain mx-auto block"
          loading="lazy"
          style={{
            filter: 'sepia(0.15) contrast(1.05)',
          }}
        />
        <figcaption className="mt-3 px-6 text-center text-xs text-stone-500 dark:text-stone-400 leading-relaxed max-w-prose mx-auto">
          <span className="italic">{caption}</span>
          {' — '}
          {bookUrl ? (
            <a href={bookUrl} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
              {source}
            </a>
          ) : (
            <span>{source}</span>
          )}
        </figcaption>
      </figure>
    </div>
  );
}
