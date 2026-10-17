'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { BLOG_KINDS, KIND_INFO, postHref, type BlogKind, type BlogPost } from './posts';
import { CARD_SCRIM, FADE_PX } from './card-scrim';

// How many posts besides the lead each kind shows on the "All" view.
const PREVIEW_COUNT = 3;

type Filter = BlogKind | 'all';

// Old /blog#kind links, including the two kinds merged into Research notes.
const OLD_HASHES: Record<string, BlogKind> = {
  stories: 'stories', tours: 'tours', interactive: 'interactive', library: 'library',
  counting: 'research', reading: 'research', research: 'research',
};

function kindHref(kind: Filter) {
  return kind === 'all' ? '/articles' : `/articles/${kind}`;
}

function newestFirst(a: BlogPost, b: BlogPost) {
  return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
}

function metaText(post: BlogPost) {
  return [post.date, post.readTime].filter(Boolean).join(' · ');
}

function Meta({ post }: { post: BlogPost }) {
  return <span className="text-sm text-muted">{metaText(post)}</span>;
}

// The lead of a kind, and the Latest card: the title is set on the picture,
// over CARD_SCRIM (see card-scrim.ts for why that is legible on any image);
// the summary sits on white underneath. Tall on a phone, wide from `sm` up.
function LeadCard({ post, priority = false }: { post: BlogPost; priority?: boolean }) {
  return (
    <Link
      href={postHref(post)}
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
            {metaText(post)}
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
    <Link href={postHref(post)} className="group flex gap-4 sm:block">
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
  skip,
}: {
  kind: BlogKind;
  posts: BlogPost[];
  preview: boolean;
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
        <h2 className="font-serif text-2xl md:text-3xl text-primary">
          {preview ? (
            <Link href={kindHref(kind)} className="hover:text-accent-gold-dark transition-colors">{info.label}</Link>
          ) : (
            info.label
          )}
        </h2>
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
        <Link
          href={kindHref(kind)}
          className="inline-block mt-6 text-accent-rust text-sm font-medium hover:underline underline-offset-2"
        >
          All {posts.length} in {info.label} &rarr;
        </Link>
      )}
    </section>
  );
}

export default function BlogIndex({ posts, active = 'all' }: { posts: BlogPost[]; active?: Filter }) {
  const chipRow = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Categories used to be a hash on one page (/blog#tours, which the redirect
  // carries over as /articles#tours). Send those links to the category's page.
  useEffect(() => {
    const kind = OLD_HASHES[window.location.hash.slice(1)];
    if (active === 'all' && kind) router.replace(kindHref(kind));
  }, [active, router]);

  // On a phone the chip row scrolls sideways; keep the current chip in view.
  useEffect(() => {
    const row = chipRow.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && current) row.scrollLeft = current.offsetLeft - row.offsetLeft - 16;
  }, [active]);

  const sorted = [...posts].sort(newestFirst);
  const byKind = Object.fromEntries(
    BLOG_KINDS.map((kind) => [kind, sorted.filter((p) => p.kind === kind)]),
  ) as Record<BlogKind, BlogPost[]>;
  // Pages that live outside /articles have no date, so never lead as Latest.
  const latest = sorted.find((p) => !p.href) ?? sorted[0];

  const chip = (value: Filter, label: string, count: number) => {
    const current = active === value;
    return (
      <Link
        key={value}
        href={kindHref(value)}
        aria-current={current ? 'page' : undefined}
        className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
          current
            ? 'bg-primary text-white border-primary'
            : 'bg-white text-secondary border-border-light hover:border-accent-gold hover:text-primary'
        }`}
      >
        {label} <span className={current ? 'text-white/70' : 'text-muted'}>{count}</span>
      </Link>
    );
  };

  return (
    <div>
      <nav
        id="blog-kinds"
        aria-label="Article categories"
        className="sticky top-0 z-20 -mx-6 px-6 md:-mx-12 md:px-12 py-3 mb-8 bg-cream/95 backdrop-blur border-b border-border-light"
      >
        <div ref={chipRow} className="flex gap-2 overflow-x-auto md:flex-wrap md:overflow-visible" style={{ scrollbarWidth: 'none' }}>
          {chip('all', 'All', posts.length)}
          {BLOG_KINDS.map((kind) => chip(kind, KIND_INFO[kind].label, byKind[kind].length))}
        </div>
      </nav>

      {active === 'all' ? (
        <div className="space-y-16">
          <section>
            <h2 className="text-xs text-muted tracking-wide uppercase mb-3">Latest</h2>
            <LeadCard post={latest} priority />
          </section>
          {BLOG_KINDS.map((kind) => (
            <KindSection key={kind} kind={kind} posts={byKind[kind]} preview skip={latest.slug} />
          ))}
        </div>
      ) : (
        <KindSection kind={active} posts={byKind[active]} preview={false} />
      )}
    </div>
  );
}
