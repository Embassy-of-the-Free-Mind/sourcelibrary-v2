'use client';

import { useEffect, useState } from 'react';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import articleBooks from '@/generated/article-books.json';

const FIRST_SHOWN = 8;

// "Books in this article": the library's books an article links to, as the
// site's standard book cards, in the order the article mentions them.
export default function ArticleBooks({ slug }: { slug: string }) {
  const linked = ((articleBooks as Record<string, string[]>)[slug] || []).length;
  const [books, setBooks] = useState<CollectionBook[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!linked) return;
    let live = true;
    fetch(`/api/articles/books?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : { books: [] }))
      .then((j) => live && setBooks(j.books || []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [slug, linked]);

  if (!books.length) return null;
  const shown = all ? books : books.slice(0, FIRST_SHOWN);

  return (
    <section className="bg-cream print:hidden" aria-labelledby="article-books">
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pb-12">
        <div className="border-t border-border-light pt-10 mb-8">
          <h2 id="article-books" className="font-serif text-3xl text-primary">
            Books in this article
          </h2>
          <p className="mt-2 text-secondary font-body">
            {books.length === 1 ? 'The book in the library this article draws on.' : `The ${books.length} books in the library this article draws on.`}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
          {shown.map((b) => (
            <CollectionBookCard key={b.id} book={b} />
          ))}
        </div>
        {books.length > shown.length && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="mt-8 text-sm font-medium text-primary underline decoration-border-light underline-offset-4 hover:decoration-primary"
          >
            Show all {books.length} books
          </button>
        )}
      </div>
    </section>
  );
}
