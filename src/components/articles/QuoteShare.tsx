'use client';

import { useEffect, useRef, useState } from 'react';
import ShareButton from '@/components/ui/ShareButton';

/**
 * Share one quotation from an article: the words, the source line, and a link
 * to the printed page it comes from, so whoever receives it lands on the
 * primary source rather than on our prose about it.
 *
 * SourceQuote is a server component whose quote is JSX (italics, links), not a
 * string, so the text is read from the rendered quote after mount — the same
 * words the reader sees, with no second copy to drift.
 */
export default function QuoteShare({ href, page }: { href: string; page: number | string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [quote, setQuote] = useState<{ text: string; source: string } | null>(null);

  useEffect(() => {
    const figure = ref.current?.closest('figure');
    const text = figure?.querySelector<HTMLElement>('[data-quote-text]')?.innerText.trim();
    const source = figure?.querySelector<HTMLElement>('[data-quote-source]')?.innerText.trim();
    if (text) setQuote({ text, source: source ?? '' });
  }, []);

  const url = href.startsWith('http') ? href : `https://sourcelibrary.org${href}`;

  return (
    <span ref={ref} className="inline-flex align-middle ml-1">
      {quote && (
        <ShareButton
          variant="icon"
          text={quote.text}
          // ShareButton builds the citation as `author, "title", (year), p. N`;
          // the source line already reads "Author, Title (Place, Year)", so it
          // goes in as `author` with the page appended, and nothing is quoted twice.
          author={[quote.source, `p. ${page}`].filter(Boolean).join(', ')}
          url={url}
          surface="article_quote"
          className="!p-1 -my-1 text-muted hover:!bg-transparent hover:text-secondary"
        />
      )}
    </span>
  );
}
