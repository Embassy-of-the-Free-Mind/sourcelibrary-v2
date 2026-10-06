'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BLOG_KINDS, KIND_INFO, type BlogKind, type BlogPost } from './posts';
import { CARD_SCRIM, FADE_PX } from './card-scrim';

// How many posts besides the lead each kind shows on the "All" view.
const PREVIEW_COUNT = 3;

type Filter = BlogKind | 'all';

function isKind(value: string): value is BlogKind {
  return (BLOG_KINDS as readonly string[]).includes(value);
}

function newestFirst(a: BlogPost, b: BlogPost) {
  return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
}

function Meta({ post }: { post: BlogPost }) {
  return (
    <span className="text-sm text-muted">
      {post.date} &middot; {post.readTime}
    </span>
  );
}

// The lead of a kind, and the Latest card: the title is set on the picture,
// over CARD_SCRIM (see card-scrim.ts for why that is legible on any image);
// the summary sits on white underneath. Tall on a phone, wide from `sm` up.
function LeadCard({ post, priority = false }: { post: BlogPost; priority?: boolean }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="block bg-white rounded-xl overflow-hidden shadow-sm border border-border-light hover:shadow-lg transition-all group"
    >
      <div className="relative aspect-[4/5] sm:aspect-[16/9] md:aspect-[2/1] overflow-hidden bg-cover-bg">
        <Image
          src={post.image}
          alt={post.imageAlt || ''}
          fill
          sizes="(max-width: 1024px) 100vw, 1024px"
          className="object-cover group-hover:scale-[1.02] transition-transform duration-700"
          style={post.imagePosition ? { objectPosition: post.imagePosition } : undefined}
          priority={priority}
        />
        <div
          className="absolute inset-x-0 bottom-0 px-6 pb-6 md:px-10 md:pb-8"
          style={{ background: CARD_SCRIM, paddingTop: FADE_PX }}
        >
          <span className="block text-xs text-stone-300 tracking-wide uppercase mb-2">
            {post.date} &middot; {post.readTime}
          </span>
          <h3 className="font-serif text-2xl sm:text-3xl md:text-4xl text-white leading-tight line-clamp-3 drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
            {post.title}
          </h3>
        </div>
      </div>
      <div className="px-6 py-5 md:px-10 md:py-6">
        <p className="text-secondary leading-relaxed font-body md:text-lg line-clamp-3">{post.subtitle}</p>
        <span className="inline-block mt-3 text-accent-rust text-sm font-medium group-hover:translate-x-1 transition-transform">
          Read &rarr;
        </span>
      </div>
    </Link>
  );
}

// A row with a thumbnail on phones; an image-topped card from `sm` up.
function PostCard({ post }: { post: BlogPost }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group flex gap-4 sm:block">
      <div className="relative w-24 h-24 sm:w-full sm:h-auto sm:aspect-[4/3] shrink-0 rounded-lg overflow-hidden border border-border-light bg-cover-bg">
        <Image
          src={post.image}
          alt={post.imageAlt || ''}
          fill
          sizes="(max-width: 640px) 96px, (max-width: 1024px) 50vw, 33vw"
          className="object-cover group-hover:scale-[1.04] transition-transform duration-500"
          style={post.imagePosition ? { objectPosition: post.imagePosition } : undefined}
        />
      </div>
      <div className="min-w-0 sm:mt-3">
        <h3 className="font-serif text-lg md:text-xl text-primary group-hover:text-accent-gold-dark transition-colors leading-snug mb-1">
          {post.title}
        </h3>
        <p className="text-base text-secondary leading-relaxed line-clamp-3 font-body mb-1 max-sm:hidden">
          {post.subtitle}
        </p>
        <Meta post={post} />
      </div>
    </Link>
  );
}

function KindSection({
  kind,
  posts,
  preview,
  onShowAll,
  skip,
}: {
  kind: BlogKind;
  posts: BlogPost[];
  preview: boolean;
  onShowAll: (kind: BlogKind) => void;
  // A post already shown above (the Latest card), left out of the preview grid.
  skip?: string;
}) {
  const info = KIND_INFO[kind];
  const lead = posts.find((p) => p.slug === info.lead) ?? posts[0];
  const others = posts.filter((p) => p !== lead && p.slug !== skip);
  const shown = preview ? others.slice(0, PREVIEW_COUNT) : others;

  return (
    <section id={kind} className="scroll-mt-28">
      <div className="mb-5">
        <h2 className="font-serif text-2xl md:text-3xl text-primary">{info.label}</h2>
        <p className="text-secondary font-body mt-1">{info.definition}</p>
      </div>
      <LeadCard post={lead} />
      {shown.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mt-8">
          {shown.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
      {preview && others.length > shown.length && (
        <button
          type="button"
          onClick={() => onShowAll(kind)}
          className="mt-6 text-accent-rust text-sm font-medium hover:underline underline-offset-2"
        >
          All {posts.length} in {info.label} &rarr;
        </button>
      )}
    </section>
  );
}

export default function BlogIndex({ posts }: { posts: BlogPost[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const chipRow = useRef<HTMLDivElement>(null);

  // The filter lives in the URL hash (/blog#tours) so a filtered view can be shared.
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      setFilter(isKind(hash) ? hash : 'all');
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // On a phone the chip row scrolls sideways; keep the active chip in view.
  useEffect(() => {
    const row = chipRow.current;
    const active = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && active) row.scrollLeft = active.offsetLeft - row.offsetLeft - 16;
  }, [filter]);

  const choose = (next: Filter) => {
    setFilter(next);
    history.replaceState(null, '', next === 'all' ? window.location.pathname : `#${next}`);
    document.getElementById('blog-kinds')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sorted = [...posts].sort(newestFirst);
  const byKind = Object.fromEntries(
    BLOG_KINDS.map((kind) => [kind, sorted.filter((p) => p.kind === kind)]),
  ) as Record<BlogKind, BlogPost[]>;
  const latest = sorted[0];

  const chip = (value: Filter, label: string, count: number) => {
    const active = filter === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => choose(value)}
        aria-pressed={active}
        className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
          active
            ? 'bg-primary text-white border-primary'
            : 'bg-white text-secondary border-border-light hover:border-accent-gold hover:text-primary'
        }`}
      >
        {label} <span className={active ? 'text-white/70' : 'text-muted'}>{count}</span>
      </button>
    );
  };

  return (
    <div>
      <nav
        id="blog-kinds"
        aria-label="Filter notes by kind"
        className="sticky top-0 z-20 -mx-6 px-6 md:-mx-12 md:px-12 py-3 mb-8 bg-cream/95 backdrop-blur border-b border-border-light"
      >
        <div ref={chipRow} className="flex gap-2 overflow-x-auto md:flex-wrap md:overflow-visible" style={{ scrollbarWidth: 'none' }}>
          {chip('all', 'All', posts.length)}
          {BLOG_KINDS.map((kind) => chip(kind, KIND_INFO[kind].label, byKind[kind].length))}
        </div>
      </nav>

      {filter === 'all' ? (
        <div className="space-y-16">
          <section>
            <h2 className="text-xs text-muted tracking-wide uppercase mb-3">Latest</h2>
            <LeadCard post={latest} priority />
          </section>
          {BLOG_KINDS.map((kind) => (
            <KindSection key={kind} kind={kind} posts={byKind[kind]} preview skip={latest.slug} onShowAll={choose} />
          ))}
        </div>
      ) : (
        <KindSection kind={filter} posts={byKind[filter]} preview={false} onShowAll={choose} />
      )}
    </div>
  );
}
