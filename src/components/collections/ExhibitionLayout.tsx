'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ArrowRight, Quote, Clock, Users, Sparkles } from 'lucide-react';
import { bookUrl } from '@/lib/slugify';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import AuthorName from '@/components/AuthorName';

// ─── Types ──────────────────────────────────────────────────────

interface BookRef {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  is_first_translation?: boolean;
  ft_disposition?: string;
}

interface GalleryImage {
  id: string;
  book_id: string;
  page_id?: string;
  book_title: string;
  type?: string;
  museum_description?: string;
  extracted_url?: string;
  thumbnail_url?: string;
  image_url?: string;
}

interface LayoutBlock {
  component: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface ExhibitionLayoutProps {
  layout: LayoutBlock[];
  books: BookRef[];
  images: GalleryImage[];
  collectionSlug: string;
}

// ─── Helpers ────────────────────────────────────────────────────

function findBook(books: BookRef[], id: string): BookRef | undefined {
  return books.find(b => b.id === id);
}

function bookTitle(book: BookRef): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

function imageUrl(img: GalleryImage): string {
  return img.thumbnail_url || img.extracted_url || img.image_url || '';
}

function imagePageHref(img: GalleryImage): string {
  if (img.page_id) return `/book/${img.book_id}/page/${img.page_id}`;
  return `/book/${img.book_id}`;
}

// ─── Helper: Link book titles in text ───────────────────────────

/**
 * Finds book titles in text and wraps them in links.
 * Only matches display_title or title — never generic phrases.
 * Titles must be >= 10 chars to avoid false positives.
 */
function linkBookNames(text: string, books: BookRef[]): React.ReactNode {
  // Build title → book map, longest first to avoid partial matches
  const titleMap: { title: string; book: BookRef }[] = [];
  for (const book of books) {
    const dt = book.display_title;
    const t = book.title;
    if (dt && dt !== 'None' && dt.length >= 10) titleMap.push({ title: dt, book });
    if (t && t !== dt && t.length >= 10) titleMap.push({ title: t, book });
  }
  titleMap.sort((a, b) => b.title.length - a.title.length);

  // Find matches
  const matches: { start: number; end: number; book: BookRef }[] = [];
  const used: [number, number][] = [];

  for (const { title, book } of titleMap) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!used.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, book });
        used.push([start, end]);
      }
    }
  }

  if (matches.length === 0) return text;
  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const m of matches) {
    if (m.start > lastIdx) parts.push(text.slice(lastIdx, m.start));
    parts.push(
      <Link
        key={`${m.book.id}-${m.start}`}
        href={bookUrl({ id: m.book.id, slug: m.book.slug })}
        className="text-accent-rust hover:underline"
      >
        {text.slice(m.start, m.end)}
      </Link>
    );
    lastIdx = m.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return <>{parts}</>;
}

// ─── Component: Hook ────────────────────────────────────────────

function HookBlock({ text }: { text: string }) {
  return (
    <div className="bg-dark text-white px-6 py-8 sm:py-10 -mx-6 sm:-mx-8">
      <div className="max-w-4xl mx-auto text-center">
        <Sparkles className="w-5 h-5 text-accent-gold mx-auto mb-3 opacity-60" />
        <p className="text-lg sm:text-xl md:text-2xl font-display leading-relaxed text-white/90">
          {text}
        </p>
      </div>
    </div>
  );
}

// ─── Component: Stats ───────────────────────────────────────────

