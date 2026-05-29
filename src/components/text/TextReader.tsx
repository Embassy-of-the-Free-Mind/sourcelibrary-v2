import Link from 'next/link';

/**
 * Text-only reader for works that have transcribed/transliterated text but no
 * page scans (e.g. romanized Javanese works from Wikisource). Renders the work
 * as readable prose — romanized original with English translation when present —
 * instead of the image+OCR side-by-side layout, which assumes a page scan.
 */

interface TextPage {
  page_number: number;
  part_title?: string;
  transliteration?: { data?: string };
  translation?: { data?: string };
  ocr?: { data?: string };
}

interface TextReaderBook {
  id: string;
  slug: string;
  title: string;
  display_title?: string;
  author?: string;
  language?: string;
  published?: string;
  image_source?: {
    provider_name?: string;
    source_url?: string;
    license?: string;
    attribution?: string;
  };
}

function paragraphs(text: string) {
  return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
}

export default function TextReader({
  book,
  pages,
  collections,
}: {
  book: TextReaderBook;
  pages: TextPage[];
  collections?: Array<{ slug: string; name: string }>;
}) {
  const src = book.image_source || {};
  const sorted = [...pages].sort((a, b) => a.page_number - b.page_number);

  return (
    <main className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-6">
          <Link href="/" className="text-muted hover:text-secondary text-sm">← Source Library</Link>
        </div>

        <header className="mb-10 border-b border-border-light pb-8">
          <p className="text-xs uppercase tracking-wide text-accent-rust mb-2">Javanese text · romanized</p>
          <h1 className="text-3xl md:text-4xl text-primary font-serif leading-tight">{book.display_title || book.title}</h1>
          <p className="text-secondary mt-3">
            {book.author && !/^anonymous$/i.test(book.author) ? `${book.author} · ` : ''}
            {book.language || 'Javanese'}{book.published ? ` · ${book.published}` : ''}
          </p>
          {collections && collections.length > 0 && (
            <p className="text-sm text-muted mt-2">
              In{' '}
              {collections.map((c, i) => (
                <span key={c.slug}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/collections/${c.slug}`} className="text-accent-rust hover:underline">{c.name}</Link>
                </span>
              ))}
            </p>
          )}
          {src.source_url && (
            <p className="text-xs text-muted mt-4">
              Text from{' '}
              <a href={src.source_url} className="text-accent-rust hover:underline" rel="noopener noreferrer">{src.provider_name || 'source'}</a>
              {src.license ? ` · ${src.license}` : ''}. {src.attribution || ''}
            </p>
          )}
        </header>

        <article className="prose-content max-w-none">
          {sorted.map((pg, idx) => {
            const orig = pg.transliteration?.data || pg.ocr?.data || '';
            const trans = pg.translation?.data || '';
            if (!orig.trim() && !trans.trim()) return null;
            return (
              <section key={pg.page_number} className="mb-12">
                {pg.part_title && (
                  <h2 className="text-xl md:text-2xl text-primary font-serif mt-10 mb-4">{pg.part_title}</h2>
                )}
                {orig.trim() && (
                  <div className="text-secondary leading-relaxed whitespace-pre-line mb-4">
                    {paragraphs(orig).map((p, i) => <p key={i} className="mb-4">{p}</p>)}
                  </div>
                )}
                {trans.trim() && (
                  <div className="border-l-4 border-accent-rust/30 pl-4 text-stone-600 italic leading-relaxed">
                    {paragraphs(trans).map((p, i) => <p key={i} className="mb-3">{p}</p>)}
                  </div>
                )}
                {idx < sorted.length - 1 && <hr className="border-border-light mt-10" />}
              </section>
            );
          })}
        </article>
      </div>
    </main>
  );
}
