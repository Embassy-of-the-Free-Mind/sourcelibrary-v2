import Image from 'next/image';
import Link from 'next/link';

interface ShowcaseItem {
  // Gallery image fields
  page_id: string;
  book_id: string;
  page_number: number;
  detection_index: number;
  thumbnail_url: string;
  type: string;
  museum_description: string;
  book_title: string;
  book_author: string;
  book_year: number;
  book_slug?: string;
  // Quote from the book
  quote?: {
    text: string;
    page: number;
  };
}

interface FromTheCollectionProps {
  items: ShowcaseItem[];
}

export default function FromTheCollection({ items }: FromTheCollectionProps) {
  if (items.length === 0) return null;

  return (
    <section className="bg-warm py-16 md:py-24">
      <div className="px-6 md:px-12 max-w-7xl mx-auto">
        <h2 className="text-3xl md:text-4xl text-primary mb-3 font-display">
          From the Collection
        </h2>
        <p className="text-muted mb-10 max-w-2xl">
          Illustrations and translations from rare books in the library
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {items.map((item) => {
            const galleryId = `${item.page_id}-${item.detection_index}`;
            const bookHref = item.book_slug
              ? `/book/${item.book_slug}`
              : `/book/${item.book_id}`;

            return (
              <div
                key={galleryId}
                className="bg-white rounded-xl border border-border-light overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Image */}
                <Link href={`/gallery/image/${galleryId}`}>
                  <div className="relative aspect-[4/3] bg-cream overflow-hidden">
                    <Image
                      src={item.thumbnail_url}
                      alt={item.museum_description || 'Gallery image'}
                      fill
                      className="object-contain hover:scale-105 transition-transform duration-500"
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                    {item.type && (
                      <span className="absolute top-3 left-3 text-xs bg-dark/70 text-white px-2 py-1 rounded capitalize">
                        {item.type}
                      </span>
                    )}
                  </div>
                </Link>

                {/* Content */}
                <div className="p-5 md:p-6">
                  {/* Museum description */}
                  <p className="text-base leading-relaxed text-secondary font-body mb-4">
                    {item.museum_description}
                  </p>

                  {/* Quote */}
                  {item.quote && (
                    <blockquote className="border-l-2 border-accent-gold/40 pl-4 mb-4">
                      <p className="text-base text-secondary/80 italic font-body leading-relaxed line-clamp-4">
                        &ldquo;{item.quote.text}&rdquo;
                      </p>
                      <cite className="text-xs text-muted not-italic mt-1 block">
                        Page {item.quote.page}
                      </cite>
                    </blockquote>
                  )}

                  {/* Book attribution */}
                  <Link
                    href={bookHref}
                    className="group flex items-center gap-2 text-sm text-muted hover:text-accent-rust transition-colors"
                  >
                    <span className="font-medium group-hover:underline">
                      {item.book_title}
                    </span>
                    {item.book_author && (
                      <>
                        <span className="text-border-medium">&middot;</span>
                        <span>{item.book_author}</span>
                      </>
                    )}
                    {item.book_year > 0 && (
                      <>
                        <span className="text-border-medium">&middot;</span>
                        <span>{item.book_year}</span>
                      </>
                    )}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