function StatsBlock({ items }: { items: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-8 sm:gap-12 py-6 border-y border-border-light">
      {items.map((item, i) => (
        <div key={i} className="text-center">
          <div className="text-2xl sm:text-3xl font-display text-primary">{item.value}</div>
          <div className="text-xs sm:text-sm text-muted mt-1">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Component: Sections ────────────────────────────────────────

function SectionsBlock({ sections, books }: {
  sections: {
    title: string;
    description: string;
    period?: string;
    books: { id: string; note: string }[];
  }[];
  books: BookRef[];
}) {
  return (
    <div className="space-y-12">
      {sections.map((section, si) => (
        <div key={si}>
          <div className="mb-6">
            <div className="flex items-baseline gap-3 mb-2">
              <h3 className="text-xl sm:text-2xl font-display text-primary">
                {section.title}
              </h3>
              {section.period && (
                <span className="text-sm text-muted whitespace-nowrap">{section.period}</span>
              )}
            </div>
            <p className="text-secondary leading-relaxed max-w-3xl">{section.description}</p>
          </div>

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {section.books.map((ref) => {
              const book = findBook(books, ref.id);
              if (!book) return null;
              return (
                <Link
                  key={ref.id}
                  href={bookUrl({ id: book.id, slug: book.slug })}
                  className="group flex gap-4 p-4 rounded-xl bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
                >
                  <div className="w-16 sm:w-20 flex-shrink-0">
                    <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-warm">
                      {(book.thumbnail_blob || book.thumbnail) ? (
                        <Image
                          src={(book.thumbnail_blob || book.thumbnail)!}
                          alt={bookTitle(book)}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="80px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-6 h-6 text-muted" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 py-0.5">
                    <h4 className="font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-1 font-display text-sm sm:text-base">
                      {bookTitle(book)}
                    </h4>
                    <p className="text-xs text-muted mb-1.5">
                      <AuthorName author={book.author} />{book.year ? `, ${book.year}` : ''}
                      {book.is_first_translation && (
                        <span className="ml-2 text-[10px] font-medium bg-accent-rust/10 text-accent-rust px-1.5 py-0.5 rounded">
                          {firstTranslationBadge(book.ft_disposition, book.language)}
                        </span>
                      )}
                    </p>
                    {ref.note && (
                      <p className="text-xs sm:text-sm text-secondary leading-relaxed line-clamp-3">
                        {ref.note}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Component: Key Figures ─────────────────────────────────────

function KeyFiguresBlock({ figures, books }: {
  figures: {
    name: string;
    dates?: string;
    bio: string;
    key_book_id?: string;
  }[];
  books: BookRef[];
}) {
  return (
    <div>
      <h3 className="text-xl sm:text-2xl font-display text-primary mb-6 flex items-center gap-2">
        <Users className="w-5 h-5 text-muted" />
        Key Figures
      </h3>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {figures.map((fig, i) => {
          const book = fig.key_book_id ? findBook(books, fig.key_book_id) : undefined;
          return (
            <div key={i} className="p-5 rounded-xl bg-white border border-border-light">
              <div className="mb-2">
                <h4 className="font-display text-lg text-primary">{fig.name}</h4>
                {fig.dates && <p className="text-xs text-muted">{fig.dates}</p>}
              </div>
              <p className="text-sm text-secondary leading-relaxed mb-3">{fig.bio}</p>
              {book && (
                <Link
                  href={bookUrl({ id: book.id, slug: book.slug })}
                  className="text-xs text-accent-rust hover:underline flex items-center gap-1"
                >
                  <BookOpen className="w-3 h-3" />
                  {bookTitle(book)}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Component: Quotes ──────────────────────────────────────────

function QuotesBlock({ quotes, books }: {
  quotes: {
    text: string;
    author?: string;
    book_title?: string;
    book_id?: string;
    page_number?: number;
    verified?: boolean;
  }[];
  books: BookRef[];
}) {
  return (
    <div className="space-y-6">
      {quotes.filter(q => q.verified !== false).map((q, i) => {
        const book = q.book_id ? findBook(books, q.book_id) : undefined;
        return (
          <blockquote
            key={i}
            className="relative pl-6 border-l-2 border-accent-gold/40 py-2"
          >
            <Quote className="absolute -left-3 -top-1 w-5 h-5 text-accent-gold/30 bg-cream" />
            <p className="text-lg sm:text-xl font-display text-primary/80 leading-relaxed italic">
              &ldquo;{q.text}&rdquo;
            </p>
            <footer className="mt-2 text-sm text-muted">
              — <AuthorName author={q.author} />
              {book ? (
                <Link
                  href={q.page_number
                    ? `${bookUrl({ id: book.id, slug: book.slug })}?page=${q.page_number}`
                    : bookUrl({ id: book.id, slug: book.slug })}
                  className="text-accent-rust hover:underline ml-1"
                >
                  {q.book_title || bookTitle(book)}
                  {q.page_number ? `, p. ${q.page_number}` : ''}
                </Link>
              ) : (
                q.book_title ? `, ${q.book_title}` : ''
              )}
            </footer>
          </blockquote>
        );
      })}
    </div>
  );
}

// ─── Component: Timeline ────────────────────────────────────────

function TimelineBlock({ start_year, end_year, highlights, books }: {
  start_year: number;
  end_year: number;
  highlights: { year: number; label: string; book_id?: string; author?: string }[];
  books?: BookRef[];
}) {
  return (
    <div>
      <h3 className="text-xl sm:text-2xl font-display text-primary mb-6 flex items-center gap-2">
        <Clock className="w-5 h-5 text-muted" />
        Timeline
      </h3>
      <div className="relative">
        {/* Line */}
        <div className="absolute left-3 top-0 bottom-0 w-px bg-border-light" />

        <div className="space-y-6 pl-10">
          {highlights.map((h, i) => {
            const book = h.book_id && books ? findBook(books, h.book_id) : undefined;
            return (
              <div key={i} className="relative">
                {/* Dot */}
                <div
                  className="absolute -left-[29px] w-2.5 h-2.5 rounded-full bg-accent-rust border-2 border-cream"
                  style={{ top: '6px' }}
                />
                <div className="text-xs text-muted font-mono mb-0.5">{h.year}</div>
                <p className="text-sm text-primary leading-snug">{h.label}</p>
                {(book || h.author) && (
                  <div className="mt-1 flex items-center gap-2">
                    {h.author && (
                      <span className="text-xs text-muted"><AuthorName author={h.author} /></span>
                    )}
                    {book && (
                      <Link
                        href={bookUrl({ id: book.id, slug: book.slug })}
                        className="text-xs text-accent-rust hover:underline flex items-center gap-1"
                      >
                        <BookOpen className="w-3 h-3" />
                        {bookTitle(book)}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Component: Featured Image ──────────────────────────────────

function FeaturedImageBlock({ image, caption }: {
  image?: GalleryImage;
  caption: string;
}) {
  const src = image ? imageUrl(image) : '';
  if (!src) return null;

  const inner = (
    <figure className="rounded-xl overflow-hidden border border-border-light">
      <div className="relative aspect-[16/9] sm:aspect-[2/1] bg-dark">
        <Image
          src={src}
          alt={image?.museum_description || caption}
          fill
          className="object-contain"
          sizes="(min-width: 1024px) 900px, 100vw"
        />
      </div>
      <figcaption className="px-4 py-3 text-sm text-secondary bg-white leading-relaxed">
        {caption}
      </figcaption>
    </figure>
  );

  if (image?.book_id) {
    return (
      <Link href={imagePageHref(image)} className="block hover:opacity-95 transition-opacity">
        {inner}
      </Link>
    );
  }

  return inner;
}

// ─── Component: Reading Paths ───────────────────────────────────

function ReadingPathsBlock({ paths, books }: {
  paths: {
    audience: string;
    description?: string;
    steps: { book_id: string; instruction: string }[];
  }[];
  books: BookRef[];
}) {
  return (
    <div>
      <h3 className="text-xl sm:text-2xl font-display text-primary mb-6">
        Where to Start
      </h3>
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {paths.map((path, pi) => (
          <div key={pi} className="p-5 rounded-xl bg-white border border-border-light">
            <h4 className="font-display text-lg text-primary mb-1">{path.audience}</h4>
            {path.description && (
              <p className="text-sm text-muted mb-4">{path.description}</p>
            )}
            <ol className="space-y-3">
              {path.steps.map((step, si) => {
                const book = findBook(books, step.book_id);
                if (!book) return null;
                return (
                  <li key={si} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-rust/10 text-accent-rust text-xs font-medium flex items-center justify-center mt-0.5">
                      {si + 1}
                    </span>
                    <div>
                      <Link
                        href={bookUrl({ id: book.id, slug: book.slug })}
                        className="text-sm font-medium text-accent-rust hover:underline"
                      >
                        {bookTitle(book)}
                      </Link>
                      {step.instruction && (
                        <p className="text-xs text-secondary mt-0.5 leading-relaxed">
                          {step.instruction}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Component: Cross-Collections ───────────────────────────────

function CrossCollectionsBlock({ links }: {
  links: { slug: string; why: string }[];
}) {
  return (
    <div>
      <h3 className="text-lg font-display text-primary mb-4">Related Collections</h3>
      <div className="flex flex-wrap gap-3">
        {links.map((link, i) => (
          <Link
            key={i}
            href={`/collections/${link.slug}`}
            className="group flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-sm transition-all"
          >
            <span className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors capitalize">
              {link.slug.replace(/-/g, ' ')}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-muted group-hover:text-accent-rust transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Component: Gallery Grid ────────────────────────────────────

function GalleryGridBlock({ embeddedImages, fallbackImages, indices, title }: {
  embeddedImages?: GalleryImage[];
  fallbackImages: GalleryImage[];
  indices?: number[];
  title?: string;
}) {
  // Prefer embedded resolved images, fall back to index-based lookup
  const selected = embeddedImages && embeddedImages.length > 0
    ? embeddedImages
    : (indices || []).map(i => fallbackImages[i]).filter(Boolean);

  if (selected.length === 0) return null;

  return (
    <div>
      {title && (
        <h3 className="text-xl sm:text-2xl font-display text-primary mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-muted" />
          {title}
        </h3>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {selected.map((img) => {
          const src = imageUrl(img);
          if (!src) return null;
          return (
            <Link
              key={img.id}
              href={imagePageHref(img)}
              className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
              title={img.museum_description}
            >
              <Image
                src={src}
                alt={img.museum_description || img.book_title || 'Illustration'}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
                sizes="(min-width: 1024px) 200px, (min-width: 640px) 160px, 50vw"
              />
              {img.type && (
                <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize">
                  {img.type}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Layout Renderer ────────────────────────────────────────────

export default function ExhibitionLayout({ layout, books, images, collectionSlug }: ExhibitionLayoutProps) {
  return (
    <div className="space-y-10">
      {layout.map((block, i) => {
        switch (block.component) {
          case 'hook':
            return <HookBlock key={i} text={block.text} />;

          case 'stats':
            return <StatsBlock key={i} items={block.items} />;

          case 'sections':
            return <SectionsBlock key={i} sections={block.sections} books={books} />;

          case 'key_figures':
            return <KeyFiguresBlock key={i} figures={block.figures} books={books} />;

          case 'quotes':
            return <QuotesBlock key={i} quotes={block.quotes} books={books} />;

          case 'timeline':
            return <TimelineBlock key={i} start_year={block.start_year} end_year={block.end_year} highlights={block.highlights} books={books} />;

          case 'featured_image': {
            const featImg = block.image || (typeof block.image_index === 'number' ? images[block.image_index] : null);
            return featImg
              ? <FeaturedImageBlock key={i} image={featImg} caption={block.caption} />
              : null;
          }

          case 'reading_paths':
            return <ReadingPathsBlock key={i} paths={block.paths} books={books} />;

          case 'gallery_grid':
            return <GalleryGridBlock key={i} embeddedImages={block.images} fallbackImages={images} indices={block.image_indices} title={block.title || 'Illustrations from the Collection'} />;

          case 'cross_collections':
            return <CrossCollectionsBlock key={i} links={block.links} />;

          case 'description':
            return (
              <div key={i} className="max-w-3xl">
                {(block.paragraphs || []).map((p: string, pi: number) => (
                  <p key={pi} className="text-secondary text-lg leading-relaxed mb-4 last:mb-0 font-body">
                    {linkBookNames(p, books)}
                  </p>
                ))}
              </div>
            );

          case 'subcollections':
            // Rendered by parent — just a flag
            return null;

          default:
            return null;
        }
      })}
    </div>
  );
}
