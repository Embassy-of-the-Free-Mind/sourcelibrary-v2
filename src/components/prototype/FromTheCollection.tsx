import Image from 'next/image';
import Link from 'next/link';

interface ShowcaseItem {
  // Gallery image fields
  page_id: string;
  book_id: string;
  page_number: number;
  detection_index: number;
  thumbnail_url: string;
  extracted_url?: string;
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
          Illustrations from rare books in the library
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5">
          {items.map((item) => {
            const galleryId = `${item.page_id}-${item.detection_index}`;
            const bookHref = item.book_slug
              ? `/book/${item.book_slug}`
              : `/book/${item.book_id}`;

            return (
              <div key={galleryId} className="group">
                {/* Image */}
                <Link href={`/gallery/image/${galleryId}`}>
                  <div className="relative aspect-[3/4] bg-cream rounded-lg overflow-hidden border border-border-light group-hover:shadow-lg transition-all">
                    <Image
                      src={item.extracted_url || item.thumbnail_url}
                      alt={item.museum_description || 'Gallery image'}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                    {item.type && (
                      <span className="absolute top-2 left-2 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize">
                        {item.type}
                      </span>
                    )}
                  </div>
                </Link>

                {/* Minimal caption */}
                <div className="mt-2">
                  <Link
                    href={bookHref}
                    className="text-sm text-secondary hover:text-accent-rust transition-colors line-clamp-1 font-medium"
                  >
                    {item.book_title}
                  </Link>
                  <p className="text-xs text-muted line-clamp-1 mt-0.5">
                    {item.book_author}{item.book_year > 0 ? ` (${item.book_year})` : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
