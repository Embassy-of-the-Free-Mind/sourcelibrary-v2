import SourceQuote from '@/components/articles/SourceQuote';
import { type Figure, pageImage } from './histories';

// A library quote in a history: the library's English, the original when the claim gives it, the source, and the
// printed page beside it; the page number is the quote's /q/ citation link (article-rules.md, "Quotes").
export default function Quote({ f }: { f: Figure }) {
  const src = pageImage(f);
  if (!src) return null; // no displayable page image: a quote here always shows its page
  return (
    <SourceQuote
      book={f.book}
      page={f.page}
      href={f.u}
      src={src}
      source={f.l}
      original={f.qo && f.qo !== f.q ? f.qo : undefined}
      pageAlt={`The page quoted, from ${f.l}`}
    >
      {f.q}
    </SourceQuote>
  );
}
