'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BLOG_KINDS, KIND_INFO, postHref, type BlogKind, type BlogPost } from './posts';
import { PAGE_SIZE, isKind, listingHref } from './listing';

type Filter = BlogKind | 'all';
type Sort = 'newest' | 'oldest' | 'title';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
];

// Old /blog#kind links, including the two kinds merged into Research notes.
const OLD_HASHES: Record<string, BlogKind> = {
  stories: 'stories', tours: 'tours', interactive: 'interactive', library: 'library',
  counting: 'research', reading: 'research', research: 'research',
};


// Lower-case and strip accents, so "hatha" finds "haṭha".
function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const byDate = (a: BlogPost, b: BlogPost) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
const SORTERS: Record<Sort, (a: BlogPost, b: BlogPost) => number> = {
  newest: (a, b) => byDate(b, a),
  oldest: byDate,
  title: (a, b) => a.title.localeCompare(b.title, 'en'),
};

export function ArticleCard({
  post,
  priority = false,
  enter,
}: {
  post: BlogPost;
  priority?: boolean;
  // Place in the /articles entrance (globals.css .articles-enter); unset elsewhere.
  enter?: number;
}) {
  return (
    <Link
      href={postHref(post)}
      className={`group block${enter === undefined ? '' : ' articles-enter'}`}
      style={enter === undefined ? undefined : ({ '--enter': enter } as React.CSSProperties)}
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-cover-bg">
        <Image
          src={post.image}
          alt={post.imageAlt || ''}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 480px"
          className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
          style={post.imagePosition ? { objectPosition: post.imagePosition } : undefined}
          priority={priority}
        />
      </div>
      <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-muted">
        {KIND_INFO[post.kind].label}
        <span className="mx-2 text-border-light" aria-hidden="true">|</span>
        {post.date}
        {post.readTime && (
          <>
            <span className="mx-2 text-border-light" aria-hidden="true">|</span>
            {post.readTime}
          </>
        )}
      </p>
      <h2 className="mt-1.5 sm:mt-2 font-serif text-xl sm:text-2xl text-primary leading-snug">
        {post.title}
      </h2>
      <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-secondary leading-relaxed font-body">{post.summary}</p>
    </Link>
  );
}

const PILL =
  'h-11 rounded-full border border-stone-400 bg-white text-base text-primary hover:border-primary focus:outline-none focus-visible:border-primary transition-colors';

function PillSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={`${PILL} appearance-none cursor-pointer pl-5 pr-10`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

const INTRO =
  'Stories followed through the books, reading tours, research notes and things to try. Every claim is grounded in primary sources from the collection.';

function PageButton({
  n,
  current,
  href,
  onClick,
  children,
  disabled,
  wide,
}: {
  n: number;
  current: number;
  href: string | null;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  wide?: boolean;
}) {
  const isCurrent = !wide && n === current;
  const cls = wide
    ? `h-10 px-4 inline-flex items-center text-sm ${disabled ? 'text-muted cursor-default' : 'text-primary hover:underline underline-offset-4'}`
    : `h-10 w-10 inline-flex items-center justify-center border text-sm transition-colors ${
        isCurrent ? 'bg-primary text-white border-primary' : 'border-border-light text-primary hover:border-primary'
      }`;
  if (disabled) return <span className={cls}>{children}</span>;
  // Before a search or a re-sort, every page has its own address, so the
  // numbers are real links that a crawler can follow.
  if (href) {
    return (
      <Link href={href} aria-current={isCurrent ? 'page' : undefined} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-current={isCurrent ? 'page' : undefined} className={cls}>
      {children}
    </button>
  );
}

// Every article in one list, newest first, with a search box and two
// dropdowns. The category is in the path (/articles/tours) and so is the page
// (/articles/page/2), so both can be shared and crawled; search and sort are
// local to the visit and page on the client.
export default function BlogIndex({
  posts,
  active = 'all',
  initialPage = 1,
}: {
  posts: BlogPost[];
  active?: Filter;
  initialPage?: number;
}) {
  const [kind, setKind] = useState<Filter>(active);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(initialPage);
  const listTop = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  // A new search, category or sort starts again at page 1.
  useEffect(() => {
    if (mounted.current) setPage(1);
    mounted.current = true;
  }, [kind, query, sort]);

  const goTo = (next: number) => {
    setPage(next);
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Categories used to be a hash on one page (/blog#tours, which the redirect
  // carries over as /articles#tours). Open that category instead.
  const router = useRouter();
  useEffect(() => {
    const old = OLD_HASHES[window.location.hash.slice(1)];
    if (active === 'all' && old) router.replace(listingHref(old));
  }, [active, router]);

  const chooseKind = (next: Filter) => {
    setKind(next);
    history.replaceState(null, '', listingHref(next));
  };

  const shown = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return posts
      .filter((p) => kind === 'all' || p.kind === kind)
      .filter((p) => {
        if (!words.length) return true;
        const text = fold(`${p.title} ${p.subtitle} ${KIND_INFO[p.kind].label}`);
        return words.every((w) => text.includes(w));
      })
      .sort(SORTERS[sort]);
  }, [posts, kind, query, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageItems = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const linkable = query === '' && sort === 'newest';
  const hrefFor = (n: number) => (linkable ? listingHref(kind, n) : null);

  const filtered = kind !== 'all' || query !== '' || sort !== 'newest';
  const kindOptions: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All categories' },
    ...BLOG_KINDS.map((k) => ({ value: k as Filter, label: KIND_INFO[k].label })),
  ];

  return (
    <div>
      <h1 className="articles-enter font-serif text-5xl md:text-7xl text-primary tracking-tight">
        {kind === 'all' ? 'Articles' : KIND_INFO[kind].label}
      </h1>
      <p style={{ '--enter': 1 } as React.CSSProperties} className="articles-enter mt-6 mb-10 max-w-3xl text-lg md:text-xl text-secondary font-body leading-relaxed">
        {kind === 'all' ? INTRO : KIND_INFO[kind].definition}
      </p>

      <div style={{ '--enter': 2 } as React.CSSProperties} className="articles-enter flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <label className="block w-full md:w-96">
            <span className="sr-only">Search articles</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className={`${PILL} w-full px-5 placeholder:text-muted`}
            />
          </label>
          <p className="mt-3 text-sm text-muted" aria-live="polite">
            {shown.length} / {posts.length}
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSort('newest');
                  chooseKind('all');
                }}
                className="ml-4 text-primary underline decoration-border-light underline-offset-4 hover:decoration-primary"
              >
                Reset
              </button>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <PillSelect
            label="Category"
            value={kind}
            options={kindOptions}
            onChange={(v) => chooseKind(isKind(v) ? v : 'all')}
          />
          <PillSelect label="Sort" value={sort} options={SORTS} onChange={setSort} />
        </div>
      </div>

      <div ref={listTop} className="scroll-mt-6" />
      {shown.length > 0 ? (
        <div className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {pageItems.map((post, i) => (
            // Cards below the first rows arrive with the rest, not later.
            <ArticleCard key={post.slug} post={post} priority={current === 1 && i < 3} enter={3 + Math.min(i, 6)} />
          ))}
        </div>
      ) : (
        <p className="mt-12 text-secondary">No articles match that search.</p>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-16 flex items-center justify-center gap-2">
          <PageButton n={current - 1} current={current} href={hrefFor(current - 1)} onClick={() => goTo(current - 1)} disabled={current === 1} wide>
            &larr; Previous
          </PageButton>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <PageButton key={n} n={n} current={current} href={hrefFor(n)} onClick={() => goTo(n)}>
              {n}
            </PageButton>
          ))}
          <PageButton n={current + 1} current={current} href={hrefFor(current + 1)} onClick={() => goTo(current + 1)} disabled={current === pages} wide>
            Next &rarr;
          </PageButton>
        </nav>
      )}
    </div>
  );
}
