'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Heart, BookOpen, FileText, Image as ImageIcon, User, TrendingUp } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import { likes } from '@/lib/api-client';

const VISITOR_ID_KEY = 'sl_visitor_id';

function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(VISITOR_ID_KEY) || '';
}

interface FeaturedImage {
  url: string;
  description?: string;
  type?: string;
}

interface PopularBook {
  id: string;
  title: string;
  author?: string;
  year?: number;
  published?: string;
  language?: string;
  thumbnail?: string;
  featured_images?: FeaturedImage[];
  likeCount: number;
}

interface PopularPage {
  id: string;
  pageNumber: number;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: number;
  thumbnail?: string;
  excerpt: string;
  likeCount: number;
}

interface PopularImage {
  galleryImageId: string;
  pageId: string;
  detectionIndex: number;
  likeCount: number;
  description: string;
  type: string;
  museumDescription?: string;
  croppedUrl: string;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: number;
}

type Tab = 'books' | 'pages' | 'images';
type Mode = 'popular' | 'mine';

export default function FavoritesPage() {
  const [tab, setTab] = useState<Tab>('books');
  const [mode, setMode] = useState<Mode>('mine');

  // Popular data
  const [popularBooks, setPopularBooks] = useState<PopularBook[]>([]);
  const [popularPages, setPopularPages] = useState<PopularPage[]>([]);
  const [popularImages, setPopularImages] = useState<PopularImage[]>([]);
  const [loadingPopularBooks, setLoadingPopularBooks] = useState(false);
  const [loadingPopularPages, setLoadingPopularPages] = useState(false);
  const [loadingPopularImages, setLoadingPopularImages] = useState(false);
  const [popularLoaded, setPopularLoaded] = useState(false);

  // My likes data
  const [myBooks, setMyBooks] = useState<PopularBook[]>([]);
  const [myPages, setMyPages] = useState<PopularPage[]>([]);
  const [myImages, setMyImages] = useState<PopularImage[]>([]);
  const [loadingMyBooks, setLoadingMyBooks] = useState(true);
  const [loadingMyPages, setLoadingMyPages] = useState(true);
  const [loadingMyImages, setLoadingMyImages] = useState(true);

  // Load my likes on mount
  useEffect(() => {
    const visitorId = getVisitorId();
    if (!visitorId) {
      setLoadingMyBooks(false);
      setLoadingMyPages(false);
      setLoadingMyImages(false);
      return;
    }

    likes.getMine<PopularBook>({ type: 'book', visitorId })
      .then(data => setMyBooks(data.items))
      .catch(console.error)
      .finally(() => setLoadingMyBooks(false));

    likes.getMine<PopularPage>({ type: 'page', visitorId })
      .then(data => setMyPages(data.items))
      .catch(console.error)
      .finally(() => setLoadingMyPages(false));

    likes.getMine<PopularImage>({ type: 'image', visitorId })
      .then(data => setMyImages(data.items))
      .catch(console.error)
      .finally(() => setLoadingMyImages(false));
  }, []);

  // Lazy-load popular data only when switching to that mode
  const loadPopular = useCallback(() => {
    if (popularLoaded) return;
    setPopularLoaded(true);
    setLoadingPopularBooks(true);
    setLoadingPopularPages(true);
    setLoadingPopularImages(true);

    likes.getPopular<PopularBook>({ type: 'book', limit: 50 })
      .then(data => setPopularBooks(data.items))
      .catch(console.error)
      .finally(() => setLoadingPopularBooks(false));

    likes.getPopular<PopularPage>({ type: 'page', limit: 50 })
      .then(data => setPopularPages(data.items))
      .catch(console.error)
      .finally(() => setLoadingPopularPages(false));

    likes.getPopular<PopularImage>({ type: 'image', limit: 50 })
      .then(data => setPopularImages(data.items))
      .catch(console.error)
      .finally(() => setLoadingPopularImages(false));
  }, [popularLoaded]);

  const handleModeSwitch = (newMode: Mode) => {
    setMode(newMode);
    if (newMode === 'popular') loadPopular();
  };

  const books = mode === 'mine' ? myBooks : popularBooks;
  const pages = mode === 'mine' ? myPages : popularPages;
  const images = mode === 'mine' ? myImages : popularImages;

  const loadingBooks = mode === 'mine' ? loadingMyBooks : loadingPopularBooks;
  const loadingPages = mode === 'mine' ? loadingMyPages : loadingPopularPages;
  const loadingImages = mode === 'mine' ? loadingMyImages : loadingPopularImages;

  const loading = tab === 'books' ? loadingBooks : tab === 'pages' ? loadingPages : loadingImages;
  const items = tab === 'books' ? books : tab === 'pages' ? pages : images;
  const isEmpty = items.length === 0;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Logo bar */}
      <header className="bg-white border-b border-border-light">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-secondary hover:text-primary transition-colors"
          >
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
        </div>
      </header>

      {/* Dark hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl mb-4">Favorites</h1>
          <p className="text-xl text-stone-300 max-w-2xl">
            {mode === 'mine'
              ? 'Books, pages, and illustrations you\'ve liked.'
              : 'The most loved books, pages, and illustrations \u2014 as chosen by readers.'}
          </p>

          {/* Mode toggle */}
          <div className="mt-6 inline-flex bg-white/10 rounded-lg p-1">
            <button
              onClick={() => handleModeSwitch('mine')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
                mode === 'mine'
                  ? 'bg-white text-stone-900'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <User className="w-4 h-4" />
              My Likes
            </button>
            <button
              onClick={() => handleModeSwitch('popular')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
                mode === 'popular'
                  ? 'bg-white text-stone-900'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Most Popular
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-1">
            {([
              { key: 'books' as Tab, icon: BookOpen, label: 'Books', count: books.length, isLoading: loadingBooks },
              { key: 'pages' as Tab, icon: FileText, label: 'Pages', count: pages.length, isLoading: loadingPages },
              { key: 'images' as Tab, icon: ImageIcon, label: 'Gallery', count: images.length, isLoading: loadingImages },
            ]).map(({ key, icon: Icon, label, count, isLoading }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-5 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === key
                    ? 'border-stone-900 text-stone-900'
                    : 'border-transparent text-stone-400 hover:text-stone-600'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {label}
                  {!isLoading && count > 0 && (
                    <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full">{count}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <BookLoader size="sm" />
          </div>
        ) : isEmpty ? (
          <div className="text-center py-20">
            <Heart className="w-12 h-12 text-stone-300 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-stone-600 mb-2">
              {mode === 'mine' ? 'No likes yet' : 'No favorites yet'}
            </h2>
            <p className="text-stone-400 mb-6 text-sm">
              {mode === 'mine'
                ? tab === 'books'
                  ? 'Like books to see them here.'
                  : tab === 'pages'
                    ? 'Like pages while reading to see them here.'
                    : 'Like images in the gallery to see them here.'
                : 'No items have been liked yet.'}
            </p>
            <Link
              href={tab === 'images' ? '/gallery' : '/'}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors"
            >
              {tab === 'images' ? 'Browse Gallery' : 'Browse Library'}
            </Link>
          </div>

        ) : tab === 'books' ? (
          /* Books — collection-style cards with extracted illustrations */
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
            {books.map((book, i) => {
              const imgs = book.featured_images || [];
              const heroUrl = imgs[0]?.url || book.thumbnail;

              return (
                <Link
                  key={book.id}
                  href={`/book/${book.id}`}
                  className="group relative block overflow-hidden rounded-lg"
                >
                  {/* Image mosaic: 1 hero + up to 2 side images */}
                  <div className="relative aspect-[4/3]">
                    {imgs.length >= 3 ? (
                      /* 3-image layout: large left, two stacked right */
                      <div className="absolute inset-0 flex gap-0.5">
                        <div className="relative flex-[2]">
                          <Image
                            src={imgs[0].url}
                            alt={imgs[0].description || book.title}
                            fill
                            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                            sizes="(max-width: 640px) 66vw, 33vw"
                            priority={i < 4}
                            unoptimized
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-0.5">
                          <div className="relative flex-1">
                            <Image
                              src={imgs[1].url}
                              alt={imgs[1].description || ''}
                              fill
                              className="object-cover"
                              sizes="(max-width: 640px) 33vw, 17vw"
                              unoptimized
                            />
                          </div>
                          <div className="relative flex-1">
                            <Image
                              src={imgs[2].url}
                              alt={imgs[2].description || ''}
                              fill
                              className="object-cover"
                              sizes="(max-width: 640px) 33vw, 17vw"
                              unoptimized
                            />
                          </div>
                        </div>
                      </div>
                    ) : imgs.length === 2 ? (
                      /* 2-image layout: side by side */
                      <div className="absolute inset-0 flex gap-0.5">
                        <div className="relative flex-1">
                          <Image
                            src={imgs[0].url}
                            alt={imgs[0].description || book.title}
                            fill
                            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                            sizes="(max-width: 640px) 50vw, 25vw"
                            priority={i < 4}
                            unoptimized
                          />
                        </div>
                        <div className="relative flex-1">
                          <Image
                            src={imgs[1].url}
                            alt={imgs[1].description || ''}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 50vw, 25vw"
                            unoptimized
                          />
                        </div>
                      </div>
                    ) : heroUrl ? (
                      /* Single image fallback */
                      <Image
                        src={heroUrl}
                        alt={book.title}
                        fill
                        className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        sizes="(max-width: 640px) 100vw, 50vw"
                        priority={i < 4}
                        unoptimized={!!imgs[0]}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-800" />
                    )}
                  </div>

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.92)] via-[rgba(26,22,18,0.35)] to-transparent pointer-events-none" />

                  {/* Content */}
                  <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-6">
                    <div className="flex items-center gap-2 mb-2">
                      {mode === 'popular' && (
                        <span className="px-2.5 py-0.5 text-xs text-white/80 bg-white/15 backdrop-blur-sm rounded-full">
                          #{i + 1}
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 text-xs text-red-300 bg-white/10 backdrop-blur-sm rounded-full inline-flex items-center gap-1">
                        <Heart className="w-3 h-3" fill="currentColor" />
                        {book.likeCount}
                      </span>
                      {book.language && (
                        <span className="text-xs text-white/40">
                          {book.language}
                        </span>
                      )}
                    </div>
                    <h2 className="font-serif text-xl sm:text-2xl text-white font-semibold leading-tight">
                      {book.title}
                    </h2>
                    <p className="mt-1 text-sm text-white/60 line-clamp-1">
                      {[book.author, book.published].filter(Boolean).join(' \u00b7 ')}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>

        ) : tab === 'pages' ? (
          /* Pages — cream cards with excerpts */
          <div className="space-y-3">
            {pages.map((page, i) => (
              <Link
                key={page.id}
                href={`/book/${page.bookId}/page-number/${page.pageNumber}`}
                className="group block rounded-lg overflow-hidden bg-warm border border-border-light hover:border-border-medium transition-colors"
              >
                <div className="flex items-start gap-4 p-5">
                  {mode === 'popular' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-sm font-bold text-muted">
                      {i + 1}
                    </div>
                  )}
                  {page.thumbnail && (
                    <div className="flex-shrink-0 w-14 h-[72px] relative rounded overflow-hidden bg-stone-200">
                      <Image
                        src={page.thumbnail}
                        alt={`Page ${page.pageNumber}`}
                        fill
                        className="object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                        sizes="56px"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-sm font-serif font-medium text-primary group-hover:text-accent-rust transition-colors">
                          {page.bookTitle}
                        </span>
                        {page.bookAuthor && (
                          <span className="text-sm text-muted ml-2">{page.bookAuthor}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-faint">p. {page.pageNumber}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-red-500">
                          <Heart className="w-3 h-3" fill="currentColor" />
                          {page.likeCount}
                        </span>
                      </div>
                    </div>
                    {page.excerpt && (
                      <p className="text-sm text-muted mt-2 line-clamp-2 font-body leading-relaxed">
                        {page.excerpt}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>

        ) : (
          /* Gallery images — dark grid with overlays */
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {images.map((img, i) => (
              <Link
                key={img.galleryImageId}
                href={`/gallery/image/${img.galleryImageId}`}
                className="group relative block overflow-hidden rounded-lg aspect-square"
              >
                <Image
                  src={img.croppedUrl}
                  alt={img.description || 'Gallery image'}
                  fill
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  sizes="(max-width: 640px) 50vw, 33vw"
                  priority={i < 6}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.88)] via-[rgba(26,22,18,0.15)] to-transparent opacity-80 group-hover:opacity-100 transition-opacity" />
                <div className="absolute inset-0 flex flex-col justify-end p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2 py-0.5 text-[10px] text-white/70 bg-white/15 backdrop-blur-sm rounded-full capitalize">
                      {img.type}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] text-red-300 bg-white/10 backdrop-blur-sm rounded-full inline-flex items-center gap-1">
                      <Heart className="w-2.5 h-2.5" fill="currentColor" />
                      {img.likeCount}
                    </span>
                  </div>
                  <p className="text-xs text-white/90 line-clamp-2 leading-snug">
                    {img.description}
                  </p>
                  <p className="text-[10px] text-white/40 mt-1 line-clamp-1 font-serif">
                    {img.bookTitle}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
